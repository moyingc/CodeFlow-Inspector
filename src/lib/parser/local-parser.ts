import type {
  CodeFile,
  FunctionInfo,
  GraphEdge,
  ParserCapability,
  ParserDiagnostic,
  ParserReport,
  TypeDeclarationInfo,
} from "@/src/lib/analysis/types";
import {
  attachWorkspaceCalls,
  buildEdges,
  parseFunctionsFromFile,
} from "@/src/lib/parser/heuristic-parser";
import {
  isTypeScriptLikeFile,
  parseTypeScriptFunctionsFromFile,
} from "@/src/lib/parser/typescript-parser";
import { parseTypeDeclarationsFromFile } from "@/src/lib/parser/type-declaration-parser";

type ParserFileResult = {
  functions: FunctionInfo[];
  declarations: TypeDeclarationInfo[];
  diagnostics: ParserDiagnostic[];
  evidence: string[];
};

export type ParserAdapter = {
  name: string;
  mode: ParserReport["mode"];
  languages: string[];
  parseFile: (file: CodeFile) => ParserFileResult;
};

export type WorkspaceParseResult = {
  functions: FunctionInfo[];
  declarations: TypeDeclarationInfo[];
  edges: GraphEdge[];
  report: ParserReport;
};

const codeLanguages = [
  "TypeScript",
  "JavaScript",
  "Python",
  "Go",
  "Rust",
  "Java",
  "C#",
  "C",
  "C++",
  "PHP",
  "Ruby",
  "Kotlin",
  "Swift",
  "Shell",
  "SQL",
];

export const localParserAdapter: ParserAdapter = {
  name: "Hybrid Local ParserAdapter",
  mode: "Deterministic Local",
  languages: codeLanguages,
  parseFile(file) {
    if (!codeLanguages.includes(file.language)) {
      return {
        functions: [],
        declarations: [],
        diagnostics: [
          {
            id: `${file.id}-non-code`,
            fileName: file.name,
            severity: "Info",
            message: "该文件作为环境或配置载体参与分析，不进入函数抽离。",
            evidence: file.language,
            confidence: 92,
          },
        ],
        evidence: [`${file.name}: environment/config carrier`],
      };
    }

    const tsFunctions = isTypeScriptLikeFile(file) ? parseTypeScriptFunctionsFromFile(file) : [];
    const parsedFunctions = tsFunctions.length ? tsFunctions : parseFunctionsFromFile(file);
    const functions = parsedFunctions.map((fn) => ({
      ...fn,
      parser: fn.parser ?? "Local ParserAdapter",
      parseEvidence: [
        ...(fn.parseEvidence ?? []),
        "adapter contract",
        tsFunctions.length ? "TS/JS syntax route" : "deterministic local scan",
      ],
    }));
    const declarations = parseTypeDeclarationsFromFile(file);

    return {
      functions,
      declarations,
      diagnostics: buildFileDiagnostics(file, functions, declarations),
      evidence: [
        `${file.name}: ${functions.length} function candidates`,
        `${file.name}: ${declarations.length} type/model declarations`,
        tsFunctions.length ? `${file.name}: TS/JS syntax scanner active` : `${file.name}: heuristic fallback active`,
        ...extractImportEvidence(file).slice(0, 4),
      ],
    };
  },
};

export function parseWorkspace(
  files: CodeFile[],
  adapter: ParserAdapter = localParserAdapter,
): WorkspaceParseResult {
  const fileResults = files.map((file) => adapter.parseFile(file));
  const functions = attachWorkspaceCalls(fileResults.flatMap((result) => result.functions));
  const declarations = fileResults.flatMap((result) => result.declarations);
  const edges = buildEdges(functions);
  const diagnostics = [
    ...fileResults.flatMap((result) => result.diagnostics),
    ...buildWorkspaceDiagnostics(files, functions, declarations, edges),
  ];
  const languages = Array.from(new Set(files.map((file) => file.language))).sort();
  const structuralFacts = [...functions, ...declarations];
  const confidenceAverage =
    structuralFacts.reduce((sum, item) => sum + item.confidence, 0) / Math.max(1, structuralFacts.length);
  const warningPenalty = diagnostics.filter((item) => item.severity !== "Info").length * 4;
  const edgeBonus = edges.length ? 7 : functions.length > 1 ? -5 : 0;
  const reliabilityScore = Math.max(
    42,
    Math.min(93, Math.round(confidenceAverage + edgeBonus - warningPenalty)),
  );

  return {
    functions,
    declarations,
    edges,
    report: {
      adapterName: adapter.name,
      mode: adapter.mode,
      reliabilityScore,
      languages,
      functionCount: functions.length,
      declarationCount: declarations.length,
      edgeCount: edges.length,
      diagnostics,
      capabilities: buildParserCapabilities(files, functions, declarations, edges),
      enhancement: {
        status: "base",
        source: "ClientSafeParser",
        mergedFunctions: 0,
        addedFunctions: 0,
        addedEdges: 0,
        confidenceGain: 0,
        evidence: "前端先生成候选结果；Tauri 桌面端会自动调用 native Tree-sitter 工作区解析器并替换候选事实。",
        next: "等待桌面 AST 返回后自动刷新函数图、水系图、诊断与代码索引。",
      },
      evidence: [
        "No remote model API",
        "ParserAdapter contract enabled",
        "Balanced block boundary scan",
        "Workspace-wide call resolution",
        ...fileResults.flatMap((result) => result.evidence).slice(0, 8),
      ],
    },
  };
}

function buildParserCapabilities(
  files: CodeFile[],
  functions: FunctionInfo[],
  declarations: TypeDeclarationInfo[],
  edges: GraphEdge[],
): ParserCapability[] {
  const languages = new Set(files.map((file) => file.language));
  const hasTsJs = languages.has("TypeScript") || languages.has("JavaScript");
  const hasPython = languages.has("Python");
  const tsSyntaxFunctions = functions.filter((fn) => fn.parser === "TypeScriptSyntaxScanner").length;
  const lowConfidenceCount = functions.filter((fn) => fn.confidence < 70).length;
  const typedFunctions = functions.filter((fn) => fn.returnType !== "unknown" && fn.returnType !== "inferred").length;
  const typedCoverage = Math.round((typedFunctions / Math.max(1, functions.length)) * 100);

  return [
    {
      name: "Python 类型与数据模型抽离",
      layer: "Heuristic",
      status: declarations.length ? "active" : "ready",
      coverage: declarations.length ? 94 : 30,
      evidence: `${declarations.length} 个类、接口或数据模型；字段、继承、配置和直接方法分别建模。`,
      next: "由 Tree-sitter/LSP 补全跨文件继承、泛型实参和框架生成字段。",
    },
    {
      name: "平衡块函数抽离",
      layer: "Heuristic",
      status: "active",
      coverage: functions.length ? Math.min(88, 56 + functions.length * 4) : 20,
      evidence: `${functions.length} 个函数候选 · ${lowConfidenceCount} 个低置信`,
      next: "继续作为 Tree-sitter 失败时的 fallback。",
    },
    {
      name: "TypeScript 编译器适配",
      layer: "Compiler API",
      status: hasTsJs ? "ready" : "planned",
      coverage: hasTsJs ? Math.max(42, typedCoverage) : 12,
      evidence: tsSyntaxFunctions
        ? `${tsSyntaxFunctions} 个 TS/JS 函数已由前端安全扫描器预处理，Node Compiler 服务原型已就绪。`
        : hasTsJs
          ? "项目可使用本地 typescript 包补类型、符号和引用。"
          : "当前导入代码不含 TS/JS。",
      next: "把 NodeTypeScriptServiceAdapter 接进 Worker/Node 桥，避免主 UI bundle 直接加载 typescript。",
    },
    {
      name: "Tree-sitter 多语言 AST",
      layer: "Tree-sitter",
      status: "ready",
      coverage: 18,
      evidence: "Tauri 内置 native grammar；桌面导入后自动返回函数、方法、参数、语法错误和调用节点。",
      next: "等待当前项目的 native AST 结果完成融合。",
    },
    {
      name: "LSP 语义桥",
      layer: "LSP",
      status: "missing",
      coverage: 0,
      evidence: hasPython ? "Python 可优先接 pyright；TS/JS 可接 TypeScript Language Service。" : "等待 language server 适配层。",
      next: "接 definition、references、diagnostics、hover type 和 symbol graph。",
    },
    {
      name: "跨文件调用桥",
      layer: "Bridge",
      status: edges.length ? "active" : "ready",
      coverage: edges.length ? Math.min(86, 45 + edges.length * 5) : 32,
      evidence: `${edges.length} 条 workspace 调用边。`,
      next: "结合 LSP references 消除同名函数误连和漏连。",
    },
  ];
}

function buildFileDiagnostics(
  file: CodeFile,
  functions: FunctionInfo[],
  declarations: TypeDeclarationInfo[],
): ParserDiagnostic[] {
  const diagnostics: ParserDiagnostic[] = [];

  if (!functions.length && !declarations.length && codeLanguages.includes(file.language)) {
    diagnostics.push({
      id: `${file.id}-no-functions`,
      fileName: file.name,
      severity: "Warning",
      message: "该代码文件没有抽离出函数，可能是类方法、宏、匿名回调或语法模式尚未覆盖。",
      evidence: file.language,
      confidence: 68,
    });
  }

  if (!functions.length && declarations.length) {
    diagnostics.push({
      id: `${file.id}-declarations-only`,
      fileName: file.name,
      severity: "Info",
      message: "该文件是数据模型或类型契约文件，没有可执行函数；类型结构已单独抽离。",
      evidence: `${declarations.length} declarations · ${declarations.map((item) => item.name).slice(0, 4).join(", ")}`,
      confidence: 94,
    });
  }

  const lowConfidence = functions.filter((fn) => fn.confidence < 70);
  if (lowConfidence.length) {
    diagnostics.push({
      id: `${file.id}-low-confidence`,
      fileName: file.name,
      severity: "Risk",
      message: "部分函数解析置信度偏低，后续应由 Tree-sitter 或 LSP 补证据。",
      evidence: lowConfidence.map((fn) => fn.name).slice(0, 4).join(", "),
      confidence: 64,
    });
  }

  return diagnostics;
}

function buildWorkspaceDiagnostics(
  files: CodeFile[],
  functions: FunctionInfo[],
  declarations: TypeDeclarationInfo[],
  edges: GraphEdge[],
): ParserDiagnostic[] {
  const diagnostics: ParserDiagnostic[] = [];
  const functionFiles = new Set(functions.map((fn) => fn.fileId));
  const declarationFiles = new Set(declarations.map((item) => item.fileId));
  const sourceFiles = files.filter((file) => codeLanguages.includes(file.language));
  const executableFiles = sourceFiles.filter((file) => functionFiles.has(file.id));
  const isolatedFiles = sourceFiles.filter((file) => !functionFiles.has(file.id) && !declarationFiles.has(file.id));

  if (executableFiles.length > 1 && functions.length > 1 && !edges.length) {
    diagnostics.push({
      id: "workspace-no-call-edges",
      fileName: "workspace",
      severity: "Warning",
      message: "项目有多个代码文件，但没有解析到跨函数调用边，代码树可能不完整。",
      evidence: `${sourceFiles.length} code files, 0 edges`,
      confidence: 62,
    });
  }

  if (isolatedFiles.length) {
    diagnostics.push({
      id: "workspace-isolated-files",
      fileName: "workspace",
      severity: "Info",
      message: "部分代码文件暂时只作为水系支流候选，需要更强语法解析确认连接点。",
      evidence: isolatedFiles.map((file) => file.name).slice(0, 5).join(", "),
      confidence: 72,
    });
  }

  return diagnostics;
}

function extractImportEvidence(file: CodeFile) {
  return Array.from(
    file.content.matchAll(
      /\bimport\s+[^;\n]+|\brequire\s*\([^)]+\)|^\s*from\s+[\w.]+\s+import\s+.+/gm,
    ),
  ).map((match) => `${file.name}: ${match[0].replace(/\s+/g, " ").trim()}`);
}
