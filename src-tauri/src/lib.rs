#[allow(dead_code, unused_imports)]
mod debug;
mod knowledge_pack;
mod lsp;
mod network_policy;
mod runtime_build;
#[cfg(target_os = "windows")]
mod windows_appcontainer;

#[cfg(target_os = "windows")]
pub fn windows_appcontainer_helper_exit_code() -> Option<i32> {
    windows_appcontainer::helper_exit_code()
}
mod sidecar;

use rusqlite::{
    params_from_iter, types::Value as SqlValue, Connection, OptionalExtension, Transaction,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use sysinfo::{Disks, Pid, ProcessesToUpdate, System};
use tauri::{AppHandle, Manager, State};
use tree_sitter::{Language, Node, Parser};

const DATABASE_FILE: &str = "codeflow.sqlite3";
const DATABASE_SCHEMA_VERSION: u32 = 5;
const MAX_RUNTIME_HISTORY_ROWS: i64 = 1_500;
const MAX_FORMAL_HISTORY_ROWS: i64 = 3_000;
const MAX_WRITER_EVENT_ROWS: i64 = 1_000;
const MAX_NATIVE_DATABASE_BYTES: u64 = 1024 * 1024 * 1024;
const TEMP_CACHE_DIRECTORIES: &[&str] = &[
    "controlled-runtime",
    "debug-sessions",
    "formal-verification",
    "project-smt",
];

#[tauri::command]
fn codeflow_save_report_pdf(
    _app: AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    if bytes.len() < 8 || !bytes.starts_with(b"%PDF-") {
        return Err("report payload is not a PDF".to_string());
    }
    if bytes.len() > 50 * 1024 * 1024 {
        return Err("report PDF exceeds the 50 MB local export limit".to_string());
    }
    let safe_name: String = file_name
        .chars()
        .map(|character| if matches!(character, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '-' } else { character })
        .collect();
    let safe_name = if safe_name.trim().is_empty() {
        "CodeFlow-Report.pdf".to_string()
    } else if safe_name.to_ascii_lowercase().ends_with(".pdf") {
        safe_name
    } else {
        format!("{safe_name}.pdf")
    };
    let destination = rfd::FileDialog::new()
        .set_title("Save CodeFlow PDF report")
        .set_file_name(&safe_name)
        .add_filter("PDF report", &["pdf"])
        .save_file()
        .ok_or_else(|| "REPORT_SAVE_CANCELLED".to_string())?;
    let destination = if destination.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("pdf")).unwrap_or(false) {
        destination
    } else {
        destination.with_extension("pdf")
    };
    let temporary = destination.with_extension("pdf.tmp");
    fs::write(&temporary, bytes)
        .map_err(|error| format!("failed to write report PDF: {error}"))?;
    fs::rename(&temporary, &destination)
        .map_err(|error| format!("failed to finalize report PDF: {error}"))?;
    Ok(destination.to_string_lossy().to_string())
}

struct DebugSessionManager {
    registry: Mutex<debug::DebugSessionRegistry>,
    live: Mutex<BTreeMap<String, LiveDebugSession>>,
}

impl Default for DebugSessionManager {
    fn default() -> Self {
        Self {
            registry: Mutex::new(debug::DebugSessionRegistry::default()),
            live: Mutex::new(BTreeMap::new()),
        }
    }
}

enum LiveDapClient {
    Stdio(debug::DapProcess),
    Tcp(debug::DapTcpProcess),
}

impl LiveDapClient {
    fn request(
        &mut self,
        command: &str,
        arguments: Option<Value>,
    ) -> Result<debug::DapResponse, String> {
        match self {
            Self::Stdio(client) => client.request(command, arguments, Duration::from_secs(15)),
            Self::Tcp(client) => client.request(command, arguments),
        }
    }
    fn send_request(&mut self, command: &str, arguments: Option<Value>) -> Result<u64, String> {
        match self {
            Self::Stdio(client) => client.send_request(command, arguments),
            Self::Tcp(client) => client.send_request(command, arguments),
        }
    }
    fn wait_response(
        &mut self,
        sequence: u64,
        command: &str,
    ) -> Result<debug::DapResponse, String> {
        match self {
            Self::Stdio(client) => client.wait_response(sequence, command, Duration::from_secs(15)),
            Self::Tcp(client) => client.wait_response(sequence, command),
        }
    }
    fn wait_event(&mut self, event: &str) -> Result<debug::DapEvent, String> {
        match self {
            Self::Stdio(client) => client.wait_event(event, Duration::from_secs(15)),
            Self::Tcp(client) => client.wait_event(event),
        }
    }
    fn wait_event_any(&mut self, events: &[&str]) -> Result<debug::DapEvent, String> {
        match self {
            Self::Stdio(client) => client.wait_event_any(events, Duration::from_secs(30)),
            Self::Tcp(client) => client.wait_event_any(events),
        }
    }
}

struct LiveDebugSession {
    dap: LiveDapClient,
    _parent_dap: Option<debug::DapTcpProcess>,
    _java_host: Option<lsp::JavaDebugHost>,
    auxiliary_children: Vec<Child>,
    root: PathBuf,
}

impl Drop for LiveDebugSession {
    fn drop(&mut self) {
        for child in &mut self.auxiliary_children {
            let _ = child.kill();
            let _ = child.wait();
        }
        let _ = fs::remove_dir_all(&self.root);
    }
}
const KNOWN_TABLES: &[&str] = &[
    "knowledge_sources",
    "knowledge_pack_versions",
    "knowledge_raw_artifacts",
    "knowledge_records",
    "knowledge_validation_runs",
    "knowledge_pack_state",
    "knowledge_pack_events",
    "network_policy_events",
    "workspace_projects",
    "workspace_project_files",
    "workspace_project_state",
    "workspace_project_events",
    "workspace_project_storage_engines",
    "analysis_runs",
    "project_files",
    "project_functions",
    "call_edges",
    "flow_nodes",
    "flow_edges",
    "digital_twin_experiments",
    "digital_twin_variants",
    "program_verification_runs",
    "verification_obligations",
    "verified_repair_candidates",
    "repair_verification_gates",
    "formal_verification_runs",
    "runtime_execution_runs",
    "security_attack_corpora",
    "security_attack_cases",
    "security_assertion_runs",
    "deepweb_replay_memory_snapshots",
    "deepweb_replay_comparisons",
    "deepweb_replay_promotion_decisions",
    "deepweb_model_versions",
    "deepweb_trainable_head_runs",
    "deepweb_feature_vectors",
    "deepweb_inference_runs",
    "deepweb_validation_evidence",
    "deepweb_extreme_test_runs",
    "deepweb_irrigation_runs",
    "deepweb_irrigation_evidence",
    "deepweb_irrigation_epochs",
    "deepweb_weight_update_events",
    "deepweb_supervision_labels",
    "deepweb_supervised_assignments",
    "deepweb_teacher_reliability",
    "deepweb_quarantined_labels",
    "deepweb_label_centroids",
    "deepweb_contrastive_pairs",
    "deepweb_self_supervised_epochs",
    "deepweb_supervised_epochs",
    "deepweb_rollback_snapshots",
    "deepweb_error_signals",
    "deepweb_gene_pool",
    "deepweb_genome_generations",
    "deepweb_gene_expression",
    "deepweb_fitness_scores",
    "deepweb_local_sqlite_journal",
    "deepweb_local_storage_engines",
    "native_sqlite_writes",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeSqliteRow {
    table_name: String,
    primary_key: String,
    payload: Value,
    #[serde(rename = "sqlText")]
    _sql_text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeSqliteReport {
    status: String,
    engine_kind: String,
    storage_mode: String,
    writer_kind: String,
    row_count: usize,
    table_count: usize,
    database_path: String,
    last_synced_at: u128,
    evidence: String,
    next: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SecurityCorpusHistoryReport {
    project_count: usize,
    framework_count: usize,
    replay_span_days: u64,
    replay_count: usize,
    minimum_case_replay_count: usize,
    conclusive_rate: u32,
    stable_teacher_eligible: bool,
    evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FormalVerificationRecord {
    id: String,
    project_id: String,
    obligation_id: String,
    title: String,
    status: String,
    solver: String,
    solver_version: String,
    formula_hash: String,
    formula: String,
    result: String,
    duration_ms: u128,
    sandbox_status: String,
    evidence: Vec<String>,
    created_at: u128,
    file_name: Option<String>,
    function_id: Option<String>,
    line: Option<usize>,
    counterexample: Option<String>,
    call_chain: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSmtBatchRequest {
    project_id: String,
    obligations: Vec<ProjectSmtObligation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSmtObligation {
    obligation_id: String,
    title: String,
    file_name: String,
    function_id: String,
    line: usize,
    formula: String,
    #[serde(default)]
    call_chain: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeWorkspaceFile {
    id: String,
    name: String,
    language: String,
    content: String,
    size: u64,
    hash: String,
    last_modified: Option<u128>,
    imports: Vec<String>,
    environment_refs: Vec<String>,
    device_refs: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeWorkspaceProject {
    id: String,
    name: String,
    files: Vec<NativeWorkspaceFile>,
    source: String,
    created_at: u128,
    updated_at: u128,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeWorkspacePayload {
    version: u8,
    projects: Vec<NativeWorkspaceProject>,
    active_project_id: Option<String>,
    saved_at: u128,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeepWebModelBaseline {
    id: String,
    status: String,
    feature_schema_version: String,
    weights: Value,
    network_parameters: Option<Value>,
    selected_genome_id: String,
    trust_score: f64,
    consensus_rate: f64,
    fitness_score: f64,
    regression_risk_score: f64,
    checksum: String,
    created_at: u128,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlledRuntimeFile {
    path: String,
    content: String,
    language: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlledRuntimeRequest {
    project_id: String,
    project_name: String,
    adapter: String,
    entry_path: String,
    files: Vec<ControlledRuntimeFile>,
    args: Vec<String>,
    stdin: String,
    timeout_ms: u64,
    max_output_bytes: usize,
    #[serde(default = "default_experiment_kind")]
    experiment_kind: String,
    #[serde(default = "default_sample_id")]
    sample_id: String,
    #[serde(default = "default_repetition")]
    repetition: usize,
    #[serde(default)]
    breakpoints: Vec<ControlledRuntimeBreakpoint>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlledRuntimeBreakpoint {
    path: String,
    line: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DebugCreateSessionRequest {
    project_id: String,
    adapter: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DebugSetBreakpointsRequest {
    session_id: String,
    source: DebugSourceRequest,
    breakpoints: Vec<DebugBreakpointRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DebugSourceRequest {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DebugBreakpointRequest {
    line: usize,
    condition: Option<String>,
    hit_condition: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DebugLaunchRequest {
    session_id: String,
    entry_path: String,
    files: Vec<ControlledRuntimeFile>,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    environment: BTreeMap<String, String>,
    #[serde(default)]
    stop_on_entry: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DebugThreadRequest {
    session_id: String,
    thread_id: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DebugDisconnectRequest {
    session_id: String,
    #[serde(default)]
    terminate_debuggee: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DebugAdapterAvailability {
    adapter: String,
    backend: String,
    available: bool,
    verified: bool,
    version: String,
    executable_path: String,
    evidence: String,
    optional: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DebugAvailabilityReport {
    status: String,
    available_count: usize,
    total_count: usize,
    adapters: Vec<DebugAdapterAvailability>,
    evidence: Vec<String>,
}

fn default_experiment_kind() -> String {
    "baseline".to_string()
}
fn default_sample_id() -> String {
    "baseline-user-input".to_string()
}
fn default_repetition() -> usize {
    1
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AstControlNodeFact {
    id: String,
    kind: String,
    start_line: usize,
    end_line: usize,
    definitions: Vec<String>,
    uses: Vec<String>,
    ownership_events: Vec<String>,
    concurrency_events: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AstControlEdgeFact {
    from: String,
    to: String,
    kind: String,
    condition: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AstFunctionFact {
    id: String,
    name: String,
    short_name: String,
    file_name: String,
    language: String,
    start_line: usize,
    name_line: usize,
    name_column: usize,
    end_line: usize,
    params: Vec<String>,
    return_type: String,
    calls: Vec<String>,
    complexity: usize,
    branch_count: usize,
    loop_count: usize,
    return_count: usize,
    write_count: usize,
    control_nodes: Vec<AstControlNodeFact>,
    control_edges: Vec<AstControlEdgeFact>,
    confidence: u8,
    evidence: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AstLanguageCoverage {
    language: String,
    file_count: usize,
    parsed_file_count: usize,
    function_count: usize,
    diagnostic_count: usize,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AstEdgeFact {
    from: String,
    to: String,
    confidence: u8,
    evidence: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AstMacroFact {
    id: String,
    name: String,
    file_name: String,
    language: String,
    line: usize,
    column: usize,
    confidence: u8,
    evidence: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AstParserDiagnostic {
    file_name: String,
    severity: String,
    message: String,
    evidence: String,
    line: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AstWorkspaceReport {
    adapter_name: String,
    function_count: usize,
    edge_count: usize,
    macro_count: usize,
    parsed_file_count: usize,
    parsed_files: Vec<String>,
    unsupported_files: Vec<String>,
    language_coverage: Vec<AstLanguageCoverage>,
    functions: Vec<AstFunctionFact>,
    edges: Vec<AstEdgeFact>,
    macro_sites: Vec<AstMacroFact>,
    diagnostics: Vec<AstParserDiagnostic>,
    evidence: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlledRuntimeTool {
    adapter: String,
    label: String,
    available: bool,
    command: String,
    version: String,
    evidence: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlledRuntimeExtensionSlot {
    id: String,
    label: String,
    status: String,
    required_contracts: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlledRuntimeAvailabilityReport {
    status: String,
    tools: Vec<ControlledRuntimeTool>,
    available_count: usize,
    total_count: usize,
    evidence: String,
    safety_boundary: Vec<String>,
    extension_slots: Vec<ControlledRuntimeExtensionSlot>,
}

#[derive(Clone, Copy)]
struct RuntimeAdapterDefinition {
    id: &'static str,
    label: &'static str,
    probe_command: &'static str,
}

const BUILTIN_RUNTIME_ADAPTERS: [RuntimeAdapterDefinition; 6] = [
    RuntimeAdapterDefinition { id: "node", label: "Node.js", probe_command: "node" },
    RuntimeAdapterDefinition { id: "python", label: "Python", probe_command: "python3" },
    RuntimeAdapterDefinition { id: "rust", label: "Rust / Cargo", probe_command: "cargo" },
    RuntimeAdapterDefinition { id: "java", label: "Java / JVM", probe_command: "java" },
    RuntimeAdapterDefinition { id: "c", label: "C", probe_command: "cc" },
    RuntimeAdapterDefinition { id: "cpp", label: "C++", probe_command: "c++" },
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlledRuntimeExecutionReport {
    id: String,
    project_id: String,
    project_name: String,
    adapter: String,
    status: String,
    evidence_grade: String,
    experiment_kind: String,
    sample_id: String,
    repetition: usize,
    input_bytes: usize,
    trace_events: Vec<RuntimeTraceEvent>,
    trace_source: String,
    sanitizer_status: String,
    sanitizer_findings: Vec<String>,
    entry_path: String,
    command_label: String,
    exit_code: Option<i32>,
    timed_out: bool,
    duration_ms: u128,
    stdout: String,
    stderr: String,
    stdout_truncated: bool,
    stderr_truncated: bool,
    compile_output: String,
    file_count: usize,
    total_bytes: usize,
    started_at: u128,
    finished_at: u128,
    database_path: String,
    sandbox_kind: String,
    sandbox_status: String,
    sandbox_evidence: String,
    cpu_time_ms: u128,
    peak_memory_bytes: u64,
    child_process_count: usize,
    child_processes: Vec<ObservedProcess>,
    file_changes: Vec<FileChange>,
    isolation: Vec<String>,
    evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeTraceEvent {
    function_name: String,
    event: String,
    #[serde(default)]
    data_names: Vec<String>,
    from: Option<String>,
    to: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ObservedProcess {
    pid: u32,
    parent_pid: Option<u32>,
    name: String,
    cpu_time_ms: u128,
    peak_memory_bytes: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct FileChange {
    path: String,
    kind: String,
    before_bytes: Option<u64>,
    after_bytes: Option<u64>,
}

#[derive(Debug, Clone)]
struct FileFingerprint {
    bytes: u64,
    modified_ns: u128,
}

#[derive(Debug, Clone)]
struct SandboxPlan {
    kind: String,
    status: String,
    evidence: String,
    command: String,
    args: Vec<String>,
}

struct ProcessOutcome {
    exit_code: Option<i32>,
    timed_out: bool,
    duration_ms: u128,
    stdout: String,
    stderr: String,
    stdout_truncated: bool,
    stderr_truncated: bool,
    sandbox_kind: String,
    sandbox_status: String,
    sandbox_evidence: String,
    cpu_time_ms: u128,
    peak_memory_bytes: u64,
    child_processes: Vec<ObservedProcess>,
    file_changes: Vec<FileChange>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemCapacityReport {
    status: String,
    platform: String,
    logical_cpu_count: usize,
    total_memory_bytes: u64,
    available_memory_bytes: u64,
    total_disk_bytes: u64,
    available_disk_bytes: u64,
    evidence: Vec<String>,
}

#[tauri::command]
fn codeflow_system_capacity(app: AppHandle) -> Result<SystemCapacityReport, String> {
    let mut system = System::new_all();
    system.refresh_memory();
    let logical_cpu_count = system.cpus().len().max(
        thread::available_parallelism()
            .map(|value| value.get())
            .unwrap_or(1),
    );
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to locate local application data: {error}"))?;
    let disks = Disks::new_with_refreshed_list();
    let disk = disks
        .list()
        .iter()
        .filter(|disk| app_data.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().as_os_str().len())
        .or_else(|| disks.list().iter().max_by_key(|disk| disk.total_space()));
    let (total_disk_bytes, available_disk_bytes, disk_evidence) = disk
        .map(|disk| {
            (
                disk.total_space(),
                disk.available_space(),
                format!(
                    "local data volume {} · {} bytes available",
                    disk.mount_point().display(),
                    disk.available_space()
                ),
            )
        })
        .unwrap_or((0, 0, "local data volume was not detected".to_string()));
    Ok(SystemCapacityReport {
        status: "native".to_string(),
        platform: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        logical_cpu_count,
        total_memory_bytes: system.total_memory(),
        available_memory_bytes: system.available_memory(),
        total_disk_bytes,
        available_disk_bytes,
        evidence: vec![
            format!(
                "sysinfo local probe · {} logical CPUs · {} bytes memory available",
                logical_cpu_count,
                system.available_memory()
            ),
            disk_evidence,
            "read-only capacity probe; no project data or host identifier leaves the device"
                .to_string(),
        ],
    })
}

#[tauri::command]
fn codeflow_native_sqlite_status(app: AppHandle) -> Result<NativeSqliteReport, String> {
    with_database(&app, |conn, db_path| {
        Ok(report(
            "warming",
            "bundle",
            0,
            count_known_tables(conn)?,
            db_path,
            "native SQLite database is ready for project, DeepWeb and code-index writers",
        ))
    })
}

#[tauri::command]
fn codeflow_deepweb_model_baseline(app: AppHandle) -> Result<Option<DeepWebModelBaseline>, String> {
    with_database(&app, |conn, _| {
        conn.query_row(
            "SELECT id, status, feature_schema_version, weights, network_parameters, selected_genome_id,
                    trust_score, consensus_rate, fitness_score, regression_risk_score, checksum, created_at
             FROM deepweb_model_versions
             WHERE status = 'stable'
             ORDER BY created_at DESC
             LIMIT 1",
            [],
            |row| {
                let weights: String = row.get(3)?;
                Ok(DeepWebModelBaseline {
                    id: row.get(0)?,
                    status: row.get(1)?,
                    feature_schema_version: row.get(2)?,
                    weights: serde_json::from_str(&weights).unwrap_or_else(|_| serde_json::json!({})),
                    network_parameters: row
                        .get::<_, Option<String>>(4)?
                        .and_then(|value| serde_json::from_str(&value).ok()),
                    selected_genome_id: row.get(5)?,
                    trust_score: row.get(6)?,
                    consensus_rate: row.get(7)?,
                    fitness_score: row.get(8)?,
                    regression_risk_score: row.get(9)?,
                    checksum: row.get(10)?,
                    created_at: row.get::<_, i64>(11)?.max(0) as u128,
                })
            },
        )
        .optional()
        .map_err(|error| format!("failed to load stable DeepWeb model baseline: {error}"))
    })
}

#[tauri::command]
fn codeflow_load_workspace_projects(
    app: AppHandle,
) -> Result<Option<NativeWorkspacePayload>, String> {
    with_database(&app, |conn, _| load_workspace_snapshot(conn))
}

#[tauri::command]
fn codeflow_sync_workspace_projects(
    app: AppHandle,
    rows: Vec<NativeSqliteRow>,
) -> Result<NativeSqliteReport, String> {
    if rows.is_empty() {
        return with_database(&app, |conn, db_path| {
            Ok(report(
                "warming",
                "workspace_projects",
                0,
                count_known_tables(conn)?,
                db_path,
                "no rows were provided to the native SQLite workspace writer",
            ))
        });
    }
    with_database(&app, |conn, db_path| {
        replace_workspace_rows(conn, &rows)?;
        record_writer_event(conn, "workspace_projects", rows.len(), &db_path)?;
        Ok(report(
            "synced",
            "workspace_projects",
            rows.len(),
            count_known_tables(conn)?,
            db_path,
            &format!(
                "native SQLite workspace snapshot replaced with {} rows",
                rows.len()
            ),
        ))
    })
}

#[tauri::command]
fn codeflow_sync_deepweb_journal(
    app: AppHandle,
    rows: Vec<NativeSqliteRow>,
) -> Result<NativeSqliteReport, String> {
    sync_rows(app, "deepweb_journal", rows)
}

#[tauri::command]
fn codeflow_sync_code_index(
    app: AppHandle,
    rows: Vec<NativeSqliteRow>,
) -> Result<NativeSqliteReport, String> {
    sync_rows(app, "code_index", rows)
}

#[tauri::command]
fn codeflow_clear_native_database(app: AppHandle) -> Result<NativeSqliteReport, String> {
    let db_path = database_path(&app)?;
    for path in database_files(&db_path) {
        if path.exists() {
            fs::remove_file(&path).map_err(|error| {
                format!(
                    "failed to remove native SQLite file {}: {error}",
                    path.display()
                )
            })?;
        }
    }
    Ok(report(
        "warming",
        "bundle",
        0,
        0,
        db_path,
        "native SQLite database file cleared; it will be recreated on the next sync",
    ))
}

#[tauri::command]
fn codeflow_parse_workspace_ast(files: Vec<ControlledRuntimeFile>) -> AstWorkspaceReport {
    let mut functions = Vec::new();
    let mut diagnostics = Vec::new();
    let mut unsupported_files = Vec::new();
    let mut parsed_files = Vec::new();
    let mut parsed_file_count = 0;
    let mut macro_sites = Vec::new();

    for file in &files {
        let Some(language) = ast_language_for(&file.language, &file.path) else {
            unsupported_files.push(file.path.clone());
            continue;
        };
        let mut parser = Parser::new();
        if let Err(error) = parser.set_language(&language) {
            diagnostics.push(AstParserDiagnostic {
                file_name: file.path.clone(),
                severity: "Risk".to_string(),
                message: "Tree-sitter grammar could not be loaded.".to_string(),
                evidence: error.to_string(),
                line: 1,
            });
            continue;
        }
        let Some(tree) = parser.parse(&file.content, None) else {
            diagnostics.push(AstParserDiagnostic {
                file_name: file.path.clone(),
                severity: "Risk".to_string(),
                message: "Tree-sitter returned no syntax tree.".to_string(),
                evidence: file.language.clone(),
                line: 1,
            });
            continue;
        };
        parsed_file_count += 1;
        parsed_files.push(file.path.clone());
        collect_ast_functions(
            tree.root_node(),
            file,
            file.content.as_bytes(),
            &mut functions,
        );
        collect_ast_macro_sites(
            tree.root_node(),
            file,
            file.content.as_bytes(),
            &mut macro_sites,
        );
        collect_ast_errors(
            tree.root_node(),
            file,
            file.content.as_bytes(),
            &mut diagnostics,
        );
    }

    let edges = build_ast_edges(&functions);
    let language_coverage =
        build_ast_language_coverage(&files, &parsed_files, &functions, &diagnostics);
    AstWorkspaceReport {
        adapter_name: "TauriTreeSitterWorkspaceParser".to_string(),
        function_count: functions.len(),
        edge_count: edges.len(),
        macro_count: macro_sites.len(),
        parsed_file_count,
        parsed_files,
        unsupported_files,
        language_coverage,
        evidence: vec![
            format!(
                "{parsed_file_count}/{} files parsed into concrete syntax trees.",
                files.len()
            ),
            format!(
                "{} function/method facts extracted from grammar nodes.",
                functions.len()
            ),
            format!("{} call edges resolved from AST call nodes.", edges.len()),
            format!(
                "{} Rust/C/C++ macro sites prepared for language-server semantic expansion.",
                macro_sites.len()
            ),
            "No remote model API and no regex function-boundary inference.".to_string(),
        ],
        functions,
        edges,
        macro_sites,
        diagnostics,
    }
}

#[tauri::command]
fn codeflow_parse_typescript_compiler(
    app: AppHandle,
    files: Vec<ControlledRuntimeFile>,
) -> Result<Value, String> {
    let source_files = files
        .into_iter()
        .filter(|file| {
            matches!(file.language.as_str(), "TypeScript" | "JavaScript")
                || matches!(
                    Path::new(&file.path)
                        .extension()
                        .and_then(|value| value.to_str())
                        .unwrap_or_default()
                        .to_ascii_lowercase()
                        .as_str(),
                    "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs"
                )
        })
        .collect::<Vec<_>>();
    if source_files.is_empty() {
        return Ok(serde_json::json!({
            "adapterName": "NodeTypeScriptServiceAdapter",
            "mode": "Compiler API",
            "status": "skipped",
            "functionCount": 0,
            "edgeCount": 0,
            "diagnosticCount": 0,
            "functions": [],
            "edges": [],
            "diagnostics": [],
            "evidence": ["current project has no TypeScript/JavaScript files"]
        }));
    }
    let roots = sidecar::roots_from_app(&app);
    let packaged_node =
        sidecar::resolve_verified_package_file("pyright", "runtime/node/bin/node", &roots);
    let (node, runtime_source) = packaged_node
        .map(|runtime| {
            (
                runtime.path,
                format!("{} checksum-verified Node runtime", runtime.source),
            )
        })
        .or_else(|| {
            sidecar::resolve_system("node")
                .map(|path| (path, "unbundled system Node runtime".to_string()))
        })
        .ok_or_else(|| {
            "TypeScript Compiler requires a controlled local Node runtime".to_string()
        })?;
    let worker = typescript_worker_path(&app)?;
    let root = std::env::temp_dir().join(format!(
        "codeflow-ts-compiler-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    fs::create_dir_all(&root)
        .map_err(|error| format!("failed to create TypeScript Compiler workspace: {error}"))?;
    let sandbox_worker = stage_typescript_compiler_package(&worker, &root)?;
    let payload = serde_json::to_string(&serde_json::json!({
        "files": source_files.iter().map(|file| serde_json::json!({
            "name": file.path,
            "content": file.content,
            "language": file.language,
        })).collect::<Vec<_>>(),
        "options": {}
    }))
    .map_err(|error| format!("failed to encode TypeScript Compiler input: {error}"))?;
    let result = run_process(
        &node.to_string_lossy(),
        &[sandbox_worker.to_string_lossy().to_string()],
        &root,
        &payload,
        12_000,
        8 * 1024 * 1024,
        "typescript-compiler",
    );
    let _ = fs::remove_dir_all(&root);
    let outcome = result?;
    let envelope: Value = serde_json::from_str(&outcome.stdout).map_err(|error| {
        format!(
            "TypeScript Compiler returned invalid JSON: {error}; stderr={}",
            outcome.stderr.chars().take(500).collect::<String>()
        )
    })?;
    if !envelope.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        return Err(envelope
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("TypeScript Compiler worker failed")
            .to_string());
    }
    let mut report = envelope.get("report").cloned().unwrap_or(Value::Null);
    if let Some(object) = report.as_object_mut() {
        object.insert("status".to_string(), Value::String("executed".to_string()));
        object.insert(
            "transport".to_string(),
            Value::String(format!("Tauri controlled Node worker; {runtime_source}")),
        );
        object.insert(
            "sandboxStatus".to_string(),
            Value::String(outcome.sandbox_status),
        );
        object.insert(
            "durationMs".to_string(),
            Value::Number((outcome.duration_ms as u64).into()),
        );
    }
    Ok(report)
}

fn typescript_worker_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("parser-sidecars/node-typescript-worker.mjs"));
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../src/lib/parser/node-typescript-worker.mjs"),
    );
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| "bundled TypeScript Compiler worker is missing".to_string())
}

fn stage_typescript_compiler_package(worker: &Path, root: &Path) -> Result<PathBuf, String> {
    let worker_parent = worker
        .parent()
        .ok_or_else(|| "TypeScript Compiler worker has no parent directory".to_string())?;
    let sandbox_worker = root.join("codeflow-typescript-worker.mjs");
    fs::copy(worker, &sandbox_worker)
        .map_err(|error| format!("failed to stage TypeScript Compiler worker: {error}"))?;
    fs::copy(
        worker_parent.join("node-typescript-service.mjs"),
        root.join("node-typescript-service.mjs"),
    )
    .map_err(|error| format!("failed to stage TypeScript Compiler service: {error}"))?;
    let typescript = worker
        .ancestors()
        .map(|ancestor| ancestor.join("node_modules/typescript"))
        .find(|candidate| candidate.is_dir())
        .ok_or_else(|| "bundled TypeScript package is missing".to_string())?;
    stage_readonly_tree(&typescript, &root.join("node_modules/typescript"))?;
    Ok(sandbox_worker)
}

fn stage_readonly_tree(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("failed to create staged package directory: {error}"))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("failed to read staged package directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("failed to inspect staged package: {error}"))?;
        let target = destination.join(entry.file_name());
        if entry.path().is_dir() {
            stage_readonly_tree(&entry.path(), &target)?;
        } else if fs::hard_link(entry.path(), &target).is_err() {
            fs::copy(entry.path(), &target)
                .map_err(|error| format!("failed to stage package file: {error}"))?;
        }
    }
    Ok(())
}

fn collect_ast_macro_sites(
    node: Node<'_>,
    file: &ControlledRuntimeFile,
    source: &[u8],
    output: &mut Vec<AstMacroFact>,
) {
    let language = file.language.to_ascii_lowercase();
    let direct_macro = matches!(
        node.kind(),
        "macro_invocation" | "preproc_call" | "preproc_function_def"
    );
    let c_family_candidate = matches!(language.as_str(), "c" | "c++" | "c/c++")
        && node.kind() == "call_expression"
        && node
            .child_by_field_name("function")
            .and_then(|value| ast_node_text(value, source))
            .is_some_and(|name| {
                name.chars().any(|character| character.is_ascii_uppercase())
                    && name.chars().all(|character| {
                        character.is_ascii_uppercase()
                            || character.is_ascii_digit()
                            || character == '_'
                    })
            });
    if direct_macro || c_family_candidate {
        let name_node = node
            .child_by_field_name("macro")
            .or_else(|| node.child_by_field_name("name"))
            .or_else(|| node.child_by_field_name("function"))
            .or_else(|| node.named_child(0))
            .unwrap_or(node);
        let name = ast_node_text(name_node, source)
            .unwrap_or_else(|| format!("<macro@{}>", node.start_position().row + 1));
        let position = name_node.start_position();
        let id = format!(
            "macro:{}:{}:{}:{}",
            safe_identifier(&file.path),
            safe_identifier(&name),
            position.row,
            position.column
        );
        if !output.iter().any(|item| item.id == id) {
            output.push(AstMacroFact {
                id,
                name,
                file_name: file.path.clone(),
                language: file.language.clone(),
                line: position.row,
                column: position.column,
                confidence: if direct_macro { 94 } else { 76 },
                evidence: if direct_macro {
                    format!("Tree-sitter {} macro node", node.kind())
                } else {
                    "C/C++ uppercase call candidate; clangd AST must confirm macro semantics"
                        .to_string()
                },
            });
        }
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        collect_ast_macro_sites(child, file, source, output);
    }
}

#[tauri::command]
fn codeflow_lsp_availability(app: AppHandle) -> lsp::LspWorkspaceReport {
    let roots = sidecar::roots_from_app(&app);
    lsp::availability(&roots)
}

#[tauri::command]
fn codeflow_parse_workspace_lsp(
    app: AppHandle,
    request: lsp::LspWorkspaceRequest,
) -> lsp::LspWorkspaceReport {
    let roots = sidecar::roots_from_app(&app);
    lsp::analyze(request, &roots)
}

#[tauri::command]
fn codeflow_lsp_sidecar_status(app: AppHandle) -> sidecar::SidecarStatusReport {
    sidecar::status(&app)
}

#[tauri::command]
fn codeflow_set_lsp_sidecar_enabled(
    app: AppHandle,
    tool_id: String,
    enabled: bool,
) -> Result<sidecar::SidecarStatusReport, String> {
    sidecar::set_enabled(&app, &tool_id, enabled)
}

fn ast_language_for(language: &str, path: &str) -> Option<Language> {
    let lower = language.to_ascii_lowercase();
    let path = path.to_ascii_lowercase();
    if path.ends_with(".tsx") {
        return Some(tree_sitter_typescript::LANGUAGE_TSX.into());
    }
    if lower.contains("typescript") || path.ends_with(".ts") {
        return Some(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into());
    }
    if lower.contains("javascript")
        || path.ends_with(".js")
        || path.ends_with(".mjs")
        || path.ends_with(".cjs")
    {
        return Some(tree_sitter_javascript::LANGUAGE.into());
    }
    if lower == "python" || path.ends_with(".py") {
        return Some(tree_sitter_python::LANGUAGE.into());
    }
    if lower == "rust" || path.ends_with(".rs") {
        return Some(tree_sitter_rust::LANGUAGE.into());
    }
    if lower == "java" || path.ends_with(".java") {
        return Some(tree_sitter_java::LANGUAGE.into());
    }
    if lower == "kotlin" || path.ends_with(".kt") || path.ends_with(".kts") {
        return Some(tree_sitter_kotlin_sqry::language());
    }
    if lower == "c#" || path.ends_with(".cs") {
        return Some(tree_sitter_c_sharp::LANGUAGE.into());
    }
    if lower == "c++"
        || path.ends_with(".cpp")
        || path.ends_with(".cc")
        || path.ends_with(".cxx")
        || path.ends_with(".hpp")
    {
        return Some(tree_sitter_cpp::LANGUAGE.into());
    }
    if lower == "c" || path.ends_with(".c") || path.ends_with(".h") {
        return Some(tree_sitter_c::LANGUAGE.into());
    }
    if lower == "go" || path.ends_with(".go") {
        return Some(tree_sitter_go::LANGUAGE.into());
    }
    if lower == "ruby" || path.ends_with(".rb") {
        return Some(tree_sitter_ruby::LANGUAGE.into());
    }
    if lower == "php" || path.ends_with(".php") {
        return Some(tree_sitter_php::LANGUAGE_PHP.into());
    }
    if lower == "swift" || path.ends_with(".swift") {
        return Some(tree_sitter_swift::LANGUAGE.into());
    }
    if lower == "shell"
        || path.ends_with(".sh")
        || path.ends_with(".bash")
        || path.ends_with(".zsh")
    {
        return Some(tree_sitter_bash::LANGUAGE.into());
    }
    if lower == "sql" || path.ends_with(".sql") {
        return Some(tree_sitter_sequel::LANGUAGE.into());
    }
    None
}

fn collect_ast_functions(
    node: Node<'_>,
    file: &ControlledRuntimeFile,
    source: &[u8],
    output: &mut Vec<AstFunctionFact>,
) {
    if is_ast_function_kind(node.kind()) {
        let start_line = node.start_position().row + 1;
        let end_line = node.end_position().row + 1;
        let name_node = ast_function_name_node(node);
        let name = name_node
            .and_then(|value| ast_node_text(value, source))
            .unwrap_or_else(|| format!("<anonymous@{start_line}>"));
        let name_position = name_node
            .map(|value| value.start_position())
            .unwrap_or_else(|| node.start_position());
        let params = node
            .child_by_field_name("parameters")
            .or_else(|| node.child_by_field_name("parameter"))
            .and_then(|value| ast_node_text(value, source))
            .map(|value| split_ast_parameters(&value))
            .unwrap_or_default();
        let return_type = ["return_type", "type", "result"]
            .iter()
            .find_map(|field| node.child_by_field_name(field))
            .and_then(|value| ast_node_text(value, source))
            .unwrap_or_else(|| {
                if matches!(
                    file.language.as_str(),
                    "Python" | "JavaScript" | "TypeScript" | "Ruby" | "PHP"
                ) {
                    "inferred".to_string()
                } else {
                    "unknown".to_string()
                }
            });
        let mut calls = BTreeSet::new();
        collect_ast_calls(node, node.id(), source, &mut calls);
        let metrics = collect_ast_control_metrics(node, node.id());
        let id = format!("ast:{}:{}:{start_line}", safe_identifier(&file.path), name);
        let (control_nodes, control_edges) = build_ast_control_flow(node, source, &id);
        output.push(AstFunctionFact {
            id,
            short_name: name
                .split(['.', ':'])
                .filter(|part| !part.is_empty())
                .next_back()
                .unwrap_or(&name)
                .to_string(),
            name,
            file_name: file.path.clone(),
            language: file.language.clone(),
            start_line,
            name_line: name_position.row,
            name_column: name_position.column,
            end_line,
            params,
            return_type,
            calls: calls.into_iter().collect(),
            complexity: 1 + metrics.branches + metrics.loops,
            branch_count: metrics.branches,
            loop_count: metrics.loops,
            return_count: metrics.returns,
            write_count: metrics.writes,
            control_nodes,
            control_edges,
            confidence: if node.has_error() { 82 } else { 94 },
            evidence: vec![
                format!("Tree-sitter node kind {}", node.kind()),
                format!(
                    "byte range {}..{}; grammar {}",
                    node.start_byte(),
                    node.end_byte(),
                    file.language
                ),
                "AST function boundary".to_string(),
                "AST parameter and call extraction".to_string(),
                format!(
                    "AST control facts: {} branches, {} loops, {} returns, {} writes",
                    metrics.branches, metrics.loops, metrics.returns, metrics.writes
                ),
            ],
        });
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_ast_functions(child, file, source, output);
    }
}

fn build_ast_control_flow(
    function: Node<'_>,
    source: &[u8],
    function_id: &str,
) -> (Vec<AstControlNodeFact>, Vec<AstControlEdgeFact>) {
    let mut nodes = vec![AstControlNodeFact {
        id: format!("{function_id}:entry"),
        kind: "entry".to_string(),
        start_line: function.start_position().row + 1,
        end_line: function.start_position().row + 1,
        definitions: Vec::new(),
        uses: Vec::new(),
        ownership_events: Vec::new(),
        concurrency_events: Vec::new(),
    }];
    collect_ast_control_nodes(function, function.id(), source, function_id, &mut nodes);
    nodes.sort_by_key(|node| (node.start_line, node.end_line, node.id.clone()));
    let exit_id = format!("{function_id}:exit");
    nodes.push(AstControlNodeFact {
        id: exit_id.clone(),
        kind: "exit".to_string(),
        start_line: function.end_position().row + 1,
        end_line: function.end_position().row + 1,
        definitions: Vec::new(),
        uses: Vec::new(),
        ownership_events: Vec::new(),
        concurrency_events: Vec::new(),
    });
    let mut edges = Vec::new();
    for index in 0..nodes.len().saturating_sub(1) {
        let current = &nodes[index];
        let next = &nodes[index + 1];
        if current.kind != "return" && current.kind != "throw" {
            edges.push(AstControlEdgeFact {
                from: current.id.clone(),
                to: next.id.clone(),
                kind: "normal".to_string(),
                condition: String::new(),
            });
        }
        if current.kind == "branch" && index + 2 < nodes.len() {
            edges.push(AstControlEdgeFact {
                from: current.id.clone(),
                to: nodes[index + 2].id.clone(),
                kind: "false".to_string(),
                condition: "branch-not-taken".to_string(),
            });
        }
        if current.kind == "loop" && index + 1 < nodes.len() - 1 {
            edges.push(AstControlEdgeFact {
                from: nodes[index + 1].id.clone(),
                to: current.id.clone(),
                kind: "back".to_string(),
                condition: "loop-continues".to_string(),
            });
        }
        if current.kind == "return" {
            edges.push(AstControlEdgeFact {
                from: current.id.clone(),
                to: exit_id.clone(),
                kind: "return".to_string(),
                condition: String::new(),
            });
        }
        if current.kind == "throw" {
            let handler = nodes
                .iter()
                .skip(index + 1)
                .find(|node| node.kind == "catch")
                .map(|node| node.id.clone())
                .unwrap_or_else(|| exit_id.clone());
            edges.push(AstControlEdgeFact {
                from: current.id.clone(),
                to: handler,
                kind: "exception".to_string(),
                condition: "exception-raised".to_string(),
            });
        }
    }
    edges.sort_by(|left, right| {
        (&left.from, &left.to, &left.kind).cmp(&(&right.from, &right.to, &right.kind))
    });
    edges.dedup_by(|left, right| {
        left.from == right.from && left.to == right.to && left.kind == right.kind
    });
    (nodes, edges)
}

fn collect_ast_control_nodes(
    node: Node<'_>,
    function_root_id: usize,
    source: &[u8],
    function_id: &str,
    output: &mut Vec<AstControlNodeFact>,
) {
    if node.id() != function_root_id && is_ast_function_kind(node.kind()) {
        return;
    }
    if let Some(kind) = ast_control_kind(node.kind()) {
        let text = ast_node_text(node, source).unwrap_or_default();
        let mut identifiers = BTreeSet::new();
        collect_ast_identifiers(node, source, &mut identifiers);
        let definition = ["left", "name", "declarator"]
            .iter()
            .find_map(|field| node.child_by_field_name(field))
            .and_then(|child| first_ast_identifier(child, source));
        let definitions = definition.into_iter().collect::<Vec<_>>();
        let uses = identifiers
            .into_iter()
            .filter(|name| !definitions.contains(name))
            .collect::<Vec<_>>();
        let lowered = text.to_ascii_lowercase();
        let ownership_events = [
            "open", "acquire", "new ", "close", "free", "release", "drop", "dispose", "unlock",
        ]
        .into_iter()
        .filter(|signal| lowered.contains(signal))
        .map(str::to_string)
        .collect();
        let concurrency_events = [
            "spawn",
            "thread",
            "promise.all",
            "asyncio.gather",
            "mutex",
            "lock",
            "atomic",
            "synchronized",
            "await",
        ]
        .into_iter()
        .filter(|signal| lowered.contains(signal))
        .map(str::to_string)
        .collect();
        output.push(AstControlNodeFact {
            id: format!(
                "{function_id}:node:{}:{}",
                node.start_position().row + 1,
                node.id()
            ),
            kind: kind.to_string(),
            start_line: node.start_position().row + 1,
            end_line: node.end_position().row + 1,
            definitions,
            uses,
            ownership_events,
            concurrency_events,
        });
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        collect_ast_control_nodes(child, function_root_id, source, function_id, output);
    }
}

fn ast_control_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "if_statement"
        | "if_expression"
        | "conditional_expression"
        | "switch_statement"
        | "match_expression" => Some("branch"),
        "for_statement"
        | "for_expression"
        | "enhanced_for_statement"
        | "while_statement"
        | "while_expression"
        | "loop_expression"
        | "do_statement"
        | "foreach_statement" => Some("loop"),
        "return_statement" | "return_expression" => Some("return"),
        "throw_statement" | "raise_statement" => Some("throw"),
        "catch_clause" | "except_clause" => Some("catch"),
        "assignment_expression"
        | "assignment"
        | "augmented_assignment"
        | "variable_declarator"
        | "let_declaration" => Some("assignment"),
        "call_expression" | "method_invocation" | "invocation_expression" | "await_expression" => {
            Some("call")
        }
        _ => None,
    }
}

fn collect_ast_identifiers(node: Node<'_>, source: &[u8], output: &mut BTreeSet<String>) {
    if matches!(
        node.kind(),
        "identifier" | "field_identifier" | "type_identifier"
    ) {
        if let Some(value) = ast_node_text(node, source) {
            output.insert(value);
        }
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        collect_ast_identifiers(child, source, output);
    }
}

fn first_ast_identifier(node: Node<'_>, source: &[u8]) -> Option<String> {
    if matches!(node.kind(), "identifier" | "field_identifier") {
        return ast_node_text(node, source);
    }
    let mut cursor = node.walk();
    let result = node
        .named_children(&mut cursor)
        .find_map(|child| first_ast_identifier(child, source));
    result
}

#[derive(Default)]
struct AstControlMetrics {
    branches: usize,
    loops: usize,
    returns: usize,
    writes: usize,
}

fn collect_ast_control_metrics(node: Node<'_>, function_root_id: usize) -> AstControlMetrics {
    if node.id() != function_root_id && is_ast_function_kind(node.kind()) {
        return AstControlMetrics::default();
    }
    let mut metrics = AstControlMetrics::default();
    match node.kind() {
        "if_statement"
        | "if_expression"
        | "conditional_expression"
        | "elif_clause"
        | "switch_case"
        | "case_statement"
        | "match_arm"
        | "catch_clause" => {
            metrics.branches += 1;
        }
        "for_statement"
        | "for_expression"
        | "enhanced_for_statement"
        | "while_statement"
        | "while_expression"
        | "loop_expression"
        | "do_statement"
        | "foreach_statement" => metrics.loops += 1,
        "return_statement" | "return_expression" => metrics.returns += 1,
        "assignment_expression"
        | "assignment"
        | "augmented_assignment"
        | "variable_declarator"
        | "let_declaration" => metrics.writes += 1,
        _ => {}
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        let child_metrics = collect_ast_control_metrics(child, function_root_id);
        metrics.branches += child_metrics.branches;
        metrics.loops += child_metrics.loops;
        metrics.returns += child_metrics.returns;
        metrics.writes += child_metrics.writes;
    }
    metrics
}

fn build_ast_language_coverage(
    files: &[ControlledRuntimeFile],
    parsed_files: &[String],
    functions: &[AstFunctionFact],
    diagnostics: &[AstParserDiagnostic],
) -> Vec<AstLanguageCoverage> {
    let parsed = parsed_files.iter().collect::<BTreeSet<_>>();
    let languages = files
        .iter()
        .map(|file| file.language.clone())
        .collect::<BTreeSet<_>>();
    languages
        .into_iter()
        .map(|language| {
            let language_files = files
                .iter()
                .filter(|file| file.language == language)
                .collect::<Vec<_>>();
            let parsed_file_count = language_files
                .iter()
                .filter(|file| parsed.contains(&file.path))
                .count();
            let function_count = functions
                .iter()
                .filter(|function| function.language == language)
                .count();
            let diagnostic_count = diagnostics
                .iter()
                .filter(|diagnostic| {
                    language_files
                        .iter()
                        .any(|file| file.path == diagnostic.file_name)
                })
                .count();
            let status = if parsed_file_count == language_files.len() {
                if diagnostic_count == 0 {
                    "ast-ready"
                } else {
                    "ast-warning"
                }
            } else if parsed_file_count > 0 {
                "partial"
            } else {
                "unsupported"
            };
            AstLanguageCoverage {
                language,
                file_count: language_files.len(),
                parsed_file_count,
                function_count,
                diagnostic_count,
                status: status.to_string(),
            }
        })
        .collect()
}

fn is_ast_function_kind(kind: &str) -> bool {
    matches!(
        kind,
        "function_declaration"
            | "function_definition"
            | "function_item"
            | "method_declaration"
            | "constructor_declaration"
            | "local_function_statement"
            | "method"
            | "singleton_method"
            | "arrow_function"
            | "generator_function_declaration"
            | "init_declaration"
            | "create_function_statement"
            | "create_procedure_statement"
    )
}

fn ast_function_name_node(node: Node<'_>) -> Option<Node<'_>> {
    if let Some(name) = node.child_by_field_name("name") {
        return Some(name);
    }
    if let Some(declarator) = node.child_by_field_name("declarator") {
        if let Some(name) = declarator_identifier_node(declarator) {
            return Some(name);
        }
    }
    let mut cursor = node.walk();
    if let Some(name) = node.named_children(&mut cursor).find(|child| {
        matches!(
            child.kind(),
            "identifier" | "simple_identifier" | "field_identifier"
        )
    }) {
        return Some(name);
    }
    let parent = node.parent()?;
    if matches!(
        parent.kind(),
        "variable_declarator" | "lexical_declaration" | "assignment_expression"
    ) {
        return parent
            .child_by_field_name("name")
            .or_else(|| parent.child_by_field_name("left"));
    }
    None
}

fn declarator_identifier_node(node: Node<'_>) -> Option<Node<'_>> {
    if matches!(
        node.kind(),
        "identifier"
            | "simple_identifier"
            | "field_identifier"
            | "type_identifier"
            | "property_identifier"
    ) {
        return Some(node);
    }
    if let Some(inner) = node
        .child_by_field_name("declarator")
        .or_else(|| node.child_by_field_name("name"))
    {
        if let Some(name) = declarator_identifier_node(inner) {
            return Some(name);
        }
    }
    let mut cursor = node.walk();
    let result = node
        .named_children(&mut cursor)
        .filter(|child| {
            !matches!(
                child.kind(),
                "parameter_list" | "parameters" | "type" | "primitive_type" | "type_identifier"
            )
        })
        .find_map(declarator_identifier_node);
    result
}

fn collect_ast_calls(
    node: Node<'_>,
    function_root_id: usize,
    source: &[u8],
    calls: &mut BTreeSet<String>,
) {
    if node.id() != function_root_id && is_ast_function_kind(node.kind()) {
        return;
    }
    if matches!(
        node.kind(),
        "call"
            | "call_expression"
            | "method_invocation"
            | "invocation_expression"
            | "function_call_expression"
            | "command"
    ) {
        let target = ["function", "name", "method", "target"]
            .iter()
            .find_map(|field| node.child_by_field_name(field))
            .and_then(|value| ast_node_text(value, source))
            .or_else(|| {
                node.named_child(0)
                    .and_then(|value| ast_node_text(value, source))
            });
        if let Some(target) = target {
            let short = target
                .split(|character: char| !character.is_alphanumeric() && character != '_')
                .filter(|part| !part.is_empty())
                .next_back()
                .unwrap_or("")
                .to_string();
            if !short.is_empty() {
                calls.insert(short);
            }
        }
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        collect_ast_calls(child, function_root_id, source, calls);
    }
}

fn collect_ast_errors(
    node: Node<'_>,
    file: &ControlledRuntimeFile,
    source: &[u8],
    diagnostics: &mut Vec<AstParserDiagnostic>,
) {
    if node.is_error() || node.is_missing() {
        diagnostics.push(AstParserDiagnostic {
            file_name: file.path.clone(),
            severity: "Risk".to_string(),
            message: if node.is_missing() {
                "Tree-sitter detected a missing syntax token.".to_string()
            } else {
                "Tree-sitter detected a syntax error node.".to_string()
            },
            evidence: ast_node_text(node, source)
                .unwrap_or_else(|| node.kind().to_string())
                .chars()
                .take(180)
                .collect(),
            line: node.start_position().row + 1,
        });
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_ast_errors(child, file, source, diagnostics);
    }
}

fn ast_node_text(node: Node<'_>, source: &[u8]) -> Option<String> {
    node.utf8_text(source)
        .ok()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

fn split_ast_parameters(value: &str) -> Vec<String> {
    value
        .trim()
        .trim_start_matches('(')
        .trim_end_matches(')')
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| item.chars().take(240).collect())
        .collect()
}

fn build_ast_edges(functions: &[AstFunctionFact]) -> Vec<AstEdgeFact> {
    let mut by_name = BTreeMap::<String, Vec<&AstFunctionFact>>::new();
    for function in functions {
        by_name
            .entry(function.short_name.clone())
            .or_default()
            .push(function);
    }
    let mut keys = BTreeSet::new();
    let mut edges = Vec::new();
    for source in functions {
        for call in &source.calls {
            let Some(candidates) = by_name.get(call) else {
                continue;
            };
            let target = candidates
                .iter()
                .find(|candidate| candidate.file_name == source.file_name)
                .copied()
                .or_else(|| (candidates.len() == 1).then_some(candidates[0]));
            let Some(target) = target else {
                continue;
            };
            if source.id == target.id {
                continue;
            }
            let key = format!("{}->{}", source.id, target.id);
            if keys.insert(key) {
                edges.push(AstEdgeFact {
                    from: source.id.clone(),
                    to: target.id.clone(),
                    confidence: if candidates.len() == 1 { 94 } else { 84 },
                    evidence: format!(
                        "AST call {} resolved from {} to {}",
                        call, source.name, target.name
                    ),
                });
            }
        }
    }
    edges
}

#[tauri::command]
fn codeflow_runtime_availability() -> ControlledRuntimeAvailabilityReport {
    let tools = BUILTIN_RUNTIME_ADAPTERS
        .iter()
        .map(|definition| {
            inspect_runtime_tool(
                definition.id,
                definition.label,
                definition.probe_command,
            )
        })
        .collect::<Vec<_>>();
    let available_count = tools.iter().filter(|tool| tool.available).count();
    ControlledRuntimeAvailabilityReport {
        status: if available_count == tools.len() {
            "ready"
        } else if available_count > 0 {
            "partial"
        } else {
            "unavailable"
        }
        .to_string(),
        total_count: tools.len(),
        available_count,
        tools,
        evidence: format!(
            "Detected {available_count}/{} fixed local runtime adapters.",
            BUILTIN_RUNTIME_ADAPTERS.len()
        ),
        safety_boundary: runtime_isolation(),
        extension_slots: runtime_extension_slots(),
    }
}

fn runtime_extension_slots() -> Vec<ControlledRuntimeExtensionSlot> {
    [
        (
            "language-runtime",
            "Additional language runtime",
            "Swift, Go, C#, Kotlin, Ruby, PHP and other compiler/interpreter adapters",
        ),
        (
            "frontend-runtime",
            "Frontend and WebView runtime",
            "Browser, WebView, Bun, Deno and framework build/test adapters",
        ),
        (
            "embedded-target",
            "Embedded and cross-compile target",
            "Arduino, PlatformIO, Zephyr, vendor SDK, probe and hardware target adapters",
        ),
    ]
    .into_iter()
    .map(|(id, label, scope)| ControlledRuntimeExtensionSlot {
        id: id.to_string(),
        label: label.to_string(),
        status: "reserved".to_string(),
        required_contracts: vec![
            scope.to_string(),
            "Fixed executable and argument schema; arbitrary shell commands are rejected."
                .to_string(),
            "Package source, version, license and every executable file must be checksum locked."
                .to_string(),
            "Offline build, temporary project copy, OS isolation, resource limits and process-tree cleanup are mandatory."
                .to_string(),
            "The adapter must emit normalized compile, runtime, trace, file-change and failure evidence."
                .to_string(),
        ],
    })
    .collect()
}

#[tauri::command]
fn codeflow_debug_availability(app: AppHandle) -> Result<DebugAvailabilityReport, String> {
    let probes = debug::probe_managed_debug_adapters(&debug_package_root(&app))?;
    let definitions = [
        ("node", debug::DebugAdapterId::VscodeJsDebug),
        ("python", debug::DebugAdapterId::Debugpy),
        ("java", debug::DebugAdapterId::JavaDebugServer),
        ("rust", debug::DebugAdapterId::LldbDap),
        ("c", debug::DebugAdapterId::LldbDap),
        ("cpp", debug::DebugAdapterId::LldbDap),
    ];
    let adapters = definitions
        .iter()
        .map(|(adapter, backend)| {
            let probe = probes
                .iter()
                .find(|probe| probe.id == *backend)
                .ok_or_else(|| format!("debug adapter probe {backend:?} is missing"))?;
            let backend_name = match backend {
                debug::DebugAdapterId::VscodeJsDebug => "vscode-js-debug",
                debug::DebugAdapterId::Debugpy => "debugpy",
                debug::DebugAdapterId::JavaDebugServer => "java-debug-server",
                debug::DebugAdapterId::LldbDap => "lldb-dap",
            };
            let available = probe.state == debug::DebugAdapterProbeState::Available;
            Ok(DebugAdapterAvailability {
                adapter: (*adapter).to_string(),
                backend: backend_name.to_string(),
                available,
                verified: available && probe.package_checksum_locked,
                version: probe.detected_version.clone(),
                executable_path: probe.executable_path.clone(),
                evidence: probe.evidence.join(" "),
                optional: false,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut adapters = adapters;
    adapters.push(DebugAdapterAvailability {
        adapter: "embedded".to_string(),
        backend: "embedded-system-toolchain".to_string(),
        available: false,
        verified: false,
        version: "reserved".to_string(),
        executable_path: String::new(),
        evidence: "Optional adapter slot reserved for target triples, cross compilers, OpenOCD/J-Link probes and hardware-specific memory maps; it is not counted as certified support.".to_string(),
        optional: true,
    });
    let available_count = adapters
        .iter()
        .filter(|adapter| !adapter.optional && adapter.available)
        .count();
    let verified_count = adapters
        .iter()
        .filter(|adapter| !adapter.optional && adapter.verified)
        .count();
    Ok(DebugAvailabilityReport {
        status: if verified_count == definitions.len() {
            "available"
        } else if available_count > 0 {
            "partial"
        } else {
            "unavailable"
        }
        .to_string(),
        available_count,
        total_count: definitions.len(),
        adapters,
        evidence: vec![
            format!("Detected {available_count}/{} language launchers.", definitions.len()),
            format!("Verified {verified_count}/{} checksum-locked debug sidecars.", definitions.len()),
            "A launcher probe is not treated as a certified DAP backend until its managed package checksum is locked.".to_string(),
        ],
    })
}

fn debug_package_root(app: &AppHandle) -> PathBuf {
    let bundled = app
        .path()
        .resource_dir()
        .ok()
        .map(|root| root.join("debug-sidecars").join(debug::debug_target()));
    if let Some(root) = bundled.filter(|root| root.join("checksums.json").is_file()) {
        return root;
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("debug-sidecars")
        .join(debug::debug_target())
}

#[tauri::command]
fn codeflow_debug_create_session(
    manager: State<'_, DebugSessionManager>,
    request: DebugCreateSessionRequest,
) -> Result<debug::DebugSessionRecord, String> {
    if request.project_id.trim().is_empty() {
        return Err("debug session requires a project id".to_string());
    }
    if !["node", "python", "rust", "java", "c", "cpp"].contains(&request.adapter.as_str()) {
        return Err("debug session rejected unknown adapter".to_string());
    }
    let record = debug::DebugSessionRecord {
        id: format!(
            "debug-{}-{}",
            safe_identifier(&request.project_id),
            now_ms()
        ),
        project_id: request.project_id,
        adapter: request.adapter,
        state: debug::DebugSessionState::Created,
        breakpoints: Vec::new(),
        last_stop: None,
        event_log: vec![debug::DebugEventSnapshot {
            kind: "session_created".to_string(),
            at_ms: now_ms() as u64,
            detail: "Tauri created a local DAP session; no target process has started yet."
                .to_string(),
        }],
        failure: None,
    };
    manager
        .registry
        .lock()
        .map_err(|_| "debug session registry lock is poisoned".to_string())?
        .insert(record.clone())?;
    Ok(record)
}

#[tauri::command]
fn codeflow_debug_set_breakpoints(
    manager: State<'_, DebugSessionManager>,
    request: DebugSetBreakpointsRequest,
) -> Result<debug::DebugSessionRecord, String> {
    if request.breakpoints.len() > 256 {
        return Err("debug session rejected more than 256 breakpoints".to_string());
    }
    let source_path = safe_relative_path(&request.source.path)?
        .to_string_lossy()
        .to_string();
    let breakpoints = request
        .breakpoints
        .into_iter()
        .map(|breakpoint| {
            if breakpoint.line == 0 || breakpoint.line > 10_000_000 {
                return Err("debug session rejected invalid breakpoint line".to_string());
            }
            Ok(debug::DebugSourceBreakpoint {
                path: source_path.clone(),
                line: breakpoint.line,
                condition: breakpoint.condition,
                hit_condition: breakpoint.hit_condition,
                verified: false,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut registry = manager
        .registry
        .lock()
        .map_err(|_| "debug session registry lock is poisoned".to_string())?;
    let session = registry
        .get_mut(&request.session_id)
        .ok_or_else(|| "debug session was not found".to_string())?;
    if !matches!(
        session.state,
        debug::DebugSessionState::Created | debug::DebugSessionState::Initialized
    ) {
        return Err("breakpoints may only be changed before launch".to_string());
    }
    session.breakpoints = breakpoints;
    Ok(session.clone())
}

#[tauri::command]
fn codeflow_debug_session(
    manager: State<'_, DebugSessionManager>,
    session_id: String,
) -> Result<debug::DebugSessionRecord, String> {
    manager
        .registry
        .lock()
        .map_err(|_| "debug session registry lock is poisoned".to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "debug session was not found".to_string())
}

fn debug_backend_for_adapter(adapter: &str) -> Result<debug::DebugAdapterId, String> {
    match adapter {
        "node" => Ok(debug::DebugAdapterId::VscodeJsDebug),
        "python" => Ok(debug::DebugAdapterId::Debugpy),
        "java" => Ok(debug::DebugAdapterId::JavaDebugServer),
        "rust" | "c" | "cpp" => Ok(debug::DebugAdapterId::LldbDap),
        _ => Err(format!("unknown debug adapter {adapter}")),
    }
}

fn dap_initialize(adapter_id: &str) -> Value {
    serde_json::json!({
        "clientID":"codeflow-inspector","adapterID":adapter_id,"pathFormat":"path",
        "linesStartAt1":true,"columnsStartAt1":true,"supportsVariableType":true
    })
}

fn configure_debug_breakpoints(
    dap: &mut LiveDapClient,
    root: &Path,
    breakpoints: &mut [debug::DebugSourceBreakpoint],
) -> Result<(), String> {
    let mut by_source = BTreeMap::<String, Vec<usize>>::new();
    for (index, breakpoint) in breakpoints.iter().enumerate() {
        by_source
            .entry(breakpoint.path.clone())
            .or_default()
            .push(index);
    }
    for (source, indexes) in by_source {
        let path = root.join(&source);
        let requested = indexes
            .iter()
            .map(|index| {
                let breakpoint = &breakpoints[*index];
                serde_json::json!({
                    "line": breakpoint.line,
                    "condition": breakpoint.condition,
                    "hitCondition": breakpoint.hit_condition
                })
            })
            .collect::<Vec<_>>();
        let response = dap.request(
            "setBreakpoints",
            Some(serde_json::json!({
                "source":{"path":path},
                "breakpoints":requested,
                "sourceModified":false
            })),
        )?;
        let verified = response
            .body
            .as_ref()
            .and_then(|body| body.get("breakpoints"))
            .and_then(Value::as_array);
        for (position, index) in indexes.iter().enumerate() {
            breakpoints[*index].verified = verified
                .and_then(|items| items.get(position))
                .and_then(|item| item.get("verified"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
        }
    }
    dap.request("configurationDone", Some(serde_json::json!({})))?;
    Ok(())
}

fn capture_debug_stop(
    dap: &mut LiveDapClient,
    event: debug::DapEvent,
) -> Result<debug::DebugStopSnapshot, String> {
    let thread_id = event
        .body
        .as_ref()
        .and_then(|body| body.get("threadId"))
        .and_then(Value::as_u64)
        .ok_or_else(|| "DAP stopped event did not include a thread id".to_string())?;
    let reason = event
        .body
        .as_ref()
        .and_then(|body| body.get("reason"))
        .and_then(Value::as_str)
        .unwrap_or("pause")
        .to_string();
    let stack = dap.request(
        "stackTrace",
        Some(serde_json::json!({"threadId":thread_id,"startFrame":0,"levels":64})),
    )?;
    let frame = stack
        .body
        .as_ref()
        .and_then(|body| body.pointer("/stackFrames/0"))
        .ok_or_else(|| "DAP stack trace did not include a frame".to_string())?;
    let frame_id = frame
        .get("id")
        .and_then(Value::as_u64)
        .ok_or_else(|| "DAP frame has no id".to_string())?;
    let scopes = dap.request("scopes", Some(serde_json::json!({"frameId":frame_id})))?;
    let mut variables = Vec::new();
    for scope in scopes
        .body
        .as_ref()
        .and_then(|body| body.get("scopes"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(reference) = scope
            .get("variablesReference")
            .and_then(Value::as_u64)
            .filter(|value| *value > 0)
        else {
            continue;
        };
        let response = dap.request(
            "variables",
            Some(serde_json::json!({"variablesReference":reference})),
        )?;
        for variable in response
            .body
            .as_ref()
            .and_then(|body| body.get("variables"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .take(256)
        {
            variables.push(debug::DebugVariableSnapshot {
                name: variable
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string(),
                type_name: variable
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string(),
                value_preview: variable
                    .get("value")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .chars()
                    .take(500)
                    .collect(),
                variables_reference: variable
                    .get("variablesReference")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
            });
        }
    }
    Ok(debug::DebugStopSnapshot {
        reason,
        thread_id,
        frame_id,
        function_name: frame
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),
        path: frame
            .pointer("/source/path")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        line: frame.get("line").and_then(Value::as_u64).unwrap_or(0) as usize,
        variables,
    })
}

fn compatible_python_311() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(path) = std::env::var("CODEFLOW_PYTHON_PATH") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(PathBuf::from(home).join(".pyenv/shims/python3"));
    }
    candidates.push(PathBuf::from("python3.11"));
    candidates
        .into_iter()
        .find(|candidate| {
            Command::new(candidate)
                .args([
                    "-c",
                    "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')",
                ])
                .output()
                .is_ok_and(|output| {
                    output.status.success()
                        && String::from_utf8_lossy(&output.stdout).trim() == "3.11"
                })
        })
        .ok_or_else(|| "debugpy requires a compatible Python 3.11 runtime".to_string())
}

#[cfg(target_os = "macos")]
fn prepare_debug_target_wrapper(
    root: &Path,
    label: &str,
    executable: &Path,
) -> Result<PathBuf, String> {
    use std::os::unix::fs::PermissionsExt;

    if !macos_sandbox_available() {
        return Err(
            "local defense refused debug launch because macOS sandbox-exec is unavailable"
                .to_string(),
        );
    }
    let canonical_root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let escaped_root = escape_sandbox_literal(&canonical_root.to_string_lossy());
    let profile = format!(
        "(version 1)\n(deny default)\n(allow process*)\n(allow sysctl-read)\n(allow mach-lookup)\n(allow ipc-posix-shm*)\n(allow file-read*)\n(allow file-write* (subpath \"{escaped_root}\"))\n(allow network-inbound (local ip \"localhost:*\"))\n(allow network-outbound (remote ip \"localhost:*\"))\n(deny network*)"
    );
    let profile_path = root.join(format!(".codeflow-{label}.sb"));
    fs::write(&profile_path, profile)
        .map_err(|error| format!("failed to write debug sandbox profile: {error}"))?;
    let wrapper = root.join(format!(".codeflow-{label}-sandbox"));
    let quote = |value: &Path| value.to_string_lossy().replace('\'', "'\\''");
    fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\nexec /usr/bin/sandbox-exec -f '{}' '{}' \"$@\"\n",
            quote(&profile_path),
            quote(executable)
        ),
    )
    .map_err(|error| format!("failed to write debug sandbox wrapper: {error}"))?;
    fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("failed to protect debug sandbox wrapper: {error}"))?;
    Ok(wrapper)
}

#[cfg(not(target_os = "macos"))]
fn prepare_debug_target_wrapper(
    _root: &Path,
    _label: &str,
    _executable: &Path,
) -> Result<PathBuf, String> {
    Err("controlled DAP target isolation is not certified on this operating system".to_string())
}

fn compile_debug_entry(
    adapter: &str,
    root: &Path,
    entry: &Path,
    files: &[ControlledRuntimeFile],
) -> Result<PathBuf, String> {
    let output = root.join("codeflow-debug-bin");
    let result = match adapter {
        "rust" => Command::new("rustc")
            .args([
                entry.to_string_lossy().as_ref(),
                "-g",
                "-C",
                "opt-level=0",
                "-o",
                output.to_string_lossy().as_ref(),
            ])
            .current_dir(root)
            .output(),
        "c" => Command::new("cc")
            .args([
                "-g",
                "-O0",
                entry.to_string_lossy().as_ref(),
                "-o",
                output.to_string_lossy().as_ref(),
            ])
            .current_dir(root)
            .output(),
        "cpp" => Command::new("c++")
            .args([
                "-g",
                "-O0",
                entry.to_string_lossy().as_ref(),
                "-o",
                output.to_string_lossy().as_ref(),
            ])
            .current_dir(root)
            .output(),
        "java" => {
            let paths = files
                .iter()
                .filter(|file| file.path.ends_with(".java"))
                .map(|file| root.join(&file.path).to_string_lossy().to_string())
                .collect::<Vec<_>>();
            Command::new("/opt/homebrew/opt/openjdk/bin/javac")
                .arg("-g")
                .args(paths)
                .current_dir(root)
                .output()
        }
        _ => return Ok(entry.to_path_buf()),
    }
    .map_err(|error| format!("failed to build debug target: {error}"))?;
    if !result.status.success() {
        return Err(format!(
            "debug build failed: {}",
            String::from_utf8_lossy(&result.stderr)
        ));
    }
    Ok(if adapter == "java" {
        entry.to_path_buf()
    } else {
        output
    })
}

fn launch_debug_session_inner(
    app: &AppHandle,
    manager: &DebugSessionManager,
    request: DebugLaunchRequest,
) -> Result<debug::DebugSessionRecord, String> {
    safe_relative_path(&request.entry_path)?;
    if request.files.is_empty() {
        return Err("debug launch requires project files".to_string());
    }
    for file in &request.files {
        safe_relative_path(&file.path)?;
    }
    let mut registry = manager
        .registry
        .lock()
        .map_err(|_| "debug session registry lock is poisoned".to_string())?;
    let session = registry
        .get_mut(&request.session_id)
        .ok_or_else(|| "debug session was not found".to_string())?;
    if session.state != debug::DebugSessionState::Created {
        return Err("debug launch requires a newly created session".to_string());
    }
    let backend = debug_backend_for_adapter(&session.adapter)?;
    let probe = debug::probe_managed_debug_adapters(&debug_package_root(&app))?
        .into_iter()
        .find(|probe| probe.id == backend)
        .ok_or_else(|| "debug adapter probe is missing".to_string())?;
    if probe.state != debug::DebugAdapterProbeState::Available {
        return Err(format!("debug backend {backend:?} is not installed"));
    }
    if !probe.package_checksum_locked {
        return Err(format!(
            "debug backend {backend:?} was detected but its managed package is not SHA-256 certified; launch was refused"
        ));
    }
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("debug-sessions")
        .join(&session.id);
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    write_runtime_files(&root, &request.files)?;
    let entry = root.join(safe_relative_path(&request.entry_path)?);
    let program = compile_debug_entry(&session.adapter, &root, &entry, &request.files)?;
    let package_root = debug_package_root(&app);
    let controlled_path = controlled_runtime_path();
    let mut breakpoints = session.breakpoints.clone();
    if breakpoints.is_empty() {
        breakpoints.push(debug::DebugSourceBreakpoint {
            path: request.entry_path.clone(),
            line: 1,
            condition: None,
            hit_condition: None,
            verified: false,
        });
    }
    session.apply(debug::DebugSessionAction::StartAdapter)?;

    let (mut live, launch_sequence) = match session.adapter.as_str() {
        "python" => {
            let listener =
                TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|error| error.to_string())?;
            let port = listener
                .local_addr()
                .map_err(|error| error.to_string())?
                .port();
            drop(listener);
            let python = compatible_python_311()?;
            let python = prepare_debug_target_wrapper(&root, "python", &python)?;
            let debugpy_root = package_root.join("debugpy");
            let mut child = Command::new(python)
                .args([
                    "-m",
                    "debugpy",
                    "--listen",
                    &format!("127.0.0.1:{port}"),
                    "--wait-for-client",
                    entry.to_string_lossy().as_ref(),
                ])
                .current_dir(&root)
                .env("PYTHONPATH", debugpy_root.join("runtime"))
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|error| error.to_string())?;
            let deadline = Instant::now() + Duration::from_secs(10);
            let tcp = loop {
                if let Ok(client) =
                    debug::DapTcpProcess::connect_loopback(port, Duration::from_millis(250))
                {
                    break client;
                }
                if child
                    .try_wait()
                    .map_err(|error| error.to_string())?
                    .is_some()
                {
                    return Err("debugpy target exited before connection".to_string());
                }
                if Instant::now() >= deadline {
                    return Err("debugpy target did not open its internal DAP IPC".to_string());
                }
                thread::sleep(Duration::from_millis(100));
            };
            tcp.set_io_timeout(Duration::from_secs(15))?;
            let mut dap = LiveDapClient::Tcp(tcp);
            dap.request("initialize", Some(dap_initialize("debugpy")))?;
            let seq = dap.send_request(
                "attach",
                Some(serde_json::json!({"request":"attach","type":"debugpy","justMyCode":false})),
            )?;
            dap.wait_event("initialized")?;
            configure_debug_breakpoints(&mut dap, &root, &mut breakpoints)?;
            (
                LiveDebugSession {
                    dap,
                    _parent_dap: None,
                    _java_host: None,
                    auxiliary_children: vec![child],
                    root: root.clone(),
                },
                seq,
            )
        }
        "node" => {
            let command = package_root.join("vscode-js-debug/bin/vscode-js-debug");
            let node = PathBuf::from("/opt/homebrew/bin/node");
            if !node.is_file() {
                return Err("managed Node runtime was not found".to_string());
            }
            let node = prepare_debug_target_wrapper(&root, "node", &node)?;
            let mut parent = debug::DapTcpProcess::spawn_loopback(
                &debug::DapProcessConfig {
                    command,
                    args: vec!["0".into(), "127.0.0.1".into()],
                    cwd: root.clone(),
                    controlled_path: controlled_path.clone(),
                },
                Duration::from_secs(10),
            )?;
            parent.set_io_timeout(Duration::from_secs(15))?;
            parent.request("initialize", Some(dap_initialize("pwa-node")))?;
            let parent_seq = parent.send_request("launch", Some(serde_json::json!({"type":"pwa-node","request":"launch","program":entry,"cwd":root,"args":request.args,"env":request.environment,"runtimeExecutable":node,"autoAttachChildProcesses":false,"console":"internalConsole"})))?;
            parent.wait_event("initialized")?;
            parent.request("configurationDone", Some(serde_json::json!({})))?;
            parent.wait_response(parent_seq, "launch")?;
            let reverse = parent.wait_request("startDebugging")?;
            let mut configuration = reverse
                .arguments
                .as_ref()
                .and_then(|value| value.get("configuration"))
                .cloned()
                .ok_or_else(|| "Node target configuration is missing".to_string())?;
            configuration
                .as_object_mut()
                .ok_or_else(|| "Node target configuration is invalid".to_string())?
                .insert("request".into(), Value::String("launch".into()));
            let mut target =
                debug::DapTcpProcess::connect_loopback(parent.port(), Duration::from_secs(10))?;
            target.set_io_timeout(Duration::from_secs(15))?;
            target.request("initialize", Some(dap_initialize("pwa-node")))?;
            let mut dap = LiveDapClient::Tcp(target);
            let seq = dap.send_request("launch", Some(configuration))?;
            dap.wait_event("initialized")?;
            configure_debug_breakpoints(&mut dap, &root, &mut breakpoints)?;
            parent.respond_to_request(&reverse, true, None)?;
            (
                LiveDebugSession {
                    dap,
                    _parent_dap: Some(parent),
                    _java_host: None,
                    auxiliary_children: vec![],
                    root: root.clone(),
                },
                seq,
            )
        }
        "java" => {
            let resource_root = package_root
                .parent()
                .and_then(Path::parent)
                .ok_or_else(|| "debug resource root is invalid".to_string())?;
            let jdtls = resource_root
                .join("lsp-sidecars")
                .join(debug::debug_target())
                .join("jdtls/bin/jdtls");
            let (host, port) = lsp::start_java_debug_host(&root, &jdtls)?;
            let tcp = debug::DapTcpProcess::connect_loopback(port, Duration::from_secs(10))?;
            tcp.set_io_timeout(Duration::from_secs(15))?;
            let mut dap = LiveDapClient::Tcp(tcp);
            dap.request("initialize", Some(dap_initialize("java")))?;
            let main_class = java_main_class(&root, &entry)?;
            let java = PathBuf::from("/opt/homebrew/opt/openjdk/bin/java");
            let java = prepare_debug_target_wrapper(&root, "java", &java)?;
            let seq = dap.send_request("launch", Some(serde_json::json!({"mainClass":main_class,"projectName":"","cwd":root,"classPaths":[root],"modulePaths":[],"args":request.args,"stopOnEntry":request.stop_on_entry,"javaExec":java})))?;
            dap.wait_event("initialized")?;
            configure_debug_breakpoints(&mut dap, &root, &mut breakpoints)?;
            (
                LiveDebugSession {
                    dap,
                    _parent_dap: None,
                    _java_host: Some(host),
                    auxiliary_children: vec![],
                    root: root.clone(),
                },
                seq,
            )
        }
        "rust" | "c" | "cpp" => {
            let command = package_root.join("lldb-dap/bin/lldb-dap");
            let client = debug::DapProcess::spawn(&debug::DapProcessConfig {
                command,
                args: vec![],
                cwd: root.clone(),
                controlled_path,
            })?;
            let mut dap = LiveDapClient::Stdio(client);
            dap.request("initialize", Some(dap_initialize("lldb-dap")))?;
            let wrapper = prepare_debug_target_wrapper(&root, "native", &program)?;
            let seq = dap.send_request("launch", Some(serde_json::json!({"program":wrapper,"cwd":root,"args":request.args,"stopOnEntry":request.stop_on_entry})))?;
            dap.wait_event("initialized")?;
            configure_debug_breakpoints(&mut dap, &root, &mut breakpoints)?;
            (
                LiveDebugSession {
                    dap,
                    _parent_dap: None,
                    _java_host: None,
                    auxiliary_children: vec![],
                    root: root.clone(),
                },
                seq,
            )
        }
        _ => return Err("unsupported debug adapter".to_string()),
    };
    live.dap.wait_response(
        launch_sequence,
        if session.adapter == "python" {
            "attach"
        } else {
            "launch"
        },
    )?;
    session.apply(debug::DebugSessionAction::Initialize)?;
    session.apply(debug::DebugSessionAction::Configure)?;
    session.apply(debug::DebugSessionAction::Launch)?;
    let stopped = live.dap.wait_event("stopped")?;
    session.last_stop = Some(capture_debug_stop(&mut live.dap, stopped)?);
    session.breakpoints = breakpoints;
    session.apply(debug::DebugSessionAction::Stop)?;
    session.event_log.push(debug::DebugEventSnapshot {
        kind: "breakpoint_stopped".to_string(),
        at_ms: now_ms() as u64,
        detail: format!(
            "{} stopped at {}:{}; stack, scopes and variables were refreshed.",
            session.adapter,
            session
                .last_stop
                .as_ref()
                .map(|stop| stop.path.as_str())
                .unwrap_or("unknown"),
            session
                .last_stop
                .as_ref()
                .map(|stop| stop.line)
                .unwrap_or(0)
        ),
    });
    manager
        .live
        .lock()
        .map_err(|_| "live debug session lock is poisoned".to_string())?
        .insert(session.id.clone(), live);
    Ok(session.clone())
}

#[tauri::command]
fn codeflow_debug_launch(
    app: AppHandle,
    manager: State<'_, DebugSessionManager>,
    request: DebugLaunchRequest,
) -> Result<debug::DebugSessionRecord, String> {
    let session_id = request.session_id.clone();
    match launch_debug_session_inner(&app, &manager, request) {
        Ok(session) => Ok(session),
        Err(error) => {
            manager
                .live
                .lock()
                .map_err(|_| "live debug session lock is poisoned".to_string())?
                .remove(&session_id);
            if let Ok(root) = app.path().app_cache_dir() {
                let _ = fs::remove_dir_all(root.join("debug-sessions").join(&session_id));
            }
            if let Ok(mut registry) = manager.registry.lock() {
                if let Some(session) = registry.get_mut(&session_id) {
                    session.state = debug::DebugSessionState::Failed;
                    session.failure = Some(error.clone());
                    session.event_log.push(debug::DebugEventSnapshot {
                        kind: "launch_failed".to_string(),
                        at_ms: now_ms() as u64,
                        detail: error.clone(),
                    });
                }
            }
            Err(error)
        }
    }
}

fn run_debug_process_action(
    manager: State<'_, DebugSessionManager>,
    request: DebugThreadRequest,
    command: &str,
    action: debug::DebugSessionAction,
) -> Result<debug::DebugSessionRecord, String> {
    if request.thread_id == 0 {
        return Err("debug action requires a valid thread id".to_string());
    }
    let mut live_sessions = manager
        .live
        .lock()
        .map_err(|_| "live debug session lock is poisoned".to_string())?;
    let live = live_sessions
        .get_mut(&request.session_id)
        .ok_or_else(|| "live debug session was not found".to_string())?;
    live.dap.request(
        command,
        Some(serde_json::json!({"threadId":request.thread_id})),
    )?;
    let mut registry = manager
        .registry
        .lock()
        .map_err(|_| "debug session registry lock is poisoned".to_string())?;
    let session = registry
        .get_mut(&request.session_id)
        .ok_or_else(|| "debug session was not found".to_string())?;
    session.apply(action)?;
    session.event_log.push(debug::DebugEventSnapshot {
        kind: command.to_string(),
        at_ms: now_ms() as u64,
        detail: format!("DAP accepted {command} for thread {}.", request.thread_id),
    });
    let event = live
        .dap
        .wait_event_any(&["stopped", "terminated", "exited"])?;
    if event.event == "stopped" {
        session.last_stop = Some(capture_debug_stop(&mut live.dap, event)?);
        session.apply(debug::DebugSessionAction::Stop)?;
        session.event_log.push(debug::DebugEventSnapshot {
            kind: "stopped".to_string(),
            at_ms: now_ms() as u64,
            detail: format!(
                "Execution stopped at {}:{} and variables were refreshed.",
                session
                    .last_stop
                    .as_ref()
                    .map(|stop| stop.path.as_str())
                    .unwrap_or("unknown"),
                session
                    .last_stop
                    .as_ref()
                    .map(|stop| stop.line)
                    .unwrap_or(0)
            ),
        });
    } else {
        session.state = debug::DebugSessionState::Terminated;
        session.event_log.push(debug::DebugEventSnapshot {
            kind: event.event,
            at_ms: now_ms() as u64,
            detail: "The target ended; the adapter and auxiliary process tree were released."
                .to_string(),
        });
        live_sessions.remove(&request.session_id);
    }
    Ok(session.clone())
}

#[tauri::command]
fn codeflow_debug_continue(
    manager: State<'_, DebugSessionManager>,
    request: DebugThreadRequest,
) -> Result<debug::DebugSessionRecord, String> {
    run_debug_process_action(
        manager,
        request,
        "continue",
        debug::DebugSessionAction::Continue,
    )
}

#[tauri::command]
fn codeflow_debug_next(
    manager: State<'_, DebugSessionManager>,
    request: DebugThreadRequest,
) -> Result<debug::DebugSessionRecord, String> {
    run_debug_process_action(manager, request, "next", debug::DebugSessionAction::Step)
}

#[tauri::command]
fn codeflow_debug_step_in(
    manager: State<'_, DebugSessionManager>,
    request: DebugThreadRequest,
) -> Result<debug::DebugSessionRecord, String> {
    run_debug_process_action(manager, request, "stepIn", debug::DebugSessionAction::Step)
}

#[tauri::command]
fn codeflow_debug_step_out(
    manager: State<'_, DebugSessionManager>,
    request: DebugThreadRequest,
) -> Result<debug::DebugSessionRecord, String> {
    run_debug_process_action(manager, request, "stepOut", debug::DebugSessionAction::Step)
}

#[tauri::command]
fn codeflow_debug_pause(
    manager: State<'_, DebugSessionManager>,
    request: DebugThreadRequest,
) -> Result<debug::DebugSessionRecord, String> {
    run_debug_process_action(manager, request, "pause", debug::DebugSessionAction::Step)
}

#[tauri::command]
fn codeflow_debug_disconnect(
    manager: State<'_, DebugSessionManager>,
    request: DebugDisconnectRequest,
) -> Result<debug::DebugSessionRecord, String> {
    let _terminate_debuggee = request.terminate_debuggee;
    if let Some(mut live) = manager
        .live
        .lock()
        .map_err(|_| "live debug session lock is poisoned".to_string())?
        .remove(&request.session_id)
    {
        let _ = live.dap.request(
            "disconnect",
            Some(serde_json::json!({"terminateDebuggee":request.terminate_debuggee})),
        );
    }
    let mut registry = manager
        .registry
        .lock()
        .map_err(|_| "debug session registry lock is poisoned".to_string())?;
    let mut session = registry
        .remove(&request.session_id)
        .ok_or_else(|| "debug session was not found".to_string())?;
    session.state = debug::DebugSessionState::Terminated;
    session.event_log.push(debug::DebugEventSnapshot {
        kind: "disconnect".to_string(),
        at_ms: now_ms() as u64,
        detail:
            "The desktop coordinator closed the DAP session and released its temporary workspace."
                .to_string(),
    });
    Ok(session)
}

#[tauri::command]
fn codeflow_run_controlled(
    app: AppHandle,
    request: ControlledRuntimeRequest,
) -> Result<ControlledRuntimeExecutionReport, String> {
    validate_runtime_request(&request)?;
    let started_at = now_ms();
    let run_id = format!(
        "runtime-{}-{started_at}",
        safe_identifier(&request.project_id)
    );
    let run_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("failed to resolve runtime cache directory: {error}"))?
        .join("controlled-runtime")
        .join(&run_id);
    fs::create_dir_all(&run_root)
        .map_err(|error| format!("failed to create controlled runtime directory: {error}"))?;
    write_runtime_files(&run_root, &request.files)?;

    let timeout_ms = request.timeout_ms.clamp(250, 30_000);
    let max_output_bytes = request.max_output_bytes.clamp(4_096, 1_048_576);
    let execution = execute_runtime_adapter(&run_root, &request, timeout_ms, max_output_bytes);
    let finished_at = now_ms();
    let total_bytes = request.files.iter().map(|file| file.content.len()).sum();
    let db_path = database_path(&app)?;
    let mut report = match execution {
        Ok((command_label, compile_output, outcome, compile_failed)) => {
            let (mut trace_events, mut trace_source) = parse_runtime_trace_events(
                &outcome.stdout,
                &run_root.join(".codeflow-trace.ndjson"),
            );
            let taint_events =
                detect_runtime_taint_observations(&request.stdin, &outcome, &run_root);
            if !taint_events.is_empty() {
                trace_events.extend(taint_events);
                trace_source = if trace_source == "none" {
                    "taint-probe"
                } else {
                    "instrumentation-sidecar+taint-probe"
                }
                .to_string();
            }
            let sanitizer_findings = parse_sanitizer_findings(&outcome.stderr);
            let sanitizer_status = if request.experiment_kind != "security"
                || !matches!(request.adapter.as_str(), "c" | "cpp")
            {
                "not-requested"
            } else if !sanitizer_findings.is_empty() {
                "finding"
            } else if command_label.contains("-fsanitize=") && !compile_failed {
                "passed"
            } else {
                "unavailable"
            };
            ControlledRuntimeExecutionReport {
                id: run_id,
                project_id: request.project_id,
                project_name: request.project_name,
                adapter: request.adapter,
                status: if compile_failed {
                    "compile_failed"
                } else if outcome.timed_out {
                    "timeout"
                } else if outcome.exit_code == Some(0) {
                    "passed"
                } else {
                    "failed"
                }
                .to_string(),
                evidence_grade: "真实执行".to_string(),
                experiment_kind: request.experiment_kind.clone(),
                sample_id: request.sample_id.clone(),
                repetition: request.repetition,
                input_bytes: request.stdin.len(),
                trace_events,
                trace_source,
                sanitizer_status: sanitizer_status.to_string(),
                sanitizer_findings,
                entry_path: request.entry_path,
                command_label,
                exit_code: outcome.exit_code,
                timed_out: outcome.timed_out,
                duration_ms: outcome.duration_ms,
                stdout: outcome.stdout,
                stderr: outcome.stderr,
                stdout_truncated: outcome.stdout_truncated,
                stderr_truncated: outcome.stderr_truncated,
                compile_output,
                file_count: request.files.len(),
                total_bytes,
                started_at,
                finished_at,
                database_path: db_path.to_string_lossy().to_string(),
                sandbox_kind: outcome.sandbox_kind,
                sandbox_status: outcome.sandbox_status,
                sandbox_evidence: outcome.sandbox_evidence,
                cpu_time_ms: outcome.cpu_time_ms,
                peak_memory_bytes: outcome.peak_memory_bytes,
                child_process_count: outcome.child_processes.len(),
                child_processes: outcome.child_processes,
                file_changes: outcome.file_changes,
                isolation: runtime_isolation(),
                evidence: vec![
                    "Executed from a temporary project copy.".to_string(),
                    format!(
                        "Timeout {timeout_ms}ms; output cap {max_output_bytes} bytes per stream."
                    ),
                    "No shell command was accepted; the adapter built the process arguments."
                        .to_string(),
                ],
            }
        }
        Err(error) => ControlledRuntimeExecutionReport {
            id: run_id,
            project_id: request.project_id,
            project_name: request.project_name,
            adapter: request.adapter,
            status: "unavailable".to_string(),
            evidence_grade: "真实执行".to_string(),
            experiment_kind: request.experiment_kind.clone(),
            sample_id: request.sample_id.clone(),
            repetition: request.repetition,
            input_bytes: request.stdin.len(),
            trace_events: Vec::new(),
            trace_source: "none".to_string(),
            sanitizer_status: "unavailable".to_string(),
            sanitizer_findings: Vec::new(),
            entry_path: request.entry_path,
            command_label: "adapter unavailable".to_string(),
            exit_code: None,
            timed_out: false,
            duration_ms: finished_at.saturating_sub(started_at),
            stdout: String::new(),
            stderr: error.clone(),
            stdout_truncated: false,
            stderr_truncated: false,
            compile_output: String::new(),
            file_count: request.files.len(),
            total_bytes,
            started_at,
            finished_at,
            database_path: db_path.to_string_lossy().to_string(),
            sandbox_kind: platform_sandbox_kind().to_string(),
            sandbox_status: "unavailable".to_string(),
            sandbox_evidence: error.clone(),
            cpu_time_ms: 0,
            peak_memory_bytes: 0,
            child_process_count: 0,
            child_processes: Vec::new(),
            file_changes: Vec::new(),
            isolation: runtime_isolation(),
            evidence: vec![error],
        },
    };
    match fs::remove_dir_all(&run_root) {
        Ok(()) => report
            .evidence
            .push("Temporary project copy was destroyed after evidence collection.".to_string()),
        Err(error) => {
            report.status = "failed".to_string();
            report.evidence.push(format!(
                "Temporary project cleanup failed; this run is not trusted: {error}"
            ));
        }
    }
    persist_runtime_report(&app, &report)?;
    report.database_path = database_path(&app)?.to_string_lossy().to_string();
    Ok(report)
}

#[tauri::command]
fn codeflow_run_formal_policy_suite(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<FormalVerificationRecord>, String> {
    if project_id.trim().is_empty() || project_id.len() > 256 {
        return Err("formal verifier rejected invalid project id".to_string());
    }
    let solver_version = Command::new("z3")
        .arg("--version")
        .output()
        .map_err(|error| format!("Z3 is unavailable: {error}"))
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())?;
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("failed to resolve formal verifier cache: {error}"))?
        .join("formal-verification")
        .join(format!("{}-{}", safe_identifier(&project_id), now_ms()));
    fs::create_dir_all(&root)
        .map_err(|error| format!("failed to create formal verifier workspace: {error}"))?;
    let policies = formal_policy_specs();
    let mut records = Vec::new();
    for (index, (obligation_id, title, body)) in policies.iter().enumerate() {
        let formula = format!("(set-logic ALL)\n{body}\n(check-sat)\n(get-info :reason-unknown)\n");
        let formula_hash = format!("{:x}", Sha256::digest(formula.as_bytes()));
        let outcome = run_process(
            "z3",
            &["-in".to_string(), "-T:5".to_string()],
            &root,
            &formula,
            7_000,
            64 * 1024,
            &format!("z3-{index}"),
        )?;
        let first_line = outcome.stdout.lines().next().unwrap_or("error").trim();
        let status = match first_line {
            "unsat" => "proved",
            "sat" => "counterexample",
            "unknown" => "unknown",
            _ => "error",
        };
        let record = FormalVerificationRecord {
            id: format!("formal-{}-{}", safe_identifier(&project_id), obligation_id),
            project_id: project_id.clone(),
            obligation_id: obligation_id.to_string(),
            title: title.to_string(),
            status: status.to_string(),
            solver: "Z3".to_string(),
            solver_version: solver_version.clone(),
            formula_hash,
            formula,
            result: outcome.stdout.trim().to_string(),
            duration_ms: outcome.duration_ms,
            sandbox_status: outcome.sandbox_status.clone(),
            evidence: vec![
                outcome.sandbox_evidence,
                "The solver checked the negation of the policy invariant; unsat means no counterexample exists in this model.".to_string(),
            ],
            created_at: now_ms(),
            file_name: None,
            function_id: None,
            line: None,
            counterexample: None,
            call_chain: Vec::new(),
        };
        persist_formal_verification(&app, &record)?;
        records.push(record);
    }
    let _ = fs::remove_dir_all(root);
    Ok(records)
}

#[tauri::command]
fn codeflow_run_project_smt_batch(
    app: AppHandle,
    request: ProjectSmtBatchRequest,
) -> Result<Vec<FormalVerificationRecord>, String> {
    if request.project_id.trim().is_empty() || request.obligations.len() > 512 {
        return Err("invalid project SMT batch".to_string());
    }
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("project-smt")
        .join(format!(
            "{}-{}",
            safe_identifier(&request.project_id),
            now_ms()
        ));
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let version = Command::new("z3")
        .arg("--version")
        .output()
        .map_err(|e| format!("Z3 unavailable: {e}"))?;
    let solver_version = String::from_utf8_lossy(&version.stdout).trim().to_string();
    let mut records = Vec::new();
    for (index, obligation) in request.obligations.into_iter().enumerate() {
        validate_project_smt_formula(&obligation.formula)?;
        let hash = format!("{:x}", Sha256::digest(obligation.formula.as_bytes()));
        let outcome = run_process(
            "z3",
            &["-in".into(), "-T:5".into()],
            &root,
            &obligation.formula,
            7_000,
            128 * 1024,
            &format!("project-smt-{index}"),
        )?;
        let result = outcome.stdout.trim().to_string();
        let first = result.lines().next().unwrap_or("error");
        let status = match first {
            "unsat" => "proved",
            "sat" => "counterexample",
            "unknown" => "unknown",
            _ => "error",
        };
        let record = FormalVerificationRecord {
            id: format!(
                "formal-{}-{}",
                safe_identifier(&request.project_id),
                safe_identifier(&obligation.obligation_id)
            ),
            project_id: request.project_id.clone(),
            obligation_id: obligation.obligation_id,
            title: obligation.title,
            status: status.into(),
            solver: "Z3".into(),
            solver_version: solver_version.clone(),
            formula_hash: hash,
            formula: obligation.formula,
            result: result.clone(),
            duration_ms: outcome.duration_ms,
            sandbox_status: outcome.sandbox_status,
            evidence: vec![outcome.sandbox_evidence],
            created_at: now_ms(),
            file_name: Some(obligation.file_name),
            function_id: Some(obligation.function_id),
            line: Some(obligation.line),
            counterexample: (status == "counterexample").then_some(result),
            call_chain: obligation.call_chain,
        };
        persist_formal_verification(&app, &record)?;
        records.push(record);
    }
    let _ = fs::remove_dir_all(root);
    Ok(records)
}

fn validate_project_smt_formula(formula: &str) -> Result<(), String> {
    if formula.is_empty() || formula.len() > 65_536 || formula.contains('\0') {
        return Err("invalid SMT formula size".to_string());
    }
    let lower = formula.to_ascii_lowercase();
    for forbidden in [
        "set-option",
        "include",
        "load",
        "save",
        "shell",
        "system",
        "open",
    ] {
        if lower.contains(forbidden) {
            return Err(format!("forbidden SMT token: {forbidden}"));
        }
    }
    if !lower.contains("(check-sat)") || !lower.contains("(set-logic qf_") {
        return Err("SMT batch requires a quantifier-free logic and check-sat".to_string());
    }
    Ok(())
}

fn formal_policy_specs() -> [(&'static str, &'static str, &'static str); 3] {
    [
        (
            "verify-policy-deepweb-not-proof",
            "DeepWeb 候选不得冒充证明",
            "(declare-const candidate Bool)\n(declare-const teacher Bool)\n(declare-const runtime Bool)\n(declare-const formal Bool)\n(declare-const proved Bool)\n(assert (= proved (or teacher runtime formal)))\n(assert (not (=> (and candidate (not teacher) (not runtime) (not formal)) (not proved))))",
        ),
        (
            "verify-policy-repair-writeback",
            "修复未过全部门禁不得写回",
            "(declare-const static Bool)\n(declare-const regression Bool)\n(declare-const benchmark Bool)\n(declare-const security Bool)\n(declare-const approval Bool)\n(declare-const writeback Bool)\n(assert (= writeback (and static regression benchmark security approval)))\n(assert (not (=> writeback (and static regression benchmark security approval))))",
        ),
        (
            "verify-policy-soundness-cap",
            "验证评分不得超过证据上限",
            "(declare-const raw Int)\n(declare-const cap Int)\n(declare-const score Int)\n(assert (and (<= 0 raw) (<= raw 100) (<= 0 cap) (<= cap 100)))\n(assert (= score (ite (< raw cap) raw cap)))\n(assert (not (<= score cap)))",
        ),
    ]
}

fn persist_formal_verification(
    app: &AppHandle,
    record: &FormalVerificationRecord,
) -> Result<(), String> {
    with_database(app, |conn, _| {
        conn.execute(
            "INSERT OR REPLACE INTO formal_verification_runs
             (id, project_id, obligation_id, title, status, solver, solver_version, formula_hash,
              formula, result, duration_ms, sandbox_status, evidence, created_at, file_name, function_id, line, counterexample, call_chain)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            rusqlite::params![
                record.id,
                record.project_id,
                record.obligation_id,
                record.title,
                record.status,
                record.solver,
                record.solver_version,
                record.formula_hash,
                record.formula,
                record.result,
                record.duration_ms as i64,
                record.sandbox_status,
                serde_json::to_string(&record.evidence).unwrap_or_else(|_| "[]".to_string()),
                record.created_at as i64,
                record.file_name, record.function_id, record.line.map(|value| value as i64), record.counterexample,
                serde_json::to_string(&record.call_chain).unwrap_or_else(|_| "[]".to_string()),
            ],
        )
        .map_err(|error| format!("failed to persist formal verification: {error}"))?;
        Ok(())
    })
}

fn inspect_runtime_tool(adapter: &str, label: &str, command: &str) -> ControlledRuntimeTool {
    let resolved = resolve_runtime_command(command)
        .unwrap_or_else(|| PathBuf::from(command));
    let output = Command::new(&resolved)
        .arg("--version")
        .env("PATH", controlled_runtime_path())
        .output();
    match output {
        Ok(output) => {
            let version =
                first_nonempty_line(&String::from_utf8_lossy(if output.stdout.is_empty() {
                    &output.stderr
                } else {
                    &output.stdout
                }));
            ControlledRuntimeTool {
                adapter: adapter.to_string(),
                label: label.to_string(),
                available: output.status.success(),
                command: resolved.to_string_lossy().to_string(),
                version,
                evidence: format!(
                    "{} --version exited with {}",
                    resolved.to_string_lossy(),
                    output.status.code().unwrap_or(-1)
                ),
            }
        }
        Err(error) => ControlledRuntimeTool {
            adapter: adapter.to_string(),
            label: label.to_string(),
            available: false,
            command: resolved.to_string_lossy().to_string(),
            version: String::new(),
            evidence: format!(
                "{} is unavailable after searching the controlled desktop runtime path: {error}",
                resolved.to_string_lossy()
            ),
        },
    }
}

fn validate_runtime_request(request: &ControlledRuntimeRequest) -> Result<(), String> {
    if !BUILTIN_RUNTIME_ADAPTERS
        .iter()
        .any(|definition| definition.id == request.adapter)
    {
        return Err(format!(
            "controlled runtime rejected adapter {}",
            request.adapter
        ));
    }
    if request.project_id.trim().is_empty() || request.project_name.trim().is_empty() {
        return Err("controlled runtime requires project identity".to_string());
    }
    if !["baseline", "stress", "fault", "security"].contains(&request.experiment_kind.as_str()) {
        return Err(format!(
            "controlled runtime rejected experiment kind {}",
            request.experiment_kind
        ));
    }
    if request.sample_id.trim().is_empty()
        || request.sample_id.len() > 160
        || request.repetition == 0
        || request.repetition > 100
    {
        return Err("controlled runtime rejected invalid experiment sample metadata".to_string());
    }
    if request.files.is_empty() || request.files.len() > 500 {
        return Err("controlled runtime accepts between 1 and 500 project files".to_string());
    }
    let total_bytes = request
        .files
        .iter()
        .map(|file| file.content.len())
        .sum::<usize>();
    if total_bytes > 15 * 1024 * 1024 {
        return Err("controlled runtime rejected project copy larger than 15MB".to_string());
    }
    if request.stdin.len() > 1024 * 1024 {
        return Err("controlled runtime rejected stdin larger than 1MB".to_string());
    }
    if request.args.len() > 32 || request.args.iter().any(|arg| arg.len() > 4096) {
        return Err("controlled runtime rejected oversized argument list".to_string());
    }
    let entry = safe_relative_path(&request.entry_path)?;
    if !request
        .files
        .iter()
        .any(|file| safe_relative_path(&file.path).ok().as_ref() == Some(&entry))
    {
        return Err(
            "controlled runtime entry file is not part of the imported project".to_string(),
        );
    }
    for file in &request.files {
        safe_relative_path(&file.path)?;
        if file.language.trim().is_empty() {
            return Err(format!(
                "controlled runtime rejected file without language: {}",
                file.path
            ));
        }
    }
    for breakpoint in &request.breakpoints {
        safe_relative_path(&breakpoint.path)?;
        if breakpoint.line == 0 || breakpoint.line > 10_000_000 {
            return Err("controlled runtime rejected invalid breakpoint line".to_string());
        }
    }
    Ok(())
}

fn parse_runtime_trace_events(
    stdout: &str,
    sidecar_path: &Path,
) -> (Vec<RuntimeTraceEvent>, String) {
    let sidecar = fs::read(sidecar_path)
        .ok()
        .filter(|bytes| bytes.len() <= 4 * 1024 * 1024)
        .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
        .unwrap_or_default();
    let sidecar_events = parse_trace_lines(sidecar.lines(), None);
    if !sidecar_events.is_empty() {
        return (sidecar_events, "instrumentation-sidecar".to_string());
    }
    let stdout_events = parse_trace_lines(stdout.lines(), Some("CODEFLOW_TRACE "));
    let source = if stdout_events.is_empty() {
        "none"
    } else {
        "stdout-compat"
    };
    (stdout_events, source.to_string())
}

fn parse_trace_lines<'a>(
    lines: impl Iterator<Item = &'a str>,
    prefix: Option<&str>,
) -> Vec<RuntimeTraceEvent> {
    lines
        .filter_map(|line| {
            let line = line.trim();
            match prefix {
                Some(prefix) => line.strip_prefix(prefix),
                None => Some(line),
            }
        })
        .filter_map(|payload| serde_json::from_str::<RuntimeTraceEvent>(payload).ok())
        .filter(|event| {
            !event.function_name.trim().is_empty()
                && ["enter", "exit", "error", "transfer"].contains(&event.event.as_str())
        })
        .take(20_000)
        .collect()
}

fn detect_runtime_taint_observations(
    stdin: &str,
    outcome: &ProcessOutcome,
    root: &Path,
) -> Vec<RuntimeTraceEvent> {
    let mut values = BTreeSet::new();
    if let Ok(value) = serde_json::from_str::<Value>(stdin) {
        collect_json_taint_values(&value, &mut values);
    } else if stdin.trim().len() >= 4 {
        values.insert(stdin.trim().to_string());
    }
    let mut events = Vec::new();
    for value in values
        .into_iter()
        .filter(|value| (4..=4096).contains(&value.len()))
        .take(64)
    {
        let label = format!(
            "taint-{}",
            &format!("{:x}", Sha256::digest(value.as_bytes()))[..12]
        );
        for (sink, content) in [
            ("<stdout>", outcome.stdout.as_str()),
            ("<stderr>", outcome.stderr.as_str()),
        ] {
            if content.contains(&value) {
                events.push(RuntimeTraceEvent {
                    function_name: sink.to_string(),
                    event: "transfer".to_string(),
                    data_names: vec![label.clone()],
                    from: Some("<stdin>".to_string()),
                    to: Some(sink.to_string()),
                });
            }
        }
        for change in outcome
            .file_changes
            .iter()
            .filter(|change| matches!(change.kind.as_str(), "created" | "modified"))
            .take(128)
        {
            let path = root.join(&change.path);
            if fs::metadata(&path).is_ok_and(|metadata| metadata.len() <= 1024 * 1024)
                && fs::read(&path).is_ok_and(|bytes| {
                    bytes
                        .windows(value.len())
                        .any(|window| window == value.as_bytes())
                })
            {
                events.push(RuntimeTraceEvent {
                    function_name: change.path.clone(),
                    event: "transfer".to_string(),
                    data_names: vec![label.clone()],
                    from: Some("<stdin>".to_string()),
                    to: Some(change.path.clone()),
                });
            }
        }
    }
    events.truncate(512);
    events
}

fn collect_json_taint_values(value: &Value, output: &mut BTreeSet<String>) {
    match value {
        Value::String(text) => {
            output.insert(text.clone());
        }
        Value::Array(items) => items
            .iter()
            .for_each(|item| collect_json_taint_values(item, output)),
        Value::Object(items) => items
            .values()
            .for_each(|item| collect_json_taint_values(item, output)),
        _ => {}
    }
}

fn parse_sanitizer_findings(stderr: &str) -> Vec<String> {
    stderr
        .lines()
        .filter(|line| {
            line.contains("AddressSanitizer")
                || line.contains("UndefinedBehaviorSanitizer")
                || line.contains("runtime error:")
                || line.contains("ThreadSanitizer")
        })
        .map(|line| line.trim().chars().take(500).collect::<String>())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .take(64)
        .collect()
}

fn write_runtime_files(root: &Path, files: &[ControlledRuntimeFile]) -> Result<(), String> {
    for file in files {
        let relative = safe_relative_path(&file.path)?;
        let target = root.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create runtime project directory: {error}"))?;
        }
        fs::write(&target, file.content.as_bytes())
            .map_err(|error| format!("failed to write runtime file {}: {error}", file.path))?;
    }
    Ok(())
}

fn execute_runtime_adapter(
    root: &Path,
    request: &ControlledRuntimeRequest,
    timeout_ms: u64,
    max_output_bytes: usize,
) -> Result<(String, String, ProcessOutcome, bool), String> {
    let entry = safe_relative_path(&request.entry_path)?;
    let entry_text = entry.to_string_lossy().to_string();
    let mut project_compile_output = String::new();
    if let Some(plan) = runtime_build::detect_project_build(root, &request.adapter, &entry)? {
        for (index, step) in plan.steps.iter().enumerate() {
            let outcome = run_process(
                &step.command,
                &step.args,
                root,
                "",
                timeout_ms,
                max_output_bytes,
                &format!("project-build-{index}"),
            )?;
            project_compile_output.push_str(&format!(
                "{}\n{}\n",
                step.label,
                join_process_output(&outcome)
            ));
            if outcome.timed_out || outcome.exit_code != Some(0) {
                return Ok((
                    format_command_label(&step.command, &step.args),
                    project_compile_output,
                    outcome,
                    true,
                ));
            }
        }
        match plan.run_strategy {
            runtime_build::BuildRunStrategy::CargoRun => {
                let mut args = vec![
                    "run".to_string(),
                    "--quiet".to_string(),
                    "--offline".to_string(),
                    "--".to_string(),
                ];
                args.extend(request.args.clone());
                let outcome = run_process(
                    "cargo",
                    &args,
                    root,
                    &request.stdin,
                    timeout_ms,
                    max_output_bytes,
                    "cargo-run",
                )?;
                return Ok((
                    format_command_label("cargo", &args),
                    format!("{}\n{}", plan.evidence, project_compile_output),
                    outcome,
                    false,
                ));
            }
            runtime_build::BuildRunStrategy::JavaClasses(classes) => {
                let main_class = java_main_class(root, &entry)?;
                let mut args = vec!["-cp".to_string(), classes.to_string(), main_class];
                args.extend(request.args.clone());
                let outcome = run_process(
                    "java",
                    &args,
                    root,
                    &request.stdin,
                    timeout_ms,
                    max_output_bytes,
                    "java-project",
                )?;
                return Ok((
                    format_command_label("java", &args),
                    format!("{}\n{}", plan.evidence, project_compile_output),
                    outcome,
                    false,
                ));
            }
            runtime_build::BuildRunStrategy::DiscoverNativeArtifact => {
                let executable = runtime_build::discover_native_artifact(root, &entry)?;
                let command = executable.to_string_lossy().to_string();
                let outcome = run_process(
                    &command,
                    &request.args,
                    root,
                    &request.stdin,
                    timeout_ms,
                    max_output_bytes,
                    "native-project",
                )?;
                return Ok((
                    format_command_label(&command, &request.args),
                    format!("{}\n{}", plan.evidence, project_compile_output),
                    outcome,
                    false,
                ));
            }
            runtime_build::BuildRunStrategy::ExistingAdapter => {
                project_compile_output = format!("{}\n{}", plan.evidence, project_compile_output);
            }
        }
    }
    match request.adapter.as_str() {
        "node" => {
            let mut args = Vec::new();
            if matches!(
                entry.extension().and_then(|value| value.to_str()),
                Some("ts" | "mts" | "cts")
            ) {
                args.push("--experimental-strip-types".to_string());
            }
            args.push(entry_text);
            args.extend(request.args.clone());
            let outcome = run_process(
                "node",
                &args,
                root,
                &request.stdin,
                timeout_ms,
                max_output_bytes,
                "node",
            )?;
            Ok((
                format_command_label("node", &args),
                project_compile_output,
                outcome,
                false,
            ))
        }
        "python" => {
            let mut args = vec!["-I".to_string(), entry_text];
            args.extend(request.args.clone());
            let outcome = run_process(
                "python3",
                &args,
                root,
                &request.stdin,
                timeout_ms,
                max_output_bytes,
                "python",
            )?;
            Ok((
                format_command_label("python3", &args),
                project_compile_output,
                outcome,
                false,
            ))
        }
        "rust" if root.join("Cargo.toml").exists() => {
            let mut args = vec!["run".to_string(), "--quiet".to_string(), "--".to_string()];
            args.extend(request.args.clone());
            let outcome = run_process(
                "cargo",
                &args,
                root,
                &request.stdin,
                timeout_ms,
                max_output_bytes,
                "cargo",
            )?;
            Ok((
                format_command_label("cargo", &args),
                String::new(),
                outcome,
                false,
            ))
        }
        "rust" => compile_then_run(
            "rustc",
            &[
                entry_text,
                "-o".to_string(),
                "codeflow-runtime-bin".to_string(),
            ],
            root,
            &request.args,
            &request.stdin,
            timeout_ms,
            max_output_bytes,
        ),
        "java" => {
            let java_files = request
                .files
                .iter()
                .filter(|file| file.path.to_ascii_lowercase().ends_with(".java"))
                .map(|file| {
                    safe_relative_path(&file.path).map(|path| path.to_string_lossy().to_string())
                })
                .collect::<Result<Vec<_>, _>>()?;
            if java_files.is_empty() {
                return Err("Java adapter requires at least one .java file".to_string());
            }
            let compile = run_process(
                "javac",
                &java_files,
                root,
                "",
                timeout_ms,
                max_output_bytes,
                "javac",
            )?;
            let compile_output = join_process_output(&compile);
            if compile.timed_out || compile.exit_code != Some(0) {
                return Ok((
                    format_command_label("javac", &java_files),
                    compile_output,
                    compile,
                    true,
                ));
            }
            let main_class = java_main_class(root, &entry)?;
            let mut args = vec!["-cp".to_string(), ".".to_string(), main_class];
            args.extend(request.args.clone());
            let outcome = run_process(
                "java",
                &args,
                root,
                &request.stdin,
                timeout_ms,
                max_output_bytes,
                "java",
            )?;
            Ok((
                format_command_label("java", &args),
                compile_output,
                outcome,
                false,
            ))
        }
        "c" => compile_then_run(
            "cc",
            &native_compile_args(
                entry_text,
                false,
                request.experiment_kind == "security",
                runtime_source_uses_threads(&request.files),
            ),
            root,
            &request.args,
            &request.stdin,
            timeout_ms,
            max_output_bytes,
        ),
        "cpp" => compile_then_run(
            "c++",
            &native_compile_args(
                entry_text,
                true,
                request.experiment_kind == "security",
                runtime_source_uses_threads(&request.files),
            ),
            root,
            &request.args,
            &request.stdin,
            timeout_ms,
            max_output_bytes,
        ),
        _ => Err(format!(
            "controlled runtime adapter {} is unavailable",
            request.adapter
        )),
    }
}

fn native_compile_args(
    entry: String,
    cpp: bool,
    sanitizer: bool,
    concurrency: bool,
) -> Vec<String> {
    let mut args = vec![entry, "-O0".to_string(), "-g".to_string()];
    if cpp {
        args.push("-std=c++17".to_string());
    }
    if sanitizer {
        args.extend([
            if concurrency {
                "-fsanitize=thread,undefined"
            } else {
                "-fsanitize=address,undefined"
            }
            .to_string(),
            "-fno-omit-frame-pointer".to_string(),
        ]);
    }
    args.extend(["-o".to_string(), "codeflow-runtime-bin".to_string()]);
    args
}

fn runtime_source_uses_threads(files: &[ControlledRuntimeFile]) -> bool {
    files.iter().any(|file| {
        let source = file.content.as_str();
        [
            "std::thread",
            "pthread_",
            "<thread>",
            "std::async",
            "dispatch_async",
        ]
        .iter()
        .any(|signal| source.contains(signal))
    })
}

fn compile_then_run(
    compiler: &str,
    compiler_args: &[String],
    root: &Path,
    runtime_args: &[String],
    stdin: &str,
    timeout_ms: u64,
    max_output_bytes: usize,
) -> Result<(String, String, ProcessOutcome, bool), String> {
    let compile = run_process(
        compiler,
        compiler_args,
        root,
        "",
        timeout_ms,
        max_output_bytes,
        "compile",
    )?;
    let compile_output = join_process_output(&compile);
    if compile.timed_out || compile.exit_code != Some(0) {
        return Ok((
            format_command_label(compiler, compiler_args),
            compile_output,
            compile,
            true,
        ));
    }
    let executable = root.join("codeflow-runtime-bin");
    let command = executable.to_string_lossy().to_string();
    let outcome = run_process(
        &command,
        runtime_args,
        root,
        stdin,
        timeout_ms,
        max_output_bytes,
        "execute",
    )?;
    Ok((
        format_command_label(compiler, compiler_args),
        compile_output,
        outcome,
        false,
    ))
}

fn run_process(
    command: &str,
    args: &[String],
    cwd: &Path,
    stdin_text: &str,
    timeout_ms: u64,
    max_output_bytes: usize,
    output_prefix: &str,
) -> Result<ProcessOutcome, String> {
    let before_files = snapshot_files(cwd)?;
    let stdout_path = cwd.join(format!(".codeflow-{output_prefix}-stdout"));
    let stderr_path = cwd.join(format!(".codeflow-{output_prefix}-stderr"));
    let stdout_file = fs::File::create(&stdout_path)
        .map_err(|error| format!("failed to create runtime stdout file: {error}"))?;
    let stderr_file = fs::File::create(&stderr_path)
        .map_err(|error| format!("failed to create runtime stderr file: {error}"))?;
    let sandbox = build_sandbox_plan(command, args, cwd);
    if sandbox.status != "enforced" {
        return Err(format!(
            "local defense refused to execute project code because network-isolating OS sandbox is unavailable: {}",
            sandbox.evidence
        ));
    }
    let mut process = Command::new(&sandbox.command);
    process
        .args(&sandbox.args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .env_clear()
        .env("PATH", controlled_runtime_path())
        .env("LANG", "C.UTF-8")
        .env("LC_ALL", "C.UTF-8")
        .env("CODEFLOW_CONTROLLED_RUNTIME", "1")
        .env("CODEFLOW_TRACE_PATH", cwd.join(".codeflow-trace.ndjson"))
        .env("HOME", cwd)
        .env("TMPDIR", cwd)
        .env("NO_PROXY", "*")
        .env("HTTP_PROXY", "http://127.0.0.1:9")
        .env("HTTPS_PROXY", "http://127.0.0.1:9");
    configure_unix_resource_limits(&mut process, timeout_ms, max_output_bytes)?;
    let started = Instant::now();
    let mut child = process
        .spawn()
        .map_err(|error| format!("failed to start controlled process {command}: {error}"))?;
    let _windows_job = configure_windows_job(&child, timeout_ms)?;
    let root_pid = child.id();
    let mut system = System::new();
    let mut observed = BTreeMap::<u32, ObservedProcess>::new();
    let mut peak_memory_bytes = 0_u64;
    let mut estimated_cpu_ms = 0_f64;
    let mut last_sample = Instant::now();
    if let Some(mut child_stdin) = child.stdin.take() {
        child_stdin
            .write_all(stdin_text.as_bytes())
            .map_err(|error| format!("failed to write runtime stdin: {error}"))?;
    }
    let mut timed_out = false;
    let mut output_limit_exceeded = false;
    let status = loop {
        refresh_process_observations(
            &mut system,
            root_pid,
            &mut observed,
            &mut peak_memory_bytes,
            &mut estimated_cpu_ms,
            last_sample.elapsed(),
        );
        last_sample = Instant::now();
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("failed to poll {command}: {error}"))?
        {
            break status;
        }
        if started.elapsed() >= Duration::from_millis(timeout_ms) {
            timed_out = true;
            child
                .kill()
                .map_err(|error| format!("failed to stop timed-out {command}: {error}"))?;
            break child
                .wait()
                .map_err(|error| format!("failed to reap timed-out {command}: {error}"))?;
        }
        if file_size(&stdout_path).saturating_add(file_size(&stderr_path))
            > (max_output_bytes as u64).saturating_mul(2)
        {
            output_limit_exceeded = true;
            child
                .kill()
                .map_err(|error| format!("failed to stop output-flooding {command}: {error}"))?;
            break child
                .wait()
                .map_err(|error| format!("failed to reap output-flooding {command}: {error}"))?;
        }
        thread::sleep(Duration::from_millis(15));
    };
    refresh_process_observations(
        &mut system,
        root_pid,
        &mut observed,
        &mut peak_memory_bytes,
        &mut estimated_cpu_ms,
        last_sample.elapsed(),
    );
    let (stdout, stdout_truncated) = read_limited(&stdout_path, max_output_bytes)?;
    let (stderr, stderr_truncated) = read_limited(&stderr_path, max_output_bytes)?;
    let after_files = snapshot_files(cwd)?;
    Ok(ProcessOutcome {
        exit_code: status.code(),
        timed_out: timed_out || output_limit_exceeded,
        duration_ms: started.elapsed().as_millis(),
        stdout,
        stderr,
        stdout_truncated,
        stderr_truncated,
        sandbox_kind: sandbox.kind,
        sandbox_status: sandbox.status,
        sandbox_evidence: sandbox.evidence,
        cpu_time_ms: estimated_cpu_ms.max(0.0).round() as u128,
        peak_memory_bytes,
        child_processes: observed.into_values().collect(),
        file_changes: diff_file_snapshots(&before_files, &after_files),
    })
}

fn file_size(path: &Path) -> u64 {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

#[cfg(unix)]
fn configure_unix_resource_limits(
    command: &mut Command,
    timeout_ms: u64,
    _max_output_bytes: usize,
) -> Result<(), String> {
    use std::io;
    use std::os::unix::process::CommandExt;

    let cpu_seconds = timeout_ms.div_ceil(1_000).saturating_add(2) as libc::rlim_t;
    let file_size = 512_u64.saturating_mul(1024 * 1024) as libc::rlim_t;
    let open_files = 256 as libc::rlim_t;
    let limits = vec![
        (libc::RLIMIT_CPU, cpu_seconds),
        (libc::RLIMIT_FSIZE, file_size),
        (libc::RLIMIT_NOFILE, open_files),
    ];
    #[cfg(target_os = "linux")]
    let limits = {
        let mut limits = limits;
        limits.push((
            libc::RLIMIT_AS,
            2_u64.saturating_mul(1024 * 1024 * 1024) as libc::rlim_t,
        ));
        limits
    };
    unsafe {
        command.pre_exec(move || {
            for (resource, limit) in &limits {
                let mut current: libc::rlimit = std::mem::zeroed();
                if libc::getrlimit(*resource, &mut current) != 0 {
                    return Err(io::Error::last_os_error());
                }
                let value = libc::rlimit {
                    rlim_cur: (*limit).min(current.rlim_max),
                    rlim_max: current.rlim_max,
                };
                if libc::setrlimit(*resource, &value) != 0 {
                    return Err(io::Error::last_os_error());
                }
            }
            Ok(())
        });
    }
    Ok(())
}

#[cfg(not(unix))]
fn configure_unix_resource_limits(
    _command: &mut Command,
    _timeout_ms: u64,
    _max_output_bytes: usize,
) -> Result<(), String> {
    Ok(())
}

fn controlled_runtime_path() -> String {
    if cfg!(target_os = "macos") {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_default();
        let mut directories = vec![
            PathBuf::from("/opt/homebrew/opt/openjdk/bin"),
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/opt/homebrew/sbin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
            PathBuf::from("/usr/sbin"),
            PathBuf::from("/sbin"),
        ];
        if !home.as_os_str().is_empty() {
            directories.extend([
                home.join(".cargo/bin"),
                home.join(".local/bin"),
                home.join(".volta/bin"),
                home.join(".pyenv/shims"),
            ]);
        }
        std::env::join_paths(directories)
            .unwrap_or_else(|_| std::ffi::OsString::from("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"))
            .to_string_lossy()
            .to_string()
    } else if cfg!(target_os = "windows") {
        controlled_windows_runtime_path()
    } else {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_default();
        let mut directories = vec![
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
        ];
        if !home.as_os_str().is_empty() {
            directories.extend([home.join(".cargo/bin"), home.join(".local/bin")]);
        }
        std::env::join_paths(directories)
            .unwrap_or_else(|_| std::ffi::OsString::from("/usr/local/bin:/usr/bin:/bin"))
            .to_string_lossy()
            .to_string()
    }
}

fn resolve_runtime_command(command: &str) -> Option<PathBuf> {
    let command_path = Path::new(command);
    if command_path.components().count() > 1 {
        return command_path
            .is_file()
            .then(|| fs::canonicalize(command_path).unwrap_or_else(|_| command_path.to_path_buf()));
    }
    std::env::split_paths(std::ffi::OsStr::new(&controlled_runtime_path()))
        .map(|directory| directory.join(command))
        .find(|candidate| candidate.is_file())
        .map(|candidate| fs::canonicalize(&candidate).unwrap_or(candidate))
}

#[cfg(target_os = "windows")]
fn controlled_windows_runtime_path() -> String {
    let mut allowed_roots = vec![
        PathBuf::from(r"C:\Windows"),
        PathBuf::from(r"C:\Program Files"),
        PathBuf::from(r"C:\Program Files (x86)"),
        PathBuf::from(r"C:\ProgramData\chocolatey\bin"),
    ];
    for name in [
        "USERPROFILE",
        "JAVA_HOME",
        "pythonLocation",
        "Python_ROOT_DIR",
    ] {
        if let Some(path) = std::env::var_os(name).map(PathBuf::from) {
            if name == "USERPROFILE" {
                allowed_roots.push(path.join(".cargo/bin"));
                allowed_roots.push(path.join("AppData/Local/Programs/Python"));
            } else {
                allowed_roots.push(path);
            }
        }
    }
    let mut directories = std::env::var_os("PATH")
        .into_iter()
        .flat_map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
        .filter(|path| path.is_absolute() && path.is_dir())
        .filter(|path| allowed_roots.iter().any(|root| path.starts_with(root)))
        .collect::<Vec<_>>();
    directories.extend(
        [r"C:\Windows\System32", r"C:\Windows"]
            .into_iter()
            .map(PathBuf::from),
    );
    directories.sort();
    directories.dedup();
    std::env::join_paths(directories)
        .unwrap_or_else(|_| std::ffi::OsString::from(r"C:\Windows\System32;C:\Windows"))
        .to_string_lossy()
        .to_string()
}

#[cfg(not(target_os = "windows"))]
fn controlled_windows_runtime_path() -> String {
    String::new()
}

fn platform_sandbox_kind() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos_sandbox"
    } else if cfg!(target_os = "linux") {
        "linux_bubblewrap"
    } else if cfg!(target_os = "windows") {
        "windows_appcontainer_job"
    } else {
        "process_boundary"
    }
}

fn build_sandbox_plan(command: &str, args: &[String], cwd: &Path) -> SandboxPlan {
    #[cfg(target_os = "macos")]
    {
        if !macos_sandbox_available() {
            return SandboxPlan {
                kind: "macos_sandbox".to_string(),
                status: "unavailable".to_string(),
                evidence: "The host rejected a sandbox-exec capability probe. Execution keeps the temporary-copy, timeout and monitoring boundaries, but does not claim OS sandbox enforcement.".to_string(),
                command: command.to_string(),
                args: args.to_vec(),
            };
        }
        let resolved_command =
            resolve_controlled_command(command).unwrap_or_else(|| command.to_string());
        let root = escape_sandbox_literal(&cwd.to_string_lossy());
        let canonical_root = fs::canonicalize(cwd)
            .ok()
            .map(|path| escape_sandbox_literal(&path.to_string_lossy()))
            .unwrap_or_else(|| root.clone());
        let executable = escape_sandbox_literal(&resolved_command);
        let executable_parent = Path::new(&resolved_command)
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .map(|path| escape_sandbox_literal(&path.to_string_lossy()))
            .unwrap_or_else(|| "/__codeflow_no_executable_parent__".to_string());
        let user_text_encoding = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_default()
            .join(".CFUserTextEncoding");
        let user_text_encoding = escape_sandbox_literal(&user_text_encoding.to_string_lossy());
        let profile = format!(
            "(version 1)\n(deny default)\n(allow process*)\n(allow sysctl-read)\n(allow mach-lookup)\n(allow ipc-posix-shm-read-data (ipc-posix-name \"apple.shm.notification_center\"))\n(allow file-read-metadata)\n(allow file-read* (literal \"/\"))\n(allow file-read* (literal \"/dev/dtracehelper\"))\n(allow file-read* (literal \"/dev/autofs_nowait\"))\n(allow file-read* (literal \"{user_text_encoding}\"))\n(allow file-read* (literal \"{executable}\"))\n(allow file-read* (subpath \"{executable_parent}\"))\n(allow file-read* (subpath \"{root}\"))\n(allow file-read* (subpath \"{canonical_root}\"))\n(allow file-read* (subpath \"/System\"))\n(allow file-read* (subpath \"/usr\"))\n(allow file-read* (subpath \"/bin\"))\n(allow file-read* (subpath \"/sbin\"))\n(allow file-read* (subpath \"/opt/homebrew\"))\n(allow file-read* (subpath \"/Library/Developer\"))\n(allow file-read* (subpath \"/private/var/db/dyld\"))\n(allow file-read* (literal \"/private/etc/hosts\"))\n(allow file-read* (literal \"/private/etc/resolv.conf\"))\n(allow file-write-data (literal \"/dev/dtracehelper\"))\n(allow file-ioctl (literal \"/dev/dtracehelper\"))\n(allow file-write* (subpath \"{root}\"))\n(allow file-write* (subpath \"{canonical_root}\"))\n(deny network*)"
        );
        let mut sandbox_args = vec!["-p".to_string(), profile, resolved_command];
        sandbox_args.extend(args.iter().cloned());
        return SandboxPlan {
            kind: "macos_sandbox".to_string(),
            status: "enforced".to_string(),
            evidence:
                "sandbox-exec denies network, clears inherited environment, limits writes to the temporary copy, and restricts reads to the copy plus fixed runtime/SDK roots."
                    .to_string(),
            command: "/usr/bin/sandbox-exec".to_string(),
            args: sandbox_args,
        };
    }
    #[cfg(target_os = "linux")]
    {
        if command_available("bwrap") {
            let root = cwd.to_string_lossy().to_string();
            let mut sandbox_args = vec![
                "--unshare-all".to_string(),
                "--unshare-net".to_string(),
                "--die-with-parent".to_string(),
                "--new-session".to_string(),
                "--cap-drop".to_string(),
                "ALL".to_string(),
                "--ro-bind".to_string(),
                "/".to_string(),
                "/".to_string(),
                "--bind".to_string(),
                root.clone(),
                root.clone(),
                "--chdir".to_string(),
                root,
                "--tmpfs".to_string(),
                "/tmp".to_string(),
                "--proc".to_string(),
                "/proc".to_string(),
                "--dev".to_string(),
                "/dev".to_string(),
                "--".to_string(),
                command.to_string(),
            ];
            sandbox_args.extend(args.iter().cloned());
            return SandboxPlan {
                kind: "linux_bubblewrap".to_string(),
                status: "enforced".to_string(),
                evidence:
                    "bubblewrap unshares user, mount, PID, IPC, UTS, cgroup and network namespaces, drops all capabilities, mounts a private /tmp and keeps only the temporary project copy writable."
                        .to_string(),
                command: "bwrap".to_string(),
                args: sandbox_args,
            };
        }
        return SandboxPlan {
            kind: "linux_bubblewrap".to_string(),
            status: "unavailable".to_string(),
            evidence: "bubblewrap is not installed; execution retains timeout and temporary-copy boundaries but has no namespace isolation.".to_string(),
            command: command.to_string(),
            args: args.to_vec(),
        };
    }
    #[cfg(target_os = "windows")]
    {
        return match windows_appcontainer::prepare_launch(
            command,
            args,
            cwd,
            &controlled_runtime_path(),
        ) {
            Ok((helper, helper_args)) => SandboxPlan {
                kind: "windows_appcontainer_job".to_string(),
                status: "enforced".to_string(),
                evidence: "A zero-capability AppContainer denies network access and limits file writes to the temporary project copy; the enclosing Job Object limits CPU time, memory, process count and terminates the whole process tree on close.".to_string(),
                command: helper,
                args: helper_args,
            },
            Err(error) => SandboxPlan {
                kind: "windows_appcontainer_job".to_string(),
                status: "unavailable".to_string(),
                evidence: format!("Windows AppContainer preparation failed closed: {error}"),
                command: command.to_string(),
                args: args.to_vec(),
            },
        };
    }
    #[allow(unreachable_code)]
    SandboxPlan {
        kind: "process_boundary".to_string(),
        status: "partial".to_string(),
        evidence:
            "Only temporary-copy, timeout and output boundaries are available on this platform."
                .to_string(),
        command: command.to_string(),
        args: args.to_vec(),
    }
}

#[cfg(target_os = "macos")]
fn resolve_controlled_command(command: &str) -> Option<String> {
    resolve_runtime_command(command).map(|candidate| candidate.to_string_lossy().to_string())
}

#[cfg(target_os = "macos")]
fn escape_sandbox_literal(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(target_os = "macos")]
fn macos_sandbox_available() -> bool {
    Command::new("/usr/bin/sandbox-exec")
        .args(["-p", "(version 1)\n(allow default)", "/usr/bin/true"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn command_available(command: &str) -> bool {
    Command::new(command)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn refresh_process_observations(
    system: &mut System,
    root_pid: u32,
    observed: &mut BTreeMap<u32, ObservedProcess>,
    peak_memory_bytes: &mut u64,
    estimated_cpu_ms: &mut f64,
    elapsed: Duration,
) {
    system.refresh_processes(ProcessesToUpdate::All, true);
    let mut included = BTreeSet::from([root_pid]);
    loop {
        let before = included.len();
        for (pid, process) in system.processes() {
            if process
                .parent()
                .map(|parent| included.contains(&parent.as_u32()))
                .unwrap_or(false)
            {
                included.insert(pid.as_u32());
            }
        }
        if included.len() == before {
            break;
        }
    }
    for pid in included {
        let Some(process) = system.process(Pid::from_u32(pid)) else {
            continue;
        };
        let memory = process.memory();
        *peak_memory_bytes = (*peak_memory_bytes).max(memory);
        *estimated_cpu_ms += f64::from(process.cpu_usage()) * elapsed.as_secs_f64() * 10.0;
        let entry = observed.entry(pid).or_insert_with(|| ObservedProcess {
            pid,
            parent_pid: process.parent().map(|parent| parent.as_u32()),
            name: process.name().to_string_lossy().to_string(),
            cpu_time_ms: 0,
            peak_memory_bytes: memory,
        });
        entry.cpu_time_ms +=
            (f64::from(process.cpu_usage()) * elapsed.as_secs_f64() * 10.0).round() as u128;
        entry.peak_memory_bytes = entry.peak_memory_bytes.max(memory);
    }
}

fn snapshot_files(root: &Path) -> Result<BTreeMap<String, FileFingerprint>, String> {
    let mut result = BTreeMap::new();
    snapshot_directory(root, root, &mut result)?;
    Ok(result)
}

fn snapshot_directory(
    root: &Path,
    directory: &Path,
    result: &mut BTreeMap<String, FileFingerprint>,
) -> Result<(), String> {
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("failed to inspect runtime directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("failed to inspect runtime entry: {error}"))?;
        let path = entry.path();
        let metadata = entry
            .metadata()
            .map_err(|error| format!("failed to inspect runtime metadata: {error}"))?;
        if metadata.is_dir() {
            snapshot_directory(root, &path, result)?;
        } else if metadata.is_file() {
            let relative = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string();
            if relative.starts_with(".codeflow-") {
                continue;
            }
            let modified_ns = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| value.as_nanos())
                .unwrap_or(0);
            result.insert(
                relative,
                FileFingerprint {
                    bytes: metadata.len(),
                    modified_ns,
                },
            );
        }
    }
    Ok(())
}

fn diff_file_snapshots(
    before: &BTreeMap<String, FileFingerprint>,
    after: &BTreeMap<String, FileFingerprint>,
) -> Vec<FileChange> {
    let paths = before
        .keys()
        .chain(after.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    paths
        .into_iter()
        .filter_map(|path| match (before.get(&path), after.get(&path)) {
            (None, Some(current)) => Some(FileChange {
                path,
                kind: "created".to_string(),
                before_bytes: None,
                after_bytes: Some(current.bytes),
            }),
            (Some(previous), None) => Some(FileChange {
                path,
                kind: "deleted".to_string(),
                before_bytes: Some(previous.bytes),
                after_bytes: None,
            }),
            (Some(previous), Some(current))
                if previous.bytes != current.bytes
                    || previous.modified_ns != current.modified_ns =>
            {
                Some(FileChange {
                    path,
                    kind: "modified".to_string(),
                    before_bytes: Some(previous.bytes),
                    after_bytes: Some(current.bytes),
                })
            }
            _ => None,
        })
        .collect()
}

#[cfg(not(target_os = "windows"))]
fn configure_windows_job(
    _child: &std::process::Child,
    _timeout_ms: u64,
) -> Result<Option<()>, String> {
    Ok(None)
}

#[cfg(target_os = "windows")]
struct WindowsJob(windows_sys::Win32::Foundation::HANDLE);

#[cfg(target_os = "windows")]
impl Drop for WindowsJob {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

#[cfg(target_os = "windows")]
fn configure_windows_job(
    child: &std::process::Child,
    timeout_ms: u64,
) -> Result<Option<WindowsJob>, String> {
    use std::mem::{size_of, zeroed};
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_JOB_MEMORY,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
        JOB_OBJECT_LIMIT_PROCESS_TIME,
    };
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err("failed to create Windows Job Object".to_string());
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
            | JOB_OBJECT_LIMIT_PROCESS_MEMORY
            | JOB_OBJECT_LIMIT_JOB_MEMORY
            | JOB_OBJECT_LIMIT_PROCESS_TIME;
        limits.BasicLimitInformation.ActiveProcessLimit = 64;
        limits.BasicLimitInformation.PerProcessUserTimeLimit =
            timeout_ms.saturating_add(2_000).saturating_mul(10_000) as i64;
        limits.ProcessMemoryLimit = 1024 * 1024 * 1024;
        limits.JobMemoryLimit = 2 * 1024 * 1024 * 1024;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const _,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
        {
            windows_sys::Win32::Foundation::CloseHandle(job);
            return Err("failed to configure Windows Job Object".to_string());
        }
        if AssignProcessToJobObject(job, child.as_raw_handle() as _) == 0 {
            windows_sys::Win32::Foundation::CloseHandle(job);
            return Err("failed to assign process to Windows Job Object".to_string());
        }
        Ok(Some(WindowsJob(job)))
    }
}

fn persist_runtime_report(
    app: &AppHandle,
    report: &ControlledRuntimeExecutionReport,
) -> Result<(), String> {
    with_database(app, |conn, _| {
        conn.execute(
            "INSERT OR REPLACE INTO runtime_execution_runs
             (id, project_id, project_name, adapter, status, evidence_grade, experiment_kind, sample_id,
              repetition, input_bytes, trace_events, trace_source, sanitizer_status, sanitizer_findings, entry_path, command_label,
             exit_code, timed_out, duration_ms, stdout, stderr, stdout_truncated, stderr_truncated,
              compile_output, file_count, total_bytes, sandbox_kind, sandbox_status, sandbox_evidence,
              cpu_time_ms, peak_memory_bytes, child_process_count, child_processes, file_changes,
              isolation, evidence, started_at, finished_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34, ?35, ?36, ?37, ?38);",
            rusqlite::params![
                report.id,
                report.project_id,
                report.project_name,
                report.adapter,
                report.status,
                report.evidence_grade,
                report.experiment_kind,
                report.sample_id,
                report.repetition as i64,
                report.input_bytes as i64,
                serde_json::to_string(&report.trace_events).unwrap_or_else(|_| "[]".to_string()),
                report.trace_source,
                report.sanitizer_status,
                serde_json::to_string(&report.sanitizer_findings).unwrap_or_else(|_| "[]".to_string()),
                report.entry_path,
                report.command_label,
                report.exit_code,
                report.timed_out,
                report.duration_ms as i64,
                report.stdout,
                report.stderr,
                report.stdout_truncated,
                report.stderr_truncated,
                report.compile_output,
                report.file_count as i64,
                report.total_bytes as i64,
                report.sandbox_kind,
                report.sandbox_status,
                report.sandbox_evidence,
                report.cpu_time_ms as i64,
                report.peak_memory_bytes as i64,
                report.child_process_count as i64,
                serde_json::to_string(&report.child_processes)
                    .unwrap_or_else(|_| "[]".to_string()),
                serde_json::to_string(&report.file_changes)
                    .unwrap_or_else(|_| "[]".to_string()),
                serde_json::to_string(&report.isolation).unwrap_or_else(|_| "[]".to_string()),
                serde_json::to_string(&report.evidence).unwrap_or_else(|_| "[]".to_string()),
                report.started_at as i64,
                report.finished_at as i64,
            ],
        )
        .map_err(|error| format!("failed to persist controlled runtime report: {error}"))?;
        enforce_native_database_retention(conn)?;
        Ok(())
    })
}

fn safe_relative_path(value: &str) -> Result<PathBuf, String> {
    if value.trim().is_empty() || value.len() > 1024 || value.contains('\0') {
        return Err("controlled runtime rejected invalid file path".to_string());
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(format!(
            "controlled runtime rejected path outside project: {value}"
        ));
    }
    Ok(path.to_path_buf())
}

fn java_main_class(root: &Path, entry: &Path) -> Result<String, String> {
    let source = fs::read_to_string(root.join(entry))
        .map_err(|error| format!("failed to read Java entry: {error}"))?;
    let package = source
        .lines()
        .map(str::trim)
        .find_map(|line| {
            line.strip_prefix("package ")
                .and_then(|value| value.strip_suffix(';'))
        })
        .map(str::trim);
    let class = entry
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "failed to infer Java main class".to_string())?;
    Ok(package
        .map(|value| format!("{value}.{class}"))
        .unwrap_or_else(|| class.to_string()))
}

fn read_limited(path: &Path, max_bytes: usize) -> Result<(String, bool), String> {
    let file =
        fs::File::open(path).map_err(|error| format!("failed to open runtime output: {error}"))?;
    let size = file
        .metadata()
        .map(|metadata| metadata.len() as usize)
        .unwrap_or_default();
    let mut buffer = Vec::new();
    file.take((max_bytes + 1) as u64)
        .read_to_end(&mut buffer)
        .map_err(|error| format!("failed to read runtime output: {error}"))?;
    let truncated = size > max_bytes || buffer.len() > max_bytes;
    buffer.truncate(max_bytes);
    Ok((String::from_utf8_lossy(&buffer).to_string(), truncated))
}

fn join_process_output(outcome: &ProcessOutcome) -> String {
    [outcome.stdout.trim(), outcome.stderr.trim()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn runtime_isolation() -> Vec<String> {
    let platform_boundary = if cfg!(target_os = "macos") {
        "macOS sandbox-exec denies external network and restricts writes to the temporary project copy"
    } else if cfg!(target_os = "linux") {
        "Linux bubblewrap unshares the network and process namespaces, drops capabilities and restricts writes to the temporary project copy"
    } else if cfg!(target_os = "windows") {
        "Windows zero-capability AppContainer denies network access; Job Object limits and reaps the process tree"
    } else {
        "unsupported operating systems fail closed before project code executes"
    };
    vec![
        "manual execution only".to_string(),
        "fixed adapter command; no shell".to_string(),
        "temporary project copy".to_string(),
        "path traversal rejected".to_string(),
        "CPU time, memory, process count, timeout and output limits".to_string(),
        platform_boundary.to_string(),
        "Cargo, Maven and Gradle dependency resolution is forced offline".to_string(),
    ]
}

fn format_command_label(command: &str, args: &[String]) -> String {
    let visible_args = args
        .iter()
        .take(8)
        .map(|arg| {
            if arg.chars().count() > 80 {
                format!("{}…", arg.chars().take(80).collect::<String>())
            } else {
                arg.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    format!("{command} {visible_args}").trim().to_string()
}

fn first_nonempty_line(value: &str) -> String {
    value
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or_default()
        .trim()
        .chars()
        .take(160)
        .collect()
}

fn safe_identifier(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    if sanitized.is_empty() {
        "project".to_string()
    } else {
        sanitized
    }
}

fn sync_rows(
    app: AppHandle,
    writer_kind: &str,
    rows: Vec<NativeSqliteRow>,
) -> Result<NativeSqliteReport, String> {
    if rows.is_empty() {
        return with_database(&app, |conn, db_path| {
            Ok(report(
                "warming",
                writer_kind,
                0,
                count_known_tables(conn)?,
                db_path,
                "no rows were provided to the native SQLite writer",
            ))
        });
    }

    with_database(&app, |conn, db_path| {
        apply_insert_rows(conn, &rows)?;
        record_writer_event(conn, writer_kind, rows.len(), &db_path)?;
        enforce_native_database_retention(conn)?;
        Ok(report(
            "synced",
            writer_kind,
            rows.len(),
            count_known_tables(conn)?,
            db_path,
            &format!(
                "native SQLite writer {writer_kind} synced {} rows",
                rows.len()
            ),
        ))
    })
}

fn load_workspace_snapshot(conn: &Connection) -> Result<Option<NativeWorkspacePayload>, String> {
    let mut project_statement = conn
        .prepare(
            "SELECT id, name, source, created_at, updated_at
             FROM workspace_projects
             ORDER BY updated_at DESC, id ASC",
        )
        .map_err(|error| format!("failed to prepare native workspace project query: {error}"))?;
    let mut projects = project_statement
        .query_map([], |row| {
            Ok(NativeWorkspaceProject {
                id: row.get(0)?,
                name: row.get(1)?,
                files: Vec::new(),
                source: row.get(2)?,
                created_at: row.get::<_, i64>(3)?.max(0) as u128,
                updated_at: row.get::<_, i64>(4)?.max(0) as u128,
            })
        })
        .map_err(|error| format!("failed to read native workspace projects: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to collect native workspace projects: {error}"))?;
    drop(project_statement);
    if projects.is_empty() {
        return Ok(None);
    }

    let mut project_index = projects
        .iter()
        .enumerate()
        .map(|(index, project)| (project.id.clone(), index))
        .collect::<BTreeMap<_, _>>();
    let mut file_statement = conn
        .prepare(
            "SELECT id, project_id, path, language, content, hash, size, last_modified,
                    imports, environment_refs, device_refs
             FROM workspace_project_files
             ORDER BY project_id ASC, path ASC",
        )
        .map_err(|error| format!("failed to prepare native workspace file query: {error}"))?;
    let file_rows = file_statement
        .query_map([], |row| {
            let imports: String = row.get(8)?;
            let environment_refs: String = row.get(9)?;
            let device_refs: String = row.get(10)?;
            Ok((
                row.get::<_, String>(1)?,
                NativeWorkspaceFile {
                    id: row.get(0)?,
                    name: row.get(2)?,
                    language: row.get(3)?,
                    content: row.get(4)?,
                    hash: row.get(5)?,
                    size: row.get::<_, i64>(6)?.max(0) as u64,
                    last_modified: row
                        .get::<_, Option<i64>>(7)?
                        .map(|value| value.max(0) as u128),
                    imports: decode_string_list(&imports),
                    environment_refs: decode_string_list(&environment_refs),
                    device_refs: decode_string_list(&device_refs),
                },
            ))
        })
        .map_err(|error| format!("failed to read native workspace files: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to collect native workspace files: {error}"))?;
    drop(file_statement);
    for (project_id, file) in file_rows {
        if let Some(index) = project_index.remove(&project_id) {
            projects[index].files.push(file);
            project_index.insert(project_id, index);
        }
    }
    projects.retain(|project| !project.files.is_empty());
    if projects.is_empty() {
        return Ok(None);
    }

    let active_project_id = conn
        .query_row(
            "SELECT active_project_id FROM workspace_project_state
             WHERE id = 'active-workspace' LIMIT 1",
            [],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| format!("failed to load native active workspace: {error}"))?
        .flatten()
        .filter(|id| projects.iter().any(|project| &project.id == id))
        .or_else(|| projects.first().map(|project| project.id.clone()));
    let saved_at = projects
        .iter()
        .map(|project| project.updated_at)
        .max()
        .unwrap_or(0);
    Ok(Some(NativeWorkspacePayload {
        version: 2,
        projects,
        active_project_id,
        saved_at,
    }))
}

fn decode_string_list(value: &str) -> Vec<String> {
    serde_json::from_str(value).unwrap_or_default()
}

fn replace_workspace_rows(conn: &mut Connection, rows: &[NativeSqliteRow]) -> Result<(), String> {
    let allowed = [
        "workspace_projects",
        "workspace_project_files",
        "workspace_project_state",
    ];
    if let Some(row) = rows
        .iter()
        .find(|row| !allowed.contains(&row.table_name.as_str()))
    {
        return Err(format!(
            "native SQLite workspace writer rejected table {}",
            row.table_name
        ));
    }
    let tx = conn
        .transaction()
        .map_err(|error| format!("failed to begin native workspace transaction: {error}"))?;
    tx.execute_batch(
        "DELETE FROM workspace_project_files;
         DELETE FROM workspace_project_state;
         DELETE FROM workspace_projects;",
    )
    .map_err(|error| format!("failed to clear previous native workspace snapshot: {error}"))?;
    insert_rows_in_transaction(&tx, rows)?;
    tx.commit()
        .map_err(|error| format!("failed to commit native workspace snapshot: {error}"))?;
    Ok(())
}

fn with_database<T>(
    app: &AppHandle,
    action: impl FnOnce(&mut Connection, PathBuf) -> Result<T, String>,
) -> Result<T, String> {
    let db_path = database_path(app)?;
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create native data directory: {error}"))?;
    }
    let mut conn = Connection::open(&db_path)
        .map_err(|error| format!("failed to open native SQLite database: {error}"))?;
    initialize_native_database(&conn, &db_path)?;
    enforce_native_database_retention(&conn)?;
    if database_total_bytes(&db_path) > MAX_NATIVE_DATABASE_BYTES {
        return Err(format!(
            "native SQLite reached the {} MB safety ceiling; cache history was pruned and this write was refused to protect the device",
            MAX_NATIVE_DATABASE_BYTES / 1024 / 1024
        ));
    }
    action(&mut conn, db_path)
}

fn enforce_native_database_retention(conn: &Connection) -> Result<(), String> {
    for (table, order_column, limit) in [
        ("runtime_execution_runs", "finished_at", MAX_RUNTIME_HISTORY_ROWS),
        ("formal_verification_runs", "created_at", MAX_FORMAL_HISTORY_ROWS),
        ("native_sqlite_writes", "created_at", MAX_WRITER_EVENT_ROWS),
    ] {
        conn.execute_batch(&format!(
            "DELETE FROM {table} WHERE rowid NOT IN (SELECT rowid FROM {table} ORDER BY {order_column} DESC LIMIT {limit});"
        ))
        .map_err(|error| format!("failed to apply retention to {table}: {error}"))?;
    }
    conn.execute_batch("PRAGMA wal_checkpoint(PASSIVE);")
        .map_err(|error| format!("failed to checkpoint SQLite retention: {error}"))?;
    Ok(())
}

fn database_total_bytes(db_path: &Path) -> u64 {
    database_files(db_path)
        .iter()
        .filter_map(|path| fs::metadata(path).ok().map(|metadata| metadata.len()))
        .sum()
}

fn cleanup_stale_runtime_cache(app: &AppHandle) -> Result<(), String> {
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("failed to resolve app cache directory: {error}"))?;
    for directory in TEMP_CACHE_DIRECTORIES {
        let path = cache_root.join(directory);
        if path.exists() {
            fs::remove_dir_all(&path)
                .map_err(|error| format!("failed to release stale cache {}: {error}", path.display()))?;
        }
    }
    Ok(())
}

fn initialize_native_database(conn: &Connection, db_path: &Path) -> Result<(), String> {
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("failed to configure SQLite busy timeout: {error}"))?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = FULL;
         PRAGMA wal_autocheckpoint = 1000;",
    )
    .map_err(|error| format!("failed to configure native SQLite safety mode: {error}"))?;
    let integrity = conn
        .query_row("PRAGMA quick_check;", [], |row| row.get::<_, String>(0))
        .map_err(|error| format!("failed to run native SQLite integrity check: {error}"))?;
    if integrity != "ok" {
        return Err(format!(
            "native SQLite integrity check failed ({integrity}); the database was left untouched"
        ));
    }
    let current_version = conn
        .query_row("PRAGMA user_version;", [], |row| row.get::<_, u32>(0))
        .map_err(|error| format!("failed to read native SQLite schema version: {error}"))?;
    if current_version > DATABASE_SCHEMA_VERSION {
        return Err(format!(
            "native SQLite schema {current_version} is newer than supported schema {DATABASE_SCHEMA_VERSION}"
        ));
    }
    if current_version < DATABASE_SCHEMA_VERSION {
        create_migration_backup(conn, db_path, current_version)?;
    }
    conn.execute_batch(NATIVE_SCHEMA)
        .map_err(|error| format!("failed to initialize native SQLite schema: {error}"))?;
    knowledge_pack::ensure_schema(conn)?;
    network_policy::ensure_schema(conn)?;
    ensure_runtime_observability_columns(conn)?;
    ensure_security_assertion_columns(conn)?;
    ensure_precise_flow_columns(conn)?;
    ensure_deepweb_model_columns(conn)?;
    ensure_formal_verification_columns(conn)?;
    if current_version < DATABASE_SCHEMA_VERSION {
        conn.execute(
            "INSERT OR REPLACE INTO native_schema_migrations
             (version, previous_version, status, evidence, applied_at)
             VALUES (?1, ?2, 'applied', ?3, ?4)",
            rusqlite::params![
                DATABASE_SCHEMA_VERSION,
                current_version,
                format!("schema migrated from {current_version} to {DATABASE_SCHEMA_VERSION}"),
                now_ms() as i64,
            ],
        )
        .map_err(|error| format!("failed to record native SQLite migration: {error}"))?;
        conn.pragma_update(None, "user_version", DATABASE_SCHEMA_VERSION)
            .map_err(|error| format!("failed to commit native SQLite schema version: {error}"))?;
    }
    Ok(())
}

fn create_migration_backup(
    conn: &Connection,
    db_path: &Path,
    current_version: u32,
) -> Result<(), String> {
    let table_count = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
            [],
            |row| row.get::<_, u32>(0),
        )
        .unwrap_or_default();
    if !db_path.is_file()
        || table_count == 0
        || fs::metadata(db_path)
            .map(|metadata| metadata.len() == 0)
            .unwrap_or(true)
    {
        return Ok(());
    }
    conn.execute_batch("PRAGMA wal_checkpoint(FULL);")
        .map_err(|error| format!("failed to checkpoint SQLite before migration: {error}"))?;
    let backup = db_path.with_file_name(format!(
        "{DATABASE_FILE}.pre-v{current_version}-{}.bak",
        now_ms()
    ));
    fs::copy(db_path, &backup).map_err(|error| {
        format!(
            "failed to create pre-migration SQLite backup {}: {error}",
            backup.display()
        )
    })?;
    Ok(())
}

fn database_files(db_path: &Path) -> [PathBuf; 3] {
    [
        db_path.to_path_buf(),
        PathBuf::from(format!("{}-wal", db_path.display())),
        PathBuf::from(format!("{}-shm", db_path.display())),
    ]
}

#[tauri::command]
async fn codeflow_import_knowledge_pack(
    app: AppHandle,
    policy: State<'_, network_policy::NetworkPolicyState>,
    request: knowledge_pack::KnowledgePackImportRequest,
) -> Result<knowledge_pack::KnowledgePackStatusReport, String> {
    let permit = policy.permit()?;
    knowledge_pack::import_pack(app, request, permit).await
}

#[tauri::command]
fn codeflow_network_policy_status(
    policy: State<'_, network_policy::NetworkPolicyState>,
) -> network_policy::NetworkPolicyReport {
    policy.report()
}

#[tauri::command]
fn codeflow_set_network_policy(
    app: AppHandle,
    policy: State<'_, network_policy::NetworkPolicyState>,
    enabled: bool,
) -> Result<network_policy::NetworkPolicyReport, String> {
    network_policy::set_policy(&app, &policy, enabled)
}

#[tauri::command]
fn codeflow_validate_private_endpoint(
    policy: State<'_, network_policy::NetworkPolicyState>,
    host: String,
) -> Result<String, String> {
    policy.require_private_endpoint(&host).map(|address| address.to_string())
}

#[tauri::command]
fn codeflow_knowledge_pack_status(
    app: AppHandle,
) -> Result<knowledge_pack::KnowledgePackStatusReport, String> {
    knowledge_pack::status(&app)
}

#[tauri::command]
fn codeflow_activate_knowledge_pack(
    app: AppHandle,
    pack_id: String,
) -> Result<knowledge_pack::KnowledgePackStatusReport, String> {
    knowledge_pack::activate(&app, &pack_id)
}

#[tauri::command]
fn codeflow_rollback_knowledge_pack(
    app: AppHandle,
) -> Result<knowledge_pack::KnowledgePackStatusReport, String> {
    knowledge_pack::rollback(&app)
}

#[tauri::command]
fn codeflow_import_supplemental_knowledge(
    app: AppHandle,
    request: knowledge_pack::SupplementalKnowledgeImportRequest,
) -> Result<knowledge_pack::SupplementalKnowledgeReport, String> {
    knowledge_pack::import_supplemental_bundle(&app, request)
}

#[tauri::command]
fn codeflow_activate_supplemental_knowledge(
    app: AppHandle,
    bundle_id: String,
) -> Result<knowledge_pack::SupplementalKnowledgeReport, String> {
    knowledge_pack::activate_supplemental_bundle(&app, &bundle_id)
}

#[tauri::command]
fn codeflow_match_project_dependencies(
    app: AppHandle,
    dependencies: Vec<knowledge_pack::ProjectDependencyInput>,
) -> Result<knowledge_pack::ProjectKnowledgeMatchReport, String> {
    knowledge_pack::match_project_dependencies(&app, dependencies)
}

#[tauri::command]
fn codeflow_sync_security_assertions(
    app: AppHandle,
    rows: Vec<NativeSqliteRow>,
) -> Result<NativeSqliteReport, String> {
    sync_rows(app, "security_assertions", rows)
}

#[tauri::command]
fn codeflow_security_corpus_history(app: AppHandle) -> Result<SecurityCorpusHistoryReport, String> {
    with_database(&app, |conn, _| {
        let project_count = conn
            .query_row(
                "SELECT COUNT(DISTINCT project_id) FROM security_assertion_runs",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| format!("failed to count security projects: {error}"))?
            .max(0) as usize;
        let (replay_count, conclusive_count, minimum_created, maximum_created) = conn.query_row(
            "SELECT COUNT(*), SUM(CASE WHEN status IN ('passed','failed') THEN 1 ELSE 0 END), MIN(created_at), MAX(created_at) FROM security_assertion_runs",
            [], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?.unwrap_or(0), row.get::<_, Option<i64>>(2)?, row.get::<_, Option<i64>>(3)?)),
        ).map_err(|error| format!("failed to summarize security replays: {error}"))?;
        let minimum_case_replay_count = conn.query_row(
            "SELECT COALESCE(MIN(case_count), 0) FROM (SELECT COUNT(*) AS case_count FROM security_assertion_runs GROUP BY sample_id)",
            [], |row| row.get::<_, i64>(0),
        ).map_err(|error| format!("failed to count per-case replays: {error}"))?.max(0) as usize;
        let mut frameworks = BTreeSet::new();
        let mut statement = conn
            .prepare("SELECT framework_hints FROM security_assertion_runs")
            .map_err(|error| format!("failed to inspect replay frameworks: {error}"))?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| format!("failed to read replay frameworks: {error}"))?;
        for encoded in rows {
            for framework in decode_string_list(
                &encoded
                    .map_err(|error| format!("failed to decode attack framework row: {error}"))?,
            ) {
                if framework != "all" {
                    frameworks.insert(framework);
                }
            }
        }
        let replay_span_days = match (minimum_created, maximum_created) {
            (Some(first), Some(last)) if last > first => ((last - first) as u64) / 86_400_000,
            _ => 0,
        };
        let replay_count = replay_count.max(0) as usize;
        let conclusive_rate = if replay_count == 0 {
            0
        } else {
            ((conclusive_count.max(0) as usize * 100) / replay_count) as u32
        };
        let framework_count = frameworks.len();
        let stable_teacher_eligible = project_count >= 20
            && framework_count >= 5
            && replay_span_days >= 30
            && minimum_case_replay_count >= 3
            && conclusive_rate >= 95;
        Ok(SecurityCorpusHistoryReport {
            project_count, framework_count, replay_span_days, replay_count, minimum_case_replay_count, conclusive_rate, stable_teacher_eligible,
            evidence: vec![
                format!("SQLite 历史包含 {project_count} 个项目、{framework_count} 个框架、{replay_count} 次回放。"),
                format!("跨度 {replay_span_days} 天，单案例最少复测 {minimum_case_replay_count} 次，动态结论率 {conclusive_rate}%。"),
                if stable_teacher_eligible { "达到稳定老师历史门禁。".to_string() } else { "未同时达到 20 项目 / 5 框架 / 30 天 / 每案例 3 次 / 95% 结论率门禁。".to_string() },
            ],
        })
    })
}

fn ensure_security_assertion_columns(conn: &Connection) -> Result<(), String> {
    let mut statement = conn
        .prepare("PRAGMA table_info(security_assertion_runs);")
        .map_err(|error| format!("failed to inspect security assertion schema: {error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("failed to read security assertion schema: {error}"))?
        .collect::<Result<BTreeSet<_>, _>>()
        .map_err(|error| format!("failed to collect security assertion schema: {error}"))?;
    drop(statement);
    if !columns.contains("framework_hints") {
        conn.execute_batch("ALTER TABLE security_assertion_runs ADD COLUMN framework_hints TEXT NOT NULL DEFAULT '[]';")
            .map_err(|error| format!("failed to add security replay framework evidence: {error}"))?;
    }
    Ok(())
}

fn ensure_runtime_observability_columns(conn: &Connection) -> Result<(), String> {
    let mut statement = conn
        .prepare("PRAGMA table_info(runtime_execution_runs);")
        .map_err(|error| format!("failed to inspect runtime schema: {error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("failed to read runtime schema: {error}"))?
        .collect::<Result<BTreeSet<_>, _>>()
        .map_err(|error| format!("failed to collect runtime schema: {error}"))?;
    drop(statement);
    let migrations = [
        ("sandbox_kind", "TEXT NOT NULL DEFAULT 'process_boundary'"),
        ("sandbox_status", "TEXT NOT NULL DEFAULT 'unavailable'"),
        ("sandbox_evidence", "TEXT NOT NULL DEFAULT ''"),
        ("cpu_time_ms", "INTEGER NOT NULL DEFAULT 0"),
        ("peak_memory_bytes", "INTEGER NOT NULL DEFAULT 0"),
        ("child_process_count", "INTEGER NOT NULL DEFAULT 0"),
        ("child_processes", "TEXT NOT NULL DEFAULT '[]'"),
        ("file_changes", "TEXT NOT NULL DEFAULT '[]'"),
        ("experiment_kind", "TEXT NOT NULL DEFAULT 'baseline'"),
        ("sample_id", "TEXT NOT NULL DEFAULT 'baseline-user-input'"),
        ("repetition", "INTEGER NOT NULL DEFAULT 1"),
        ("input_bytes", "INTEGER NOT NULL DEFAULT 0"),
        ("trace_events", "TEXT NOT NULL DEFAULT '[]'"),
        ("trace_source", "TEXT NOT NULL DEFAULT 'none'"),
        ("sanitizer_status", "TEXT NOT NULL DEFAULT 'not-requested'"),
        ("sanitizer_findings", "TEXT NOT NULL DEFAULT '[]'"),
    ];
    for (column, definition) in migrations {
        if !columns.contains(column) {
            conn.execute_batch(&format!(
                "ALTER TABLE runtime_execution_runs ADD COLUMN {column} {definition};"
            ))
            .map_err(|error| format!("failed to add runtime column {column}: {error}"))?;
        }
    }
    Ok(())
}

fn ensure_precise_flow_columns(conn: &Connection) -> Result<(), String> {
    let columns = table_columns(conn, "flow_edges")?;
    let migrations = [
        ("transfer_kind", "TEXT NOT NULL DEFAULT 'unknown'"),
        ("data_items", "TEXT NOT NULL DEFAULT '[]'"),
        ("source_kind", "TEXT NOT NULL DEFAULT 'unknown'"),
        ("sink_kind", "TEXT NOT NULL DEFAULT 'unknown'"),
        ("evidence_grade", "TEXT NOT NULL DEFAULT 'lexical'"),
        ("runtime_observation", "TEXT"),
    ];
    for (column, definition) in migrations {
        if !columns.contains(column) {
            conn.execute_batch(&format!(
                "ALTER TABLE flow_edges ADD COLUMN {column} {definition};"
            ))
            .map_err(|error| format!("failed to add precise flow column {column}: {error}"))?;
        }
    }
    Ok(())
}

fn ensure_deepweb_model_columns(conn: &Connection) -> Result<(), String> {
    let columns = table_columns(conn, "deepweb_model_versions")?;
    if !columns.contains("network_parameters") {
        conn.execute_batch(
            "ALTER TABLE deepweb_model_versions ADD COLUMN network_parameters TEXT;",
        )
        .map_err(|error| format!("failed to add DeepWeb network parameters column: {error}"))?;
    }
    Ok(())
}

fn ensure_formal_verification_columns(conn: &Connection) -> Result<(), String> {
    let columns = table_columns(conn, "formal_verification_runs")?;
    for (column, definition) in [
        ("file_name", "TEXT"),
        ("function_id", "TEXT"),
        ("line", "INTEGER"),
        ("counterexample", "TEXT"),
        ("call_chain", "TEXT NOT NULL DEFAULT '[]'"),
    ] {
        if !columns.contains(column) {
            conn.execute_batch(&format!(
                "ALTER TABLE formal_verification_runs ADD COLUMN {column} {definition};"
            ))
            .map_err(|error| {
                format!("failed to add formal verification column {column}: {error}")
            })?;
        }
    }
    Ok(())
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve native app data directory: {error}"))?;
    Ok(dir.join(DATABASE_FILE))
}

fn apply_insert_rows(conn: &mut Connection, rows: &[NativeSqliteRow]) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|error| format!("failed to begin native SQLite transaction: {error}"))?;
    insert_rows_in_transaction(&tx, rows)?;
    tx.commit()
        .map_err(|error| format!("failed to commit native SQLite transaction: {error}"))?;
    Ok(())
}

fn insert_rows_in_transaction(
    tx: &Transaction<'_>,
    rows: &[NativeSqliteRow],
) -> Result<(), String> {
    for row in rows {
        validate_row(row)?;
        let payload = row.payload.as_object().ok_or_else(|| {
            format!(
                "native SQLite rejected non-object payload for {}",
                row.table_name
            )
        })?;
        let allowed_columns = table_columns(&tx, &row.table_name)?;
        let mut entries = payload.iter().collect::<Vec<_>>();
        entries.sort_by(|a, b| a.0.cmp(b.0));
        for (column, _) in &entries {
            if !allowed_columns.contains(column.as_str()) {
                return Err(format!(
                    "native SQLite rejected unknown column {}.{}",
                    row.table_name, column
                ));
            }
        }
        let columns = entries
            .iter()
            .map(|(column, _)| format!("\"{column}\""))
            .collect::<Vec<_>>()
            .join(", ");
        let placeholders = (1..=entries.len())
            .map(|index| format!("?{index}"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "INSERT OR REPLACE INTO \"{}\" ({columns}) VALUES ({placeholders})",
            row.table_name
        );
        let values = entries
            .iter()
            .map(|(_, value)| json_to_sql_value(value))
            .collect::<Vec<_>>();
        tx.execute(&sql, params_from_iter(values))
            .map_err(|error| {
                format!(
                    "failed to execute native SQLite row {}.{}: {error}",
                    row.table_name, row.primary_key
                )
            })?;
    }
    Ok(())
}

fn validate_row(row: &NativeSqliteRow) -> Result<(), String> {
    if !KNOWN_TABLES.contains(&row.table_name.as_str()) {
        return Err(format!(
            "native SQLite rejected unknown table {}",
            row.table_name
        ));
    }
    if row.primary_key.trim().is_empty() {
        return Err(format!(
            "native SQLite rejected empty primary key for {}",
            row.table_name
        ));
    }
    if !row.payload.is_object() {
        return Err(format!(
            "native SQLite rejected non-object payload for {}",
            row.table_name
        ));
    }
    Ok(())
}

fn table_columns(conn: &Connection, table_name: &str) -> Result<BTreeSet<String>, String> {
    let mut statement = conn
        .prepare(&format!("PRAGMA table_info(\"{table_name}\");"))
        .map_err(|error| format!("failed to inspect native table {table_name}: {error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("failed to read native table {table_name}: {error}"))?
        .collect::<Result<BTreeSet<_>, _>>()
        .map_err(|error| format!("failed to collect native table {table_name} columns: {error}"))?;
    Ok(columns)
}

fn json_to_sql_value(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(value) => SqlValue::Integer(i64::from(*value)),
        Value::Number(value) => value
            .as_i64()
            .map(SqlValue::Integer)
            .or_else(|| value.as_f64().map(SqlValue::Real))
            .unwrap_or(SqlValue::Null),
        Value::String(value) => SqlValue::Text(value.clone()),
        Value::Array(_) | Value::Object(_) => SqlValue::Text(value.to_string()),
    }
}

fn record_writer_event(
    conn: &Connection,
    writer_kind: &str,
    row_count: usize,
    db_path: &std::path::Path,
) -> Result<(), String> {
    let created_at = now_ms();
    let id = format!("native-sqlite-{writer_kind}-{created_at}");
    let evidence = format!(
        "native SQLite {writer_kind} sync wrote {row_count} rows to {}",
        db_path.display()
    );
    conn.execute(
        "INSERT OR REPLACE INTO native_sqlite_writes
          (id, writer_kind, row_count, table_count, database_path, evidence, created_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);",
        (
            id,
            writer_kind,
            row_count as i64,
            count_known_tables(conn)? as i64,
            db_path.to_string_lossy().to_string(),
            evidence,
            created_at as i64,
        ),
    )
    .map_err(|error| format!("failed to record native SQLite writer event: {error}"))?;
    Ok(())
}

fn count_known_tables(conn: &Connection) -> Result<usize, String> {
    let mut count = 0;
    for table_name in KNOWN_TABLES {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1;",
                [table_name],
                |row| row.get(0),
            )
            .map_err(|error| {
                format!("failed to count native SQLite table {table_name}: {error}")
            })?;
        if exists > 0 {
            count += 1;
        }
    }
    Ok(count)
}

fn report(
    status: &str,
    writer_kind: &str,
    row_count: usize,
    table_count: usize,
    db_path: PathBuf,
    evidence: &str,
) -> NativeSqliteReport {
    NativeSqliteReport {
        status: status.to_string(),
        engine_kind: "native_sqlite".to_string(),
        storage_mode: "Tauri native SQLite".to_string(),
        writer_kind: writer_kind.to_string(),
        row_count,
        table_count,
        database_path: db_path.to_string_lossy().to_string(),
        last_synced_at: now_ms(),
        evidence: evidence.to_string(),
        next: "Use the desktop SQL page to inspect analysis_runs, project_functions, flow_edges and DeepWeb replay tables.".to_string(),
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

const NATIVE_SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS native_schema_migrations (
  version INTEGER PRIMARY KEY,
  previous_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  evidence TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  root_hint TEXT NOT NULL,
  file_count INTEGER NOT NULL,
  language_summary TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  language TEXT NOT NULL,
  content TEXT NOT NULL,
  hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  last_modified INTEGER,
  imports TEXT NOT NULL,
  environment_refs TEXT NOT NULL,
  device_refs TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_project_state (
  id TEXT PRIMARY KEY,
  active_project_id TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_project_events (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  event_kind TEXT NOT NULL,
  active_project_id TEXT,
  project_count INTEGER NOT NULL,
  file_count INTEGER NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_project_storage_engines (
  id TEXT PRIMARY KEY,
  engine_kind TEXT NOT NULL,
  storage_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  project_count INTEGER NOT NULL,
  file_count INTEGER NOT NULL,
  table_count INTEGER NOT NULL,
  last_synced_at INTEGER NOT NULL,
  evidence TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS analysis_runs (
  id TEXT PRIMARY KEY,
  project_name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  main_file_id TEXT,
  entry_function_id TEXT,
  parser_mode TEXT NOT NULL,
  file_count INTEGER NOT NULL,
  function_count INTEGER NOT NULL,
  integrity_score REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS project_files (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  path TEXT NOT NULL,
  language TEXT NOT NULL,
  hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  last_modified INTEGER,
  imports TEXT NOT NULL,
  environment_refs TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_functions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  name TEXT NOT NULL,
  language TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  params TEXT NOT NULL,
  return_type TEXT NOT NULL,
  outputs TEXT NOT NULL,
  calls TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  summary TEXT NOT NULL,
  data_shape TEXT NOT NULL,
  complexity INTEGER NOT NULL,
  category TEXT NOT NULL,
  side_effects TEXT NOT NULL,
  external_inputs TEXT NOT NULL,
  validations TEXT NOT NULL,
  risks TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence REAL NOT NULL,
  parser TEXT NOT NULL,
  parse_evidence TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS call_edges (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  from_function_id TEXT NOT NULL,
  to_function_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS flow_nodes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  function_id TEXT,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT NOT NULL,
  capacity TEXT NOT NULL,
  capacity_score REAL NOT NULL,
  confidence REAL NOT NULL,
  evidence TEXT NOT NULL,
  details TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  depth INTEGER NOT NULL,
  upstream_ids TEXT NOT NULL,
  downstream_ids TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS flow_edges (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  volume REAL NOT NULL,
  confidence REAL NOT NULL,
  evidence TEXT NOT NULL,
  "primary" INTEGER NOT NULL,
  transfer_kind TEXT NOT NULL DEFAULT 'unknown',
  data_items TEXT NOT NULL DEFAULT '[]',
  source_kind TEXT NOT NULL DEFAULT 'unknown',
  sink_kind TEXT NOT NULL DEFAULT 'unknown',
  evidence_grade TEXT NOT NULL DEFAULT 'lexical',
  runtime_observation TEXT
);
CREATE TABLE IF NOT EXISTS digital_twin_experiments (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  experiment_kind TEXT NOT NULL,
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  evidence_grade TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence REAL NOT NULL,
  affected_node_ids TEXT NOT NULL,
  input_model TEXT NOT NULL,
  expected_behavior TEXT NOT NULL,
  observed_or_estimated TEXT NOT NULL,
  metrics TEXT NOT NULL,
  evidence TEXT NOT NULL,
  next_action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS digital_twin_variants (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  name TEXT NOT NULL,
  target TEXT NOT NULL,
  change_summary TEXT NOT NULL,
  evidence_grade TEXT NOT NULL,
  performance_gain REAL NOT NULL,
  stability_delta REAL NOT NULL,
  security_delta REAL NOT NULL,
  resource_delta REAL NOT NULL,
  fit_score REAL NOT NULL,
  validation_gate TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS program_verification_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  score REAL NOT NULL,
  soundness_cap REAL NOT NULL,
  obligation_count INTEGER NOT NULL,
  proved_count INTEGER NOT NULL,
  observed_count INTEGER NOT NULL,
  violated_count INTEGER NOT NULL,
  unproved_count INTEGER NOT NULL,
  blocked_count INTEGER NOT NULL,
  runtime_evidence_count INTEGER NOT NULL,
  benchmark_evidence_count INTEGER NOT NULL,
  formal_evidence_count INTEGER NOT NULL,
  gaps TEXT NOT NULL,
  next_steps TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS verification_obligations (
  id TEXT PRIMARY KEY,
  verification_run_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  source_ids TEXT NOT NULL,
  domain TEXT NOT NULL,
  title TEXT NOT NULL,
  requirement TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence_grade TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence TEXT NOT NULL,
  missing_evidence TEXT NOT NULL,
  suggested_action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS verified_repair_candidates (
  id TEXT PRIMARY KEY,
  verification_run_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  safe_to_write_back INTEGER NOT NULL,
  summary TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS repair_verification_gates (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  gate_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence TEXT NOT NULL,
  required_action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS formal_verification_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  obligation_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  solver TEXT NOT NULL,
  solver_version TEXT NOT NULL,
  formula_hash TEXT NOT NULL,
  formula TEXT NOT NULL,
  result TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  sandbox_status TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  file_name TEXT,
  function_id TEXT,
  line INTEGER,
  counterexample TEXT,
  call_chain TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS runtime_execution_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  project_name TEXT NOT NULL,
  adapter TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence_grade TEXT NOT NULL,
  experiment_kind TEXT NOT NULL DEFAULT 'baseline',
  sample_id TEXT NOT NULL DEFAULT 'baseline-user-input',
  repetition INTEGER NOT NULL DEFAULT 1,
  input_bytes INTEGER NOT NULL DEFAULT 0,
  trace_events TEXT NOT NULL DEFAULT '[]',
  trace_source TEXT NOT NULL DEFAULT 'none',
  sanitizer_status TEXT NOT NULL DEFAULT 'not-requested',
  sanitizer_findings TEXT NOT NULL DEFAULT '[]',
  entry_path TEXT NOT NULL,
  command_label TEXT NOT NULL,
  exit_code INTEGER,
  timed_out INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  stdout TEXT NOT NULL,
  stderr TEXT NOT NULL,
  stdout_truncated INTEGER NOT NULL,
  stderr_truncated INTEGER NOT NULL,
  compile_output TEXT NOT NULL,
  file_count INTEGER NOT NULL,
  total_bytes INTEGER NOT NULL,
  sandbox_kind TEXT NOT NULL,
  sandbox_status TEXT NOT NULL,
  sandbox_evidence TEXT NOT NULL,
  cpu_time_ms INTEGER NOT NULL,
  peak_memory_bytes INTEGER NOT NULL,
  child_process_count INTEGER NOT NULL,
  child_processes TEXT NOT NULL,
  file_changes TEXT NOT NULL,
  isolation TEXT NOT NULL,
  evidence TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS security_attack_corpora (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  checksum TEXT NOT NULL,
  case_count INTEGER NOT NULL,
  provenance TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS security_attack_cases (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES security_attack_corpora(id),
  sample_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  protocol TEXT NOT NULL,
  framework_hints TEXT NOT NULL,
  weakness_ids TEXT NOT NULL,
  expected TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  provenance TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS security_assertion_runs (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES security_attack_corpora(id),
  project_id TEXT NOT NULL,
  sample_id TEXT NOT NULL,
  status TEXT NOT NULL,
  runtime_run_id TEXT NOT NULL,
  framework_hints TEXT NOT NULL DEFAULT '[]',
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_replay_memory_snapshots (
  id TEXT PRIMARY KEY,
  project_name TEXT NOT NULL,
  project_hash TEXT NOT NULL,
  file_count INTEGER NOT NULL,
  function_count INTEGER NOT NULL,
  issue_count INTEGER NOT NULL,
  deepweb_coverage REAL NOT NULL,
  irrigation_score REAL NOT NULL,
  optimization_score REAL NOT NULL,
  accepted_evidence_count INTEGER NOT NULL,
  isolated_evidence_count INTEGER NOT NULL,
  vector_count INTEGER NOT NULL,
  inference_run_count INTEGER NOT NULL,
  teacher_trust_score REAL NOT NULL,
  teacher_consensus_rate REAL NOT NULL,
  maturity_score REAL NOT NULL,
  stable_snapshot TEXT NOT NULL,
  status TEXT NOT NULL,
  dimension_scores TEXT NOT NULL,
  label_breakdown TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_replay_comparisons (
  id TEXT PRIMARY KEY,
  current_snapshot_id TEXT NOT NULL,
  baseline_snapshot_id TEXT,
  status TEXT NOT NULL,
  drift_score REAL NOT NULL,
  regression_score REAL NOT NULL,
  improvement_score REAL NOT NULL,
  changed_dimensions TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_replay_promotion_decisions (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  gate TEXT NOT NULL,
  score REAL NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_model_versions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  parent_version_id TEXT,
  feature_schema_version TEXT NOT NULL,
  model_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  weights TEXT NOT NULL,
  network_parameters TEXT,
  selected_genome_id TEXT NOT NULL,
  training_sample_count INTEGER NOT NULL,
  validation_evidence_count INTEGER NOT NULL,
  trust_score REAL NOT NULL,
  consensus_rate REAL NOT NULL,
  fitness_score REAL NOT NULL,
  regression_risk_score REAL NOT NULL,
  checksum TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_trainable_head_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  model_version_id TEXT NOT NULL,
  status TEXT NOT NULL,
  architecture TEXT NOT NULL,
  training_sample_count INTEGER NOT NULL,
  validation_sample_count INTEGER NOT NULL,
  class_count INTEGER NOT NULL,
  epoch_count INTEGER NOT NULL,
  learning_rate REAL NOT NULL,
  train_loss_before REAL NOT NULL,
  train_loss_after REAL NOT NULL,
  validation_loss_before REAL NOT NULL,
  validation_loss_after REAL NOT NULL,
  improvement REAL NOT NULL,
  inherited INTEGER NOT NULL,
  parameters TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_feature_vectors (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  model_version_id TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  pseudo_label TEXT NOT NULL,
  dimensions TEXT NOT NULL,
  vector TEXT NOT NULL,
  magnitude REAL NOT NULL,
  confidence REAL NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_inference_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  model_version_id TEXT NOT NULL,
  source_vector_id TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  vector_hash TEXT NOT NULL,
  dimensions TEXT NOT NULL,
  output_scores TEXT NOT NULL,
  predicted_class TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_validation_evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  dimension_key TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  dimensions TEXT NOT NULL,
  confidence REAL NOT NULL,
  passed INTEGER NOT NULL,
  replay INTEGER NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_extreme_test_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  category TEXT NOT NULL,
  target TEXT NOT NULL,
  load_factor REAL NOT NULL,
  pass_threshold REAL NOT NULL,
  score REAL NOT NULL,
  status TEXT NOT NULL,
  evidence TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_irrigation_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  model_version_id TEXT NOT NULL,
  cycle_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  evidence_inflow_count INTEGER NOT NULL,
  accepted_evidence_count INTEGER NOT NULL,
  isolated_evidence_count INTEGER NOT NULL,
  data_quality_score REAL NOT NULL,
  teacher_alignment_score REAL NOT NULL,
  replay_score REAL NOT NULL,
  stability_score REAL NOT NULL,
  supervision_gain REAL NOT NULL,
  stable_snapshot TEXT NOT NULL,
  evidence TEXT NOT NULL,
  next TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_irrigation_evidence (
  id TEXT PRIMARY KEY,
  irrigation_run_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  target_dimensions TEXT NOT NULL,
  evidence_count INTEGER NOT NULL,
  accepted_count INTEGER NOT NULL,
  isolated_count INTEGER NOT NULL,
  quality_score REAL NOT NULL,
  accepted INTEGER NOT NULL,
  isolated INTEGER NOT NULL,
  batch_status TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_irrigation_epochs (
  id TEXT PRIMARY KEY,
  irrigation_run_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  score REAL NOT NULL,
  evidence_count INTEGER NOT NULL,
  evidence TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_weight_update_events (
  id TEXT PRIMARY KEY,
  irrigation_run_id TEXT NOT NULL,
  model_version_id TEXT NOT NULL,
  dimension_key TEXT NOT NULL,
  before_weight REAL NOT NULL,
  candidate_weight REAL NOT NULL,
  accepted_weight REAL NOT NULL,
  delta REAL NOT NULL,
  gate TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_supervision_labels (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_vector_id TEXT,
  target_pattern TEXT NOT NULL,
  label TEXT NOT NULL,
  confidence REAL NOT NULL,
  trust_score REAL NOT NULL,
  evidence TEXT NOT NULL,
  corrective_action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_supervised_assignments (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  vector_id TEXT NOT NULL,
  vector_name TEXT NOT NULL,
  predicted_label TEXT NOT NULL,
  teacher_label TEXT NOT NULL,
  trust_score REAL NOT NULL,
  consensus_score REAL NOT NULL,
  corrected INTEGER NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_teacher_reliability (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  label_count INTEGER NOT NULL,
  accepted_count INTEGER NOT NULL,
  quarantined_count INTEGER NOT NULL,
  conflict_count INTEGER NOT NULL,
  reliability_score REAL NOT NULL,
  status TEXT NOT NULL,
  evidence TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_quarantined_labels (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  vector_id TEXT NOT NULL,
  vector_name TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  candidate_labels TEXT NOT NULL,
  reason TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_label_centroids (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  model_version_id TEXT NOT NULL,
  source TEXT NOT NULL,
  label TEXT NOT NULL,
  sample_count INTEGER NOT NULL,
  vector TEXT NOT NULL,
  dominant_dimensions TEXT NOT NULL,
  confidence REAL NOT NULL,
  promoted INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_contrastive_pairs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  anchor_vector_id TEXT NOT NULL,
  positive_vector_id TEXT NOT NULL,
  negative_vector_id TEXT NOT NULL,
  label TEXT NOT NULL,
  margin REAL NOT NULL,
  confidence REAL NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_self_supervised_epochs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  model_version_id TEXT NOT NULL,
  epoch_index INTEGER NOT NULL,
  vector_count INTEGER NOT NULL,
  pseudo_label_count INTEGER NOT NULL,
  contrastive_pair_count INTEGER NOT NULL,
  loss_before REAL NOT NULL,
  loss_after REAL NOT NULL,
  learning_rate REAL NOT NULL,
  updated_weights TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_supervised_epochs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  model_version_id TEXT NOT NULL,
  teacher_sample_count INTEGER NOT NULL,
  matched_teacher_count INTEGER NOT NULL,
  corrected_prediction_count INTEGER NOT NULL,
  false_positive_guard_count INTEGER NOT NULL,
  loss_before REAL NOT NULL,
  loss_after REAL NOT NULL,
  improvement REAL NOT NULL,
  trust_score REAL NOT NULL,
  consensus_rate REAL NOT NULL,
  calibration_weights TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_rollback_snapshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  model_version_id TEXT NOT NULL,
  protected_tables TEXT NOT NULL,
  trigger TEXT NOT NULL,
  rollback_policy TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_error_signals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  signal_kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  affected_label TEXT,
  confidence REAL NOT NULL,
  confidence_impact REAL NOT NULL,
  knowledge_score_impact REAL NOT NULL,
  fitness_impact REAL NOT NULL,
  evidence TEXT NOT NULL,
  containment_action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_gene_pool (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  gene_kind TEXT NOT NULL,
  name TEXT NOT NULL,
  expression REAL NOT NULL,
  inherited_from TEXT NOT NULL,
  mutation_delta REAL NOT NULL,
  evidence TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_genome_generations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  model_version_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  parent_id TEXT,
  strategy TEXT NOT NULL,
  fitness_score REAL NOT NULL,
  accepted INTEGER NOT NULL,
  genes TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_gene_expression (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  genome_id TEXT NOT NULL,
  gene_id TEXT NOT NULL,
  project_signal TEXT NOT NULL,
  expression_level REAL NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_fitness_scores (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  genome_id TEXT NOT NULL,
  accuracy_proxy REAL NOT NULL,
  stability_proxy REAL NOT NULL,
  safety_proxy REAL NOT NULL,
  generalization_proxy REAL NOT NULL,
  regression_penalty REAL NOT NULL,
  fitness_score REAL NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_local_sqlite_journal (
  id TEXT PRIMARY KEY,
  target_table TEXT NOT NULL,
  target_primary_key TEXT NOT NULL,
  project_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  sql_text TEXT NOT NULL,
  sync_status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deepweb_local_storage_engines (
  id TEXT PRIMARY KEY,
  engine_kind TEXT NOT NULL,
  storage_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  last_synced_at INTEGER NOT NULL,
  evidence TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS native_sqlite_writes (
  id TEXT PRIMARY KEY,
  writer_kind TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  table_count INTEGER NOT NULL,
  database_path TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS workspace_projects_updated_idx ON workspace_projects (updated_at);
CREATE INDEX IF NOT EXISTS workspace_project_files_project_idx ON workspace_project_files (project_id);
CREATE INDEX IF NOT EXISTS analysis_runs_created_idx ON analysis_runs (created_at);
CREATE INDEX IF NOT EXISTS project_files_run_idx ON project_files (run_id);
CREATE INDEX IF NOT EXISTS project_functions_run_idx ON project_functions (run_id);
CREATE INDEX IF NOT EXISTS project_functions_name_idx ON project_functions (name);
CREATE INDEX IF NOT EXISTS call_edges_run_idx ON call_edges (run_id);
CREATE INDEX IF NOT EXISTS flow_nodes_run_idx ON flow_nodes (run_id);
CREATE INDEX IF NOT EXISTS digital_twin_experiments_run_idx ON digital_twin_experiments (run_id);
CREATE INDEX IF NOT EXISTS digital_twin_variants_run_idx ON digital_twin_variants (run_id);
CREATE INDEX IF NOT EXISTS runtime_execution_runs_project_idx ON runtime_execution_runs (project_id);
CREATE INDEX IF NOT EXISTS runtime_execution_runs_started_idx ON runtime_execution_runs (started_at);
CREATE INDEX IF NOT EXISTS security_assertion_runs_project_idx ON security_assertion_runs (project_id);
CREATE INDEX IF NOT EXISTS security_assertion_runs_status_idx ON security_assertion_runs (status);
CREATE INDEX IF NOT EXISTS security_attack_cases_corpus_idx ON security_attack_cases (corpus_id);
CREATE INDEX IF NOT EXISTS flow_edges_run_idx ON flow_edges (run_id);
CREATE INDEX IF NOT EXISTS deepweb_replay_memory_snapshots_project_idx ON deepweb_replay_memory_snapshots (project_hash);
CREATE INDEX IF NOT EXISTS deepweb_model_versions_run_idx ON deepweb_model_versions (run_id, created_at);
CREATE INDEX IF NOT EXISTS deepweb_model_versions_status_idx ON deepweb_model_versions (status, fitness_score);
CREATE INDEX IF NOT EXISTS deepweb_trainable_head_runs_run_idx ON deepweb_trainable_head_runs (run_id, status, created_at);
CREATE INDEX IF NOT EXISTS deepweb_feature_vectors_run_idx ON deepweb_feature_vectors (run_id, source_table);
CREATE INDEX IF NOT EXISTS deepweb_feature_vectors_label_idx ON deepweb_feature_vectors (pseudo_label, confidence);
CREATE INDEX IF NOT EXISTS deepweb_inference_runs_run_idx ON deepweb_inference_runs (run_id, predicted_class);
CREATE INDEX IF NOT EXISTS deepweb_validation_evidence_run_idx ON deepweb_validation_evidence (run_id, dimension_key, passed);
CREATE INDEX IF NOT EXISTS deepweb_extreme_test_runs_run_idx ON deepweb_extreme_test_runs (run_id, status);
CREATE INDEX IF NOT EXISTS deepweb_irrigation_runs_run_idx ON deepweb_irrigation_runs (run_id, created_at);
CREATE INDEX IF NOT EXISTS deepweb_irrigation_evidence_run_idx ON deepweb_irrigation_evidence (irrigation_run_id, batch_status);
CREATE INDEX IF NOT EXISTS deepweb_irrigation_epochs_run_idx ON deepweb_irrigation_epochs (irrigation_run_id, stage);
CREATE INDEX IF NOT EXISTS deepweb_weight_update_events_run_idx ON deepweb_weight_update_events (irrigation_run_id, dimension_key);
CREATE INDEX IF NOT EXISTS deepweb_supervision_labels_run_idx ON deepweb_supervision_labels (run_id, source_kind, label);
CREATE INDEX IF NOT EXISTS deepweb_supervised_assignments_run_idx ON deepweb_supervised_assignments (run_id, corrected);
CREATE INDEX IF NOT EXISTS deepweb_teacher_reliability_run_idx ON deepweb_teacher_reliability (run_id, source_kind);
CREATE INDEX IF NOT EXISTS deepweb_quarantined_labels_run_idx ON deepweb_quarantined_labels (run_id, reason);
CREATE INDEX IF NOT EXISTS deepweb_label_centroids_run_idx ON deepweb_label_centroids (run_id, label, promoted);
CREATE INDEX IF NOT EXISTS deepweb_contrastive_pairs_run_idx ON deepweb_contrastive_pairs (run_id, label);
CREATE INDEX IF NOT EXISTS deepweb_supervised_epochs_run_idx ON deepweb_supervised_epochs (run_id, created_at);
CREATE INDEX IF NOT EXISTS deepweb_error_signals_run_idx ON deepweb_error_signals (run_id, signal_kind, severity);
CREATE INDEX IF NOT EXISTS deepweb_gene_pool_run_idx ON deepweb_gene_pool (run_id, gene_kind);
CREATE INDEX IF NOT EXISTS deepweb_genome_generations_run_idx ON deepweb_genome_generations (run_id, generation, accepted);
CREATE INDEX IF NOT EXISTS deepweb_gene_expression_run_idx ON deepweb_gene_expression (run_id, genome_id, gene_id);
CREATE INDEX IF NOT EXISTS deepweb_fitness_scores_run_idx ON deepweb_fitness_scores (run_id, fitness_score);
CREATE INDEX IF NOT EXISTS deepweb_local_sqlite_journal_table_idx ON deepweb_local_sqlite_journal (target_table);
CREATE INDEX IF NOT EXISTS native_sqlite_writes_kind_idx ON native_sqlite_writes (writer_kind);
"#;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(network_policy::NetworkPolicyState::default())
        .manage(DebugSessionManager::default())
        .setup(|app| {
            let handle = app.handle().clone();
            if let Err(error) = cleanup_stale_runtime_cache(&handle) {
                eprintln!("CodeFlow cache retention warning: {error}");
            }
            if let Err(error) = with_database(&handle, |_, _| Ok(())) {
                eprintln!("CodeFlow database retention warning: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            codeflow_save_report_pdf,
            codeflow_system_capacity,
            codeflow_network_policy_status,
            codeflow_set_network_policy,
            codeflow_validate_private_endpoint,
            codeflow_import_knowledge_pack,
            codeflow_knowledge_pack_status,
            codeflow_activate_knowledge_pack,
            codeflow_rollback_knowledge_pack,
            codeflow_import_supplemental_knowledge,
            codeflow_activate_supplemental_knowledge,
            codeflow_match_project_dependencies,
            codeflow_sync_security_assertions,
            codeflow_security_corpus_history,
            codeflow_native_sqlite_status,
            codeflow_deepweb_model_baseline,
            codeflow_load_workspace_projects,
            codeflow_sync_workspace_projects,
            codeflow_sync_deepweb_journal,
            codeflow_sync_code_index,
            codeflow_clear_native_database,
            codeflow_parse_workspace_ast,
            codeflow_parse_typescript_compiler,
            codeflow_lsp_availability,
            codeflow_parse_workspace_lsp,
            codeflow_lsp_sidecar_status,
            codeflow_set_lsp_sidecar_enabled,
            codeflow_runtime_availability,
            codeflow_debug_availability,
            codeflow_debug_create_session,
            codeflow_debug_set_breakpoints,
            codeflow_debug_session,
            codeflow_debug_launch,
            codeflow_debug_continue,
            codeflow_debug_next,
            codeflow_debug_step_in,
            codeflow_debug_step_out,
            codeflow_debug_pause,
            codeflow_debug_disconnect,
            codeflow_run_controlled,
            codeflow_run_formal_policy_suite,
            codeflow_run_project_smt_batch
        ])
        .run(tauri::generate_context!())
        .expect("error while running CodeFlow Inspector");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request_with_path(path: &str) -> ControlledRuntimeRequest {
        ControlledRuntimeRequest {
            project_id: "test-project".to_string(),
            project_name: "Test Project".to_string(),
            adapter: "node".to_string(),
            entry_path: path.to_string(),
            files: vec![ControlledRuntimeFile {
                path: path.to_string(),
                content: "console.log('ok')".to_string(),
                language: "JavaScript".to_string(),
            }],
            args: vec![],
            stdin: String::new(),
            timeout_ms: 1000,
            max_output_bytes: 4096,
            experiment_kind: "baseline".to_string(),
            sample_id: "test-baseline".to_string(),
            repetition: 1,
            breakpoints: Vec::new(),
        }
    }

    #[test]
    fn controlled_runtime_accepts_project_relative_entry() {
        assert!(validate_runtime_request(&request_with_path("src/main.js")).is_ok());
    }

    #[test]
    fn controlled_runtime_rejects_parent_path_escape() {
        assert!(validate_runtime_request(&request_with_path("../main.js")).is_err());
    }

    #[test]
    fn controlled_runtime_rejects_unknown_adapter() {
        let mut request = request_with_path("main.js");
        request.adapter = "shell".to_string();
        assert!(validate_runtime_request(&request).is_err());
    }

    #[test]
    fn security_native_compile_enables_address_and_undefined_sanitizers() {
        let args = native_compile_args("main.c".to_string(), false, true, false);
        assert!(args.contains(&"-fsanitize=address,undefined".to_string()));
        assert!(args.contains(&"-fno-omit-frame-pointer".to_string()));
        assert!(
            !native_compile_args("main.c".to_string(), false, false, false)
                .contains(&"-fsanitize=address,undefined".to_string())
        );
        assert!(
            native_compile_args("main.cpp".to_string(), true, true, true)
                .contains(&"-fsanitize=thread,undefined".to_string())
        );
    }

    #[test]
    fn runtime_taint_probe_observes_stdout_and_changed_files_without_storing_secret() {
        let directory = std::env::temp_dir().join(format!(
            "codeflow-taint-{}-{}",
            std::process::id(),
            now_ms()
        ));
        fs::create_dir_all(&directory).expect("create taint fixture");
        fs::write(
            directory.join("result.txt"),
            "prefix CODEFLOW_CANARY suffix",
        )
        .expect("write taint fixture");
        let outcome = ProcessOutcome {
            exit_code: Some(0),
            timed_out: false,
            duration_ms: 1,
            stdout: "CODEFLOW_CANARY".to_string(),
            stderr: String::new(),
            stdout_truncated: false,
            stderr_truncated: false,
            sandbox_kind: "test".to_string(),
            sandbox_status: "enforced".to_string(),
            sandbox_evidence: "test".to_string(),
            cpu_time_ms: 1,
            peak_memory_bytes: 1,
            child_processes: Vec::new(),
            file_changes: vec![FileChange {
                path: "result.txt".to_string(),
                kind: "created".to_string(),
                before_bytes: None,
                after_bytes: Some(22),
            }],
        };
        let events = detect_runtime_taint_observations(
            r#"{"value":"CODEFLOW_CANARY"}"#,
            &outcome,
            &directory,
        );
        assert!(events
            .iter()
            .any(|event| event.to.as_deref() == Some("<stdout>")));
        assert!(events
            .iter()
            .any(|event| event.to.as_deref() == Some("result.txt")));
        assert!(events.iter().all(|event| !event
            .data_names
            .iter()
            .any(|name| name.contains("CODEFLOW_CANARY"))));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn sanitizer_parser_preserves_reproducible_findings_only() {
        let findings = parse_sanitizer_findings("ordinary log\nERROR: AddressSanitizer: heap-use-after-free\nmain.c:4: runtime error: signed integer overflow");
        assert_eq!(findings.len(), 2);
        assert!(findings
            .iter()
            .any(|line| line.contains("AddressSanitizer")));
        assert!(findings.iter().any(|line| line.contains("runtime error:")));
    }

    #[test]
    fn runtime_trace_parser_accepts_only_structured_codeflow_events() {
        let stdout = concat!(
            "ordinary output\n",
            "CODEFLOW_TRACE {\"functionName\":\"source\",\"event\":\"transfer\",\"dataNames\":[\"payload\"],\"from\":\"source\",\"to\":\"sink\"}\n",
            "CODEFLOW_TRACE {\"functionName\":\"ignored\",\"event\":\"invalid\",\"dataNames\":[]}\n",
        );
        let events = parse_trace_lines(stdout.lines(), Some("CODEFLOW_TRACE "));
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event, "transfer");
        assert_eq!(events[0].from.as_deref(), Some("source"));
        assert_eq!(events[0].to.as_deref(), Some("sink"));
    }

    #[test]
    fn runtime_trace_prefers_independent_sidecar_over_stdout_compatibility() {
        let path = std::env::temp_dir().join(format!(
            "codeflow-trace-sidecar-{}-{}.ndjson",
            std::process::id(),
            now_ms()
        ));
        fs::write(
            &path,
            "{\"functionName\":\"<program>\",\"event\":\"enter\",\"dataNames\":[]}\n",
        )
        .expect("write sidecar trace");
        let (events, source) = parse_runtime_trace_events(
            "CODEFLOW_TRACE {\"functionName\":\"stdout\",\"event\":\"enter\",\"dataNames\":[]}",
            &path,
        );
        let _ = fs::remove_file(path);
        assert_eq!(source, "instrumentation-sidecar");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].function_name, "<program>");
    }

    #[test]
    fn controlled_runtime_captures_real_process_output() {
        let test_root =
            std::env::temp_dir().join(format!("codeflow-runtime-test-{}", std::process::id()));
        fs::create_dir_all(&test_root).expect("create test runtime directory");
        let executable = std::env::current_exe().expect("resolve current test executable");
        let outcome = match run_process(
            &executable.to_string_lossy(),
            &["--list".to_string()],
            &test_root,
            "",
            5_000,
            64_000,
            "self-test",
        ) {
            Ok(outcome) => outcome,
            Err(error) if error.contains("local defense refused") => {
                let _ = fs::remove_dir_all(test_root);
                return;
            }
            Err(error) => panic!("execute current test binary: {error}"),
        };
        assert_eq!(outcome.exit_code, Some(0), "stderr={}", outcome.stderr);
        assert!(!outcome.timed_out);
        assert!(outcome.stdout.contains("controlled_runtime"));
        assert_eq!(outcome.sandbox_kind, platform_sandbox_kind());
        #[cfg(target_os = "macos")]
        assert!(["enforced", "unavailable"].contains(&outcome.sandbox_status.as_str()));
        assert!(!outcome.child_processes.is_empty());
        let _ = fs::remove_dir_all(test_root);
    }

    #[test]
    fn desktop_runtime_probe_uses_the_controlled_tool_path() {
        let path = controlled_runtime_path();
        #[cfg(target_os = "macos")]
        {
            assert!(path.contains("/opt/homebrew/bin"));
            assert!(path.contains("/usr/local/bin"));
            if let Some(home) = std::env::var_os("HOME") {
                assert!(path.contains(&PathBuf::from(home).join(".cargo/bin").to_string_lossy().to_string()));
            }
        }
        for command in ["node", "cargo"] {
            if let Some(resolved) = resolve_runtime_command(command) {
                let tool = inspect_runtime_tool(command, command, command);
                assert!(tool.available, "{}", tool.evidence);
                assert_eq!(PathBuf::from(tool.command), resolved);
            }
        }
    }

    #[test]
    fn runtime_file_diff_reports_created_modified_and_deleted_files() {
        let before = BTreeMap::from([
            (
                "modified.txt".to_string(),
                FileFingerprint {
                    bytes: 2,
                    modified_ns: 1,
                },
            ),
            (
                "deleted.txt".to_string(),
                FileFingerprint {
                    bytes: 3,
                    modified_ns: 1,
                },
            ),
        ]);
        let after = BTreeMap::from([
            (
                "modified.txt".to_string(),
                FileFingerprint {
                    bytes: 4,
                    modified_ns: 2,
                },
            ),
            (
                "created.txt".to_string(),
                FileFingerprint {
                    bytes: 5,
                    modified_ns: 2,
                },
            ),
        ]);
        let changes = diff_file_snapshots(&before, &after);
        assert_eq!(changes.len(), 3);
        assert!(changes
            .iter()
            .any(|change| change.path == "created.txt" && change.kind == "created"));
        assert!(changes
            .iter()
            .any(|change| change.path == "modified.txt" && change.kind == "modified"));
        assert!(changes
            .iter()
            .any(|change| change.path == "deleted.txt" && change.kind == "deleted"));
    }

    #[test]
    fn controlled_runtime_smoke_tests_every_available_language_adapter() {
        let strict = std::env::var_os("CODEFLOW_CROSS_PLATFORM_CERTIFY").is_some();
        let cases = [
            ("node", "main.js", "const fs=require('fs');console.log('CODEFLOW_TRACE {\"functionName\":\"source\",\"event\":\"transfer\",\"dataNames\":[\"input\"],\"from\":\"source\",\"to\":\"sink\"}');fs.writeFileSync('certification-output.txt','ok');console.log('CODEFLOW_TRACE {\"functionName\":\"sink\",\"event\":\"exit\",\"dataNames\":[\"output\"]}');", "JavaScript"),
            ("python", "main.py", "print('CODEFLOW_TRACE {\"functionName\":\"source\",\"event\":\"transfer\",\"dataNames\":[\"input\"],\"from\":\"source\",\"to\":\"sink\"}')\nopen('certification-output.txt','w').write('ok')\nprint('CODEFLOW_TRACE {\"functionName\":\"sink\",\"event\":\"exit\",\"dataNames\":[\"output\"]}')", "Python"),
            ("rust", "main.rs", r##"fn main(){println!("{}",r#"CODEFLOW_TRACE {"functionName":"source","event":"transfer","dataNames":["input"],"from":"source","to":"sink"}"#);std::fs::write("certification-output.txt","ok").unwrap();println!("{}",r#"CODEFLOW_TRACE {"functionName":"sink","event":"exit","dataNames":["output"]}"#);}"##, "Rust"),
            (
                "java",
                "Main.java",
                "import java.nio.file.*; public class Main { public static void main(String[] args) throws Exception { System.out.println(\"CODEFLOW_TRACE {\\\"functionName\\\":\\\"source\\\",\\\"event\\\":\\\"transfer\\\",\\\"dataNames\\\":[\\\"input\\\"],\\\"from\\\":\\\"source\\\",\\\"to\\\":\\\"sink\\\"}\"); Files.writeString(Path.of(\"certification-output.txt\"),\"ok\"); System.out.println(\"CODEFLOW_TRACE {\\\"functionName\\\":\\\"sink\\\",\\\"event\\\":\\\"exit\\\",\\\"dataNames\\\":[\\\"output\\\"]}\"); } }",
                "Java",
            ),
            (
                "c",
                "main.c",
                "#include <stdio.h>\nint main(void){puts(\"CODEFLOW_TRACE {\\\"functionName\\\":\\\"source\\\",\\\"event\\\":\\\"transfer\\\",\\\"dataNames\\\":[\\\"input\\\"],\\\"from\\\":\\\"source\\\",\\\"to\\\":\\\"sink\\\"}\");FILE*f=fopen(\"certification-output.txt\",\"w\");if(!f)return 2;fputs(\"ok\",f);fclose(f);puts(\"CODEFLOW_TRACE {\\\"functionName\\\":\\\"sink\\\",\\\"event\\\":\\\"exit\\\",\\\"dataNames\\\":[\\\"output\\\"]}\");return 0;}",
                "C",
            ),
            (
                "cpp",
                "main.cpp",
                "#include <fstream>\n#include <iostream>\nint main(){std::cout<<\"CODEFLOW_TRACE {\\\"functionName\\\":\\\"source\\\",\\\"event\\\":\\\"transfer\\\",\\\"dataNames\\\":[\\\"input\\\"],\\\"from\\\":\\\"source\\\",\\\"to\\\":\\\"sink\\\"}\\n\";std::ofstream(\"certification-output.txt\")<<\"ok\";std::cout<<\"CODEFLOW_TRACE {\\\"functionName\\\":\\\"sink\\\",\\\"event\\\":\\\"exit\\\",\\\"dataNames\\\":[\\\"output\\\"]}\\n\";}",
                "C++",
            ),
        ];
        for (adapter, path, content, language) in cases {
            let required_tool = match adapter {
                "node" => "node",
                "python" => "python3",
                "rust" => "rustc",
                "java" => "javac",
                "c" => "cc",
                "cpp" => "c++",
                _ => unreachable!(),
            };
            if Command::new(required_tool)
                .arg("--version")
                .output()
                .is_err()
            {
                assert!(
                    !strict,
                    "{language} certification tool {required_tool} is missing"
                );
                continue;
            }
            let root = std::env::temp_dir()
                .join(format!("codeflow-{adapter}-smoke-{}", std::process::id()));
            fs::create_dir_all(&root).expect("create adapter smoke directory");
            let request = ControlledRuntimeRequest {
                project_id: format!("{adapter}-smoke"),
                project_name: format!("{adapter} smoke"),
                adapter: adapter.to_string(),
                entry_path: path.to_string(),
                files: vec![ControlledRuntimeFile {
                    path: path.to_string(),
                    content: content.to_string(),
                    language: language.to_string(),
                }],
                args: Vec::new(),
                stdin: String::new(),
                timeout_ms: 10_000,
                max_output_bytes: 64_000,
                experiment_kind: "baseline".to_string(),
                sample_id: format!("{adapter}-smoke"),
                repetition: 1,
                breakpoints: Vec::new(),
            };
            write_runtime_files(&root, &request.files).expect("write adapter smoke source");
            let (_, compile_output, outcome, compile_failed) =
                match execute_runtime_adapter(&root, &request, 10_000, 64_000) {
                    Ok(result) => result,
                    Err(error) if error.contains("local defense refused") => {
                        assert!(!strict, "{adapter} sandbox certification failed: {error}");
                        let _ = fs::remove_dir_all(root);
                        continue;
                    }
                    Err(error) => panic!("{adapter} adapter failed to start: {error}"),
                };
            assert!(
                !compile_failed,
                "{adapter} compile failed: {compile_output}"
            );
            assert_eq!(
                outcome.exit_code,
                Some(0),
                "{adapter} runtime failed: {}",
                outcome.stderr
            );
            assert_eq!(
                parse_trace_lines(outcome.stdout.lines(), Some("CODEFLOW_TRACE ")).len(),
                2,
                "{adapter} did not produce the certification trace"
            );
            assert!(
                outcome
                    .file_changes
                    .iter()
                    .any(|change| change.path == "certification-output.txt"
                        && change.kind == "created"),
                "{adapter} did not produce a monitored file change"
            );
            assert!(
                !outcome.child_processes.is_empty(),
                "{adapter} process observation is empty"
            );
            if strict {
                assert_eq!(
                    outcome.sandbox_status, "enforced",
                    "{adapter} did not run inside a certified OS sandbox: {}",
                    outcome.sandbox_evidence
                );
            }
            #[cfg(target_os = "macos")]
            assert!(["enforced", "unavailable"].contains(&outcome.sandbox_status.as_str()));
            let _ = fs::remove_dir_all(root);
        }
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn debug_target_wrapper_enforces_the_local_macos_sandbox() {
        let root =
            std::env::temp_dir().join(format!("codeflow-debug-sandbox-{}", std::process::id()));
        fs::create_dir_all(&root).expect("create debug sandbox fixture");
        let wrapper = match prepare_debug_target_wrapper(&root, "probe", Path::new("/usr/bin/true"))
        {
            Ok(wrapper) => wrapper,
            Err(error) if error.contains("sandbox-exec is unavailable") => {
                let _ = fs::remove_dir_all(root);
                return;
            }
            Err(error) => panic!("debug sandbox wrapper failed: {error}"),
        };
        let status = Command::new(wrapper)
            .current_dir(&root)
            .status()
            .expect("execute debug sandbox wrapper");
        assert!(status.success());
        assert!(root.join(".codeflow-probe.sb").is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn native_ast_parser_extracts_functions_for_every_bundled_language() {
        let samples = [
            (
                "main.ts",
                "function tsMain(value: number): number { return value; }",
                "TypeScript",
            ),
            (
                "main.js",
                "function jsMain(value) { return value; }",
                "JavaScript",
            ),
            (
                "main.py",
                "def py_main(value: int) -> int:\n    return value\n",
                "Python",
            ),
            (
                "main.go",
                "package main\nfunc goMain(value int) int { return value }\n",
                "Go",
            ),
            (
                "main.rs",
                "fn rust_main(value: i32) -> i32 { value }",
                "Rust",
            ),
            (
                "Main.java",
                "class Main { int javaMain(int value) { return value; } }",
                "Java",
            ),
            (
                "Main.kt",
                "class Main { fun kotlinMain(value: Int): Int = value }",
                "Kotlin",
            ),
            (
                "Main.cs",
                "class Main { int CSharpMain(int value) { return value; } }",
                "C#",
            ),
            ("main.c", "int c_main(int value) { return value; }", "C"),
            (
                "main.cpp",
                "int cpp_main(int value) { return value; }",
                "C++",
            ),
            (
                "main.php",
                "<?php function php_main(int $value): int { return $value; }",
                "PHP",
            ),
            ("main.rb", "def ruby_main(value)\n  value\nend\n", "Ruby"),
            (
                "main.swift",
                "func swiftMain(_ value: Int) -> Int { return value }",
                "Swift",
            ),
            (
                "main.sh",
                "shell_main() { printf '%s\\n' shell-ok; }\nshell_main\n",
                "Shell",
            ),
            (
                "main.sql",
                "CREATE FUNCTION sql_main(value integer) RETURNS integer AS 'SELECT value' LANGUAGE SQL;",
                "SQL",
            ),
        ];
        let files = samples
            .into_iter()
            .map(|(path, content, language)| ControlledRuntimeFile {
                path: path.to_string(),
                content: content.to_string(),
                language: language.to_string(),
            })
            .collect::<Vec<_>>();
        let report = codeflow_parse_workspace_ast(files);
        assert_eq!(report.parsed_file_count, 15);
        assert!(report.unsupported_files.is_empty());
        assert_eq!(report.language_coverage.len(), 15);
        assert!(report.language_coverage.iter().all(|item| {
            item.parsed_file_count == item.file_count
                && matches!(item.status.as_str(), "ast-ready" | "ast-warning")
        }));
        assert!(
            report.function_count >= 14,
            "expected one function per grammar, got names: {:?}",
            report
                .functions
                .iter()
                .map(|item| &item.name)
                .collect::<Vec<_>>()
        );
        let names = report
            .functions
            .iter()
            .map(|item| item.name.as_str())
            .collect::<BTreeSet<_>>();
        for expected in [
            "tsMain",
            "jsMain",
            "py_main",
            "goMain",
            "rust_main",
            "javaMain",
            "kotlinMain",
            "CSharpMain",
            "c_main",
            "cpp_main",
            "php_main",
            "ruby_main",
            "swiftMain",
            "shell_main",
        ] {
            assert!(
                names.contains(expected),
                "missing AST function {expected}; got {names:?}"
            );
        }
    }

    #[test]
    fn native_ast_parser_uses_control_nodes_for_complexity() {
        let report = codeflow_parse_workspace_ast(vec![ControlledRuntimeFile {
            path: "flow.py".to_string(),
            content: "def route(items):\n    total = 0\n    for item in items:\n        if item > 0:\n            total += item\n    return total\n".to_string(),
            language: "Python".to_string(),
        }]);
        let function = report.functions.first().expect("AST function fact");
        assert_eq!(function.branch_count, 1);
        assert_eq!(function.loop_count, 1);
        assert_eq!(function.return_count, 1);
        assert!(function.write_count >= 2);
        assert_eq!(function.complexity, 3);
        assert!(function
            .evidence
            .iter()
            .any(|item| item.contains("AST control facts")));
        assert!(function
            .control_nodes
            .iter()
            .any(|item| item.kind == "branch"));
        assert!(function
            .control_nodes
            .iter()
            .any(|item| item.kind == "loop"));
        assert!(function
            .control_nodes
            .iter()
            .any(|item| item.kind == "assignment"));
        assert!(function
            .control_edges
            .iter()
            .any(|item| item.kind == "back"));
    }

    #[test]
    fn controlled_typescript_compiler_returns_real_type_facts() {
        let Some(node) = sidecar::resolve_system("node") else {
            return;
        };
        let worker = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../src/lib/parser/node-typescript-worker.mjs");
        let root =
            std::env::temp_dir().join(format!("codeflow-ts-compiler-test-{}", std::process::id()));
        fs::create_dir_all(&root).expect("create TypeScript compiler test directory");
        let payload = serde_json::json!({
            "files": [{
                "name": "main.ts",
                "language": "TypeScript",
                "content": "export function double(value: number): number { return value * 2; }"
            }],
            "options": {}
        })
        .to_string();
        let sandbox_worker = stage_typescript_compiler_package(&worker, &root)
            .expect("stage TypeScript compiler package");
        let outcome = match run_process(
            &node.to_string_lossy(),
            &[sandbox_worker.to_string_lossy().to_string()],
            &root,
            &payload,
            12_000,
            2 * 1024 * 1024,
            "typescript-compiler-test",
        ) {
            Ok(outcome) => outcome,
            Err(error) if error.contains("local defense refused") => {
                let _ = fs::remove_dir_all(root);
                return;
            }
            Err(error) => panic!("TypeScript Compiler worker failed: {error}"),
        };
        assert_eq!(outcome.exit_code, Some(0), "stderr={}", outcome.stderr);
        let envelope: Value =
            serde_json::from_str(&outcome.stdout).expect("TypeScript Compiler JSON envelope");
        assert_eq!(envelope.get("ok").and_then(Value::as_bool), Some(true));
        assert_eq!(
            envelope
                .pointer("/report/functions/0/returnType")
                .and_then(Value::as_str),
            Some("number")
        );
        assert_eq!(
            envelope
                .pointer("/report/functions/0/params/0")
                .and_then(Value::as_str),
            Some("value: number")
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn native_ast_parser_resolves_cross_file_call_edges() {
        let files = vec![
            ControlledRuntimeFile {
                path: "source.py".to_string(),
                content: "def source(value):\n    return target(value)\n".to_string(),
                language: "Python".to_string(),
            },
            ControlledRuntimeFile {
                path: "target.py".to_string(),
                content: "def target(value):\n    return value\n".to_string(),
                language: "Python".to_string(),
            },
        ];
        let report = codeflow_parse_workspace_ast(files);
        assert_eq!(report.function_count, 2);
        assert_eq!(
            report.edge_count,
            1,
            "functions and calls: {:?}",
            report
                .functions
                .iter()
                .map(|item| (&item.name, &item.calls))
                .collect::<Vec<_>>()
        );
        assert!(report.edges[0].evidence.contains("source"));
        assert!(report.edges[0].evidence.contains("target"));
    }

    #[test]
    fn native_ast_parser_collects_rust_and_c_macro_sites() {
        let files = vec![
            ControlledRuntimeFile {
                path: "main.rs".to_string(),
                content: "fn main() { println!(\"hello\"); }\n".to_string(),
                language: "Rust".to_string(),
            },
            ControlledRuntimeFile {
                path: "main.c".to_string(),
                content:
                    "#define LIMIT(v) ((v) > 4)\nint check(int value) { return LIMIT(value); }\n"
                        .to_string(),
                language: "C".to_string(),
            },
        ];
        let report = codeflow_parse_workspace_ast(files);
        assert!(
            report.macro_count >= 2,
            "expected Rust macro node and C macro candidate, got {:?}",
            report
                .macro_sites
                .iter()
                .map(|item| (&item.name, &item.evidence))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn native_sqlite_persists_deepweb_model_versions_with_parameterized_payloads() {
        let mut conn = Connection::open_in_memory().expect("open in-memory sqlite");
        conn.execute_batch(NATIVE_SCHEMA)
            .expect("initialize native schema");
        knowledge_pack::ensure_schema(&conn).expect("initialize knowledge pack schema");
        let row = NativeSqliteRow {
            table_name: "deepweb_model_versions".to_string(),
            primary_key: "model-v1".to_string(),
            payload: serde_json::json!({
                "id": "model-v1",
                "run_id": "run-1",
                "parent_version_id": null,
                "feature_schema_version": "deepweb-14d-v1",
                "model_mode": "Expert-Supervised DeepWeb",
                "status": "candidate",
                "weights": {"security": 0.11, "stability": 0.1},
                "selected_genome_id": "genome-v1",
                "training_sample_count": 32,
                "validation_evidence_count": 8,
                "trust_score": 78,
                "consensus_rate": 81,
                "fitness_score": 84,
                "regression_risk_score": 9,
                "checksum": "abc123",
                "evidence": ["parameterized model state"],
                "created_at": 1
            }),
            _sql_text:
                "INSERT INTO deepweb_model_versions VALUES (); DROP TABLE workspace_projects;"
                    .to_string(),
        };
        apply_insert_rows(&mut conn, &[row]).expect("persist model version");
        network_policy::ensure_schema(&conn).expect("initialize local security schema");
        let model_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM deepweb_model_versions", [], |row| {
                row.get(0)
            })
            .expect("count model versions");
        let workspace_table_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='workspace_projects'",
                [],
                |row| row.get(0),
            )
            .expect("workspace table still exists");
        assert_eq!(model_count, 1);
        assert_eq!(
            workspace_table_count, 1,
            "audit SQL text must never be executed"
        );
        assert_eq!(
            count_known_tables(&conn).expect("count known tables"),
            KNOWN_TABLES.len()
        );
    }

    #[test]
    fn native_sqlite_rejects_unknown_deepweb_columns() {
        let mut conn = Connection::open_in_memory().expect("open in-memory sqlite");
        conn.execute_batch(NATIVE_SCHEMA)
            .expect("initialize native schema");
        let row = NativeSqliteRow {
            table_name: "deepweb_model_versions".to_string(),
            primary_key: "model-v2".to_string(),
            payload: serde_json::json!({"id": "model-v2", "unsafe_column": "blocked"}),
            _sql_text: String::new(),
        };
        let error = apply_insert_rows(&mut conn, &[row]).expect_err("unknown column must fail");
        assert!(error.contains("unsafe_column"));
    }

    #[test]
    fn native_sqlite_persists_verification_and_repair_gate_chain() {
        let mut conn = Connection::open_in_memory().expect("open in-memory sqlite");
        conn.execute_batch(NATIVE_SCHEMA)
            .expect("initialize native schema");
        let rows = vec![
            NativeSqliteRow {
                table_name: "program_verification_runs".to_string(),
                primary_key: "verification-1".to_string(),
                payload: serde_json::json!({
                    "id": "verification-1", "run_id": "analysis-1", "status": "evidence-linked",
                    "score": 48, "soundness_cap": 48, "obligation_count": 1, "proved_count": 0,
                    "observed_count": 1, "violated_count": 0, "unproved_count": 0, "blocked_count": 0,
                    "runtime_evidence_count": 0, "benchmark_evidence_count": 0, "formal_evidence_count": 0,
                    "gaps": ["runtime evidence missing"], "next_steps": ["run isolated replay"], "created_at": 1
                }),
                _sql_text: String::new(),
            },
            NativeSqliteRow {
                table_name: "verification_obligations".to_string(),
                primary_key: "obligation-1".to_string(),
                payload: serde_json::json!({
                    "id": "obligation-1", "verification_run_id": "verification-1", "run_id": "analysis-1",
                    "source_ids": ["issue-1"], "domain": "security", "title": "reject tainted input",
                    "requirement": "untrusted data must not reach process sink", "status": "observed",
                    "evidence_grade": "knowledge", "confidence": 82, "evidence": ["CWE rule match"],
                    "missing_evidence": ["attack replay"], "suggested_action": "run attack replay", "created_at": 1
                }),
                _sql_text: String::new(),
            },
            NativeSqliteRow {
                table_name: "verified_repair_candidates".to_string(),
                primary_key: "repair-1".to_string(),
                payload: serde_json::json!({
                    "id": "repair-1", "verification_run_id": "verification-1", "run_id": "analysis-1",
                    "variant_id": "variant-1", "title": "parameterize query", "status": "proposed",
                    "safe_to_write_back": false, "summary": "replace string SQL", "evidence": ["issue-1"], "created_at": 1
                }),
                _sql_text: String::new(),
            },
            NativeSqliteRow {
                table_name: "repair_verification_gates".to_string(),
                primary_key: "gate-1".to_string(),
                payload: serde_json::json!({
                    "id": "gate-1", "candidate_id": "repair-1", "gate_kind": "security", "status": "pending",
                    "evidence": "attack replay has not run", "required_action": "run identical attack corpus", "created_at": 1
                }),
                _sql_text: String::new(),
            },
            NativeSqliteRow {
                table_name: "formal_verification_runs".to_string(),
                primary_key: "formal-1".to_string(),
                payload: serde_json::json!({
                    "id": "formal-1", "project_id": "project-1", "obligation_id": "callsite-range-1",
                    "title": "caller argument satisfies callee range", "status": "counterexample",
                    "solver": "Z3", "solver_version": "test", "formula_hash": "abc",
                    "formula": "(set-logic QF_LIA)\n(check-sat)", "result": "sat",
                    "duration_ms": 1, "sandbox_status": "enforced", "evidence": ["bounded input"],
                    "created_at": 1, "file_name": "src/caller.ts", "function_id": "caller", "line": 12,
                    "counterexample": "arg = -1", "call_chain": ["caller", "validate"]
                }),
                _sql_text: String::new(),
            },
        ];
        apply_insert_rows(&mut conn, &rows).expect("persist verification chain");
        let obligation_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM verification_obligations", [], |row| {
                row.get(0)
            })
            .expect("count obligations");
        let write_back_allowed: i64 = conn
            .query_row(
                "SELECT safe_to_write_back FROM verified_repair_candidates WHERE id='repair-1'",
                [],
                |row| row.get(0),
            )
            .expect("read repair gate result");
        let gate_status: String = conn
            .query_row(
                "SELECT status FROM repair_verification_gates WHERE candidate_id='repair-1'",
                [],
                |row| row.get(0),
            )
            .expect("read gate status");
        let call_chain: String = conn
            .query_row(
                "SELECT call_chain FROM formal_verification_runs WHERE id='formal-1'",
                [],
                |row| row.get(0),
            )
            .expect("read formal call chain");
        assert_eq!(obligation_count, 1);
        assert_eq!(write_back_allowed, 0);
        assert_eq!(gate_status, "pending");
        assert_eq!(call_chain, r#"["caller","validate"]"#);
    }

    #[test]
    fn native_sqlite_persists_versioned_security_corpus_and_replay_results() {
        let mut conn = Connection::open_in_memory().expect("open security corpus sqlite");
        conn.execute_batch(NATIVE_SCHEMA)
            .expect("initialize security corpus schema");
        let rows = vec![
            NativeSqliteRow {
                table_name: "security_attack_corpora".to_string(),
                primary_key: "corpus-v2".to_string(),
                payload: serde_json::json!({ "id": "corpus-v2", "version": "v2", "checksum": "deadbeef", "case_count": 8, "provenance": ["CWE"], "status": "active", "created_at": 1 }),
                _sql_text: String::new(),
            },
            NativeSqliteRow {
                table_name: "security_attack_cases".to_string(),
                primary_key: "corpus-v2:security-sql-v2".to_string(),
                payload: serde_json::json!({ "id": "corpus-v2:security-sql-v2", "corpus_id": "corpus-v2", "sample_id": "security-sql-v2", "kind": "sql-injection", "title": "SQL injection", "protocol": "framework-request", "framework_hints": ["FastAPI"], "weakness_ids": ["CWE-89"], "expected": "no-canary-leak", "payload_hash": "abc", "provenance": "CWE", "created_at": 1 }),
                _sql_text: String::new(),
            },
            NativeSqliteRow {
                table_name: "security_assertion_runs".to_string(),
                primary_key: "assertion-1".to_string(),
                payload: serde_json::json!({ "id": "assertion-1", "corpus_id": "corpus-v2", "project_id": "project", "sample_id": "security-sql-v2", "status": "failed", "runtime_run_id": "run-1", "framework_hints": ["FastAPI"], "evidence": ["taint reached sink"], "created_at": 2 }),
                _sql_text: String::new(),
            },
        ];
        apply_insert_rows(&mut conn, &rows).expect("persist security corpus replay");
        let stored: (String, String) = conn.query_row(
            "SELECT c.checksum, r.status FROM security_attack_corpora c JOIN security_assertion_runs r ON r.corpus_id = c.id WHERE r.id='assertion-1'",
            [], |row| Ok((row.get(0)?, row.get(1)?)),
        ).expect("read security replay");
        assert_eq!(stored, ("deadbeef".to_string(), "failed".to_string()));
        let case_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM security_attack_cases WHERE corpus_id='corpus-v2' AND payload_hash='abc'",
            [], |row| row.get(0),
        ).expect("read persisted attack case metadata");
        assert_eq!(case_count, 1);
    }

    #[test]
    fn z3_proves_all_verification_policy_invariants() {
        if Command::new("z3").arg("--version").output().is_err() {
            return;
        }
        for (id, _, body) in formal_policy_specs() {
            let mut child = Command::new("z3")
                .args(["-in", "-T:5"])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .expect("start Z3");
            child
                .stdin
                .take()
                .expect("Z3 stdin")
                .write_all(format!("(set-logic ALL)\n{body}\n(check-sat)\n").as_bytes())
                .expect("write SMT formula");
            let output = child.wait_with_output().expect("wait for Z3");
            assert!(output.status.success(), "Z3 failed for {id}");
            assert_eq!(
                String::from_utf8_lossy(&output.stdout).trim(),
                "unsat",
                "policy {id} has a counterexample"
            );
        }
    }

    #[test]
    fn project_smt_gate_accepts_bounded_contracts_and_rejects_solver_options() {
        let safe = "(set-logic QF_UF)\n(declare-const tainted Bool)\n(declare-const sanitized Bool)\n(assert (not (=> tainted sanitized)))\n(check-sat)";
        assert!(validate_project_smt_formula(safe).is_ok());
        assert!(validate_project_smt_formula(
            "(set-logic QF_UF)\n(set-option :timeout 0)\n(check-sat)"
        )
        .is_err());
        assert!(validate_project_smt_formula("(set-logic ALL)\n(check-sat)").is_err());
    }

    #[test]
    fn native_workspace_snapshot_restores_projects_and_removes_deleted_rows() {
        let mut conn = Connection::open_in_memory().expect("open in-memory sqlite");
        conn.execute_batch(NATIVE_SCHEMA)
            .expect("initialize native schema");
        let first = workspace_fixture_rows("project-a", "file-a", 10);
        replace_workspace_rows(&mut conn, &first).expect("write first workspace snapshot");
        let loaded = load_workspace_snapshot(&conn)
            .expect("load first workspace snapshot")
            .expect("workspace exists");
        assert_eq!(loaded.projects.len(), 1);
        assert_eq!(loaded.projects[0].files.len(), 1);
        assert_eq!(loaded.active_project_id.as_deref(), Some("project-a"));

        let second = workspace_fixture_rows("project-b", "file-b", 20);
        replace_workspace_rows(&mut conn, &second).expect("replace workspace snapshot");
        let loaded = load_workspace_snapshot(&conn)
            .expect("load replaced workspace snapshot")
            .expect("replacement workspace exists");
        assert_eq!(loaded.projects.len(), 1);
        assert_eq!(loaded.projects[0].id, "project-b");
        assert_eq!(loaded.projects[0].files[0].id, "file-b");
        let stale_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM workspace_projects WHERE id = 'project-a'",
                [],
                |row| row.get(0),
            )
            .expect("count stale projects");
        assert_eq!(stale_count, 0);
    }

    #[test]
    fn native_schema_migration_preserves_legacy_data_and_creates_recovery_point() {
        let directory = std::env::temp_dir().join(format!(
            "codeflow-schema-migration-{}-{}",
            std::process::id(),
            now_ms()
        ));
        fs::create_dir_all(&directory).expect("create migration fixture directory");
        let path = directory.join(DATABASE_FILE);
        let conn = Connection::open(&path).expect("open legacy SQLite fixture");
        conn.execute_batch(
            "CREATE TABLE legacy_probe (id TEXT PRIMARY KEY, value TEXT NOT NULL);
             INSERT INTO legacy_probe VALUES ('preserved', 'yes');
             PRAGMA user_version = 1;",
        )
        .expect("create legacy schema fixture");
        initialize_native_database(&conn, &path).expect("migrate legacy schema");
        let version: u32 = conn
            .query_row("PRAGMA user_version;", [], |row| row.get(0))
            .expect("read migrated version");
        let preserved: String = conn
            .query_row(
                "SELECT value FROM legacy_probe WHERE id = 'preserved'",
                [],
                |row| row.get(0),
            )
            .expect("legacy row remains available");
        let migration_count: u32 = conn
            .query_row(
                "SELECT COUNT(*) FROM native_schema_migrations WHERE version = ?1",
                [DATABASE_SCHEMA_VERSION],
                |row| row.get(0),
            )
            .expect("migration is recorded");
        drop(conn);
        let backup_count = fs::read_dir(&directory)
            .expect("read migration fixture directory")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".bak"))
            .count();
        assert_eq!(version, DATABASE_SCHEMA_VERSION);
        assert_eq!(preserved, "yes");
        assert_eq!(migration_count, 1);
        assert_eq!(backup_count, 1);
        let _ = fs::remove_dir_all(directory);
    }

    fn workspace_fixture_rows(
        project_id: &str,
        file_id: &str,
        updated_at: i64,
    ) -> Vec<NativeSqliteRow> {
        vec![
            NativeSqliteRow {
                table_name: "workspace_projects".to_string(),
                primary_key: project_id.to_string(),
                payload: serde_json::json!({
                    "id": project_id,
                    "name": format!("Project {project_id}"),
                    "source": "folder",
                    "root_hint": "src",
                    "file_count": 1,
                    "language_summary": {"TypeScript": 1},
                    "created_at": updated_at,
                    "updated_at": updated_at
                }),
                _sql_text: String::new(),
            },
            NativeSqliteRow {
                table_name: "workspace_project_files".to_string(),
                primary_key: file_id.to_string(),
                payload: serde_json::json!({
                    "id": file_id,
                    "project_id": project_id,
                    "path": "src/main.ts",
                    "language": "TypeScript",
                    "content": "export function main() { return 1; }",
                    "hash": "fixture",
                    "size": 36,
                    "last_modified": updated_at,
                    "imports": [],
                    "environment_refs": [],
                    "device_refs": []
                }),
                _sql_text: String::new(),
            },
            NativeSqliteRow {
                table_name: "workspace_project_state".to_string(),
                primary_key: "active-workspace".to_string(),
                payload: serde_json::json!({
                    "id": "active-workspace",
                    "active_project_id": project_id,
                    "updated_at": updated_at
                }),
                _sql_text: String::new(),
            },
        ]
    }
}
