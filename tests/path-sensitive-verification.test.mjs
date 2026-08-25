import assert from "node:assert/strict";
import test from "node:test";

import { buildFunctionPathModel } from "../src/lib/verification/path-sensitive-ir.ts";
import { buildProjectContracts } from "../src/lib/verification/project-contracts.ts";

const emptyTaint = { sourceCount: 0, sinkCount: 0, pathCount: 0, exposedPathCount: 0, sanitizedPathCount: 0, candidatePathCount: 0, runtimeConfirmedPathCount: 0, truncated: false, summary: "", paths: [] };
const fn = (id, name, body, params = []) => ({ id, name, fileId: id, fileName: `${id}.ts`, language: "TypeScript", startLine: 1, endLine: 20, params, returnType: "void", outputs: [], calls: [], summary: "", dataShape: "", complexity: 2, category: "业务", body, sideEffects: [], externalInputs: [], validations: [], risks: [], source: "Parser Fact", confidence: 94, parser: "TypeScriptCompiler", parseEvidence: ["compiler"] });

test("path model emits CFG blocks, SSA versions and normal-path predicates", () => {
  const model = buildFunctionPathModel(fn("caller", "caller", "if (x < 0) throw Error();\nlet y = x + 1;\ny = y + 1;\nreturn y;", ["x: number"]));
  assert.ok(model.blocks.some((block) => block.kind === "branch"));
  assert.deepEqual(model.assignments.map((item) => item.symbol), ["y_1", "y_2"]);
  assert.ok(model.normalPathPredicates.includes("x >= 0"));
});

test("non-literal linear call arguments combine caller path constraints with callee ranges", () => {
  const caller = fn("caller", "caller", "if (x < 0) throw Error();\nvalidate(x + 1);", ["x: number"]);
  const callee = fn("callee", "validate", "if (value < 0) throw Error();", ["value: number"]);
  const report = buildProjectContracts([caller, callee], emptyTaint, [{ from: "caller", to: "callee", kind: "call" }]);
  const clause = report.contracts[0].clauses.find((item) => item.kind === "callsite-range");
  assert.ok(clause?.smtFormula);
  assert.match(clause.smtFormula, /\(assert \(>= .* 0\)\)/);
  assert.match(clause.smtFormula, /\(\+ .* 1\)/);
});

test("double-release aliases and unguarded concurrent writes become explicit counterexample formulas", () => {
  const risky = fn("risky", "risky", "let alias = owner;\nclose(owner);\nclose(alias);\nPromise.all(tasks);\nshared += 1;");
  const report = buildProjectContracts([risky], emptyTaint);
  const kinds = new Set(report.contracts[0].clauses.map((item) => item.kind));
  assert.ok(kinds.has("alias"));
  assert.ok(kinds.has("concurrency"));
});

test("native AST control facts produce exception edges, SSA and phi nodes", () => {
  const astFn = fn("ast", "ast", "ignored");
  astFn.astControlFlow = {
    nodes: [
      { id: "entry", kind: "entry", startLine: 1, endLine: 1, definitions: [], uses: [], ownershipEvents: [], concurrencyEvents: [] },
      { id: "branch", kind: "branch", startLine: 2, endLine: 2, definitions: [], uses: ["flag"], ownershipEvents: [], concurrencyEvents: [] },
      { id: "left", kind: "assignment", startLine: 3, endLine: 3, definitions: ["value"], uses: ["a"], ownershipEvents: [], concurrencyEvents: [] },
      { id: "right", kind: "assignment", startLine: 4, endLine: 4, definitions: ["value"], uses: ["b"], ownershipEvents: [], concurrencyEvents: [] },
      { id: "join", kind: "call", startLine: 5, endLine: 5, definitions: [], uses: ["value"], ownershipEvents: ["close"], concurrencyEvents: ["spawn"] },
      { id: "throw", kind: "throw", startLine: 6, endLine: 6, definitions: [], uses: ["error"], ownershipEvents: [], concurrencyEvents: [] },
      { id: "catch", kind: "catch", startLine: 7, endLine: 7, definitions: [], uses: [], ownershipEvents: [], concurrencyEvents: [] },
      { id: "exit", kind: "exit", startLine: 8, endLine: 8, definitions: [], uses: [], ownershipEvents: [], concurrencyEvents: [] },
    ],
    edges: [
      { from: "entry", to: "branch", kind: "normal", condition: "" },
      { from: "branch", to: "left", kind: "normal", condition: "true" },
      { from: "branch", to: "right", kind: "false", condition: "false" },
      { from: "left", to: "join", kind: "normal", condition: "" },
      { from: "right", to: "join", kind: "normal", condition: "" },
      { from: "join", to: "throw", kind: "normal", condition: "" },
      { from: "throw", to: "catch", kind: "exception", condition: "raised" },
      { from: "catch", to: "exit", kind: "normal", condition: "" },
    ],
  };
  const model = buildFunctionPathModel(astFn);
  assert.equal(model.exceptionEdges.length, 1);
  assert.equal(model.assignments.length, 2);
  assert.equal(model.phiAssignments.length, 1);
  assert.equal(model.ownershipEvents.length, 1);
  assert.equal(model.concurrencyEvents.length, 1);
  assert.equal(model.heapObjects.length, 0);
});
