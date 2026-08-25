import type {
  ControlledRuntimeExecutionReport,
  ParserReport,
  WorkspaceAnalysis,
} from "@/src/lib/analysis/types";

export type DesignConformanceStatus = "已实现" | "部分实现" | "模型阶段" | "未实现";

export type DesignConformancePillar = {
  id: string;
  name: string;
  status: DesignConformanceStatus;
  score: number;
  evidence: string[];
  gaps: string[];
};

export type DesignConformanceReport = {
  score: number;
  verifiedPillarCount: number;
  pillarCount: number;
  pillars: DesignConformancePillar[];
  truthStatement: string;
};

export function buildDesignConformanceReport(
  analysis: WorkspaceAnalysis,
  parserReport: ParserReport,
  runtimeExecutions: ControlledRuntimeExecutionReport[],
): DesignConformanceReport {
  const deepWeb = analysis.semanticIndex.deepDatabase.deepWeb;
  const runtimePassed = runtimeExecutions.filter((run) => run.status === "passed");
  const sandboxed = runtimeExecutions.filter((run) => run.sandboxStatus === "enforced");
  const matureDimensions = deepWeb.maturity.matureValidationCount;
  const matureTarget = Math.max(1, deepWeb.maturity.targetCount);
  const primaryEdges = analysis.flowEdges.filter((edge) => edge.primary).length;
  const parserReliability = parserReport.reliabilityScore;
  const treeSitterActive = parserReport.capabilities.some(
    (capability) => capability.layer === "Tree-sitter" && capability.status === "active",
  );
  const lspActive = parserReport.capabilities.some(
    (capability) => capability.layer === "LSP" && capability.status === "active",
  );
  const parserFactScore = treeSitterActive
    ? Math.min(88, Math.round(parserReliability * 0.72 + (lspActive ? 22 : 10)))
    : Math.min(45, Math.round(parserReliability * 0.48));

  const pillars: DesignConformancePillar[] = [
    pillar(
      "hydrology",
      "水流法",
      Math.round(
        analysis.closureScore * 0.55 +
          analysis.mapQuality.readabilityScore * 0.25 +
          Math.min(100, primaryEdges * 12) * 0.2,
      ),
      primaryEdges > 0 && analysis.entryFunction ? "已实现" : analysis.flowNodes.length ? "部分实现" : "未实现",
      [
        `入口 ${analysis.entryFunction?.name ?? "未识别"}，主河道 ${primaryEdges} 段。`,
        `闭环 ${analysis.closureScore}%，地图可读性 ${analysis.mapQuality.readabilityScore}%。`,
      ],
      [
        !analysis.entryFunction ? "缺少可信主控入口。" : "",
        primaryEdges === 0 ? "尚未形成从输入到输出的有序主河道。" : "",
        analysis.mapQuality.overlapCount > 0 ? `仍检测到 ${analysis.mapQuality.overlapCount} 处节点或水路重叠。` : "",
      ],
    ),
    pillar(
      "deepweb",
      "基因法 / DeepWeb",
      Math.round((matureDimensions / matureTarget) * 100),
      matureDimensions === matureTarget ? "已实现" : deepWeb.generatedVectorCount ? "模型阶段" : "未实现",
      [
        `多维向量 ${deepWeb.generatedVectorCount}，推理记录 ${deepWeb.inferenceRunCount}。`,
        `成熟验证 ${matureDimensions}/${matureTarget}，监督信任 ${deepWeb.supervised.trustScore}%。`,
      ],
      [
        matureDimensions < matureTarget ? "种子规则和静态命中不能代替运行、benchmark 或修复验证样本。" : "",
        deepWeb.maturity.baseCoverageCount ? `${deepWeb.maturity.baseCoverageCount} 个维度仍只是基础覆盖。` : "",
      ],
    ),
    pillar(
      "parser",
      "全语言可靠解析",
      parserFactScore,
      treeSitterActive ? "部分实现" : "模型阶段",
      [
        `当前项目解析分 ${parserReliability}%；AST 事实${treeSitterActive ? "已生效" : "未生效"}，LSP 语义${lspActive ? "已生效" : "未生效"}。`,
        parserReport.enhancement.evidence,
      ],
      [
        !treeSitterActive ? "当前只有前端候选扫描，启发式函数边界与类型不能冒充 Compiler/LSP 事实。" : "",
        !lspActive ? "当前项目没有获得真实 LSP 返回，跨文件类型、definition 和 references 仍需补证。" : "",
        "全语言是产品级目标，单个项目解析分再高也不代表所有语言、宏、反射和动态调用已完成验证。",
      ],
    ),
    pillar(
      "digital-twin",
      "程序数字孪生",
      analysis.digitalTwin.fidelityScore,
      runtimePassed.length ? "部分实现" : "模型阶段",
      [
        `数字孪生保真度 ${analysis.digitalTwin.fidelityScore}%。`,
        `真实成功执行 ${runtimePassed.length} 次，模型实验 ${analysis.digitalTwin.simulatedExperimentCount} 项。`,
      ],
      [runtimePassed.length === 0 ? "尚无成功真实执行样本，当前动态结论仍以模型仿真为主。" : ""],
    ),
    pillar(
      "sandbox",
      "受控运行与资源观测",
      runtimeExecutions.length
        ? Math.round((sandboxed.length / runtimeExecutions.length) * 70 + (runtimePassed.length / runtimeExecutions.length) * 30)
        : 0,
      sandboxed.length && runtimePassed.length ? "已实现" : runtimeExecutions.length ? "部分实现" : "未实现",
      [
        `执行记录 ${runtimeExecutions.length}，平台隔离生效 ${sandboxed.length}。`,
        `每次执行记录 CPU、峰值内存、子进程树与文件改动。`,
      ],
      [
        runtimeExecutions.length === 0 ? "需要在 Tauri 桌面程序中执行项目后才能验证。" : "",
        runtimeExecutions.some((run) => run.sandboxStatus !== "enforced") ? "存在未获得平台级隔离的执行记录。" : "",
      ],
    ),
    pillar(
      "security",
      "内外部安全分析",
      analysis.damScore,
      analysis.securityIssues.length || analysis.damScore < 100 ? "部分实现" : "已实现",
      [`安全堤坝 ${analysis.damScore}%，当前安全诊断 ${analysis.securityIssues.length} 项。`],
      ["静态规则命中只能标出候选风险；攻击是否可达仍需污点路径和受控攻击回放。"],
    ),
  ];

  const score = Math.round(pillars.reduce((sum, item) => sum + item.score, 0) / pillars.length);
  return {
    score,
    verifiedPillarCount: pillars.filter((item) => item.status === "已实现").length,
    pillarCount: pillars.length,
    pillars,
    truthStatement:
      "完成度只计算有代码路径和证据链的能力；页面、种子数据、启发式候选与模拟分数不等于真实验证完成。",
  };
}

function pillar(
  id: string,
  name: string,
  score: number,
  status: DesignConformanceStatus,
  evidence: string[],
  gaps: string[],
): DesignConformancePillar {
  return {
    id,
    name,
    status,
    score: Math.max(0, Math.min(100, Math.round(score))),
    evidence: evidence.filter(Boolean),
    gaps: gaps.filter(Boolean),
  };
}
