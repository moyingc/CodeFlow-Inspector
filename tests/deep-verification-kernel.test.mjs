import assert from "node:assert/strict";
import test from "node:test";

import { buildWholeProgramPointsTo } from "../src/lib/verification/whole-program-memory.ts";
import { exploreConcurrencyStateSpace } from "../src/lib/verification/concurrency-state-space.ts";
import { buildInterproceduralTaintReport } from "../src/lib/security/interprocedural-taint.ts";
import { analyzeDynamicBoundaries } from "../src/lib/security/dynamic-boundary-analysis.ts";
import { buildSecurityAttackCorpusManifest, buildLocalSecurityAttackCorpus, evaluateSecurityAssertion, evaluateSecurityCorpusMaturity } from "../src/lib/security/security-assertions.ts";

function fn(id, name, body, params = [], nodes = [], edges = []) {
  return {
    id, name, fileName: "src/main.ts", language: "TypeScript", startLine: 1, endLine: 20,
    params, returnType: "unknown", outputs: [], calls: [], body, source: body, complexity: 2, category: "business",
    sideEffects: [], externalInputs: [], validations: [], risks: [], confidence: 94, parser: "Tree-sitter AST", parseEvidence: [],
    astControlFlow: { nodes, edges },
  };
}

test("whole-program allocation-site points-to crosses arguments and returns", () => {
  const identity = fn("identity", "identity", "function identity(p) { return p; }", ["p: object"], [
    { id: "i-entry", kind: "entry", startLine: 1, endLine: 1, definitions: [], uses: [], ownershipEvents: [], concurrencyEvents: [] },
    { id: "i-return", kind: "return", startLine: 2, endLine: 2, definitions: [], uses: ["p"], ownershipEvents: [], concurrencyEvents: [] },
  ], [{ from: "i-entry", to: "i-return", kind: "normal", condition: "" }]);
  const caller = fn("caller", "caller", "function caller() { x = open(); y = identity(x); return y; }", [], [
    { id: "c-open", kind: "assignment", startLine: 4, endLine: 4, definitions: ["x"], uses: [], ownershipEvents: ["open"], concurrencyEvents: [] },
    { id: "c-call", kind: "assignment", startLine: 5, endLine: 5, definitions: ["y"], uses: ["x"], ownershipEvents: [], concurrencyEvents: [] },
    { id: "c-return", kind: "return", startLine: 6, endLine: 6, definitions: [], uses: ["y"], ownershipEvents: [], concurrencyEvents: [] },
  ], []);
  const report = buildWholeProgramPointsTo([caller, identity], [{ from: "caller", to: "identity", kind: "call", confidence: 94, evidence: "AST" }]);
  const heap = report.objects.find((item) => item.type === "allocation-site");
  assert.ok(heap);
  assert.ok(report.pointsTo["caller::x"].includes(heap.id));
  assert.ok(report.pointsTo["identity::p"].includes(heap.id));
  assert.ok(report.pointsTo["caller::y"].includes(heap.id));
  assert.ok(report.aliasSets.some((item) => item.objectId === heap.id && item.variables.length >= 3));
  assert.ok(report.contexts.some((item) => item.callerId === "caller" && item.calleeId === "identity"));
  assert.ok(Object.keys(report.contextPointsTo).some((item) => item.includes("identity::p")));
  assert.ok(report.contextHeapStates.some((item) => item.functionId === "identity" && item.pointsTo["identity::p"]?.includes(heap.id)));
  assert.ok(report.separationObligations.some((item) => item.objectIds.includes(heap.id)));
  assert.equal(report.converged, true);
});

test("points-to separates literal container slots and records dynamic dispatch candidates", () => {
  const fixture = fn("containers", "containers", "function containers(){ list = new Array(); a = open(); b = open(); list[0] = a; list[1] = b; x = list[0]; service.save(x); }", [], [
    { id: "list", kind: "assignment", startLine: 1, endLine: 1, definitions: ["list"], uses: [], ownershipEvents: ["new"], concurrencyEvents: [] },
    { id: "a", kind: "assignment", startLine: 2, endLine: 2, definitions: ["a"], uses: [], ownershipEvents: ["open"], concurrencyEvents: [] },
    { id: "b", kind: "assignment", startLine: 3, endLine: 3, definitions: ["b"], uses: [], ownershipEvents: ["open"], concurrencyEvents: [] },
  ]);
  const save = fn("save", "save", "function save(value){ return value; }");
  const report = buildWholeProgramPointsTo([fixture, save], []);
  assert.ok(Object.keys(report.containerElementPointsTo).some((name) => name.endsWith(".[0]")));
  assert.ok(Object.keys(report.containerElementPointsTo).some((name) => name.endsWith(".[1]")));
  assert.equal(report.dynamicDispatchTargets.find((item) => item.method === "save")?.status, "resolved");
});

test("points-to keeps distinct heap fields separate", () => {
  const fixture = fn("fields", "fields", "function fields(){ a = open(); b = open(); holder.left = a; holder.right = b; x = holder.left; y = holder.right; }", [], [
    { id: "a", kind: "assignment", startLine: 1, endLine: 1, definitions: ["a"], uses: [], ownershipEvents: ["open"], concurrencyEvents: [] },
    { id: "b", kind: "assignment", startLine: 2, endLine: 2, definitions: ["b"], uses: [], ownershipEvents: ["open"], concurrencyEvents: [] },
    { id: "holder", kind: "assignment", startLine: 3, endLine: 3, definitions: ["holder"], uses: [], ownershipEvents: ["new"], concurrencyEvents: [] },
  ], []);
  const report = buildWholeProgramPointsTo([fixture], []);
  const left = Object.entries(report.fieldPointsTo).find(([name]) => name.endsWith(".left"))?.[1] ?? [];
  const right = Object.entries(report.fieldPointsTo).find(([name]) => name.endsWith(".right"))?.[1] ?? [];
  assert.ok(left.length && right.length);
  assert.notDeepEqual(left, right);
});

test("bounded scheduler records POR, frontier and race counterexamples", () => {
  const concurrent = fn("parallel", "parallel", "async function parallel(){ sharedCount = sharedCount + 1; Promise.all([a(), b()]); }", [], [
    { id: "write", kind: "assignment", startLine: 2, endLine: 2, definitions: ["sharedCount"], uses: ["sharedCount"], ownershipEvents: [], concurrencyEvents: [] },
    { id: "a", kind: "call", startLine: 3, endLine: 3, definitions: [], uses: [], ownershipEvents: [], concurrencyEvents: ["spawn task a"] },
    { id: "b", kind: "call", startLine: 3, endLine: 3, definitions: [], uses: [], ownershipEvents: [], concurrencyEvents: ["spawn task b"] },
  ], [{ from: "write", to: "a", kind: "normal", condition: "" }, { from: "a", to: "b", kind: "normal", condition: "" }]);
  const report = exploreConcurrencyStateSpace([concurrent], 64, 8);
  assert.equal(report.transitions.length, 2);
  assert.ok(report.counterexamples.some((item) => item.variable === "sharedCount"));
  assert.equal(report.completeWithinBounds, true);
});

test("event-level concurrency records shared lock synchronization and suppresses the guarded race", () => {
  const concurrent = fn("guarded", "guarded", "async function guarded(){\n mutex.lock();\n Promise.all([a(), b()]);\n mutex.unlock();\n}", [], [
    { id: "a", kind: "call", startLine: 3, endLine: 3, definitions: ["sharedState"], uses: ["sharedState"], ownershipEvents: [], concurrencyEvents: ["spawn task a"] },
    { id: "b", kind: "call", startLine: 3, endLine: 3, definitions: ["sharedState"], uses: ["sharedState"], ownershipEvents: [], concurrencyEvents: ["spawn task b"] },
  ]);
  const report = exploreConcurrencyStateSpace([concurrent], 64, 8);
  assert.ok(report.transitions.every((item) => item.lockset.includes("mutex")));
  assert.ok(report.synchronizationEdges.some((item) => item.primitive === "mutex"));
  assert.equal(report.counterexamples.length, 0);
});

test("AST variable taint crosses call arguments into a sensitive sink", () => {
  const source = fn("source", "read_request", "function read_request(request){ dangerous(request); }", ["request: string"], [
    { id: "source-call", kind: "call", startLine: 2, endLine: 2, definitions: [], uses: ["request"], ownershipEvents: [], concurrencyEvents: [] },
  ]);
  source.externalInputs = ["HTTP request"];
  const sink = fn("sink", "dangerous", "function dangerous(value){ system(value); }", ["value: string"], [
    { id: "sink-call", kind: "call", startLine: 5, endLine: 5, definitions: [], uses: ["value"], ownershipEvents: [], concurrencyEvents: [] },
  ]);
  const report = buildInterproceduralTaintReport([source, sink], [{ from: "source", to: "sink", kind: "call", confidence: 94, evidence: "AST" }]);
  assert.equal(report.converged, true);
  assert.ok(report.variables.some((item) => item.functionId === "sink" && item.variable === "value"));
  assert.equal(report.sinks.find((item) => item.functionId === "sink")?.status, "exposed");
});

test("dynamic boundaries remain candidates until a matching runtime trace observes them", () => {
  const dynamic = fn("dynamic", "load_plugin", "function load_plugin(name){ return import(name); }", ["name: string"]);
  const candidate = analyzeDynamicBoundaries([dynamic]);
  assert.equal(candidate[0]?.status, "static-candidate");
  const runtime = [{
    id: "runtime-1", traceEvents: [{ functionName: "plugin", event: "transfer", dataNames: ["dynamic-boundary"], from: "<dynamic-import>", to: "import" }],
  }];
  assert.equal(analyzeDynamicBoundaries([dynamic], runtime)[0]?.status, "runtime-observed");
});

test("attack corpus has a stable version, checksum and weakness provenance", () => {
  const first = buildSecurityAttackCorpusManifest();
  const second = buildSecurityAttackCorpusManifest();
  assert.equal(first.checksum, second.checksum);
  assert.equal(first.caseCount, 16);
  assert.match(first.checksum, /^[0-9a-f]{16}$/);
  assert.ok(first.provenance.some((item) => item.includes("CWE")));
});

test("corpus maturity gate rejects inconclusive or non-isolated replays", () => {
  const samples = buildLocalSecurityAttackCorpus();
  const runs = samples.map((sample) => evaluateSecurityAssertion(sample, {
    id: `run-${sample.id}`, projectId: "p", projectName: "p", adapter: "python", status: "passed", evidenceGrade: "真实执行",
    entryPath: "main.py", commandLabel: "python", exitCode: 0, timedOut: false, durationMs: 1, stdout: sample.expected === "explicit-denial" ? "403 forbidden" : sample.expected === "no-canary-leak" ? "400 invalid input rejected" : "", stderr: "",
    stdoutTruncated: false, stderrTruncated: false, compileOutput: "", fileCount: 1, totalBytes: 1, startedAt: 1, finishedAt: 2, databasePath: "db",
    sandboxKind: "macos_sandbox", sandboxStatus: "enforced", sandboxEvidence: "enforced", cpuTimeMs: 1, peakMemoryBytes: 1, childProcessCount: 1,
    childProcesses: [], fileChanges: [], isolation: [], evidence: [], traceEvents: [], traceSource: "none", sanitizerStatus: "not-requested", sanitizerFindings: [],
  }));
  const mature = evaluateSecurityCorpusMaturity(runs);
  assert.equal(mature.coverage, 100);
  assert.equal(mature.eligibleForDeepWebSupervision, true);
  runs[0].status = "inconclusive";
  assert.equal(evaluateSecurityCorpusMaturity(runs).eligibleForDeepWebSupervision, false);
});
