import type {
  CodeFile,
  DeepWebReplayComparison,
  DeepWebReplayMemoryReport,
  DeepWebReplaySnapshot,
  DeepWebVectorLabel,
  WorkspaceAnalysis,
} from "@/src/lib/analysis/types";
import { simpleHash } from "@/src/lib/workspace/files";

export const DEEPWEB_MEMORY_STORAGE_KEY = "codeflow.deepweb.replay-memory.v1";
export const DEEPWEB_MEMORY_CHANGE_EVENT = "codeflow:deepweb-memory-change";
const MAX_MEMORY_SNAPSHOTS = 24;

const deepWebLabels: DeepWebVectorLabel[] = [
  "safe",
  "flow_warning",
  "security_risk",
  "stability_risk",
  "performance_hotspot",
  "repair_candidate",
];

export function buildDeepWebReplaySnapshot(files: CodeFile[], analysis: WorkspaceAnalysis, createdAt = Date.now()): DeepWebReplaySnapshot {
  const deepWeb = analysis.semanticIndex.deepDatabase.deepWeb;
  const projectHash = simpleHash(files.map((file) => `${file.name}:${file.hash}:${file.size}`).join("|"));
  const projectName = inferProjectName(files, analysis);
  const status: DeepWebReplaySnapshot["status"] =
    analysis.issues.some((issue) => issue.severity === "Critical") || deepWeb.irrigation.status === "blocked"
      ? "blocked"
      : deepWeb.coverage >= 96 && deepWeb.irrigation.stabilityScore >= 94 && deepWeb.optimization.score >= 98
        ? "stable"
        : "watch";
  const dimensionScores = Object.fromEntries(deepWeb.maturity.dimensions.map((dimension) => [dimension.dimensionKey, dimension.score]));
  const labelBreakdown = deepWebLabels.reduce(
    (acc, label) => {
      acc[label] = deepWeb.selfSupervised.labelBreakdown[label] ?? 0;
      return acc;
    },
    {} as Record<DeepWebVectorLabel, number>,
  );
  const id = `dw-replay-${projectHash}-${simpleHash(`${deepWeb.irrigation.cycleId}:${deepWeb.irrigation.stableSnapshot}:${deepWeb.generatedVectorCount}`)}`;

  return {
    id,
    projectName,
    projectHash,
    createdAt,
    fileCount: files.length,
    functionCount: analysis.semanticIndex.functionCount,
    issueCount: analysis.issues.length,
    deepWebCoverage: deepWeb.coverage,
    irrigationScore: deepWeb.irrigation.stabilityScore,
    optimizationScore: deepWeb.optimization.score,
    acceptedEvidenceCount: deepWeb.irrigation.acceptedEvidenceCount,
    isolatedEvidenceCount: deepWeb.irrigation.isolatedEvidenceCount,
    vectorCount: deepWeb.generatedVectorCount,
    inferenceRunCount: deepWeb.inferenceRunCount,
    teacherTrustScore: deepWeb.supervised.trustScore,
    teacherConsensusRate: deepWeb.supervised.consensusRate,
    maturityScore: deepWeb.maturity.score,
    stableSnapshot: deepWeb.irrigation.stableSnapshot,
    status,
    dimensionScores,
    labelBreakdown,
    evidence: [
      `${projectName} · files ${files.length} · functions ${analysis.semanticIndex.functionCount} · vectors ${deepWeb.generatedVectorCount}`,
      `DeepWeb ${deepWeb.coverage}% · irrigation ${deepWeb.irrigation.stabilityScore}% · optimization ${deepWeb.optimization.score}%`,
      `accepted ${deepWeb.irrigation.acceptedEvidenceCount} · isolated ${deepWeb.irrigation.isolatedEvidenceCount} · issues ${analysis.issues.length}`,
    ],
  };
}

export function loadDeepWebReplaySnapshots(storage: Storage | undefined = browserStorage()) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(DEEPWEB_MEMORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DeepWebReplaySnapshot[];
    return parsed.filter(isReplaySnapshot).sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_MEMORY_SNAPSHOTS);
  } catch {
    return [];
  }
}

export function getDeepWebReplaySnapshotPayload(storage: Storage | undefined = browserStorage()) {
  if (!storage) return "[]";
  return storage.getItem(DEEPWEB_MEMORY_STORAGE_KEY) ?? "[]";
}

export function parseDeepWebReplaySnapshotsPayload(payload: string) {
  try {
    const parsed = JSON.parse(payload) as DeepWebReplaySnapshot[];
    return parsed.filter(isReplaySnapshot).sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_MEMORY_SNAPSHOTS);
  } catch {
    return [];
  }
}

export function subscribeDeepWebReplayMemory(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  const notify = () => listener();
  window.addEventListener(DEEPWEB_MEMORY_CHANGE_EVENT, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(DEEPWEB_MEMORY_CHANGE_EVENT, notify);
    window.removeEventListener("storage", notify);
  };
}

export function saveDeepWebReplaySnapshot(snapshot: DeepWebReplaySnapshot, storage: Storage | undefined = browserStorage()) {
  if (!storage) return [snapshot];
  const current = loadDeepWebReplaySnapshots(storage);
  const next = [snapshot, ...current.filter((item) => item.id !== snapshot.id)]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_MEMORY_SNAPSHOTS);
  storage.setItem(DEEPWEB_MEMORY_STORAGE_KEY, JSON.stringify(next));
  notifyDeepWebReplayMemory();
  return next;
}

export function clearDeepWebReplaySnapshots(storage: Storage | undefined = browserStorage()) {
  storage?.removeItem(DEEPWEB_MEMORY_STORAGE_KEY);
  notifyDeepWebReplayMemory();
  return [];
}

export function buildDeepWebReplayMemoryReport(
  currentSnapshot: DeepWebReplaySnapshot,
  snapshots: DeepWebReplaySnapshot[],
): DeepWebReplayMemoryReport {
  const history = snapshots.filter((snapshot) => snapshot.id !== currentSnapshot.id);
  const stableHistory = history.filter((snapshot) => snapshot.status === "stable");
  const baseline =
    stableHistory.find((snapshot) => snapshot.projectHash === currentSnapshot.projectHash) ??
    stableHistory[0] ??
    history[0];
  const comparison = compareReplaySnapshots(currentSnapshot, baseline);
  const snapshotCount = snapshots.some((snapshot) => snapshot.id === currentSnapshot.id) ? snapshots.length : snapshots.length + 1;
  const stableSnapshotCount = stableHistory.length + Number(currentSnapshot.status === "stable");
  const replayReadinessScore = clamp(
    Math.round(
      Math.min(100, snapshotCount * 18) * 0.24 +
        Math.min(100, stableSnapshotCount * 26) * 0.2 +
        currentSnapshot.irrigationScore * 0.2 +
        currentSnapshot.teacherConsensusRate * 0.16 +
        currentSnapshot.optimizationScore * 0.12 +
        Math.max(0, 100 - comparison.regressionScore) * 0.08,
    ),
  );
  const promotionScore = clamp(
    Math.round(
      currentSnapshot.irrigationScore * 0.28 +
        currentSnapshot.teacherTrustScore * 0.22 +
        currentSnapshot.teacherConsensusRate * 0.22 +
        Math.max(0, 100 - comparison.driftScore) * 0.16 +
        currentSnapshot.maturityScore * 0.12,
    ),
  );
  const regressionRiskScore = clamp(Math.round(comparison.regressionScore * 0.62 + comparison.driftScore * 0.28 + currentSnapshot.isolatedEvidenceCount / Math.max(1, currentSnapshot.acceptedEvidenceCount) * 100 * 0.1));
  const memoryHealthScore = clamp(Math.round(replayReadinessScore * 0.36 + promotionScore * 0.34 + Math.max(0, 100 - regressionRiskScore) * 0.3));
  const status: DeepWebReplayMemoryReport["status"] =
    snapshotCount <= 1 ? "warming" : memoryHealthScore >= 86 && stableSnapshotCount >= 2 ? "stable" : memoryHealthScore >= 62 ? "learning" : "empty";

  return {
    status,
    snapshotCount,
    stableSnapshotCount,
    currentSnapshot,
    comparison,
    replayReadinessScore,
    promotionScore,
    regressionRiskScore,
    memoryHealthScore,
    next:
      status === "stable"
        ? "回放记忆已能作为稳定基线，下一步把真实测试和 benchmark 结果绑定到每个快照。"
        : "继续导入不同项目或同一项目的修复前后版本，让记忆库积累可比较基线。",
  };
}

function compareReplaySnapshots(current: DeepWebReplaySnapshot, baseline?: DeepWebReplaySnapshot): DeepWebReplayComparison {
  if (!baseline) {
    return {
      id: `dw-replay-compare-${current.id}-first`,
      currentSnapshotId: current.id,
      status: "stable",
      driftScore: 0,
      regressionScore: 0,
      improvementScore: 0,
      changedDimensions: [],
      evidence: "首次快照，没有历史基线；先进入 warming 记忆。",
    };
  }

  const changedDimensions = Object.entries(current.dimensionScores)
    .filter(([key, value]) => Math.abs(value - (baseline.dimensionScores[key] ?? value)) >= 4)
    .map(([key]) => key);
  const driftScore = clamp(
    Math.round(
      average(changedDimensions.map((key) => Math.abs((current.dimensionScores[key] ?? 0) - (baseline.dimensionScores[key] ?? 0)))) * 1.6 +
        Math.abs(current.vectorCount - baseline.vectorCount) / Math.max(1, baseline.vectorCount) * 22 +
        Math.abs(current.acceptedEvidenceCount - baseline.acceptedEvidenceCount) / Math.max(1, baseline.acceptedEvidenceCount) * 18,
    ),
  );
  const regressionScore = clamp(
    Math.round(
      Math.max(0, baseline.deepWebCoverage - current.deepWebCoverage) * 1.8 +
        Math.max(0, baseline.irrigationScore - current.irrigationScore) * 2 +
        Math.max(0, current.issueCount - baseline.issueCount) * 5 +
        Math.max(0, current.isolatedEvidenceCount - baseline.isolatedEvidenceCount) / Math.max(1, baseline.isolatedEvidenceCount) * 18,
    ),
  );
  const improvementScore = clamp(
    Math.round(
      Math.max(0, current.deepWebCoverage - baseline.deepWebCoverage) * 1.5 +
        Math.max(0, current.irrigationScore - baseline.irrigationScore) * 1.8 +
        Math.max(0, current.acceptedEvidenceCount - baseline.acceptedEvidenceCount) / Math.max(1, baseline.acceptedEvidenceCount) * 18 +
        Math.max(0, baseline.issueCount - current.issueCount) * 5,
    ),
  );
  const status: DeepWebReplayComparison["status"] =
    regressionScore >= 24 ? "regressed" : driftScore >= 32 ? "watch" : improvementScore >= 12 ? "improved" : "stable";

  return {
    id: `dw-replay-compare-${current.id}-${baseline.id}`,
    currentSnapshotId: current.id,
    baselineSnapshotId: baseline.id,
    status,
    driftScore,
    regressionScore,
    improvementScore,
    changedDimensions,
    evidence: `${baseline.projectName} -> ${current.projectName} · drift ${driftScore}% · regression ${regressionScore}% · improvement ${improvementScore}%`,
  };
}

function inferProjectName(files: CodeFile[], analysis: WorkspaceAnalysis) {
  const mainName = analysis.mainFile?.name ?? files[0]?.name ?? "未命名项目";
  const firstSegment = mainName.split("/").filter(Boolean)[0];
  return firstSegment && files.some((file) => file.name.includes("/")) ? firstSegment : mainName.split("/").pop() ?? mainName;
}

function isReplaySnapshot(value: unknown): value is DeepWebReplaySnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<DeepWebReplaySnapshot>;
  return Boolean(snapshot.id && snapshot.projectHash && typeof snapshot.createdAt === "number" && typeof snapshot.deepWebCoverage === "number");
}

function browserStorage() {
  if (typeof window === "undefined") return undefined;
  return window.localStorage;
}

function notifyDeepWebReplayMemory() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(DEEPWEB_MEMORY_CHANGE_EVENT));
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
