use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectBuildSystem {
    NodePackage,
    PythonProject,
    CargoWorkspace,
    Maven,
    Gradle,
    CMake,
    Make,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuildStep {
    pub command: String,
    pub args: Vec<String>,
    pub label: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildRunStrategy {
    ExistingAdapter,
    CargoRun,
    JavaClasses(&'static str),
    DiscoverNativeArtifact,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectBuildPlan {
    pub system: ProjectBuildSystem,
    pub steps: Vec<BuildStep>,
    pub run_strategy: BuildRunStrategy,
    pub evidence: String,
}

pub fn detect_project_build(
    root: &Path,
    adapter: &str,
    _entry: &Path,
) -> Result<Option<ProjectBuildPlan>, String> {
    if adapter == "rust" && root.join("Cargo.toml").is_file() {
        return Ok(Some(plan(
            ProjectBuildSystem::CargoWorkspace,
            vec![step(
                "cargo",
                &["build", "--workspace", "--offline"],
                "Cargo workspace offline build",
            )],
            BuildRunStrategy::CargoRun,
            "Cargo workspace is built and run offline inside the controlled project copy.",
        )));
    }
    if adapter == "java" && root.join("pom.xml").is_file() {
        return Ok(Some(plan(
            ProjectBuildSystem::Maven,
            vec![step(
                "mvn",
                &["--offline", "-q", "-DskipTests", "compile"],
                "Maven offline compile",
            )],
            BuildRunStrategy::JavaClasses("target/classes"),
            "Maven is forced offline and only compiled classes are executed.",
        )));
    }
    if adapter == "java"
        && (root.join("build.gradle").is_file() || root.join("build.gradle.kts").is_file())
    {
        return Ok(Some(plan(
            ProjectBuildSystem::Gradle,
            vec![BuildStep {
                command: gradle_wrapper(root),
                args: strings(&["--offline", "--no-daemon", "classes"]),
                label: "Gradle offline classes".into(),
            }],
            BuildRunStrategy::JavaClasses("build/classes/java/main"),
            "Gradle is forced offline and daemon-free.",
        )));
    }
    if matches!(adapter, "c" | "cpp") && root.join("CMakeLists.txt").is_file() {
        return Ok(Some(plan(
            ProjectBuildSystem::CMake,
            vec![
                step(
                    "cmake",
                    &[
                        "-S",
                        ".",
                        "-B",
                        ".codeflow-build",
                        "-DCMAKE_BUILD_TYPE=Debug",
                    ],
                    "CMake isolated configure",
                ),
                step(
                    "cmake",
                    &["--build", ".codeflow-build", "--parallel", "2"],
                    "CMake bounded build",
                ),
            ],
            BuildRunStrategy::DiscoverNativeArtifact,
            "CMake writes only to .codeflow-build and uses at most two build workers.",
        )));
    }
    if matches!(adapter, "c" | "cpp")
        && (root.join("Makefile").is_file() || root.join("makefile").is_file())
    {
        return Ok(Some(plan(
            ProjectBuildSystem::Make,
            vec![step("make", &["-j2"], "Make bounded build")],
            BuildRunStrategy::DiscoverNativeArtifact,
            "Make runs in the controlled copy with two workers.",
        )));
    }
    if adapter == "node" && root.join("package.json").is_file() && has_node_build_script(root)? {
        return Ok(Some(plan(
            ProjectBuildSystem::NodePackage,
            vec![step("npm", &["run", "build", "--if-present"], "Node package build")],
            BuildRunStrategy::ExistingAdapter,
            "The package build script runs only after explicit user execution in the network-denied sandbox.",
        )));
    }
    if adapter == "python"
        && (root.join("pyproject.toml").is_file() || root.join("setup.py").is_file())
    {
        return Ok(Some(plan(
            ProjectBuildSystem::PythonProject,
            vec![step("python3", &["-I", "-m", "compileall", "-q", "."], "Python isolated compile check")],
            BuildRunStrategy::ExistingAdapter,
            "The full Python source tree is compiled in isolated interpreter mode before execution.",
        )));
    }
    Ok(None)
}

pub fn discover_native_artifact(root: &Path, entry: &Path) -> Result<PathBuf, String> {
    let preferred = entry
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let mut candidates = Vec::new();
    collect_executables(root, &mut candidates)?;
    candidates.sort_by(|left: &(bool, u64, PathBuf), right| {
        right.0.cmp(&left.0).then_with(|| right.1.cmp(&left.1))
    });
    candidates
        .into_iter()
        .find(|(_, _, path)| {
            let text = path.to_string_lossy();
            !text.contains("CMakeFiles")
                && !text.ends_with(".dylib")
                && !text.ends_with(".so")
                && !text.ends_with(".dll")
        })
        .map(|(_, _, path)| path)
        .ok_or_else(|| {
            format!("build completed but no executable artifact matching {preferred:?} was found")
        })
}

fn collect_executables(
    directory: &Path,
    output: &mut Vec<(bool, u64, PathBuf)>,
) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        if kind.is_dir() {
            if !matches!(
                entry.file_name().to_str(),
                Some("node_modules" | ".git" | "target")
            ) {
                collect_executables(&path, output)?;
            }
        } else if kind.is_file() && is_executable(&path) {
            let modified = entry
                .metadata()
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs())
                .unwrap_or(0);
            let preferred = path
                .parent()
                .is_some_and(|parent| parent.ends_with(".codeflow-build"));
            output.push((preferred, modified, path));
        }
    }
    Ok(())
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path).is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(windows)]
fn is_executable(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("exe"))
}

#[cfg(not(any(unix, windows)))]
fn is_executable(_path: &Path) -> bool {
    false
}

fn has_node_build_script(root: &Path) -> Result<bool, String> {
    let content = fs::read_to_string(root.join("package.json"))
        .map_err(|error| format!("failed to read package.json: {error}"))?;
    let value: serde_json::Value = serde_json::from_str(&content)
        .map_err(|error| format!("package.json is invalid JSON: {error}"))?;
    Ok(value
        .pointer("/scripts/build")
        .and_then(|value| value.as_str())
        .is_some())
}

fn gradle_wrapper(root: &Path) -> String {
    #[cfg(windows)]
    if root.join("gradlew.bat").is_file() {
        return root.join("gradlew.bat").to_string_lossy().to_string();
    }
    if root.join("gradlew").is_file() {
        return root.join("gradlew").to_string_lossy().to_string();
    }
    "gradle".to_string()
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

fn step(command: &str, args: &[&str], label: &str) -> BuildStep {
    BuildStep {
        command: command.into(),
        args: strings(args),
        label: label.into(),
    }
}

fn plan(
    system: ProjectBuildSystem,
    steps: Vec<BuildStep>,
    run_strategy: BuildRunStrategy,
    evidence: &str,
) -> ProjectBuildPlan {
    ProjectBuildPlan {
        system,
        steps,
        run_strategy,
        evidence: evidence.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("codeflow-build-plan-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("fixture root");
        root
    }

    #[test]
    fn detects_all_supported_project_build_systems_without_execution() {
        let cases = [
            (
                "cargo",
                "rust",
                "Cargo.toml",
                "[workspace]\n",
                ProjectBuildSystem::CargoWorkspace,
            ),
            (
                "maven",
                "java",
                "pom.xml",
                "<project/>",
                ProjectBuildSystem::Maven,
            ),
            (
                "gradle",
                "java",
                "build.gradle",
                "plugins {}",
                ProjectBuildSystem::Gradle,
            ),
            (
                "cmake",
                "cpp",
                "CMakeLists.txt",
                "project(x)",
                ProjectBuildSystem::CMake,
            ),
            (
                "make",
                "c",
                "Makefile",
                "all:\n\ttrue\n",
                ProjectBuildSystem::Make,
            ),
            (
                "python",
                "python",
                "pyproject.toml",
                "[project]\nname='x'",
                ProjectBuildSystem::PythonProject,
            ),
            (
                "node",
                "node",
                "package.json",
                r#"{"scripts":{"build":"node build.js"}}"#,
                ProjectBuildSystem::NodePackage,
            ),
        ];
        for (name, adapter, manifest, content, expected) in cases {
            let root = fixture(name);
            fs::write(root.join(manifest), content).expect("manifest");
            let plan = detect_project_build(&root, adapter, Path::new("main"))
                .expect("detect")
                .expect("plan");
            assert_eq!(plan.system, expected);
            assert!(!plan.steps.is_empty());
            let _ = fs::remove_dir_all(root);
        }
    }

    #[test]
    fn dependency_builders_are_forced_offline() {
        for (manifest, adapter) in [
            ("Cargo.toml", "rust"),
            ("pom.xml", "java"),
            ("build.gradle", "java"),
        ] {
            let root = fixture(manifest);
            fs::write(root.join(manifest), "").expect("manifest");
            let plan = detect_project_build(&root, adapter, Path::new("main"))
                .expect("detect")
                .expect("plan");
            assert!(plan
                .steps
                .iter()
                .flat_map(|step| &step.args)
                .any(|arg| arg == "--offline"));
            let _ = fs::remove_dir_all(root);
        }
    }
}
