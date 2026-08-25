import type {
  AnalysisIssue,
  CodeFile,
  ControlledRuntimeExecutionReport,
  DeepWebModelBaseline,
  DiagnosticEvidenceAudit,
  BuildProgressItem,
  FlowEdge,
  FlowNode,
  FormalVerificationRecord,
  FunctionInfo,
  GraphEdge,
  GraphMode,
  GraphNode,
  HydrologyCodeRole,
  HydrologyConfluence,
  HydrologyModelReport,
  HydrologyRiskLevel,
  HydrologyWaterRole,
  LocalLibraryAuditItem,
  LogicInventoryItem,
  MapQualityReport,
  RuntimeSandboxReport,
  SemanticIndexReport,
  SpeedOption,
  WorkspaceAnalysis,
} from "@/src/lib/analysis/types";
import { buildLocalGraphIndex } from "@/src/lib/index/local-graph-index";
import { buildKnowledgeRuleCoverageReport } from "@/src/lib/library/knowledge-coverage-audit";
import { localKnowledgeLibrarySeeds } from "@/src/lib/library/local-knowledge-base";
import { knowledgeRuleCountByLibraryCategory } from "@/src/lib/library/local-knowledge-rules";
import { matureLibraryAuditByCategory } from "@/src/lib/library/mature-local-library";
import { estimateProjectCompletion } from "@/src/lib/progress/project-completion";
import { buildProjectContracts } from "@/src/lib/verification/project-contracts";
import {
  applyKnowledgeRuleMatches,
  buildKnowledgeRuleIssues,
  evaluateKnowledgeRules,
} from "@/src/lib/rules/local-rule-engine";
import { simulateRuntimeSandbox } from "@/src/lib/runtime/runtime-sandbox";
import { buildProgramDigitalTwin } from "@/src/lib/twin/program-digital-twin";
import { buildProgramVerification } from "@/src/lib/verification/program-verification";
import {
  annotateEdgesWithTaint,
  buildSourceToSinkTaintReport,
  enrichPreciseDataFlow,
} from "@/src/lib/flow/precise-data-flow";

export const logicInventory: LogicInventoryItem[] = [
  {
    category: "输入与工作区",
    scope: "文件、文件夹、粘贴代码、忽略目录、语言识别",
    currentFunctions: ["readCodeFiles", "isReadableProjectFile", "detectLanguage", "simpleHash"],
    nextModule: "src/lib/workspace/",
    status: "已成型",
  },
  {
    category: "解析与抽离模型",
    scope: "函数签名、参数、返回值、调用边、置信度",
    currentFunctions: ["parseFunctionsFromFile", "normalizeMatch", "inferCalls", "buildEdges"],
    nextModule: "src/lib/parser/",
    status: "需替换",
  },
  {
    category: "语义分析",
    scope: "主控文件、入口函数、代码树、模型层",
    currentFunctions: ["analyzeWorkspace", "findMainControlFile", "findEntryFunction", "buildEntryTree"],
    nextModule: "src/lib/semantic/",
    status: "已成型",
  },
  {
    category: "水流法",
    scope: "函数水系、主河道、支流、容量形态、闭环和颜色诊断",
    currentFunctions: ["buildFlowNodes", "classifyFlowRole", "scoreClosure"],
    nextModule: "src/lib/flow/",
    status: "已成型",
  },
  {
    category: "安全与环境",
    scope: "堤坝稳固、外部入侵、水中元素冲突、环境载体缺失",
    currentFunctions: ["buildSecurityIssues", "buildElementConflicts", "buildEnvironmentIssues"],
    nextModule: "src/lib/rules/",
    status: "需抽离",
  },
  {
    category: "优化模型",
    scope: "复杂度、缓存、并发窗口、背压、元件参数适配",
    currentFunctions: ["buildSpeedOptions", "inferComplexity", "severityPenalty"],
    nextModule: "src/lib/models/",
    status: "需抽离",
  },
  {
    category: "界面与图谱",
    scope: "函数图、水渠图、检查器、问题列表、盘点卡片",
    currentFunctions: ["Home", "IssueList", "WaterCanalDiagram", "LogicInventoryPanel"],
    nextModule: "app/components/",
    status: "需抽离",
  },
];

export function analyzeWorkspace(
  files: CodeFile[],
  functions: FunctionInfo[],
  edges: GraphEdge[],
  breakpoints: Set<string>,
  runtimeExecutions: ControlledRuntimeExecutionReport[] = [],
  deepWebBaseline?: DeepWebModelBaseline | null,
  formalProofs: FormalVerificationRecord[] = [],
): WorkspaceAnalysis {
  const knowledgeRuleReport = evaluateKnowledgeRules(functions, edges);
  const knowledgeRuleCoverage = buildKnowledgeRuleCoverageReport();
  const analyzedFunctions = applyKnowledgeRuleMatches(functions, knowledgeRuleReport.matches);
  const mainFile = findMainControlFile(files, analyzedFunctions);
  const entryFunction = findEntryFunction(mainFile, analyzedFunctions, edges);
  const entryTree = buildEntryTree(entryFunction, analyzedFunctions, edges, breakpoints);
  const waterSystem = buildWaterSystem(analyzedFunctions, entryTree, edges, breakpoints, runtimeExecutions);
  const flowNodes = waterSystem.nodes;
  const flowEdges = waterSystem.edges;
  const taintFlow = waterSystem.taintFlow;
  const mapQuality = assessMapQuality(flowNodes, flowEdges);
  const hydrologyModel = buildHydrologyModel(analyzedFunctions, edges, flowNodes, entryFunction, breakpoints);
  const localLibraryAudit = buildLocalLibraryAudit(files, analyzedFunctions);
  const semanticIndex = buildLocalGraphIndex(
    files,
    analyzedFunctions,
    edges,
    flowNodes,
    flowEdges,
    localLibraryAudit,
    knowledgeRuleReport,
    runtimeExecutions,
    deepWebBaseline,
  );
  const runtimeSandbox = simulateRuntimeSandbox(analyzedFunctions, edges, flowNodes, flowEdges, breakpoints);
  const buildProgress = buildProgressReport(flowEdges, localLibraryAudit, mapQuality, semanticIndex, runtimeSandbox);
  const ruleIssues = buildKnowledgeRuleIssues(knowledgeRuleReport.matches);
  const securityIssues = uniqueAnalysisIssues([
    ...buildSecurityIssues(analyzedFunctions, flowNodes),
    ...buildTaintFlowIssues(taintFlow),
    ...ruleIssues.filter((issue) => issue.category === "security"),
  ]);
  const elementConflicts = uniqueAnalysisIssues([
    ...buildElementConflicts(analyzedFunctions),
    ...ruleIssues.filter((issue) => issue.category === "quality" || issue.category === "flow"),
  ]);
  const environmentIssues = buildEnvironmentIssues(files);
  const runtimeIssues = runtimeExecutions
    .filter((run) => run.status !== "passed")
    .slice(-3)
    .map<AnalysisIssue>((run) => ({
      id: `runtime-${run.id}`,
      title: run.status === "timeout" ? "真实执行超时" : run.status === "compile_failed" ? "真实编译失败" : "真实执行失败",
      category: run.status === "compile_failed" || run.status === "unavailable" ? "environment" : "quality",
      severity: run.status === "timeout" ? "High" : "Medium",
      status: "Confirmed",
      message: `${run.adapter} 受控运行结果为 ${run.status}，退出码 ${run.exitCode ?? "无"}，耗时 ${run.durationMs}ms。`,
      evidence: `${run.commandLabel} · ${run.stderr.slice(0, 320) || run.compileOutput.slice(0, 320) || "无错误输出"}`,
      confidence: 100,
    }));
  const speedOptions = buildSpeedOptions(analyzedFunctions, files);
  const closureScore = scoreClosure(flowNodes, breakpoints);
  const damScore = Math.max(0, 100 - securityIssues.reduce((acc, issue) => acc + severityPenalty(issue.severity), 0));
  const environmentScore = Math.max(0, 100 - environmentIssues.reduce((acc, issue) => acc + severityPenalty(issue.severity), 0));
  const issues = uniqueAnalysisIssues([...runtimeIssues, ...securityIssues, ...elementConflicts, ...environmentIssues, ...ruleIssues]);
  const diagnosticEvidenceAudit = buildDiagnosticEvidenceAudit(issues, analyzedFunctions, runtimeExecutions);
  const digitalTwin = buildProgramDigitalTwin({
    files,
    functions: analyzedFunctions,
    flowNodes,
    flowEdges,
    issues,
    runtimeSandbox,
    speedOptions,
    environmentScore,
    closureScore,
    damScore,
    runtimeExecutions,
  });
  const contracts = buildProjectContracts(analyzedFunctions, taintFlow, edges);
  const programVerification = buildProgramVerification({
    issues,
    diagnosticEvidence: diagnosticEvidenceAudit,
    knowledgeCoverage: knowledgeRuleCoverage,
    deepWeb: semanticIndex.deepDatabase.deepWeb,
    digitalTwin,
    runtimeExecutions,
    formalProofs,
    contracts,
  });
  const projectCompletion = estimateProjectCompletion({
    files,
    functions: analyzedFunctions,
    flowEdges,
    buildItems: buildProgress.items,
    localLibraryAudit,
    mapQuality,
    hydrologyModel,
    semanticIndex,
    runtimeSandbox,
    digitalTwin,
    programVerification,
    securityIssues,
    environmentIssues,
  });
  return {
    mainFile,
    entryFunction,
    entryTree,
    flowNodes,
    flowEdges,
    taintFlow,
    issues,
    diagnosticEvidenceAudit,
    securityIssues,
    elementConflicts,
    environmentIssues,
    speedOptions,
    modelLayers: buildModelLayers(files, functions),
    localLibraryAudit,
    mapQuality,
    hydrologyModel,
    knowledgeRuleReport,
    knowledgeRuleCoverage,
    semanticIndex,
    runtimeSandbox,
    digitalTwin,
    programVerification,
    projectCompletion,
    buildProgress,
    closureScore,
    damScore,
    environmentScore,
  };
}

function buildDiagnosticEvidenceAudit(
  issues: AnalysisIssue[],
  functions: FunctionInfo[],
  runtimeExecutions: ControlledRuntimeExecutionReport[],
): DiagnosticEvidenceAudit {
  const confirmed = issues.filter((issue) => issue.status === "Confirmed").length;
  const likely = issues.filter((issue) => issue.status === "Likely").length;
  const possible = issues.filter((issue) => issue.status === "Possible").length;
  const unknown = issues.filter((issue) => issue.status === "Unknown").length;
  const compilerSupported = functions.filter((fn) =>
    /compiler|typechecker|language service/i.test(`${fn.parser ?? ""} ${(fn.parseEvidence ?? []).join(" ")}`),
  ).length;
  const heuristicCandidates = issues.filter((issue) => /证据等级 heuristic|启发式|词法/.test(`${issue.evidence} ${issue.message}`)).length;
  const runtimeConfirmed = runtimeExecutions.filter((run) => run.status !== "unavailable" && run.status !== "rejected").length;
  const weightedEvidence = confirmed * 100 + likely * 72 + possible * 38 + unknown * 12;
  const completionScore = issues.length ? Math.round(weightedEvidence / issues.length) : functions.length ? 70 : 0;
  const gaps = [
    ...(heuristicCandidates ? [`${heuristicCandidates} 条诊断仍只有词法/启发式证据。`] : []),
    ...(compilerSupported < functions.length
      ? [`${functions.length - compilerSupported} 个函数尚未获得 Compiler/LSP 类型与作用域证据。`]
      : []),
    ...(runtimeConfirmed ? [] : ["当前项目尚无真实执行记录，无法确认运行时触发条件、异常和性能影响。"]),
    ...(issues.some((issue) => issue.category === "environment")
      ? ["环境诊断需要读取真实 SDK/编译器版本、锁文件和目标操作系统后复核。"]
      : []),
  ];
  return {
    completionScore,
    status: possible + unknown === 0 && runtimeConfirmed ? "证据闭环" : confirmed + likely > possible + unknown ? "部分闭环" : "启发式待补证",
    total: issues.length,
    confirmed,
    likely,
    possible,
    unknown,
    runtimeConfirmed,
    compilerSupported,
    heuristicCandidates,
    gaps,
    evidence: [
      `${compilerSupported}/${functions.length} 函数拥有 Compiler/LSP 级结构证据。`,
      `${runtimeConfirmed} 次受控运行可作为真实执行证据。`,
      `${confirmed} 条已确认，${likely} 条结构支持，${possible + unknown} 条仍需补证。`,
    ],
  };
}

export function layoutGraph(
  functions: FunctionInfo[],
  edges: GraphEdge[],
  mode: GraphMode,
  analysis: WorkspaceAnalysis,
): GraphNode[] {
  if (!functions.length) return [];

  if (mode === "entry" || mode === "water") {
    const orderedIds = new Set(analysis.entryTree.map((node) => node.functionId ?? node.id));
    const ordered = [
      ...analysis.entryTree
        .map((node) => functions.find((fn) => fn.id === (node.functionId ?? node.id)))
        .filter((fn): fn is FunctionInfo => Boolean(fn)),
      ...functions.filter((fn) => !orderedIds.has(fn.id)),
    ];
    return ordered.map((fn, index) => ({
      id: fn.id,
      fn,
      x: 48 + (index % 4) * 282,
      y: 42 + Math.floor(index / 4) * 126,
    }));
  }

  const incoming = new Map<string, number>();
  edges.forEach((edge) => incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1));

  const groups = new Map<string, FunctionInfo[]>();
  functions.forEach((fn) => {
    const group =
      mode === "folders"
        ? fn.fileName.split("/").slice(0, -1).join("/") || "root"
        : mode === "fsm"
          ? fn.category
          : String(Math.min(incoming.get(fn.id) ?? 0, 3));
    groups.set(group, [...(groups.get(group) ?? []), fn]);
  });

  const columns = Array.from(groups.values());
  return columns.flatMap((column, columnIndex) =>
    column.map((fn, rowIndex) => ({
      id: fn.id,
      fn,
      x: 48 + columnIndex * 282,
      y: 42 + rowIndex * 126,
    })),
  );
}

export function buildTrace(
  selected: FunctionInfo | null,
  functions: FunctionInfo[],
  edges: GraphEdge[],
  breakpoints: Set<string>,
) {
  if (!selected) return [];
  const map = new Map(functions.map((fn) => [fn.id, fn]));
  const visited = new Set<string>();
  const trace: { id: string; name: string; note: string; stop: boolean }[] = [];

  function walk(id: string) {
    const fn = map.get(id);
    if (!fn || visited.has(id)) return;
    visited.add(id);
    const stop = breakpoints.has(id);
    trace.push({
      id,
      name: fn.name,
      note: stop
        ? "命中断点，暂停在函数入口"
        : `${classifyFlowRole(fn)}：输入 ${fn.params.length || fn.externalInputs.length || 0} 项，输出 ${fn.outputs.join(", ")}`,
      stop,
    });
    if (stop) return;
    edges.filter((edge) => edge.from === id).forEach((edge) => walk(edge.to));
  }

  walk(selected.id);
  return trace.length ? trace : [{ id: selected.id, name: selected.name, note: "无下游调用，单函数执行结束", stop: false }];
}

export function classifyFlowRole(fn: FunctionInfo): FlowNode["role"] {
  if (fn.risks.includes("堵塞/无限循环")) return "堵塞";
  if (fn.risks.includes("溢流风险")) return "溢流";
  if (/recursive|recurse/i.test(fn.name) || fn.calls.includes(fn.id)) return "回流";
  if (fn.validations.length) return "阀门";
  if (fn.sideEffects.includes("缓存/容器") || fn.sideEffects.includes("状态写入")) return "水箱";
  if (fn.sideEffects.includes("异步/调度")) return "泵";
  if (fn.externalInputs.length || fn.category === "输入") return "水源";
  if (fn.outputs.length && !fn.outputs.includes("state change/void")) return "排水口";
  return "管道";
}

export function inferNodeCapacity(node: FlowNode): NonNullable<FlowNode["capacity"]> {
  if (node.capacity) return node.capacity;
  if (node.role === "水箱" || node.role === "溢流") return "湖";
  if (node.role === "泵" || node.role === "回流") return "水池";
  if (node.role === "管道" || node.role === "排水口") return "河道";
  return "小溪";
}

export function capacityScore(capacity: NonNullable<FlowNode["capacity"]>) {
  if (capacity === "湖") return 92;
  if (capacity === "水库") return 84;
  if (capacity === "水池") return 70;
  if (capacity === "河道") return 52;
  return 32;
}

export function nodeConfidence(node: FlowNode) {
  if (typeof node.confidence === "number") return node.confidence;
  if (node.status === "Closed") return 86;
  if (node.status === "Partially Closed") return 72;
  if (node.status === "Unknown") return 54;
  return 64;
}

export function confidenceClass(confidence: number) {
  if (confidence < 60) return "confidence-low";
  if (confidence < 75) return "confidence-mid";
  return "confidence-high";
}

export function capacityClass(capacity: NonNullable<FlowNode["capacity"]>) {
  if (capacity === "湖") return "capacity-lake";
  if (capacity === "水库") return "capacity-reservoir";
  if (capacity === "水池") return "capacity-pond";
  if (capacity === "河道") return "capacity-river";
  return "capacity-creek";
}

export function flowRoleClass(role: FlowNode["role"]) {
  const classMap: Record<FlowNode["role"], string> = {
    水源: "role-source",
    管道: "role-pipe",
    阀门: "role-valve",
    水箱: "role-tank",
    泵: "role-pump",
    排水口: "role-outlet",
    漏点: "role-leak",
    堵塞: "role-blocked",
    溢流: "role-overflow",
    回流: "role-reflux",
  };
  return classMap[role];
}

export function buildDefaultWaterDetails(node: FlowNode) {
  const details = [
    `节点状态：${node.status}`,
    `容量依据：${node.capacity ?? inferNodeCapacity(node)} 表示该节点在当前水路中的承载级别。`,
    `置信度来源：${node.confidence ? "规则评分与证据数量" : "状态默认评分"}。`,
  ];
  if (nodeConfidence(node) < 70) {
    details.push("置信度低：需要 Tree-sitter、LSP 或运行测试补充证据。");
  }
  if (node.status === "Open") {
    details.push("水路开放：可能缺少返回、验证、错误处理或闭环出口。");
  }
  if (node.status === "Overflow Risk") {
    details.push("容量风险：应检查上限、背压、清理策略和峰值记录。");
  }
  if (node.status === "Blocked") {
    details.push("堵塞风险：断点、无限循环或阻塞调用可能改变不同输入的走向。");
  }
  if (node.upstreamIds?.length || node.downstreamIds?.length) {
    details.push(`水系关系：上游 ${node.upstreamIds?.length ?? 0} 个，下游 ${node.downstreamIds?.length ?? 0} 个。`);
  }
  return details;
}

function findMainControlFile(files: CodeFile[], functions: FunctionInfo[]) {
  if (!files.length) return null;
  const byFile = new Map(files.map((file) => [file.id, file]));
  const functionCount = functions.reduce<Record<string, number>>((acc, fn) => {
    acc[fn.fileId] = (acc[fn.fileId] ?? 0) + 1;
    return acc;
  }, {});

  return [...files].sort((a, b) => scoreMainFile(b, functionCount[b.id] ?? 0) - scoreMainFile(a, functionCount[a.id] ?? 0))[0] ?? byFile.values().next().value ?? null;
}

function scoreMainFile(file: CodeFile, functionCount: number) {
  const name = file.name.toLowerCase();
  let score = functionCount * 3;
  if (/(^|\/)(main|index|app|server|cli|controller|pipeline|workflow)\.(ts|tsx|js|jsx|py|go|rs|java|cs)$/.test(name)) score += 34;
  if (/(package\.json|go\.mod|cargo\.toml|pyproject\.toml)$/.test(name)) score += 8;
  if (/\b(start|run|init|bootstrap|listen|analyze|execute|main)\b/.test(file.content.toLowerCase())) score += 18;
  if (/\bimport\b|\brequire\(|from\s+\w+\s+import/.test(file.content)) score += 7;
  return score;
}

function findEntryFunction(mainFile: CodeFile | null, functions: FunctionInfo[], edges: GraphEdge[]) {
  if (!functions.length) return null;
  const candidatePool = mainFile ? functions.filter((fn) => fn.fileId === mainFile.id) : functions;
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  edges.forEach((edge) => {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
  });
  const pool = candidatePool.length ? candidatePool : functions;
  return [...pool].sort((a, b) => scoreEntryFunction(b, incoming, outgoing) - scoreEntryFunction(a, incoming, outgoing))[0] ?? null;
}

function scoreEntryFunction(fn: FunctionInfo, incoming: Map<string, number>, outgoing: Map<string, number>) {
  const lower = fn.name.toLowerCase();
  let score = (outgoing.get(fn.id) ?? 0) * 12 - (incoming.get(fn.id) ?? 0) * 4;
  if (/\b(main|start|run|init|bootstrap|analyze|execute|handler|controller)\b/.test(lower)) score += 30;
  if (fn.externalInputs.length) score += 12;
  if (fn.category === "输入" || fn.category === "仿真") score += 8;
  return score;
}

function buildEntryTree(
  entry: FunctionInfo | null,
  functions: FunctionInfo[],
  edges: GraphEdge[],
  breakpoints: Set<string>,
) {
  if (!entry) {
    return [{ id: "empty", name: "未识别入口", role: "漏点", status: "Unknown", note: "需要导入项目或补充主控文件。" }] satisfies FlowNode[];
  }

  const map = new Map(functions.map((fn) => [fn.id, fn]));
  const visited = new Set<string>();
  const nodes: FlowNode[] = [];

  function walk(id: string, depth: number) {
    const fn = map.get(id);
    if (!fn || visited.has(id) || depth > 9) return;
    visited.add(id);
    const downstreamIds = edges.filter((edge) => edge.from === id).map((edge) => edge.to);
    const upstreamIds = edges.filter((edge) => edge.to === id).map((edge) => edge.from);
    nodes.push({
      id,
      functionId: id,
      name: `${"· ".repeat(depth)}${fn.name}`,
      role: classifyFlowRole(fn),
      status: statusForFunction(fn, breakpoints, downstreamIds.length),
      note: `${fn.fileName}:${fn.startLine} · ${fn.calls.length} 个下游调用`,
      depth,
      upstreamIds,
      downstreamIds,
    });
    edges.filter((edge) => edge.from === id).forEach((edge) => walk(edge.to, depth + 1));
  }

  walk(entry.id, 0);
  return nodes.length ? nodes : [{ id: entry.id, name: entry.name, role: classifyFlowRole(entry), status: "Unknown", note: "入口函数没有发现下游调用。" }];
}

function buildWaterSystem(
  functions: FunctionInfo[],
  entryTree: FlowNode[],
  graphEdges: GraphEdge[],
  breakpoints: Set<string>,
  runtimeExecutions: ControlledRuntimeExecutionReport[],
) {
  const visibleFunctions = selectNetworkFunctions(functions, entryTree, graphEdges);
  const visibleIds = new Set(visibleFunctions.map((fn) => fn.id));
  const aggregateGroups = buildFunctionBasinGroups(functions.filter((fn) => !visibleIds.has(fn.id)));
  const visualNodeIdByFunctionId = new Map(visibleFunctions.map((fn) => [fn.id, fn.id]));
  aggregateGroups.forEach((group) => group.functions.forEach((fn) => visualNodeIdByFunctionId.set(fn.id, group.id)));
  const mainPathIds = buildMainChannelIds(visibleFunctions, entryTree, graphEdges);
  const mainIdSet = new Set(mainPathIds);
  const primaryPairs = new Set(mainPathIds.slice(0, -1).map((id, index) => `${id}->${mainPathIds[index + 1]}`));
  const functionPositions = layoutWaterFunctions(visibleFunctions, graphEdges, mainPathIds);
  const nodes: FlowNode[] = visibleFunctions.map((fn) => {
    const position = functionPositions.get(fn.id) ?? { x: 540, y: 330, depth: 2 };
    const downstreamIds = graphEdges.filter((edge) => edge.from === fn.id).map((edge) => edge.to);
    const upstreamIds = graphEdges.filter((edge) => edge.to === fn.id).map((edge) => edge.from);
    const role = classifyFlowRole(fn);
    const status = statusForFunction(fn, breakpoints, downstreamIds.length);
    const capacity = inferFunctionCapacity(fn, upstreamIds.length, downstreamIds.length);

    return enrichFlowNode({
      id: fn.id,
      functionId: fn.id,
      name: fn.name,
      role,
      status,
      note: `${fn.fileName}:${fn.startLine} · 输入 ${fn.params.length || fn.externalInputs.length || 0} · 输出 ${fn.outputs.join(", ")}`,
      capacity,
      confidence: fn.confidence,
      evidence: `${fn.source} · ${fn.parseEvidence?.slice(-2).join(" · ") || "function signature"}`,
      details: [
        `上游节点：${upstreamIds.length} 个。`,
        `下游节点：${downstreamIds.length} 个。`,
        `数据形态：${fn.dataShape}。`,
        `解析层：${fn.parser ?? "Local ParserAdapter"}。`,
        ...buildFunctionDiagnosticDetails(fn, status, breakpoints, downstreamIds.length),
        ...buildFunctionRuleBindingDetails(fn),
      ],
      x: position.x,
      y: position.y,
      depth: position.depth,
      visualKind: "function",
      basin: inferFunctionBasin(fn),
      elevation: Math.max(8, 100 - position.depth * 10),
      upstreamIds,
      downstreamIds,
    });
  });
  aggregateGroups.forEach((group, index) => {
    const confidence = Math.round(group.functions.reduce((sum, fn) => sum + fn.confidence, 0) / group.functions.length);
    nodes.push(enrichFlowNode({
      id: group.id,
      name: `${group.label} (${group.functions.length})`,
      role: "水箱",
      status: group.functions.some((fn) => fn.risks.length) ? "Partially Closed" : "Closed",
      note: `大型项目聚合节点，完整保存 ${group.functions.length} 个函数及其语义关系。`,
      capacity: group.functions.length >= 12 ? "湖" : "水库",
      confidence,
      evidence: `visual basin aggregation · ${group.functions.length} functions · semantic graph preserved`,
      details: [
        `流域：${group.label}。`,
        `聚合函数：${group.functions.map((fn) => fn.name).slice(0, 18).join("、")}${group.functions.length > 18 ? "等" : ""}。`,
        "该节点只压缩图面；函数、调用、参数、返回值和污点路径仍保存在语义层。",
      ],
      x: 540 + index * 24,
      y: 330 + index * 96,
      depth: 2,
      visualKind: "basin",
      basin: group.label,
      elevation: 50,
      aggregateMemberIds: group.functions.map((fn) => fn.id),
      aggregateMemberNames: group.functions.map((fn) => fn.name),
      upstreamIds: [],
      downstreamIds: [],
    }));
  });
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edges: FlowEdge[] = [];
  const edgeIndexByPair = new Map<string, number>();
  const addEdge = (edge: FlowEdge) => {
    const semanticId = `${edge.from}->${edge.to}`;
    if (edge.from === edge.to) return;
    const existingIndex = edgeIndexByPair.get(semanticId);
    if (existingIndex !== undefined) {
      const existing = edges[existingIndex];
      edges[existingIndex] = {
        ...existing,
        primary: existing.primary || edge.primary,
        volume: Math.min(100, Math.max(existing.volume, edge.volume) + 4),
        confidence: Math.max(existing.confidence, edge.confidence),
        visualRelationCount: (existing.visualRelationCount ?? 1) + (edge.visualRelationCount ?? 1),
        evidence: `${existing.evidence} · 聚合 ${(existing.visualRelationCount ?? 1) + (edge.visualRelationCount ?? 1)} 条语义关系`,
      };
      return;
    }
    edgeIndexByPair.set(semanticId, edges.length);
    edges.push(edge);
  };

  mainPathIds.slice(0, -1).forEach((id, index) => {
    const from = nodeMap.get(id);
    const to = nodeMap.get(mainPathIds[index + 1]);
    if (!from || !to) return;
    addEdge(
      makeFlowEdge(
        id,
        to.id,
        edgeKindFromNodes(from, to) === "小溪" ? "水路" : "河流",
        mergeEdgeStatus(from.status, to.status),
        Math.round(((from.capacityScore ?? 64) + (to.capacityScore ?? 64)) / 2) + 10,
        Math.min(from.confidence ?? 74, to.confidence ?? 74),
        edgeEvidenceForNodes("main data channel from controller order", from, to),
        true,
      ),
    );
  });

  graphEdges.forEach((edge) => {
      const visualFrom = visualNodeIdByFunctionId.get(edge.from);
      const visualTo = visualNodeIdByFunctionId.get(edge.to);
      if (!visualFrom || !visualTo || visualFrom === visualTo) return;
      const pairId = `${edge.from}->${edge.to}`;
      if (primaryPairs.has(pairId)) return;
      if (mainIdSet.has(edge.from) && mainIdSet.has(edge.to)) return;
      const from = nodeMap.get(visualFrom);
      const to = nodeMap.get(visualTo);
      if (!from || !to) return;
      const isLoop = isCycleEdge(edge, graphEdges);
      const kind = isLoop ? "闭环线路" : edgeKindFromNodes(from, to);
      const status = isLoop ? "Partially Closed" : mergeEdgeStatus(from.status, to.status);
      addEdge(
        makeFlowEdge(
          visualFrom,
          visualTo,
          kind,
          status,
          Math.round(((from.capacityScore ?? 52) + (to.capacityScore ?? 52)) / 2),
          Math.min(from.confidence ?? 72, to.confidence ?? 72, edge.confidence ?? 78),
          edgeEvidenceForNodes(edge.evidence ?? "function call edge", from, to),
        ),
      );
    });

  if (!edges.length && nodes.length > 1) {
    nodes.slice(0, -1).forEach((from, index) => {
      const to = nodes[index + 1];
      addEdge(
        makeFlowEdge(
          from.id,
          to.id,
          "水路",
          "Unknown",
          28,
          46,
          "low-confidence lexical order fallback",
          index === 0,
        ),
      );
    });
  }

  nodes.forEach((node) => {
    node.upstreamIds = edges.filter((edge) => edge.to === node.id).map((edge) => edge.from);
    node.downstreamIds = edges.filter((edge) => edge.from === node.id).map((edge) => edge.to);
  });

  const taintFlow = buildSourceToSinkTaintReport(functions, graphEdges, runtimeExecutions);
  const visualTaintReport = {
    ...taintFlow,
    paths: taintFlow.paths.map((path) => ({
      ...path,
      edgePairs: Array.from(new Set(path.edgePairs.flatMap((pair) => {
        const [from, to] = pair.split("->");
        const visualFrom = visualNodeIdByFunctionId.get(from);
        const visualTo = visualNodeIdByFunctionId.get(to);
        return visualFrom && visualTo && visualFrom !== visualTo ? [`${visualFrom}->${visualTo}`] : [];
      }))),
    })),
  };
  const preciseEdges = annotateEdgesWithTaint(
    edges.map((edge) => enrichPreciseDataFlow(edge, functions, graphEdges, runtimeExecutions)),
    visualTaintReport,
  );
  const flowAlignedNodes = alignWaterNodesToFlow(nodes.map(enrichFlowNode), preciseEdges);
  const readableNodes = relaxWaterNodePositions(flowAlignedNodes);
  return { nodes: readableNodes.map(enrichFlowNode), edges: preciseEdges, taintFlow };
}

function buildHydrologyModel(
  functions: FunctionInfo[],
  graphEdges: GraphEdge[],
  flowNodes: FlowNode[],
  entryFunction: FunctionInfo | null,
  breakpoints: Set<string>,
): HydrologyModelReport {
  const incoming = countEdges(graphEdges, "to");
  const outgoing = countEdges(graphEdges, "from");
  const nodeMap = new Map(flowNodes.map((node) => [node.functionId ?? node.id, node]));
  const orderedFunctions = orderFunctionsByDataFlow(functions, graphEdges, entryFunction?.id);
  const stages = orderedFunctions.map((fn, index) => {
    const upstreamCount = incoming.get(fn.id) ?? 0;
    const downstreamCount = outgoing.get(fn.id) ?? 0;
    const node = nodeMap.get(fn.id);
    const status = node?.status ?? statusForFunction(fn, breakpoints, downstreamCount);
    const codeRole = classifyHydrologyCodeRole(fn, upstreamCount, downstreamCount, entryFunction?.id, status);
    const waterRole = hydrologyWaterRoleFor(codeRole);
    const capacity = node?.capacity ?? inferFunctionCapacity(fn, upstreamCount, downstreamCount);
    const confidence = node?.confidence ?? fn.confidence;

    return {
      id: `hydrology-stage-${fn.id}`,
      functionId: fn.id,
      functionName: fn.name,
      fileName: fn.fileName,
      line: fn.startLine,
      index: index + 1,
      codeRole,
      waterRole,
      capacity,
      dataIn: hydrologyDataIn(fn, upstreamCount),
      dataOut: hydrologyDataOut(fn, downstreamCount),
      upstreamCount,
      downstreamCount,
      confidence,
      riskLevel: hydrologyRiskLevel(fn, status, confidence),
      evidence: hydrologyEvidence(fn, upstreamCount, downstreamCount, node),
    };
  });

  const confluences: HydrologyConfluence[] = stages
    .filter((stage) => stage.upstreamCount > 1 || stage.downstreamCount > 1 || stage.waterRole === "湖泊/水库")
    .map((stage) => ({
      id: `hydrology-confluence-${stage.functionId}`,
      name: stage.functionName,
      functionId: stage.functionId,
      fileName: stage.fileName,
      waterRole: confluenceRoleFor(stage),
      upstreamCount: stage.upstreamCount,
      downstreamCount: stage.downstreamCount,
      capacity: stage.capacity,
      riskLevel: stage.riskLevel,
      confidence: stage.confidence,
      evidence: `${stage.codeRole} · 上游 ${stage.upstreamCount} · 下游 ${stage.downstreamCount} · ${stage.evidence}`,
    }))
    .sort((a, b) => {
      const riskDelta = riskWeight(b.riskLevel) - riskWeight(a.riskLevel);
      if (riskDelta !== 0) return riskDelta;
      return b.upstreamCount + b.downstreamCount - (a.upstreamCount + a.downstreamCount);
    });

  const outputNames = stages
    .filter((stage) => stage.codeRole === "结果输出" || (!stage.downstreamCount && stage.dataOut.some((item) => item !== "未识别返回")))
    .map((stage) => stage.functionName)
    .slice(0, 6);
  const storageCount = stages.filter((stage) => stage.waterRole === "湖泊/水库").length;
  const riskCount = stages.filter((stage) => stage.riskLevel !== "none").length;
  const entryName = entryFunction?.name ?? stages[0]?.functionName ?? "未识别入口";

  return {
    entryName,
    outputNames,
    stageCount: stages.length,
    confluenceCount: confluences.length,
    storageCount,
    riskCount,
    summary: buildHydrologySummary(entryName, outputNames, stages.length, confluences.length, storageCount, riskCount),
    analogy: [
      {
        codeSignal: "主控入口和入参采集",
        waterSignal: "源头与入水口",
        visualRule: "放在主河道起点，后续水路按调用和数据传递向右展开。",
      },
      {
        codeSignal: "函数调用和返回值传递",
        waterSignal: "水路、溪流、河流",
        visualRule: "通行量越高线越粗；主控路径是主河道，分支用溪流汇入。",
      },
      {
        codeSignal: "数组、List、Map、缓存、队列、状态写入",
        waterSignal: "湖泊/水库",
        visualRule: "节点面积更大，表示容量、聚合和暂存压力。",
      },
      {
        codeSignal: "多个上游或多个下游",
        waterSignal: "溪流汇聚口或分岔溪口",
        visualRule: "用汇聚线组织支流，避免复杂项目变成线团。",
      },
      {
        codeSignal: "低置信、缺验证、断点、异常或入侵风险",
        waterSignal: "警戒水段",
        visualRule: "不新增假节点，只在真实函数或真实水路上加颜色和感叹号。",
      },
    ],
    stages,
    confluences,
  };
}

function orderFunctionsByDataFlow(
  functions: FunctionInfo[],
  graphEdges: GraphEdge[],
  entryId?: string,
) {
  const functionMap = new Map(functions.map((fn) => [fn.id, fn]));
  const outgoing = new Map<string, string[]>();
  graphEdges.forEach((edge) => {
    if (!functionMap.has(edge.from) || !functionMap.has(edge.to)) return;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  });

  const visited = new Set<string>();
  const ordered: FunctionInfo[] = [];
  const queue = entryId && functionMap.has(entryId) ? [entryId] : functions.slice(0, 1).map((fn) => fn.id);

  while (queue.length) {
    const id = queue.shift();
    if (!id || visited.has(id)) continue;
    const fn = functionMap.get(id);
    if (!fn) continue;
    visited.add(id);
    ordered.push(fn);
    (outgoing.get(id) ?? [])
      .filter((nextId) => !visited.has(nextId))
      .forEach((nextId) => queue.push(nextId));
  }

  const remaining = functions
    .filter((fn) => !visited.has(fn.id))
    .sort((a, b) => {
      const fileDelta = a.fileName.localeCompare(b.fileName);
      if (fileDelta !== 0) return fileDelta;
      return a.startLine - b.startLine;
    });

  return [...ordered, ...remaining];
}

function classifyHydrologyCodeRole(
  fn: FunctionInfo,
  upstreamCount: number,
  downstreamCount: number,
  entryId: string | undefined,
  status: FlowNode["status"],
): HydrologyCodeRole {
  if (fn.id === entryId) return "主控入口";
  if (status === "Blocked" || status === "Overflow Risk" || fn.risks.length) return "异常边界";
  if (fn.externalInputs.length || fn.category === "输入") return "入参采集";
  if (fn.validations.length) return "净化过滤";
  if (fn.sideEffects.includes("缓存/容器") || fn.sideEffects.includes("状态写入")) return "容量存储";
  if (upstreamCount > 1) return "汇聚合并";
  if (downstreamCount > 1 || fn.sideEffects.includes("异步/调度")) return "分流调度";
  if (!downstreamCount && hasRealOutput(fn)) return "结果输出";
  return "转换处理";
}

function hydrologyWaterRoleFor(codeRole: HydrologyCodeRole): HydrologyWaterRole {
  const roleMap: Record<HydrologyCodeRole, HydrologyWaterRole> = {
    主控入口: "源头",
    入参采集: "入水口",
    净化过滤: "净化池",
    转换处理: "主河道",
    分流调度: "分岔溪口",
    汇聚合并: "溪流汇聚口",
    容量存储: "湖泊/水库",
    结果输出: "出水口",
    异常边界: "警戒水段",
  };
  return roleMap[codeRole];
}

function hydrologyDataIn(fn: FunctionInfo, upstreamCount: number) {
  const values = [...fn.params, ...fn.externalInputs];
  if (values.length) return Array.from(new Set(values)).slice(0, 4);
  if (upstreamCount) return [`${upstreamCount} 个上游输出`];
  return ["无显式输入"];
}

function hydrologyDataOut(fn: FunctionInfo, downstreamCount: number) {
  const realOutputs = fn.outputs.filter((output) => output !== "void" && output !== "state change/void");
  if (realOutputs.length) return realOutputs.slice(0, 4);
  if (fn.sideEffects.length) return fn.sideEffects.slice(0, 4);
  if (downstreamCount) return [`传递到 ${downstreamCount} 个下游`];
  return ["未识别返回"];
}

function hydrologyRiskLevel(
  fn: FunctionInfo,
  status: FlowNode["status"],
  confidence: number,
): HydrologyRiskLevel {
  if (status === "Blocked") return "critical";
  if (fn.risks.some((risk) => ["外部代码注入", "命令执行风险", "SQL 注入风险", "路径穿越风险"].includes(risk))) {
    return "critical";
  }
  if (status === "Overflow Risk" || status === "Open" || fn.risks.length || confidence < 60) return "risk";
  if (status === "Partially Closed" || confidence < 75 || (fn.externalInputs.length && !fn.validations.length)) return "warn";
  return "none";
}

function hydrologyEvidence(
  fn: FunctionInfo,
  upstreamCount: number,
  downstreamCount: number,
  node?: FlowNode,
) {
  const evidence = [
    `${fn.fileName}:${fn.startLine}`,
    `入度 ${upstreamCount}`,
    `出度 ${downstreamCount}`,
    fn.parser ?? fn.source,
  ];
  if (node?.evidence) evidence.push(node.evidence);
  return evidence.join(" · ");
}

function confluenceRoleFor(stage: HydrologyConfluence | { waterRole: HydrologyWaterRole; upstreamCount: number; downstreamCount: number }) {
  if (stage.waterRole === "湖泊/水库") return "湖泊/水库";
  if (stage.upstreamCount > 1) return "溪流汇聚口";
  return "分岔溪口";
}

function riskWeight(level: HydrologyRiskLevel) {
  if (level === "critical") return 4;
  if (level === "risk") return 3;
  if (level === "warn") return 2;
  return 1;
}

function buildHydrologySummary(
  entryName: string,
  outputNames: string[],
  stageCount: number,
  confluenceCount: number,
  storageCount: number,
  riskCount: number,
) {
  const outputs = outputNames.length ? outputNames.join("、") : "尚未识别清晰输出口";
  return `主控数据从 ${entryName} 进入，经过 ${stageCount} 个函数水段、${confluenceCount} 个溪流汇聚/分流点和 ${storageCount} 个容量节点，最后流向 ${outputs}。当前有 ${riskCount} 个节点需要颜色警戒或补证据。`;
}

function countEdges(edges: GraphEdge[], key: "from" | "to") {
  const counts = new Map<string, number>();
  edges.forEach((edge) => counts.set(edge[key], (counts.get(edge[key]) ?? 0) + 1));
  return counts;
}

function selectNetworkFunctions(
  functions: FunctionInfo[],
  entryTree: FlowNode[],
  graphEdges: GraphEdge[],
) {
  if (functions.length <= 36) return functions;

  const entryIds = new Set(entryTree.map((node) => node.functionId ?? node.id));
  const incoming = countEdges(graphEdges, "to");
  const outgoing = countEdges(graphEdges, "from");

  return [...functions]
    .sort((a, b) => functionNetworkScore(b, entryIds, incoming, outgoing) - functionNetworkScore(a, entryIds, incoming, outgoing))
    .slice(0, 36);
}

function buildFunctionBasinGroups(functions: FunctionInfo[]) {
  const groups = new Map<string, FunctionInfo[]>();
  functions.forEach((fn) => {
    const label = inferFunctionBasin(fn);
    groups.set(label, [...(groups.get(label) ?? []), fn]);
  });
  return Array.from(groups.entries())
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([label, groupedFunctions], index) => ({
      id: `basin:${index}:${label.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")}`,
      label,
      functions: groupedFunctions,
    }));
}

function inferFunctionBasin(fn: FunctionInfo) {
  const signals = `${fn.name} ${fn.summary} ${fn.category} ${fn.fileName}`.toLowerCase();
  if (/auth|login|token|permission|security|validate|sanitize/.test(signals)) return "安全与校验";
  if (/parse|parser|syntax|ast|compiler|lsp|language/.test(signals)) return "解析与语言";
  if (/database|repository|crud|sql|sqlite|model|schema/.test(signals)) return "数据与存储";
  if (/runtime|sandbox|process|execute|runner|trace|debug/.test(signals)) return "运行与调试";
  if (/task|job|schedule|queue|reminder/.test(signals)) return "任务与调度";
  if (/project|workspace|file|folder|import/.test(signals)) return "项目与文件";
  if (/render|view|page|component|ui|display/.test(signals)) return "界面与输出";
  if (/graph|flow|water|hydrology|edge|node/.test(signals)) return "图谱与数据流";
  const directory = fn.fileName.split("/").slice(-2, -1)[0];
  return directory ? `${directory} 模块` : "通用处理";
}

function functionNetworkScore(
  fn: FunctionInfo,
  entryIds: Set<string>,
  incoming: Map<string, number>,
  outgoing: Map<string, number>,
) {
  let score = 0;
  if (entryIds.has(fn.id)) score += 80;
  if ((incoming.get(fn.id) ?? 0) === 0) score += 24;
  if (fn.externalInputs.length) score += 28;
  if (hasRealOutput(fn)) score += 18;
  if (fn.validations.length) score += 16;
  if (fn.risks.length) score += 22;
  score += ((incoming.get(fn.id) ?? 0) + (outgoing.get(fn.id) ?? 0)) * 6;
  score += Math.min(12, fn.complexity);
  return score;
}

function buildMainChannelIds(
  functions: FunctionInfo[],
  entryTree: FlowNode[],
  graphEdges: GraphEdge[],
) {
  const visibleIds = new Set(functions.map((fn) => fn.id));
  const entryId = entryTree.map((node) => node.functionId ?? node.id).find((id) => visibleIds.has(id)) ?? functions[0]?.id;
  if (!entryId) return [];

  const entryFn = functions.find((fn) => fn.id === entryId);
  const orderedCalls = (entryFn?.calls ?? []).filter((id) => visibleIds.has(id));
  if (orderedCalls.length >= 2) return [entryId, ...orderedCalls].slice(0, 9);

  const outgoing = new Map<string, string[]>();
  graphEdges.forEach((edge) => {
    if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) return;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  });

  const bestPath = walkLongestPath(entryId, outgoing, new Set<string>());
  return bestPath.length ? bestPath.slice(0, 9) : [entryId];
}

function walkLongestPath(
  id: string,
  outgoing: Map<string, string[]>,
  visited: Set<string>,
): string[] {
  if (visited.has(id)) return [id];
  const nextVisited = new Set(visited);
  nextVisited.add(id);
  const branches = outgoing.get(id) ?? [];
  if (!branches.length) return [id];

  const bestBranch = branches
    .map((next) => walkLongestPath(next, outgoing, nextVisited))
    .sort((a, b) => b.length - a.length)[0] ?? [];
  return [id, ...bestBranch.filter((nextId) => nextId !== id)];
}

function layoutWaterFunctions(
  functions: FunctionInfo[],
  graphEdges: GraphEdge[],
  mainPathIds: string[],
) {
  const mainChannelIds = mainPathIds.length ? mainPathIds : functions.slice(0, 1).map((fn) => fn.id);
  const mainOrder = new Map(mainChannelIds.map((id, index) => [id, index]));
  const depth = buildFunctionDepths(functions, graphEdges, mainChannelIds);
  const fileOrder = buildFileLaneOrder(functions, mainChannelIds);
  const fileIndex = new Map(fileOrder.map((fileName, index) => [fileName, index]));
  const maxDepth = Math.max(1, ...Array.from(depth.values()));
  const columnCount = Math.max(2, Math.min(8, maxDepth + 1));
  const columnStep = columnCount > 1 ? 988 / (columnCount - 1) : 0;
  const laneBuckets = new Map<string, FunctionInfo[]>();
  const fileHeights = new Map<string, number>();
  const positions = new Map<string, { x: number; y: number; depth: number }>();

  functions.forEach((fn, index) => {
    const column = columnForDepth(depth.get(fn.id) ?? index, maxDepth, columnCount);
    const key = `${fn.fileName}:${column}`;
    laneBuckets.set(key, [...(laneBuckets.get(key) ?? []), fn]);
  });

  fileOrder.forEach((fileName) => {
    const maxStack = Math.max(
      1,
      ...Array.from(laneBuckets.entries())
        .filter(([key]) => key.startsWith(`${fileName}:`))
        .map(([, bucket]) => bucket.length),
    );
    fileHeights.set(fileName, Math.max(118, maxStack * 76 + 42));
  });

  let laneTop = 92;
  fileOrder.forEach((fileName) => {
    const laneHeight = fileHeights.get(fileName) ?? 126;
    const laneCenter = laneTop + laneHeight / 2;
    const fileFunctions = functions.filter((fn) => fn.fileName === fileName);
    const columns = new Map<number, FunctionInfo[]>();

    fileFunctions.forEach((fn, index) => {
      const column = columnForDepth(depth.get(fn.id) ?? index, maxDepth, columnCount);
      columns.set(column, [...(columns.get(column) ?? []), fn]);
    });

    Array.from(columns.entries()).forEach(([column, bucket]) => {
      const sortedBucket = [...bucket].sort((a, b) => {
        const mainDelta = (mainOrder.get(a.id) ?? 99) - (mainOrder.get(b.id) ?? 99);
        if (mainDelta !== 0) return mainDelta;
        return a.startLine - b.startLine;
      });

      sortedBucket.forEach((fn, index) => {
        const stackOffset = (index - (sortedBucket.length - 1) / 2) * 76;
        const fileLane = fileIndex.get(fn.fileName) ?? 0;
        const xJitter = sortedBucket.length > 1 ? ((index % 2) - 0.5) * 18 : 0;
        positions.set(fn.id, {
          x: clampMapX(96 + column * columnStep + xJitter),
          y: Math.max(58, laneCenter + stackOffset),
          depth: depth.get(fn.id) ?? fileLane + 1,
        });
      });
    });

    laneTop += laneHeight + 52;
  });

  return positions;
}

function buildFunctionDepths(
  functions: FunctionInfo[],
  graphEdges: GraphEdge[],
  mainChannelIds: string[],
) {
  const visibleIds = new Set(functions.map((fn) => fn.id));
  const depth = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  graphEdges.forEach((edge) => {
    if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) return;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  });

  mainChannelIds.forEach((id, index) => {
    if (visibleIds.has(id)) depth.set(id, index);
  });

  const roots = mainChannelIds.length
    ? mainChannelIds
    : functions.filter((fn) => !graphEdges.some((edge) => edge.to === fn.id)).map((fn) => fn.id);
  roots.forEach((id) => {
    if (visibleIds.has(id) && !depth.has(id)) depth.set(id, 0);
  });

  for (let pass = 0; pass < Math.min(10, functions.length); pass += 1) {
    graphEdges.forEach((edge) => {
      const fromDepth = depth.get(edge.from);
      if (fromDepth === undefined || !visibleIds.has(edge.to)) return;
      const nextDepth = Math.min(9, fromDepth + 1);
      const currentDepth = depth.get(edge.to);
      if (currentDepth === undefined || nextDepth < currentDepth) {
        depth.set(edge.to, nextDepth);
      }
    });
  }

  functions.forEach((fn, index) => {
    if (!depth.has(fn.id)) depth.set(fn.id, Math.min(9, 1 + (index % 6)));
  });

  return depth;
}

function buildFileLaneOrder(functions: FunctionInfo[], mainChannelIds: string[]) {
  const mainSet = new Set(mainChannelIds);
  const fileScores = new Map<string, number>();

  functions.forEach((fn) => {
    let score = fileScores.get(fn.fileName) ?? 0;
    if (mainSet.has(fn.id)) score += 100;
    score += fn.externalInputs.length * 8;
    score += fn.calls.length * 4;
    score += fn.risks.length * 6;
    score += Math.min(8, fn.complexity);
    fileScores.set(fn.fileName, score);
  });

  return Array.from(new Set(functions.map((fn) => fn.fileName))).sort((a, b) => {
    const scoreDelta = (fileScores.get(b) ?? 0) - (fileScores.get(a) ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    return a.localeCompare(b);
  });
}

function columnForDepth(depth: number, maxDepth: number, columnCount: number) {
  if (columnCount <= 1) return 0;
  return Math.max(0, Math.min(columnCount - 1, Math.round((depth / Math.max(1, maxDepth)) * (columnCount - 1))));
}

function statusForFunction(
  fn: FunctionInfo,
  breakpoints: Set<string>,
  downstreamCount: number,
): FlowNode["status"] {
  if (breakpoints.has(fn.id) || fn.risks.includes("堵塞/无限循环")) return "Blocked";
  if (fn.risks.includes("溢流风险")) return "Overflow Risk";
  if (fn.risks.some((risk) => ["外部代码注入", "命令执行风险", "SQL 注入风险", "路径穿越风险"].includes(risk))) return "Blocked";
  if (fn.risks.length) return "Partially Closed";
  if (fn.externalInputs.length && !fn.validations.length && downstreamCount > 0) return "Partially Closed";
  if (hasRealOutput(fn) || downstreamCount > 0 || fn.validations.length) return "Closed";
  if (!downstreamCount && !hasRealOutput(fn)) return "Open";
  return "Unknown";
}

function inferFunctionCapacity(
  fn: FunctionInfo,
  upstreamCount: number,
  downstreamCount: number,
): NonNullable<FlowNode["capacity"]> {
  const text = `${fn.name} ${fn.returnType} ${fn.dataShape} ${fn.body}`.toLowerCase();
  if (fn.risks.includes("溢流风险")) return "湖";
  if (/\blist\b|list<|list\[/.test(text)) return "湖";
  if (/\barray\b|array<|\[\]|flatmap|\.map\(/.test(text)) return "水库";
  if (/\bbuffer\b|\bqueue\b|\bcache\b|map<|set<|new map|new set/.test(text)) return "湖";
  if (fn.sideEffects.includes("缓存/容器") || fn.sideEffects.includes("状态写入")) return "水库";
  if (fn.sideEffects.includes("异步/调度") || fn.complexity >= 6) return "水池";
  if (upstreamCount + downstreamCount >= 3 || hasRealOutput(fn)) return "河道";
  return "小溪";
}

function hasRealOutput(fn: FunctionInfo) {
  return fn.outputs.some((output) => output !== "state change/void" && output !== "void");
}

function buildFunctionDiagnosticDetails(
  fn: FunctionInfo,
  status: FlowNode["status"],
  breakpoints: Set<string>,
  downstreamCount: number,
) {
  const details: string[] = [];
  if (breakpoints.has(fn.id)) {
    details.push("诊断：当前函数设置了断点，仿真水路会在这里暂停。");
  }
  if (fn.externalInputs.length && !fn.validations.length && downstreamCount > 0) {
    details.push("诊断：外部输入进入下游前没有看到本地验证、权限或范围检查。");
  }
  if (fn.risks.length) {
    details.push(`诊断：命中 ${fn.risks.join("、")}。`);
  }
  if (status === "Open") {
    details.push("诊断：叶子函数没有清晰返回、响应、副作用出口或错误出口。");
  }
  if (fn.confidence < 70) {
    details.push("诊断：解析置信度偏低，需要 AST/LSP 或运行轨迹补证据。");
  }
  return details;
}

function buildFunctionRuleBindingDetails(fn: FunctionInfo) {
  const details = (fn.parseEvidence ?? [])
    .filter((item) => item.startsWith("规则命中："))
    .slice(0, 5)
    .map((item) => `规则证据：${item.replace("规则命中：", "")}。`);

  const repairs = repairHintsForRisks(fn.risks);
  if (repairs.length) {
    details.push(`修正建议：${repairs.join("；")}。`);
  }

  return details;
}

function repairHintsForRisks(risks: string[]) {
  const hints = risks.flatMap((risk) => {
    if (/sql|orm|注入/i.test(risk)) return ["使用参数绑定、ORM 安全查询构造器和输入白名单"];
    if (/命令|exec|system|外部代码/i.test(risk)) return ["固定命令白名单，禁止外部输入拼接到执行参数"];
    if (/路径|file|read/i.test(risk)) return ["把路径限制在工作目录内，并规范化后再访问"];
    if (/csrf/i.test(risk)) return ["写操作增加 CSRF token、SameSite、Origin/Referer 校验"];
    if (/cors/i.test(risk)) return ["使用明确 Origin 白名单，禁止 credentials 与通配组合"];
    if (/jwt/i.test(risk)) return ["校验签名、算法、issuer、audience、exp 和 nbf"];
    if (/锁|deadlock|并发/i.test(risk)) return ["统一锁顺序，缩小临界区，增加 tryLock/timeout"];
    if (/设备|硬件|watchdog|离线/i.test(risk)) return ["增加 heartbeat、重连、安全默认态和看门狗"];
    if (/溢流|容量/i.test(risk)) return ["设置容量上限、背压、分页或分块处理"];
    if (/超时|retry|重试/i.test(risk)) return ["增加 timeout、退避重试上限和失败出口"];
    return [];
  });
  return Array.from(new Set(hints)).slice(0, 4);
}

function edgeEvidenceForNodes(baseEvidence: string, from: FlowNode, to: FlowNode) {
  const signals = [from, to]
    .flatMap((node) => node.details ?? [])
    .filter((detail) => /规则证据|修正建议|诊断/.test(detail))
    .slice(0, 3);
  return signals.length ? `${baseEvidence} · ${signals.join(" · ")}` : baseEvidence;
}

function makeFlowEdge(
  from: string,
  to: string,
  kind: FlowEdge["kind"],
  status: FlowEdge["status"],
  volume: number,
  confidence: number,
  evidence: string,
  primary = false,
): FlowEdge {
  return {
    id: `${from}->${to}:${kind}`,
    from,
    to,
    kind,
    status,
    volume: Math.max(12, Math.min(96, volume)),
    confidence: Math.max(35, Math.min(96, confidence)),
    evidence,
    primary,
  };
}

function edgeKindFromNodes(from: FlowNode, to: FlowNode): FlowEdge["kind"] {
  if (from.capacity === "湖" || to.capacity === "湖" || from.capacity === "水库" || to.capacity === "水库") return "河流";
  if (from.capacity === "小溪" && to.capacity === "小溪") return "小溪";
  return "水路";
}

function mergeEdgeStatus(from: FlowNode["status"], to: FlowNode["status"]): FlowEdge["status"] {
  if (from === "Blocked" || to === "Blocked") return "Blocked";
  if (from === "Overflow Risk" || to === "Overflow Risk") return "Overflow Risk";
  if (from === "Open" || to === "Open") return "Open";
  if (from === "Unknown" || to === "Unknown") return "Unknown";
  if (from === "Partially Closed" || to === "Partially Closed") return "Partially Closed";
  return "Closed";
}

function isCycleEdge(edge: GraphEdge, edges: GraphEdge[]) {
  if (edge.from === edge.to) return true;
  const visited = new Set<string>();
  const stack = [edge.to];

  while (stack.length) {
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    if (current === edge.from) return true;
    edges
      .filter((candidate) => candidate.from === current && !(candidate.from === edge.from && candidate.to === edge.to))
      .forEach((candidate) => stack.push(candidate.to));
  }

  return false;
}

function enrichFlowNode(node: FlowNode): FlowNode {
  const capacity = node.capacity ?? inferNodeCapacity(node);
  const baseConfidence =
    node.confidence ??
    (node.status === "Closed"
      ? 88
      : node.status === "Partially Closed"
        ? 72
        : node.status === "Unknown"
          ? 54
          : node.status === "Open"
            ? 62
            : 66);

  return {
    ...node,
    capacity,
    capacityScore: node.capacityScore ?? capacityScore(capacity),
    confidence: Math.max(35, Math.min(96, baseConfidence)),
    evidence: node.evidence ?? `Rule Finding · ${node.role} · ${node.status}`,
    details: node.details ?? buildDefaultWaterDetails({ ...node, capacity, confidence: baseConfidence }),
  };
}

function buildSecurityIssues(functions: FunctionInfo[], flowNodes: FlowNode[]): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  const unvalidatedInput = functions.find((fn) => fn.externalInputs.length && !fn.validations.length);
  const openOutlet = flowNodes.find((node) => node.status === "Open");

  if (unvalidatedInput) {
    issues.push({
      id: "dam-unvalidated-input",
      title: "输入路径缺少验证",
      category: "security",
      severity: "High",
      status: "Likely",
      message: "发现外部输入路径，但没有看到足够的验证、权限或范围检查。",
      evidence: `${unvalidatedInput.fileName}:${unvalidatedInput.startLine} ${unvalidatedInput.name}()`,
      confidence: 74,
    });
  }

  if (openOutlet) {
    issues.push({
      id: "flow-open-outlet",
      title: "返回或异常出口未闭合",
      category: "flow",
      severity: "Medium",
      status: "Possible",
      message: "部分路径可能没有返回、响应或错误出口。",
      evidence: openOutlet.note,
      confidence: 66,
    });
  }

  functions.forEach((fn) => {
    fn.risks.forEach((risk) => {
      if (!["外部代码注入", "命令执行风险", "SQL 注入风险", "路径穿越风险"].includes(risk)) return;
      issues.push({
        id: `${fn.id}-${risk}`,
        title: risk,
        category: "security",
        severity: risk === "外部代码注入" || risk === "命令执行风险" ? "Critical" : "High",
        status: "Likely",
        message: "外部输入可能到达数据库、命令或文件操作；如果缺少参数绑定、输入白名单或权限检查，攻击者可能改变原本的执行行为。",
        evidence: `${fn.fileName}:${fn.startLine} ${fn.name}()`,
        confidence: 82,
      });
    });
  });

  return issues.slice(0, 8);
}

function buildTaintFlowIssues(report: ReturnType<typeof buildSourceToSinkTaintReport>): AnalysisIssue[] {
  return report.paths
    .filter((path) => path.status === "exposed")
    .sort((a, b) => b.confidence - a.confidence || b.functionIds.length - a.functionIds.length)
    .slice(0, 8)
    .map((path) => ({
      id: `source-to-sink-${path.id}`,
      title: `${taintSinkLabel(path.sinkKind)}存在可达输入路径`,
      category: "security" as const,
      severity: path.sinkKind === "command" || path.sinkKind === "dom" ? "Critical" as const : "High" as const,
      status: path.evidenceGrade === "runtime" ? "Confirmed" as const : "Likely" as const,
      message: `输入从 ${path.sourceFunctionName} 进入后，沿 ${path.functionIds.length} 个函数到达 ${path.sinkFunctionName}；当前路径没有识别到验证、净化或权限边界。`,
      evidence: `${path.evidenceGrade} · ${path.functionIds.join(" -> ")} · 数据 ${path.dataNames.join(", ") || "待补类型绑定"}`,
      confidence: path.confidence,
    }));
}

function taintSinkLabel(kind: ReturnType<typeof buildSourceToSinkTaintReport>["paths"][number]["sinkKind"]) {
  const labels = {
    sql: "SQL/数据库写入",
    command: "命令执行",
    dom: "DOM 输出",
    file: "文件写入",
    network: "网络发送",
    "database-write": "数据库写入",
    "shared-state": "共享状态写入",
    unknown: "敏感落点",
  };
  return labels[kind];
}

function buildElementConflicts(functions: FunctionInfo[]): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  const paramTypes = new Map<string, Set<string>>();

  functions.forEach((fn) => {
    fn.params.forEach((param) => {
      const [name, type] = param.split(":").map((part) => part.trim());
      if (!name) return;
      const normalizedType = type || "unknown";
      const current = paramTypes.get(name) ?? new Set<string>();
      current.add(normalizedType);
      paramTypes.set(name, current);
    });

    if (fn.externalInputs.length && !fn.validations.length) {
      issues.push({
        id: `${fn.id}-unvalidated-element`,
        title: "水中元素未净化",
        category: "flow",
        severity: "Medium",
        status: "Likely",
        message: "外部输入进入函数后没有发现验证节点，不同输入可能改变流向。",
        evidence: `${fn.fileName}:${fn.startLine} ${fn.name}()`,
        confidence: 72,
      });
    }
  });

  paramTypes.forEach((types, name) => {
    if (types.size > 2 || (types.has("unknown") && types.size > 1)) {
      issues.push({
        id: `param-conflict-${name}`,
        title: `数据元素 ${name} 类型冲突`,
        category: "quality",
        severity: "Medium",
        status: "Possible",
        message: "同名数据在不同函数中出现不同或未知类型，可能导致传导冲突。",
        evidence: `检测到类型集合：${Array.from(types).join(", ")}`,
        confidence: 61,
      });
    }
  });

  return issues.slice(0, 8);
}

function buildEnvironmentIssues(files: CodeFile[]): AnalysisIssue[] {
  const names = files.map((file) => file.name.toLowerCase());
  const joined = files.map((file) => file.content).join("\n");
  const issues: AnalysisIssue[] = [];
  const hasPackage = names.some((name) => name.endsWith("package.json"));
  const hasLock = names.some((name) => /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|cargo\.lock|poetry\.lock|go\.sum)$/.test(name));
  const hasTests = names.some((name) => /(^|\/)(test|tests|__tests__|spec)(\/|$)|\.(test|spec)\./.test(name));
  const envVars = Array.from(joined.matchAll(/process\.env\.([A-Z0-9_]+)|os\.environ\[['"]([A-Z0-9_]+)['"]\]/g)).map((match) => match[1] ?? match[2]);

  if (hasPackage && !hasLock) {
    issues.push({
      id: "env-missing-lock",
      title: "依赖锁缺失",
      category: "environment",
      severity: "Medium",
      status: "Likely",
      message: "项目有依赖声明但没有发现锁文件，环境复现稳定性下降。",
      evidence: "检测到 package.json，但未发现常见锁文件。",
      confidence: 79,
    });
  }

  if (!hasTests) {
    issues.push({
      id: "env-missing-tests",
      title: "测试载体缺失",
      category: "environment",
      severity: "Medium",
      status: "Possible",
      message: "没有发现测试目录或测试文件，后续自动修复难以验证。",
      evidence: "未匹配 tests、__tests__、.test 或 .spec 文件。",
      confidence: 68,
    });
  }

  if (envVars.length) {
    issues.push({
      id: "env-vars",
      title: "依赖环境变量",
      category: "environment",
      severity: "Low",
      status: "Confirmed",
      message: "项目运行依赖外部配置载体，需要在环境检查中确认是否缺失。",
      evidence: `发现环境变量：${Array.from(new Set(envVars)).slice(0, 5).join(", ")}`,
      confidence: 88,
    });
  }

  return issues;
}

function buildSpeedOptions(functions: FunctionInfo[], files: CodeFile[]): SpeedOption[] {
  const loopHeavy = functions.find((fn) => fn.complexity >= 6 || /\bfor\b|\bwhile\b/.test(fn.body));
  const asyncLoop = functions.find((fn) => /\bfor\b[\s\S]{0,160}\bawait\b/.test(fn.body));
  const cacheTarget = functions.find((fn) => /\bfetch|readFile|query|select|calculate|score\b/i.test(fn.body));
  const bufferTarget = functions.find((fn) => fn.risks.includes("溢流风险"));
  const hasElectronics = files.some((file) => /sensor|gpio|serial|mqtt|pwm|adc|voltage|current|resistor|capacitor/i.test(file.content));
  const options: SpeedOption[] = [];

  if (loopHeavy) {
    options.push({
      name: "算法模型替代",
      target: loopHeavy.name,
      efficiencyGain: 62,
      stabilityRisk: 18,
      fitScore: 76,
      model: "复杂度模型",
      reason: "循环或分支较多，优先评估 Hash Map、二分、批处理或向量化替代。",
    });
  }

  if (asyncLoop) {
    options.push({
      name: "并发窗口控制",
      target: asyncLoop.name,
      efficiencyGain: 48,
      stabilityRisk: 34,
      fitScore: 65,
      model: "排队论/限流模型",
      reason: "await 位于循环附近，可评估批量并发，但必须设置上限、超时和重试边界。",
    });
  }

  if (cacheTarget) {
    options.push({
      name: "缓存与增量索引",
      target: cacheTarget.name,
      efficiencyGain: 55,
      stabilityRisk: 22,
      fitScore: 73,
      model: "命中率与失效成本模型",
      reason: "重复读取、查询或计算可用 hash、memoization、SQLite 索引降低重复工作。",
    });
  }

  if (bufferTarget) {
    options.push({
      name: "背压与容量上限",
      target: bufferTarget.name,
      efficiencyGain: 24,
      stabilityRisk: 12,
      fitScore: 82,
      model: "队列稳定模型",
      reason: "当前重点不是提速，而是给水箱设置容量、消费速率、丢弃策略和峰值记录。",
    });
  }

  if (hasElectronics) {
    options.push({
      name: "元件参数模型",
      target: "设备/传感数据",
      efficiencyGain: 38,
      stabilityRisk: 28,
      fitScore: 70,
      model: "采样率、误差、温漂、响应时间模型",
      reason: "检测到电子元件或设备接口词汇，应把代码参数与元件参数表、采样窗口和容差绑定。",
    });
  }

  if (!options.length) {
    options.push({
      name: "基线方案保持",
      target: "当前项目",
      efficiencyGain: 12,
      stabilityRisk: 8,
      fitScore: 78,
      model: "成本收益模型",
      reason: "当前没有明显热点，先建立测量基线，再决定是否替换算法或架构。",
    });
  }

  return options.slice(0, 5);
}

function buildModelLayers(files: CodeFile[], functions: FunctionInfo[]) {
  const hasPackage = files.some((file) => file.name.endsWith("package.json"));
  const hasMathLike = functions.some((fn) => /score|rank|calculate|matrix|vector|optimize|model/i.test(fn.name + fn.body));
  const hasDeviceLike = files.some((file) => /sensor|serial|gpio|voltage|current|adc|pwm|mqtt/i.test(file.content));

  return [
    {
      name: "数学模型",
      role: "闭环评分、溢流阈值、稳定性和置信度计算",
      localSource: "内置公式/统计规则",
      status: hasMathLike ? "已发现候选函数" : "待接入",
    },
    {
      name: "算法模型",
      role: "复杂度、替代方案、效率增长与稳定性下降评估",
      localSource: "复杂度模型/排队模型/缓存模型",
      status: functions.length ? "启发式运行中" : "等待代码",
    },
    {
      name: "抽离模型",
      role: "从代码中抽离函数、类、参数、数据元素和调用关系",
      localSource: "当前为启发式，后续 Tree-sitter/LSP",
      status: "可回退",
    },
    {
      name: "代码基础模型",
      role: "语言语法、依赖、入口文件、测试和环境载体",
      localSource: hasPackage ? "package.json/锁文件/源码" : "源码扫描",
      status: "已启用",
    },
    {
      name: "电子元件参数模型",
      role: "元件参数、采样率、容差、温漂和控制周期约束",
      localSource: "本地参数库/设备描述文件",
      status: hasDeviceLike ? "检测到设备线索" : "待配置",
    },
  ];
}

function buildLocalLibraryAudit(
  files: CodeFile[],
  functions: FunctionInfo[],
): LocalLibraryAuditItem[] {
  const languages = new Set(files.map((file) => file.language).filter(Boolean));
  const sourceText = files.map((file) => `${file.name}\n${file.content}`).join("\n").toLowerCase();
  const hasPackage = files.some((file) => /(^|\/)package\.json$|lock|requirements\.txt|pyproject\.toml/i.test(file.name));
  const hasTypescriptTarget = files.some((file) => file.language === "TypeScript" || file.language === "JavaScript");
  const hasPythonTarget = files.some((file) => file.language === "Python");
  const hasSecuritySignals = /\b(validate|sanitize|auth|token|permission|escape|sql|query|password|secret|encrypt|decrypt)\b/.test(
    sourceText,
  );
  const hasStabilitySignals = /\b(try|catch|finally|timeout|retry|while|throw|null|undefined|fallback|abort)\b/.test(sourceText);
  const hasAlgorithmSignals = functions.some((fn) =>
    /\b(sort|search|cache|queue|graph|route|flow|parse|validate|hash|tree|walk|scan)\b/i.test(`${fn.name} ${fn.body}`),
  );
  const hasDeviceLike = /gpio|i2c|spi|uart|adc|pwm|sensor|voltage|current|pin|电压|电流|传感器|采样|元件/.test(
    sourceText,
  );

  return localKnowledgeLibrarySeeds.map((seed) => {
    let coverage = seed.seedCoverage;
    let status = seed.seedStatus;
    const ruleCount = knowledgeRuleCountByLibraryCategory(seed.category);
    const mature = matureLibraryAuditByCategory(seed.category);

    if (ruleCount) coverage += Math.min(18, ruleCount * 3);
    if (mature.entryCount) coverage += Math.min(38, Math.round(mature.percent * 0.38));
    if (seed.category === "数学模型库" && functions.length) coverage += 4;
    if (seed.category === "算法模型库" && hasAlgorithmSignals) coverage += 8;
    if (seed.category === "效率知识库" && functions.length > 8) coverage += 5;
    if (seed.category === "安全规则库" && hasSecuritySignals) coverage += 8;
    if (seed.category === "稳定性规则库" && hasStabilitySignals) coverage += 8;
    if (seed.category === "语言生态库") {
      coverage += Math.min(14, languages.size * 4);
      if (hasTypescriptTarget) coverage += 8;
      if (hasPythonTarget) coverage += 6;
    }
    if (seed.category === "运行环境库" && hasPackage) coverage += 10;
    if (seed.category === "电子元件参数库" && hasDeviceLike) {
      coverage += 18;
      status = "种子数据";
    }
    if (seed.category === "工具适配器") {
      if (hasTypescriptTarget) coverage += 8;
      if (hasPythonTarget) coverage += 4;
    }

    const normalizedCoverage = mature.entryCount
      ? Math.max(0, Math.min(100, Math.max(coverage, Math.round(mature.percent * 0.82 + seed.seedCoverage * 0.18))))
      : Math.max(0, Math.min(100, coverage));
    if (status !== "后续扩展") {
      if (normalizedCoverage >= 78 && mature.entryCount >= mature.targetCount && mature.missingDomains.length === 0) status = "成熟数据";
      else if (normalizedCoverage >= 32) status = "部分具备";
      if (normalizedCoverage < 20) status = "需要建设";
    }
    if (status === "后续扩展" && mature.entryCount >= mature.targetCount && mature.missingDomains.length === 0) {
      status = "成熟数据";
    }

    return {
      ...seed,
      dataScope: [
        seed.dataScope,
        ruleCount ? `已录入 ${ruleCount} 条本地规则` : "",
        mature.entryCount
          ? `成熟库 ${mature.entryCount}/${mature.targetCount} 条，核心域 ${mature.coveredDomains.slice(0, 7).join("、")}`
          : "",
      ]
        .filter(Boolean)
        .join("。"),
      recommendation: [
        ruleCount ? "当前已有规则种子，可继续补语言/框架特化证据。" : seed.recommendation,
        mature.missingDomains.length ? `成熟库缺口：${mature.missingDomains.join("、")}。${mature.next}` : `成熟库已覆盖核心域。${mature.next}`,
      ].join(" "),
      status,
      coverage: normalizedCoverage,
    };
  });
}

function assessMapQuality(nodes: FlowNode[], edges: FlowEdge[]): MapQualityReport {
  const positioned = nodes.filter((node) => typeof node.x === "number" && typeof node.y === "number");
  let overlapCount = 0;
  let minNodeDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < positioned.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < positioned.length; nextIndex += 1) {
      const a = positioned[index];
      const b = positioned[nextIndex];
      const distance = Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));
      const requiredDistance = nodeHitRadius(a) + nodeHitRadius(b) + 10;
      minNodeDistance = Math.min(minNodeDistance, Math.round(distance));
      if (distance < requiredDistance) overlapCount += 1;
    }
  }

  const clickTarget = 72;
  const issueSegmentCount = edges.filter((edge) => ["Open", "Overflow Risk", "Blocked"].includes(edge.status)).length;
  const primaryChannelCount = edges.filter((edge) => edge.primary).length;
  const unrelatedCrossingCount = countUnrelatedEdgeCrossings(positioned, edges);
  const bridgeCount = unrelatedCrossingCount;
  const basinCount = new Set(nodes.map((node) => node.basin).filter(Boolean)).size;
  const aggregateNodeCount = nodes.filter((node) => node.visualKind === "basin").length;
  const readabilityScore = Math.max(
    0,
    Math.min(
      100,
      94 - overlapCount * 9 - Math.min(18, unrelatedCrossingCount * 2) - Math.max(0, 8 - primaryChannelCount) * 2 - Math.max(0, positioned.length - 44),
    ),
  );
  const status = readabilityScore >= 82 ? "清晰" : readabilityScore >= 64 ? "可用但需优化" : "需要整理";
  const notes = [
    overlapCount
      ? `检测到 ${overlapCount} 组节点可能重叠，需要自动避让或局部展开。`
      : "当前几何检测没有发现节点重叠。",
    `最小节点距离 ${Number.isFinite(minNodeDistance) ? minNodeDistance : 0}px，点击热区 ${clickTarget}px。`,
    issueSegmentCount
      ? `有 ${issueSegmentCount} 条问题水段，已使用颜色标注。`
      : "当前没有需要颜色警戒的问题水段。",
    unrelatedCrossingCount
      ? `${unrelatedCrossingCount} 处无关水路交叉已使用留白桥接，只有菱形节点代表真实合流或分流。`
      : "没有检测到无关水路交叉。",
    `${basinCount} 个功能流域，${aggregateNodeCount} 个大型项目聚合节点。`,
  ];

  return {
    readabilityScore,
    overlapCount,
    minNodeDistance: Number.isFinite(minNodeDistance) ? minNodeDistance : 0,
    clickTarget,
    primaryChannelCount,
    issueSegmentCount,
    unrelatedCrossingCount,
    bridgeCount,
    basinCount,
    aggregateNodeCount,
    status,
    notes,
  };
}

function countUnrelatedEdgeCrossings(nodes: FlowNode[], edges: FlowEdge[]) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  let crossings = 0;
  for (let index = 0; index < edges.length; index += 1) {
    const a = edges[index];
    const aFrom = nodeMap.get(a.from);
    const aTo = nodeMap.get(a.to);
    if (!aFrom || !aTo) continue;
    for (let next = index + 1; next < edges.length; next += 1) {
      const b = edges[next];
      if (a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to) continue;
      const bFrom = nodeMap.get(b.from);
      const bTo = nodeMap.get(b.to);
      if (!bFrom || !bTo) continue;
      if (segmentsCross(
        aFrom.x ?? 0, aFrom.y ?? 0, aTo.x ?? 0, aTo.y ?? 0,
        bFrom.x ?? 0, bFrom.y ?? 0, bTo.x ?? 0, bTo.y ?? 0,
      )) crossings += 1;
    }
  }
  return crossings;
}

function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) {
  const orientation = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    Math.sign((qy - py) * (rx - qx) - (qx - px) * (ry - qy));
  return orientation(ax, ay, bx, by, cx, cy) !== orientation(ax, ay, bx, by, dx, dy) &&
    orientation(cx, cy, dx, dy, ax, ay) !== orientation(cx, cy, dx, dy, bx, by);
}

function nodeHitRadius(node: FlowNode) {
  const capacity = node.capacity ?? inferNodeCapacity(node);
  if (capacity === "湖") return 52;
  if (capacity === "水库") return 50;
  if (capacity === "水池") return 42;
  if (capacity === "河道") return 40;
  return 34;
}

function relaxWaterNodePositions(nodes: FlowNode[]) {
  const relaxed = nodes.map((node) => ({ ...node }));

  for (let pass = 0; pass < 36; pass += 1) {
    let moved = false;
    for (let index = 0; index < relaxed.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < relaxed.length; nextIndex += 1) {
        const a = relaxed[index];
        const b = relaxed[nextIndex];
        const ax = a.x ?? 0;
        const ay = a.y ?? 0;
        const bx = b.x ?? 0;
        const by = b.y ?? 0;
        const distance = Math.max(1, Math.hypot(ax - bx, ay - by));
        const requiredDistance = nodeHitRadius(a) + nodeHitRadius(b) + 26;
        if (distance >= requiredDistance) continue;

        const push = (requiredDistance - distance) / 2;
        const dx = ((ax - bx) / distance) * push;
        const dy = ((ay - by) / distance) * push;
        const aWeight = nodeMoveWeight(a);
        const bWeight = nodeMoveWeight(b);
        a.x = clampMapX(ax + dx * aWeight);
        a.y = clampMapY(ay + dy * aWeight);
        b.x = clampMapX(bx - dx * bWeight);
        b.y = clampMapY(by - dy * bWeight);
        moved = true;
      }
    }
    if (!moved) break;
  }

  return relaxed;
}

function alignWaterNodesToFlow(nodes: FlowNode[], edges: FlowEdge[]) {
  const aligned = nodes.map((node) => ({ ...node }));
  const byId = new Map(aligned.map((node) => [node.id, node]));
  const neighbors = new Map<string, string[]>();
  edges.forEach((edge) => {
    neighbors.set(edge.from, [...(neighbors.get(edge.from) ?? []), edge.to]);
    neighbors.set(edge.to, [...(neighbors.get(edge.to) ?? []), edge.from]);
  });

  for (let pass = 0; pass < 6; pass += 1) {
    const layers = new Map<number, FlowNode[]>();
    aligned.forEach((node) => {
      const layer = node.depth ?? 0;
      layers.set(layer, [...(layers.get(layer) ?? []), node]);
    });
    const orderedLayers = [...layers.entries()].sort(([a], [b]) => pass % 2 === 0 ? a - b : b - a);
    orderedLayers.forEach(([, layerNodes]) => {
      const desired = layerNodes.map((node) => {
        const connected = (neighbors.get(node.id) ?? []).map((id) => byId.get(id)).filter((item): item is FlowNode => Boolean(item));
        const center = connected.length
          ? connected.reduce((sum, item) => sum + (item.y ?? 0), 0) / connected.length
          : node.y ?? 0;
        return { node, center };
      }).sort((a, b) => a.center - b.center || (a.node.y ?? 0) - (b.node.y ?? 0));

      let cursor = 50;
      desired.forEach(({ node, center }) => {
        const radius = nodeHitRadius(node);
        node.y = Math.max(cursor + radius, center);
        cursor = (node.y ?? center) + radius + 34;
      });
    });
  }
  return aligned;
}

function nodeMoveWeight(node: FlowNode) {
  if ((node.depth ?? 0) <= 1) return 0.35;
  if ((node.downstreamIds?.length ?? 0) > 1 || (node.upstreamIds?.length ?? 0) > 1) return 0.45;
  return 1;
}

function clampMapX(value: number) {
  return Math.max(58, Math.min(1122, value));
}

function clampMapY(value: number) {
  return Math.max(58, Math.min(2600, value));
}

function buildProgressReport(
  flowEdges: FlowEdge[],
  localLibraryAudit: LocalLibraryAuditItem[],
  mapQuality: MapQualityReport,
  semanticIndex: SemanticIndexReport,
  runtimeSandbox: RuntimeSandboxReport,
) {
  const parserCoverage = libraryCoverage(localLibraryAudit, "工具适配器");
  const knowledgeCoverage = averageCoverage(localLibraryAudit.filter((item) => item.category !== "工具适配器"));
  const algorithmCoverage = averageCoverage(
    localLibraryAudit.filter((item) => ["数学模型库", "算法模型库", "效率知识库"].includes(item.category)),
  );
  const safetyCoverage = averageCoverage(
    localLibraryAudit.filter((item) => ["安全规则库", "稳定性规则库"].includes(item.category)),
  );
  const semanticCoverage = libraryCoverage(localLibraryAudit, "语义索引库");
  const items: BuildProgressItem[] = [
    {
      name: "桌面与多项目 v1",
      percent: 100,
      status: "已完成",
      next: "macOS arm64 功能范围已封存；公开分发签名和其他系统安装包按发布平台单独验收。",
    },
    {
      name: "全语言解析 v1",
      percent: 100,
      status: "已完成",
      next: `15/15 Tree-sitter AST、15/15 语义 provider 路由；当前项目工具适配证据覆盖 ${Math.round(parserCoverage)}%。`,
    },
    {
      name: "通俗语言与技术解读 v1",
      percent: 100,
      status: "已完成",
      next: "文件、模块、函数、主流程和证据已全量解读；低证据语义继续保留候选标记，等待 LSP 或真实运行证据校准。",
    },
    {
      name: "本地知识库",
      percent: Math.round(knowledgeCoverage),
      status: progressStatus(knowledgeCoverage),
      next: "把成熟库条目写入 library_entries，并与规则命中、水文节点和修复配方绑定。",
    },
    {
      name: "水系地图",
      percent: Math.min(76, Math.max(42, mapQuality.readabilityScore - 14)),
      status: "进行中",
      next: "接自动布局库、缩放、拖拽、局部展开。",
    },
    {
      name: "算法/效率评估",
      percent: Math.round(algorithmCoverage),
      status: progressStatus(algorithmCoverage),
      next: "沉淀复杂度模型、替代方案评分和稳定性代价。",
    },
    {
      name: "安全/稳定规则",
      percent: Math.round(safetyCoverage),
      status: progressStatus(safetyCoverage),
      next: "接 taint flow、异常传播、溢出、闭环和权限边界规则。",
    },
    {
      name: "运行仿真",
      percent: Math.min(58, Math.max(18, runtimeSandbox.readinessScore - 18)),
      status: progressStatus(runtimeSandbox.readinessScore - 18),
      next: "把 Static Dry-run 升级为 Web Worker/Node Worker 受控运行。",
    },
    {
      name: "语义索引",
      percent: Math.max(Math.round(semanticCoverage), Math.min(62, semanticIndex.integrityScore - 18)),
      status: progressStatus(Math.max(semanticCoverage, semanticIndex.integrityScore - 18)),
      next: "引入 SQLite/sql.js 持久保存成熟本地库、函数图、水系边和证据。",
    },
    {
      name: "修复推荐中心",
      percent: flowEdges.length ? 16 : 8,
      status: "待构建",
      next: "生成 diff 草案、测试建议和回滚点。",
    },
  ];
  const weighted = items.reduce((sum, item) => sum + item.percent, 0) / items.length;

  return {
    overall: Math.round(weighted),
    items,
    nextMilestones: [
      "把已建立的本地知识库 Schema 接入 sql.js/D1 写入流程。",
      "把成熟本地库条目与计算机数学、算法复杂度、效率模型、安全规则和稳定性规则命中绑定。",
      "构建 TS/JS 语言生态包，再扩展 Python、Go、Rust、Java、C/C++。",
      "用 SQLite/sql.js 保存成熟本地库、项目扫描结果和水系图证据。",
      "接 Tree-sitter/LSP，让知识库可以读取真实 AST、类型和引用。",
      "建立 Runtime Lab 做输入样本回放、资源限制和断点仿真。",
    ],
  };
}

function libraryCoverage(items: LocalLibraryAuditItem[], category: LocalLibraryAuditItem["category"]) {
  return items.find((item) => item.category === category)?.coverage ?? 0;
}

function averageCoverage(items: LocalLibraryAuditItem[]) {
  if (!items.length) return 0;
  return items.reduce((sum, item) => sum + item.coverage, 0) / items.length;
}

function progressStatus(percent: number): BuildProgressItem["status"] {
  if (percent >= 80) return "已完成";
  if (percent < 16) return "待构建";
  return "进行中";
}

function scoreClosure(flowNodes: FlowNode[], breakpoints: Set<string>) {
  let score = 100;
  flowNodes.forEach((node) => {
    if (node.status === "Open") score -= 18;
    if (node.status === "Overflow Risk") score -= 14;
    if (node.status === "Blocked") score -= 16;
    if (node.status === "Unknown") score -= 6;
  });
  score -= breakpoints.size * 4;
  return Math.max(0, Math.min(100, score));
}

function severityPenalty(severity: AnalysisIssue["severity"]) {
  if (severity === "Critical") return 28;
  if (severity === "High") return 18;
  if (severity === "Medium") return 10;
  return 4;
}

function uniqueAnalysisIssues(issues: AnalysisIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.category}:${issue.title}:${issue.evidence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
