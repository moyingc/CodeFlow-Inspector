import type {
  CodeFile,
  FunctionInfo,
  GraphEdge,
  ParserCapability,
  ParserDiagnostic,
} from "@/src/lib/analysis/types";
import type { WorkspaceParseResult } from "@/src/lib/parser/local-parser";

type NativeInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type CompilerFunctionFact = {
  id: string;
  name: string;
  shortName: string;
  fileName: string;
  startLine: number;
  endLine: number;
  params: string[];
  returnType: string;
  calls: string[];
  confidence: number;
  evidence: string[];
};

export type NativeTypeScriptCompilerReport = {
  adapterName: "NodeTypeScriptServiceAdapter";
  mode: "Compiler API";
  status: "executed" | "skipped" | "failed";
  functionCount: number;
  edgeCount: number;
  diagnosticCount: number;
  functions: CompilerFunctionFact[];
  edges: Array<{ from: string; to: string; confidence: number; evidence: string }>;
  diagnostics: Array<{
    fileName: string;
    line: number;
    category: string;
    code: number;
    message: string;
  }>;
  evidence: string[];
  transport?: string;
  sandboxStatus?: string;
  durationMs?: number;
};

type NativeWindow = Window & {
  __TAURI__?: { invoke?: NativeInvoke; core?: { invoke?: NativeInvoke } };
  __TAURI_INTERNALS__?: { invoke?: NativeInvoke };
};

export async function parseWorkspaceWithNativeTypeScriptCompiler(
  files: CodeFile[],
): Promise<NativeTypeScriptCompilerReport | null> {
  const invoke = nativeInvoke();
  if (!invoke) return null;
  try {
    return await invoke("codeflow_parse_typescript_compiler", {
      files: files.map((file) => ({
        path: file.name,
        content: file.content,
        language: file.language,
      })),
    });
  } catch (error) {
    return {
      adapterName: "NodeTypeScriptServiceAdapter",
      mode: "Compiler API",
      status: "failed",
      functionCount: 0,
      edgeCount: 0,
      diagnosticCount: 0,
      functions: [],
      edges: [],
      diagnostics: [],
      evidence: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export function mergeNativeTypeScriptCompilerReport(
  files: CodeFile[],
  base: WorkspaceParseResult,
  report: NativeTypeScriptCompilerReport | null,
): WorkspaceParseResult {
  if (!report || report.status === "skipped") return base;
  if (report.status === "failed") {
    return {
      ...base,
      report: {
        ...base.report,
        capabilities: setCompilerCapability(base.report.capabilities, false, report),
        evidence: [...base.report.evidence, `TypeScript Compiler failed: ${report.evidence.join(" ")}`],
      },
    };
  }

  const functions = base.functions.map((fn) => ({
    ...fn,
    calls: [...fn.calls],
    parseEvidence: [...(fn.parseEvidence ?? [])],
  }));
  const compilerToFunction = new Map<string, FunctionInfo>();
  let mergedFunctions = 0;
  let addedFunctions = 0;
  let confidenceGain = 0;

  for (const fact of report.functions) {
    let target = functions.find(
      (fn) =>
        sameFile(fn.fileName, fact.fileName) &&
        (fn.name === fact.name || fn.name.split(/[.:]/).at(-1) === fact.shortName) &&
        Math.abs(fn.startLine - fact.startLine) <= 3,
    );
    if (!target) {
      target = createCompilerFunction(files, fact);
      functions.push(target);
      addedFunctions += 1;
    } else {
      const before = target.confidence;
      target.params = fact.params.length ? fact.params : target.params;
      target.returnType = betterType(target.returnType, fact.returnType);
      target.outputs = target.returnType === "void" ? target.outputs : [target.returnType];
      target.dataShape = `(${target.params.join(", ") || "void"}) -> ${target.returnType}`;
      target.confidence = Math.max(target.confidence, fact.confidence);
      target.source = "Parser Fact";
      target.parser = `${target.parser ?? "Tree-sitter"} + NodeTypeScriptServiceAdapter`;
      target.parseEvidence = Array.from(new Set([
        ...(target.parseEvidence ?? []),
        ...fact.evidence,
        "compiler-backed type and symbol fact",
        `compiler-fact:${fact.id}`,
      ]));
      confidenceGain += Math.max(0, target.confidence - before);
      mergedFunctions += 1;
    }
    compilerToFunction.set(fact.id, target);
  }

  for (const fact of report.functions) {
    const source = compilerToFunction.get(fact.id);
    if (!source) continue;
    const calls = fact.calls
      .map((call) => functions.find((fn) => fn.name === call || fn.name.split(/[.:]/).at(-1) === call)?.id)
      .filter((id): id is string => Boolean(id));
    source.calls = Array.from(new Set([...source.calls, ...calls]));
  }

  const edges = mergeCompilerEdges(base.edges, report, compilerToFunction);
  const diagnostics: ParserDiagnostic[] = [
    ...base.report.diagnostics,
    ...report.diagnostics.map((item, index) => ({
      id: `ts-compiler-${index}-${item.fileName}-${item.line}`,
      fileName: item.fileName,
      severity: item.category === "Error" ? ("Risk" as const) : ("Warning" as const),
      message: item.message,
      evidence: `TypeScript ${item.category} TS${item.code} · line ${item.line}`,
      confidence: 99,
    })),
  ];
  const addedEdges = Math.max(0, edges.length - base.edges.length);

  return {
    functions,
    declarations: base.declarations,
    edges,
    report: {
      ...base.report,
      adapterName: `${base.report.adapterName} + Node TypeScript Compiler`,
      reliabilityScore: Math.min(99, base.report.reliabilityScore + (mergedFunctions ? 3 : 1)),
      functionCount: functions.length,
      edgeCount: edges.length,
      diagnostics,
      languageCoverage: base.report.languageCoverage?.map((item) =>
        ["TypeScript", "JavaScript"].includes(item.language)
          ? {
              ...item,
              semanticLayer: "TypeScript Compiler API",
              semanticStatus: "executed" as const,
            }
          : item,
      ),
      capabilities: setCompilerCapability(base.report.capabilities, true, report),
      enhancement: {
        ...base.report.enhancement,
        source: `${base.report.enhancement.source} + NodeTypeScriptServiceAdapter`,
        mergedFunctions: base.report.enhancement.mergedFunctions + mergedFunctions,
        addedFunctions: base.report.enhancement.addedFunctions + addedFunctions,
        addedEdges: base.report.enhancement.addedEdges + addedEdges,
        confidenceGain: base.report.enhancement.confidenceGain + confidenceGain,
        evidence: `${base.report.enhancement.evidence} TypeScript Compiler 融合 ${mergedFunctions} 个函数，新增 ${addedFunctions} 个函数、${addedEdges} 条调用边和 ${report.diagnosticCount} 条编译诊断。`,
      },
      evidence: [
        ...base.report.evidence,
        ...report.evidence.map((item) => `TypeScript Compiler: ${item}`),
        `${report.transport ?? "controlled worker"} · sandbox ${report.sandboxStatus ?? "unknown"}`,
      ],
    },
  };
}

function setCompilerCapability(
  capabilities: ParserCapability[],
  active: boolean,
  report: NativeTypeScriptCompilerReport,
) {
  return capabilities.map((capability) => capability.layer === "Compiler API"
    ? {
        ...capability,
        status: active ? ("active" as const) : ("missing" as const),
        coverage: active ? 100 : 0,
        evidence: active
          ? `${report.functionCount} 个函数、${report.edgeCount} 条调用边和 ${report.diagnosticCount} 条诊断来自 TypeScript Compiler API。`
          : report.evidence.join(" "),
        next: active
          ? "继续用大型 TS/JS 项目校准泛型、装饰器和动态 import。"
          : "检查受控 Node runtime 与 TypeScript worker 资源。",
      }
    : capability);
}

function mergeCompilerEdges(
  base: GraphEdge[],
  report: NativeTypeScriptCompilerReport,
  facts: Map<string, FunctionInfo>,
) {
  const edges = base.map((edge) => ({ ...edge }));
  const keys = new Set(edges.map((edge) => `${edge.from}->${edge.to}`));
  for (const edge of report.edges) {
    const from = facts.get(edge.from)?.id;
    const to = facts.get(edge.to)?.id;
    if (!from || !to || from === to || keys.has(`${from}->${to}`)) continue;
    edges.push({
      from,
      to,
      kind: "call",
      confidence: edge.confidence,
      evidence: `TypeScript Compiler API · ${edge.evidence}`,
    });
    keys.add(`${from}->${to}`);
  }
  return edges;
}

function createCompilerFunction(files: CodeFile[], fact: CompilerFunctionFact): FunctionInfo {
  const file = files.find((item) => sameFile(item.name, fact.fileName));
  const returnType = fact.returnType || "unknown";
  return {
    id: `compiler:${fact.id}`,
    name: fact.name,
    fileId: file?.id ?? fact.fileName,
    fileName: fact.fileName,
    language: file?.language ?? "TypeScript",
    startLine: fact.startLine,
    endLine: fact.endLine,
    params: fact.params,
    returnType,
    outputs: returnType === "void" ? ["state change/void"] : [returnType],
    calls: [],
    summary: `${fact.name} 由 TypeScript Compiler API 确认类型、符号和调用。`,
    dataShape: `(${fact.params.join(", ") || "void"}) -> ${returnType}`,
    complexity: 1,
    category: "业务",
    body: file?.content.split("\n").slice(fact.startLine - 1, fact.endLine).join("\n") ?? "",
    sideEffects: [],
    externalInputs: fact.params.length ? ["函数参数"] : [],
    validations: [],
    risks: [],
    source: "Parser Fact",
    confidence: fact.confidence,
    parser: "NodeTypeScriptServiceAdapter",
    parseEvidence: [...fact.evidence, "compiler-backed type and symbol fact", `compiler-fact:${fact.id}`],
  };
}

function betterType(current: string, incoming: string) {
  if (!incoming || incoming === "unknown") return current;
  if (!current || ["unknown", "inferred"].includes(current)) return incoming;
  return current;
}

function sameFile(left: string, right: string) {
  const normalize = (value: string) => value.replaceAll("\\", "/").replace(/^\.\//, "");
  return normalize(left) === normalize(right);
}

function nativeInvoke(): NativeInvoke | null {
  if (typeof window === "undefined") return null;
  const host = window as NativeWindow;
  return host.__TAURI__?.core?.invoke ?? host.__TAURI__?.invoke ?? host.__TAURI_INTERNALS__?.invoke ?? null;
}
