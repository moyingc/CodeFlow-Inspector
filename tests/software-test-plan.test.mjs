import assert from "node:assert/strict";
import test from "node:test";

import { buildSoftwareTestReport, usabilityChecklist } from "../src/lib/testing/software-test-plan.ts";

const file = (name, content = "function main() {}") => ({ id: name, name, language: "JavaScript", content, hash: name });
const fn = { id: "fn", name: "main", fileId: "main", fileName: "main.js", language: "JavaScript", startLine: 1, endLine: 1, params: [], returnType: "void", outputs: [], calls: [], summary: "main", dataShape: "() -> void", complexity: 1, category: "业务", body: "", sideEffects: [], externalInputs: [], validations: [], risks: [], source: "Parser Fact", confidence: 100 };
const run = (status = "passed", kind = "baseline") => ({ id: `${kind}-${status}`, projectId: "p", projectName: "p", adapter: "node", status, evidenceGrade: "真实执行", experimentKind: kind, entryPath: "main.js", commandLabel: "node main.js", exitCode: status === "passed" ? 0 : 1, timedOut: false, durationMs: 10, stdout: status === "passed" ? "ok" : "", stderr: status === "passed" ? "" : "boom", stdoutTruncated: false, stderrTruncated: false, compileOutput: "", fileCount: 1, totalBytes: 10, startedAt: 1, finishedAt: 10, databasePath: "test.sqlite", sandboxKind: "macos_sandbox", sandboxStatus: "enforced", sandboxEvidence: "fixture", cpuTimeMs: 3, peakMemoryBytes: 1024, childProcessCount: 1, childProcesses: [], fileChanges: [], isolation: [], evidence: ["fixture"] });

test("testing report keeps passed, failed, blocked and not-run separate", () => {
  const report = buildSoftwareTestReport({
    files: [file("package.json"), file("main.test.js"), file("main.js")],
    functions: [fn],
    issues: [],
    experiments: [],
    runtimeExecutions: [run("passed"), run("failed", "stress")],
    usabilityPassedIds: [],
  });
  assert.equal(report.results.find((item) => item.id === "functional").status, "passed");
  assert.equal(report.results.find((item) => item.id === "performance").status, "failed");
  assert.equal(report.results.find((item) => item.id === "load").status, "blocked");
  assert.equal(report.results.find((item) => item.id === "usability").status, "not-run");
});

test("complete usability checklist becomes a recorded pass", () => {
  const report = buildSoftwareTestReport({
    files: [file("main.js")], functions: [fn], issues: [], experiments: [], runtimeExecutions: [],
    usabilityPassedIds: usabilityChecklist.map((item) => item.id),
  });
  assert.equal(report.results.find((item) => item.id === "usability").status, "passed");
});

test("a newer project version invalidates old execution passes", () => {
  const report = buildSoftwareTestReport({
    files: [file("main.js")], functions: [fn], issues: [], experiments: [], runtimeExecutions: [run("passed")], projectUpdatedAt: 20,
  });
  assert.equal(report.revalidationRequired, true);
  assert.equal(report.results.find((item) => item.id === "functional").status, "not-run");
});
