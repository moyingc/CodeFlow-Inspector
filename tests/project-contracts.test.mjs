import assert from "node:assert/strict";
import test from "node:test";

import { buildProjectContracts } from "../src/lib/verification/project-contracts.ts";

const signatures = [
  ["ts", "TypeScript", ["value: number", "label?: string"], "boolean", "TypeScriptCompiler"],
  ["py", "Python", ["value: int", "label: Optional[str]"], "bool", "Pyright LSP"],
  ["java", "Java", ["int value", "String label"], "boolean", "JDT LSP"],
  ["c", "C", ["int value", "char *label"], "int", "clangd LSP"],
  ["go", "Go", ["value int", "label string"], "bool", "gopls LSP"],
  ["rust", "Rust", ["value: i32", "label: Option<String>"], "bool", "rust-analyzer LSP"],
];

function fn([id, language, params, returnType, parser], index) {
  return {
    id, name: `check_${id}`, fileId: `${id}-file`, fileName: `src/${id}.txt`, language,
    startLine: index * 10 + 1, endLine: index * 10 + 4, params, returnType, outputs: [], calls: [],
    summary: "validate input", dataShape: "scalar", complexity: 2, category: "校验",
    body: language === "Python" ? "if value < 0:\n    raise ValueError('negative')\nreturn True" : "if (value < 0) throw Error(); return true;",
    sideEffects: [], externalInputs: [], validations: ["range"], risks: [], source: "Parser Fact",
    confidence: 94, parser, parseEvidence: [`${parser} signature`],
  };
}

const emptyTaint = { sourceCount: 0, sinkCount: 0, pathCount: 0, exposedPathCount: 0, sanitizedPathCount: 0, candidatePathCount: 0, runtimeConfirmedPathCount: 0, truncated: false, summary: "", paths: [] };

test("contract IR preserves parameter direction for six language syntaxes", () => {
  const report = buildProjectContracts(signatures.map(fn), emptyTaint);
  assert.equal(report.coveredFunctionCount, 6);
  assert.equal(report.contracts.length, 6);
  for (const contract of report.contracts) {
    const first = contract.clauses.find((clause) => clause.kind === "parameter-type");
    assert.equal(first.subject, "value", `${contract.language} parameter name`);
    assert.match(first.predicate, /(int|i32|number)/i, `${contract.language} scalar type`);
    assert.ok(contract.clauses.some((clause) => clause.kind === "exception"));
    const range = contract.clauses.find((clause) => clause.kind === "parameter-range");
    assert.equal(range?.predicate, "value >= 0");
    assert.equal(range?.smtEligible, true);
  }
});

test("source-to-sink paths become explicit security contracts without changing their evidence state", () => {
  const functions = signatures.slice(0, 2).map(fn);
  const report = buildProjectContracts(functions, {
    ...emptyTaint,
    sourceCount: 1, sinkCount: 1, pathCount: 1, exposedPathCount: 1,
    paths: [{
      id: "taint-1", sourceFunctionId: "ts", sourceFunctionName: "check_ts", sourceKind: "request",
      sinkFunctionId: "py", sinkFunctionName: "check_py", sinkKind: "sql", functionIds: ["ts", "py"],
      edgePairs: ["ts->py"], dataNames: ["value"], sanitizerFunctionIds: [], status: "exposed",
      confidence: 91, evidenceGrade: "compiler", evidence: ["argument binding reaches SQL sink"],
    }],
  });
  const security = report.contracts.flatMap((contract) => contract.clauses).find((clause) => clause.kind === "security");
  assert.ok(security);
  assert.equal(security.smtEligible, true);
  assert.match(security.evidence, /taint-status=exposed/);
  assert.match(security.predicate, /tainted_.* -> sanitized_/);
});

test("literal call arguments are combined with callee range contracts", () => {
  const callee = fn(signatures[0], 0);
  const caller = {
    ...fn(["caller", "TypeScript", [], "boolean", "TypeScriptCompiler"], 1),
    name: "run_check",
    body: "return check_ts(-1, 'bad');",
  };
  const report = buildProjectContracts([caller, callee], emptyTaint, [{ from: "caller", to: "ts", kind: "call" }]);
  const callsite = report.contracts.find((item) => item.functionId === "caller")?.clauses.find((item) => item.kind === "callsite-range");
  assert.ok(callsite);
  assert.deepEqual(callsite.callChain, ["caller", "ts"]);
  assert.match(callsite.smtFormula, /\(assert \(= .* -1\)\)/);
  assert.match(callsite.smtFormula, /\(assert \(not \(>= .* 0\)\)\)/);
});

test("transaction, resource and lifecycle pairs become structural SMT invariants", () => {
  const structural = {
    ...fn(["structural", "TypeScript", [], "void", "TypeScriptCompiler"], 0),
    name: "run_worker",
    body: "db.begin();\nconst file = open('x');\nworker.start();\nfile.close();\ndb.commit();\nworker.stop();",
  };
  const incomplete = {
    ...structural,
    id: "incomplete",
    name: "leak_worker",
    body: "db.begin();\nconst file = open('x');\nworker.start();",
  };
  const report = buildProjectContracts([structural, incomplete], emptyTaint);
  const completeClauses = report.contracts[0].clauses.filter((item) => ["transaction", "resource", "lifecycle"].includes(item.kind));
  const incompleteClauses = report.contracts[1].clauses.filter((item) => ["transaction", "resource", "lifecycle"].includes(item.kind));
  assert.equal(completeClauses.length, 3);
  assert.equal(incompleteClauses.length, 3);
  assert.ok(completeClauses.every((item) => item.smtFormula?.includes("completed true")));
  assert.ok(incompleteClauses.every((item) => item.smtFormula?.includes("completed false")));
});
