use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

const MANIFEST: &str = include_str!("../lsp-sidecars/manifest.json");
static VERIFICATION_CACHE: OnceLock<Mutex<BTreeMap<String, bool>>> = OnceLock::new();
#[derive(Debug, Clone)]
pub struct SidecarRoots {
    pub managed_root: Option<PathBuf>,
    pub bundled_roots: Vec<PathBuf>,
    pub disabled: BTreeSet<String>,
}

#[derive(Debug, Clone)]
pub struct ResolvedSidecar {
    pub path: PathBuf,
    pub source: String,
    pub version: String,
    pub fingerprint: String,
    pub verified: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarManifest {
    schema_version: u32,
    tools: Vec<SidecarManifestTool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarManifestTool {
    id: String,
    label: String,
    command: String,
    languages: Vec<String>,
    package_kind: String,
    version_policy: String,
    license_source: String,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarSettings {
    disabled: BTreeSet<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarChecksums {
    target: String,
    versions: BTreeMap<String, String>,
    files: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarToolStatus {
    pub id: String,
    pub label: String,
    pub command: String,
    pub languages: Vec<String>,
    pub package_kind: String,
    pub version_policy: String,
    pub license_source: String,
    pub state: String,
    pub enabled: bool,
    pub available: bool,
    pub verified: bool,
    pub version: String,
    pub fingerprint: String,
    pub executable_path: String,
    pub evidence: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatusReport {
    pub status: String,
    pub target: String,
    pub schema_version: u32,
    pub managed_root: String,
    pub bundled_roots: Vec<String>,
    pub available_count: usize,
    pub verified_count: usize,
    pub tool_count: usize,
    pub tools: Vec<SidecarToolStatus>,
    pub evidence: Vec<String>,
}

pub fn roots_from_app(app: &AppHandle) -> SidecarRoots {
    let managed_root = app
        .path()
        .app_data_dir()
        .ok()
        .map(|path| path.join("lsp-sidecars/current"));
    let target = target_triple();
    let mut bundled_roots = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        bundled_roots.push(resource_dir.join("lsp-sidecars").join(&target));
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            bundled_roots.push(parent.to_path_buf());
        }
    }
    bundled_roots.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("lsp-sidecars")
            .join(&target),
    );
    let disabled = managed_root
        .as_ref()
        .and_then(|root| root.parent())
        .and_then(load_settings)
        .unwrap_or_default()
        .disabled;
    SidecarRoots {
        managed_root,
        bundled_roots,
        disabled,
    }
}

#[cfg(test)]
pub fn test_roots() -> SidecarRoots {
    SidecarRoots {
        managed_root: None,
        bundled_roots: Vec::new(),
        disabled: BTreeSet::new(),
    }
}

pub fn resolve_tool(tool_id: &str, command: &str, roots: &SidecarRoots) -> Option<ResolvedSidecar> {
    if roots.disabled.contains(tool_id) {
        return None;
    }
    if let Some(path) = executable_override(command)
        .and_then(|name| std::env::var_os(name))
        .map(PathBuf::from)
        .filter(|path| path.is_file())
    {
        return Some(resolved_unverified(path, "override"));
    }
    if let Some(root) = roots.managed_root.as_ref() {
        if let Some(resolved) = resolve_from_root(root, tool_id, command, "managed") {
            return Some(resolved);
        }
    }
    for root in &roots.bundled_roots {
        if let Some(resolved) = resolve_from_root(root, tool_id, command, "bundled") {
            return Some(resolved);
        }
    }
    resolve_system(command).map(|path| resolved_unverified(path, "system"))
}

pub fn resolve_verified_package_file(
    tool_id: &str,
    relative_path: &str,
    roots: &SidecarRoots,
) -> Option<ResolvedSidecar> {
    let mut candidates = Vec::new();
    if let Some(root) = roots.managed_root.as_ref() {
        candidates.push((root, "managed"));
    }
    candidates.extend(roots.bundled_roots.iter().map(|root| (root, "bundled")));
    for (root, source) in candidates {
        let path = root.join(tool_id).join(relative_path);
        let Some(checksums) = load_checksums(root) else {
            continue;
        };
        let Ok(relative_path) = path.strip_prefix(root) else {
            continue;
        };
        let relative = normalized_path(relative_path);
        let Some(expected) = checksums.files.get(&relative) else {
            continue;
        };
        let Ok(fingerprint) = sha256_file(&path) else {
            continue;
        };
        if fingerprint != *expected || !verify_tool_package(root, tool_id, &checksums) {
            continue;
        }
        return Some(ResolvedSidecar {
            path,
            source: source.to_string(),
            version: checksums.versions.get(tool_id).cloned().unwrap_or_default(),
            fingerprint,
            verified: true,
        });
    }
    None
}

pub fn status(app: &AppHandle) -> SidecarStatusReport {
    let roots = roots_from_app(app);
    status_for_roots(&roots)
}

pub fn set_enabled(
    app: &AppHandle,
    tool_id: &str,
    enabled: bool,
) -> Result<SidecarStatusReport, String> {
    let manifest = parse_manifest()?;
    if !manifest.tools.iter().any(|tool| tool.id == tool_id) {
        return Err(format!("unknown LSP sidecar {tool_id}"));
    }
    let settings_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve sidecar settings directory: {error}"))?
        .join("lsp-sidecars");
    fs::create_dir_all(&settings_dir)
        .map_err(|error| format!("failed to create sidecar settings directory: {error}"))?;
    let mut settings = load_settings(&settings_dir).unwrap_or_default();
    if enabled {
        settings.disabled.remove(tool_id);
    } else {
        settings.disabled.insert(tool_id.to_string());
    }
    fs::write(
        settings_dir.join("settings.json"),
        serde_json::to_vec_pretty(&settings)
            .map_err(|error| format!("failed to encode sidecar settings: {error}"))?,
    )
    .map_err(|error| format!("failed to write sidecar settings: {error}"))?;
    Ok(status(app))
}

fn status_for_roots(roots: &SidecarRoots) -> SidecarStatusReport {
    let manifest = parse_manifest().unwrap_or_else(|_| SidecarManifest {
        schema_version: 0,
        tools: Vec::new(),
    });
    let tools = manifest
        .tools
        .iter()
        .map(|tool| {
            let enabled = !roots.disabled.contains(&tool.id);
            let resolved = resolve_tool(&tool.id, &tool.command, roots);
            let state = if !enabled {
                "disabled".to_string()
            } else {
                resolved
                    .as_ref()
                    .map(|item| item.source.clone())
                    .unwrap_or_else(|| "missing".to_string())
            };
            SidecarToolStatus {
                id: tool.id.clone(),
                label: tool.label.clone(),
                command: tool.command.clone(),
                languages: tool.languages.clone(),
                package_kind: tool.package_kind.clone(),
                version_policy: tool.version_policy.clone(),
                license_source: tool.license_source.clone(),
                state: state.clone(),
                enabled,
                available: resolved.is_some(),
                verified: resolved.as_ref().is_some_and(|item| item.verified),
                version: resolved
                    .as_ref()
                    .map(|item| item.version.clone())
                    .unwrap_or_default(),
                fingerprint: resolved
                    .as_ref()
                    .map(|item| item.fingerprint.clone())
                    .unwrap_or_default(),
                executable_path: resolved
                    .as_ref()
                    .map(|item| item.path.to_string_lossy().to_string())
                    .unwrap_or_default(),
                evidence: match resolved {
                    Some(item) if item.verified => {
                        format!("{} sidecar checksum matches the build lock", item.source)
                    }
                    Some(item) => format!(
                        "{} executable is available but not covered by a sidecar build lock",
                        item.source
                    ),
                    None if !enabled => "disabled by local desktop setting".to_string(),
                    None => "no managed, bundled or system executable was found".to_string(),
                },
            }
        })
        .collect::<Vec<_>>();
    let available_count = tools.iter().filter(|tool| tool.available).count();
    let verified_count = tools.iter().filter(|tool| tool.verified).count();
    SidecarStatusReport {
        status: if verified_count == tools.len() && !tools.is_empty() {
            "verified".to_string()
        } else if available_count == tools.len() && !tools.is_empty() {
            "system-ready".to_string()
        } else if available_count > 0 {
            "partial".to_string()
        } else {
            "missing".to_string()
        },
        target: target_triple(),
        schema_version: manifest.schema_version,
        managed_root: roots
            .managed_root
            .as_ref()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        bundled_roots: roots
            .bundled_roots
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect(),
        available_count,
        verified_count,
        tool_count: tools.len(),
        tools,
        evidence: vec![
            "Resolution order: per-tool override, managed package, bundled package, system fallback."
                .to_string(),
            "Only checksum-locked managed or bundled packages count as verified sidecars."
                .to_string(),
        ],
    }
}

fn resolve_from_root(
    root: &Path,
    tool_id: &str,
    command: &str,
    source: &str,
) -> Option<ResolvedSidecar> {
    let candidates = [
        root.join(tool_id)
            .join("bin")
            .join(platform_command(command)),
        root.join(tool_id).join(platform_command(command)),
        root.join("bin").join(platform_command(command)),
        root.join(platform_command(command)),
    ];
    let checksums = load_checksums(root);
    for path in candidates {
        if !path.is_file() {
            continue;
        }
        let fingerprint = sha256_file(&path).unwrap_or_default();
        let relative = path
            .strip_prefix(root)
            .ok()
            .map(normalized_path)
            .unwrap_or_default();
        let expected = checksums
            .as_ref()
            .and_then(|lock| lock.files.get(&relative))
            .cloned()
            .unwrap_or_default();
        let package_verified = checksums
            .as_ref()
            .is_some_and(|lock| verify_tool_package(root, tool_id, lock));
        return Some(ResolvedSidecar {
            path,
            source: source.to_string(),
            version: checksums
                .as_ref()
                .and_then(|lock| lock.versions.get(tool_id))
                .cloned()
                .unwrap_or_default(),
            verified: !fingerprint.is_empty() && fingerprint == expected && package_verified,
            fingerprint,
        });
    }
    None
}

fn verify_tool_package(root: &Path, tool_id: &str, lock: &SidecarChecksums) -> bool {
    let version = lock.versions.get(tool_id).cloned().unwrap_or_default();
    let cache_key = format!("{}:{tool_id}:{version}", root.display());
    let cache = VERIFICATION_CACHE.get_or_init(|| Mutex::new(BTreeMap::new()));
    if let Ok(values) = cache.lock() {
        if let Some(value) = values.get(&cache_key) {
            return *value;
        }
    }
    let prefix = format!("{tool_id}/");
    let files = lock
        .files
        .iter()
        .filter(|(path, _)| path.starts_with(&prefix))
        .collect::<Vec<_>>();
    let verified = !files.is_empty()
        && files.iter().all(|(relative, expected)| {
            sha256_file(&root.join(relative))
                .map(|actual| actual == expected.as_str())
                .unwrap_or(false)
        });
    if let Ok(mut values) = cache.lock() {
        values.insert(cache_key, verified);
    }
    verified
}

fn resolved_unverified(path: PathBuf, source: &str) -> ResolvedSidecar {
    ResolvedSidecar {
        fingerprint: sha256_file(&path).unwrap_or_default(),
        path,
        source: source.to_string(),
        version: String::new(),
        verified: false,
    }
}

fn load_checksums(root: &Path) -> Option<SidecarChecksums> {
    let value = fs::read(root.join("checksums.json")).ok()?;
    let lock: SidecarChecksums = serde_json::from_slice(&value).ok()?;
    if !lock.target.is_empty() && lock.target != target_triple() {
        return None;
    }
    Some(lock)
}

fn load_settings(root: &Path) -> Option<SidecarSettings> {
    let value = fs::read(root.join("settings.json")).ok()?;
    serde_json::from_slice(&value).ok()
}

fn parse_manifest() -> Result<SidecarManifest, String> {
    serde_json::from_str(MANIFEST)
        .map_err(|error| format!("failed to parse embedded sidecar manifest: {error}"))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub(crate) fn resolve_system(command: &str) -> Option<PathBuf> {
    let candidate = Path::new(command);
    if candidate.components().count() > 1 && candidate.is_file() {
        return Some(candidate.to_path_buf());
    }
    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path) {
            if let Some(candidate) = executable_in(&directory, command) {
                return Some(candidate);
            }
        }
    }
    let mut common_directories = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ];
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        common_directories.push(home.join(".cargo/bin"));
        common_directories.push(home.join("go/bin"));
        common_directories.push(home.join(".local/bin"));
        common_directories.push(home.join(".dotnet/tools"));
    }
    common_directories
        .into_iter()
        .find_map(|directory| executable_in(&directory, command))
}

fn executable_in(directory: &Path, command: &str) -> Option<PathBuf> {
    let candidate = directory.join(command);
    if candidate.is_file() {
        return Some(candidate);
    }
    #[cfg(target_os = "windows")]
    for extension in ["exe", "cmd", "bat"] {
        let candidate = directory.join(format!("{command}.{extension}"));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn executable_override(command: &str) -> Option<&'static str> {
    match command {
        "pyright-langserver" => Some("CODEFLOW_PYRIGHT_PATH"),
        "jdtls" => Some("CODEFLOW_JDTLS_PATH"),
        "clangd" => Some("CODEFLOW_CLANGD_PATH"),
        "gopls" => Some("CODEFLOW_GOPLS_PATH"),
        "rust-analyzer" => Some("CODEFLOW_RUST_ANALYZER_PATH"),
        "kotlin-language-server" => Some("CODEFLOW_KOTLIN_LS_PATH"),
        "csharp-ls" => Some("CODEFLOW_CSHARP_LS_PATH"),
        "phpantom_lsp" => Some("CODEFLOW_PHPANTOM_LSP_PATH"),
        "ruby-lsp" => Some("CODEFLOW_RUBY_LSP_PATH"),
        "sourcekit-lsp" => Some("CODEFLOW_SOURCEKIT_LSP_PATH"),
        "bash-language-server" => Some("CODEFLOW_BASH_LSP_PATH"),
        "sql-language-server" => Some("CODEFLOW_SQL_LSP_PATH"),
        _ => None,
    }
}

fn platform_command(command: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{command}.exe")
    } else {
        command.to_string()
    }
}

pub(crate) fn target_triple() -> String {
    let architecture = match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        value => value,
    };
    let platform = match std::env::consts::OS {
        "macos" => "apple-darwin",
        "windows" => "pc-windows-msvc",
        "linux" => "unknown-linux-gnu",
        value => value,
    };
    format!("{architecture}-{platform}")
}

fn normalized_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_manifest_has_all_default_lsp_tools() {
        let manifest = parse_manifest().expect("manifest");
        let ids = manifest
            .tools
            .iter()
            .map(|tool| tool.id.as_str())
            .collect::<BTreeSet<_>>();
        assert_eq!(
            ids,
            BTreeSet::from([
                "bash-language-server",
                "clangd",
                "csharp-ls",
                "gopls",
                "jdtls",
                "kotlin-language-server",
                "phpantom-lsp",
                "pyright",
                "ruby-lsp",
                "rust-analyzer",
                "sourcekit-lsp",
                "sql-language-server",
            ])
        );
    }

    #[test]
    fn system_tools_never_count_as_verified_sidecars() {
        let roots = test_roots();
        let report = status_for_roots(&roots);
        assert!(report
            .tools
            .iter()
            .filter(|tool| tool.state == "system")
            .all(|tool| !tool.verified));
    }

    #[test]
    fn prepared_native_packages_are_checksum_verified() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("lsp-sidecars")
            .join(target_triple());
        if !root.join("checksums.json").is_file() {
            return;
        }
        let roots = SidecarRoots {
            managed_root: None,
            bundled_roots: vec![root],
            disabled: BTreeSet::new(),
        };
        for (id, command) in [
            ("pyright", "pyright-langserver"),
            ("jdtls", "jdtls"),
            ("clangd", "clangd"),
            ("gopls", "gopls"),
            ("rust-analyzer", "rust-analyzer"),
        ] {
            let resolved = resolve_tool(id, command, &roots).expect("prepared sidecar");
            assert_eq!(resolved.source, "bundled");
            assert!(
                resolved.verified,
                "{id} package checksum must cover every file"
            );
            assert!(!resolved.version.is_empty());
        }
    }

    #[test]
    fn package_verification_covers_launcher_and_runtime_files() {
        let root = std::env::temp_dir().join(format!(
            "codeflow-sidecar-verification-{}",
            std::process::id()
        ));
        let tool_root = root.join("pyright");
        fs::create_dir_all(tool_root.join("bin")).expect("bin");
        fs::create_dir_all(tool_root.join("runtime")).expect("runtime");
        fs::write(tool_root.join("bin/pyright-langserver"), b"launcher").expect("launcher");
        fs::write(tool_root.join("runtime/server.js"), b"runtime").expect("runtime");
        let mut files = BTreeMap::new();
        for relative in [
            "pyright/bin/pyright-langserver",
            "pyright/runtime/server.js",
        ] {
            files.insert(
                relative.to_string(),
                sha256_file(&root.join(relative)).expect("hash"),
            );
        }
        let lock = SidecarChecksums {
            target: target_triple(),
            versions: BTreeMap::from([("pyright".to_string(), "test".to_string())]),
            files,
        };
        assert!(verify_tool_package(&root, "pyright", &lock));

        let bad_root = root.with_extension("bad");
        fs::create_dir_all(bad_root.join("pyright/bin")).expect("bad bin");
        fs::create_dir_all(bad_root.join("pyright/runtime")).expect("bad runtime");
        fs::write(bad_root.join("pyright/bin/pyright-langserver"), b"launcher")
            .expect("bad launcher");
        fs::write(bad_root.join("pyright/runtime/server.js"), b"tampered").expect("bad runtime");
        assert!(!verify_tool_package(&bad_root, "pyright", &lock));
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(bad_root);
    }
}
