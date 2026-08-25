import type {
  DeepWebNeuralDatabaseReport,
  DeepWebReplayMemoryReport,
} from "@/src/lib/analysis/types";
import { buildDeepWebModelJournalRows } from "@/src/lib/persistence/deepweb-model-journal";

export const DEEPWEB_SQLITE_JOURNAL_STORAGE_KEY = "codeflow.deepweb.sqlite-journal.v1";
export const DEEPWEB_SQLITE_JOURNAL_CHANGE_EVENT = "codeflow:deepweb-sqlite-journal-change";

export const MAX_JOURNAL_ROWS = 320;
export const MAX_JOURNAL_BYTES = 4 * 1024 * 1024;
export const MAX_JOURNAL_ROW_BYTES = 128 * 1024;

export type DeepWebSqliteJournalTable =
  | "deepweb_replay_memory_snapshots"
  | "deepweb_replay_comparisons"
  | "deepweb_replay_promotion_decisions"
  | "deepweb_model_versions"
  | "deepweb_trainable_head_runs"
  | "deepweb_feature_vectors"
  | "deepweb_inference_runs"
  | "deepweb_validation_evidence"
  | "deepweb_extreme_test_runs"
  | "deepweb_irrigation_runs"
  | "deepweb_irrigation_evidence"
  | "deepweb_irrigation_epochs"
  | "deepweb_weight_update_events"
  | "deepweb_supervision_labels"
  | "deepweb_supervised_assignments"
  | "deepweb_teacher_reliability"
  | "deepweb_quarantined_labels"
  | "deepweb_label_centroids"
  | "deepweb_contrastive_pairs"
  | "deepweb_self_supervised_epochs"
  | "deepweb_supervised_epochs"
  | "deepweb_rollback_snapshots"
  | "deepweb_error_signals"
  | "deepweb_gene_pool"
  | "deepweb_genome_generations"
  | "deepweb_gene_expression"
  | "deepweb_fitness_scores";

export type DeepWebSqliteJournalRow = {
  id: string;
  tableName: DeepWebSqliteJournalTable;
  primaryKey: string;
  projectHash: string;
  payload: Record<string, unknown>;
  sql: string;
  status: "pending" | "synced" | "exported";
  createdAt: number;
};

export type DeepWebSqliteJournalReport = {
  status: "synced" | "warming" | "blocked";
  storageMode: "localStorage SQLite journal";
  tableCount: number;
  rowCount: number;
  snapshotRows: number;
  comparisonRows: number;
  promotionRows: number;
  pendingRows: number;
  lastSyncedAt: number;
  sqlPreview: string;
  evidence: string[];
  next: string;
};

export function buildDeepWebSqliteJournalRows(
  report: DeepWebReplayMemoryReport,
  model?: DeepWebNeuralDatabaseReport,
  createdAt = Date.now(),
): DeepWebSqliteJournalRow[] {
  const snapshot = report.currentSnapshot;
  const comparison = report.comparison;
  const promotionGate = promotionGateFor(report);
  const promotionTargets = [
    {
      targetKind: "validation_evidence",
      targetId: snapshot.stableSnapshot,
      score: report.promotionScore,
      evidence: `snapshot ${snapshot.id} · promotion ${report.promotionScore}% · replay ${report.replayReadinessScore}%`,
    },
    {
      targetKind: "weight_update",
      targetId: `${snapshot.stableSnapshot}-weights`,
      score: Math.max(0, report.promotionScore - report.regressionRiskScore),
      evidence: `regression risk ${report.regressionRiskScore}% · drift ${comparison.driftScore}%`,
    },
    {
      targetKind: "teacher_label",
      targetId: `${snapshot.stableSnapshot}-teacher`,
      score: Math.round((snapshot.teacherTrustScore + snapshot.teacherConsensusRate) / 2),
      evidence: `teacher trust ${snapshot.teacherTrustScore}% · consensus ${snapshot.teacherConsensusRate}%`,
    },
    ...comparison.changedDimensions.slice(0, 8).map((dimension) => ({
      targetKind: "feature_vector",
      targetId: `${snapshot.id}-${dimension}`,
      score: Math.max(0, 100 - comparison.driftScore),
      evidence: `dimension ${dimension} changed · ${comparison.evidence}`,
    })),
  ];

  const snapshotPayload = {
    id: snapshot.id,
    project_name: snapshot.projectName,
    project_hash: snapshot.projectHash,
    file_count: snapshot.fileCount,
    function_count: snapshot.functionCount,
    issue_count: snapshot.issueCount,
    deepweb_coverage: snapshot.deepWebCoverage,
    irrigation_score: snapshot.irrigationScore,
    optimization_score: snapshot.optimizationScore,
    accepted_evidence_count: snapshot.acceptedEvidenceCount,
    isolated_evidence_count: snapshot.isolatedEvidenceCount,
    vector_count: snapshot.vectorCount,
    inference_run_count: snapshot.inferenceRunCount,
    teacher_trust_score: snapshot.teacherTrustScore,
    teacher_consensus_rate: snapshot.teacherConsensusRate,
    maturity_score: snapshot.maturityScore,
    stable_snapshot: snapshot.stableSnapshot,
    status: snapshot.status,
    dimension_scores: snapshot.dimensionScores,
    label_breakdown: snapshot.labelBreakdown,
    evidence: snapshot.evidence,
    created_at: snapshot.createdAt,
  };
  const comparisonPayload = {
    id: comparison.id,
    current_snapshot_id: comparison.currentSnapshotId,
    baseline_snapshot_id: comparison.baselineSnapshotId ?? null,
    status: comparison.status,
    drift_score: comparison.driftScore,
    regression_score: comparison.regressionScore,
    improvement_score: comparison.improvementScore,
    changed_dimensions: comparison.changedDimensions,
    evidence: comparison.evidence,
    created_at: createdAt,
  };

  const replayRows = [
    sqliteJournalRow("deepweb_replay_memory_snapshots", snapshot.id, snapshot.projectHash, snapshotPayload, createdAt),
    sqliteJournalRow("deepweb_replay_comparisons", comparison.id, snapshot.projectHash, comparisonPayload, createdAt),
    ...promotionTargets.map((target, index) => {
      const payload = {
        id: `dw-promotion-${snapshot.id}-${index}`,
        snapshot_id: snapshot.id,
        target_kind: target.targetKind,
        target_id: target.targetId,
        gate: promotionGate,
        score: clamp(target.score),
        evidence: target.evidence,
        created_at: createdAt,
      };
      return sqliteJournalRow("deepweb_replay_promotion_decisions", String(payload.id), snapshot.projectHash, payload, createdAt);
    }),
  ];
  return model ? [...replayRows, ...buildDeepWebModelJournalRows(report, model, createdAt)] : replayRows;
}

export function syncDeepWebSqliteJournal(
  report: DeepWebReplayMemoryReport,
  model?: DeepWebNeuralDatabaseReport,
  storage: Storage | undefined = browserStorage(),
) {
  if (!storage) return buildDeepWebSqliteJournalRows(report, model);
  const current = loadDeepWebSqliteJournalRows(storage);
  const incoming = buildDeepWebSqliteJournalRows(report, model);
  const incomingKeys = new Set(incoming.map((row) => `${row.tableName}:${row.primaryKey}`));
  const next = retainJournalRows(
    [...incoming, ...current.filter((row) => !incomingKeys.has(`${row.tableName}:${row.primaryKey}`))]
      .sort((a, b) => b.createdAt - a.createdAt),
  );
  storage.setItem(DEEPWEB_SQLITE_JOURNAL_STORAGE_KEY, JSON.stringify(next));
  notifyDeepWebSqliteJournal();
  return next;
}

export function loadDeepWebSqliteJournalRows(storage: Storage | undefined = browserStorage()) {
  return parseDeepWebSqliteJournalPayload(getDeepWebSqliteJournalPayload(storage));
}

export function getDeepWebSqliteJournalPayload(storage: Storage | undefined = browserStorage()) {
  if (!storage) return "[]";
  return storage.getItem(DEEPWEB_SQLITE_JOURNAL_STORAGE_KEY) ?? "[]";
}

export function parseDeepWebSqliteJournalPayload(payload: string) {
  try {
    const parsed = JSON.parse(payload) as DeepWebSqliteJournalRow[];
    return retainJournalRows(parsed.filter(isJournalRow).sort((a, b) => b.createdAt - a.createdAt));
  } catch {
    return [];
  }
}

export function retainJournalRows(rows: DeepWebSqliteJournalRow[]) {
  const retained: DeepWebSqliteJournalRow[] = [];
  let usedBytes = 2;
  for (const row of rows) {
    if (retained.length >= MAX_JOURNAL_ROWS) break;
    const rowBytes = byteLength(JSON.stringify(row));
    if (rowBytes > MAX_JOURNAL_ROW_BYTES || usedBytes + rowBytes > MAX_JOURNAL_BYTES) continue;
    retained.push(row);
    usedBytes += rowBytes;
  }
  return retained;
}

export function subscribeDeepWebSqliteJournal(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  const notify = () => listener();
  window.addEventListener(DEEPWEB_SQLITE_JOURNAL_CHANGE_EVENT, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(DEEPWEB_SQLITE_JOURNAL_CHANGE_EVENT, notify);
    window.removeEventListener("storage", notify);
  };
}

export function clearDeepWebSqliteJournal(storage: Storage | undefined = browserStorage()) {
  storage?.removeItem(DEEPWEB_SQLITE_JOURNAL_STORAGE_KEY);
  notifyDeepWebSqliteJournal();
  return [];
}

export function buildDeepWebSqliteJournalReport(rows: DeepWebSqliteJournalRow[], replay: DeepWebReplayMemoryReport): DeepWebSqliteJournalReport {
  const tableNames = new Set(rows.map((row) => row.tableName));
  const snapshotRows = rows.filter((row) => row.tableName === "deepweb_replay_memory_snapshots").length;
  const comparisonRows = rows.filter((row) => row.tableName === "deepweb_replay_comparisons").length;
  const promotionRows = rows.filter((row) => row.tableName === "deepweb_replay_promotion_decisions").length;
  const pendingRows = rows.filter((row) => row.status === "pending").length;
  const lastSyncedAt = rows[0]?.createdAt ?? 0;
  const status: DeepWebSqliteJournalReport["status"] =
    replay.comparison.status === "regressed"
      ? "blocked"
      : tableNames.size >= 3 && rows.length >= 3
        ? "synced"
        : "warming";
  const sqlPreview = rows
    .slice(0, 3)
    .map((row) => row.sql)
    .join("\n");

  return {
    status,
    storageMode: "localStorage SQLite journal",
    tableCount: tableNames.size,
    rowCount: rows.length,
    snapshotRows,
    comparisonRows,
    promotionRows,
    pendingRows,
    lastSyncedAt,
    sqlPreview,
    evidence: [
      `journal rows ${rows.length} · tables ${tableNames.size} · pending ${pendingRows}`,
      `snapshots ${snapshotRows} · comparisons ${comparisonRows} · promotion decisions ${promotionRows}`,
      replay.comparison.evidence,
    ],
    next:
      status === "synced"
        ? "journal 已经可以导出 SQL；接入 sql.js/OPFS 后把 localStorage writer 替换为 SQLite writer。"
        : status === "blocked"
          ? "检测到回放退化，先不要把本轮快照晋级到稳定库。"
          : "继续积累快照，至少同步 snapshot、comparison 和 promotion 三类表。",
  };
}

function sqliteJournalRow(
  tableName: DeepWebSqliteJournalTable,
  primaryKey: string,
  projectHash: string,
  payload: Record<string, unknown>,
  createdAt: number,
): DeepWebSqliteJournalRow {
  return {
    id: `sqlite-journal-${tableName}-${primaryKey}`,
    tableName,
    primaryKey,
    projectHash,
    payload,
    sql: insertOrReplaceSql(tableName, payload),
    status: "synced",
    createdAt,
  };
}

function insertOrReplaceSql(tableName: string, payload: Record<string, unknown>) {
  const columns = Object.keys(payload);
  const values = columns.map((column) => sqlValue(payload[column]));
  return `INSERT OR REPLACE INTO ${tableName} (${columns.join(", ")}) VALUES (${values.join(", ")});`;
}

function sqlValue(value: unknown): string {
  if (value === null || typeof value === "undefined") return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "0";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "object") return `'${JSON.stringify(value).replaceAll("'", "''")}'`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

function promotionGateFor(report: DeepWebReplayMemoryReport) {
  if (report.comparison.status === "regressed") return "rolled_back";
  if (report.regressionRiskScore >= 24) return "isolated";
  if (report.promotionScore >= 88 && report.memoryHealthScore >= 78) return "promoted";
  return "held";
}

function isJournalRow(value: unknown): value is DeepWebSqliteJournalRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<DeepWebSqliteJournalRow>;
  return Boolean(row.id && row.tableName && row.primaryKey && row.projectHash && row.sql);
}

function browserStorage() {
  if (typeof window === "undefined") return undefined;
  return window.localStorage;
}

function notifyDeepWebSqliteJournal() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(DEEPWEB_SQLITE_JOURNAL_CHANGE_EVENT));
}

function byteLength(value: string) {
  return typeof TextEncoder === "undefined" ? value.length * 2 : new TextEncoder().encode(value).byteLength;
}

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}
