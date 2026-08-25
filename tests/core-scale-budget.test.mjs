import assert from "node:assert/strict";
import test from "node:test";

import { runCoreScaleBenchmark } from "../scripts/core-scale-benchmark.mjs";

test("10k-function verification fixture converges inside the CI engineering budget", { timeout: 20_000 }, () => {
  const report = runCoreScaleBenchmark(10_000);
  assert.equal(report.pointsToConverged, true);
  assert.equal(report.taintConverged, true);
  assert.equal(report.unresolvedCalls, 0);
  assert.ok(report.memoryMs < 10_000, `points-to took ${report.memoryMs}ms`);
  assert.ok(report.taintMs < 10_000, `taint took ${report.taintMs}ms`);
});
