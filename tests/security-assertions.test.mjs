import assert from "node:assert/strict";
import test from "node:test";

import { buildLocalSecurityAttackCorpus, evaluateSecurityAssertion } from "../src/lib/security/security-assertions.ts";

function run(overrides = {}) {
  return {
    id: "run-1", projectId: "project", projectName: "project", adapter: "python", status: "passed",
    evidenceGrade: "真实执行", entryPath: "main.py", commandLabel: "python", exitCode: 0, timedOut: false,
    durationMs: 10, stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false, compileOutput: "",
    fileCount: 1, totalBytes: 10, startedAt: 1, finishedAt: 2, databasePath: "local", sandboxKind: "sandbox-exec",
    sandboxStatus: "enforced", sandboxEvidence: "enforced", cpuTimeMs: 1, peakMemoryBytes: 1, childProcessCount: 1,
    childProcesses: [], fileChanges: [], isolation: [], evidence: [], traceEvents: [], traceSource: "none",
    sanitizerStatus: "not-requested", sanitizerFindings: [], ...overrides,
  };
}

test("local security corpus covers identity, injection, framework and bounded input attacks", () => {
  const corpus = buildLocalSecurityAttackCorpus();
  assert.equal(corpus.length, 16);
  assert.deepEqual(new Set(corpus.map((item) => item.kind)), new Set([
    "unauthenticated", "wrong-role", "cross-tenant", "expired-token", "sql-injection", "path-traversal", "command-injection", "oversized-input",
    "csrf", "ssrf", "unsafe-deserialization", "template-injection", "jwt-confusion", "mass-assignment", "open-redirect", "header-injection",
  ]));
  assert.ok(corpus.every((item) => item.weaknessIds.length && item.frameworkHints.length));
});

test("identity assertion requires explicit program denial", () => {
  const sample = buildLocalSecurityAttackCorpus()[0];
  assert.equal(evaluateSecurityAssertion(sample, run({ stdout: "403 forbidden" })).status, "passed");
  assert.equal(evaluateSecurityAssertion(sample, run()).status, "inconclusive");
});

test("taint leak and sanitizer findings create failed counterexamples", () => {
  const sample = buildLocalSecurityAttackCorpus().find((item) => item.kind === "sql-injection");
  assert.equal(evaluateSecurityAssertion(sample, run({ stdout: sample.canary })).status, "failed");
  assert.equal(evaluateSecurityAssertion(sample, run({ sanitizerStatus: "finding", sanitizerFindings: ["AddressSanitizer"] })).status, "failed");
});

test("silence is not treated as proof that an injection was rejected", () => {
  const sample = buildLocalSecurityAttackCorpus().find((item) => item.kind === "sql-injection");
  assert.equal(evaluateSecurityAssertion(sample, run()).status, "inconclusive");
  assert.equal(evaluateSecurityAssertion(sample, run({ stdout: "400 invalid input rejected" })).status, "passed");
});

test("harness rejection never becomes an application security pass", () => {
  const sample = buildLocalSecurityAttackCorpus()[0];
  assert.equal(evaluateSecurityAssertion(sample, run({ status: "rejected" })).status, "harness-blocked");
});
