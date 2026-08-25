import assert from "node:assert/strict";
import test from "node:test";

import { buildRepairCandidatePatch, generateCandidateDiffFromSuggestions } from "../src/lib/repair/candidate-diff.ts";

const files = [{ id: "main", name: "src/main.ts", language: "TypeScript", content: "const timeout = 0;\nrun(timeout);\n" }];

test("candidate diff changes only a cloned project file and records hashes", async () => {
  const patch = await buildRepairCandidatePatch("timeout-fix", files, [{
    fileName: "src/main.ts", expected: "const timeout = 0;", replacement: "const timeout = 5000;",
    reason: "bound external wait", sourceIds: ["rule-timeout"],
  }]);
  assert.equal(patch.status, "ready");
  assert.equal(files[0].content, "const timeout = 0;\nrun(timeout);\n", "baseline must remain untouched");
  assert.match(patch.candidateFiles[0].content, /5000/);
  assert.notEqual(patch.baselineHash, patch.candidateHash);
  assert.match(patch.unifiedDiff, /-const timeout = 0;/);
  assert.match(patch.unifiedDiff, /\+const timeout = 5000;/);
});

test("ambiguous or stale edits fail closed", async () => {
  const duplicate = [{ ...files[0], content: "run(timeout);\nrun(timeout);" }];
  const ambiguous = await buildRepairCandidatePatch("ambiguous", duplicate, [{
    fileName: "src/main.ts", expected: "run(timeout);", replacement: "runSafe(timeout);", reason: "guard call", sourceIds: ["rule-1"],
  }]);
  assert.equal(ambiguous.status, "rejected");
  assert.match(ambiguous.rejectionReason, /出现 2 次/);
  const stale = await buildRepairCandidatePatch("stale", files, [{
    fileName: "src/main.ts", expected: "missing()", replacement: "safe()", reason: "stale", sourceIds: ["rule-2"],
  }]);
  assert.equal(stale.status, "rejected");
});

test("deterministic code suggestions generate a reviewable diff and uncertain recipes stay advisory", async () => {
  const ready = await generateCandidateDiffFromSuggestions("suggested-timeout", files, [{
    id: "suggestion-1", fileName: "src/main.ts", originalCode: "const timeout = 0;", suggestedCode: "const timeout = 5000;",
    reason: "外部等待必须有有限超时", evidenceIds: ["stability-missing-timeout"], confidence: 92, deterministic: true,
  }]);
  assert.equal(ready.status, "ready");
  assert.match(ready.unifiedDiff, /\+const timeout = 5000;/);

  const advisory = await generateCandidateDiffFromSuggestions("advisory", files, [{
    id: "suggestion-2", fileName: "src/main.ts", originalCode: "run(timeout);", suggestedCode: "runWithRetry(timeout);",
    reason: "重试策略依赖业务幂等性", evidenceIds: ["repair-timeout-retry-budget"], confidence: 76, deterministic: false,
  }]);
  assert.equal(advisory.status, "rejected");
  assert.match(advisory.rejectionReason, /描述型配方不会自动改源码/);
});
