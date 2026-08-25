import type {
  AnalysisIssue,
  BuildProgressItem,
  CodeFile,
  FlowEdge,
  FunctionInfo,
  HydrologyModelReport,
  LocalLibraryAuditItem,
  MapQualityReport,
  ProjectCompletionArea,
  ProjectCompletionReport,
  ProgramDigitalTwinReport,
  ProgramVerificationReport,
  RuntimeSandboxReport,
  SemanticIndexReport,
} from "@/src/lib/analysis/types";

type CompletionInput = {
  files: CodeFile[];
  functions: FunctionInfo[];
  flowEdges: FlowEdge[];
  buildItems: BuildProgressItem[];
  localLibraryAudit: LocalLibraryAuditItem[];
  mapQuality: MapQualityReport;
  hydrologyModel: HydrologyModelReport;
  semanticIndex: SemanticIndexReport;
  runtimeSandbox: RuntimeSandboxReport;
  digitalTwin: ProgramDigitalTwinReport;
  programVerification: ProgramVerificationReport;
  securityIssues: AnalysisIssue[];
  environmentIssues: AnalysisIssue[];
};

export function estimateProjectCompletion(input: CompletionInput): ProjectCompletionReport {
  const knowledgeCoverage = average(input.localLibraryAudit.filter((item) => item.category !== "工具适配器").map((item) => item.coverage));
  const parserCoverage = input.localLibraryAudit.find((item) => item.category === "工具适配器")?.coverage ?? 0;
  const safetyCoverage = average(
    input.localLibraryAudit
      .filter((item) => item.category === "安全规则库" || item.category === "稳定性规则库")
      .map((item) => item.coverage),
  );
  const algorithmCoverage = average(
    input.localLibraryAudit
      .filter((item) => item.category === "数学模型库" || item.category === "算法模型库" || item.category === "效率知识库")
      .map((item) => item.coverage),
  );
  const matureLibraryCount = input.localLibraryAudit.filter((item) => item.status === "成熟数据").length;
  const fixCenter = input.buildItems.find((item) => item.name === "修复推荐中心")?.percent ?? 0;
  const workspaceScore = input.files.length > 1 ? 68 : input.files.length ? 52 : 18;
  const parserScore = clamp(Math.max(parserCoverage, input.functions.length ? 52 : 16));
  const hydrologyScore = input.hydrologyModel.stageCount
    ? clamp(42 + Math.min(26, input.hydrologyModel.confluenceCount * 2 + input.hydrologyModel.storageCount * 3) - input.hydrologyModel.riskCount * 2)
    : 18;
  const mapScore = clamp((input.mapQuality.readabilityScore - 8 + hydrologyScore) / 2);
  const indexScore = clamp(Math.min(72, input.semanticIndex.integrityScore - 10));
  const runtimeScore = clamp(Math.min(54, input.runtimeSandbox.readinessScore - 18));
  const twinScore = clamp(
    Math.min(
      input.digitalTwin.executedExperimentCount ? 88 : 58,
      (input.digitalTwin.fidelityScore + input.digitalTwin.coverageScore) / 2,
    ),
  );
  const productScore = input.functions.length && input.flowEdges.length ? 58 : 30;

  const areas: ProjectCompletionArea[] = [
    {
      name: "工作区导入与主控识别",
      weight: 9,
      percent: workspaceScore,
      status: statusFor(workspaceScore),
      evidence: `${input.files.length} 个文件 · ${input.functions.length} 个函数`,
      next: "补项目快照、忽略规则配置、增量扫描和入口置信度解释。",
    },
    {
      name: "可靠解析层",
      weight: 15,
      percent: parserScore,
      status: statusFor(parserScore),
      evidence: "Tauri native Tree-sitter 覆盖 15 类语言；12 个 LSP/Compiler provider 已进入默认语义链，核心 portable sidecar 5/5 通过全包哈希与协议验证。",
      next: "继续用大型跨文件项目校准语义超时、重载消歧、反射边界、宏展开和诊断覆盖。",
    },
    {
      name: "本地知识库/数据底座",
      weight: 11,
      percent: Math.round(knowledgeCoverage),
      status: statusFor(knowledgeCoverage),
      evidence: `${input.localLibraryAudit.length} 个知识库入口，${matureLibraryCount} 类达到内部目录门槛；DeepWeb 模型版本、14x12x6 MLP、向量、监督、epoch、基因和回滚工件已进入 native SQLite。`,
      next: "继续导入公开基准、CVE/SDK 版本事实和经过复现的故障/修复样本；知识覆盖不能靠自动补分代替真实证据。",
    },
    {
      name: "水系地图与交互",
      weight: 9,
      percent: mapScore,
      status: statusFor(mapScore),
      evidence: `可读性 ${input.mapQuality.readabilityScore}% · 水文阶段 ${input.hydrologyModel.stageCount} · 汇聚 ${input.hydrologyModel.confluenceCount}`,
      next: "接自动布局、缩放、拖拽、局部展开和大项目聚合。",
    },
    {
      name: "语义索引与持久化",
      weight: 11,
      percent: indexScore,
      status: statusFor(indexScore),
      evidence: `${input.semanticIndex.storageMode} · ${input.semanticIndex.tables.length} 张索引表模型`,
      next: "native SQLite 已保存项目、函数图、水系和孪生实验；下一步补后台增量索引、查询页和版本清理策略。",
    },
    {
      name: "Runtime Sandbox 仿真",
      weight: 11,
      percent: runtimeScore,
      status: statusFor(runtimeScore),
      evidence: `${input.runtimeSandbox.mode} · ${input.runtimeSandbox.scenarios.length} 个输入场景`,
      next: "接 Web Worker/Node Worker 受控执行、断点、资源限制和输入样本回放。",
    },
    {
      name: "安全与稳定规则",
      weight: 11,
      percent: Math.round(Math.max(18, safetyCoverage - input.securityIssues.length * 2)),
      status: statusFor(safetyCoverage),
      evidence: `${input.securityIssues.length} 个安全问题 · ${input.environmentIssues.length} 个环境问题`,
      next: "建立 taint flow、权限边界、异常传播、溢出和闭环规则包。",
    },
    {
      name: "算法效率与修复推荐",
      weight: 9,
      percent: Math.round((algorithmCoverage + fixCenter) / 2),
      status: statusFor((algorithmCoverage + fixCenter) / 2),
      evidence: `算法/效率覆盖 ${Math.round(algorithmCoverage)}% · 修复中心 ${fixCenter}%`,
      next: "生成可验证 diff 草案、测试建议、替代方案评分和回滚点。",
    },
    {
      name: "Program Digital Twin",
      weight: 8,
      percent: twinScore,
      status: statusFor(twinScore),
      evidence: `${input.digitalTwin.experiments.length} 类实验 · ${input.digitalTwin.executedExperimentCount} 项真实执行 · 保真度 ${input.digitalTwin.fidelityScore}%`,
      next: "接 Tauri sidecar 受控运行器，把动态、压力、安全和环境实验从模型仿真升级为真实执行。",
    },
    {
      name: "Program Verification",
      weight: 8,
      percent: input.programVerification.score,
      status: statusFor(input.programVerification.score),
      evidence: `${input.programVerification.obligationCount} 条证明义务 · 已证明 ${input.programVerification.provedCount} · 违反 ${input.programVerification.violatedCount} · 形式化证据 ${input.programVerification.formalEvidenceCount}`,
      next: input.programVerification.gaps[0] ?? "保持证明记录与代码、环境、知识包版本可回放。",
    },
    {
      name: "产品化、测试和交付",
      weight: 6,
      percent: productScore,
      status: statusFor(productScore),
      evidence: "已有 Tauri 桌面壳、native SQLite writer、构建测试和核心模块回归；尚未形成签名安装包和真实大项目基准。",
      next: "补桌面端到端测试、文件权限、应用图标、签名安装包和发布配置。",
    },
  ];

  const overall = Math.round(
    areas.reduce((sum, area) => sum + area.percent * area.weight, 0) /
      areas.reduce((sum, area) => sum + area.weight, 0),
  );

  return {
    overall,
    confidence: confidenceFor(input, areas),
    stage: stageFor(overall),
    summary: `当前已进入本地软件 Alpha 内核建设：多项目、水系图、DeepWeb、native SQLite、跨语言 native AST、按语言 LSP 语义链和程序数字孪生已经连通；工具分发、真实大项目验证与可验证修复仍是决定成熟度的主要缺口。`,
    areas,
    remaining: [
      "在发布 CI 中生成 Pyright/JDT LS 的完整运行时包和原生 LSP 二进制包，写入 SHA-256 构建锁并完成签名。",
      "Runtime Sandbox 与 Program Digital Twin 从模型仿真升级为 Tauri sidecar 受控执行。",
      "修复推荐中心生成 diff、测试建议和回滚点。",
      "native SQLite 增加后台增量索引、版本保留和可查询实验历史。",
      "生成 macOS/Windows/Linux 安装包并完成桌面文件权限与签名验证。",
      "用 1k+ 函数项目做地图布局、索引和仿真性能基准。",
    ],
  };
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function statusFor(percent: number): ProjectCompletionArea["status"] {
  if (percent >= 72) return "已成型";
  if (percent >= 18) return "建设中";
  return "待建设";
}

function stageFor(overall: number): ProjectCompletionReport["stage"] {
  if (overall >= 72) return "Beta 准备";
  if (overall >= 56) return "Alpha 内核";
  if (overall >= 36) return "核心能力建设";
  return "可视化原型";
}

function confidenceFor(input: CompletionInput, areas: ProjectCompletionArea[]) {
  let confidence = 58;
  if (input.functions.length >= 8) confidence += 8;
  if (input.semanticIndex.tables.length >= 6) confidence += 8;
  if (input.runtimeSandbox.scenarios.length >= 4) confidence += 6;
  if (areas.filter((area) => area.status === "待建设").length) confidence -= 8;
  return clamp(confidence);
}
