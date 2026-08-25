import { blob, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ControlledRuntimeExecutionReport } from "../src/lib/analysis/types";

const knowledgeCategory = ["math", "algorithm", "efficiency", "security", "stability", "language_api"] as const;
const knowledgeKind = ["formula", "pattern", "complexity", "risk", "api_signature", "guard"] as const;
const knowledgeSeverity = ["info", "warn", "risk", "critical"] as const;
const evidenceType = ["regex", "ast", "type", "runtime", "dependency"] as const;
const symbolKind = ["param", "output", "external_input", "validation", "side_effect", "risk", "data_shape"] as const;
const graphEdgeKind = ["call", "import", "data"] as const;
const flowStatus = ["Closed", "Partially Closed", "Open", "Overflow Risk", "Blocked", "Unknown"] as const;
const flowEdgeKind = ["水路", "河流", "小溪", "闭环线路", "溢流支路", "异常支路"] as const;
const digitalTwinExperimentKind = ["静态分析", "动态仿真", "压力测试", "容错传播", "算法替换", "安全攻击", "环境迁移"] as const;
const digitalTwinEvidenceGrade = ["静态推断", "模型仿真", "真实执行"] as const;
const digitalTwinExperimentStatus = ["通过", "观察", "风险", "阻塞", "等待执行"] as const;
const digitalTwinRecommendation = ["推荐验证", "谨慎验证", "不建议"] as const;
const controlledRuntimeAdapter = ["node", "python", "rust", "java", "c", "cpp"] as const;
const controlledRuntimeStatus = ["passed", "failed", "timeout", "compile_failed", "unavailable", "rejected"] as const;
const featureKind = ["lexical", "ast", "type", "control_flow", "data_flow", "dependency", "runtime", "benchmark", "hardware"] as const;
const repairKind = ["fix", "optimization", "guard", "refactor", "replacement"] as const;
const environmentKind = ["runtime", "package_manager", "framework", "os", "hardware", "service"] as const;
const sampleOutcome = ["pass", "warning", "blocked", "overflow", "security", "regression"] as const;
const deepwebLayerKind = ["input", "encoder", "projection", "attention", "classifier", "ranker"] as const;
const deepwebActivation = ["linear", "relu", "sigmoid", "softmax", "cosine"] as const;
const deepwebProjectionKind = ["feature", "evidence", "language", "runtime", "repair"] as const;
const deepwebVectorLabel = ["safe", "flow_warning", "security_risk", "stability_risk", "performance_hotspot", "repair_candidate"] as const;
const deepwebValidationKind = [
  "project_trace",
  "fault_replay",
  "benchmark_replay",
  "repair_verification",
  "version_window",
  "language_contract",
  "environment_probe",
  "hardware_bounds",
] as const;
const deepwebValidationEvidenceKind = [
  "project_replay",
  "lexical_trace",
  "benchmark_before_after",
  "repair_verification",
  "dependency_version_probe",
  "language_contract_probe",
  "environment_probe",
  "hardware_bounds_probe",
] as const;
const deepwebExtremeTestCategory = [
  "database_stress",
  "vector_stress",
  "flow_stress",
  "supervision_stress",
  "replay_stress",
  "rollback_stress",
] as const;
const deepwebExtremeTarget = ["database", "deepweb", "hybrid"] as const;
const deepwebExtremeStatus = ["passed", "watch", "blocked"] as const;
const databaseOptimizationKind = ["index", "write_batch", "query_plan", "snapshot", "vector_cache", "rollback"] as const;
const deepwebIrrigationSourceKind = [
  "project_scan",
  "rule_teacher",
  "validation_replay",
  "runtime_trace",
  "benchmark_profile",
  "repair_recipe",
  "environment_probe",
  "hardware_probe",
  "extreme_test",
  "inference_feedback",
] as const;
const deepwebIrrigationRunStatus = ["hydrated", "guarded", "blocked"] as const;
const deepwebIrrigationBatchStatus = ["accepted", "review", "isolated"] as const;
const deepwebIrrigationEpochStage = ["collect", "label", "replay", "calibrate", "checkpoint"] as const;
const deepwebIrrigationEpochStatus = ["passed", "watch", "blocked"] as const;
const deepwebWeightUpdateGate = ["accepted", "clamped", "rejected"] as const;
const deepwebReplaySnapshotStatus = ["stable", "watch", "blocked"] as const;
const deepwebReplayComparisonStatus = ["improved", "stable", "watch", "regressed"] as const;
const deepwebReplayPromotionTarget = ["feature_vector", "teacher_label", "weight_update", "repair_recipe", "validation_evidence"] as const;
const deepwebReplayPromotionGate = ["promoted", "held", "isolated", "rolled_back"] as const;
const deepwebLocalSqliteSyncStatus = ["pending", "synced", "exported"] as const;
const deepwebLocalStorageEngineKind = ["local_storage", "indexeddb", "sqljs", "opfs_sqlite", "native_sqlite"] as const;
const deepwebLocalStorageStatus = ["ready", "synced", "warming", "unavailable"] as const;
const deepwebLocalSnapshotExportStatus = ["ready", "empty", "unavailable", "imported"] as const;
const deepwebReliabilityStatus = ["trusted", "watch", "quarantined"] as const;
const deepwebQuarantineReason = ["teacher_conflict", "low_trust", "weak_evidence", "unsafe_consensus"] as const;
const deepwebErrorSignalKind = [
  "teacher_conflict",
  "low_consensus",
  "weak_evidence",
  "high_confidence_low_evidence",
  "prediction_teacher_drift",
  "benchmark_deviation",
  "repair_unverified",
  "rollback_triggered",
] as const;
const deepwebGeneKind = ["dimension_weight", "teacher_weight", "threshold", "expression_gate"] as const;
const deepwebGenomeStrategy = ["stable_parent", "mutation", "crossover", "rollback_candidate"] as const;
const deepwebSupervisionSource = [
  "expert_seed",
  "rule_match",
  "fault_sample",
  "benchmark",
  "sdk_api",
  "version_constraint",
  "repair_recipe",
  "validation_evidence",
  "library_entry",
  "human_review",
] as const;
const localLibraryCategory = [
  "数学模型库",
  "算法模型库",
  "效率知识库",
  "安全规则库",
  "稳定性规则库",
  "语言生态库",
  "运行环境库",
  "电子元件参数库",
  "语义索引库",
  "工具适配器",
] as const;
const localLibraryMaturity = ["core", "extended", "planned"] as const;
const workspaceProjectSource = ["sample", "folder", "files", "draft"] as const;
const workspaceProjectEventKind = ["created", "opened", "updated", "removed", "imported", "sync"] as const;
const workspaceProjectStorageEngineKind = ["indexeddb", "native_sqlite", "opfs_sqlite"] as const;
const workspaceProjectStorageStatus = ["ready", "synced", "warming", "unavailable"] as const;

export const sourceVersions = sqliteTable("source_versions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  version: text("version").notNull(),
  scope: text("scope", { mode: "json" }).$type<string[]>().notNull(),
  updatedAt: text("updated_at").notNull(),
  evidence: text("evidence").notNull(),
});

export const workspaceProjects = sqliteTable(
  "workspace_projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    source: text("source", { enum: workspaceProjectSource }).notNull(),
    rootHint: text("root_hint").notNull(),
    fileCount: integer("file_count", { mode: "number" }).notNull(),
    languageSummary: text("language_summary", { mode: "json" }).$type<Record<string, number>>().notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("workspace_projects_source_idx").on(table.source),
    index("workspace_projects_updated_idx").on(table.updatedAt),
  ],
);

export const workspaceProjectFiles = sqliteTable(
  "workspace_project_files",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => workspaceProjects.id),
    path: text("path").notNull(),
    language: text("language").notNull(),
    content: text("content").notNull(),
    hash: text("hash").notNull(),
    size: integer("size", { mode: "number" }).notNull(),
    lastModified: integer("last_modified", { mode: "number" }),
    imports: text("imports", { mode: "json" }).$type<string[]>().notNull(),
    environmentRefs: text("environment_refs", { mode: "json" }).$type<string[]>().notNull(),
    deviceRefs: text("device_refs", { mode: "json" }).$type<string[]>().notNull(),
  },
  (table) => [
    index("workspace_project_files_project_idx").on(table.projectId),
    index("workspace_project_files_path_idx").on(table.path),
    index("workspace_project_files_language_idx").on(table.language),
  ],
);

export const workspaceProjectState = sqliteTable("workspace_project_state", {
  id: text("id").primaryKey(),
  activeProjectId: text("active_project_id").references(() => workspaceProjects.id),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});

export const workspaceProjectEvents = sqliteTable(
  "workspace_project_events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").references(() => workspaceProjects.id),
    eventKind: text("event_kind", { enum: workspaceProjectEventKind }).notNull(),
    activeProjectId: text("active_project_id"),
    projectCount: integer("project_count", { mode: "number" }).notNull(),
    fileCount: integer("file_count", { mode: "number" }).notNull(),
    evidence: text("evidence").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("workspace_project_events_project_idx").on(table.projectId),
    index("workspace_project_events_kind_idx").on(table.eventKind),
    index("workspace_project_events_created_idx").on(table.createdAt),
  ],
);

export const workspaceProjectStorageEngines = sqliteTable(
  "workspace_project_storage_engines",
  {
    id: text("id").primaryKey(),
    engineKind: text("engine_kind", { enum: workspaceProjectStorageEngineKind }).notNull(),
    storageMode: text("storage_mode").notNull(),
    status: text("status", { enum: workspaceProjectStorageStatus }).notNull(),
    projectCount: integer("project_count", { mode: "number" }).notNull(),
    fileCount: integer("file_count", { mode: "number" }).notNull(),
    tableCount: integer("table_count", { mode: "number" }).notNull(),
    lastSyncedAt: integer("last_synced_at", { mode: "number" }).notNull(),
    evidence: text("evidence").notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("workspace_project_storage_engines_kind_idx").on(table.engineKind),
    index("workspace_project_storage_engines_status_idx").on(table.status),
  ],
);

export const knowledgeConcepts = sqliteTable(
  "knowledge_concepts",
  {
    id: text("id").primaryKey(),
    category: text("category", { enum: knowledgeCategory }).notNull(),
    name: text("name").notNull(),
    summary: text("summary").notNull(),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
    sourceVersionId: text("source_version_id")
      .notNull()
      .references(() => sourceVersions.id),
  },
  (table) => [index("knowledge_concepts_category_idx").on(table.category)],
);

export const knowledgeRules = sqliteTable(
  "knowledge_rules",
  {
    id: text("id").primaryKey(),
    category: text("category", { enum: knowledgeCategory }).notNull(),
    kind: text("kind", { enum: knowledgeKind }).notNull(),
    name: text("name").notNull(),
    summary: text("summary").notNull(),
    appliesTo: text("applies_to", { mode: "json" }).$type<string[]>().notNull(),
    signalPatterns: text("signal_patterns", { mode: "json" }).$type<string[]>().notNull(),
    inputs: text("inputs", { mode: "json" }).$type<string[]>().notNull(),
    outputs: text("outputs", { mode: "json" }).$type<string[]>().notNull(),
    formula: text("formula"),
    complexity: text("complexity"),
    language: text("language"),
    severity: text("severity", { enum: knowledgeSeverity }).notNull(),
    confidenceBase: real("confidence_base").notNull(),
    recommendation: text("recommendation").notNull(),
    safeAlternative: text("safe_alternative"),
    evidenceSource: text("evidence_source").notNull(),
    sourceVersionId: text("source_version_id")
      .notNull()
      .references(() => sourceVersions.id),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("knowledge_rules_category_idx").on(table.category),
    index("knowledge_rules_kind_idx").on(table.kind),
    index("knowledge_rules_severity_idx").on(table.severity),
  ],
);

export const ruleEvidence = sqliteTable(
  "rule_evidence",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => knowledgeRules.id),
    evidenceType: text("evidence_type", { enum: evidenceType }).notNull(),
    matcher: text("matcher").notNull(),
    weight: real("weight").notNull(),
    positiveExample: text("positive_example").notNull(),
    negativeExample: text("negative_example").notNull(),
  },
  (table) => [
    index("rule_evidence_rule_idx").on(table.ruleId),
    index("rule_evidence_type_idx").on(table.evidenceType),
  ],
);

export const ruleMatches = sqliteTable(
  "rule_matches",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => knowledgeRules.id),
    functionId: text("function_id").notNull(),
    functionName: text("function_name").notNull(),
    fileName: text("file_name").notNull(),
    line: integer("line", { mode: "number" }).notNull(),
    category: text("category", { enum: knowledgeCategory }).notNull(),
    severity: text("severity", { enum: knowledgeSeverity }).notNull(),
    confidence: real("confidence").notNull(),
    matchedSignals: text("matched_signals", { mode: "json" }).$type<string[]>().notNull(),
    evidence: text("evidence").notNull(),
    recommendation: text("recommendation").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("rule_matches_rule_idx").on(table.ruleId),
    index("rule_matches_function_idx").on(table.functionId),
    index("rule_matches_severity_idx").on(table.severity),
  ],
);

export const languageApis = sqliteTable(
  "language_apis",
  {
    id: text("id").primaryKey(),
    language: text("language").notNull(),
    module: text("module").notNull(),
    apiName: text("api_name").notNull(),
    signature: text("signature").notNull(),
    behavior: text("behavior").notNull(),
    returns: text("returns").notNull(),
    riskTags: text("risk_tags", { mode: "json" }).$type<string[]>().notNull(),
    safeAlternative: text("safe_alternative").notNull(),
    sourceVersionId: text("source_version_id")
      .notNull()
      .references(() => sourceVersions.id),
  },
  (table) => [
    index("language_apis_language_idx").on(table.language),
    index("language_apis_api_idx").on(table.apiName),
  ],
);

export const libraryDomains = sqliteTable(
  "library_domains",
  {
    id: text("id").primaryKey(),
    category: text("category", { enum: localLibraryCategory }).notNull(),
    targetCount: integer("target_count", { mode: "number" }).notNull(),
    coreDomains: text("core_domains", { mode: "json" }).$type<string[]>().notNull(),
    maturityGoal: text("maturity_goal").notNull(),
    next: text("next").notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [index("library_domains_category_idx").on(table.category)],
);

export const libraryEntries = sqliteTable(
  "library_entries",
  {
    id: text("id").primaryKey(),
    category: text("category", { enum: localLibraryCategory }).notNull(),
    domain: text("domain").notNull(),
    name: text("name").notNull(),
    maturity: text("maturity", { enum: localLibraryMaturity }).notNull(),
    signals: text("signals", { mode: "json" }).$type<string[]>().notNull(),
    evidenceFields: text("evidence_fields", { mode: "json" }).$type<string[]>().notNull(),
    appliesTo: text("applies_to", { mode: "json" }).$type<string[]>().notNull(),
    outputUse: text("output_use").notNull(),
    gaps: text("gaps", { mode: "json" }).$type<string[]>().notNull(),
    sourceVersionId: text("source_version_id").references(() => sourceVersions.id),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("library_entries_category_idx").on(table.category),
    index("library_entries_domain_idx").on(table.domain),
    index("library_entries_maturity_idx").on(table.maturity),
  ],
);

export const analysisRuns = sqliteTable(
  "analysis_runs",
  {
    id: text("id").primaryKey(),
    projectName: text("project_name").notNull(),
    rootPath: text("root_path").notNull(),
    mainFileId: text("main_file_id"),
    entryFunctionId: text("entry_function_id"),
    parserMode: text("parser_mode").notNull(),
    fileCount: integer("file_count", { mode: "number" }).notNull(),
    functionCount: integer("function_count", { mode: "number" }).notNull(),
    integrityScore: real("integrity_score").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("analysis_runs_project_idx").on(table.projectName),
    index("analysis_runs_created_idx").on(table.createdAt),
  ],
);

export const projectFiles = sqliteTable(
  "project_files",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => analysisRuns.id),
    path: text("path").notNull(),
    language: text("language").notNull(),
    hash: text("hash").notNull(),
    size: integer("size", { mode: "number" }).notNull(),
    lastModified: integer("last_modified", { mode: "number" }),
    imports: text("imports", { mode: "json" }).$type<string[]>().notNull(),
    environmentRefs: text("environment_refs", { mode: "json" }).$type<string[]>().notNull(),
  },
  (table) => [
    index("project_files_run_idx").on(table.runId),
    index("project_files_path_idx").on(table.path),
    index("project_files_language_idx").on(table.language),
  ],
);

export const projectFunctions = sqliteTable(
  "project_functions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => analysisRuns.id),
    fileId: text("file_id")
      .notNull()
      .references(() => projectFiles.id),
    name: text("name").notNull(),
    language: text("language").notNull(),
    startLine: integer("start_line", { mode: "number" }).notNull(),
    endLine: integer("end_line", { mode: "number" }).notNull(),
    params: text("params", { mode: "json" }).$type<string[]>().notNull(),
    returnType: text("return_type").notNull(),
    outputs: text("outputs", { mode: "json" }).$type<string[]>().notNull(),
    calls: text("calls", { mode: "json" }).$type<string[]>().notNull(),
    bodyHash: text("body_hash").notNull(),
    summary: text("summary").notNull(),
    dataShape: text("data_shape").notNull(),
    complexity: integer("complexity", { mode: "number" }).notNull(),
    category: text("category").notNull(),
    sideEffects: text("side_effects", { mode: "json" }).$type<string[]>().notNull(),
    externalInputs: text("external_inputs", { mode: "json" }).$type<string[]>().notNull(),
    validations: text("validations", { mode: "json" }).$type<string[]>().notNull(),
    risks: text("risks", { mode: "json" }).$type<string[]>().notNull(),
    source: text("source").notNull(),
    confidence: real("confidence").notNull(),
    parser: text("parser").notNull(),
    parseEvidence: text("parse_evidence", { mode: "json" }).$type<string[]>().notNull(),
  },
  (table) => [
    index("project_functions_run_idx").on(table.runId),
    index("project_functions_file_idx").on(table.fileId),
    index("project_functions_name_idx").on(table.name),
    index("project_functions_confidence_idx").on(table.confidence),
  ],
);

export const functionSymbols = sqliteTable(
  "function_symbols",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => analysisRuns.id),
    functionId: text("function_id")
      .notNull()
      .references(() => projectFunctions.id),
    kind: text("kind", { enum: symbolKind }).notNull(),
    name: text("name").notNull(),
    dataType: text("data_type").notNull(),
    source: text("source").notNull(),
    confidence: real("confidence").notNull(),
    evidence: text("evidence").notNull(),
    position: text("position").notNull(),
  },
  (table) => [
    index("function_symbols_run_idx").on(table.runId),
    index("function_symbols_function_idx").on(table.functionId),
    index("function_symbols_kind_idx").on(table.kind),
    index("function_symbols_name_idx").on(table.name),
  ],
);

export const callEdges = sqliteTable(
  "call_edges",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => analysisRuns.id),
    fromFunctionId: text("from_function_id")
      .notNull()
      .references(() => projectFunctions.id),
    toFunctionId: text("to_function_id")
      .notNull()
      .references(() => projectFunctions.id),
    kind: text("kind", { enum: graphEdgeKind }).notNull(),
    confidence: real("confidence").notNull(),
    evidence: text("evidence").notNull(),
  },
  (table) => [
    index("call_edges_run_idx").on(table.runId),
    index("call_edges_from_idx").on(table.fromFunctionId),
    index("call_edges_to_idx").on(table.toFunctionId),
  ],
);

export const flowNodes = sqliteTable(
  "flow_nodes",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => analysisRuns.id),
    functionId: text("function_id").references(() => projectFunctions.id),
    name: text("name").notNull(),
    role: text("role").notNull(),
    status: text("status", { enum: flowStatus }).notNull(),
    note: text("note").notNull(),
    capacity: text("capacity").notNull(),
    capacityScore: real("capacity_score").notNull(),
    confidence: real("confidence").notNull(),
    evidence: text("evidence").notNull(),
    details: text("details", { mode: "json" }).$type<string[]>().notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    depth: integer("depth", { mode: "number" }).notNull(),
    upstreamIds: text("upstream_ids", { mode: "json" }).$type<string[]>().notNull(),
    downstreamIds: text("downstream_ids", { mode: "json" }).$type<string[]>().notNull(),
  },
  (table) => [
    index("flow_nodes_run_idx").on(table.runId),
    index("flow_nodes_function_idx").on(table.functionId),
    index("flow_nodes_status_idx").on(table.status),
    index("flow_nodes_depth_idx").on(table.depth),
  ],
);

export const flowEdges = sqliteTable(
  "flow_edges",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => analysisRuns.id),
    fromNodeId: text("from_node_id")
      .notNull()
      .references(() => flowNodes.id),
    toNodeId: text("to_node_id")
      .notNull()
      .references(() => flowNodes.id),
    kind: text("kind", { enum: flowEdgeKind }).notNull(),
    status: text("status", { enum: flowStatus }).notNull(),
    volume: real("volume").notNull(),
    confidence: real("confidence").notNull(),
    evidence: text("evidence").notNull(),
    primary: integer("primary", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("flow_edges_run_idx").on(table.runId),
    index("flow_edges_from_idx").on(table.fromNodeId),
    index("flow_edges_to_idx").on(table.toNodeId),
    index("flow_edges_status_idx").on(table.status),
  ],
);

export const digitalTwinExperiments = sqliteTable(
  "digital_twin_experiments",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => analysisRuns.id),
    experimentKind: text("experiment_kind", { enum: digitalTwinExperimentKind }).notNull(),
    name: text("name").notNull(),
    objective: text("objective").notNull(),
    evidenceGrade: text("evidence_grade", { enum: digitalTwinEvidenceGrade }).notNull(),
    traceSource: text("trace_source").notNull().default("none"),
    status: text("status", { enum: digitalTwinExperimentStatus }).notNull(),
    confidence: real("confidence").notNull(),
    affectedNodeIds: text("affected_node_ids", { mode: "json" }).$type<string[]>().notNull(),
    inputModel: text("input_model").notNull(),
    expectedBehavior: text("expected_behavior").notNull(),
    observedOrEstimated: text("observed_or_estimated").notNull(),
    metrics: text("metrics", { mode: "json" })
      .$type<{ performance: number; stability: number; security: number; resource: number }>()
      .notNull(),
    evidence: text("evidence", { mode: "json" }).$type<string[]>().notNull(),
    nextAction: text("next_action").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("digital_twin_experiments_run_idx").on(table.runId),
    index("digital_twin_experiments_kind_idx").on(table.experimentKind),
    index("digital_twin_experiments_status_idx").on(table.status),
  ],
);

export const digitalTwinVariants = sqliteTable(
  "digital_twin_variants",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => analysisRuns.id),
    name: text("name").notNull(),
    target: text("target").notNull(),
    changeSummary: text("change_summary").notNull(),
    evidenceGrade: text("evidence_grade", { enum: digitalTwinEvidenceGrade }).notNull(),
    performanceGain: real("performance_gain").notNull(),
    stabilityDelta: real("stability_delta").notNull(),
    securityDelta: real("security_delta").notNull(),
    resourceDelta: real("resource_delta").notNull(),
    fitScore: real("fit_score").notNull(),
    validationGate: text("validation_gate").notNull(),
    recommendation: text("recommendation", { enum: digitalTwinRecommendation }).notNull(),
    evidence: text("evidence").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("digital_twin_variants_run_idx").on(table.runId),
    index("digital_twin_variants_fit_idx").on(table.fitScore),
    index("digital_twin_variants_recommendation_idx").on(table.recommendation),
  ],
);

export const programVerificationRuns = sqliteTable(
  "program_verification_runs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => analysisRuns.id),
    status: text("status").notNull(),
    score: real("score").notNull(),
    soundnessCap: real("soundness_cap").notNull(),
    obligationCount: integer("obligation_count").notNull(),
    provedCount: integer("proved_count").notNull(),
    observedCount: integer("observed_count").notNull(),
    violatedCount: integer("violated_count").notNull(),
    unprovedCount: integer("unproved_count").notNull(),
    blockedCount: integer("blocked_count").notNull(),
    runtimeEvidenceCount: integer("runtime_evidence_count").notNull(),
    benchmarkEvidenceCount: integer("benchmark_evidence_count").notNull(),
    formalEvidenceCount: integer("formal_evidence_count").notNull(),
    gaps: text("gaps", { mode: "json" }).$type<string[]>().notNull(),
    nextSteps: text("next_steps", { mode: "json" }).$type<string[]>().notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("program_verification_runs_run_idx").on(table.runId), index("program_verification_runs_status_idx").on(table.status)],
);

export const verificationObligations = sqliteTable(
  "verification_obligations",
  {
    id: text("id").primaryKey(),
    verificationRunId: text("verification_run_id").notNull().references(() => programVerificationRuns.id),
    runId: text("run_id").notNull().references(() => analysisRuns.id),
    sourceIds: text("source_ids", { mode: "json" }).$type<string[]>().notNull(),
    domain: text("domain").notNull(),
    title: text("title").notNull(),
    requirement: text("requirement").notNull(),
    status: text("status").notNull(),
    evidenceGrade: text("evidence_grade").notNull(),
    confidence: real("confidence").notNull(),
    evidence: text("evidence", { mode: "json" }).$type<string[]>().notNull(),
    missingEvidence: text("missing_evidence", { mode: "json" }).$type<string[]>().notNull(),
    suggestedAction: text("suggested_action").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("verification_obligations_run_idx").on(table.verificationRunId), index("verification_obligations_status_idx").on(table.status)],
);

export const verifiedRepairCandidates = sqliteTable(
  "verified_repair_candidates",
  {
    id: text("id").primaryKey(),
    verificationRunId: text("verification_run_id").notNull().references(() => programVerificationRuns.id),
    runId: text("run_id").notNull().references(() => analysisRuns.id),
    variantId: text("variant_id").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull(),
    safeToWriteBack: integer("safe_to_write_back", { mode: "boolean" }).notNull(),
    summary: text("summary").notNull(),
    evidence: text("evidence", { mode: "json" }).$type<string[]>().notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("verified_repair_candidates_run_idx").on(table.verificationRunId), index("verified_repair_candidates_status_idx").on(table.status)],
);

export const repairVerificationGates = sqliteTable(
  "repair_verification_gates",
  {
    id: text("id").primaryKey(),
    candidateId: text("candidate_id").notNull().references(() => verifiedRepairCandidates.id),
    gateKind: text("gate_kind").notNull(),
    status: text("status").notNull(),
    evidence: text("evidence", { mode: "json" }).$type<string[]>().notNull(),
    requiredAction: text("required_action").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("repair_verification_gates_candidate_idx").on(table.candidateId), index("repair_verification_gates_status_idx").on(table.status)],
);

export const formalVerificationRuns = sqliteTable(
  "formal_verification_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    obligationId: text("obligation_id").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull(),
    solver: text("solver").notNull(),
    solverVersion: text("solver_version").notNull(),
    formulaHash: text("formula_hash").notNull(),
    formula: text("formula").notNull(),
    result: text("result").notNull(),
    durationMs: integer("duration_ms").notNull(),
    sandboxStatus: text("sandbox_status").notNull(),
    evidence: text("evidence", { mode: "json" }).$type<string[]>().notNull(),
    createdAt: integer("created_at").notNull(),
    fileName: text("file_name"),
    functionId: text("function_id"),
    line: integer("line"),
    counterexample: text("counterexample"),
    callChain: text("call_chain", { mode: "json" }).$type<string[]>().notNull().default([]),
  },
  (table) => [index("formal_verification_runs_project_idx").on(table.projectId), index("formal_verification_runs_status_idx").on(table.status)],
);

export const runtimeExecutionRuns = sqliteTable(
  "runtime_execution_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    projectName: text("project_name").notNull(),
    adapter: text("adapter", { enum: controlledRuntimeAdapter }).notNull(),
    status: text("status", { enum: controlledRuntimeStatus }).notNull(),
    evidenceGrade: text("evidence_grade", { enum: digitalTwinEvidenceGrade }).notNull(),
    experimentKind: text("experiment_kind").notNull().default("baseline"),
    sampleId: text("sample_id").notNull().default("baseline-user-input"),
    repetition: integer("repetition", { mode: "number" }).notNull().default(1),
    inputBytes: integer("input_bytes", { mode: "number" }).notNull().default(0),
    traceEvents: text("trace_events", { mode: "json" })
      .$type<ControlledRuntimeExecutionReport["traceEvents"]>()
      .notNull()
      .default([]),
    traceSource: text("trace_source").notNull().default("none"),
    sanitizerStatus: text("sanitizer_status").notNull().default("not-requested"),
    sanitizerFindings: text("sanitizer_findings", { mode: "json" }).$type<string[]>().notNull().default([]),
    entryPath: text("entry_path").notNull(),
    commandLabel: text("command_label").notNull(),
    exitCode: integer("exit_code", { mode: "number" }),
    timedOut: integer("timed_out", { mode: "boolean" }).notNull(),
    durationMs: integer("duration_ms", { mode: "number" }).notNull(),
    stdout: text("stdout").notNull(),
    stderr: text("stderr").notNull(),
    stdoutTruncated: integer("stdout_truncated", { mode: "boolean" }).notNull(),
    stderrTruncated: integer("stderr_truncated", { mode: "boolean" }).notNull(),
    compileOutput: text("compile_output").notNull(),
    fileCount: integer("file_count", { mode: "number" }).notNull(),
    totalBytes: integer("total_bytes", { mode: "number" }).notNull(),
    sandboxKind: text("sandbox_kind").notNull(),
    sandboxStatus: text("sandbox_status").notNull(),
    sandboxEvidence: text("sandbox_evidence").notNull(),
    cpuTimeMs: integer("cpu_time_ms", { mode: "number" }).notNull(),
    peakMemoryBytes: integer("peak_memory_bytes", { mode: "number" }).notNull(),
    childProcessCount: integer("child_process_count", { mode: "number" }).notNull(),
    childProcesses: text("child_processes", { mode: "json" })
      .$type<ControlledRuntimeExecutionReport["childProcesses"]>()
      .notNull(),
    fileChanges: text("file_changes", { mode: "json" })
      .$type<ControlledRuntimeExecutionReport["fileChanges"]>()
      .notNull(),
    isolation: text("isolation", { mode: "json" }).$type<string[]>().notNull(),
    evidence: text("evidence", { mode: "json" }).$type<string[]>().notNull(),
    startedAt: integer("started_at", { mode: "number" }).notNull(),
    finishedAt: integer("finished_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("runtime_execution_runs_project_idx").on(table.projectId),
    index("runtime_execution_runs_status_idx").on(table.status),
    index("runtime_execution_runs_started_idx").on(table.startedAt),
  ],
);

export const securityAttackCorpora = sqliteTable("security_attack_corpora", {
  id: text("id").primaryKey(),
  version: text("version").notNull(),
  checksum: text("checksum").notNull(),
  caseCount: integer("case_count", { mode: "number" }).notNull(),
  provenance: text("provenance", { mode: "json" }).$type<string[]>().notNull(),
  status: text("status").notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
});

export const securityAttackCases = sqliteTable("security_attack_cases", {
  id: text("id").primaryKey(),
  corpusId: text("corpus_id").notNull().references(() => securityAttackCorpora.id),
  sampleId: text("sample_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  protocol: text("protocol").notNull(),
  frameworkHints: text("framework_hints", { mode: "json" }).$type<string[]>().notNull(),
  weaknessIds: text("weakness_ids", { mode: "json" }).$type<string[]>().notNull(),
  expected: text("expected").notNull(),
  payloadHash: text("payload_hash").notNull(),
  provenance: text("provenance").notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
});

export const securityAssertionRuns = sqliteTable(
  "security_assertion_runs",
  {
    id: text("id").primaryKey(),
    corpusId: text("corpus_id").notNull().references(() => securityAttackCorpora.id),
    projectId: text("project_id").notNull(),
    sampleId: text("sample_id").notNull(),
    status: text("status").notNull(),
    runtimeRunId: text("runtime_run_id").notNull(),
    frameworkHints: text("framework_hints", { mode: "json" }).$type<string[]>().notNull(),
    evidence: text("evidence", { mode: "json" }).$type<string[]>().notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [index("security_assertion_runs_project_idx").on(table.projectId), index("security_assertion_runs_status_idx").on(table.status)],
);

export const dataFlowTraces = sqliteTable(
  "data_flow_traces",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => analysisRuns.id),
    sourceFunctionId: text("source_function_id").references(() => projectFunctions.id),
    targetFunctionId: text("target_function_id").references(() => projectFunctions.id),
    path: text("path", { mode: "json" }).$type<string[]>().notNull(),
    inputShape: text("input_shape").notNull(),
    outputShape: text("output_shape").notNull(),
    outcome: text("outcome", { enum: sampleOutcome }).notNull(),
    confidence: real("confidence").notNull(),
    evidence: text("evidence").notNull(),
  },
  (table) => [
    index("data_flow_traces_run_idx").on(table.runId),
    index("data_flow_traces_source_idx").on(table.sourceFunctionId),
    index("data_flow_traces_target_idx").on(table.targetFunctionId),
    index("data_flow_traces_outcome_idx").on(table.outcome),
  ],
);

export const debugBreakpoints = sqliteTable(
  "debug_breakpoints",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => analysisRuns.id),
    functionId: text("function_id").references(() => projectFunctions.id),
    fileName: text("file_name").notNull(),
    line: integer("line", { mode: "number" }).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    condition: text("condition"),
    hitCount: integer("hit_count", { mode: "number" }).notNull(),
    evidence: text("evidence").notNull(),
  },
  (table) => [
    index("debug_breakpoints_run_idx").on(table.runId),
    index("debug_breakpoints_function_idx").on(table.functionId),
    index("debug_breakpoints_file_idx").on(table.fileName),
  ],
);

export const knowledgeFeatureVectors = sqliteTable(
  "knowledge_feature_vectors",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id").references(() => knowledgeRules.id),
    name: text("name").notNull(),
    featureKind: text("feature_kind", { enum: featureKind }).notNull(),
    vectorSchema: text("vector_schema", { mode: "json" }).$type<Record<string, number | string>>().notNull(),
    weights: text("weights", { mode: "json" }).$type<Record<string, number>>().notNull(),
    threshold: real("threshold").notNull(),
    targetTables: text("target_tables", { mode: "json" }).$type<string[]>().notNull(),
    sourceVersionId: text("source_version_id")
      .notNull()
      .references(() => sourceVersions.id),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
  },
  (table) => [
    index("knowledge_feature_vectors_rule_idx").on(table.ruleId),
    index("knowledge_feature_vectors_kind_idx").on(table.featureKind),
  ],
);

export const deepwebFeatureSpaces = sqliteTable(
  "deepweb_feature_spaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    dimensionKey: text("dimension_key").notNull(),
    weight: real("weight").notNull(),
    signalSources: text("signal_sources", { mode: "json" }).$type<string[]>().notNull(),
    normalization: text("normalization").notNull(),
    targetTables: text("target_tables", { mode: "json" }).$type<string[]>().notNull(),
    purpose: text("purpose").notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_feature_spaces_dimension_idx").on(table.dimensionKey),
    index("deepweb_feature_spaces_weight_idx").on(table.weight),
  ],
);

export const deepwebModelLayers = sqliteTable(
  "deepweb_model_layers",
  {
    id: text("id").primaryKey(),
    layerOrder: integer("layer_order", { mode: "number" }).notNull(),
    name: text("name").notNull(),
    layerKind: text("layer_kind", { enum: deepwebLayerKind }).notNull(),
    activation: text("activation", { enum: deepwebActivation }).notNull(),
    inputDimensions: text("input_dimensions", { mode: "json" }).$type<string[]>().notNull(),
    outputDimensions: text("output_dimensions", { mode: "json" }).$type<string[]>().notNull(),
    weights: text("weights", { mode: "json" }).$type<Record<string, number>>().notNull(),
    bias: real("bias").notNull(),
    runtimeModes: text("runtime_modes", { mode: "json" }).$type<string[]>().notNull(),
    purpose: text("purpose").notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_model_layers_order_idx").on(table.layerOrder),
    index("deepweb_model_layers_kind_idx").on(table.layerKind),
  ],
);

export const deepwebLanguageAdapters = sqliteTable(
  "deepweb_language_adapters",
  {
    id: text("id").primaryKey(),
    language: text("language").notNull(),
    parserStack: text("parser_stack", { mode: "json" }).$type<string[]>().notNull(),
    runtimeModes: text("runtime_modes", { mode: "json" }).$type<string[]>().notNull(),
    featureDimensions: text("feature_dimensions", { mode: "json" }).$type<string[]>().notNull(),
    sourcePatterns: text("source_patterns", { mode: "json" }).$type<string[]>().notNull(),
    sinkPatterns: text("sink_patterns", { mode: "json" }).$type<string[]>().notNull(),
    confidence: real("confidence").notNull(),
    fallbackStrategy: text("fallback_strategy").notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_language_adapters_language_idx").on(table.language),
    index("deepweb_language_adapters_confidence_idx").on(table.confidence),
  ],
);

export const deepwebProjections = sqliteTable(
  "deepweb_projections",
  {
    id: text("id").primaryKey(),
    sourceTable: text("source_table").notNull(),
    targetTable: text("target_table").notNull(),
    projectionKind: text("projection_kind", { enum: deepwebProjectionKind }).notNull(),
    sourceColumns: text("source_columns", { mode: "json" }).$type<string[]>().notNull(),
    featureDimensions: text("feature_dimensions", { mode: "json" }).$type<string[]>().notNull(),
    mappingFormula: text("mapping_formula").notNull(),
    weight: real("weight").notNull(),
    evidencePolicy: text("evidence_policy").notNull(),
    lossFunction: text("loss_function").notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_projections_source_idx").on(table.sourceTable),
    index("deepweb_projections_target_idx").on(table.targetTable),
    index("deepweb_projections_kind_idx").on(table.projectionKind),
  ],
);

export const deepwebFeatureVectors = sqliteTable(
  "deepweb_feature_vectors",
  {
    id: text("id").primaryKey(),
    projectionId: text("projection_id").references(() => deepwebProjections.id),
    sourceTable: text("source_table").notNull(),
    sourceId: text("source_id").notNull(),
    dimensions: text("dimensions", { mode: "json" }).$type<string[]>().notNull(),
    vector: text("vector", { mode: "json" }).$type<Record<string, number>>().notNull(),
    magnitude: real("magnitude").notNull(),
    confidence: real("confidence").notNull(),
    evidence: text("evidence").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_feature_vectors_projection_idx").on(table.projectionId),
    index("deepweb_feature_vectors_source_idx").on(table.sourceTable, table.sourceId),
    index("deepweb_feature_vectors_confidence_idx").on(table.confidence),
  ],
);

export const deepwebTrainingSamples = sqliteTable(
  "deepweb_training_samples",
  {
    id: text("id").primaryKey(),
    sampleKind: text("sample_kind").notNull(),
    language: text("language").notNull(),
    inputSignature: text("input_signature").notNull(),
    expectedClass: text("expected_class").notNull(),
    featureVector: text("feature_vector", { mode: "json" }).$type<Record<string, number>>().notNull(),
    labelConfidence: real("label_confidence").notNull(),
    sourceTable: text("source_table").notNull(),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_training_samples_kind_idx").on(table.sampleKind),
    index("deepweb_training_samples_language_idx").on(table.language),
    index("deepweb_training_samples_class_idx").on(table.expectedClass),
  ],
);

export const deepwebValidationScenarios = sqliteTable(
  "deepweb_validation_scenarios",
  {
    id: text("id").primaryKey(),
    dimensionKey: text("dimension_key").notNull(),
    validationKind: text("validation_kind", { enum: deepwebValidationKind }).notNull(),
    sourceTable: text("source_table").notNull(),
    requiredEvidence: text("required_evidence", { mode: "json" }).$type<string[]>().notNull(),
    passCriteria: text("pass_criteria").notNull(),
    maturityWeight: real("maturity_weight").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_validation_scenarios_dimension_idx").on(table.dimensionKey),
    index("deepweb_validation_scenarios_kind_idx").on(table.validationKind),
    index("deepweb_validation_scenarios_source_idx").on(table.sourceTable),
  ],
);

export const deepwebValidationEvidence = sqliteTable(
  "deepweb_validation_evidence",
  {
    id: text("id").primaryKey(),
    scenarioId: text("scenario_id").notNull(),
    dimensionKey: text("dimension_key").notNull(),
    evidenceKind: text("evidence_kind", { enum: deepwebValidationEvidenceKind }).notNull(),
    sourceTable: text("source_table").notNull(),
    sourceId: text("source_id").notNull(),
    sourceName: text("source_name").notNull(),
    dimensions: text("dimensions", { mode: "json" }).$type<Record<string, number>>().notNull(),
    confidence: real("confidence").notNull(),
    passed: integer("passed", { mode: "boolean" }).notNull(),
    replay: integer("replay", { mode: "boolean" }).notNull(),
    evidence: text("evidence").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_validation_evidence_scenario_idx").on(table.scenarioId),
    index("deepweb_validation_evidence_dimension_idx").on(table.dimensionKey),
    index("deepweb_validation_evidence_kind_idx").on(table.evidenceKind),
    index("deepweb_validation_evidence_source_idx").on(table.sourceTable, table.sourceId),
  ],
);

export const deepwebExtremeTestRuns = sqliteTable(
  "deepweb_extreme_test_runs",
  {
    id: text("id").primaryKey(),
    category: text("category", { enum: deepwebExtremeTestCategory }).notNull(),
    target: text("target", { enum: deepwebExtremeTarget }).notNull(),
    loadFactor: real("load_factor").notNull(),
    passThreshold: real("pass_threshold").notNull(),
    score: real("score").notNull(),
    status: text("status", { enum: deepwebExtremeStatus }).notNull(),
    evidence: text("evidence").notNull(),
    recommendation: text("recommendation").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_extreme_test_runs_category_idx").on(table.category),
    index("deepweb_extreme_test_runs_target_idx").on(table.target),
    index("deepweb_extreme_test_runs_status_idx").on(table.status),
  ],
);

export const databaseOptimizationProfiles = sqliteTable(
  "database_optimization_profiles",
  {
    id: text("id").primaryKey(),
    targetTable: text("target_table").notNull(),
    optimizationKind: text("optimization_kind", { enum: databaseOptimizationKind }).notNull(),
    beforeCost: real("before_cost").notNull(),
    afterCost: real("after_cost").notNull(),
    score: real("score").notNull(),
    evidence: text("evidence").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("database_optimization_profiles_table_idx").on(table.targetTable),
    index("database_optimization_profiles_kind_idx").on(table.optimizationKind),
    index("database_optimization_profiles_score_idx").on(table.score),
  ],
);

export const deepwebIrrigationRuns = sqliteTable(
  "deepweb_irrigation_runs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").references(() => analysisRuns.id),
    cycleIndex: integer("cycle_index", { mode: "number" }).notNull(),
    status: text("status", { enum: deepwebIrrigationRunStatus }).notNull(),
    evidenceInflowCount: integer("evidence_inflow_count", { mode: "number" }).notNull(),
    acceptedEvidenceCount: integer("accepted_evidence_count", { mode: "number" }).notNull(),
    isolatedEvidenceCount: integer("isolated_evidence_count", { mode: "number" }).notNull(),
    dataQualityScore: real("data_quality_score").notNull(),
    teacherAlignmentScore: real("teacher_alignment_score").notNull(),
    replayScore: real("replay_score").notNull(),
    stabilityScore: real("stability_score").notNull(),
    supervisionGain: real("supervision_gain").notNull(),
    stableSnapshot: text("stable_snapshot").notNull(),
    evidence: text("evidence", { mode: "json" }).$type<string[]>().notNull(),
    next: text("next").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_irrigation_runs_run_idx").on(table.runId),
    index("deepweb_irrigation_runs_status_idx").on(table.status),
    index("deepweb_irrigation_runs_quality_idx").on(table.dataQualityScore),
  ],
);

export const deepwebIrrigationEvidence = sqliteTable(
  "deepweb_irrigation_evidence",
  {
    id: text("id").primaryKey(),
    irrigationRunId: text("irrigation_run_id").references(() => deepwebIrrigationRuns.id),
    sourceKind: text("source_kind", { enum: deepwebIrrigationSourceKind }).notNull(),
    sourceTable: text("source_table").notNull(),
    sourceId: text("source_id").notNull(),
    sourceName: text("source_name").notNull(),
    targetDimensions: text("target_dimensions", { mode: "json" }).$type<string[]>().notNull(),
    qualityScore: real("quality_score").notNull(),
    accepted: integer("accepted", { mode: "boolean" }).notNull(),
    isolated: integer("isolated", { mode: "boolean" }).notNull(),
    batchStatus: text("batch_status", { enum: deepwebIrrigationBatchStatus }).notNull(),
    evidence: text("evidence").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_irrigation_evidence_run_idx").on(table.irrigationRunId),
    index("deepweb_irrigation_evidence_source_idx").on(table.sourceKind, table.sourceTable),
    index("deepweb_irrigation_evidence_quality_idx").on(table.qualityScore),
  ],
);

export const deepwebIrrigationEpochs = sqliteTable(
  "deepweb_irrigation_epochs",
  {
    id: text("id").primaryKey(),
    irrigationRunId: text("irrigation_run_id").references(() => deepwebIrrigationRuns.id),
    stage: text("stage", { enum: deepwebIrrigationEpochStage }).notNull(),
    status: text("status", { enum: deepwebIrrigationEpochStatus }).notNull(),
    score: real("score").notNull(),
    evidenceCount: integer("evidence_count", { mode: "number" }).notNull(),
    evidence: text("evidence").notNull(),
    action: text("action").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_irrigation_epochs_run_idx").on(table.irrigationRunId),
    index("deepweb_irrigation_epochs_stage_idx").on(table.stage),
    index("deepweb_irrigation_epochs_status_idx").on(table.status),
  ],
);

export const deepwebWeightUpdateEvents = sqliteTable(
  "deepweb_weight_update_events",
  {
    id: text("id").primaryKey(),
    irrigationRunId: text("irrigation_run_id").references(() => deepwebIrrigationRuns.id),
    dimensionKey: text("dimension_key").notNull(),
    beforeWeight: real("before_weight").notNull(),
    candidateWeight: real("candidate_weight").notNull(),
    acceptedWeight: real("accepted_weight").notNull(),
    delta: real("delta").notNull(),
    gate: text("gate", { enum: deepwebWeightUpdateGate }).notNull(),
    evidence: text("evidence").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_weight_update_events_run_idx").on(table.irrigationRunId),
    index("deepweb_weight_update_events_dimension_idx").on(table.dimensionKey),
    index("deepweb_weight_update_events_gate_idx").on(table.gate),
  ],
);

export const deepwebReplayMemorySnapshots = sqliteTable(
  "deepweb_replay_memory_snapshots",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").references(() => analysisRuns.id),
    irrigationRunId: text("irrigation_run_id").references(() => deepwebIrrigationRuns.id),
    projectName: text("project_name").notNull(),
    projectHash: text("project_hash").notNull(),
    fileCount: integer("file_count", { mode: "number" }).notNull(),
    functionCount: integer("function_count", { mode: "number" }).notNull(),
    issueCount: integer("issue_count", { mode: "number" }).notNull(),
    deepwebCoverage: real("deepweb_coverage").notNull(),
    irrigationScore: real("irrigation_score").notNull(),
    optimizationScore: real("optimization_score").notNull(),
    acceptedEvidenceCount: integer("accepted_evidence_count", { mode: "number" }).notNull(),
    isolatedEvidenceCount: integer("isolated_evidence_count", { mode: "number" }).notNull(),
    vectorCount: integer("vector_count", { mode: "number" }).notNull(),
    inferenceRunCount: integer("inference_run_count", { mode: "number" }).notNull(),
    teacherTrustScore: real("teacher_trust_score").notNull(),
    teacherConsensusRate: real("teacher_consensus_rate").notNull(),
    maturityScore: real("maturity_score").notNull(),
    stableSnapshot: text("stable_snapshot").notNull(),
    status: text("status", { enum: deepwebReplaySnapshotStatus }).notNull(),
    dimensionScores: text("dimension_scores", { mode: "json" }).$type<Record<string, number>>().notNull(),
    labelBreakdown: text("label_breakdown", { mode: "json" }).$type<Record<string, number>>().notNull(),
    evidence: text("evidence", { mode: "json" }).$type<string[]>().notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_replay_memory_snapshots_project_idx").on(table.projectHash),
    index("deepweb_replay_memory_snapshots_status_idx").on(table.status),
    index("deepweb_replay_memory_snapshots_created_idx").on(table.createdAt),
  ],
);

export const deepwebReplayComparisons = sqliteTable(
  "deepweb_replay_comparisons",
  {
    id: text("id").primaryKey(),
    currentSnapshotId: text("current_snapshot_id").notNull().references(() => deepwebReplayMemorySnapshots.id),
    baselineSnapshotId: text("baseline_snapshot_id").references(() => deepwebReplayMemorySnapshots.id),
    status: text("status", { enum: deepwebReplayComparisonStatus }).notNull(),
    driftScore: real("drift_score").notNull(),
    regressionScore: real("regression_score").notNull(),
    improvementScore: real("improvement_score").notNull(),
    changedDimensions: text("changed_dimensions", { mode: "json" }).$type<string[]>().notNull(),
    evidence: text("evidence").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_replay_comparisons_current_idx").on(table.currentSnapshotId),
    index("deepweb_replay_comparisons_baseline_idx").on(table.baselineSnapshotId),
    index("deepweb_replay_comparisons_status_idx").on(table.status),
  ],
);

export const deepwebReplayPromotionDecisions = sqliteTable(
  "deepweb_replay_promotion_decisions",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id").notNull().references(() => deepwebReplayMemorySnapshots.id),
    targetKind: text("target_kind", { enum: deepwebReplayPromotionTarget }).notNull(),
    targetId: text("target_id").notNull(),
    gate: text("gate", { enum: deepwebReplayPromotionGate }).notNull(),
    score: real("score").notNull(),
    evidence: text("evidence").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_replay_promotion_decisions_snapshot_idx").on(table.snapshotId),
    index("deepweb_replay_promotion_decisions_target_idx").on(table.targetKind, table.targetId),
    index("deepweb_replay_promotion_decisions_gate_idx").on(table.gate),
  ],
);

export const deepwebLocalSqliteJournal = sqliteTable(
  "deepweb_local_sqlite_journal",
  {
    id: text("id").primaryKey(),
    targetTable: text("target_table").notNull(),
    targetPrimaryKey: text("target_primary_key").notNull(),
    projectHash: text("project_hash").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    sqlText: text("sql_text").notNull(),
    syncStatus: text("sync_status", { enum: deepwebLocalSqliteSyncStatus }).notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_local_sqlite_journal_table_idx").on(table.targetTable),
    index("deepweb_local_sqlite_journal_target_idx").on(table.targetTable, table.targetPrimaryKey),
    index("deepweb_local_sqlite_journal_status_idx").on(table.syncStatus),
  ],
);

export const deepwebLocalStorageEngines = sqliteTable(
  "deepweb_local_storage_engines",
  {
    id: text("id").primaryKey(),
    engineKind: text("engine_kind", { enum: deepwebLocalStorageEngineKind }).notNull(),
    storageMode: text("storage_mode").notNull(),
    status: text("status", { enum: deepwebLocalStorageStatus }).notNull(),
    rowCount: integer("row_count", { mode: "number" }).notNull(),
    lastSyncedAt: integer("last_synced_at", { mode: "number" }).notNull(),
    evidence: text("evidence").notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_local_storage_engines_kind_idx").on(table.engineKind),
    index("deepweb_local_storage_engines_status_idx").on(table.status),
  ],
);

export const deepwebLocalSnapshotExports = sqliteTable(
  "deepweb_local_snapshot_exports",
  {
    id: text("id").primaryKey(),
    engineId: text("engine_id").notNull(),
    exportKind: text("export_kind").notNull(),
    rowCount: integer("row_count", { mode: "number" }).notNull(),
    tableCount: integer("table_count", { mode: "number" }).notNull(),
    payloadBytes: integer("payload_bytes", { mode: "number" }).notNull(),
    status: text("status", { enum: deepwebLocalSnapshotExportStatus }).notNull(),
    evidence: text("evidence").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_local_snapshot_exports_engine_idx").on(table.engineId),
    index("deepweb_local_snapshot_exports_status_idx").on(table.status),
    index("deepweb_local_snapshot_exports_created_idx").on(table.createdAt),
  ],
);

export const deepwebSupervisionLabels = sqliteTable(
  "deepweb_supervision_labels",
  {
    id: text("id").primaryKey(),
    sourceKind: text("source_kind", { enum: deepwebSupervisionSource }).notNull(),
    sourceId: text("source_id").notNull(),
    targetVectorId: text("target_vector_id"),
    targetPattern: text("target_pattern").notNull(),
    label: text("label", { enum: deepwebVectorLabel }).notNull(),
    confidence: real("confidence").notNull(),
    trustScore: real("trust_score").notNull(),
    evidence: text("evidence").notNull(),
    correctiveAction: text("corrective_action").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_supervision_labels_source_idx").on(table.sourceKind, table.sourceId),
    index("deepweb_supervision_labels_target_idx").on(table.targetVectorId),
    index("deepweb_supervision_labels_label_idx").on(table.label),
    index("deepweb_supervision_labels_trust_idx").on(table.trustScore),
  ],
);

export const deepwebTeacherReliability = sqliteTable(
  "deepweb_teacher_reliability",
  {
    id: text("id").primaryKey(),
    sourceKind: text("source_kind", { enum: deepwebSupervisionSource }).notNull(),
    labelCount: integer("label_count", { mode: "number" }).notNull(),
    acceptedCount: integer("accepted_count", { mode: "number" }).notNull(),
    quarantinedCount: integer("quarantined_count", { mode: "number" }).notNull(),
    conflictCount: integer("conflict_count", { mode: "number" }).notNull(),
    reliabilityScore: real("reliability_score").notNull(),
    status: text("status", { enum: deepwebReliabilityStatus }).notNull(),
    evidence: text("evidence").notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_teacher_reliability_source_idx").on(table.sourceKind),
    index("deepweb_teacher_reliability_status_idx").on(table.status),
    index("deepweb_teacher_reliability_score_idx").on(table.reliabilityScore),
  ],
);

export const deepwebQuarantinedLabels = sqliteTable(
  "deepweb_quarantined_labels",
  {
    id: text("id").primaryKey(),
    vectorId: text("vector_id").notNull(),
    vectorName: text("vector_name").notNull(),
    sourceKind: text("source_kind", { enum: deepwebSupervisionSource }).notNull(),
    candidateLabels: text("candidate_labels", { mode: "json" }).$type<string[]>().notNull(),
    reason: text("reason", { enum: deepwebQuarantineReason }).notNull(),
    confidence: real("confidence").notNull(),
    evidence: text("evidence").notNull(),
    recommendedAction: text("recommended_action").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_quarantined_labels_vector_idx").on(table.vectorId),
    index("deepweb_quarantined_labels_source_idx").on(table.sourceKind),
    index("deepweb_quarantined_labels_reason_idx").on(table.reason),
  ],
);

export const deepwebErrorSignals = sqliteTable(
  "deepweb_error_signals",
  {
    id: text("id").primaryKey(),
    signalKind: text("signal_kind", { enum: deepwebErrorSignalKind }).notNull(),
    severity: text("severity").notNull(),
    sourceId: text("source_id").notNull(),
    sourceName: text("source_name").notNull(),
    affectedLabel: text("affected_label", { enum: deepwebVectorLabel }),
    confidence: real("confidence").notNull(),
    confidenceImpact: real("confidence_impact").notNull(),
    knowledgeScoreImpact: real("knowledge_score_impact").notNull(),
    fitnessImpact: real("fitness_impact").notNull(),
    evidence: text("evidence").notNull(),
    containmentAction: text("containment_action").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_error_signals_kind_idx").on(table.signalKind),
    index("deepweb_error_signals_source_idx").on(table.sourceId),
    index("deepweb_error_signals_confidence_idx").on(table.confidence),
  ],
);

export const deepwebLabelCentroids = sqliteTable(
  "deepweb_label_centroids",
  {
    id: text("id").primaryKey(),
    label: text("label", { enum: deepwebVectorLabel }).notNull(),
    sampleCount: integer("sample_count", { mode: "number" }).notNull(),
    vector: text("vector", { mode: "json" }).$type<Record<string, number>>().notNull(),
    dominantDimensions: text("dominant_dimensions", { mode: "json" }).$type<string[]>().notNull(),
    confidence: real("confidence").notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_label_centroids_label_idx").on(table.label),
    index("deepweb_label_centroids_confidence_idx").on(table.confidence),
  ],
);

export const deepwebContrastivePairs = sqliteTable(
  "deepweb_contrastive_pairs",
  {
    id: text("id").primaryKey(),
    anchorVectorId: text("anchor_vector_id").notNull(),
    positiveVectorId: text("positive_vector_id").notNull(),
    negativeVectorId: text("negative_vector_id").notNull(),
    label: text("label", { enum: deepwebVectorLabel }).notNull(),
    margin: real("margin").notNull(),
    confidence: real("confidence").notNull(),
    evidence: text("evidence").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_contrastive_pairs_label_idx").on(table.label),
    index("deepweb_contrastive_pairs_anchor_idx").on(table.anchorVectorId),
  ],
);

export const deepwebSelfSupervisedEpochs = sqliteTable(
  "deepweb_self_supervised_epochs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").references(() => analysisRuns.id),
    epochIndex: integer("epoch_index", { mode: "number" }).notNull(),
    vectorCount: integer("vector_count", { mode: "number" }).notNull(),
    pseudoLabelCount: integer("pseudo_label_count", { mode: "number" }).notNull(),
    contrastivePairCount: integer("contrastive_pair_count", { mode: "number" }).notNull(),
    lossBefore: real("loss_before").notNull(),
    lossAfter: real("loss_after").notNull(),
    learningRate: real("learning_rate").notNull(),
    updatedWeights: text("updated_weights", { mode: "json" }).$type<Record<string, number>>().notNull(),
    status: text("status").notNull(),
    evidence: text("evidence").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_self_supervised_epochs_run_idx").on(table.runId),
    index("deepweb_self_supervised_epochs_status_idx").on(table.status),
  ],
);

export const deepwebSupervisedEpochs = sqliteTable(
  "deepweb_supervised_epochs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").references(() => analysisRuns.id),
    teacherSampleCount: integer("teacher_sample_count", { mode: "number" }).notNull(),
    matchedTeacherCount: integer("matched_teacher_count", { mode: "number" }).notNull(),
    correctedPredictionCount: integer("corrected_prediction_count", { mode: "number" }).notNull(),
    falsePositiveGuardCount: integer("false_positive_guard_count", { mode: "number" }).notNull(),
    lossBefore: real("loss_before").notNull(),
    lossAfter: real("loss_after").notNull(),
    improvement: real("improvement").notNull(),
    trustScore: real("trust_score").notNull(),
    calibrationWeights: text("calibration_weights", { mode: "json" }).$type<Record<string, number>>().notNull(),
    status: text("status").notNull(),
    evidence: text("evidence").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_supervised_epochs_run_idx").on(table.runId),
    index("deepweb_supervised_epochs_status_idx").on(table.status),
    index("deepweb_supervised_epochs_trust_idx").on(table.trustScore),
  ],
);

export const deepwebRollbackSnapshots = sqliteTable(
  "deepweb_rollback_snapshots",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").references(() => analysisRuns.id),
    protectedTables: text("protected_tables", { mode: "json" }).$type<string[]>().notNull(),
    trigger: text("trigger").notNull(),
    rollbackPolicy: text("rollback_policy").notNull(),
    evidence: text("evidence").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_rollback_snapshots_run_idx").on(table.runId),
    index("deepweb_rollback_snapshots_trigger_idx").on(table.trigger),
  ],
);

export const deepwebGenePool = sqliteTable(
  "deepweb_gene_pool",
  {
    id: text("id").primaryKey(),
    geneKind: text("gene_kind", { enum: deepwebGeneKind }).notNull(),
    name: text("name").notNull(),
    expression: real("expression").notNull(),
    inheritedFrom: text("inherited_from").notNull(),
    mutationDelta: real("mutation_delta").notNull(),
    evidence: text("evidence").notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_gene_pool_kind_idx").on(table.geneKind),
    index("deepweb_gene_pool_expression_idx").on(table.expression),
  ],
);

export const deepwebGenomeGenerations = sqliteTable(
  "deepweb_genome_generations",
  {
    id: text("id").primaryKey(),
    generation: integer("generation", { mode: "number" }).notNull(),
    parentId: text("parent_id"),
    strategy: text("strategy", { enum: deepwebGenomeStrategy }).notNull(),
    fitnessScore: real("fitness_score").notNull(),
    accepted: integer("accepted", { mode: "boolean" }).notNull(),
    genes: text("genes", { mode: "json" }).$type<Record<string, number>>().notNull(),
    evidence: text("evidence").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_genome_generations_generation_idx").on(table.generation),
    index("deepweb_genome_generations_strategy_idx").on(table.strategy),
    index("deepweb_genome_generations_fitness_idx").on(table.fitnessScore),
  ],
);

export const deepwebGeneExpression = sqliteTable(
  "deepweb_gene_expression",
  {
    id: text("id").primaryKey(),
    genomeId: text("genome_id").notNull(),
    geneId: text("gene_id").notNull(),
    projectSignal: text("project_signal").notNull(),
    expressionLevel: real("expression_level").notNull(),
    evidence: text("evidence").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_gene_expression_genome_idx").on(table.genomeId),
    index("deepweb_gene_expression_gene_idx").on(table.geneId),
    index("deepweb_gene_expression_level_idx").on(table.expressionLevel),
  ],
);

export const deepwebFitnessScores = sqliteTable(
  "deepweb_fitness_scores",
  {
    id: text("id").primaryKey(),
    genomeId: text("genome_id").notNull(),
    accuracyProxy: real("accuracy_proxy").notNull(),
    stabilityProxy: real("stability_proxy").notNull(),
    safetyProxy: real("safety_proxy").notNull(),
    generalizationProxy: real("generalization_proxy").notNull(),
    regressionPenalty: real("regression_penalty").notNull(),
    fitnessScore: real("fitness_score").notNull(),
    evidence: text("evidence").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_fitness_scores_genome_idx").on(table.genomeId),
    index("deepweb_fitness_scores_score_idx").on(table.fitnessScore),
  ],
);

export const deepwebInferenceRuns = sqliteTable(
  "deepweb_inference_runs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => analysisRuns.id),
    functionId: text("function_id").references(() => projectFunctions.id),
    modelLayerId: text("model_layer_id").references(() => deepwebModelLayers.id),
    vectorHash: text("vector_hash").notNull(),
    dimensions: text("dimensions", { mode: "json" }).$type<Record<string, number>>().notNull(),
    outputScores: text("output_scores", { mode: "json" }).$type<Record<string, number>>().notNull(),
    predictedClass: text("predicted_class").notNull(),
    confidence: real("confidence").notNull(),
    evidence: text("evidence").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_inference_runs_run_idx").on(table.runId),
    index("deepweb_inference_runs_function_idx").on(table.functionId),
    index("deepweb_inference_runs_class_idx").on(table.predictedClass),
  ],
);

export const deepwebModelVersions = sqliteTable(
  "deepweb_model_versions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    parentVersionId: text("parent_version_id"),
    featureSchemaVersion: text("feature_schema_version").notNull(),
    modelMode: text("model_mode").notNull(),
    status: text("status", { enum: ["stable", "candidate", "quarantined", "rollback"] }).notNull(),
    weights: text("weights", { mode: "json" }).$type<Record<string, number>>().notNull(),
    networkParameters: text("network_parameters", { mode: "json" }).$type<Record<string, unknown>>(),
    selectedGenomeId: text("selected_genome_id").notNull(),
    trainingSampleCount: integer("training_sample_count", { mode: "number" }).notNull(),
    validationEvidenceCount: integer("validation_evidence_count", { mode: "number" }).notNull(),
    trustScore: real("trust_score").notNull(),
    consensusRate: real("consensus_rate").notNull(),
    fitnessScore: real("fitness_score").notNull(),
    regressionRiskScore: real("regression_risk_score").notNull(),
    checksum: text("checksum").notNull(),
    evidence: text("evidence", { mode: "json" }).$type<string[]>().notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_model_versions_run_idx").on(table.runId, table.createdAt),
    index("deepweb_model_versions_status_idx").on(table.status, table.fitnessScore),
  ],
);

export const deepwebTrainableHeadRuns = sqliteTable(
  "deepweb_trainable_head_runs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    modelVersionId: text("model_version_id").notNull(),
    status: text("status", { enum: ["warming", "trained_candidate", "validated_candidate"] }).notNull(),
    architecture: text("architecture").notNull(),
    trainingSampleCount: integer("training_sample_count", { mode: "number" }).notNull(),
    validationSampleCount: integer("validation_sample_count", { mode: "number" }).notNull(),
    classCount: integer("class_count", { mode: "number" }).notNull(),
    epochCount: integer("epoch_count", { mode: "number" }).notNull(),
    learningRate: real("learning_rate").notNull(),
    trainLossBefore: real("train_loss_before").notNull(),
    trainLossAfter: real("train_loss_after").notNull(),
    validationLossBefore: real("validation_loss_before").notNull(),
    validationLossAfter: real("validation_loss_after").notNull(),
    improvement: real("improvement").notNull(),
    inherited: integer("inherited", { mode: "boolean" }).notNull(),
    parameters: text("parameters", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    evidence: text("evidence", { mode: "json" }).$type<string[]>().notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [index("deepweb_trainable_head_runs_run_idx").on(table.runId, table.status, table.createdAt)],
);

export const deepwebSupervisedAssignments = sqliteTable(
  "deepweb_supervised_assignments",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    vectorId: text("vector_id").notNull(),
    vectorName: text("vector_name").notNull(),
    predictedLabel: text("predicted_label", { enum: deepwebVectorLabel }).notNull(),
    teacherLabel: text("teacher_label", { enum: deepwebVectorLabel }).notNull(),
    trustScore: real("trust_score").notNull(),
    consensusScore: real("consensus_score").notNull(),
    corrected: integer("corrected", { mode: "boolean" }).notNull(),
    evidence: text("evidence").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("deepweb_supervised_assignments_run_idx").on(table.runId, table.corrected),
    index("deepweb_supervised_assignments_vector_idx").on(table.vectorId),
  ],
);

export const versionConstraints = sqliteTable(
  "version_constraints",
  {
    id: text("id").primaryKey(),
    ecosystem: text("ecosystem").notNull(),
    packageName: text("package_name").notNull(),
    apiName: text("api_name").notNull(),
    versionRange: text("version_range").notNull(),
    behavior: text("behavior").notNull(),
    riskDelta: text("risk_delta").notNull(),
    mitigation: text("mitigation").notNull(),
    sourceVersionId: text("source_version_id")
      .notNull()
      .references(() => sourceVersions.id),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
  },
  (table) => [
    index("version_constraints_ecosystem_idx").on(table.ecosystem),
    index("version_constraints_package_idx").on(table.packageName),
    index("version_constraints_api_idx").on(table.apiName),
  ],
);

export const sdkApiProfiles = sqliteTable(
  "sdk_api_profiles",
  {
    id: text("id").primaryKey(),
    ecosystem: text("ecosystem").notNull(),
    sdkName: text("sdk_name").notNull(),
    module: text("module").notNull(),
    apiName: text("api_name").notNull(),
    versionRange: text("version_range").notNull(),
    inputContract: text("input_contract", { mode: "json" }).$type<string[]>().notNull(),
    outputContract: text("output_contract", { mode: "json" }).$type<string[]>().notNull(),
    sideEffects: text("side_effects", { mode: "json" }).$type<string[]>().notNull(),
    failureModes: text("failure_modes", { mode: "json" }).$type<string[]>().notNull(),
    safeAlternative: text("safe_alternative").notNull(),
    sourceVersionId: text("source_version_id")
      .notNull()
      .references(() => sourceVersions.id),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
  },
  (table) => [
    index("sdk_api_profiles_sdk_idx").on(table.sdkName),
    index("sdk_api_profiles_api_idx").on(table.apiName),
    index("sdk_api_profiles_ecosystem_idx").on(table.ecosystem),
  ],
);

export const faultSamples = sqliteTable(
  "fault_samples",
  {
    id: text("id").primaryKey(),
    category: text("category", { enum: knowledgeCategory }).notNull(),
    failureMode: text("failure_mode").notNull(),
    trigger: text("trigger").notNull(),
    minimalPattern: text("minimal_pattern").notNull(),
    observedImpact: text("observed_impact").notNull(),
    reproductionSteps: text("reproduction_steps", { mode: "json" }).$type<string[]>().notNull(),
    expectedDetectionRules: text("expected_detection_rules", { mode: "json" }).$type<string[]>().notNull(),
    severity: text("severity", { enum: knowledgeSeverity }).notNull(),
    confidence: real("confidence").notNull(),
    sourceVersionId: text("source_version_id")
      .notNull()
      .references(() => sourceVersions.id),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
  },
  (table) => [
    index("fault_samples_category_idx").on(table.category),
    index("fault_samples_failure_idx").on(table.failureMode),
    index("fault_samples_severity_idx").on(table.severity),
  ],
);

export const benchmarkProfiles = sqliteTable(
  "benchmark_profiles",
  {
    id: text("id").primaryKey(),
    algorithmFamily: text("algorithm_family").notNull(),
    scenario: text("scenario").notNull(),
    inputScale: text("input_scale").notNull(),
    timeComplexity: text("time_complexity").notNull(),
    memoryComplexity: text("memory_complexity").notNull(),
    ioPattern: text("io_pattern").notNull(),
    baselineMs: real("baseline_ms").notNull(),
    optimizedMs: real("optimized_ms").notNull(),
    stabilityTradeoff: real("stability_tradeoff").notNull(),
    recommendation: text("recommendation").notNull(),
    sourceVersionId: text("source_version_id")
      .notNull()
      .references(() => sourceVersions.id),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
  },
  (table) => [
    index("benchmark_profiles_family_idx").on(table.algorithmFamily),
    index("benchmark_profiles_scale_idx").on(table.inputScale),
  ],
);

export const repairRecipes = sqliteTable(
  "repair_recipes",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id").references(() => knowledgeRules.id),
    recipeKind: text("recipe_kind", { enum: repairKind }).notNull(),
    title: text("title").notNull(),
    targetLanguage: text("target_language").notNull(),
    beforePattern: text("before_pattern").notNull(),
    afterPattern: text("after_pattern").notNull(),
    safetyChecks: text("safety_checks", { mode: "json" }).$type<string[]>().notNull(),
    expectedGain: real("expected_gain").notNull(),
    stabilityImpact: real("stability_impact").notNull(),
    sourceVersionId: text("source_version_id")
      .notNull()
      .references(() => sourceVersions.id),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
  },
  (table) => [
    index("repair_recipes_rule_idx").on(table.ruleId),
    index("repair_recipes_kind_idx").on(table.recipeKind),
    index("repair_recipes_language_idx").on(table.targetLanguage),
  ],
);

export const hardwareComponentProfiles = sqliteTable(
  "hardware_component_profiles",
  {
    id: text("id").primaryKey(),
    family: text("family").notNull(),
    component: text("component").notNull(),
    interfaceName: text("interface_name").notNull(),
    nominalVoltage: real("nominal_voltage").notNull(),
    maxCurrentMa: real("max_current_ma").notNull(),
    sampleRateHz: real("sample_rate_hz").notNull(),
    tolerancePct: real("tolerance_pct").notNull(),
    failureModes: text("failure_modes", { mode: "json" }).$type<string[]>().notNull(),
    safeOperatingRules: text("safe_operating_rules", { mode: "json" }).$type<string[]>().notNull(),
    sourceVersionId: text("source_version_id")
      .notNull()
      .references(() => sourceVersions.id),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
  },
  (table) => [
    index("hardware_component_profiles_family_idx").on(table.family),
    index("hardware_component_profiles_component_idx").on(table.component),
    index("hardware_component_profiles_interface_idx").on(table.interfaceName),
  ],
);

export const environmentProfiles = sqliteTable(
  "environment_profiles",
  {
    id: text("id").primaryKey(),
    ecosystem: text("ecosystem").notNull(),
    profileKind: text("profile_kind", { enum: environmentKind }).notNull(),
    name: text("name").notNull(),
    versionRange: text("version_range").notNull(),
    requiredFiles: text("required_files", { mode: "json" }).$type<string[]>().notNull(),
    requiredCommands: text("required_commands", { mode: "json" }).$type<string[]>().notNull(),
    envVars: text("env_vars", { mode: "json" }).$type<string[]>().notNull(),
    failureModes: text("failure_modes", { mode: "json" }).$type<string[]>().notNull(),
    sourceVersionId: text("source_version_id")
      .notNull()
      .references(() => sourceVersions.id),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
  },
  (table) => [
    index("environment_profiles_ecosystem_idx").on(table.ecosystem),
    index("environment_profiles_kind_idx").on(table.profileKind),
    index("environment_profiles_name_idx").on(table.name),
  ],
);

export const knowledgeSources = sqliteTable("knowledge_sources", {
  id: text("id").primaryKey(), name: text("name").notNull(), sourceKind: text("source_kind").notNull(),
  baseUrl: text("base_url").notNull(), licenseId: text("license_id").notNull(), attribution: text("attribution").notNull(),
  commercialAllowed: integer("commercial_allowed", { mode: "boolean" }).notNull(), redistributionAllowed: integer("redistribution_allowed", { mode: "boolean" }).notNull(),
  noticeText: text("notice_text").notNull(), status: text("status").notNull(), lastCheckedAt: integer("last_checked_at").notNull(),
  lastStatus: text("last_status").notNull(), recordCount: integer("record_count").notNull(), etag: text("etag").notNull(), evidence: text("evidence").notNull(),
});

export const knowledgePackVersions = sqliteTable("knowledge_pack_versions", {
  id: text("id").primaryKey(), version: text("version").notNull(), parentPackId: text("parent_pack_id"), status: text("status").notNull(),
  manifestJson: text("manifest_json").notNull(), contentHash: text("content_hash").notNull(), signature: text("signature").notNull(),
  signatureAlgorithm: text("signature_algorithm").notNull(), keyId: text("key_id").notNull(), sourceCount: integer("source_count").notNull(),
  recordCount: integer("record_count").notNull(), quarantinedCount: integer("quarantined_count").notNull(), validationScore: real("validation_score").notNull(),
  createdAt: integer("created_at").notNull(), activatedAt: integer("activated_at"), evidence: text("evidence").notNull(),
}, (table) => [index("knowledge_pack_versions_status_idx").on(table.status, table.createdAt)]);

export const knowledgeRawArtifacts = sqliteTable("knowledge_raw_artifacts", {
  id: text("id").primaryKey(), packId: text("pack_id").notNull(), sourceId: text("source_id").notNull(), sourceUrl: text("source_url").notNull(),
  fetchedAt: integer("fetched_at").notNull(), contentType: text("content_type").notNull(), etag: text("etag").notNull(), sha256: text("sha256").notNull(),
  byteCount: integer("byte_count").notNull(), payload: blob("payload", { mode: "buffer" }).notNull(), licenseId: text("license_id").notNull(),
  validationStatus: text("validation_status").notNull(), error: text("error").notNull(),
}, (table) => [index("knowledge_raw_artifacts_pack_idx").on(table.packId, table.sourceId)]);

export const knowledgeRecords = sqliteTable("knowledge_records", {
  id: text("id").primaryKey(), packId: text("pack_id").notNull(), sourceId: text("source_id").notNull(), externalId: text("external_id").notNull(),
  recordKind: text("record_kind").notNull(), ecosystem: text("ecosystem").notNull(), packageName: text("package_name").notNull(), affectedRange: text("affected_range").notNull(),
  severity: text("severity").notNull(), cweIds: text("cwe_ids", { mode: "json" }).$type<string[]>().notNull(), title: text("title").notNull(), summary: text("summary").notNull(),
  referencesJson: text("references_json", { mode: "json" }).$type<string[]>().notNull(), modifiedAt: text("modified_at").notNull(), normalizedJson: text("normalized_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  licenseId: text("license_id").notNull(), attribution: text("attribution").notNull(), commercialAllowed: integer("commercial_allowed", { mode: "boolean" }).notNull(),
  redistributionAllowed: integer("redistribution_allowed", { mode: "boolean" }).notNull(), recordHash: text("record_hash").notNull(), status: text("status").notNull(),
  quarantineReason: text("quarantine_reason").notNull(), createdAt: integer("created_at").notNull(),
}, (table) => [index("knowledge_records_pack_idx").on(table.packId, table.status, table.sourceId), index("knowledge_records_external_idx").on(table.externalId, table.ecosystem, table.packageName)]);

export const knowledgeValidationRuns = sqliteTable("knowledge_validation_runs", {
  id: text("id").primaryKey(), packId: text("pack_id").notNull(), schemaPass: integer("schema_pass", { mode: "boolean" }).notNull(),
  licensePass: integer("license_pass", { mode: "boolean" }).notNull(), replayPass: integer("replay_pass", { mode: "boolean" }).notNull(), signaturePass: integer("signature_pass", { mode: "boolean" }).notNull(),
  sourceCount: integer("source_count").notNull(), recordCount: integer("record_count").notNull(), rejectedCount: integer("rejected_count").notNull(), score: real("score").notNull(),
  evidence: text("evidence").notNull(), createdAt: integer("created_at").notNull(),
}, (table) => [index("knowledge_validation_runs_pack_idx").on(table.packId, table.createdAt)]);

export const knowledgePackState = sqliteTable("knowledge_pack_state", {
  id: text("id").primaryKey(), activePackId: text("active_pack_id"), previousPackId: text("previous_pack_id"), updatedAt: integer("updated_at").notNull(),
});

export const knowledgePackEvents = sqliteTable("knowledge_pack_events", {
  id: text("id").primaryKey(), packId: text("pack_id").notNull(), eventKind: text("event_kind").notNull(), fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(), actor: text("actor").notNull(), evidence: text("evidence").notNull(), createdAt: integer("created_at").notNull(),
}, (table) => [index("knowledge_pack_events_pack_idx").on(table.packId, table.createdAt)]);

export const networkPolicyEvents = sqliteTable("network_policy_events", {
  id: text("id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  scope: text("scope").notNull(),
  actor: text("actor").notNull(),
  createdAt: integer("created_at").notNull(),
});
