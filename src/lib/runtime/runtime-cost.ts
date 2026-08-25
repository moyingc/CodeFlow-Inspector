import type { ControlledRuntimeExecutionReport } from "@/src/lib/analysis/types";

export type SystemCapacityReport = {
  status: "native" | "web-preview" | "unavailable";
  platform: string;
  logicalCpuCount: number;
  totalMemoryBytes: number;
  availableMemoryBytes: number;
  totalDiskBytes: number;
  availableDiskBytes: number;
  evidence: string[];
};

export type RuntimeCostDimension = {
  id: "cpu" | "memory" | "disk" | "process";
  label: string;
  status: "comfortable" | "acceptable" | "strained" | "unknown";
  score: number;
  required: string;
  available: string;
  explanation: string;
};

export type RuntimeCostReport = {
  status: "comfortable" | "acceptable" | "strained" | "unknown";
  score: number;
  confidence: number;
  evidenceGrade: "真实运行校准" | "本机容量 + 静态估算" | "静态估算";
  projectedPeakMemoryBytes: number;
  projectedDiskBytes: number;
  projectedCpuThreads: number;
  projectedProcessCount: number;
  dimensions: RuntimeCostDimension[];
  summary: string;
  recommendations: string[];
  evidence: string[];
};

type RuntimeCostInput = {
  fileCount: number;
  functionCount: number;
  edgeCount: number;
  sourceBytes: number;
  runs: ControlledRuntimeExecutionReport[];
  host: SystemCapacityReport;
};

const MB = 1024 * 1024;
const GB = 1024 * MB;

export function buildRuntimeCostReport(input: RuntimeCostInput): RuntimeCostReport {
  const measuredRuns = input.runs.filter((run) => run.status !== "unavailable" && run.status !== "rejected");
  const measuredPeakMemory = Math.max(0, ...measuredRuns.map((run) => run.peakMemoryBytes));
  const measuredProcessCount = Math.max(0, ...measuredRuns.map((run) => run.childProcessCount));
  const measuredCpuRatio = Math.max(0, ...measuredRuns.map((run) => run.durationMs > 0 ? run.cpuTimeMs / run.durationMs : 0));

  // The analyzer retains AST/graph/index data while the controlled child process runs.
  const analysisMemory = 220 * MB
    + input.sourceBytes * 14
    + input.functionCount * 600 * 1024
    + input.edgeCount * 220 * 1024;
  const estimatedRuntimeMemory = 96 * MB
    + input.sourceBytes * 8
    + input.functionCount * 180 * 1024;
  const projectedPeakMemoryBytes = Math.ceil(analysisMemory + Math.max(measuredPeakMemory, estimatedRuntimeMemory));
  const projectedDiskBytes = Math.ceil(
    192 * MB + input.sourceBytes * 6 + input.fileCount * 256 * 1024 + measuredRuns.length * 2 * MB,
  );
  const projectedCpuThreads = clamp(
    Math.ceil(1 + input.functionCount / 1_200 + input.edgeCount / 3_000 + measuredCpuRatio),
    1,
    16,
  );
  const projectedProcessCount = Math.max(1, measuredProcessCount || Math.min(8, 1 + Math.ceil(input.fileCount / 250)));

  const dimensions = [
    capacityDimension(
      "cpu",
      "CPU",
      projectedCpuThreads,
      input.host.logicalCpuCount,
      `${projectedCpuThreads} 个逻辑线程`,
      input.host.logicalCpuCount ? `${input.host.logicalCpuCount} 个逻辑线程` : "尚未读取",
      "线程需求来自项目规模、数据边数量与已观测 CPU/耗时比。",
    ),
    capacityDimension(
      "memory",
      "峰值内存",
      projectedPeakMemoryBytes,
      input.host.availableMemoryBytes,
      formatBytes(projectedPeakMemoryBytes),
      input.host.availableMemoryBytes ? `${formatBytes(input.host.availableMemoryBytes)} 当前可用` : "尚未读取",
      "包含分析器保留的 AST/图索引与受控子进程峰值，不把源文件大小直接当作内存占用。",
    ),
    capacityDimension(
      "disk",
      "本地磁盘",
      projectedDiskBytes,
      input.host.availableDiskBytes,
      formatBytes(projectedDiskBytes),
      input.host.availableDiskBytes ? `${formatBytes(input.host.availableDiskBytes)} 当前可用` : "尚未读取",
      "包含项目副本、SQLite 证据、运行输出和回滚快照的保守预算。",
    ),
    processDimension(projectedProcessCount),
  ];

  const knownCapacityDimensions = dimensions.filter((item) => item.status !== "unknown");
  const score = input.host.status === "native" && knownCapacityDimensions.length
    ? Math.round(knownCapacityDimensions.reduce((sum, item) => sum + item.score, 0) / knownCapacityDimensions.length)
    : 0;
  const status = overallStatus(dimensions);
  const confidence = clamp(
    38 + (input.host.status === "native" ? 30 : 0) + (measuredRuns.length ? 24 : 0),
    0,
    96,
  );
  const evidenceGrade = measuredRuns.length
    ? "真实运行校准"
    : input.host.status === "native"
      ? "本机容量 + 静态估算"
      : "静态估算";

  const recommendations: string[] = [];
  if (dimensions.some((item) => item.status === "strained")) {
    recommendations.push("先关闭高占用程序，再分批执行大型项目的解析、测试和孪生实验。系统仍保留完整项目视图。" );
  }
  if (!measuredRuns.length) recommendations.push("运行一次基线和一次压力样本后，CPU、内存与进程预算会由真实记录校准。" );
  if (input.host.status !== "native") recommendations.push("请在桌面程序中读取本机内存与磁盘容量；HTTP 预览只能给出静态项目成本。" );
  if (!recommendations.length) recommendations.push("当前余量足够；仍建议在依赖或输入规模显著变化后重新执行压力样本。" );

  return {
    status,
    score,
    confidence,
    evidenceGrade,
    projectedPeakMemoryBytes,
    projectedDiskBytes,
    projectedCpuThreads,
    projectedProcessCount,
    dimensions,
    summary: statusSummary(status, projectedPeakMemoryBytes, projectedCpuThreads),
    recommendations,
    evidence: [
      `${input.fileCount} files · ${input.functionCount} functions · ${input.edgeCount} edges · ${formatBytes(input.sourceBytes)} source`,
      measuredRuns.length
        ? `${measuredRuns.length} controlled runs · measured peak ${formatBytes(measuredPeakMemory)} · process tree ${measuredProcessCount}`
        : "尚无受控运行样本，运行成本保持估算标记。",
      ...input.host.evidence,
    ],
  };
}

export async function inspectSystemCapacity(): Promise<SystemCapacityReport> {
  const invoke = nativeInvoke();
  if (invoke) {
    try {
      return await invoke<SystemCapacityReport>("codeflow_system_capacity");
    } catch (error) {
      return unavailableCapacity(error instanceof Error ? error.message : String(error));
    }
  }
  const logicalCpuCount = typeof navigator === "undefined" ? 0 : navigator.hardwareConcurrency || 0;
  return {
    status: "web-preview",
    platform: typeof navigator === "undefined" ? "unknown" : navigator.platform || "browser",
    logicalCpuCount,
    totalMemoryBytes: 0,
    availableMemoryBytes: 0,
    totalDiskBytes: 0,
    availableDiskBytes: 0,
    evidence: ["HTTP 预览没有本机内存和磁盘读取权限。"],
  };
}

export function buildSystemCapacityWebPreview(): SystemCapacityReport {
  return {
    status: "web-preview",
    platform: "browser",
    logicalCpuCount: 0,
    totalMemoryBytes: 0,
    availableMemoryBytes: 0,
    totalDiskBytes: 0,
    availableDiskBytes: 0,
    evidence: ["等待桌面程序读取本机容量。"],
  };
}

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 MB";
  if (value >= GB) return `${(value / GB).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(value / MB))} MB`;
}

function capacityDimension(
  id: "cpu" | "memory" | "disk",
  label: string,
  requiredValue: number,
  availableValue: number,
  required: string,
  available: string,
  explanation: string,
): RuntimeCostDimension {
  if (!availableValue) return { id, label, status: "unknown", score: 0, required, available, explanation };
  const ratio = availableValue / Math.max(1, requiredValue);
  const status = ratio >= 2 ? "comfortable" : ratio >= 1.2 ? "acceptable" : "strained";
  return {
    id,
    label,
    status,
    score: clamp(Math.round(ratio * 50), 20, 100),
    required,
    available,
    explanation,
  };
}

function processDimension(projectedProcessCount: number): RuntimeCostDimension {
  const status = projectedProcessCount <= 4 ? "comfortable" : projectedProcessCount <= 8 ? "acceptable" : "strained";
  return {
    id: "process",
    label: "进程与并发",
    status,
    score: status === "comfortable" ? 100 : status === "acceptable" ? 72 : 42,
    required: `${projectedProcessCount} 个受控进程`,
    available: "运行器强制进程数、超时和输出上限",
    explanation: "表示构建器、解释器和子进程树压力；不是操作系统理论最大进程数。",
  };
}

function overallStatus(dimensions: RuntimeCostDimension[]): RuntimeCostReport["status"] {
  if (dimensions.some((item) => item.status === "strained")) return "strained";
  if (dimensions.some((item) => (item.id === "memory" || item.id === "disk") && item.status === "unknown")) return "unknown";
  if (dimensions.some((item) => item.status === "acceptable")) return "acceptable";
  if (dimensions.filter((item) => item.status !== "unknown").length <= 1) return "unknown";
  return "comfortable";
}

function statusSummary(status: RuntimeCostReport["status"], memory: number, cpu: number) {
  const demand = `预计同时需要约 ${formatBytes(memory)} 峰值内存和 ${cpu} 个逻辑线程`;
  if (status === "comfortable") return `当前电脑有充足余量。${demand}。`;
  if (status === "acceptable") return `当前电脑可以运行，但大型压力实验应避免与其他重负载任务同时执行。${demand}。`;
  if (status === "strained") return `当前电脑余量偏低，完整分析仍可分批完成，但并发实验可能触发换页、超时或磁盘压力。${demand}。`;
  return `项目成本已估算，但尚未取得完整本机容量，暂时不能断言电脑是否有足够余量。${demand}。`;
}

function unavailableCapacity(message: string): SystemCapacityReport {
  return {
    status: "unavailable",
    platform: "unknown",
    logicalCpuCount: 0,
    totalMemoryBytes: 0,
    availableMemoryBytes: 0,
    totalDiskBytes: 0,
    availableDiskBytes: 0,
    evidence: [`本机容量读取失败：${message}`],
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function nativeInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const current = window as Window & {
    __TAURI__?: { invoke?: TauriInvoke; core?: { invoke?: TauriInvoke } };
    __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
  };
  return current.__TAURI_INTERNALS__?.invoke ?? current.__TAURI__?.core?.invoke ?? current.__TAURI__?.invoke ?? null;
}
