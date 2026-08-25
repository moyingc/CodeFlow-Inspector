import type { CodeFile, FunctionInfo } from "@/src/lib/analysis/types";
import { countLines, shorten } from "@/src/lib/analysis/utils";
import {
  inferCategory,
  inferComplexity,
  inferDataShape,
  inferExternalInputs,
  inferFunctionRisks,
  inferOutputs,
  inferSideEffects,
  inferValidations,
  normalizeReturnType,
  parseFunctionsFromFile,
  summarizeFunction,
} from "@/src/lib/parser/heuristic-parser";

type TsSyntaxMatch = {
  name: string;
  params: string;
  returnType: string;
  index: number;
  kind: "function" | "arrow" | "method";
};

const methodPattern =
  /(?:^|\n)\s*(?:public|private|protected|static|async|get|set|override|readonly|\s)*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::\s*([^{=>\n]+))?\s*\{/g;

const methodNameDenyList = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "return",
  "constructor",
]);

export function isTypeScriptLikeFile(file: CodeFile) {
  return file.language === "TypeScript" || file.language === "JavaScript";
}

export function parseTypeScriptFunctionsFromFile(file: CodeFile): FunctionInfo[] {
  const baseline = parseFunctionsFromFile(file);
  const baselineKeys = new Set(baseline.map((fn) => `${fn.name}:${fn.startLine}`));
  const methodMatches = collectMethodMatches(file).filter((match) => !baselineKeys.has(matchKey(file, match)));
  const methodFunctions = methodMatches.map((match) => buildFunctionInfo(file, match));

  return [...baseline, ...methodFunctions]
    .sort((a, b) => a.startLine - b.startLine)
    .map((fn) => ({
      ...fn,
      source: "Parser Fact",
      confidence: Math.min(94, Math.max(fn.confidence + 6, fn.parser === "TypeScriptSyntaxScanner" ? fn.confidence : 86)),
      parser: "TypeScriptSyntaxScanner",
      parseEvidence: [
        ...(fn.parseEvidence ?? []),
        "TS/JS syntax scanner",
        "Compiler API bridge-ready",
      ],
    }));
}

function collectMethodMatches(file: CodeFile): TsSyntaxMatch[] {
  return Array.from(file.content.matchAll(methodPattern))
    .map((match) => {
      const full = match[0];
      const leadingWhitespace = full.search(/\S/);
      return {
        name: match[1] ?? "anonymous",
        params: match[2] ?? "",
        returnType: match[3] ?? "",
        index: (match.index ?? 0) + Math.max(0, leadingWhitespace),
        kind: "method" as const,
      };
    })
    .filter((match) => !methodNameDenyList.has(match.name.toLowerCase()))
    .filter((match) => isLikelyMethod(file.content, match.index));
}

function buildFunctionInfo(file: CodeFile, match: TsSyntaxMatch): FunctionInfo {
  const fallbackEnd = findNextLikelyBoundary(file.content, match.index);
  const end = findBlockEnd(file.content, match.index, fallbackEnd);
  const body = file.content.slice(match.index, end);
  const startLine = countLines(file.content.slice(0, match.index));
  const endLine = countLines(file.content.slice(0, end));
  const params = normalizeTsParams(match.params);
  const returnType = normalizeReturnType(match.returnType, body);
  const outputs = inferOutputs(body, returnType);
  const externalInputs = inferExternalInputs(match.name, body, params);
  const validations = inferValidations(body);
  const sideEffects = inferSideEffects(body);
  const risks = inferFunctionRisks(body);

  return {
    id: `${file.id}:${match.name}:${startLine}`,
    name: match.name,
    fileId: file.id,
    fileName: file.name,
    language: file.language,
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
    source: "Parser Fact",
    confidence: match.returnType ? 88 : 82,
    parser: "TypeScriptSyntaxScanner",
    parseEvidence: [
      "TS/JS method syntax rule",
      "balanced block boundary",
      match.returnType ? "return type annotation" : "return type inferred from body",
    ],
  };
}

function normalizeTsParams(params: string) {
  return params
    .split(",")
    .map((param) => param.trim())
    .filter(Boolean)
    .map((param) => {
      const clean = param.replace(/\s*=.*/, "");
      const [name, type] = clean.split(":").map((part) => part.trim());
      return type ? `${shorten(name, 28)}: ${shorten(type, 42)}` : `${shorten(name, 28)}: unknown`;
    });
}

function matchKey(file: CodeFile, match: TsSyntaxMatch) {
  return `${match.name}:${countLines(file.content.slice(0, match.index))}`;
}

function isLikelyMethod(content: string, index: number) {
  const before = content.slice(Math.max(0, index - 220), index);
  if (/\b(class|interface|type)\s+[A-Za-z_$][\w$]*[\s\S]*\{[\s\S]*$/.test(before)) return true;
  const line = content.slice(content.lastIndexOf("\n", index - 1) + 1, index + 80);
  return /^\s*(public|private|protected|static|async|get|set|override)\b/.test(line);
}

function findNextLikelyBoundary(content: string, start: number) {
  const next = content.slice(start + 1).search(/\n\s*(?:public|private|protected|static|async|get|set|override|\w+\s*\(|(?:export\s+)?(?:async\s+)?function\s+|(?:export\s+)?(?:const|let|var)\s+)/);
  return next === -1 ? content.length : start + 1 + next;
}

function findBlockEnd(content: string, start: number, fallbackEnd: number) {
  const openBrace = content.indexOf("{", start);
  if (openBrace === -1) return fallbackEnd;

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
