import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTypeScriptProjectViaNode } from "../src/lib/parser/node-parser-bridge.mjs";
import { mergeCompilerReportIntoParseResult } from "../src/lib/parser/parser-fusion.mjs";

test("parser fusion merges Node compiler facts into base parse result", async () => {
  const files = [
    {
      id: "fusion-file",
      name: "src/fusion.ts",
      language: "TypeScript",
      content: `
export function controller(input: string): number {
  return calculate(input);
}

function calculate(value: string): number {
  return value.length;
}
`,
    },
  ];
  const compilerReport = await analyzeTypeScriptProjectViaNode(files, { timeoutMs: 8000 });
  const baseResult = {
    functions: [
      {
        id: "fusion-file:controller:2",
        name: "controller",
        fileId: "fusion-file",
        fileName: "src/fusion.ts",
        language: "TypeScript",
        startLine: 2,
        endLine: 4,
        params: ["input: unknown"],
        returnType: "inferred",
        outputs: ["calculate(input)"],
        calls: [],
        summary: "base scan",
        dataShape: "(unknown) -> inferred",
        complexity: 1,
        category: "业务",
        body: "export function controller(input: string): number { return calculate(input); }",
        sideEffects: [],
        externalInputs: ["函数参数"],
        validations: [],
        risks: [],
        source: "Heuristic",
        confidence: 72,
        parser: "TypeScriptSyntaxScanner",
        parseEvidence: ["base syntax scan"],
      },
      {
        id: "fusion-file:calculate:6",
        name: "calculate",
        fileId: "fusion-file",
        fileName: "src/fusion.ts",
        language: "TypeScript",
        startLine: 6,
        endLine: 8,
        params: ["value: unknown"],
        returnType: "inferred",
        outputs: ["value.length"],
        calls: [],
        summary: "base scan",
        dataShape: "(unknown) -> inferred",
        complexity: 1,
        category: "模型",
        body: "function calculate(value: string): number { return value.length; }",
        sideEffects: [],
        externalInputs: ["函数参数"],
        validations: [],
        risks: [],
        source: "Heuristic",
        confidence: 72,
        parser: "TypeScriptSyntaxScanner",
        parseEvidence: ["base syntax scan"],
      },
    ],
    edges: [],
    report: {
      adapterName: "Hybrid Local ParserAdapter",
      mode: "Deterministic Local",
      reliabilityScore: 76,
      languages: ["TypeScript"],
      functionCount: 2,
      edgeCount: 0,
      diagnostics: [],
      capabilities: [
        {
          name: "TypeScript 编译器适配",
          layer: "Compiler API",
          status: "ready",
          coverage: 42,
          evidence: "ready",
          next: "bridge",
        },
      ],
      enhancement: {
        status: "base",
        source: "ClientSafeParser",
        mergedFunctions: 0,
        addedFunctions: 0,
        addedEdges: 0,
        confidenceGain: 0,
        evidence: "base",
        next: "bridge",
      },
      evidence: ["base"],
    },
  };

  const merged = mergeCompilerReportIntoParseResult(files, baseResult, compilerReport);
  const controller = merged.functions.find((fn) => fn.name === "controller");

  assert.equal(merged.report.enhancement.status, "merged");
  assert.equal(merged.report.enhancement.mergedFunctions, 2);
  assert.equal(controller.returnType, "number");
  assert.deepEqual(controller.params, ["input: string"]);
  assert.ok(controller.parser.includes("NodeTypeScriptServiceAdapter"));
  assert.ok(merged.edges.some((edge) => edge.from === controller.id && /Compiler fusion/.test(edge.evidence)));
  assert.equal(merged.report.capabilities.find((item) => item.layer === "Compiler API").status, "active");
});
