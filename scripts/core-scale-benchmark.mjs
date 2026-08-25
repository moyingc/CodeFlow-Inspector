import { performance } from "node:perf_hooks";
import { buildWholeProgramPointsTo } from "../src/lib/verification/whole-program-memory.ts";
import { buildInterproceduralTaintReport } from "../src/lib/security/interprocedural-taint.ts";

export function generateSyntheticProject(functionCount) {
  const functions = Array.from({ length: functionCount }, (_, index) => ({
    id: `fn-${index}`, name: `function_${index}`, fileId: `file-${Math.floor(index / 100)}`, fileName: `src/module-${Math.floor(index / 100)}.ts`, language: "TypeScript",
    startLine: index * 3 + 1, endLine: index * 3 + 2, params: index ? ["value: object"] : [], returnType: "object", outputs: [],
    calls: index + 1 < functionCount ? [`function_${index + 1}`] : [], summary: "synthetic benchmark", dataShape: "object -> object", complexity: 1,
    category: "business", body: index + 1 < functionCount ? `function function_${index}(value){ local = open(); return function_${index + 1}(value); }` : `function function_${index}(value){ return value; }`,
    sideEffects: [], externalInputs: index === 0 ? ["benchmark input"] : [], validations: [], risks: [], source: "Parser Fact", confidence: 100, parser: "benchmark AST", parseEvidence: [],
    astControlFlow: { nodes: [{ id: `node-${index}`, kind: "return", startLine: index * 3 + 1, endLine: index * 3 + 1, definitions: [], uses: index ? ["value"] : [], ownershipEvents: index + 1 < functionCount ? ["open"] : [], concurrencyEvents: [] }], edges: [] },
  }));
  const edges = Array.from({ length: Math.max(0, functionCount - 1) }, (_, index) => ({ from: `fn-${index}`, to: `fn-${index + 1}`, kind: "call", confidence: 100, evidence: "synthetic exact chain" }));
  return { functions, edges };
}

export function runCoreScaleBenchmark(functionCount = 1_000) {
  const fixture = generateSyntheticProject(functionCount);
  const memoryStart = performance.now();
  const pointsTo = buildWholeProgramPointsTo(fixture.functions, fixture.edges, 256, 2);
  const memoryMs = performance.now() - memoryStart;
  const taintStart = performance.now();
  const taint = buildInterproceduralTaintReport(fixture.functions, fixture.edges, 128);
  const taintMs = performance.now() - taintStart;
  return {
    functionCount, edgeCount: fixture.edges.length, memoryMs: Math.round(memoryMs * 100) / 100, taintMs: Math.round(taintMs * 100) / 100,
    pointsToConverged: pointsTo.converged, taintConverged: taint.converged, unresolvedCalls: pointsTo.unresolvedCallCount,
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const count = Number(process.argv[2] ?? 1_000);
  process.stdout.write(`${JSON.stringify(runCoreScaleBenchmark(count), null, 2)}\n`);
}
