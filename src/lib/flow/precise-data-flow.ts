import type {
  ControlledRuntimeExecutionReport,
  FlowEdge,
  FunctionInfo,
  GraphEdge,
  TaintFlowReport,
  TaintPath,
  TaintSinkKind,
  TaintSourceKind,
} from "../analysis/types.ts";
import { buildInterproceduralTaintReport } from "../security/interprocedural-taint.ts";

export function enrichPreciseDataFlow(
  edge: FlowEdge,
  functions: FunctionInfo[],
  graphEdges: GraphEdge[],
  runtimeExecutions: ControlledRuntimeExecutionReport[],
): FlowEdge {
  const from = functions.find((fn) => fn.id === edge.from);
  const to = functions.find((fn) => fn.id === edge.to);
  if (!from || !to) return edge;
  const graphEdge = graphEdges.find((candidate) => candidate.from === edge.from && candidate.to === edge.to);
  const argumentsAtCall = extractCallArguments(from.body, to.name);
  const dataItems = (argumentsAtCall.length ? argumentsAtCall : from.outputs.filter(isConcreteDataName)).slice(0, 12).map((value, index) => {
    const keyword = splitKeywordArgument(value);
    const targetParameter = keyword
      ? to.params.find((parameter) => parameterName(parameter) === keyword.name) ?? keyword.name
      : to.params[index] ?? to.params[0] ?? "unknown";
    const sourceValue = keyword?.value ?? value;
    return {
      name: cleanDataName(sourceValue),
      type: parameterType(targetParameter) || outputType(from, value),
      origin: isExternalValue(from, sourceValue) ? "external" as const : from.outputs.some((item) => item.includes(sourceValue)) ? "return" as const : "parameter" as const,
      destination: to.params.length ? "parameter" as const : sinkKindForFunction(to) === "state" ? "state" as const : "sink" as const,
      confidence: graphEdge ? Math.min(edge.confidence, graphEdge.confidence ?? edge.confidence) : Math.min(edge.confidence, 48),
      evidence: argumentsAtCall.length
        ? `${from.name} 调用 ${to.name} 时${keyword ? `关键字实参 ${keyword.name}` : `第 ${index + 1} 个实参`} ${sourceValue} -> 形参 ${targetParameter}`
        : `${from.name} 的输出 ${sourceValue} 与 ${to.name} 的调用顺序相关，但未解析到精确实参绑定`,
    };
  });
  const runtimeObservation = runtimeObservationForEdge(from.name, to.name, runtimeExecutions);
  const evidenceGrade = runtimeObservation.observed ? "runtime" : /\bLSP\b|reference/i.test(graphEdge?.evidence ?? "") ? "lsp" : /Compiler/i.test(graphEdge?.evidence ?? "") ? "compiler" : /AST|Tree-sitter/i.test(graphEdge?.evidence ?? "") ? "ast" : "lexical";
  return {
    ...edge,
    transferKind: dataItems.some((item) => item.origin === "external") ? "external" : dataItems.length ? "parameter" : "unknown",
    dataItems,
    sourceKind: from.externalInputs.length ? "external_input" : from.outputs.some(isConcreteDataName) ? "function_output" : from.sideEffects.length ? "state" : "unknown",
    sinkKind: sinkKindForFunction(to),
    evidenceGrade,
    runtimeObservation,
    evidence: `${edge.evidence} · 数据绑定 ${dataItems.length ? dataItems.map((item) => item.name).join(", ") : "未解析"} · 证据等级 ${evidenceGrade}`,
  };
}

export function buildSourceToSinkTaintReport(
  functions: FunctionInfo[],
  graphEdges: GraphEdge[],
  runtimeExecutions: ControlledRuntimeExecutionReport[] = [],
): TaintFlowReport {
  const variableTaint = buildInterproceduralTaintReport(functions, graphEdges, 128, runtimeExecutions);
  const variableSinkByFunction = new Map(variableTaint.sinks.map((sink) => [sink.functionId, sink]));
  const functionMap = new Map(functions.map((fn) => [fn.id, fn]));
  const preciseEdges = graphEdges
    .filter((edge) => functionMap.has(edge.from) && functionMap.has(edge.to))
    .map((edge) => enrichPreciseDataFlow({
      id: `${edge.from}->${edge.to}:semantic`,
      from: edge.from,
      to: edge.to,
      kind: "水路",
      status: "Unknown",
      volume: 50,
      confidence: edge.confidence ?? 62,
      evidence: edge.evidence ?? "semantic call edge",
    }, functions, graphEdges, runtimeExecutions));
  const outgoing = new Map<string, FlowEdge[]>();
  preciseEdges.forEach((edge) => outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]));
  const incomingIds = new Set(preciseEdges.map((edge) => edge.to));
  const sources = functions.flatMap((fn) => {
    const kind = sourceKindForFunction(fn, !incomingIds.has(fn.id));
    return kind ? [{ fn, kind }] : [];
  });
  const sinks = new Map(functions.flatMap((fn) => {
    const kind = taintSinkKindForFunction(fn);
    return kind ? [[fn.id, kind] as const] : [];
  }));
  const paths: TaintPath[] = [];
  const pathKeys = new Set<string>();
  const maxPaths = 240;

  for (const source of sources) {
    const queue = [{ functionIds: [source.fn.id], edges: [] as FlowEdge[] }];
    while (queue.length && paths.length < maxPaths) {
      const current = queue.shift();
      if (!current) break;
      const currentId = current.functionIds.at(-1);
      if (!currentId) continue;
      const sinkKind = sinks.get(currentId);
      if (sinkKind && (currentId !== source.fn.id || current.edges.length > 0)) {
        const key = `${source.fn.id}->${currentId}:${current.functionIds.join(">")}`;
        if (!pathKeys.has(key)) {
          pathKeys.add(key);
          paths.push(buildTaintPath(source.fn, source.kind, functionMap.get(currentId)!, sinkKind, current.functionIds, current.edges, functionMap, variableSinkByFunction.get(currentId)));
        }
      }
      if (current.functionIds.length >= 14) continue;
      for (const edge of outgoing.get(currentId) ?? []) {
        if (current.functionIds.includes(edge.to)) continue;
        queue.push({ functionIds: [...current.functionIds, edge.to], edges: [...current.edges, edge] });
      }
    }
  }

  const exposedPathCount = paths.filter((path) => path.status === "exposed").length;
  const sanitizedPathCount = paths.filter((path) => path.status === "sanitized").length;
  const candidatePathCount = paths.filter((path) => path.status === "candidate").length;
  const runtimeConfirmedPathCount = paths.filter((path) => path.evidenceGrade === "runtime").length;
  return {
    sourceCount: sources.length,
    sinkCount: sinks.size,
    pathCount: paths.length,
    exposedPathCount,
    sanitizedPathCount,
    candidatePathCount,
    runtimeConfirmedPathCount,
    truncated: paths.length >= maxPaths,
    summary: `识别 ${sources.length} 个输入源、${sinks.size} 个敏感落点和 ${paths.length} 条 source-to-sink 路径；${exposedPathCount} 条已发现未净化传播，${sanitizedPathCount} 条经过验证/权限/范围检查，${candidatePathCount} 条等待补证。函数内/跨过程污点固定点 ${variableTaint.converged ? "已收敛" : "达到上限"}，变量事实 ${variableTaint.variables.length} 个。`,
    paths,
  };
}

export function annotateEdgesWithTaint(edges: FlowEdge[], report: TaintFlowReport) {
  const byPair = new Map<string, TaintPath[]>();
  report.paths.forEach((path) => path.edgePairs.forEach((pair) => byPair.set(pair, [...(byPair.get(pair) ?? []), path])));
  return edges.map((edge) => {
    const paths = byPair.get(`${edge.from}->${edge.to}`) ?? [];
    const taintStatus = paths.some((path) => path.status === "exposed")
      ? "exposed" as const
      : paths.some((path) => path.status === "candidate")
        ? "candidate" as const
        : paths.some((path) => path.status === "sanitized")
          ? "sanitized" as const
          : "none" as const;
    return {
      ...edge,
      taintPathIds: paths.map((path) => path.id),
      taintStatus,
      evidence: paths.length ? `${edge.evidence} · 污点路径 ${paths.length} 条 · ${taintStatus}` : edge.evidence,
    };
  });
}

function buildTaintPath(
  source: FunctionInfo,
  sourceKind: TaintSourceKind,
  sink: FunctionInfo,
  sinkKind: TaintSinkKind,
  functionIds: string[],
  edges: FlowEdge[],
  functionMap: Map<string, FunctionInfo>,
  variableSink?: ReturnType<typeof buildInterproceduralTaintReport>["sinks"][number],
): TaintPath {
  const sanitizers = functionIds.filter((id) => isSanitizer(functionMap.get(id), sinkKind));
  const allBindings = edges.length > 0 && edges.every((edge) => (edge.dataItems?.length ?? 0) > 0);
  const runtimeConfirmed = edges.length > 0 && edges.every((edge) => edge.runtimeObservation?.observed);
  const status = variableSink?.status === "exposed" ? "exposed"
    : variableSink?.status === "sanitized" || sanitizers.length ? "sanitized"
      : runtimeConfirmed || allBindings ? "exposed" : "candidate";
  const evidenceGrade = weakestEvidenceGrade(edges.map((edge) => edge.evidenceGrade ?? "lexical"));
  const confidence = Math.max(28, Math.min(100,
    Math.round(Math.min(source.confidence, sink.confidence, ...edges.map((edge) => edge.confidence)) - (status === "candidate" ? 18 : 0)),
  ));
  const dataNames = Array.from(new Set(edges.flatMap((edge) => edge.dataItems?.map((item) => item.name) ?? []))).slice(0, 16);
  return {
    id: `taint:${source.id}->${sink.id}:${functionIds.join(">")}`,
    sourceFunctionId: source.id,
    sourceFunctionName: source.name,
    sourceKind,
    sinkFunctionId: sink.id,
    sinkFunctionName: sink.name,
    sinkKind,
    functionIds,
    edgePairs: edges.map((edge) => `${edge.from}->${edge.to}`),
    dataNames,
    sanitizerFunctionIds: sanitizers,
    status,
    confidence,
    evidenceGrade,
    evidence: [
      `source ${source.name}: ${source.externalInputs.join(", ") || source.params.join(", ") || sourceKind}`,
      ...edges.map((edge) => edge.evidence),
      `sink ${sink.name}: ${sinkKind}`,
      sanitizers.length ? `sanitizer: ${sanitizers.map((id) => functionMap.get(id)?.name ?? id).join(", ")}` : "未发现 sanitizer",
      ...(variableSink?.evidence ?? []).slice(0, 4),
    ],
  };
}

function extractCallArguments(body: string, calleeName: string) {
  const escaped = calleeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startMatch = new RegExp(`(?:\\b|\\.)${escaped}\\s*\\(`).exec(body);
  if (!startMatch) return [];
  const start = startMatch.index + startMatch[0].length;
  let depth = 0;
  let quote: string | null = null;
  let escapedQuote = false;
  for (let index = start; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (escapedQuote) escapedQuote = false;
      else if (char === "\\") escapedQuote = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (["'", '"', "`"].includes(char)) { quote = char; continue; }
    if (["(", "[", "{"].includes(char)) depth += 1;
    if ([")", "]", "}"].includes(char)) {
      if (char === ")" && depth === 0) return splitTopLevelArguments(body.slice(start, index));
      depth = Math.max(0, depth - 1);
    }
  }
  return [];
}

function splitTopLevelArguments(value: string) {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote && value[index - 1] !== "\\") quote = null;
      continue;
    }
    if (["'", '"', "`"].includes(char)) quote = char;
    else if (["(", "[", "{"].includes(char)) depth += 1;
    else if ([")", "]", "}"].includes(char)) depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result.filter(Boolean);
}

function splitKeywordArgument(value: string) {
  const match = value.match(/^([A-Za-z_]\w*)\s*=\s*(?!=)(.+)$/s);
  return match ? { name: match[1], value: match[2].trim() } : null;
}

function parameterName(parameter: string) {
  return parameter.replace(/^\s*(?:self|this)\s*,?/, "").split(/[:=\s]/)[0]?.replace(/^\*+/, "") ?? parameter;
}

function isExternalValue(fn: FunctionInfo, value: string) {
  const normalized = cleanDataName(value).toLowerCase();
  return fn.externalInputs.some((item) => normalized.includes(cleanDataName(item).toLowerCase())) ||
    /\b(req|request|payload|body|query|params|input|stdin|env|sensor)\b/.test(normalized);
}

function isConcreteDataName(value: string) {
  return Boolean(value && !["void", "state change/void", "unknown", "inferred"].includes(value));
}

function cleanDataName(value: string) {
  return value.replace(/^return\s+/, "").replace(/[;)]$/g, "").trim().slice(0, 120) || "unknown";
}

function parameterType(parameter: string) {
  const colon = parameter.match(/:\s*([^=,)]+)/);
  if (colon?.[1]) return colon[1].trim();
  const typedPrefix = parameter.trim().split(/\s+/);
  return typedPrefix.length > 1 ? typedPrefix[0] : "inferred";
}

function outputType(fn: FunctionInfo, value: string) {
  return fn.outputs.includes(value) && fn.returnType ? fn.returnType : "inferred";
}

function sinkKindForFunction(fn: FunctionInfo): NonNullable<FlowEdge["sinkKind"]> {
  const signals = `${fn.name} ${fn.summary} ${fn.sideEffects.join(" ")}`.toLowerCase();
  if (/sql|database|db|orm|数据库/.test(signals)) return "database";
  if (/file|path|文件|资源操作/.test(signals)) return "file";
  if (/http|fetch|socket|network|网络/.test(signals)) return "network";
  if (/exec|spawn|process|command|命令/.test(signals)) return "process";
  if (/state|cache|状态|缓存/.test(signals)) return "state";
  if (fn.outputs.some(isConcreteDataName)) return "return";
  return fn.params.length ? "function_parameter" : "unknown";
}

function sourceKindForFunction(fn: FunctionInfo, isGraphRoot: boolean): TaintSourceKind | null {
  const signals = `${fn.name} ${fn.summary} ${fn.externalInputs.join(" ")} ${fn.body}`.toLowerCase();
  const hasDeclaredExternalInput = fn.externalInputs.length > 0;
  const acquisitionApi = /\b(env|process\.env|os\.getenv|fetch|socket|read_file|readfile|stdin|argv|sensor|device)\b/.test(signals);
  const rootRequest = isGraphRoot && /\b(request|req|payload|body|query|params|input)\b/.test(signals);
  if (!hasDeclaredExternalInput && !acquisitionApi && !rootRequest) {
    return null;
  }
  if (/\b(env|environment|process\.env|os\.getenv)\b/.test(signals)) return "environment";
  if (/\b(read_file|readfile|open\s*\(|file|path)\b/.test(signals)) return "file";
  if (/\b(fetch|http|socket|websocket|network)\b/.test(signals)) return "network";
  if (/\b(sensor|serial|gpio|device|hardware)\b/.test(signals)) return "device";
  if (/\b(select|database|db|repository|cursor)\b/.test(signals)) return "database";
  if (/\b(request|req|payload|body|query|form|header|cookie)\b/.test(signals)) return "request";
  if (/\b(params?|argument|argv|input|stdin)\b/.test(signals) || hasDeclaredExternalInput) return "parameter";
  return "unknown";
}

function taintSinkKindForFunction(fn: FunctionInfo): TaintSinkKind | null {
  const signals = `${fn.name} ${fn.summary} ${fn.risks.join(" ")} ${fn.sideEffects.join(" ")} ${fn.body}`.toLowerCase();
  if (/\b(exec|spawn|system|popen|subprocess|eval|shell|command)\b|命令执行/.test(signals)) return "command";
  if (/innerhtml|dangerouslysetinnerhtml|document\.write|dom sink|xss/.test(signals)) return "dom";
  if (/\b(writefile|write_file|appendfile|unlink|remove_file|rename|file\.write|open\s*\([^)]*["'][awx])\b/.test(signals)) return "file";
  if (/\b(send|post|put|upload|fetch|socket\.write|http\.request)\b/.test(signals)) return "network";
  if (/sql 注入|\b(execute|executemany|raw_sql|rawquery)\b|\b(insert|update|delete)\s+(?:into|from|\w+\s+set)\b/.test(signals)) return "sql";
  if (/\b(commit|flush|save|persist|repository\.(?:add|update|delete)|session\.(?:add|delete|commit))\b/.test(signals)) return "database-write";
  if (/\b(global|shared_state|cache\.(?:set|put)|state\s*=|store\.set)\b|状态写入/.test(signals)) return "shared-state";
  return null;
}

function isSanitizer(fn: FunctionInfo | undefined, sinkKind: TaintSinkKind) {
  if (!fn) return false;
  const signals = `${fn.name} ${fn.summary} ${(fn.validations ?? []).join(" ")}`.toLowerCase();
  const implementation = fn.body.toLowerCase();
  if (sinkKind === "sql" || sinkKind === "database-write") {
    return /\b(parameterized|bindparam|prepared|orm|schema|validate|parse_safe)\b|参数绑定|输入验证|类型检查/.test(signals) ||
      /\b(bindparam|prepare|parameterized)\b/.test(implementation);
  }
  if (sinkKind === "dom") return /\b(sanitize|escape|encode|textcontent)\b|转义|净化/.test(signals) || /\b(dom_purify|escape_html)\b/.test(implementation);
  if (sinkKind === "file") return /\b(resolve|realpath|normalize|allowlist|whitelist|validate_path)\b|路径校验|白名单/.test(signals) || /\b(realpath|resolve_path)\b/.test(implementation);
  if (sinkKind === "command") return /\b(allowlist|whitelist|validate|authorize|permission)\b|白名单|输入验证|权限检查/.test(signals);
  return (fn.validations?.length ?? 0) > 0 || /\b(validate|sanitize|authorize|permission|allowlist|schema)\b|输入验证|权限检查|范围检查|类型检查/.test(signals);
}

function weakestEvidenceGrade(grades: NonNullable<FlowEdge["evidenceGrade"]>[]) {
  const rank: Record<NonNullable<FlowEdge["evidenceGrade"]>, number> = {
    lexical: 0,
    ast: 1,
    compiler: 2,
    lsp: 3,
    runtime: 4,
  };
  return grades.reduce((weakest, grade) => rank[grade] < rank[weakest] ? grade : weakest, grades[0] ?? "lexical");
}

function runtimeObservationForEdge(fromName: string, toName: string, runs: ControlledRuntimeExecutionReport[]): NonNullable<FlowEdge["runtimeObservation"]> {
  const matches = runs.flatMap((run) => {
    const events = run.traceEvents ?? [];
    const explicit = events.some((event) => event.event === "transfer" && event.from === fromName && event.to === toName);
    const sequence = events.some((event, index) => event.functionName === fromName && events[index + 1]?.functionName === toName);
    return explicit || sequence ? [{ runId: run.id, sampleId: run.sampleId ?? "unspecified" }] : [];
  });
  return {
    observed: matches.length > 0,
    runIds: Array.from(new Set(matches.map((item) => item.runId))),
    sampleIds: Array.from(new Set(matches.map((item) => item.sampleId))),
    count: matches.length,
    evidence: matches.length ? `${matches.length} 次受控运行 trace 观察到 ${fromName} -> ${toName}` : "尚无 CODEFLOW_TRACE 运行事件证明该水路被实际经过",
  };
}
