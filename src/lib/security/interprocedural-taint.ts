import type { ControlledRuntimeExecutionReport, FunctionInfo, GraphEdge } from "../analysis/types.ts";
import { analyzeDynamicBoundaries } from "./dynamic-boundary-analysis.ts";

export type TaintVariableFact = {
  functionId: string;
  variable: string;
  origin: string;
  sanitized: boolean;
  evidence: string[];
};

export type TaintSinkFact = {
  functionId: string;
  functionName: string;
  sinkKind: string;
  taintedVariables: string[];
  status: "exposed" | "sanitized" | "candidate";
  evidence: string[];
};

export type InterproceduralTaintReport = {
  variables: TaintVariableFact[];
  sinks: TaintSinkFact[];
  functionSummaries: Record<string, { taintedInputs: string[]; taintedReturns: boolean; sanitizedVariables: string[] }>;
  iterations: number;
  converged: boolean;
  unresolvedCallCount: number;
  dynamicBoundaryCount: number;
  evidence: string[];
};

export function buildInterproceduralTaintReport(functions: FunctionInfo[], edges: GraphEdge[], maxIterations = 128, runtime: ControlledRuntimeExecutionReport[] = []): InterproceduralTaintReport {
  const byId = new Map(functions.map((fn) => [fn.id, fn]));
  const facts = new Map<string, TaintVariableFact>();
  const summaries = new Map<string, { taintedInputs: Set<string>; taintedReturns: boolean; sanitizedVariables: Set<string> }>();
  const dynamicBoundaries = analyzeDynamicBoundaries(functions, runtime);
  const put = (fn: FunctionInfo, variable: string, origin: string, sanitized: boolean, evidence: string) => {
    const id = key(fn.id, variable);
    const current = facts.get(id);
    if (!current) { facts.set(id, { functionId: fn.id, variable, origin, sanitized, evidence: [evidence] }); return true; }
    const changed = current.sanitized && !sanitized;
    current.sanitized = current.sanitized && sanitized;
    if (!current.evidence.includes(evidence)) current.evidence.push(evidence);
    return changed;
  };
  for (const fn of functions) {
    summaries.set(fn.id, { taintedInputs: new Set(), taintedReturns: false, sanitizedVariables: new Set() });
    const source = isSourceFunction(fn);
    if (source) fn.params.map(parameterName).filter(Boolean).forEach((param) => {
      put(fn, param, source, false, `${fn.fileName}:${fn.startLine} ${source}`);
      summaries.get(fn.id)!.taintedInputs.add(param);
    });
  }

  let changed = true;
  let iterations = 0;
  let unresolvedCallCount = 0;
  while (changed && iterations < maxIterations) {
    changed = false;
    iterations += 1;
    for (const fn of functions) {
      const sanitizer = isSanitizerFunction(fn);
      for (const node of fn.astControlFlow?.nodes ?? []) {
        const taintedUses = node.uses.filter((variable) => facts.has(key(fn.id, variable)));
        if (!taintedUses.length) continue;
        for (const variable of node.definitions) {
          const sanitized = sanitizer || /sanitize|escape|validate|encode|parameterize|allowlist/i.test([...node.uses, ...node.definitions].join(" "));
          changed = put(fn, variable, `AST ${taintedUses.join(",")}`, sanitized, `${fn.fileName}:${node.startLine} uses -> definitions`) || changed;
          if (sanitized) summaries.get(fn.id)!.sanitizedVariables.add(variable);
        }
        if (node.kind === "return") summaries.get(fn.id)!.taintedReturns = summaries.get(fn.id)!.taintedReturns || !sanitizer;
      }
    }
    unresolvedCallCount = 0;
    for (const edge of edges.filter((item) => !item.kind || item.kind === "call")) {
      const caller = byId.get(edge.from), callee = byId.get(edge.to);
      if (!caller || !callee) { unresolvedCallCount += 1; continue; }
      const call = findCall(caller.body, callee.name);
      if (!call) { unresolvedCallCount += 1; continue; }
      const params = callee.params.map(parameterName);
      call.arguments.forEach((argument, index) => {
        const variable = simpleIdentifier(argument);
        if (!variable || !params[index]) return;
        const source = facts.get(key(caller.id, variable));
        if (!source) return;
        changed = put(callee, params[index], `${caller.name}.${variable}`, source.sanitized || isSanitizerFunction(callee), `${caller.name} -> ${callee.name} 实参/形参 ${variable} -> ${params[index]}`) || changed;
        summaries.get(callee.id)!.taintedInputs.add(params[index]);
      });
      if (call.assignee && summaries.get(callee.id)?.taintedReturns) changed = put(caller, call.assignee, `${callee.name} return`, isSanitizerFunction(callee), `${callee.name} 污点返回 -> ${caller.name}.${call.assignee}`) || changed;
    }
  }

  const sinks = functions.flatMap((fn) => {
    const boundary = dynamicBoundaries.find((item) => item.functionId === fn.id);
    const detectedSinkKind = sinkKind(fn) || boundary?.kind;
    if (!detectedSinkKind) return [];
    const local = [...facts.values()].filter((fact) => fact.functionId === fn.id);
    const exposed = local.filter((fact) => !fact.sanitized);
    return [{
      functionId: fn.id,
      functionName: fn.name,
      sinkKind: detectedSinkKind,
      taintedVariables: local.map((fact) => fact.variable),
      status: exposed.length ? "exposed" as const : local.length ? "sanitized" as const : "candidate" as const,
      evidence: local.length ? [...local.flatMap((fact) => fact.evidence), ...(boundary?.evidence ?? [])].slice(0, 12) : [...(boundary?.evidence ?? []), "sink 已识别，但尚未解析到变量级污点事实。"],
    }];
  });
  return {
    variables: [...facts.values()],
    sinks,
    functionSummaries: Object.fromEntries([...summaries].map(([id, summary]) => [id, { taintedInputs: [...summary.taintedInputs], taintedReturns: summary.taintedReturns, sanitizedVariables: [...summary.sanitizedVariables] }])),
    iterations,
    converged: !changed,
    unresolvedCallCount,
    dynamicBoundaryCount: dynamicBoundaries.length,
    evidence: [
      `${facts.size} 个变量级污点事实，${sinks.length} 个敏感 sink，固定点 ${!changed ? "已收敛" : "达到上限"}于 ${iterations} 轮。`,
      `跨过程实参/形参与返回值传播已启用；未解析调用 ${unresolvedCallCount}。`,
      `动态边界 ${dynamicBoundaries.length} 个；没有边界 trace 的 FFI、反射和动态代码保持 candidate。`,
    ],
  };
}

function isSourceFunction(fn: FunctionInfo) {
  const signal = `${fn.name} ${(fn.externalInputs ?? []).join(" ")} ${(fn.params ?? []).join(" ")}`;
  if (/request|input|stdin|argv|query|param|header|cookie|upload|socket|message|event/i.test(signal)) return "external input source";
  return fn.externalInputs?.length ? "declared external input" : "";
}
function isSanitizerFunction(fn: FunctionInfo) { return /sanitize|escape|validate|encode|parameterize|allowlist|permission|authorize|verify/i.test(`${fn.name} ${(fn.validations ?? []).join(" ")}`); }
function sinkKind(fn: FunctionInfo) {
  const signal = `${fn.name} ${fn.body} ${(fn.sideEffects ?? []).join(" ")}`;
  if (/execute|query|rawsql|cursor\.execute/i.test(signal)) return "sql";
  if (/exec|spawn|system\s*\(|runtime\.getruntime/i.test(signal)) return "command";
  if (/writefile|open\s*\(|sendfile|path\.join/i.test(signal)) return "file";
  if (/fetch|request|http|socket/i.test(signal)) return "network";
  if (/innerhtml|render|template/i.test(signal)) return "dom-template";
  return "";
}
function key(functionId: string, variable: string) { return `${functionId}::${variable}`; }
function parameterName(value: string) { return value.split(/[:=]/)[0].replace(/^(?:const|let|var|final|mut|ref|in|out)\s+/, "").trim().split(/\s+/).at(-1) ?? ""; }
function simpleIdentifier(value: string) { return value.trim().match(/^[A-Za-z_$][\w$]*$/)?.[0] ?? ""; }
function findCall(body: string, callee: string) {
  const escaped = callee.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:([A-Za-z_$][\\w$]*)\\s*=\\s*)?(?:\\b|\\.)${escaped}\\s*\\(([^)]*)\\)`).exec(body);
  return match ? { assignee: match[1] ?? "", arguments: match[2].split(",").map((item) => item.trim()) } : null;
}
