import type {
  AnalysisIssue,
  CodeFile,
  ControlledRuntimeExecutionReport,
  DigitalTwinExperiment,
  FunctionInfo,
} from "@/src/lib/analysis/types";

export type SoftwareTestKind =
  | "functional"
  | "smoke"
  | "regression"
  | "integration"
  | "performance"
  | "load"
  | "usability"
  | "repair-verification";

export type SoftwareTestStatus = "passed" | "failed" | "blocked" | "not-run";

export type SoftwareTestResult = {
  id: SoftwareTestKind;
  name: string;
  status: SoftwareTestStatus;
  summary: string;
  evidence: string[];
  missingRequirements: string[];
  defect?: {
    severity: "Critical" | "High" | "Medium" | "Low";
    expected: string;
    actual: string;
    reproduction: string;
    recommendation: string;
  };
};

export type SoftwareTestReport = {
  versionFingerprint: string;
  generatedAt: number;
  revalidationRequired: boolean;
  summary: Record<SoftwareTestStatus, number>;
  results: SoftwareTestResult[];
  missingCapabilities: string[];
};

export const usabilityChecklist = [
  { id: "navigation", label: "主要页面和返回路径可以清楚找到" },
  { id: "readability", label: "说明文字、函数名和状态在常用窗口尺寸下完整可读" },
  { id: "graph", label: "图谱可移动、缩放、定位并点击目标" },
  { id: "feedback", label: "耗时操作、失败和缺失配置均有明确反馈" },
  { id: "export", label: "PDF 可选择保存位置，且内容完整" },
] as const;

type BuildSoftwareTestReportInput = {
  files: CodeFile[];
  functions: FunctionInfo[];
  issues: AnalysisIssue[];
  experiments: DigitalTwinExperiment[];
  runtimeExecutions: ControlledRuntimeExecutionReport[];
  usabilityPassedIds?: string[];
  projectUpdatedAt?: number;
  repair?: {
    status?: "passed" | "failed";
    evidence?: string[];
  } | null;
};

export function buildSoftwareTestReport(input: BuildSoftwareTestReportInput): SoftwareTestReport {
  const testFiles = input.files.filter((file) => /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[^.]+$/i.test(file.name));
  const manifests = input.files.filter((file) => /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|Cargo\.toml|pom\.xml|build\.gradle(?:\.kts)?|CMakeLists\.txt|go\.mod)$/i.test(file.name));
  const locks = input.files.filter((file) => /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|uv\.lock|poetry\.lock|Cargo\.lock|go\.sum|gradle\.lockfile)$/i.test(file.name));
  const baselines = input.runtimeExecutions.filter((run) => run.experimentKind === "baseline" || !run.experimentKind);
  const stressRuns = input.runtimeExecutions.filter((run) => run.experimentKind === "stress");
  const failedRuns = input.runtimeExecutions.filter((run) => run.status !== "passed");
  const latestRun = input.runtimeExecutions.reduce((latest, run) => Math.max(latest, run.finishedAt || 0), 0);
  const revalidationRequired = Boolean(input.projectUpdatedAt && latestRun && latestRun < input.projectUpdatedAt);
  const fingerprint = hashText(input.files.map((file) => `${file.name}:${file.hash ?? hashText(file.content)}`).sort().join("|"));

  const results: SoftwareTestResult[] = [
    resultFromRuns("functional", "功能测试", baselines, ["需要至少一次从入口到结果的真实受控执行"],
      `${input.functions.length} 个函数已建立静态功能索引。`, "主要功能应按预期完成输入、处理和输出。"),
    resultFromRuns("smoke", "冒烟测试", baselines.slice(-1), ["需要对当前版本执行一次最小启动/入口检查"],
      manifests.length ? `识别到 ${manifests.length} 个构建或运行清单。` : "未识别到构建或运行清单。", "项目应能编译或启动并完成最小入口调用。"),
    testFiles.length
      ? resultFromRuns("regression", "回归测试", baselines, ["测试文件存在，但尚无当前版本的真实回归执行"], `识别到 ${testFiles.length} 个测试文件。`, "已有行为在版本修改后应保持不变。")
      : blockedResult("regression", "回归测试", "没有发现自动化测试文件。", "添加测试目录或 *.test / *.spec 文件并在当前版本运行。"),
    input.files.length > 1
      ? resultFromRuns("integration", "集成测试", baselines, ["多文件关系已建立，但缺少跨模块真实执行"], `项目包含 ${input.files.length} 个文件。`, "跨文件、模块、数据库或设备边界应协同工作。")
      : blockedResult("integration", "集成测试", "当前项目没有足够的跨模块边界用于集成验证。", "导入完整项目或声明外部集成边界。"),
    resultFromRuns("performance", "性能测试", stressRuns, ["需要同环境下的多次耗时、CPU 和峰值内存样本"],
      stressRuns.length ? summarizePerformance(stressRuns) : "尚无真实性能样本。", "响应时间和资源消耗应符合当前基线。"),
    stressRuns.length >= 5
      ? resultFromRuns("load", "负载测试", stressRuns, [], `${stressRuns.length} 个压力样本已记录。`, "连续或并发负载下不应超时、崩溃或突破资源上限。")
      : blockedResult("load", "负载测试", `只有 ${stressRuns.length} 个压力样本，不能形成负载结论。`, "在相同环境执行至少 5 个压力样本并记录资源峰值。"),
    buildUsabilityResult(input.usabilityPassedIds ?? []),
    input.repair?.status
      ? {
          id: "repair-verification",
          name: "修复结果验证",
          status: input.repair.status,
          summary: input.repair.status === "passed" ? "候选修复已通过 A/B 回放门禁。" : "候选修复未通过 A/B 回放门禁，禁止写回。",
          evidence: input.repair.evidence ?? [],
          missingRequirements: [],
          ...(input.repair.status === "failed" ? { defect: defect("High", "修复后功能等价且性能、安全门禁通过。", "至少一项 A/B 门禁失败。", "重新运行当前候选的 A/B 实验。", "查看失败样本，修改候选后重新生成 Diff。") } : {}),
        }
      : blockedResult("repair-verification", "修复结果验证", "尚未形成可回放的候选修复 A/B 结果。", "生成候选 Diff，在项目副本中运行回归、性能和安全对照。"),
  ];

  if (revalidationRequired) {
    results.forEach((result) => {
      if (result.status === "passed" && result.id !== "usability") {
        result.status = "not-run";
        result.missingRequirements.push("代码或配置在最近一次运行后发生变化，需要重新验证");
        result.summary = `旧版本曾通过；当前版本指纹 ${fingerprint} 尚未复验。`;
      }
    });
  }

  const missingCapabilities = unique([
    ...(!manifests.length ? ["缺少构建/运行清单，无法稳定复现环境"] : []),
    ...(!locks.length ? ["缺少依赖锁文件，版本迭代结果可能不可复现"] : []),
    ...(!testFiles.length ? ["缺少自动化回归测试"] : []),
    ...(!input.runtimeExecutions.length ? ["缺少当前项目的真实受控运行记录"] : []),
    ...(!stressRuns.length ? ["缺少性能与负载基准样本"] : []),
    ...(failedRuns.length ? [`存在 ${failedRuns.length} 个失败、超时、编译失败或被拒绝的运行记录`] : []),
    ...(revalidationRequired ? ["项目版本已变化，历史成功结果需要重新验证"] : []),
  ]);

  return {
    versionFingerprint: fingerprint,
    generatedAt: Date.now(),
    revalidationRequired,
    summary: {
      passed: results.filter((item) => item.status === "passed").length,
      failed: results.filter((item) => item.status === "failed").length,
      blocked: results.filter((item) => item.status === "blocked").length,
      "not-run": results.filter((item) => item.status === "not-run").length,
    },
    results,
    missingCapabilities,
  };
}

function resultFromRuns(id: SoftwareTestKind, name: string, runs: ControlledRuntimeExecutionReport[], missing: string[], context: string, expected: string): SoftwareTestResult {
  if (!runs.length) return { id, name, status: "not-run", summary: context, evidence: [], missingRequirements: missing };
  const failures = runs.filter((run) => run.status !== "passed");
  if (!failures.length) return { id, name, status: "passed", summary: `${context} ${runs.length} 个真实样本全部通过。`, evidence: runs.slice(-8).map(runEvidence), missingRequirements: [] };
  const first = failures[0];
  return {
    id,
    name,
    status: "failed",
    summary: `${runs.length} 个样本中 ${failures.length} 个失败。`,
    evidence: failures.slice(-8).map(runEvidence),
    missingRequirements: [],
    defect: defect(first.status === "timeout" ? "High" : "Medium", expected, `${first.status} · exit ${first.exitCode ?? "无"} · ${first.stderr || first.compileOutput || "没有错误输出"}`, `${first.commandLabel}；入口 ${first.entryPath}；样本 ${first.sampleId ?? first.id}`, "先修复首个确定失败，再用相同输入和环境重新运行。"),
  };
}

function blockedResult(id: SoftwareTestKind, name: string, summary: string, requirement: string): SoftwareTestResult {
  return { id, name, status: "blocked", summary, evidence: [], missingRequirements: [requirement] };
}

function buildUsabilityResult(passedIds: string[]): SoftwareTestResult {
  const passed = new Set(passedIds);
  const missing = usabilityChecklist.filter((item) => !passed.has(item.id));
  return {
    id: "usability",
    name: "可用性测试",
    status: missing.length ? "not-run" : "passed",
    summary: missing.length ? `人工验收完成 ${passed.size}/${usabilityChecklist.length} 项。` : "全部人工可用性检查已确认通过。",
    evidence: usabilityChecklist.filter((item) => passed.has(item.id)).map((item) => `人工确认：${item.label}`),
    missingRequirements: missing.map((item) => `待确认：${item.label}`),
  };
}

function runEvidence(run: ControlledRuntimeExecutionReport) {
  return `${run.status} · ${run.adapter} · ${run.commandLabel} · ${run.durationMs}ms · CPU ${run.cpuTimeMs}ms · 峰值内存 ${formatBytes(run.peakMemoryBytes)}`;
}

function summarizePerformance(runs: ControlledRuntimeExecutionReport[]) {
  const durations = runs.map((run) => run.durationMs).sort((a, b) => a - b);
  const p95 = durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)] ?? 0;
  const peak = Math.max(...runs.map((run) => run.peakMemoryBytes), 0);
  return `${runs.length} 个样本，P95 ${p95}ms，峰值内存 ${formatBytes(peak)}。`;
}

function defect(severity: "Critical" | "High" | "Medium" | "Low", expected: string, actual: string, reproduction: string, recommendation: string) {
  return { severity, expected, actual, reproduction, recommendation };
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  return `${Math.round(bytes / 1024 / 1024 * 10) / 10} MB`;
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function unique(values: string[]) {
  return [...new Set(values)];
}
