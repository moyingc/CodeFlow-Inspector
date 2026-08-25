import type {
  KnowledgeRuleCategory,
  KnowledgeRuleCoverageArea,
  KnowledgeRuleCoverageReport,
  KnowledgeRuleEvolutionStage,
  KnowledgeRuleEvidence,
  KnowledgeRuleSeverity,
} from "@/src/lib/analysis/types";
import {
  localKnowledgeConcepts,
  localKnowledgeRuleEvidence,
  localKnowledgeRules,
  localLanguageApiRules,
} from "@/src/lib/library/local-knowledge-rules";
import { matureLibraryAuditSummary } from "@/src/lib/library/mature-local-library";
import {
  localBenchmarkProfiles,
  localEnvironmentProfiles,
  localFaultSamples,
  localHardwareComponentProfiles,
  localRepairRecipes,
  localSdkApiProfiles,
  localVersionConstraints,
} from "@/src/lib/library/deep-knowledge-database";

const categoryTargets: Record<KnowledgeRuleCategory, { label: string; target: number; requiredTags: string[]; next: string }> = {
  math: {
    label: "数学模型",
    target: 8,
    requiredTags: ["graph", "capacity", "confidence", "boundary", "coverage"],
    next: "补概率统计、队列稳定、单位换算和异常传播公式。",
  },
  algorithm: {
    label: "算法模型",
    target: 8,
    requiredTags: ["big-o", "graph", "search", "sort", "stream"],
    next: "补动态规划、并查集、哈希冲突、近似算法和图优化选择规则。",
  },
  efficiency: {
    label: "效率模型",
    target: 12,
    requiredTags: ["concurrency", "database", "memory", "io", "blocking", "orm", "index"],
    next: "补 CPU 密集、序列化成本、渲染频率、缓存失效和真实基准数据模型。",
  },
  security: {
    label: "安全规则",
    target: 18,
    requiredTags: ["taint", "injection", "xss", "ssrf", "auth", "crypto", "csrf", "cors", "jwt", "dependency", "framework"],
    next: "补权限提升、租户隔离、文件上传、反序列化 gadget 和更多框架专用 sink。",
  },
  stability: {
    label: "稳定规则",
    target: 14,
    requiredTags: ["timeout", "retry", "transaction", "cleanup", "idempotency", "lock", "device", "hardware"],
    next: "补限流降级、时钟漂移、分布式一致性和真实运行时故障样本。",
  },
  language_api: {
    label: "语言 API",
    target: 24,
    requiredTags: ["javascript", "python", "go", "rust", "java", "c", "cpp", "orm", "framework", "hardware", "security", "stability"],
    next: "补更多框架版本、设备 SDK、标准库边界和 API 版本差异。",
  },
};

const severityKeys: KnowledgeRuleSeverity[] = ["info", "warn", "risk", "critical"];
const evidenceTypeKeys: KnowledgeRuleEvidence["evidenceType"][] = ["regex", "ast", "type", "runtime", "dependency"];

export function buildKnowledgeRuleCoverageReport(): KnowledgeRuleCoverageReport {
  const areas = (Object.keys(categoryTargets) as KnowledgeRuleCategory[]).map((category) => buildArea(category));
  const matureSummary = matureLibraryAuditSummary();
  const severityCoverage = countBy(severityKeys, localKnowledgeRules.map((rule) => rule.severity));
  const evidenceTypeCoverage = countBy(evidenceTypeKeys, localKnowledgeRuleEvidence.map((item) => item.evidenceType));
  const languageCount = new Set(localLanguageApiRules.map((api) => api.language)).size;
  const sourceCompleteness = evidenceTypeCoverage.runtime > 0 && evidenceTypeCoverage.dependency > 0 ? 100 : 64;
  const areaScore = average(areas.map((area) => area.percent));
  const languageScore = Math.min(100, Math.round((languageCount / 6) * 100));
  const overall = clamp(Math.round(areaScore * 0.5 + sourceCompleteness * 0.12 + languageScore * 0.1 + matureSummary.overall * 0.28));
  const dataQuality = buildKnowledgeDataQuality();
  const gaps = [
    ...areas.flatMap((area) => area.missing.map((item) => `${area.label}缺：${item}`)),
    ...matureSummary.audits
      .filter((item) => item.status !== "成熟数据")
      .map((item) => `${item.category}成熟库缺：${item.missingDomains.join("、") || "真实样本/版本证据"}`),
    "版本差异缺：需要把规则与语言版本、框架版本、SDK 版本和 API 行为变化绑定。",
    "真实故障样本缺：需要录入断点、溢出、竞态、注入、设备离线等案例作为本地证据。",
    "性能基准缺：需要记录输入规模、时间、内存、I/O 和稳定性曲线，支撑流速替代方案评分。",
    ...(evidenceTypeCoverage.runtime ? [] : ["缺少运行时样本证据类型，规则仍主要依赖静态扫描。"]),
    ...(evidenceTypeCoverage.dependency ? [] : ["缺少依赖/版本证据类型，无法判断第三方库漏洞和 API 版本差异。"]),
    ...(languageCount >= 6 ? [] : ["语言 API 覆盖不足，当前还需要补 Java、C/C++、数据库和框架 API。"]),
  ].slice(0, 10);

  return {
    overall,
    status: overall >= 72 ? "接近 Alpha 规则库" : overall >= 52 ? "可用于项目初筛" : "种子可用",
    summary: `当前规则库有 ${localKnowledgeRules.length} 条内置规则，本地知识目录有 ${matureSummary.entryCount} 条条目，${matureSummary.matureCategoryCount}/${matureSummary.categoryCount} 个类别达到内部数量/领域门槛。它是可追溯的本地分析基线，不等于全面覆盖所有语言、SDK、CVE、硬件和真实故障。`,
    ruleCount: localKnowledgeRules.length,
    conceptCount: localKnowledgeConcepts.length,
    evidenceCount: localKnowledgeRuleEvidence.length,
    languageApiCount: localLanguageApiRules.length,
    languageCount,
    severityCoverage,
    evidenceTypeCoverage,
    areas,
    gaps,
    evolution: buildKnowledgeRuleEvolution(areas, sourceCompleteness, languageScore),
    dataQuality,
    completed: [
      "已建立项目图谱 Schema：analysis_runs、project_files、project_functions、function_symbols、call_edges、flow_nodes、flow_edges。",
      "已建立深层证据 Schema：knowledge_feature_vectors、version_constraints、sdk_api_profiles、fault_samples、benchmark_profiles、repair_recipes、hardware_component_profiles、environment_profiles。",
      "已建立成熟本地库 Schema：library_domains、library_entries，并录入数学、算法、效率、安全、稳定、语言生态、运行环境、电子元件、语义索引和工具适配器条目。",
      "已覆盖数学、算法、效率、安全、稳定和语言 API 六类规则。",
      "已把规则命中接入函数风险、水文图状态、问题列表和语义索引。",
      "已具备 TS/JS、Python、Go、Rust、Java、C/C++、ORM、Web 框架、环境载体和硬件接口 API 种子。",
      "DeepWeb 学习结果已区分内置专家种子、项目静态证据、真实运行证据、候选参数和稳定模型版本，不再用规则数量冒充外部事实完整度。",
    ],
  };
}

function buildKnowledgeDataQuality(): KnowledgeRuleCoverageReport["dataQuality"] {
  const coverage = clamp(Math.round(average([
    Math.min(100, localVersionConstraints.length / 18 * 100),
    Math.min(100, localSdkApiProfiles.length / 18 * 100),
    Math.min(100, localFaultSamples.length / 20 * 100),
    Math.min(100, localBenchmarkProfiles.length / 16 * 100),
    Math.min(100, localRepairRecipes.length / 16 * 100),
    Math.min(100, localEnvironmentProfiles.length / 10 * 100),
    Math.min(100, localHardwareComponentProfiles.length / 10 * 100),
  ])));
  // Seed entries have stable IDs and useful reproduction fields, but no signed source artifact or update timestamp yet.
  const traceability = 42;
  const freshness = 24;
  const benchmarkReproducibility = localBenchmarkProfiles.length ? 44 : 0;
  const repairVerification = localRepairRecipes.length ? 22 : 0;
  const conflictControl = 30;
  const score = clamp(Math.round(
    coverage * 0.34 + traceability * 0.2 + freshness * 0.12 +
    benchmarkReproducibility * 0.14 + repairVerification * 0.12 + conflictControl * 0.08,
  ));
  return {
    score,
    status: score >= 82 ? "validated" : score >= 55 ? "reviewable" : "seed",
    coverage,
    traceability,
    freshness,
    benchmarkReproducibility,
    repairVerification,
    conflictControl,
    evidence: [
      `版本 ${localVersionConstraints.length} · SDK/API ${localSdkApiProfiles.length} · 故障 ${localFaultSamples.length}`,
      `benchmark ${localBenchmarkProfiles.length} · 修复配方 ${localRepairRecipes.length} · 环境 ${localEnvironmentProfiles.length} · 硬件 ${localHardwareComponentProfiles.length}`,
      "本地种子可用于候选匹配；未绑定签名来源、采集时间与回放结果时不得成为高可信老师标签。",
    ],
    blockers: [
      "条目缺少 source artifact hash、许可证快照和 checked_at。",
      "benchmark 缺少机器配置、预热、重复次数、原始分布与方差。",
      "修复配方缺少修改前后相同样本的回归、安全和性能回放记录。",
      "冲突条目尚缺跨来源共识、撤销和版本覆盖策略。",
    ],
  };
}

function buildKnowledgeRuleEvolution(
  areas: KnowledgeRuleCoverageArea[],
  sourceCompleteness: number,
  languageScore: number,
): KnowledgeRuleEvolutionStage[] {
  const baseCoverage = average(areas.map((area) => area.percent));
  const alphaCoverage = clamp(Math.round(baseCoverage * 0.58 + languageScore * 0.18 + sourceCompleteness * 0.24));
  const deepCoverage = clamp(Math.round(sourceCompleteness * 0.42 + Math.min(100, localKnowledgeRuleEvidence.length * 2) * 0.28 + languageScore * 0.3));

  return [
    {
      id: "light-web-rules",
      name: "浅层规则网",
      layer: "Light Web",
      status: "已成型",
      coverage: clamp(Math.round(baseCoverage)),
      summary: "关键词、API 签名、AST/type 证据形成第一层本地规则种子。",
      next: "继续补齐不同语言和框架的静态 sink/source 模式。",
    },
    {
      id: "alpha-feature-map",
      name: "Alpha 复杂特征映射",
      layer: "Alpha Feature Map",
      status: "联动中",
      coverage: alphaCoverage,
      summary: "规则命中已映射到函数风险、水文节点颜色、水路状态、问题列表和语义索引。",
      next: "把命中原因、证据、修正建议完整挂到节点/水路点击浮窗。",
    },
    {
      id: "deep-evidence-web",
      name: "深层证据网",
      layer: "Deep Evidence Web",
      status: "待建设",
      coverage: Math.min(68, deepCoverage),
      summary: "下一层需要版本差异、SDK 参数、真实故障样本和性能基准数据。",
      next: "建立本地样本库和基准运行记录，让推荐从规则判断升级到证据评分。",
    },
  ];
}

function buildArea(category: KnowledgeRuleCategory): KnowledgeRuleCoverageArea {
  const target = categoryTargets[category];
  const rules = localKnowledgeRules.filter((rule) => rule.category === category);
  const tags = new Set(rules.flatMap((rule) => rule.tags));
  const missing = target.requiredTags.filter((tag) => !tags.has(tag));
  const countScore = Math.min(100, Math.round((rules.length / target.target) * 100));
  const tagScore = Math.round(((target.requiredTags.length - missing.length) / target.requiredTags.length) * 100);
  const percent = clamp(Math.round(countScore * 0.68 + tagScore * 0.32));

  return {
    category,
    label: target.label,
    ruleCount: rules.length,
    targetCount: target.target,
    percent,
    status: percent >= 80 ? "已成型" : percent >= 52 ? "可用但需扩展" : "缺口明显",
    missing,
    next: target.next,
  };
}

function countBy<T extends string>(keys: T[], values: T[]) {
  return keys.reduce(
    (acc, key) => {
      acc[key] = values.filter((value) => value === key).length;
      return acc;
    },
    {} as Record<T, number>,
  );
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}
