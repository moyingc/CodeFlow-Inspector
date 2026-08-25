import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { buildStressRuntimeBatches, runtimeSupervisionEligible } from "../src/lib/library/deepweb-runtime-evidence.ts";

function runtime(overrides = {}) {
  return {
    id: "run-1", projectId: "project-1", projectName: "Fixture", adapter: "node",
    status: "passed", evidenceGrade: "真实执行", experimentKind: "baseline", sampleId: "baseline-standard", repetition: 1,
    inputBytes: 16, traceEvents: [{ functionName: "main", event: "enter", dataNames: ["input"] }],
    entryPath: "main.js", commandLabel: "node main.js", exitCode: 0, timedOut: false, durationMs: 4,
    stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false, compileOutput: "", fileCount: 1,
    totalBytes: 20, startedAt: 1, finishedAt: 2, databasePath: "fixture.sqlite3", sandboxKind: "macos_sandbox",
    sandboxStatus: "enforced", sandboxEvidence: "network denied", cpuTimeMs: 2, peakMemoryBytes: 1024,
    childProcessCount: 1, childProcesses: [], fileChanges: [], isolation: [], evidence: [],
    ...overrides,
  };
}

test("only traced isolated baseline runtime passes the supervision gate", () => {
  const failed = runtime({ id: "failed-run", status: "failed", exitCode: 1, traceEvents: [] });
  assert.equal(runtimeSupervisionEligible(failed), false);
  assert.equal(runtimeSupervisionEligible(runtime()), true);
  assert.equal(runtimeSupervisionEligible(runtime({ experimentKind: "security" })), false);
});

test("DeepWeb promotes only passed maturity-eligible validation evidence to teacher labels", async () => {
  const source = await readFile(new URL("../src/lib/library/deepweb-neural-database.ts", import.meta.url), "utf8");
  assert.match(source, /\.filter\(\(item\) => item\.passed && item\.maturityEligible\)/);
  assert.match(source, /passed: verifiedBaseline/);
  assert.match(source, /passed: batch\.trainingEligible/);
});

test("a complete isolated stress batch becomes benchmark supervision", () => {
  const runs = Array.from({ length: 16 }, (_, index) => runtime({
    id: `stress-${index}`,
    experimentKind: "stress",
    sampleId: `stress-bounded-16x-1700000000000-${String(index + 1).padStart(2, "0")}`,
    traceEvents: [],
    durationMs: index + 1,
    finishedAt: index + 2,
  }));
  const [batch] = buildStressRuntimeBatches(runs);
  assert.ok(batch);
  assert.equal(batch.runs.length, 16);
  assert.equal(batch.failureRate, 0);
  assert.equal(batch.p95DurationMs, 16);
  assert.equal(batch.trainingEligible, true);
});
