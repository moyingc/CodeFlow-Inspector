import type {
  FlowEdge,
  FlowNode,
  FunctionInfo,
  GraphEdge,
  RuntimeGuard,
  RuntimeSandboxReport,
  RuntimeScenario,
} from "@/src/lib/analysis/types";

export function simulateRuntimeSandbox(
  functions: FunctionInfo[],
  callEdges: GraphEdge[],
  flowNodes: FlowNode[],
  flowEdges: FlowEdge[],
  breakpoints: Set<string>,
): RuntimeSandboxReport {
  const scenarios = buildRuntimeScenarios(functions, callEdges, flowNodes, flowEdges, breakpoints);
  const guards = buildRuntimeGuards(functions, flowNodes, breakpoints);
  const riskCount = scenarios.filter((scenario) => scenario.status !== "pass").length;
  const estimatedSteps = estimateRuntimeSteps(functions, callEdges, scenarios);
  const readinessScore = scoreRuntimeReadiness(functions, guards, scenarios, breakpoints);
  const deterministicScore = scoreDeterminism(functions, callEdges, flowEdges);

  return {
    mode: "Static Dry-run",
    readinessScore,
    deterministicScore,
    breakpointCount: breakpoints.size,
    riskCount,
    estimatedSteps,
    resourceBudget: {
      maxSteps: 1200,
      maxBranchFanout: 8,
      timeoutMs: 2500,
      memoryMb: 128,
    },
    scenarios,
    guards,
    next: [
      "把 Static Dry-run 升级为 Web Worker/Node Worker 受控运行，不直接阻塞 UI。",
      "为每次输入样本记录 step trace、stdout、stderr、异常、耗时和内存峰值。",
      "增加断点命中后的局部变量快照和上下游水路暂停状态。",
      "加入超时、最大步数、最大输出、最大内存和禁用危险 API 的沙箱策略。",
    ],
  };
}

function buildRuntimeScenarios(
  functions: FunctionInfo[],
  callEdges: GraphEdge[],
  flowNodes: FlowNode[],
  flowEdges: FlowEdge[],
  breakpoints: Set<string>,
): RuntimeScenario[] {
  const entry = pickRuntimeEntry(functions, callEdges);
  const primaryLength = Math.max(1, flowEdges.filter((edge) => edge.primary).length);
  const unvalidated = functions.filter((fn) => fn.externalInputs.length && !fn.validations.length);
  const overflow = functions.filter((fn) => fn.risks.includes("溢流风险"));
  const blocked = functions.filter((fn) => breakpoints.has(fn.id) || fn.risks.includes("堵塞/无限循环"));
  const openNodes = flowNodes.filter((node) => node.status === "Open");
  const scenarios: RuntimeScenario[] = [
    {
      name: "标准输入",
      inputShape: entry?.dataShape ?? "unknown",
      pathLength: primaryLength,
      status: blocked.length ? "blocked" : openNodes.length ? "warning" : "pass",
      risk: blocked.length ? "断点或阻塞会中断主线执行。" : openNodes.length ? "存在未闭合出口，需要补返回或异常路径。" : "主线可以从输入推演到输出。",
      evidence: entry ? `${entry.name} -> ${primaryLength} 条主河道边` : "等待入口函数。",
    },
    {
      name: "空值/缺失输入",
      inputShape: "null | undefined | empty",
      pathLength: Math.max(1, Math.min(primaryLength, functions.filter((fn) => fn.validations.length).length + 1)),
      status: functions.some((fn) => fn.validations.length) ? "pass" : "warning",
      risk: functions.some((fn) => fn.validations.length) ? "发现验证节点，可拦截空值输入。" : "没有发现统一验证阀门，空值可能改变水流走向。",
      evidence: functions.filter((fn) => fn.validations.length).map((fn) => fn.name).slice(0, 3).join(", ") || "missing validation",
    },
    {
      name: "大批量输入",
      inputShape: "array | list | queue",
      pathLength: primaryLength + overflow.length,
      status: overflow.length ? "overflow" : "pass",
      risk: overflow.length ? "容器或队列没有明显容量上限，湖水可能满溢。" : "没有发现明显溢流规则命中。",
      evidence: overflow.map((fn) => fn.name).slice(0, 4).join(", ") || "capacity stable",
    },
    {
      name: "外部污染输入",
      inputShape: "request | query | file | network",
      pathLength: primaryLength + unvalidated.length,
      status: unvalidated.length ? "warning" : "pass",
      risk: unvalidated.length ? "外部数据没有先经过净化阀门。" : "外部输入路径已有验证或权限证据。",
      evidence: unvalidated.map((fn) => fn.name).slice(0, 4).join(", ") || "input guards present",
    },
  ];

  return scenarios;
}

function buildRuntimeGuards(
  functions: FunctionInfo[],
  flowNodes: FlowNode[],
  breakpoints: Set<string>,
): RuntimeGuard[] {
  const hasValidation = functions.some((fn) => fn.validations.length);
  const hasExceptionGuard = functions.some((fn) => fn.validations.includes("异常处理"));
  const hasOutput = functions.some((fn) => fn.outputs.some((output) => output !== "state change/void" && output !== "void"));
  const hasCapacityRisk = functions.some((fn) => fn.risks.includes("溢流风险"));
  const blockedNodes = flowNodes.filter((node) => node.status === "Blocked");

  return [
    {
      name: "输入阀门",
      status: hasValidation ? "ready" : "missing",
      evidence: hasValidation ? "检测到 validate/assert/try/type/range 等验证证据。" : "没有发现统一验证、权限或范围检查。",
    },
    {
      name: "异常出口",
      status: hasExceptionGuard ? "ready" : "weak",
      evidence: hasExceptionGuard ? "检测到 try/catch/except/finally。" : "异常传播路径还不清晰。",
    },
    {
      name: "容量上限",
      status: hasCapacityRisk ? "weak" : "ready",
      evidence: hasCapacityRisk ? "发现队列/缓存/数组写入但没有明显 limit/max/backpressure。" : "当前没有明显溢流规则命中。",
    },
    {
      name: "输出闭合",
      status: hasOutput ? "ready" : "missing",
      evidence: hasOutput ? "检测到 return/response/side effect 输出。" : "没有发现稳定输出口。",
    },
    {
      name: "断点控制",
      status: breakpoints.size || blockedNodes.length ? "weak" : "ready",
      evidence: breakpoints.size ? `${breakpoints.size} 个手动断点会暂停水路。` : `${blockedNodes.length} 个阻塞节点。`,
    },
  ];
}

function pickRuntimeEntry(functions: FunctionInfo[], callEdges: GraphEdge[]) {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  callEdges.forEach((edge) => {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
  });

  return [...functions].sort((a, b) => {
    const aScore = (outgoing.get(a.id) ?? 0) * 4 - (incoming.get(a.id) ?? 0) + (a.externalInputs.length ? 6 : 0);
    const bScore = (outgoing.get(b.id) ?? 0) * 4 - (incoming.get(b.id) ?? 0) + (b.externalInputs.length ? 6 : 0);
    return bScore - aScore;
  })[0] ?? null;
}

function estimateRuntimeSteps(
  functions: FunctionInfo[],
  callEdges: GraphEdge[],
  scenarios: RuntimeScenario[],
) {
  const functionCost = functions.reduce((sum, fn) => sum + Math.max(1, fn.complexity), 0);
  const edgeCost = callEdges.length * 2;
  const scenarioCost = scenarios.reduce((sum, scenario) => sum + scenario.pathLength, 0);
  return Math.min(1200, Math.max(1, functionCost + edgeCost + scenarioCost));
}

function scoreRuntimeReadiness(
  functions: FunctionInfo[],
  guards: RuntimeGuard[],
  scenarios: RuntimeScenario[],
  breakpoints: Set<string>,
) {
  let score = functions.length ? 42 : 18;
  score += guards.filter((guard) => guard.status === "ready").length * 9;
  score -= guards.filter((guard) => guard.status === "missing").length * 10;
  score -= scenarios.filter((scenario) => scenario.status === "overflow" || scenario.status === "blocked").length * 12;
  score -= scenarios.filter((scenario) => scenario.status === "warning").length * 5;
  score -= breakpoints.size * 4;
  return Math.max(8, Math.min(92, Math.round(score)));
}

function scoreDeterminism(functions: FunctionInfo[], callEdges: GraphEdge[], flowEdges: FlowEdge[]) {
  let score = 50;
  score += Math.min(18, callEdges.length * 2);
  score += Math.min(12, flowEdges.filter((edge) => edge.primary).length * 3);
  score += Math.min(10, functions.filter((fn) => fn.returnType !== "unknown" && fn.returnType !== "inferred").length);
  score -= functions.filter((fn) => fn.confidence < 70).length * 4;
  score -= functions.filter((fn) => fn.risks.length).length * 5;
  return Math.max(10, Math.min(95, Math.round(score)));
}
