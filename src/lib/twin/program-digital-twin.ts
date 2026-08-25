import type {
  AnalysisIssue,
  CodeFile,
  ControlledRuntimeExecutionReport,
  DigitalTwinEvidenceGrade,
  DigitalTwinExperiment,
  DigitalTwinVariant,
  FlowEdge,
  FlowNode,
  FunctionInfo,
  ProgramDigitalTwinReport,
  RuntimeSandboxReport,
  SpeedOption,
} from "@/src/lib/analysis/types";

type ProgramDigitalTwinInput = {
  files: CodeFile[];
  functions: FunctionInfo[];
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  issues: AnalysisIssue[];
  runtimeSandbox: RuntimeSandboxReport;
  speedOptions: SpeedOption[];
  environmentScore: number;
  closureScore: number;
  damScore: number;
  runtimeExecutions?: ControlledRuntimeExecutionReport[];
};

export function buildProgramDigitalTwin(input: ProgramDigitalTwinInput): ProgramDigitalTwinReport {
  const sourceNodes = input.flowNodes.filter((node) => node.role === "水源" || !(node.upstreamIds?.length));
  const sinkNodes = input.flowNodes.filter((node) => node.role === "排水口" || !(node.downstreamIds?.length));
  const runtimeExecutions = input.runtimeExecutions ?? [];
  const latestRuntime = latestRuntimeForKind(runtimeExecutions, "baseline");
  const stressRuntimes = latestStressRuntimeBatch(runtimeExecutions);
  const faultRuntime = latestRuntimeForKind(runtimeExecutions, "fault");
  const securityRuntime = latestRuntimeForKind(runtimeExecutions, "security");
  const hasControlledRuntime = Boolean(latestRuntime);
  const experiments: DigitalTwinExperiment[] = [
    staticExperiment(input),
    dynamicExperiment(input, hasControlledRuntime ? "真实执行" : "模型仿真", latestRuntime),
    stressExperiment(input, stressRuntimes),
    faultExperiment(input, faultRuntime),
    algorithmExperiment(input),
    securityExperiment(input, securityRuntime),
    migrationExperiment(input),
  ];
  const variants = buildVariants(input);
  const executedExperimentCount = experiments.filter((item) => item.evidenceGrade === "真实执行").length;
  const simulatedExperimentCount = experiments.filter((item) => item.evidenceGrade === "模型仿真").length;
  const inferredExperimentCount = experiments.filter((item) => item.evidenceGrade === "静态推断").length;
  const validatedExperimentCount = experiments.filter((item) => item.claimStatus === "已验证").length;
  const coverageScore = Math.round(
    experiments.reduce((sum, item) => sum + item.confidence, 0) / Math.max(1, experiments.length),
  );
  const runtimeCalibration = hasControlledRuntime ? 24 : 0;
  const graphEvidence = input.flowEdges.length ? Math.min(26, 10 + Math.round(input.flowEdges.length / 3)) : 0;
  const parserEvidence = input.functions.length ? 18 : 0;
  const environmentEvidence = Math.round(input.environmentScore * 0.12);
  const fidelityScore = clamp(
    parserEvidence + graphEvidence + environmentEvidence + runtimeCalibration - inferredExperimentCount * 2,
    12,
    hasControlledRuntime ? 94 : 68,
  );

  return {
    status: executedExperimentCount ? "已有实测校准" : simulatedExperimentCount ? "可仿真" : "模型已建立",
    fidelityScore,
    coverageScore,
    executedExperimentCount,
    simulatedExperimentCount,
    inferredExperimentCount,
    validatedExperimentCount,
    sourceCount: sourceNodes.length,
    sinkCount: sinkNodes.length,
    experiments,
    variants,
    summary:
      `程序数字孪生已把 ${input.functions.length} 个函数、${input.flowEdges.length} 条水路、` +
      `${input.issues.length} 条诊断和 ${input.speedOptions.length} 个优化候选装入同一实验模型。` +
      `当前保真度 ${fidelityScore}%，其中 ${executedExperimentCount} 项来自真实执行、` +
      `${simulatedExperimentCount} 项来自模型仿真、${inferredExperimentCount} 项来自静态推断；` +
      `${validatedExperimentCount} 项已经满足目标断言。`,
    limitations: [
      ...(hasControlledRuntime ? [] : ["当前项目尚未运行受控进程，因此还没有本轮 stdout、异常、耗时和内存峰值；性能数字只能作为验证优先级。"]),
      "跨线程、反射、动态加载、宏和原生扩展可能改变静态水路。",
      "算法替换候选已经接入修复中心，但必须先在项目副本中完成回归与基准对照，审批后才允许写回源文件。",
    ],
    next: [
      "把 Node/Python/Cargo/JVM 等运行器接入 Tauri sidecar，生成真实执行证据。",
      "保存每次输入、环境、代码哈希、轨迹、指标和结论，支持同项目版本回放。",
      "优化候选只有通过功能回归、安全测试和稳定性门槛后，才能进入修复中心。",
    ],
  };
}

function staticExperiment(input: ProgramDigitalTwinInput): DigitalTwinExperiment {
  const riskCount = input.issues.filter((issue) => issue.severity === "Critical" || issue.severity === "High").length;
  return experiment({
    id: "twin-static-analysis",
    kind: "静态分析",
    name: "控制流、数据流与规则联合扫描",
    objective: "不运行程序，检查入口、函数调用、水路闭合、类型线索和危险 API。",
    evidenceGrade: "静态推断",
    claimStatus: "已观察",
    claimReason: "已形成静态控制流、数据流和诊断快照，但未运行目标程序。",
    status: riskCount ? "风险" : input.closureScore < 70 ? "观察" : "通过",
    confidence: averageConfidence(input.functions),
    affectedNodeIds: riskNodeIds(input.flowNodes),
    inputModel: `${input.files.length} 文件 / ${input.functions.length} 函数`,
    expectedBehavior: "输入沿主河道到达明确输出，所有危险出口都有验证和权限边界。",
    observedOrEstimated: `闭合度 ${input.closureScore}%，高风险问题 ${riskCount} 条。`,
    metrics: metricSet(input.closureScore, 76, input.damScore, 70),
    evidence: [
      `${input.flowEdges.length} 条函数水路`,
      `${input.issues.length} 条规则与结构诊断`,
      `${input.functions.filter((fn) => fn.parser?.includes("Compiler")).length} 个 Compiler 证据函数`,
    ],
    nextAction: riskCount ? "先定位高风险节点，再补 AST/LSP 或运行证据确认。" : "保留为基线快照。",
  });
}

function dynamicExperiment(
  input: ProgramDigitalTwinInput,
  evidenceGrade: DigitalTwinEvidenceGrade,
  runtime: ControlledRuntimeExecutionReport | null,
): DigitalTwinExperiment {
  const warnings = input.runtimeSandbox.scenarios.filter((scenario) => scenario.status !== "pass").length;
  return experiment({
    id: "twin-dynamic-simulation",
    kind: "动态仿真",
    name: "输入到输出路径回放",
    objective: "用标准、空值、批量和污染输入观察路径、断点、异常与输出。",
    evidenceGrade,
    claimStatus: runtime?.status === "passed" && runtime.sandboxStatus === "enforced" && (runtime.traceEvents?.length ?? 0) > 0 ? "已验证" : runtime ? "已观察" : "未证明",
    claimReason: runtime
      ? (runtime.traceEvents?.length ?? 0) > 0
        ? "真实进程正常结束，并取得程序内部路径 trace。"
        : "真实进程已经运行，但没有内部路径 trace，尚不能证明输入经过了哪些函数。"
      : "当前只有静态 dry-run 场景，没有真实进程证据。",
    status:
      evidenceGrade === "真实执行"
        ? runtime?.status === "passed"
          ? "通过"
          : runtime?.status === "timeout"
            ? "阻塞"
            : "风险"
        : "等待执行",
    confidence: evidenceGrade === "真实执行" ? 96 : Math.min(68, input.runtimeSandbox.readinessScore),
    affectedNodeIds: riskNodeIds(input.flowNodes),
    inputModel: input.runtimeSandbox.scenarios.map((scenario) => scenario.inputShape).join("；"),
    expectedBehavior: "不同输入都进入可解释路径，异常有出口，断点能保存局部状态。",
    observedOrEstimated: runtime
      ? `${runtime.adapter} 真实执行 ${runtime.status}，退出码 ${runtime.exitCode ?? "none"}，耗时 ${runtime.durationMs}ms。`
      : `${input.runtimeSandbox.scenarios.length} 个场景，${warnings} 个需要观察；当前 ${input.runtimeSandbox.mode}。`,
    metrics: metricSet(72, input.runtimeSandbox.deterministicScore, input.damScore, 66),
    evidence: runtime
      ? [
          `${runtime.commandLabel} · ${runtime.status} · ${runtime.durationMs}ms`,
          ...runtime.evidence,
          ...(runtime.stderr ? [`stderr: ${runtime.stderr.slice(0, 240)}`] : []),
        ]
      : input.runtimeSandbox.scenarios.map((scenario) => `${scenario.name}: ${scenario.evidence}`),
    nextAction: evidenceGrade === "真实执行" ? "保存轨迹并与静态路径做差异校准。" : "接入受控运行器后执行，不把 dry-run 当作实测。",
  });
}

function stressExperiment(
  input: ProgramDigitalTwinInput,
  runtimes: ControlledRuntimeExecutionReport[],
): DigitalTwinExperiment {
  const runtime = runtimes.at(-1) ?? null;
  const statistics = runtimeStatistics(runtimes);
  const capacityRisks = input.flowNodes.filter((node) => node.status === "Overflow Risk" || node.capacity === "湖").length;
  return experiment({
    id: "twin-stress-test",
    kind: "压力测试",
    name: "容量、吞吐与资源边界",
    objective: "扩大输入规模，验证列表、队列、缓存、数据库和主河道是否过载。",
    evidenceGrade: runtime ? "真实执行" : "模型仿真",
    claimStatus: runtime && statistics.sampleCount >= 16 && statistics.failureRate <= 5 && runtimes.every((run) => run.sandboxStatus === "enforced") ? "已验证" : runtime ? "已观察" : "未证明",
    claimReason: runtime
      ? statistics.sampleCount >= 16
        ? `已取得 ${statistics.sampleCount} 次独立运行；只有失败率不超过 5% 且全部强隔离才通过压力门。`
        : `只有 ${statistics.sampleCount} 次真实样本，尚不足以证明压力稳定性。`
      : "尚未执行真实重复压力样本。",
    status: runtime ? runtimeExperimentStatus(runtime) : "等待执行",
    confidence: runtime ? runtimeConfidence(runtime) : 58,
    affectedNodeIds: input.flowNodes.filter((node) => node.status === "Overflow Risk" || node.capacity === "湖").map((node) => node.id),
    inputModel: "1x / 10x / 100x 批量，突发流量，慢下游",
    expectedBehavior: "容量有上限，出现背压或降级，不发生无限增长和无响应。",
    observedOrEstimated: runtime
      ? `同一代码与输入已真实执行 ${statistics.sampleCount} 次，通过 ${statistics.passedCount} 次；P50 ${statistics.p50DurationMs}ms，P95 ${statistics.p95DurationMs}ms，峰值内存 ${formatBytes(statistics.peakMemoryBytes)}。`
      : `发现 ${capacityRisks} 个容量重点节点；预算 ${input.runtimeSandbox.resourceBudget.memoryMb}MB / ${input.runtimeSandbox.resourceBudget.timeoutMs}ms。`,
    metrics: runtime
      ? metricSet(runtime.durationMs < input.runtimeSandbox.resourceBudget.timeoutMs ? 78 : 42, runtime.status === "passed" ? 82 : 38, input.damScore, resourceScore(runtime))
      : metricSet(64, capacityRisks ? 48 : 74, input.damScore, capacityRisks ? 42 : 72),
    evidence: runtime ? [
      `真实重复 ${statistics.sampleCount} 次 · 失败率 ${statistics.failureRate}% · 最大耗时 ${statistics.maxDurationMs}ms`,
      `累计 CPU ${statistics.totalCpuTimeMs}ms · 峰值内存 ${formatBytes(statistics.peakMemoryBytes)}`,
      ...runtimes.slice(-4).flatMap(runtimeEvidence),
    ] : [
      ...input.flowNodes.filter((node) => node.status === "Overflow Risk").map((node) => `${node.name}: ${node.evidence ?? node.note}`),
      `静态步数估计 ${input.runtimeSandbox.estimatedSteps}`,
    ],
    nextAction: runtime ? "继续增加不同输入规模，形成吞吐、P99、队列深度和跨版本前后对照。" : "真实记录吞吐、P95/P99 延迟、峰值内存、队列深度和失败率。",
    runtimeStatistics: runtime ? statistics : undefined,
  });
}

function faultExperiment(input: ProgramDigitalTwinInput, runtime: ControlledRuntimeExecutionReport | null): DigitalTwinExperiment {
  const weakGuards = input.runtimeSandbox.guards.filter((guard) => guard.status !== "ready");
  return experiment({
    id: "twin-fault-propagation",
    kind: "容错传播",
    name: "模块失效与异常传播",
    objective: "模拟函数超时、依赖失败、异常抛出和输出中断后的传播范围。",
    evidenceGrade: runtime ? "真实执行" : "静态推断",
    claimStatus: runtime && (runtime.traceEvents?.length ?? 0) > 0 ? "已观察" : "未证明",
    claimReason: runtime
      ? "故障输入已经真实投递；还需要目标程序断言预期错误出口、回滚状态和恢复时间，才能判为已验证。"
      : "尚未真实注入依赖失败、超时或空值。",
    status: runtime ? runtimeExperimentStatus(runtime, true) : weakGuards.length ? "观察" : "通过",
    confidence: runtime ? runtimeConfidence(runtime) : Math.min(76, 48 + input.runtimeSandbox.guards.length * 5),
    affectedNodeIds: riskNodeIds(input.flowNodes),
    inputModel: "函数异常 / 超时 / 下游不可用 / 返回空值",
    expectedBehavior: "失败被局部隔离，有回滚、降级、重试上限或清晰错误出口。",
    observedOrEstimated: runtime
      ? `${runtime.sampleId ?? "故障样本"} 已投递并真实执行，结果 ${runtime.status}，异常出口 ${runtime.stderr ? "有 stderr" : "未输出 stderr"}，文件改动 ${runtime.fileChanges.length} 项。`
      : `${weakGuards.length} 个保护项偏弱：${weakGuards.map((guard) => guard.name).join("、") || "无"}。`,
    metrics: metricSet(62, clamp(100 - weakGuards.length * 16), input.damScore, 68),
    evidence: runtime ? runtimeEvidence(runtime) : input.runtimeSandbox.guards.map((guard) => `${guard.name}: ${guard.status} · ${guard.evidence}`),
    nextAction: runtime?.traceEvents?.length ? "依据自动插桩的 error/transfer trace 标记故障传播路径。" : "扩大自动插桩覆盖后，记录受影响下游与恢复时间。",
  });
}

function algorithmExperiment(input: ProgramDigitalTwinInput): DigitalTwinExperiment {
  const best = [...input.speedOptions].sort((a, b) => b.fitScore - a.fitScore)[0];
  return experiment({
    id: "twin-algorithm-comparison",
    kind: "算法替换",
    name: "效率、稳定性与资源三方权衡",
    objective: "比较缓存、批处理、并发、索引或算法替换对整体水系的影响。",
    evidenceGrade: "模型仿真",
    claimStatus: "未证明",
    claimReason: "当前只有候选收益模型，没有生成 A/B 代码副本并运行同输入回归和 benchmark。",
    status: best ? "等待执行" : "观察",
    confidence: best ? Math.min(72, best.fitScore) : 42,
    affectedNodeIds: [],
    inputModel: best ? `${best.name} -> ${best.target}` : "等待识别优化目标",
    expectedBehavior: "功能输出不变，性能改善，同时稳定性和资源代价不越过门槛。",
    observedOrEstimated: best
      ? `最优候选 ${best.name}：预计效率 +${best.efficiencyGain}%，稳定风险 ${best.stabilityRisk}%，适配 ${best.fitScore}%。`
      : "当前没有足够证据生成算法替换候选。",
    metrics: metricSet(best?.efficiencyGain ?? 0, 100 - (best?.stabilityRisk ?? 50), 70, 66),
    evidence: input.speedOptions.map((option) => `${option.name}: ${option.model} · ${option.reason}`),
    nextAction: "在代码副本中生成 A/B 版本，使用同一输入和环境跑基准与回归。",
  });
}

function securityExperiment(
  input: ProgramDigitalTwinInput,
  runtime: ControlledRuntimeExecutionReport | null,
): DigitalTwinExperiment {
  const securityIssues = input.issues.filter((issue) => issue.category === "security");
  return experiment({
    id: "twin-security-attack",
    kind: "安全攻击",
    name: "污染输入与边界突破",
    objective: "模拟注入、越权、路径穿越、危险反序列化和资源耗尽。",
    evidenceGrade: runtime ? "真实执行" : "模型仿真",
    claimStatus: runtime && (runtime.traceEvents?.length ?? 0) > 0 ? "已观察" : "未证明",
    claimReason: runtime
      ? "污染输入已在强隔离副本中投递；必须再证明污染值未到达危险 sink，才能判为安全。"
      : "尚未真实投递攻击样本。",
    status: runtime ? runtimeExperimentStatus(runtime, true) : "等待执行",
    confidence: runtime ? runtimeConfidence(runtime) : Math.min(70, 44 + securityIssues.length * 4),
    affectedNodeIds: riskNodeIds(input.flowNodes),
    inputModel: "恶意字符串 / 超长输入 / 越权身份 / 非法路径 / 重复请求",
    expectedBehavior: "外部输入先经过验证、授权和限流，不触达危险 sink。",
    observedOrEstimated: runtime
      ? `${runtime.sampleId ?? "安全样本"} 已在断网隔离副本中执行，结果 ${runtime.status}，子进程 ${runtime.childProcessCount}，文件越界改动 ${runtime.fileChanges.length}。`
      : `静态发现 ${securityIssues.length} 条安全证据，堤坝评分 ${input.damScore}%。`,
    metrics: metricSet(68, 70, input.damScore, 62),
    evidence: runtime ? [...runtimeEvidence(runtime), ...securityIssues.slice(0, 4).map((issue) => `${issue.title}: ${issue.evidence}`)] : securityIssues.map((issue) => `${issue.title}: ${issue.evidence}`),
    nextAction: runtime?.traceEvents?.length ? "把污染输入 trace 与危险 sink 做可达性核对。" : "扩大自动插桩覆盖并重放攻击输入，证明污染值是否触达危险 sink。",
  });
}

function migrationExperiment(input: ProgramDigitalTwinInput): DigitalTwinExperiment {
  const manifests = input.files.filter((file) => /package\.json|requirements|pyproject|cargo\.toml|pom\.xml|gradle|dockerfile/i.test(file.name));
  const hardwareRefs = input.files.reduce((sum, file) => sum + (file.deviceRefs?.length ?? 0), 0);
  return experiment({
    id: "twin-environment-migration",
    kind: "环境迁移",
    name: "操作系统、架构与运行载体迁移",
    objective: "评估 Windows/Linux、x86/ARM、CPU/GPU 和设备差异对运行的影响。",
    evidenceGrade: "静态推断",
    claimStatus: "未证明",
    claimReason: "当前只识别依赖与设备线索，尚未在目标 OS、架构或设备上回放。",
    status: input.environmentScore < 70 ? "风险" : manifests.length ? "观察" : "等待执行",
    confidence: clamp(40 + manifests.length * 8 + Math.min(16, hardwareRefs * 2), 35, 78),
    affectedNodeIds: [],
    inputModel: "OS / CPU 架构 / runtime / SDK / device profile",
    expectedBehavior: "依赖、路径、原生库、字节序、精度和硬件边界在目标环境中仍成立。",
    observedOrEstimated: `环境完整度 ${input.environmentScore}%，发现 ${manifests.length} 个依赖载体、${hardwareRefs} 个设备引用。`,
    metrics: metricSet(58, input.environmentScore, 68, 60),
    evidence: manifests.map((file) => `${file.name}: ${file.environmentRefs?.join(", ") || file.language}`),
    nextAction: "建立目标环境矩阵，在容器、虚拟机或真实设备上回放同一测试集。",
  });
}

function buildVariants(input: ProgramDigitalTwinInput): DigitalTwinVariant[] {
  return input.speedOptions.slice(0, 6).map((option, index) => {
    const stabilityDelta = -option.stabilityRisk;
    const securityDelta = option.model.toLowerCase().includes("guard") ? 8 : 0;
    const resourceDelta = option.name.includes("缓存") ? -12 : option.name.includes("批") ? 6 : -4;
    const recommendation =
      option.fitScore >= 74 && option.stabilityRisk <= 28
        ? "推荐验证"
        : option.fitScore >= 52
          ? "谨慎验证"
          : "不建议";
    return {
      id: `twin-variant-${index}-${safeId(option.name)}`,
      name: option.name,
      target: option.target,
      change: option.reason,
      evidenceGrade: "模型仿真",
      estimatedPerformanceGain: option.efficiencyGain,
      estimatedStabilityDelta: stabilityDelta,
      estimatedSecurityDelta: securityDelta,
      estimatedResourceDelta: resourceDelta,
      fitScore: option.fitScore,
      validationGate: "功能输出一致 + 无新增高危问题 + 稳定性不低于基线 95% + 真实基准收益为正",
      recommendation,
      evidence: `${option.model}；当前仅作为候选，不自动修改源代码。`,
    };
  });
}

function experiment(input: DigitalTwinExperiment): DigitalTwinExperiment {
  return { ...input, confidence: clamp(input.confidence), metrics: normalizeMetrics(input.metrics) };
}

function metricSet(performance: number, stability: number, security: number, resource: number) {
  return { performance, stability, security, resource };
}

function normalizeMetrics(metrics: DigitalTwinExperiment["metrics"]) {
  return {
    performance: clamp(metrics.performance),
    stability: clamp(metrics.stability),
    security: clamp(metrics.security),
    resource: clamp(metrics.resource),
  };
}

function latestRuntimeForKind(
  runs: ControlledRuntimeExecutionReport[],
  kind: NonNullable<ControlledRuntimeExecutionReport["experimentKind"]>,
) {
  return [...runs]
    .filter((run) => (run.experimentKind ?? "baseline") === kind && !["unavailable", "rejected"].includes(run.status))
    .sort((a, b) => b.finishedAt - a.finishedAt)[0] ?? null;
}

function latestStressRuntimeBatch(runs: ControlledRuntimeExecutionReport[]) {
  const stressRuns = runs
    .filter((run) => run.experimentKind === "stress" && !["unavailable", "rejected"].includes(run.status))
    .sort((a, b) => a.finishedAt - b.finishedAt);
  const latest = stressRuns.at(-1);
  if (!latest) return [];
  const batchMatch = latest.sampleId?.match(/^(stress-bounded-16x-\d+)-\d{2}$/);
  if (!batchMatch) return [latest];
  return stressRuns.filter((run) => run.sampleId?.startsWith(`${batchMatch[1]}-`)).slice(-16);
}

function runtimeStatistics(runs: ControlledRuntimeExecutionReport[]) {
  const durations = runs.map((run) => run.durationMs).sort((a, b) => a - b);
  const percentile = (ratio: number) => durations.length
    ? durations[Math.min(durations.length - 1, Math.max(0, Math.ceil(durations.length * ratio) - 1))]
    : 0;
  const passedCount = runs.filter((run) => run.status === "passed").length;
  return {
    sampleCount: runs.length,
    passedCount,
    failureRate: Math.round((runs.length - passedCount) / Math.max(1, runs.length) * 100),
    p50DurationMs: percentile(0.5),
    p95DurationMs: percentile(0.95),
    maxDurationMs: durations.at(-1) ?? 0,
    totalCpuTimeMs: runs.reduce((sum, run) => sum + run.cpuTimeMs, 0),
    peakMemoryBytes: runs.reduce((peak, run) => Math.max(peak, run.peakMemoryBytes), 0),
  };
}

function runtimeExperimentStatus(
  runtime: ControlledRuntimeExecutionReport,
  adversarial = false,
): DigitalTwinExperiment["status"] {
  if (runtime.sandboxStatus !== "enforced") return "阻塞";
  if (runtime.status === "timeout") return "风险";
  if (runtime.status === "compile_failed" || runtime.status === "unavailable" || runtime.status === "rejected") return "阻塞";
  if (adversarial) return "观察";
  return runtime.status === "passed" ? "通过" : "风险";
}

function runtimeConfidence(runtime: ControlledRuntimeExecutionReport) {
  const traceBonus = Math.min(12, (runtime.traceEvents?.length ?? 0) * 2);
  const sandboxPenalty = runtime.sandboxStatus === "enforced" ? 0 : 18;
  return clamp(78 + traceBonus - sandboxPenalty, 48, 98);
}

function resourceScore(runtime: ControlledRuntimeExecutionReport) {
  const memoryMb = runtime.peakMemoryBytes / 1024 / 1024;
  return clamp(100 - Math.max(0, memoryMb - 64) / 4 - Math.max(0, runtime.childProcessCount - 2) * 5, 20, 96);
}

function runtimeEvidence(runtime: ControlledRuntimeExecutionReport) {
  return [
    `${runtime.experimentKind ?? "baseline"}/${runtime.sampleId ?? "unspecified"} · ${runtime.status} · ${runtime.durationMs}ms`,
    `输入 ${runtime.inputBytes ?? 0} bytes · 规模 ${runtime.repetition ?? 1}x · CPU ${runtime.cpuTimeMs}ms · 峰值内存 ${formatBytes(runtime.peakMemoryBytes)}`,
    `隔离 ${runtime.sandboxKind}/${runtime.sandboxStatus} · 子进程 ${runtime.childProcessCount} · 文件改动 ${runtime.fileChanges.length}`,
    (runtime.traceEvents?.length ?? 0) > 0
      ? `${runtime.traceEvents?.length ?? 0} 条独立 trace 事件提供函数路径证据；来源 ${runtime.traceSource ?? "unknown"}`
      : "样本已真实投递，但自动插桩尚未捕获内部函数路径，不能声称已经观察到完整调用链",
    ...runtime.evidence,
  ];
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function averageConfidence(functions: FunctionInfo[]) {
  if (!functions.length) return 20;
  return Math.round(functions.reduce((sum, fn) => sum + fn.confidence, 0) / functions.length);
}

function riskNodeIds(nodes: FlowNode[]) {
  return nodes
    .filter((node) => !["Closed", "Partially Closed"].includes(node.status) || (node.confidence ?? 0) < 65)
    .map((node) => node.id);
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function safeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "");
}
