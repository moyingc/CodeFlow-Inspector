import type { CodeFile, FunctionInfo, GraphEdge } from "@/src/lib/analysis/types";
import { countLines, escapeRegExp, shorten } from "@/src/lib/analysis/utils";

const codeSnippetsByLanguage: Record<string, RegExp[]> = {
  TypeScript: [
    /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::\s*([^{=>]+))?\s*\{/g,
    /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*([^=]+))?\s*=>/g,
  ],
  JavaScript: [
    /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g,
    /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g,
  ],
  Python: [
    /(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?:/g,
  ],
  Go: [
    /func\s+(?:\([^)]+\)\s*)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*([A-Za-z_][\w[\]*.]*|\([^)]+\))?\s*\{/g,
  ],
  Rust: [
    /(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([^{]+))?\s*\{/g,
  ],
  Java: [
    /(?:public|private|protected|static|final|synchronized|\s)+\s*([A-Za-z_<>\[\]?]+)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g,
  ],
  "C#": [
    /(?:public|private|protected|internal|static|async|override|virtual|\s)+\s*([A-Za-z_<>\[\]?]+)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g,
  ],
  "C++": [
    /(?:[A-Za-z_][\w:<>\*&\s]+)\s+([A-Za-z_]\w*)\s*\(([^;{}]*)\)\s*\{/g,
  ],
  C: [
    /(?:[A-Za-z_][\w\*&\s]+)\s+([A-Za-z_]\w*)\s*\(([^;{}]*)\)\s*\{/g,
  ],
  PHP: [/function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{/g],
  Ruby: [/def\s+([A-Za-z_]\w*[!?=]?)\s*(?:\(([^)]*)\)|([^\n]*))/g],
  Kotlin: [/fun\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?::\s*([^{=]+))?/g],
  Swift: [/func\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([^{]+))?\s*\{/g],
};

const categoryRules = [
  { words: ["parse", "read", "collect", "scan", "detect"], label: "解析" },
  { words: ["build", "render", "create", "make", "compose"], label: "构建" },
  { words: ["validate", "check", "guard", "assert"], label: "校验" },
  { words: ["simulate", "debug", "trace", "step", "run"], label: "仿真" },
  { words: ["load", "fetch", "query", "open", "input"], label: "输入" },
  { words: ["save", "write", "emit", "send", "export", "return"], label: "输出" },
  { words: ["model", "score", "optimize", "rank", "calculate"], label: "模型" },
];

export function parseFunctionsFromFile(file: CodeFile): FunctionInfo[] {
  const language = file.language;
  const patterns = codeSnippetsByLanguage[language] ?? [];
  const matches = patterns.flatMap((pattern) => {
    const scopedPattern = new RegExp(pattern.source, pattern.flags);
    return Array.from(file.content.matchAll(scopedPattern)).map((match) =>
      normalizeMatch(language, match),
    );
  });

  return matches
    .sort((a, b) => a.index - b.index)
    .map((match, index, allMatches) => {
      const start = match.index;
      const fallbackEnd = allMatches[index + 1]?.index ?? file.content.length;
      const end = findFunctionEnd(file.content, start, language, fallbackEnd);
      const body = file.content.slice(start, end);
      const startLine = countLines(file.content.slice(0, start));
      const endLine = startLine + countLines(body);
      const params = normalizeParams(match.params);
      const returnType = normalizeReturnType(match.returnType, body);
      const outputs = inferOutputs(body, returnType);
      const externalInputs = inferExternalInputs(match.name, body, params);
      const validations = inferValidations(body);
      const sideEffects = inferSideEffects(body);
      const risks = inferFunctionRisks(body);
      const confidence = inferParseConfidence(language, body, returnType);

      return {
        id: `${file.id}:${match.name}:${startLine}`,
        name: match.name,
        fileId: file.id,
        fileName: file.name,
        language,
        startLine,
        endLine,
        params,
        returnType,
        outputs,
        calls: [],
        summary: summarizeFunction(match.name, body, params, outputs),
        dataShape: inferDataShape(params, returnType),
        complexity: inferComplexity(body),
        category: inferCategory(match.name),
        body,
        sideEffects,
        externalInputs,
        validations,
        risks,
        source: "Heuristic",
        confidence,
        parser: "LocalHeuristicParser",
        parseEvidence: [
          `${language} signature rule`,
          end < fallbackEnd ? "balanced block boundary" : "next signature boundary",
        ],
      };
    })
    .map((fn, _, allFunctions) => ({
      ...fn,
      calls: inferCalls(fn, allFunctions),
    }));
}

export function attachWorkspaceCalls(functions: FunctionInfo[]) {
  return functions.map((fn) => {
    const calls = Array.from(new Set([...fn.calls, ...inferCalls(fn, functions)]));
    return {
      ...fn,
      calls,
      confidence: calls.length ? Math.min(94, fn.confidence + 4) : fn.confidence,
      parseEvidence: [...(fn.parseEvidence ?? []), "workspace call resolution"],
    };
  });
}

export function buildEdges(functions: FunctionInfo[]): GraphEdge[] {
  const knownIds = new Set(functions.map((fn) => fn.id));
  return functions.flatMap((fn) =>
    fn.calls
      .filter((id) => knownIds.has(id))
      .map((id) => ({
        from: fn.id,
        to: id,
        kind: "call" as const,
        confidence: Math.min(fn.confidence, functions.find((candidate) => candidate.id === id)?.confidence ?? 70),
        evidence: `${fn.name}() calls ${functions.find((candidate) => candidate.id === id)?.name ?? id}()`,
      })),
  );
}

export function buildRecommendations(fn: FunctionInfo) {
  const items = [];
  if (fn.returnType === "inferred" || fn.returnType === "unknown") {
    items.push("返回类型不明确：建议接入 LSP 或编译器 API 补充类型证据。");
  }
  if (fn.externalInputs.length && !fn.validations.length) {
    items.push("外部输入未看到阀门：建议补输入验证、权限检查、范围检查或异常出口。");
  }
  if (fn.risks.includes("溢流风险")) {
    items.push("水箱可能满溢：建议设置容量上限、背压、超时清理和峰值记录。");
  }
  if (fn.complexity >= 5) {
    items.push("分支/循环较多：建议拆成子函数，并用局部水流图或 FSM 展开关键路径。");
  }
  if (!fn.calls.length) {
    items.push("没有发现内部调用：可作为叶子节点优先补测试、参数边界和运行证据。");
  }
  if (!items.length) {
    items.push("结构清晰：适合作为稳定节点，后续可进入修复中心生成测试建议。");
  }
  return items;
}

export function inferCategory(name: string) {
  const lower = name.toLowerCase();
  return categoryRules.find((rule) => rule.words.some((word) => lower.includes(word)))?.label ?? "业务";
}

export function inferComplexity(body: string) {
  const matches = body.match(/\b(if|else if|for|while|switch|case|catch|try|await)\b/g);
  return Math.max(1, (matches?.length ?? 0) + 1);
}

export function inferFunctionRisks(body: string) {
  const lower = body.toLowerCase();
  return [
    /\beval\s*\(|new function|innerhtml|dangerouslysetinnerhtml/.test(lower) ? "外部代码注入" : "",
    /\bexec|spawn|system\(|subprocess|shell\b/.test(lower) ? "命令执行风险" : "",
    /\bwhile\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/.test(lower) ? "堵塞/无限循环" : "",
    /\bpush\(|append\(|queue\.add|cache\.set/.test(lower) && !/\blimit|max|capacity|backpressure\b/.test(lower) ? "溢流风险" : "",
    /\bselect\b.*\+|query\s*\(.*\+|sql.*\$\{/.test(lower) ? "SQL 注入风险" : "",
    /\.\.\/|path\.join\([^)]*input|readfile\([^)]*request/.test(lower) ? "路径穿越风险" : "",
  ].filter(Boolean);
}

export function inferValidations(body: string) {
  const lower = body.toLowerCase();
  return [
    /\bvalidate|schema|zod|joi|assert|guard|sanitize|escape\b/.test(lower) ? "输入验证" : "",
    /\bauth|permission|role|token|session\b/.test(lower) ? "权限检查" : "",
    /\btry\b|\bcatch\b|except\b|finally\b/.test(lower) ? "异常处理" : "",
    /\btypeof|instanceof|isnan|length\s*[<>]=?|range|min|max\b/.test(lower) ? "类型/范围检查" : "",
  ].filter(Boolean);
}

export function inferSideEffects(body: string) {
  const lower = body.toLowerCase();
  return [
    /\bwrite|save|insert|update|delete|commit|publish|send|emit\b/.test(lower) ? "状态写入" : "",
    /\bsettimeout|setinterval|thread|worker|queue|schedule|async|await\b/.test(lower) ? "异步/调度" : "",
    /\breadfile|writefile|open\(|close\(|fs\.|socket\b/.test(lower) ? "资源操作" : "",
    /\bcache|buffer|queue|list|array|map|set\b/.test(lower) ? "缓存/容器" : "",
  ].filter(Boolean);
}

function normalizeMatch(language: string, match: RegExpMatchArray) {
  const index = match.index ?? 0;
  if (language === "Java" || language === "C#") {
    return {
      index,
      name: match[2] ?? "anonymous",
      params: match[3] ?? "",
      returnType: match[1] ?? "unknown",
    };
  }

  return {
    index,
    name: match[1] ?? "anonymous",
    params: match[2] ?? match[3] ?? "",
    returnType: match[3] ?? "",
  };
}

function normalizeParams(params: string) {
  return params
    .split(",")
    .map((param) => param.trim())
    .filter(Boolean)
    .map((param) => param.replace(/\s*=.*/, "").replace(/^\$?/, ""));
}

export function normalizeReturnType(typeHint: string, body: string) {
  const clean = typeHint?.replace(/[{\n\r]/g, " ").trim();
  if (clean) return shorten(clean, 28);
  if (/\breturn\b/.test(body)) return "inferred";
  return "void";
}

export function inferOutputs(body: string, returnType: string) {
  const returns = Array.from(body.matchAll(/\breturn\s+([^;\n]+)/g))
    .map((match) => shorten(match[1].trim(), 24))
    .slice(0, 2);
  const sideEffects = [
    /\bconsole\./.test(body) ? "log" : "",
    /\b(write|save|emit|send|dispatch|publish)\b/i.test(body) ? "side effect" : "",
    /\b(res\.json|sendResponse|response|reply)\b/i.test(body) ? "network response" : "",
  ].filter(Boolean);
  const outputs = [...returns, ...sideEffects];
  if (outputs.length) return outputs;
  return [returnType === "void" ? "state change/void" : returnType];
}

export function inferExternalInputs(name: string, body: string, params: string[]) {
  const lower = `${name} ${body} ${params.join(" ")}`.toLowerCase();
  return [
    /\b(req|request|payload|body|query|params|input|stdin|sensor)\b/.test(lower) ? "外部输入" : "",
    /\bprocess\.env|env\.|config\b/.test(lower) ? "环境变量" : "",
    /\bfetch|axios|http|socket|mqtt|serial\b/.test(lower) ? "网络/设备输入" : "",
    /\breadfile|open\(|fs\.|database|select\b/.test(lower) ? "文件/数据库输入" : "",
  ].filter(Boolean);
}

export function inferParseConfidence(language: string, body: string, returnType: string) {
  let score = codeSnippetsByLanguage[language] ? 76 : 42;
  if (returnType !== "inferred" && returnType !== "unknown") score += 8;
  if (inferValidations(body).length) score += 5;
  if (body.includes("{") || language === "Python") score += 4;
  return Math.min(score, 92);
}

function inferCalls(fn: FunctionInfo, allFunctions: FunctionInfo[]) {
  return allFunctions
    .filter((candidate) => candidate.id !== fn.id)
    .filter((candidate) => {
      const aliases = Array.from(new Set([candidate.name, candidate.name.split(".").at(-1) ?? candidate.name]));
      return aliases.some((alias) => new RegExp(`\\b${escapeRegExp(alias)}\\s*\\(`).test(fn.body));
    })
    .map((candidate) => candidate.id);
}

function findFunctionEnd(content: string, start: number, language: string, fallbackEnd: number) {
  if (language === "Python" || language === "Ruby" || language === "Kotlin") return fallbackEnd;

  const openBrace = content.indexOf("{", start);
  if (openBrace === -1 || openBrace > fallbackEnd) return fallbackEnd;

  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openBrace; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }

  return fallbackEnd;
}

export function summarizeFunction(name: string, body: string, params: string[], outputs: string[]) {
  const category = inferCategory(name);
  const role = classifyFlowRoleFromText(name, body);
  const action =
    category === "解析"
      ? "从输入中提取结构化信息"
      : category === "构建"
        ? "把中间结果组合成新的输出"
        : category === "校验"
          ? "检查数据流或规则是否满足预期"
          : category === "仿真"
            ? "生成执行轨迹或模拟步骤"
            : category === "模型"
              ? "参与数学、算法或代码基础模型计算"
              : "处理当前模块的业务逻辑";
  const branchHint = inferComplexity(body) > 3 ? "，包含多个分支或循环" : "";
  return `${name} 主要负责${action}；水流角色为 ${role}；输入为 ${params.join(", ") || "隐式上下文"}，输出为 ${outputs.join(", ")}${branchHint}。`;
}

function classifyFlowRoleFromText(name: string, body: string) {
  const risks = inferFunctionRisks(body);
  const validations = inferValidations(body);
  const sideEffects = inferSideEffects(body);
  const externalInputs = inferExternalInputs(name, body, []);
  const category = inferCategory(name);
  const outputs = inferOutputs(body, normalizeReturnType("", body));

  if (risks.includes("堵塞/无限循环")) return "堵塞";
  if (risks.includes("溢流风险")) return "溢流";
  if (validations.length) return "阀门";
  if (sideEffects.includes("缓存/容器") || sideEffects.includes("状态写入")) return "水箱";
  if (sideEffects.includes("异步/调度")) return "泵";
  if (externalInputs.length || category === "输入") return "水源";
  if (outputs.length && !outputs.includes("state change/void")) return "排水口";
  return "管道";
}

export function inferDataShape(params: string[], returnType: string) {
  const inputTypes = params
    .map((param) => param.split(":")[1]?.trim() || param.split(/\s+/).pop() || "unknown")
    .slice(0, 3);
  return `(${inputTypes.join(", ") || "void"}) -> ${returnType}`;
}
