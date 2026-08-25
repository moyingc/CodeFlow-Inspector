import assert from "node:assert/strict";
import test from "node:test";

import { buildSourceToSinkTaintReport, enrichPreciseDataFlow } from "../src/lib/flow/precise-data-flow.ts";
import { buildProgramDigitalTwin } from "../src/lib/twin/program-digital-twin.ts";

function runtime(kind, id, traceEvents = []) {
  return {
    id: `run-${id}`,
    projectId: "project-1",
    projectName: "Fixture",
    adapter: "node",
    status: "passed",
    evidenceGrade: "真实执行",
    experimentKind: kind,
    sampleId: id,
    repetition: kind === "stress" ? 16 : 1,
    inputBytes: 128,
    traceEvents,
    entryPath: "main.js",
    commandLabel: "node main.js",
    exitCode: 0,
    timedOut: false,
    durationMs: 12,
    stdout: "ok",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    compileOutput: "",
    fileCount: 1,
    totalBytes: 100,
    startedAt: 1,
    finishedAt: 2,
    databasePath: "fixture.sqlite3",
    sandboxKind: "macos_sandbox",
    sandboxStatus: "enforced",
    sandboxEvidence: "network denied",
    cpuTimeMs: 4,
    peakMemoryBytes: 1024,
    childProcessCount: 0,
    childProcesses: [],
    fileChanges: [],
    isolation: ["network deny"],
    evidence: ["fixture real execution"],
  };
}

test("water edge records argument-to-parameter binding and runtime trace", () => {
  const functions = [
    {
      id: "source", name: "source", fileId: "file-1", fileName: "main.js", language: "JavaScript",
      startLine: 1, endLine: 1, params: ["userInput: string"], returnType: "string", outputs: ["userInput"], calls: ["sink"],
      summary: "accept input", dataShape: "(string) -> string", complexity: 1, category: "输入",
      body: "function source(userInput) { return sink(userInput); }", sideEffects: [], externalInputs: ["userInput"], validations: [], risks: [],
      source: "Parser Fact", confidence: 96, parser: "Compiler", parseEvidence: ["Compiler call expression"],
    },
    {
      id: "sink", name: "sink", fileId: "file-1", fileName: "main.js", language: "JavaScript",
      startLine: 1, endLine: 1, params: ["value: string"], returnType: "string", outputs: ["value"], calls: [],
      summary: "return value", dataShape: "(string) -> string", complexity: 1, category: "业务",
      body: "function sink(value) { return value; }", sideEffects: [], externalInputs: [], validations: [], risks: [],
      source: "Parser Fact", confidence: 96, parser: "Compiler", parseEvidence: ["Compiler signature"],
    },
  ];
  const trace = [
    { functionName: "source", event: "transfer", dataNames: ["userInput"], from: "source", to: "sink" },
  ];
  const graphEdges = [{ from: "source", to: "sink", kind: "call", confidence: 96, evidence: "Compiler call expression" }];
  const edge = enrichPreciseDataFlow({ id: "source->sink:水路", from: "source", to: "sink", kind: "水路", status: "Closed", volume: 60, confidence: 96, evidence: "Compiler call expression" }, functions, graphEdges, [runtime("baseline", "trace", trace)]);
  assert.equal(edge.evidenceGrade, "runtime");
  assert.equal(edge.dataItems[0].name, "userInput");
  assert.equal(edge.dataItems[0].type, "string");
  assert.equal(edge.runtimeObservation.observed, true);
});

test("source-to-sink analysis distinguishes exposed and sanitized data paths", () => {
  const base = {
    fileId: "file-1", fileName: "api.py", language: "Python", startLine: 1, endLine: 2,
    returnType: "str", outputs: ["value"], complexity: 1, category: "业务", sideEffects: [], risks: [],
    source: "Parser Fact", confidence: 94, parser: "Tree-sitter", parseEvidence: ["AST call expression"],
  };
  const functions = [
    { ...base, id: "source", name: "read_request", params: ["request: Request"], calls: ["sink", "validate"], summary: "read request payload", body: "def read_request(request):\n sink(request.body)\n validate(request.body)", externalInputs: ["request.body"], validations: [], dataShape: "(Request) -> str" },
    { ...base, id: "validate", name: "validate_payload", params: ["value: str"], calls: ["safe_sink"], summary: "validate payload schema", body: "def validate_payload(value):\n safe_sink(value)", externalInputs: [], validations: ["输入验证"], dataShape: "(str) -> str" },
    { ...base, id: "sink", name: "execute_query", params: ["value: str"], calls: [], summary: "execute raw SQL", body: "def execute_query(value): db.execute(value)", externalInputs: [], dataShape: "(str) -> void", sideEffects: ["database"], risks: ["SQL 注入风险"] },
    { ...base, id: "safe_sink", name: "save_record", params: ["value: str"], calls: [], summary: "commit database record", body: "def save_record(value): session.add(value); session.commit()", externalInputs: [], dataShape: "(str) -> void", sideEffects: ["database"] },
  ];
  const graphEdges = [
    { from: "source", to: "sink", kind: "call", confidence: 94, evidence: "AST call expression" },
    { from: "source", to: "validate", kind: "call", confidence: 94, evidence: "AST call expression" },
    { from: "validate", to: "safe_sink", kind: "call", confidence: 94, evidence: "AST call expression" },
  ];
  const report = buildSourceToSinkTaintReport(functions, graphEdges);
  assert.equal(report.exposedPathCount, 1);
  assert.equal(report.sanitizedPathCount, 1);
  assert.equal(report.paths.find((path) => path.sinkFunctionId === "sink").status, "exposed");
  assert.deepEqual(report.paths.find((path) => path.sinkFunctionId === "safe_sink").sanitizerFunctionIds, ["validate"]);
});

test("typed experiment runs promote only their matching digital twin experiments", () => {
  const files = [{ id: "file-1", name: "main.js", language: "JavaScript", content: "function main() { return 1; }" }];
  const functions = [{
    id: "main", name: "main", fileId: "file-1", fileName: "main.js", language: "JavaScript", startLine: 1, endLine: 1,
    params: [], returnType: "number", outputs: ["1"], calls: [], summary: "main", dataShape: "(void) -> number", complexity: 1,
    category: "业务", body: "function main() { return 1; }", sideEffects: [], externalInputs: [], validations: [], risks: [],
    source: "Parser Fact", confidence: 95, parser: "Compiler", parseEvidence: ["Compiler"],
  }];
  const runs = [runtime("baseline", "base"), runtime("stress", "stress"), runtime("fault", "fault"), runtime("security", "security")];
  const report = buildProgramDigitalTwin({
    files, functions, flowNodes: [{ id: "main", functionId: "main", name: "main", role: "排水口", status: "Closed", note: "fixture", capacity: "小溪", confidence: 95, upstreamIds: [], downstreamIds: [] }],
    flowEdges: [], issues: [],
    runtimeSandbox: { mode: "Static Dry-run", readinessScore: 80, deterministicScore: 80, breakpointCount: 0, riskCount: 0, estimatedSteps: 1, resourceBudget: { maxSteps: 100, maxBranchFanout: 4, timeoutMs: 5000, memoryMb: 128 }, scenarios: [], guards: [], next: [] },
    speedOptions: [], environmentScore: 90, closureScore: 90, damScore: 90, runtimeExecutions: runs,
  });
  const grades = new Map(report.experiments.map((item) => [item.kind, item.evidenceGrade]));
  assert.equal(grades.get("动态仿真"), "真实执行");
  assert.equal(grades.get("压力测试"), "真实执行");
  assert.equal(grades.get("容错传播"), "真实执行");
  assert.equal(grades.get("安全攻击"), "真实执行");
  assert.equal(report.executedExperimentCount, 4);
});

test("stress experiment aggregates one real batch instead of trusting repetition metadata", () => {
  const batch = Array.from({ length: 16 }, (_, index) => ({
    ...runtime("stress", `stress-bounded-16x-1700000000000-${String(index + 1).padStart(2, "0")}`),
    repetition: 1,
    durationMs: index + 1,
    cpuTimeMs: 2,
    peakMemoryBytes: 1024 + index,
    startedAt: index * 2,
    finishedAt: index * 2 + 1,
  }));
  batch[15].status = "failed";
  batch[15].exitCode = 1;
  const report = buildProgramDigitalTwin({
    files: [{ id: "file-1", name: "main.js", language: "JavaScript", content: "function main() {}" }],
    functions: [], flowNodes: [], flowEdges: [], issues: [],
    runtimeSandbox: { mode: "Static Dry-run", readinessScore: 80, deterministicScore: 80, breakpointCount: 0, riskCount: 0, estimatedSteps: 1, resourceBudget: { maxSteps: 100, maxBranchFanout: 4, timeoutMs: 5000, memoryMb: 128 }, scenarios: [], guards: [], next: [] },
    speedOptions: [], environmentScore: 90, closureScore: 90, damScore: 90, runtimeExecutions: batch,
  });
  const stress = report.experiments.find((item) => item.kind === "压力测试");
  assert.equal(stress.evidenceGrade, "真实执行");
  assert.equal(stress.runtimeStatistics.sampleCount, 16);
  assert.equal(stress.runtimeStatistics.p50DurationMs, 8);
  assert.equal(stress.runtimeStatistics.p95DurationMs, 16);
  assert.equal(stress.runtimeStatistics.failureRate, 6);
});
