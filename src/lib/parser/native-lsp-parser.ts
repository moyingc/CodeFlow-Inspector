import type {
  CodeFile,
  FunctionInfo,
  GraphEdge,
  ParserCapability,
  ParserDiagnostic,
} from "@/src/lib/analysis/types";
import type { WorkspaceParseResult } from "@/src/lib/parser/local-parser";
import type { NativeAstWorkspaceReport } from "@/src/lib/parser/native-ast-parser";

type NativeInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type NativeLspToolReport = {
  id: "pyright" | "jdtls" | "clangd" | "gopls" | "rust-analyzer";
  label: string;
  command: string;
  available: boolean;
  status: "available" | "missing" | "disabled" | "skipped" | "executed" | "partial" | "failed";
  languageCount: number;
  languages: string[];
  symbolCount: number;
  diagnosticCount: number;
  documentSymbolCount: number;
  macroExpansionCount: number;
  durationMs: number;
  evidence: string;
};

export type NativeLspSymbolFact = {
  symbolId: string;
  adapter: string;
  hover: string;
  referenceCount: number;
  references: string[];
  definitions: string[];
  confidence: number;
  evidence: string[];
};

export type NativeLspWorkspaceReport = {
  status: "ready" | "partial" | "unavailable" | "available" | "enriched" | "failed";
  availableCount: number;
  executedCount: number;
  toolCount: number;
  tools: NativeLspToolReport[];
  symbolFacts: NativeLspSymbolFact[];
  diagnostics: Array<{
    adapter: string;
    fileName: string;
    line: number;
    column: number;
    severity: "Error" | "Warning" | "Information" | "Hint" | "Unknown";
    message: string;
    code: string;
    source: string;
  }>;
  macroFacts: Array<{
    macroId: string;
    adapter: string;
    name: string;
    fileName: string;
    line: number;
    expansion: string;
    confidence: number;
    evidence: string;
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

export async function inspectNativeLspTools(): Promise<NativeLspWorkspaceReport | null> {
  const invoke = nativeInvoke();
  if (!invoke) return null;
  return invoke("codeflow_lsp_availability");
}

export async function parseWorkspaceWithNativeLsp(
  projectId: string,
  files: CodeFile[],
  ast: NativeAstWorkspaceReport,
): Promise<NativeLspWorkspaceReport | null> {
  const invoke = nativeInvoke();
  if (!invoke) return null;
  return invoke("codeflow_parse_workspace_lsp", {
    request: {
      projectId,
      files: files.map((file) => ({
        path: file.name,
        content: file.content,
        language: file.language,
      })),
      symbols: ast.functions.map((fact) => ({
        id: fact.id,
        fileName: fact.fileName,
        language: fact.language,
        name: fact.name,
        line: fact.nameLine,
        column: fact.nameColumn,
      })),
      macroSites: ast.macroSites.map((site) => ({
        id: site.id,
        fileName: site.fileName,
        language: site.language,
        name: site.name,
        line: site.line,
        column: site.column,
      })),
      timeoutMs: 8_000,
    },
  });
}

export function mergeNativeLspReport(
  base: WorkspaceParseResult,
  report: NativeLspWorkspaceReport | null,
): WorkspaceParseResult {
  if (!report) return base;

  const functions = base.functions.map((fn) => ({
    ...fn,
    calls: [...fn.calls],
    parseEvidence: [...(fn.parseEvidence ?? [])],
  }));
  const factsByAstId = new Map(report.symbolFacts.map((fact) => [fact.symbolId, fact]));
  const functionsByAstId = new Map<string, FunctionInfo>();
  let mergedFunctions = 0;
  let confidenceGain = 0;

  for (const fn of functions) {
    const astId = fn.parseEvidence?.find((item) => item.startsWith("ast-fact:"))?.slice(9);
    if (!astId) continue;
    functionsByAstId.set(astId, fn);
    const fact = factsByAstId.get(astId);
    if (!fact) continue;
    const before = fn.confidence;
    fn.confidence = Math.max(fn.confidence, fact.confidence);
    fn.parser = `${fn.parser ?? "Tree-sitter"} + ${fact.adapter}`;
    fn.parseEvidence = Array.from(
      new Set([
        ...(fn.parseEvidence ?? []),
        ...fact.evidence,
        `${fact.adapter} references:${fact.referenceCount}`,
        ...fact.definitions.slice(0, 3).map((item) => `${fact.adapter} definition:${item}`),
        ...(fact.hover ? [`${fact.adapter} hover:${compact(fact.hover, 360)}`] : []),
      ]),
    );
    const semanticReturn = inferReturnType(fact.hover, fn.name);
    if (
      semanticReturn &&
      (!fn.returnType || ["unknown", "inferred"].includes(fn.returnType))
    ) {
      fn.returnType = semanticReturn;
      fn.outputs = [semanticReturn];
      fn.dataShape = `(${fn.params.join(", ") || "void"}) -> ${semanticReturn}`;
    }
    confidenceGain += Math.max(0, fn.confidence - before);
    mergedFunctions += 1;
  }
  for (const macro of report.macroFacts) {
    const owner = functions.find(
      (fn) =>
        sameFile(fn.fileName, macro.fileName) &&
        macro.line >= fn.startLine &&
        macro.line <= fn.endLine,
    );
    if (!owner) continue;
    owner.parseEvidence = Array.from(
      new Set([
        ...(owner.parseEvidence ?? []),
        `${macro.adapter} macro:${macro.name}`,
        macro.evidence,
        `${macro.adapter} expansion:${compact(macro.expansion, 500)}`,
      ]),
    );
    owner.confidence = Math.max(owner.confidence, macro.confidence);
  }

  const edges = mergeReferenceEdges(base.edges, functions, report.symbolFacts, functionsByAstId);
  const diagnostics = [
    ...base.report.diagnostics,
    ...report.diagnostics.map(toParserDiagnostic),
  ];
  const executedTools = report.tools.filter((tool) =>
    ["executed", "partial"].includes(tool.status),
  );
  const missingTools = report.tools.filter((tool) => tool.status === "missing");
  const addedEdges = Math.max(0, edges.length - base.edges.length);
  const documentSymbolCount = executedTools.reduce(
    (sum, tool) => sum + tool.documentSymbolCount,
    0,
  );
  const macroExpansionCount = report.macroFacts.length;

  return {
    functions,
    declarations: base.declarations,
    edges,
    report: {
      ...base.report,
      adapterName: `${base.report.adapterName} + native LSP semantic fusion`,
      reliabilityScore: Math.min(
        99,
        base.report.reliabilityScore +
          Math.min(6, executedTools.length * 2) +
          (mergedFunctions ? 1 : 0),
      ),
      functionCount: functions.length,
      edgeCount: edges.length,
      languageCoverage: enrichLanguageCoverage(base, report),
      diagnostics,
      capabilities: activateLspCapability(base.report.capabilities, report),
      enhancement: {
        status: executedTools.length ? "merged" : base.report.enhancement.status,
        source: `${base.report.enhancement.source} + LSP`,
        mergedFunctions:
          base.report.enhancement.mergedFunctions + mergedFunctions,
        addedFunctions: base.report.enhancement.addedFunctions,
        addedEdges: base.report.enhancement.addedEdges + addedEdges,
        confidenceGain: base.report.enhancement.confidenceGain + confidenceGain,
        evidence: `${base.report.enhancement.evidence} LSP 执行 ${executedTools.length} 个适配器，返回 ${documentSymbolCount} 个文档符号、${mergedFunctions} 个函数语义事实、${macroExpansionCount} 个宏展开事实、${report.diagnostics.length} 条编译诊断。`,
        next: missingTools.length
          ? `当前机器缺少 ${missingTools.map((tool) => tool.label).join("、")}；安装后默认导入链会自动启用，不会伪装为已执行。`
          : "所有目标 LSP 均可用；继续用真实项目校准超时与宏调用位置覆盖。",
      },
      evidence: [
        ...base.report.evidence,
        ...report.evidence,
        ...executedTools.map(
          (tool) =>
            `${tool.label}: ${tool.status}, ${tool.symbolCount} semantic facts, ${tool.diagnosticCount} diagnostics`,
        ),
      ],
    },
  };
}

function enrichLanguageCoverage(
  base: WorkspaceParseResult,
  report: NativeLspWorkspaceReport,
) {
  return base.report.languageCoverage?.map((coverage) => {
    const language = normalizeLanguage(coverage.language);
    if (["typescript", "javascript"].includes(language)) {
      const compilerActive = base.report.capabilities.some(
        (capability) => capability.layer === "Compiler API" && capability.status === "active",
      );
      return {
        ...coverage,
        semanticLayer: "TypeScript Compiler API",
        semanticStatus: compilerActive ? ("executed" as const) : ("missing" as const),
      };
    }
    const tool = report.tools.find((item) =>
      item.languages.map(normalizeLanguage).includes(language),
    );
    if (!tool) {
      return {
        ...coverage,
        semanticLayer: "Tree-sitter AST",
        semanticStatus: "not-applicable" as const,
      };
    }
    const semanticStatus = tool.status === "executed"
      ? "executed"
      : tool.status === "partial"
        ? "partial"
        : "missing";
    return {
      ...coverage,
      semanticLayer: tool.label,
      semanticStatus,
    };
  });
}

function normalizeLanguage(language: string) {
  const normalized = language.trim().toLowerCase();
  if (["c/c++", "cpp"].includes(normalized)) return "c++";
  return normalized;
}

function mergeReferenceEdges(
  baseEdges: GraphEdge[],
  functions: FunctionInfo[],
  facts: NativeLspSymbolFact[],
  functionsByAstId: Map<string, FunctionInfo>,
) {
  const edges = baseEdges.map((edge) => ({ ...edge }));
  const edgeByKey = new Map(edges.map((edge) => [`${edge.from}->${edge.to}`, edge]));
  for (const fact of facts) {
    const target = functionsByAstId.get(fact.symbolId);
    if (!target) continue;
    for (const location of fact.references) {
      const parsed = parseLocation(location);
      if (!parsed) continue;
      const source = functions.find(
        (fn) =>
          sameFile(fn.fileName, parsed.fileName) &&
          parsed.line >= fn.startLine &&
          parsed.line <= fn.endLine,
      );
      if (!source || source.id === target.id) continue;
      const key = `${source.id}->${target.id}`;
      const existing = edgeByKey.get(key);
      if (existing) {
        existing.confidence = Math.max(existing.confidence ?? 0, fact.confidence);
        existing.evidence = `${existing.evidence ?? "call edge"} · ${fact.adapter} reference ${location}`;
        continue;
      }
      const edge: GraphEdge = {
        from: source.id,
        to: target.id,
        kind: "call",
        confidence: fact.confidence,
        evidence: `${fact.adapter} cross-file reference ${location}`,
      };
      edges.push(edge);
      edgeByKey.set(key, edge);
    }
  }
  return edges;
}

function activateLspCapability(
  capabilities: ParserCapability[],
  report: NativeLspWorkspaceReport,
) {
  const executed = report.tools.filter((tool) =>
    ["executed", "partial"].includes(tool.status),
  );
  const relevant = report.tools.filter((tool) => tool.status !== "skipped");
  const coverage = relevant.length
    ? Math.round((executed.length / relevant.length) * 100)
    : 0;
  return capabilities.map((capability) => {
    if (capability.layer !== "LSP") return capability;
    return {
      ...capability,
      status: executed.length ? ("active" as const) : ("missing" as const),
      coverage,
      evidence: report.tools
        .filter((tool) => tool.status !== "skipped")
        .map((tool) => `${tool.label}:${tool.status}`)
        .join(" · ") || "当前项目没有目标 LSP 语言。",
      next: report.tools.some((tool) => tool.status === "missing")
        ? "补齐本机缺失的 language server；默认导入链会自动检测并启用。"
        : "使用跨文件项目继续验证 definition、references、hover 和 diagnostics。",
    };
  });
}

function toParserDiagnostic(
  item: NativeLspWorkspaceReport["diagnostics"][number],
  index: number,
): ParserDiagnostic {
  return {
    id: `lsp-${item.adapter}-${index}-${item.fileName}-${item.line}`,
    fileName: item.fileName,
    severity:
      item.severity === "Error"
        ? "Risk"
        : item.severity === "Warning"
          ? "Warning"
          : "Info",
    message: `${item.source} 编译诊断：${item.message}`,
    evidence: `${item.adapter} · ${item.fileName}:${item.line}:${item.column + 1}${item.code ? ` · ${item.code}` : ""}`,
    confidence: 99,
  };
}

function inferReturnType(hover: string, functionName: string) {
  const plain = hover.replace(/```[\w+-]*|```/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return "";
  const arrow = plain.match(/->\s*([A-Za-z_][\w.[\], <>:?|&*]*)/);
  if (arrow?.[1]) return arrow[1].trim();
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cStyle = plain.match(
    new RegExp(`\\b([A-Za-z_][\\w:<>,\\s*&?\\[\\]]{0,100})\\s+${escaped}\\s*\\(`),
  );
  const candidate = cStyle?.[1]?.trim();
  if (
    candidate &&
    !/^(def|fn|func|function|method|public|private|protected|static|async)$/i.test(
      candidate,
    )
  ) {
    return candidate;
  }
  return "";
}

function parseLocation(value: string) {
  const match = value.match(/^(.*):(\d+)$/);
  if (!match) return null;
  return { fileName: match[1], line: Number(match[2]) };
}

function sameFile(left: string, right: string) {
  const a = left.replace(/\\/g, "/");
  const b = right.replace(/\\/g, "/");
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function compact(value: string, length: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized;
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
