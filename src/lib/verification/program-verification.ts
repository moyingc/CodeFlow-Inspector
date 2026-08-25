import type {
  AnalysisIssue,
  ControlledRuntimeExecutionReport,
  DeepWebNeuralDatabaseReport,
  DiagnosticEvidenceAudit,
  FormalVerificationRecord,
  KnowledgeRuleCoverageReport,
  ProgramDigitalTwinReport,
  ProjectContractReport,
  ProgramVerificationReport,
  VerificationEvidenceGrade,
  VerificationObligation,
  VerifiedRepairCandidate,
} from "@/src/lib/analysis/types";

type VerificationInput = {
  issues: AnalysisIssue[];
  diagnosticEvidence: DiagnosticEvidenceAudit;
  knowledgeCoverage: KnowledgeRuleCoverageReport;
  deepWeb: DeepWebNeuralDatabaseReport;
  digitalTwin: ProgramDigitalTwinReport;
  runtimeExecutions: ControlledRuntimeExecutionReport[];
  formalProofs?: FormalVerificationRecord[];
  contracts: ProjectContractReport;
};

export function buildProgramVerification(input: VerificationInput): ProgramVerificationReport {
  const obligations = deduplicate([
    ...foundationObligations(input),
    ...contractObligations(input.contracts),
    ...formalPolicyObligations(input.formalProofs ?? []),
    ...input.issues.map(issueObligation),
    ...input.digitalTwin.experiments.map(experimentObligation),
  ]);
  const repairCandidates = input.digitalTwin.variants.map((variant) =>
    repairCandidate(variant, input.digitalTwin, input.runtimeExecutions, input.formalProofs ?? []),
  );
  const formalEvidenceCount = countGrade(obligations, "formal");
  const runtimeEvidenceCount = countGrade(obligations, "runtime");
  const benchmarkEvidenceCount = countGrade(obligations, "benchmark");
  const rawScore = Math.round(
    obligations.reduce((sum, obligation) => sum + obligationScore(obligation), 0) /
      Math.max(1, obligations.length),
  );
  const hasOpenObligations = obligations.some((item) => ["violated", "unproved", "blocked"].includes(item.status));
  const soundnessCap = formalEvidenceCount && !hasOpenObligations
    ? 100
    : benchmarkEvidenceCount && runtimeEvidenceCount
      ? 82
      : runtimeEvidenceCount
        ? 72
        : 48;
  const score = Math.min(rawScore, soundnessCap);
  const status: ProgramVerificationReport["status"] = formalEvidenceCount && !hasOpenObligations
    ? "formally-verified"
    : runtimeEvidenceCount && input.knowledgeCoverage.overall >= 70
      ? "verification-ready"
      : obligations.some((item) => item.evidenceGrade !== "heuristic")
        ? "evidence-linked"
        : "foundation";

  return {
    status,
    score,
    soundnessCap,
    obligationCount: obligations.length,
    provedCount: countStatus(obligations, "proved"),
    observedCount: countStatus(obligations, "observed"),
    violatedCount: countStatus(obligations, "violated"),
    unprovedCount: countStatus(obligations, "unproved"),
    blockedCount: countStatus(obligations, "blocked"),
    formalEvidenceCount,
    runtimeEvidenceCount,
    benchmarkEvidenceCount,
    knowledgeCoverage: input.knowledgeCoverage.overall,
    deepWebCoverage: input.deepWeb.coverage,
    obligations,
    repairCandidates,
    contracts: input.contracts,
    evidence: [
      `${input.knowledgeCoverage.ruleCount} 条规则和 ${input.deepWeb.generatedVectorCount} 个 DeepWeb 向量进入证明上下文。`,
      `${input.diagnosticEvidence.runtimeConfirmed} 条诊断有运行证据；${input.digitalTwin.validatedExperimentCount}/${input.digitalTwin.experiments.length} 个孪生实验满足断言。`,
      `${repairCandidates.filter((candidate) => candidate.safeToWriteBack).length}/${repairCandidates.length} 个修复候选通过全部写回门禁。`,
    ],
    gaps: unique([
      formalEvidenceCount ? "" : "当前项目尚未运行本地 Z3/SMT 求解或生成可回放证明记录，因此不能声称形式化正确。",
      benchmarkEvidenceCount ? "" : "当前项目尚未完成同输入、同环境的修复前后 benchmark 对照。",
      runtimeEvidenceCount ? "" : "当前项目尚未执行可用于证明义务的真实受控运行样本。",
      input.knowledgeCoverage.overall >= 80 ? "" : "知识覆盖不足 80%，部分义务缺少成熟定义。",
      input.deepWeb.maturity.status === "成熟验证" ? "" : "DeepWeb 只能融合和排序证据，不能充当证明器。",
    ]),
    next: [
      "把高风险诊断转成可执行断言，运行基线、攻击、故障和边界样本。",
      "在项目副本生成候选 Diff，依次执行静态复查、功能回归、benchmark 和安全回归。",
      "接入本地 SMT/符号执行 adapter，只把可回放求解结果标为 proved。",
    ],
  };
}

function contractObligations(contracts: ProjectContractReport): VerificationObligation[] {
  return contracts.contracts.flatMap((contract) => contract.clauses.map((clause) => ({
    id: `verify-${clause.id}`,
    domain: clause.kind === "security"
      ? "security" as const
      : ["transaction", "resource", "lifecycle", "state"].includes(clause.kind)
        ? "stability" as const
        : "functionality" as const,
    title: `${contract.functionName}：${clause.description}`,
    requirement: clause.predicate,
    status: clause.kind === "security" && /taint-status=exposed/i.test(clause.evidence)
      ? "violated" as const
      : clause.kind === "security" && /taint-status=sanitized/i.test(clause.evidence)
        ? "observed" as const
        : "unproved" as const,
    evidenceGrade: clause.evidenceGrade === "compiler" || clause.evidenceGrade === "lsp" ? "compiler" as const : "parser" as const,
    confidence: clause.confidence,
    sourceIds: [clause.id, contract.functionId],
    evidence: [`${clause.fileName}:${clause.line} · ${clause.evidence}`],
    missingEvidence: clause.smtEligible ? ["运行项目级 SMT 批量证明。"] : [clause.smtReason],
  })));
}

function formalPolicyObligations(records: FormalVerificationRecord[]): VerificationObligation[] {
  return records.map((record) => ({
    id: record.obligationId,
    domain: record.obligationId.includes("security") ? "security" : "functionality",
    title: record.title,
    requirement: record.functionId
      ? `项目契约的反例公式必须不可满足；调用链 ${record.callChain?.join(" -> ") || record.functionId}。`
      : "验证内核策略必须对所有布尔状态组合成立。",
    status: record.status === "proved" ? "proved" : record.status === "counterexample" ? "violated" : "blocked",
    evidenceGrade: record.status === "proved" || record.status === "counterexample" ? "formal" : "compiler",
    confidence: record.status === "proved" ? 100 : record.status === "counterexample" ? 100 : 40,
    sourceIds: [record.id, record.formulaHash],
    evidence: [`${record.fileName ? `${record.fileName}:${record.line ?? "?"} · ` : ""}${record.solver} ${record.solverVersion} · ${record.result} · ${record.durationMs}ms`, ...record.evidence],
    missingEvidence: record.status === "proved" ? [] : ["检查 SMT 公式或求解器错误后重新执行。"],
  }));
}

function foundationObligations(input: VerificationInput): VerificationObligation[] {
  const baseline = input.runtimeExecutions.findLast(
    (run) => run.experimentKind === "baseline" && run.status === "passed" && run.sandboxStatus === "enforced",
  );
  const knowledgeDataQuality = input.knowledgeCoverage.dataQuality ?? {
    score: 0,
    status: "seed" as const,
    evidence: ["旧分析记录没有知识数据质量审计。"],
    blockers: ["重新分析项目以生成知识数据质量审计。"],
  };
  return [
    {
      id: "verify-foundation-knowledge",
      domain: "functionality",
      title: "知识库定义证明对象",
      requirement: "数学、算法、语言、安全、稳定和环境规则能够定义当前项目的检查条件。",
      status: input.knowledgeCoverage.overall >= 80 && knowledgeDataQuality.status === "validated" ? "observed" : "blocked",
      evidenceGrade: "knowledge",
      confidence: Math.min(input.knowledgeCoverage.overall, knowledgeDataQuality.score),
      sourceIds: input.knowledgeCoverage.areas.map((area) => area.category),
      evidence: [input.knowledgeCoverage.summary, ...knowledgeDataQuality.evidence],
      missingEvidence: [...knowledgeDataQuality.blockers, ...input.knowledgeCoverage.gaps].slice(0, 12),
    },
    {
      id: "verify-foundation-deepweb",
      domain: "functionality",
      title: "DeepWeb 只融合可信证据",
      requirement: "候选预测不得被当作证明，只有老师、运行或修复验证样本可提升结论等级。",
      status: input.deepWeb.maturity.status === "成熟验证" ? "observed" : "blocked",
      evidenceGrade: "knowledge",
      confidence: input.deepWeb.maturity.score,
      sourceIds: input.deepWeb.validationEvidence.map((item) => item.id),
      evidence: [input.deepWeb.maturity.summary],
      missingEvidence: [
        ...input.deepWeb.maturity.dimensions
          .filter((dimension) => dimension.stage !== "成熟验证")
          .map((dimension) => `${dimension.name}：${dimension.stage} ${dimension.score}%`),
        input.deepWeb.maturity.next,
      ],
    },
    {
      id: "verify-foundation-runtime",
      domain: "functionality",
      title: "主流程受控执行",
      requirement: "基线在强隔离环境成功退出，并保留可回放内部轨迹。",
      status: baseline?.traceEvents?.length ? "proved" : baseline ? "observed" : "blocked",
      evidenceGrade: baseline ? "runtime" : "parser",
      confidence: baseline?.traceEvents?.length ? 96 : baseline ? 72 : 30,
      sourceIds: baseline ? [baseline.id] : [],
      evidence: baseline
        ? [`${baseline.commandLabel} · ${baseline.status} · ${baseline.durationMs}ms`, baseline.sandboxEvidence]
        : [],
      missingEvidence: baseline?.traceEvents?.length ? [] : ["需要强隔离基线运行和内部 trace。"],
    },
  ];
}

function issueObligation(issue: AnalysisIssue): VerificationObligation {
  return {
    id: `verify-issue-${issue.id}`,
    domain: issueDomain(issue),
    title: `消除：${issue.title}`,
    requirement: issue.message,
    status: issue.status === "Confirmed" ? "violated" : issue.status === "Likely" ? "observed" : "unproved",
    evidenceGrade: issueGrade(issue),
    confidence: issue.confidence,
    sourceIds: [issue.id],
    evidence: [issue.evidence],
    missingEvidence: issue.status === "Confirmed"
      ? ["修复后重新执行相同检测与回归样本。"]
      : ["需要 Compiler/LSP、真实运行或形式化反例确认。"],
  };
}

function experimentObligation(
  experiment: ProgramDigitalTwinReport["experiments"][number],
): VerificationObligation {
  const evidenceGrade: VerificationEvidenceGrade = experiment.runtimeStatistics
    ? "benchmark"
    : experiment.evidenceGrade === "真实执行"
      ? "runtime"
      : experiment.evidenceGrade === "模型仿真"
        ? "knowledge"
        : "parser";
  const status: VerificationObligation["status"] = experiment.claimStatus === "已验证"
    ? "proved"
    : experiment.status === "风险" || experiment.status === "阻塞"
      ? "violated"
      : experiment.claimStatus === "已观察"
        ? "observed"
        : "unproved";
  return {
    id: `verify-experiment-${experiment.id}`,
    domain: experimentDomain(experiment.kind),
    title: experiment.name,
    requirement: experiment.expectedBehavior,
    status,
    evidenceGrade,
    confidence: experiment.confidence,
    sourceIds: [experiment.id],
    evidence: [experiment.claimReason, ...experiment.evidence.slice(0, 4)],
    missingEvidence: status === "proved" ? [] : [experiment.nextAction],
  };
}

function repairCandidate(
  variant: ProgramDigitalTwinReport["variants"][number],
  twin: ProgramDigitalTwinReport,
  runs: ControlledRuntimeExecutionReport[],
  formalProofs: FormalVerificationRecord[],
): VerifiedRepairCandidate {
  const safeVariantId = variant.id.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
  const repairPrefix = `repair-${safeVariantId}-candidate`;
  const baselineRegression = runs.findLast((run) => run.sampleId?.startsWith(`repair-${safeVariantId}-baseline-baseline-`));
  const candidateRegression = runs.findLast((run) => run.sampleId?.startsWith(`${repairPrefix}-baseline-`));
  const staticPass = twin.experiments.some((item) => item.kind === "静态分析" && item.claimStatus === "已验证" && item.status === "通过");
  const regressionPass = Boolean(
    baselineRegression?.status === "passed" && candidateRegression?.status === "passed" &&
    baselineRegression.sandboxStatus === "enforced" && candidateRegression.sandboxStatus === "enforced" &&
    baselineRegression.stdout === candidateRegression.stdout,
  );
  const benchmarkPass = runs.filter((run) => run.experimentKind === "stress" && run.status === "passed" && run.sandboxStatus === "enforced" && run.sampleId?.startsWith(`${repairPrefix}-stress-`)).length >= 16;
  const securityPass = runs.some((run) => run.experimentKind === "security" && run.status === "passed" && run.sandboxStatus === "enforced" &&
    run.sanitizerStatus !== "finding" && !run.sanitizerFindings?.length &&
    !(run.traceEvents ?? []).some((event) => event.event === "transfer" && event.from === "<stdin>") &&
    run.sampleId?.startsWith(`${repairPrefix}-security-`));
  const projectCounterexamples = formalProofs.filter((record) => record.status === "counterexample" && (record.functionId || record.fileName));
  const counterexampleEvidence = projectCounterexamples.slice(0, 4).map((record) => `${record.fileName ?? "未知文件"}:${record.line ?? "?"} ${record.title}${record.callChain?.length ? `（调用链 ${record.callChain.join(" -> ")}）` : ""}`).join("；");
  const gates: VerifiedRepairCandidate["gates"] = [
    gate("static", "静态复查", staticPass, "Parser、Compiler/LSP 和规则扫描必须通过。"),
    gate("formal", "形式化反例", projectCounterexamples.length === 0, projectCounterexamples.length ? `Z3 已找到项目契约反例，修复候选不得进入写回：${counterexampleEvidence}` : "调用点范围、事务、资源、生命周期与安全契约没有未处理的 Z3 反例。", projectCounterexamples.length > 0),
    gate("regression", "功能回归", regressionPass, "候选副本必须证明功能输出不变。"),
    gate("benchmark", "基准对照", benchmarkPass, "至少 16 次同环境前后对照。"),
    gate("security", "安全回归", securityPass, "污染值不得在真实攻击回放中到达危险 sink。"),
    { id: "approval", label: "用户批准", status: "pending", evidence: "软件不得自行批准或覆盖源文件。" },
  ];
  const passed = gates.filter((item) => item.status === "passed").length;
  return {
    id: `verified-repair-${variant.id}`,
    name: variant.name,
    target: variant.target,
    change: variant.change,
    status: gates.some((item) => item.status === "failed") ? "rejected" : passed >= 5 ? "eligible" : "proposed",
    sourceIds: [variant.id, ...twin.experiments.map((item) => item.id), ...projectCounterexamples.map((item) => item.id)],
    gates,
    predictedPerformanceGain: variant.estimatedPerformanceGain,
    predictedStabilityDelta: variant.estimatedStabilityDelta,
    predictedSecurityDelta: variant.estimatedSecurityDelta,
    safeToWriteBack: gates.every((item) => item.status === "passed"),
  };
}

function gate(id: "static" | "formal" | "regression" | "benchmark" | "security", label: string, passed: boolean, evidence: string, failed = false) {
  return { id, label, status: failed ? "failed" as const : passed ? "passed" as const : "pending" as const, evidence };
}

function issueGrade(issue: AnalysisIssue): VerificationEvidenceGrade {
  const text = `${issue.evidence} ${issue.message}`.toLowerCase();
  if (text.includes("runtime") || text.includes("真实执行")) return "runtime";
  if (text.includes("compiler") || text.includes("lsp")) return "compiler";
  if (text.includes("parser") || text.includes("tree-sitter") || text.includes("ast")) return "parser";
  if (text.includes("规则") || text.includes("knowledge")) return "knowledge";
  return "heuristic";
}

function issueDomain(issue: AnalysisIssue): VerificationObligation["domain"] {
  if (issue.category === "security") return "security";
  if (issue.category === "performance") return "performance";
  if (issue.category === "environment") return "environment";
  if (issue.category === "flow") return "stability";
  return "functionality";
}

function experimentDomain(kind: ProgramDigitalTwinReport["experiments"][number]["kind"]): VerificationObligation["domain"] {
  if (kind === "安全攻击") return "security";
  if (kind === "压力测试" || kind === "算法替换") return "performance";
  if (kind === "容错传播") return "stability";
  if (kind === "环境迁移") return "environment";
  return "functionality";
}

function obligationScore(obligation: VerificationObligation) {
  const statusScore = { proved: 100, observed: 62, violated: 20, unproved: 28, blocked: 12 }[obligation.status];
  const gradeWeight = { heuristic: 0.45, parser: 0.62, compiler: 0.76, knowledge: 0.68, runtime: 0.9, benchmark: 0.95, formal: 1 }[obligation.evidenceGrade];
  return Math.round(statusScore * gradeWeight * (0.6 + obligation.confidence / 250));
}

function countStatus(items: VerificationObligation[], status: VerificationObligation["status"]) {
  return items.filter((item) => item.status === status).length;
}

function countGrade(items: VerificationObligation[], grade: VerificationEvidenceGrade) {
  return items.filter((item) => item.evidenceGrade === grade).length;
}

function deduplicate(items: VerificationObligation[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
