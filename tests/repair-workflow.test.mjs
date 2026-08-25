import assert from "node:assert/strict";
import test from "node:test";

import { buildRepairCandidatePatch } from "../src/lib/repair/candidate-diff.ts";
import { approveRepairExperiment, rollbackRepairWriteBack, writeBackApprovedRepair } from "../src/lib/repair/repair-workflow.ts";

const files = [{ id: "a", name: "main.ts", language: "TypeScript", content: "const timeout = 0;\n" }];

async function passedCandidate() {
  const patch = await buildRepairCandidatePatch("timeout", files, [{ fileName: "main.ts", expected: "const timeout = 0;", replacement: "const timeout = 5000;", reason: "有限超时", sourceIds: ["rule-timeout"] }]);
  return { patch, experiment: { candidateId: patch.id, status: "passed", outputEquivalent: true, baselineP95Ms: 10, candidateP95Ms: 8, performanceDeltaPercent: 20, allSandboxed: true, runIds: ["base", "candidate"], evidence: ["A/B passed"] } };
}

test("approved repair writes only after A/B and rolls back the exact candidate hash", async () => {
  const result = await passedCandidate();
  const approval = approveRepairExperiment(result, 10);
  const written = await writeBackApprovedRepair({ projectId: "p", currentFiles: files, patch: result.patch, approval, now: 20 });
  assert.match(written.files[0].content, /5000/);
  assert.equal(files[0].content, "const timeout = 0;\n");
  const restored = await rollbackRepairWriteBack(written.files, written.rollback);
  assert.deepEqual(restored, files);
});

test("writeback and rollback fail closed on stale project content", async () => {
  const result = await passedCandidate();
  const approval = approveRepairExperiment(result);
  await assert.rejects(() => writeBackApprovedRepair({ projectId: "p", currentFiles: [{ ...files[0], content: "changed" }], patch: result.patch, approval }), /发生变化/);
  const written = await writeBackApprovedRepair({ projectId: "p", currentFiles: files, patch: result.patch, approval });
  await assert.rejects(() => rollbackRepairWriteBack([{ ...written.files[0], content: "changed again" }], written.rollback), /一键回滚已拒绝/);
});
