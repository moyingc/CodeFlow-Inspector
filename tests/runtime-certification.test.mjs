import assert from "node:assert/strict";
import test from "node:test";

import {
  buildControlledRuntimeCertification,
  runtimeAdapterDefinitions,
} from "../src/lib/runtime/controlled-runtime.ts";

function availability(available = true) {
  const tools = runtimeAdapterDefinitions().map((definition) => ({
    ...definition,
    available,
    version: available ? `${definition.adapter} test` : "",
    evidence: available ? "fixture" : "missing",
  }));
  return {
    status: available ? "ready" : "unavailable",
    tools,
    availableCount: tools.filter((tool) => tool.available).length,
    totalCount: tools.length,
    evidence: "fixture",
    safetyBoundary: [],
  };
}

function certifiedRun(adapter) {
  return {
    id: `run-${adapter}`,
    adapter,
    sampleId: `certification-${adapter}-v1`,
    status: "passed",
    exitCode: 0,
    finishedAt: 2,
    durationMs: 4,
    traceEvents: [
      { functionName: "certification_source", event: "transfer", dataNames: ["input"] },
      { functionName: "certification_sink", event: "exit", dataNames: ["output"] },
    ],
    fileChanges: [{ path: "certification-output.txt", kind: "created", beforeBytes: null, afterBytes: 2 }],
    childProcessCount: 1,
    peakMemoryBytes: 1024,
    sandboxStatus: "enforced",
    sandboxEvidence: "network denied",
  };
}

test("six-language certification reaches 100 only when every evidence gate passes", () => {
  const runs = runtimeAdapterDefinitions().map((definition) => certifiedRun(definition.adapter));
  const report = buildControlledRuntimeCertification(availability(), runs);
  assert.equal(report.status, "certified");
  assert.equal(report.passedCount, 6);
  assert.equal(report.score, 100);
  assert.equal(report.remaining.length, 0);
});

test("six-language certification stays partial when trace or sandbox evidence is missing", () => {
  const runs = runtimeAdapterDefinitions().map((definition) => certifiedRun(definition.adapter));
  runs[2].traceEvents = [];
  runs[4].sandboxStatus = "unavailable";
  const report = buildControlledRuntimeCertification(availability(), runs);
  assert.equal(report.status, "partial");
  assert.equal(report.passedCount, 4);
  assert.ok(report.score < 100);
  assert.equal(report.remaining.length, 2);
});
