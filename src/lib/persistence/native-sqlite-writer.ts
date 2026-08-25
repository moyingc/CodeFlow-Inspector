import type {
  CodeFile,
  DeepWebModelBaseline,
  FlowEdge,
  FlowNode,
  FunctionInfo,
  GraphEdge,
  ParserReport,
  WorkspaceAnalysis,
} from "@/src/lib/analysis/types";
import type { DeepWebSqliteJournalRow } from "@/src/lib/persistence/deepweb-sqlite-journal";
import type {
  WorkspaceProjectRecord,
  WorkspaceProjectSqliteRow,
  WorkspaceProjectStorePayload,
} from "@/src/lib/workspace/project-store";
import { simpleHash } from "@/src/lib/workspace/files";

export const NATIVE_SQLITE_DB_FILE = "codeflow.sqlite3";
export const NATIVE_SQLITE_WRITER_TABLES = [
  "workspace_projects",
  "workspace_project_files",
  "workspace_project_state",
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
] as const;

export type NativeSqliteWriterKind = "workspace_projects" | "deepweb_journal" | "code_index" | "bundle";

export type NativeSqliteRow = {
  tableName: string;
  primaryKey: string;
  payload: Record<string, unknown>;
  sqlText: string;
};

export type NativeSqliteReport = {
  status: "synced" | "warming" | "unavailable";
  engineKind: "native_sqlite";
  storageMode: "Tauri native SQLite";
  writerKind: NativeSqliteWriterKind;
  rowCount: number;
  tableCount: number;
  databasePath: string;
  lastSyncedAt: number;
  evidence: string;
  next: string;
};

type NativeSqliteBundleInput = {
  workspaceRows: WorkspaceProjectSqliteRow[];
  deepWebRows: DeepWebSqliteJournalRow[];
  codeIndexRows: NativeSqliteRow[];
};

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type TauriWindow = Window & {
  __TAURI__?: {
    invoke?: TauriInvoke;
    core?: {
      invoke?: TauriInvoke;
    };
  };
  __TAURI_INTERNALS__?: {
    invoke?: TauriInvoke;
  };
};

export function buildNativeSqliteUnavailableReport(
  reason = "Tauri 桌面壳未运行，native SQLite writer 暂未挂载。",
): NativeSqliteReport {
  return {
    status: "warming",
    engineKind: "native_sqlite",
    storageMode: "Tauri native SQLite",
    writerKind: "bundle",
    rowCount: 0,
    tableCount: 0,
    databasePath: NATIVE_SQLITE_DB_FILE,
    lastSyncedAt: 0,
    evidence: reason,
    next: "在桌面程序里启动后，项目库、DeepWeb journal 和代码索引会并联写入本地 codeflow.sqlite3；Web 预览继续保留 OPFS/IndexedDB 回退。",
  };
}

export async function syncNativeSqliteWriters(input: NativeSqliteBundleInput): Promise<NativeSqliteReport> {
  const invoke = nativeInvoke();
  if (!invoke) return buildNativeSqliteUnavailableReport();

  const workspaceRows = normalizeNativeRows(input.workspaceRows);
  const deepWebRows = normalizeNativeRows(input.deepWebRows.map(nativeRowFromDeepWebJournal));
  const codeIndexRows = normalizeNativeRows(input.codeIndexRows);

  const reports: NativeSqliteReport[] = [];
  if (workspaceRows.length) reports.push(await invoke("codeflow_sync_workspace_projects", { rows: workspaceRows }));
  if (codeIndexRows.length) reports.push(await invoke("codeflow_sync_code_index", { rows: codeIndexRows }));
  if (deepWebRows.length) reports.push(await invoke("codeflow_sync_deepweb_journal", { rows: deepWebRows }));

  if (!reports.length) return buildNativeSqliteUnavailableReport("没有项目、DeepWeb 或代码索引行可以写入 native SQLite。");
  return combineNativeReports(reports);
}

export async function clearNativeSqliteDatabase(): Promise<NativeSqliteReport> {
  const invoke = nativeInvoke();
  if (!invoke) return buildNativeSqliteUnavailableReport();
  return invoke("codeflow_clear_native_database");
}

export async function loadNativeDeepWebModelBaseline(): Promise<DeepWebModelBaseline | null> {
  const invoke = nativeInvoke();
  if (!invoke) return null;
  const baseline = await invoke<DeepWebModelBaseline | null>("codeflow_deepweb_model_baseline");
  if (!baseline || baseline.status !== "stable" || baseline.featureSchemaVersion !== "deepweb-14d-v1") return null;
  return baseline;
}

export async function loadNativeWorkspaceProjectStore(): Promise<WorkspaceProjectStorePayload | null> {
  const invoke = nativeInvoke();
  if (!invoke) return null;
  return invoke<WorkspaceProjectStorePayload | null>("codeflow_load_workspace_projects");
}

export function buildNativeCodeIndexSqliteRows(
  project: WorkspaceProjectRecord,
  functions: FunctionInfo[],
  edges: GraphEdge[],
  parseReport: ParserReport,
  analysis: WorkspaceAnalysis,
): NativeSqliteRow[] {
  const runId = `analysis-${project.id}-${simpleHash(`${project.updatedAt}-${functions.length}-${analysis.flowEdges.length}-${analysis.issues.length}`)}`;
  const createdAt = project.updatedAt || Date.now();
  const rows: NativeSqliteRow[] = [];

  rows.push(
    sqliteRow("analysis_runs", runId, {
      id: runId,
      project_name: project.name,
      root_path: inferRootPath(project.files),
      main_file_id: analysis.mainFile?.id ?? null,
      entry_function_id: analysis.entryFunction ? scopedId(runId, analysis.entryFunction.id) : null,
      parser_mode: parseReport.mode,
      file_count: project.files.length,
      function_count: functions.length,
      integrity_score: analysis.semanticIndex.integrityScore,
      created_at: createdAt,
    }),
  );

  project.files.forEach((file) => rows.push(projectFileRow(runId, file)));
  functions.forEach((fn) => rows.push(projectFunctionRow(runId, fn)));
  edges.forEach((edge, index) => rows.push(callEdgeRow(runId, edge, index)));
  analysis.flowNodes.forEach((node) => rows.push(flowNodeRow(runId, node)));
  analysis.flowEdges.forEach((edge) => rows.push(flowEdgeRow(runId, edge)));
  analysis.digitalTwin.experiments.forEach((experiment) => {
    rows.push(
      sqliteRow("digital_twin_experiments", scopedId(runId, experiment.id), {
        id: scopedId(runId, experiment.id),
        run_id: runId,
        experiment_kind: experiment.kind,
        name: experiment.name,
        objective: experiment.objective,
        evidence_grade: experiment.evidenceGrade,
        status: experiment.status,
        confidence: experiment.confidence,
        affected_node_ids: experiment.affectedNodeIds.map((id) => scopedId(runId, id)),
        input_model: experiment.inputModel,
        expected_behavior: experiment.expectedBehavior,
        observed_or_estimated: experiment.observedOrEstimated,
        metrics: experiment.metrics,
        evidence: experiment.evidence,
        next_action: experiment.nextAction,
        created_at: createdAt,
      }),
    );
  });
  analysis.digitalTwin.variants.forEach((variant) => {
    rows.push(
      sqliteRow("digital_twin_variants", scopedId(runId, variant.id), {
        id: scopedId(runId, variant.id),
        run_id: runId,
        name: variant.name,
        target: variant.target,
        change_summary: variant.change,
        evidence_grade: variant.evidenceGrade,
        performance_gain: variant.estimatedPerformanceGain,
        stability_delta: variant.estimatedStabilityDelta,
        security_delta: variant.estimatedSecurityDelta,
        resource_delta: variant.estimatedResourceDelta,
        fit_score: variant.fitScore,
        validation_gate: variant.validationGate,
        recommendation: variant.recommendation,
        evidence: variant.evidence,
        created_at: createdAt,
      }),
    );
  });

  const verification = analysis.programVerification;
  const verificationRunId = scopedId(runId, "program-verification");
  rows.push(
    sqliteRow("program_verification_runs", verificationRunId, {
      id: verificationRunId,
      run_id: runId,
      status: verification.status,
      score: verification.score,
      soundness_cap: verification.soundnessCap,
      obligation_count: verification.obligationCount,
      proved_count: verification.provedCount,
      observed_count: verification.observedCount,
      violated_count: verification.violatedCount,
      unproved_count: verification.unprovedCount,
      blocked_count: verification.blockedCount,
      runtime_evidence_count: verification.runtimeEvidenceCount,
      benchmark_evidence_count: verification.benchmarkEvidenceCount,
      formal_evidence_count: verification.formalEvidenceCount,
      gaps: verification.gaps,
      next_steps: verification.next,
      created_at: createdAt,
    }),
  );
  verification.obligations.forEach((obligation) => {
    rows.push(
      sqliteRow("verification_obligations", scopedId(runId, obligation.id), {
        id: scopedId(runId, obligation.id),
        verification_run_id: verificationRunId,
        run_id: runId,
        source_ids: obligation.sourceIds,
        domain: obligation.domain,
        title: obligation.title,
        requirement: obligation.requirement,
        status: obligation.status,
        evidence_grade: obligation.evidenceGrade,
        confidence: obligation.confidence,
        evidence: obligation.evidence,
        missing_evidence: obligation.missingEvidence,
        suggested_action: obligation.missingEvidence[0] ?? "保持证据并复查。",
        created_at: createdAt,
      }),
    );
  });
  verification.repairCandidates.forEach((candidate) => {
    const candidateId = scopedId(runId, candidate.id);
    rows.push(
      sqliteRow("verified_repair_candidates", candidateId, {
        id: candidateId,
        verification_run_id: verificationRunId,
        run_id: runId,
        variant_id: scopedId(runId, candidate.sourceIds[0] ?? candidate.id),
        title: candidate.name,
        status: candidate.status,
        safe_to_write_back: candidate.safeToWriteBack,
        summary: `${candidate.target}：${candidate.change}`,
        evidence: candidate.sourceIds,
        created_at: createdAt,
      }),
    );
    candidate.gates.forEach((gate) => {
      const gateId = scopedId(runId, `${candidate.id}:${gate.id}`);
      rows.push(
        sqliteRow("repair_verification_gates", gateId, {
          id: gateId,
          candidate_id: candidateId,
          gate_kind: gate.id,
          status: gate.status,
          evidence: gate.evidence,
          required_action: gate.status === "passed" ? "已满足，无需操作。" : gate.evidence,
          created_at: createdAt,
        }),
      );
    });
  });

  return rows;
}

function projectFileRow(runId: string, file: CodeFile): NativeSqliteRow {
  return sqliteRow("project_files", scopedId(runId, file.id), {
    id: scopedId(runId, file.id),
    run_id: runId,
    path: file.name,
    language: file.language,
    hash: file.hash ?? simpleHash(file.content),
    size: file.size ?? file.content.length,
    last_modified: file.lastModified ?? null,
    imports: file.imports ?? [],
    environment_refs: file.environmentRefs ?? [],
  });
}

function projectFunctionRow(runId: string, fn: FunctionInfo): NativeSqliteRow {
  return sqliteRow("project_functions", scopedId(runId, fn.id), {
    id: scopedId(runId, fn.id),
    run_id: runId,
    file_id: scopedId(runId, fn.fileId),
    name: fn.name,
    language: fn.language,
    start_line: fn.startLine,
    end_line: fn.endLine,
    params: fn.params,
    return_type: fn.returnType,
    outputs: fn.outputs,
    calls: fn.calls,
    body_hash: simpleHash(fn.body),
    summary: fn.summary,
    data_shape: fn.dataShape,
    complexity: fn.complexity,
    category: fn.category,
    side_effects: fn.sideEffects,
    external_inputs: fn.externalInputs,
    validations: fn.validations,
    risks: fn.risks,
    source: fn.source,
    confidence: fn.confidence,
    parser: fn.parser ?? "LocalParser",
    parse_evidence: fn.parseEvidence ?? [],
  });
}

function callEdgeRow(runId: string, edge: GraphEdge, index: number): NativeSqliteRow {
  const id = scopedId(runId, `call-${index}-${edge.from}-${edge.to}`);
  return sqliteRow("call_edges", id, {
    id,
    run_id: runId,
    from_function_id: scopedId(runId, edge.from),
    to_function_id: scopedId(runId, edge.to),
    kind: edge.kind ?? "call",
    confidence: edge.confidence ?? 72,
    evidence: edge.evidence ?? "local parser call edge",
  });
}

function flowNodeRow(runId: string, node: FlowNode): NativeSqliteRow {
  return sqliteRow("flow_nodes", scopedId(runId, node.id), {
    id: scopedId(runId, node.id),
    run_id: runId,
    function_id: node.functionId ? scopedId(runId, node.functionId) : null,
    name: node.name,
    role: node.role,
    status: node.status,
    note: node.note,
    capacity: node.capacity ?? "河道",
    capacity_score: node.capacityScore ?? 0,
    confidence: node.confidence ?? 0,
    evidence: node.evidence ?? "",
    details: node.details ?? [],
    x: node.x ?? 0,
    y: node.y ?? 0,
    depth: node.depth ?? 0,
    upstream_ids: (node.upstreamIds ?? []).map((id) => scopedId(runId, id)),
    downstream_ids: (node.downstreamIds ?? []).map((id) => scopedId(runId, id)),
  });
}

function flowEdgeRow(runId: string, edge: FlowEdge): NativeSqliteRow {
  return sqliteRow("flow_edges", scopedId(runId, edge.id), {
    id: scopedId(runId, edge.id),
    run_id: runId,
    from_node_id: scopedId(runId, edge.from),
    to_node_id: scopedId(runId, edge.to),
    kind: edge.kind,
    status: edge.status,
    volume: edge.volume,
    confidence: edge.confidence,
    evidence: edge.evidence,
    primary: edge.primary ?? false,
    transfer_kind: edge.transferKind ?? "unknown",
    data_items: edge.dataItems ?? [],
    source_kind: edge.sourceKind ?? "unknown",
    sink_kind: edge.sinkKind ?? "unknown",
    evidence_grade: edge.evidenceGrade ?? "lexical",
    runtime_observation: edge.runtimeObservation ?? null,
  });
}

function nativeRowFromDeepWebJournal(row: DeepWebSqliteJournalRow): NativeSqliteRow {
  return {
    tableName: row.tableName,
    primaryKey: row.primaryKey,
    payload: row.payload,
    sqlText: row.sql,
  };
}

function normalizeNativeRows(rows: Array<NativeSqliteRow | WorkspaceProjectSqliteRow>): NativeSqliteRow[] {
  return rows.map((row) => ({
    tableName: row.tableName,
    primaryKey: row.primaryKey,
    payload: row.payload,
    sqlText: row.sqlText,
  }));
}

function combineNativeReports(reports: NativeSqliteReport[]): NativeSqliteReport {
  const lastReport = reports[reports.length - 1];
  const rowCount = reports.reduce((sum, report) => sum + report.rowCount, 0);
  const tableCount = Math.max(...reports.map((report) => report.tableCount), NATIVE_SQLITE_WRITER_TABLES.length);
  return {
    status: reports.every((report) => report.status === "synced") ? "synced" : "warming",
    engineKind: "native_sqlite",
    storageMode: "Tauri native SQLite",
    writerKind: "bundle",
    rowCount,
    tableCount,
    databasePath: lastReport.databasePath,
    lastSyncedAt: Math.max(...reports.map((report) => report.lastSyncedAt)),
    evidence: reports.map((report) => report.evidence).join("；"),
    next: "native SQLite 已并联项目库、DeepWeb 和代码索引；下一步可以在桌面壳里增加 SQL 查询页和导入项目后的后台增量索引。",
  };
}

function nativeInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const tauriWindow = window as TauriWindow;
  return tauriWindow.__TAURI__?.core?.invoke ?? tauriWindow.__TAURI__?.invoke ?? tauriWindow.__TAURI_INTERNALS__?.invoke ?? null;
}

function sqliteRow(tableName: string, primaryKey: string, payload: Record<string, unknown>): NativeSqliteRow {
  return {
    tableName,
    primaryKey,
    payload,
    sqlText: `INSERT OR REPLACE INTO ${tableName} (${Object.keys(payload).join(", ")}) VALUES (${Object.values(payload)
      .map(sqlValue)
      .join(", ")});`,
  };
}

function scopedId(runId: string, id: string) {
  return `${runId}:${id}`;
}

function inferRootPath(files: CodeFile[]) {
  const firstNested = files.find((file) => file.name.includes("/"))?.name;
  return firstNested?.split("/")[0] ?? "local-workspace";
}

function quoteSql(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlValue(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "string") return quoteSql(value);
  return quoteSql(JSON.stringify(value));
}
