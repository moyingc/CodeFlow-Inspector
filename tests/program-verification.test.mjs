import assert from "node:assert/strict";
import test from "node:test";

import { buildProgramVerification } from "../src/lib/verification/program-verification.ts";

function fixture(overrides = {}) {
  return {
    issues: [],
    diagnosticEvidence: { runtimeConfirmed: 0 },
    knowledgeCoverage: {
      overall: 60,
      ruleCount: 120,
      summary: "seed coverage",
      areas: [{ category: "security" }],
      gaps: ["version facts missing"],
    },
    deepWeb: {
      coverage: 58,
      generatedVectorCount: 4,
      validationEvidence: [],
      maturity: {
        status: "基础覆盖",
        score: 58,
        summary: "candidate evidence network",
        dimensions: [{ name: "运行轨迹", stage: "基础覆盖", score: 58 }],
        next: "collect verified samples",
      },
    },
    digitalTwin: {
      validatedExperimentCount: 0,
      experiments: [{
        id: "twin-security",
        kind: "安全攻击",
        name: "污染输入",
        expectedBehavior: "污染值不得到达危险 sink",
        evidenceGrade: "模型仿真",
        claimStatus: "未证明",
        claimReason: "no runtime assertion",
        status: "等待执行",
        confidence: 60,
        evidence: ["static candidate"],
        nextAction: "run attack assertion",
      }],
      variants: [{
        id: "repair-1",
        name: "parameterize query",
        target: "query",
        change: "replace concatenation",
        estimatedPerformanceGain: 2,
        estimatedStabilityDelta: 4,
        estimatedSecurityDelta: 30,
      }],
    },
    runtimeExecutions: [],
    contracts: {
      status: "partial",
      functionCount: 0,
      coveredFunctionCount: 0,
      clauseCount: 0,
      smtEligibleCount: 0,
      securityClauseCount: 0,
      compilerBackedCount: 0,
      contracts: [],
      gaps: [],
      evidence: [],
    },
    ...overrides,
  };
}

test("verification consumes knowledge, DeepWeb, security and twin evidence without pretending it is formal proof", () => {
  const report = buildProgramVerification(fixture());
  assert.equal(report.soundnessCap, 48);
  assert.equal(report.formalEvidenceCount, 0);
  assert.ok(report.blockedCount >= 2);
  assert.match(report.gaps.join(" "), /SMT|符号执行/);
  assert.equal(report.repairCandidates[0].safeToWriteBack, false);
});

test("an isolated traced baseline becomes a proved runtime obligation but not formal verification", () => {
  const report = buildProgramVerification(fixture({
    runtimeExecutions: [{
      id: "run-1",
      experimentKind: "baseline",
      status: "passed",
      sandboxStatus: "enforced",
      commandLabel: "node main.js",
      durationMs: 12,
      sandboxEvidence: "network denied",
      traceEvents: [{ event: "enter" }],
    }],
  }));
  const runtime = report.obligations.find((item) => item.id === "verify-foundation-runtime");
  assert.equal(runtime.status, "proved");
  assert.equal(runtime.evidenceGrade, "runtime");
  assert.equal(report.soundnessCap, 72);
  assert.notEqual(report.status, "formally-verified");
});

test("repair write-back remains locked until every gate including human approval passes", () => {
  const report = buildProgramVerification(fixture());
  const candidate = report.repairCandidates[0];
  assert.equal(candidate.gates.length, 6);
  assert.equal(candidate.gates.at(-1).id, "approval");
  assert.equal(candidate.gates.at(-1).status, "pending");
  assert.equal(candidate.safeToWriteBack, false);
});

test("replayable Z3 unsat records become formal evidence without proving unrelated project behavior", () => {
  const report = buildProgramVerification(fixture({
    formalProofs: [{
      id: "formal-project-policy",
      projectId: "project-1",
      obligationId: "verify-policy-repair-writeback",
      title: "修复未过全部门禁不得写回",
      status: "proved",
      solver: "Z3",
      solverVersion: "Z3 4.15",
      formulaHash: "abc123",
      formula: "(assert ...)",
      result: "unsat",
      durationMs: 4,
      sandboxStatus: "enforced",
      evidence: ["network denied"],
      createdAt: 1,
    }],
  }));
  assert.equal(report.formalEvidenceCount, 1);
  assert.notEqual(report.status, "formally-verified");
  assert.equal(report.obligations.find((item) => item.id === "verify-policy-repair-writeback")?.status, "proved");
  assert.ok(report.unprovedCount > 0 || report.blockedCount > 0, "policy proof must not prove unrelated project obligations");
});

test("project counterexamples reject repair candidates and preserve their call chain", () => {
  const report = buildProgramVerification(fixture({
    contracts: {
      status: "contract-ready", functionCount: 1, coveredFunctionCount: 1, clauseCount: 1,
      smtEligibleCount: 1, securityClauseCount: 0, compilerBackedCount: 1, gaps: [], evidence: [],
      contracts: [{
        id: "contract-caller", functionId: "caller", functionName: "caller", fileName: "src/caller.ts",
        language: "TypeScript", startLine: 1, evidenceGrade: "compiler", confidence: 94,
        clauses: [{
          id: "contract-callsite-range", functionId: "caller", fileName: "src/caller.ts", line: 12,
          kind: "callsite-range", subject: "caller -> validate.value", predicate: "-1 >= 0",
          description: "调用实参必须满足范围契约", evidenceGrade: "compiler", confidence: 94,
          evidence: "bound literal argument", smtEligible: true, smtReason: "bounded integer",
          smtFormula: "(set-logic QF_LIA)\n(check-sat)", callChain: ["caller", "validate"],
        }],
      }],
    },
    formalProofs: [{
      id: "formal-callsite-range",
      projectId: "project-1",
      obligationId: "verify-contract-callsite-range",
      title: "调用实参必须满足范围契约",
      status: "counterexample",
      solver: "Z3",
      solverVersion: "Z3 4.15",
      formulaHash: "range123",
      formula: "(set-logic QF_LIA)",
      result: "sat",
      durationMs: 2,
      sandboxStatus: "enforced",
      evidence: ["bounded solver input"],
      createdAt: 2,
      fileName: "src/caller.ts",
      functionId: "caller",
      line: 12,
      counterexample: "arg = -1",
      callChain: ["caller", "validate"],
    }],
  }));
  const candidate = report.repairCandidates[0];
  const formal = candidate.gates.find((item) => item.id === "formal");
  assert.equal(candidate.status, "rejected");
  assert.equal(formal.status, "failed");
  assert.match(formal.evidence, /caller -> validate/);
  assert.equal(candidate.safeToWriteBack, false);
  const obligation = report.obligations.find((item) => item.id === "verify-contract-callsite-range");
  assert.equal(obligation.status, "violated", "formal counterexample must replace the earlier unproved contract");
  assert.equal(obligation.evidenceGrade, "formal");
});
