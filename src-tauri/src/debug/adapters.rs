use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const MANIFEST: &str = include_str!("../../debug-sidecars/manifest.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DebugAdapterId {
    VscodeJsDebug,
    Debugpy,
    JavaDebugServer,
    LldbDap,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DapTransport {
    Stdio,
    TcpServer,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugAdapterLicense {
    pub spdx: String,
    pub name: String,
    pub source: String,
    pub notice_required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugAdapterPackage {
    pub package_kind: String,
    pub version: String,
    pub version_policy: String,
    pub source: String,
    pub entrypoint: String,
    pub checksum_algorithm: String,
    pub checksum_required: bool,
    pub checksums: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugAdapterProfile {
    pub id: DebugAdapterId,
    pub label: String,
    pub languages: Vec<String>,
    pub transport: DapTransport,
    pub executable_candidates: Vec<String>,
    pub probe_arguments: Vec<String>,
    pub launch_arguments: Vec<String>,
    pub package: DebugAdapterPackage,
    pub license: DebugAdapterLicense,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugAdapterManifest {
    pub schema_version: u32,
    pub profiles: Vec<DebugAdapterProfile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DebugAdapterProbeState {
    Available,
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugAdapterProbe {
    pub id: DebugAdapterId,
    pub state: DebugAdapterProbeState,
    pub command: String,
    pub executable_path: String,
    pub detected_version: String,
    pub package_version: String,
    pub package_checksum_locked: bool,
    pub license_spdx: String,
    pub evidence: Vec<String>,
}

pub fn adapter_manifest() -> Result<DebugAdapterManifest, String> {
    let manifest = serde_json::from_str::<DebugAdapterManifest>(MANIFEST)
        .map_err(|error| format!("failed to parse debug sidecar manifest: {error}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

pub fn adapter_profiles() -> Result<Vec<DebugAdapterProfile>, String> {
    Ok(adapter_manifest()?.profiles)
}

pub fn adapter_profile(id: DebugAdapterId) -> Result<DebugAdapterProfile, String> {
    adapter_profiles()?
        .into_iter()
        .find(|profile| profile.id == id)
        .ok_or_else(|| format!("debug adapter profile {id:?} is not configured"))
}

pub fn probe_debug_adapters() -> Result<Vec<DebugAdapterProbe>, String> {
    Ok(adapter_profiles()?
        .iter()
        .map(|profile| probe_profile_with(profile, run_version_probe))
        .collect())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DebugPackageLock {
    target: String,
    files: BTreeMap<String, String>,
}

pub fn debug_target() -> &'static str {
    current_target()
}

pub fn probe_managed_debug_adapters(package_root: &Path) -> Result<Vec<DebugAdapterProbe>, String> {
    let lock: DebugPackageLock = serde_json::from_slice(
        &fs::read(package_root.join("checksums.json"))
            .map_err(|error| format!("failed to read debug sidecar lock: {error}"))?,
    )
    .map_err(|error| format!("failed to parse debug sidecar lock: {error}"))?;
    if lock.target != current_target() {
        return Err(format!(
            "debug sidecar target {} does not match {}",
            lock.target,
            current_target()
        ));
    }
    adapter_profiles()?
        .into_iter()
        .map(|profile| probe_managed_profile(package_root, &lock, &profile))
        .collect()
}

fn probe_managed_profile(
    package_root: &Path,
    lock: &DebugPackageLock,
    profile: &DebugAdapterProfile,
) -> Result<DebugAdapterProbe, String> {
    let id = adapter_id_text(profile.id);
    let prefix = format!("{id}/");
    let expected = profile
        .package
        .checksums
        .get(current_target())
        .cloned()
        .unwrap_or_default();
    let mut package_entries = Vec::new();
    for (relative, locked_hash) in lock
        .files
        .iter()
        .filter(|(path, _)| path.starts_with(&prefix))
    {
        let bytes = fs::read(package_root.join(relative))
            .map_err(|error| format!("failed to verify {relative}: {error}"))?;
        let actual = format!("{:x}", Sha256::digest(bytes));
        if &actual != locked_hash {
            return Err(format!("debug sidecar hash mismatch: {relative}"));
        }
        package_entries.push(format!("{relative}\0{locked_hash}"));
    }
    let aggregate = format!(
        "{:x}",
        Sha256::digest(package_entries.join("\n").as_bytes())
    );
    let entrypoint = managed_entrypoint(package_root, profile.id);
    let verified = !package_entries.is_empty() && aggregate == expected && entrypoint.is_file();
    Ok(DebugAdapterProbe {
        id: profile.id,
        state: if verified {
            DebugAdapterProbeState::Available
        } else {
            DebugAdapterProbeState::Missing
        },
        command: entrypoint.to_string_lossy().to_string(),
        executable_path: entrypoint.to_string_lossy().to_string(),
        detected_version: profile.package.version.clone(),
        package_version: profile.package.version.clone(),
        package_checksum_locked: verified,
        license_spdx: profile.license.spdx.clone(),
        evidence: vec![if verified {
            format!("Verified every locked file and package aggregate for {id}.")
        } else {
            format!("Managed package {id} is incomplete or its aggregate hash is invalid.")
        }],
    })
}

fn adapter_id_text(id: DebugAdapterId) -> &'static str {
    match id {
        DebugAdapterId::VscodeJsDebug => "vscode-js-debug",
        DebugAdapterId::Debugpy => "debugpy",
        DebugAdapterId::JavaDebugServer => "java-debug-server",
        DebugAdapterId::LldbDap => "lldb-dap",
    }
}

fn managed_entrypoint(root: &Path, id: DebugAdapterId) -> PathBuf {
    match id {
        DebugAdapterId::VscodeJsDebug => root.join("vscode-js-debug/bin/vscode-js-debug"),
        DebugAdapterId::Debugpy => root.join("debugpy/bin/debugpy-adapter"),
        DebugAdapterId::JavaDebugServer => {
            root.join("java-debug-server/runtime/com.microsoft.java.debug.plugin-0.53.2.jar")
        }
        DebugAdapterId::LldbDap => root.join("lldb-dap/bin/lldb-dap"),
    }
}

fn probe_profile_with<F>(profile: &DebugAdapterProfile, mut runner: F) -> DebugAdapterProbe
where
    F: FnMut(&str, &[String]) -> Result<(String, String), String>,
{
    // A system launcher probe never authenticates the separately managed package.
    let package_checksum_locked = false;
    for candidate in &profile.executable_candidates {
        if let Ok((path, version)) = runner(candidate, &profile.probe_arguments) {
            return DebugAdapterProbe {
                id: profile.id,
                state: DebugAdapterProbeState::Available,
                command: candidate.clone(),
                executable_path: path,
                detected_version: normalize_version_output(&version),
                package_version: profile.package.version.clone(),
                package_checksum_locked,
                license_spdx: profile.license.spdx.clone(),
                evidence: vec![
                    "The fixed launcher responded to the configured version probe.".to_string(),
                    if package_checksum_locked {
                        "The managed adapter package has a SHA-256 lock for this target."
                            .to_string()
                    } else {
                        "Launcher availability does not certify the adapter package; the target SHA-256 lock is missing."
                            .to_string()
                    },
                ],
            };
        }
    }
    DebugAdapterProbe {
        id: profile.id,
        state: DebugAdapterProbeState::Missing,
        command: profile
            .executable_candidates
            .first()
            .cloned()
            .unwrap_or_default(),
        executable_path: String::new(),
        detected_version: String::new(),
        package_version: profile.package.version.clone(),
        package_checksum_locked,
        license_spdx: profile.license.spdx.clone(),
        evidence: vec!["No fixed launcher candidate passed the version probe.".to_string()],
    }
}

fn run_version_probe(command: &str, arguments: &[String]) -> Result<(String, String), String> {
    let output = Command::new(command)
        .args(arguments)
        .output()
        .map_err(|error| format!("failed to execute {command}: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "{command} version probe exited with {}",
            output.status
        ));
    }
    let mut version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        version = String::from_utf8_lossy(&output.stderr).trim().to_string();
    }
    if version.is_empty() {
        return Err(format!("{command} version probe returned no version text"));
    }
    let path = resolve_system_executable(command)
        .unwrap_or_else(|| PathBuf::from(command))
        .to_string_lossy()
        .to_string();
    Ok((path, version))
}

fn validate_manifest(manifest: &DebugAdapterManifest) -> Result<(), String> {
    if manifest.schema_version != 1 {
        return Err(format!(
            "unsupported debug sidecar manifest schema {}",
            manifest.schema_version
        ));
    }
    if manifest.profiles.len() != 4 {
        return Err("debug sidecar manifest must define exactly four adapter profiles".to_string());
    }
    let mut ids = BTreeSet::new();
    let mut languages = BTreeSet::new();
    for profile in &manifest.profiles {
        if !ids.insert(profile.id) {
            return Err(format!("duplicate debug adapter profile {:?}", profile.id));
        }
        if profile.executable_candidates.is_empty()
            || profile.probe_arguments.is_empty()
            || profile.package.version.trim().is_empty()
            || profile.package.entrypoint.trim().is_empty()
        {
            return Err(format!(
                "debug adapter profile {:?} is incomplete",
                profile.id
            ));
        }
        if profile.package.checksum_algorithm != "sha256" || !profile.package.checksum_required {
            return Err(format!(
                "debug adapter profile {:?} must require SHA-256 verification",
                profile.id
            ));
        }
        for (target, checksum) in &profile.package.checksums {
            if target.trim().is_empty() || !is_sha256(checksum) {
                return Err(format!(
                    "debug adapter profile {:?} contains an invalid checksum",
                    profile.id
                ));
            }
        }
        if profile.license.spdx.trim().is_empty() || profile.license.source.trim().is_empty() {
            return Err(format!(
                "debug adapter profile {:?} has no license record",
                profile.id
            ));
        }
        languages.extend(profile.languages.iter().cloned());
    }
    let required = [
        "TypeScript",
        "JavaScript",
        "Python",
        "Java",
        "Rust",
        "C",
        "C++",
    ];
    if required
        .iter()
        .any(|language| !languages.contains(*language))
    {
        return Err("debug adapter profiles do not cover all configured languages".to_string());
    }
    Ok(())
}

fn checksum_locked_for_current_target(package: &DebugAdapterPackage) -> bool {
    package
        .checksums
        .get(current_target())
        .is_some_and(|checksum| is_sha256(checksum))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|value| value.is_ascii_hexdigit())
}

fn normalize_version_output(value: &str) -> String {
    value.lines().next().unwrap_or_default().trim().to_string()
}

fn current_target() -> &'static str {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "x86_64-apple-darwin"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "x86_64-unknown-linux-gnu"
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        "aarch64-unknown-linux-gnu"
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "x86_64-pc-windows-msvc"
    } else {
        "unsupported-target"
    }
}

fn resolve_system_executable(command: &str) -> Option<PathBuf> {
    let direct = Path::new(command);
    if direct.components().count() > 1 && direct.is_file() {
        return Some(direct.to_path_buf());
    }
    std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .map(|directory| directory.join(platform_command(command)))
            .find(|candidate| candidate.is_file())
    })
}

fn platform_command(command: &str) -> String {
    if cfg!(windows) && Path::new(command).extension().is_none() {
        format!("{command}.exe")
    } else {
        command.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_defines_four_profiles_and_all_languages() {
        let manifest = adapter_manifest().expect("valid adapter manifest");
        assert_eq!(manifest.profiles.len(), 4);
        let languages = manifest
            .profiles
            .iter()
            .flat_map(|profile| profile.languages.iter().map(String::as_str))
            .collect::<BTreeSet<_>>();
        for expected in [
            "TypeScript",
            "JavaScript",
            "Python",
            "Java",
            "Rust",
            "C",
            "C++",
        ] {
            assert!(languages.contains(expected), "missing {expected}");
        }
    }

    #[test]
    fn every_profile_has_version_checksum_and_license_policy() {
        for profile in adapter_profiles().expect("profiles") {
            assert!(!profile.package.version.is_empty());
            assert!(profile.package.checksum_required);
            assert_eq!(profile.package.checksum_algorithm, "sha256");
            assert!(!profile.license.spdx.is_empty());
            assert!(profile.license.source.starts_with("https://"));
        }
    }

    #[test]
    fn successful_probe_does_not_claim_an_unlocked_package_is_verified() {
        let profile = adapter_profile(DebugAdapterId::Debugpy).expect("debugpy profile");
        let probe = probe_profile_with(&profile, |command, arguments| {
            assert!(profile
                .executable_candidates
                .iter()
                .any(|value| value == command));
            assert_eq!(arguments, profile.probe_arguments);
            Ok((
                format!("/tools/{command}"),
                "debugpy 1.8.16\nextra".to_string(),
            ))
        });
        assert_eq!(probe.state, DebugAdapterProbeState::Available);
        assert_eq!(probe.detected_version, "debugpy 1.8.16");
        assert!(!probe.package_checksum_locked);
    }

    #[test]
    fn probe_tries_fixed_candidates_in_order_and_reports_missing() {
        let profile = adapter_profile(DebugAdapterId::LldbDap).expect("lldb profile");
        let mut attempts = Vec::new();
        let probe = probe_profile_with(&profile, |command, _| {
            attempts.push(command.to_string());
            Err("missing".to_string())
        });
        assert_eq!(attempts, profile.executable_candidates);
        assert_eq!(probe.state, DebugAdapterProbeState::Missing);
        assert!(probe.executable_path.is_empty());
    }

    #[test]
    fn invalid_checksum_is_rejected() {
        let mut manifest = adapter_manifest().expect("manifest");
        manifest.profiles[0]
            .package
            .checksums
            .insert("test-target".to_string(), "not-a-sha256".to_string());
        assert!(validate_manifest(&manifest).is_err());
    }

    #[test]
    fn macos_managed_packages_verify_every_locked_file() {
        if current_target() != "aarch64-apple-darwin" {
            return;
        }
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("debug-sidecars")
            .join(current_target());
        let probes = probe_managed_debug_adapters(&root).expect("managed debug packages");
        assert_eq!(probes.len(), 4);
        assert!(probes.iter().all(|probe| probe.package_checksum_locked));
    }
}
