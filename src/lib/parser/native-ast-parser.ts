import type {
  CodeFile,
  FunctionInfo,
  GraphEdge,
  ParserCapability,
} from "@/src/lib/analysis/types";
import type { WorkspaceParseResult } from "@/src/lib/parser/local-parser";

type NativeInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type AstFunctionFact = {
  id: string;
  name: string;
  shortName: string;
  fileName: string;
  language: string;
  startLine: number;
  nameLine: number;
  nameColumn: number;
  endLine: number;
  params: string[];
  returnType: string;
  calls: string[];
  complexity: number;
  branchCount: number;
  loopCount: number;
  returnCount: number;
  writeCount: number;
  controlNodes: NonNullable<FunctionInfo["astControlFlow"]>["nodes"];
  controlEdges: NonNullable<FunctionInfo["astControlFlow"]>["edges"];
  confidence: number;
  evidence: string[];
};

export type NativeAstLanguageCoverage = {
  language: string;
  fileCount: number;
  parsedFileCount: number;
  functionCount: number;
  diagnosticCount: number;
  status: "ast-ready" | "ast-warning" | "partial" | "unsupported";
};

type AstEdgeFact = {
  from: string;
  to: string;
  confidence: number;
  evidence: string;
};

type AstMacroFact = {
  id: string;
  name: string;
  fileName: string;
  language: string;
  line: number;
  column: number;
  confidence: number;
  evidence: string;
};

export type NativeAstWorkspaceReport = {
  adapterName: "TauriTreeSitterWorkspaceParser";
  functionCount: number;
  edgeCount: number;
  macroCount: number;
  parsedFileCount: number;
  parsedFiles: string[];
  unsupportedFiles: string[];
  languageCoverage: NativeAstLanguageCoverage[];
  functions: AstFunctionFact[];
  edges: AstEdgeFact[];
  macroSites: AstMacroFact[];
  diagnostics: Array<{
    fileName: string;
    severity: "Info" | "Warning" | "Risk";
    message: string;
    evidence: string;
    line: number;
  }>;
  evidence: string[];
};

type NativeWindow = Window & {
  __TAURI__?: {
    invoke?: NativeInvoke;
    core?: { invoke?: NativeInvoke };
  };
  __TAURI_INTERNALS__?: { invoke?: NativeInvoke };
};

export async function parseWorkspaceWithNativeAst(
  files: CodeFile[],
): Promise<NativeAstWorkspaceReport | null> {
  const invoke = nativeInvoke();
  if (!invoke) return null;
  return invoke("codeflow_parse_workspace_ast", {
    files: files.map((file) => ({
      path: file.name,
      content: file.content,
      language: file.language,
    })),
  });
}

export function mergeNativeAstReport(
  files: CodeFile[],
  base: WorkspaceParseResult,
  ast: NativeAstWorkspaceReport | null,
): WorkspaceParseResult {
  if (!ast) {
    return {
      ...base,
      report: {
        ...base.report,
        enhancement: {
          status: "unavailable",
          source: "TauriTreeSitterWorkspaceParser",
          mergedFunctions: 0,
          addedFunctions: 0,
          addedEdges: 0,
          confidenceGain: 0,
          evidence: "当前不是 Tauri 桌面运行环境，保留候选扫描结果，不声称 AST 已生效。",
          next: "在桌面程序中导入项目后会自动调用本地 Tree-sitter AST 内核。",
        },
      },
    };
  }

  const candidateFunctions = base.functions.map((fn) => ({
    ...fn,
    calls: [...fn.calls],
    parseEvidence: [...(fn.parseEvidence ?? [])],
  }));
  const parsedFiles = new Set(ast.parsedFiles.map(normalizePath));
  const functions = candidateFunctions.filter(
    (fn) => !parsedFiles.has(normalizePath(fn.fileName)),
  );
  const factToFunction = new Map<string, FunctionInfo>();
  let mergedFunctions = 0;
  let addedFunctions = 0;
  let confidenceGain = 0;

  for (const fact of ast.functions) {
    const candidate = candidateFunctions.find(
      (fn) =>
        sameFile(fn.fileName, fact.fileName) &&
        (fn.name === fact.name || fn.name.split(/[.:]/).at(-1) === fact.shortName) &&
        Math.abs(fn.startLine - fact.startLine) <= 3,
    );
    if (candidate) {
      const existing = {
        ...candidate,
        calls: [...candidate.calls],
        parseEvidence: [...(candidate.parseEvidence ?? [])],
      };
      const before = existing.confidence;
      applyAstFact(existing, fact);
      functions.push(existing);
      confidenceGain += Math.max(0, existing.confidence - before);
      mergedFunctions += 1;
      factToFunction.set(fact.id, existing);
      continue;
    }
    const created = createFunctionFromAst(files, fact);
    functions.push(created);
    factToFunction.set(fact.id, created);
    addedFunctions += 1;
  }

  for (const fact of ast.functions) {
    const source = factToFunction.get(fact.id);
    if (!source) continue;
    const resolved = fact.calls
      .map((call) => resolveCall(functions, call, source.fileName))
      .filter((id): id is string => Boolean(id));
    source.calls = Array.from(new Set(resolved));
  }

  const activeFunctionIds = new Set(functions.map((fn) => fn.id));
  const retainedBaseEdges = base.edges.filter(
    (edge) => activeFunctionIds.has(edge.from) && activeFunctionIds.has(edge.to),
  );
  const edges = mergeAstEdges(retainedBaseEdges, ast.edges, factToFunction);
  const addedEdges = Math.max(0, edges.length - retainedBaseEdges.length);
  const diagnostics = [
    ...base.report.diagnostics.filter(
      (item) =>
        !["workspace-no-call-edges", "workspace-isolated-files"].includes(item.id) &&
        !item.id.endsWith("-low-confidence"),
    ),
    ...ast.diagnostics.map((item, index) => ({
      id: `tree-sitter-${index}-${item.fileName}-${item.line}`,
      fileName: item.fileName,
      severity: item.severity,
      message: item.message,
      evidence: `${item.evidence} · line ${item.line}`,
      confidence: 98,
    })),
  ];

  return {
    functions,
    declarations: base.declarations,
    edges,
    report: {
      ...base.report,
      adapterName: "Tauri Tree-sitter AST + local semantic fusion",
      mode: "AST Ready",
      reliabilityScore: ast.diagnostics.length
        ? Math.max(72, Math.min(94, 88 - ast.diagnostics.length * 2))
        : Math.min(98, 91 + Math.min(7, Math.round(ast.parsedFileCount / 2))),
      functionCount: functions.length,
      edgeCount: edges.length,
      languageCoverage: ast.languageCoverage,
      diagnostics,
      capabilities: activateTreeSitterCapability(base.report.capabilities, ast),
      enhancement: {
        status: "merged",
        source: ast.adapterName,
        mergedFunctions,
        addedFunctions,
        addedEdges,
        confidenceGain,
        evidence: `${ast.parsedFileCount} 个文件完成 AST 解析；融合 ${mergedFunctions} 个函数，新增 ${addedFunctions} 个函数和 ${addedEdges} 条调用边。`,
        next: ast.unsupportedFiles.length
          ? `仍有 ${ast.unsupportedFiles.length} 个非代码或未配置 grammar 的文件，只作为环境载体。`
          : "继续叠加 LSP 类型、definition、references 和编译诊断。",
      },
      evidence: [
        ...base.report.evidence.filter((item) => !item.includes("heuristic fallback")),
        ...ast.evidence,
        "Tree-sitter facts automatically fused into the active workspace",
      ],
    },
  };
}

function applyAstFact(target: FunctionInfo, fact: AstFunctionFact) {
  target.name = fact.name;
  target.startLine = fact.startLine;
  target.endLine = fact.endLine;
  target.params = fact.params;
  target.returnType = betterType(target.returnType, fact.returnType);
  target.outputs =
    target.returnType && !["void", "unknown", "inferred"].includes(target.returnType)
      ? [target.returnType]
      : target.outputs;
  target.dataShape = `(${fact.params.join(", ") || "void"}) -> ${target.returnType}`;
  target.confidence = Math.max(target.confidence, fact.confidence);
  target.complexity = fact.complexity;
  target.source = "Parser Fact";
  target.parser = "TauriTreeSitterWorkspaceParser";
  target.parseEvidence = Array.from(
    new Set([...(target.parseEvidence ?? []), ...fact.evidence, "native grammar AST"]),
  );
  target.parseEvidence.push(`ast-fact:${fact.id}`);
  target.astControlFlow = { nodes: fact.controlNodes, edges: fact.controlEdges };
}

function createFunctionFromAst(files: CodeFile[], fact: AstFunctionFact): FunctionInfo {
  const file = files.find((item) => sameFile(item.name, fact.fileName));
  const body = file?.content
    .split("\n")
    .slice(Math.max(0, fact.startLine - 1), fact.endLine)
    .join("\n") ?? "";
  const returnType = fact.returnType || "unknown";
  return {
    id: `tree-sitter:${fact.id}`,
    name: fact.name,
    fileId: file?.id ?? fact.fileName,
    fileName: fact.fileName,
    language: fact.language,
    startLine: fact.startLine,
    endLine: fact.endLine,
    params: fact.params,
    returnType,
    outputs: !["void", "unknown", "inferred"].includes(returnType)
      ? [returnType]
      : ["state change/void"],
    calls: [],
    summary: `${fact.name} 由 ${fact.language} grammar AST 确认函数边界、参数和调用。`,
    dataShape: `(${fact.params.join(", ") || "void"}) -> ${returnType}`,
    complexity: fact.complexity,
    category: inferCategory(fact.name),
    body,
    sideEffects: [],
    externalInputs: fact.params.length ? ["函数参数"] : [],
    validations: [],
    risks: [],
    source: "Parser Fact",
    confidence: fact.confidence,
    parser: "TauriTreeSitterWorkspaceParser",
    parseEvidence: [...fact.evidence, "native grammar AST", `ast-fact:${fact.id}`],
    astControlFlow: { nodes: fact.controlNodes, edges: fact.controlEdges },
  };
}

function mergeAstEdges(
  baseEdges: GraphEdge[],
  astEdges: AstEdgeFact[],
  facts: Map<string, FunctionInfo>,
) {
  const edges = [...baseEdges];
  const keys = new Set(edges.map((edge) => `${edge.from}->${edge.to}`));
  for (const edge of astEdges) {
    const from = facts.get(edge.from)?.id;
    const to = facts.get(edge.to)?.id;
    if (!from || !to || from === to) continue;
    const key = `${from}->${to}`;
    if (keys.has(key)) continue;
    edges.push({
      from,
      to,
      kind: "call",
      confidence: edge.confidence,
      evidence: `Tree-sitter AST · ${edge.evidence}`,
    });
    keys.add(key);
  }
  return edges;
}

function activateTreeSitterCapability(
  capabilities: ParserCapability[],
  ast: NativeAstWorkspaceReport,
) {
  return capabilities.map((capability) => {
    if (capability.layer === "Tree-sitter") {
      return {
        ...capability,
        status: "active" as const,
        coverage: Math.round(
          (ast.parsedFileCount /
            Math.max(1, ast.parsedFileCount + ast.unsupportedFiles.length)) *
            100,
        ),
        evidence: `${ast.parsedFileCount} 文件、${ast.functionCount} 函数和 ${ast.edgeCount} 调用边来自 native grammar AST。`,
        next: "按语言叠加 LSP 类型、引用和编译诊断。",
      };
    }
    if (capability.layer === "Heuristic") {
      return {
        ...capability,
        status: "ready" as const,
        coverage: Math.min(capability.coverage, 25),
        evidence: "仅在桌面 AST 服务不可用时作为候选 fallback，不参与确认结论。",
        next: "保留为故障恢复，不作为默认事实来源。",
      };
    }
    return capability;
  });
}

function resolveCall(functions: FunctionInfo[], call: string, sourceFile: string) {
  const matches = functions.filter(
    (fn) => fn.name === call || fn.name.split(/[.:]/).at(-1) === call,
  );
  return matches.find((fn) => sameFile(fn.fileName, sourceFile))?.id ??
    (matches.length === 1 ? matches[0].id : "");
}

function betterType(current: string, incoming: string) {
  if (!incoming || incoming === "unknown") return current;
  if (!current || ["unknown", "inferred"].includes(current)) return incoming;
  return current;
}

function sameFile(left: string, right: string) {
  const a = normalizePath(left);
  const b = normalizePath(right);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/");
}

function inferCategory(name: string) {
  const lower = name.toLowerCase();
  if (/parse|read|scan|detect/.test(lower)) return "解析";
  if (/build|render|create|make/.test(lower)) return "构建";
  if (/validate|check|guard|assert/.test(lower)) return "校验";
  if (/simulate|debug|trace|run/.test(lower)) return "仿真";
  if (/load|fetch|query|input/.test(lower)) return "输入";
  if (/save|write|send|export|return/.test(lower)) return "输出";
  if (/model|score|optimize|rank|calculate/.test(lower)) return "模型";
  return "业务";
}

function nativeInvoke(): NativeInvoke | null {
  if (typeof window === "undefined") return null;
  const nativeWindow = window as NativeWindow;
  return (
    nativeWindow.__TAURI__?.core?.invoke ??
    nativeWindow.__TAURI__?.invoke ??
    nativeWindow.__TAURI_INTERNALS__?.invoke ??
    null
  );
}
