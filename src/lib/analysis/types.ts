export type GraphMode = "calls" | "folders" | "fsm" | "entry" | "water";

export type CodeFile = {
  id: string;
  name: string;
  language: string;
  content: string;
  size?: number;
  hash?: string;
  lastModified?: number;
  imports?: string[];
  environmentRefs?: string[];
  deviceRefs?: string[];
};

export type FunctionInfo = {
  id: string;
  name: string;
  fileId: string;
  fileName: string;
  language: string;
  startLine: number;
  endLine: number;
  params: string[];
  returnType: string;
  outputs: string[];
  calls: string[];
  summary: string;
  dataShape: string;
  complexity: number;
  category: string;
  body: string;
  sideEffects: string[];
  externalInputs: string[];
  validations: string[];
  risks: string[];
  source: "Parser Fact" | "Rule Finding" | "Heuristic";
  confidence: number;
  parser?: string;
  parseEvidence?: string[];
  astControlFlow?: {
    nodes: Array<{
      id: string;
      kind: "entry" | "branch" | "loop" | "return" | "throw" | "catch" | "assignment" | "call" | "exit";
      startLine: number;
      endLine: number;
      definitions: string[];
      uses: string[];
      ownershipEvents: string[];
      concurrencyEvents: string[];
    }>;
    edges: Array<{
      from: string;
      to: string;
      kind: "normal" | "false" | "back" | "return" | "exception";
      condition: string;
    }>;
  };
};

export type TypeDeclarationField = {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  line: number;
};

export type TypeDeclarationInfo = {
  id: string;
  name: string;
  fileId: string;
  fileName: string;
  language: string;
  kind: "数据模型" | "ORM 模型" | "类" | "接口" | "枚举" | "类型别名";
  role: string;
  baseTypes: string[];
  fields: TypeDeclarationField[];
  methods: string[];
  configuration: string[];
  startLine: number;
  endLine: number;
  confidence: number;
  parser: string;
  evidence: string[];
};

export type GraphEdge = {
  from: string;
  to: string;
  kind?: "call" | "import" | "data";
  confidence?: number;
  evidence?: string;
};

export type GraphNode = {
  id: string;
  x: number;
  y: number;
  fn: FunctionInfo;
};

export type AnalysisIssue = {
  id: string;
  title: string;
  category: "flow" | "security" | "environment" | "performance" | "quality";
  severity: "Critical" | "High" | "Medium" | "Low";
  status: "Confirmed" | "Likely" | "Possible" | "Unknown";
  message: string;
  evidence: string;
  confidence: number;
};

export type DiagnosticEvidenceAudit = {
  completionScore: number;
  status: "证据闭环" | "部分闭环" | "启发式待补证";
  total: number;
  confirmed: number;
  likely: number;
  possible: number;
  unknown: number;
  runtimeConfirmed: number;
  compilerSupported: number;
  heuristicCandidates: number;
  gaps: string[];
  evidence: string[];
};

export type FlowNode = {
  id: string;
  functionId?: string;
  name: string;
  role:
    | "水源"
    | "管道"
    | "阀门"
    | "水箱"
    | "泵"
    | "排水口"
    | "漏点"
    | "堵塞"
    | "溢流"
    | "回流";
  status: "Closed" | "Partially Closed" | "Open" | "Overflow Risk" | "Blocked" | "Unknown";
  note: string;
  capacity?: "小溪" | "河道" | "水池" | "水库" | "湖";
  capacityScore?: number;
  confidence?: number;
  evidence?: string;
  details?: string[];
  x?: number;
  y?: number;
  depth?: number;
  upstreamIds?: string[];
  downstreamIds?: string[];
  visualKind?: "function" | "basin";
  basin?: string;
  elevation?: number;
  fanRadius?: number;
  fanAngle?: number;
  fanOriginX?: number;
  fanOriginY?: number;
  fanLayerRadius?: number;
  fanBandOffset?: number;
  aggregateMemberIds?: string[];
  aggregateMemberNames?: string[];
};

export type FlowEdge = {
  id: string;
  from: string;
  to: string;
  kind: "水路" | "河流" | "小溪" | "闭环线路" | "溢流支路" | "异常支路";
  status: "Closed" | "Partially Closed" | "Open" | "Overflow Risk" | "Blocked" | "Unknown";
  volume: number;
  confidence: number;
  evidence: string;
  primary?: boolean;
  transferKind?: "parameter" | "return" | "state" | "external" | "unknown";
  dataItems?: Array<{
    name: string;
    type: string;
    origin: "parameter" | "return" | "external" | "state" | "unknown";
    destination: "parameter" | "return" | "sink" | "state" | "unknown";
    confidence: number;
    evidence: string;
  }>;
  sourceKind?: "entry" | "external_input" | "function_output" | "state" | "unknown";
  sinkKind?: "function_parameter" | "return" | "database" | "file" | "network" | "process" | "state" | "unknown";
  evidenceGrade?: "compiler" | "lsp" | "ast" | "lexical" | "runtime";
  runtimeObservation?: {
    observed: boolean;
    runIds: string[];
    sampleIds: string[];
    count: number;
    evidence: string;
  };
  taintPathIds?: string[];
  taintStatus?: "none" | "candidate" | "exposed" | "sanitized";
  visualRelationCount?: number;
};

export type TaintSourceKind =
  | "request"
  | "parameter"
  | "environment"
  | "file"
  | "database"
  | "network"
  | "device"
  | "unknown";

export type TaintSinkKind =
  | "sql"
  | "command"
  | "dom"
  | "file"
  | "network"
  | "database-write"
  | "shared-state"
  | "unknown";

export type TaintPath = {
  id: string;
  sourceFunctionId: string;
  sourceFunctionName: string;
  sourceKind: TaintSourceKind;
  sinkFunctionId: string;
  sinkFunctionName: string;
  sinkKind: TaintSinkKind;
  functionIds: string[];
  edgePairs: string[];
  dataNames: string[];
  sanitizerFunctionIds: string[];
  status: "candidate" | "exposed" | "sanitized";
  confidence: number;
  evidenceGrade: "runtime" | "compiler" | "lsp" | "ast" | "lexical";
  evidence: string[];
};

export type TaintFlowReport = {
  sourceCount: number;
  sinkCount: number;
  pathCount: number;
  exposedPathCount: number;
  sanitizedPathCount: number;
  candidatePathCount: number;
  runtimeConfirmedPathCount: number;
  truncated: boolean;
  summary: string;
  paths: TaintPath[];
};

export type HydrologyRiskLevel = "none" | "warn" | "risk" | "critical";

export type HydrologyCodeRole =
  | "主控入口"
  | "入参采集"
  | "净化过滤"
  | "转换处理"
  | "分流调度"
  | "汇聚合并"
  | "容量存储"
  | "结果输出"
  | "异常边界";

export type HydrologyWaterRole =
  | "源头"
  | "入水口"
  | "净化池"
  | "主河道"
  | "分岔溪口"
  | "溪流汇聚口"
  | "湖泊/水库"
  | "出水口"
  | "警戒水段";

export type HydrologyStage = {
  id: string;
  functionId: string;
  functionName: string;
  fileName: string;
  line: number;
  index: number;
  codeRole: HydrologyCodeRole;
  waterRole: HydrologyWaterRole;
  capacity: NonNullable<FlowNode["capacity"]>;
  dataIn: string[];
  dataOut: string[];
  upstreamCount: number;
  downstreamCount: number;
  confidence: number;
  riskLevel: HydrologyRiskLevel;
  evidence: string;
};

export type HydrologyConfluence = {
  id: string;
  name: string;
  functionId: string;
  fileName: string;
  waterRole: "分岔溪口" | "溪流汇聚口" | "湖泊/水库";
  upstreamCount: number;
  downstreamCount: number;
  capacity: NonNullable<FlowNode["capacity"]>;
  riskLevel: HydrologyRiskLevel;
  confidence: number;
  evidence: string;
};

export type HydrologyAnalogyRule = {
  codeSignal: string;
  waterSignal: string;
  visualRule: string;
};

export type HydrologyModelReport = {
  entryName: string;
  outputNames: string[];
  stageCount: number;
  confluenceCount: number;
  storageCount: number;
  riskCount: number;
  summary: string;
  analogy: HydrologyAnalogyRule[];
  stages: HydrologyStage[];
  confluences: HydrologyConfluence[];
};

export type ParserDiagnostic = {
  id: string;
  fileName: string;
  severity: "Info" | "Warning" | "Risk";
  message: string;
  evidence: string;
  confidence: number;
};

export type ParserReport = {
  adapterName: string;
  mode: "Deterministic Local" | "AST Ready" | "Heuristic Fallback";
  reliabilityScore: number;
  languages: string[];
  functionCount: number;
  declarationCount: number;
  edgeCount: number;
  languageCoverage?: ParserLanguageCoverage[];
  diagnostics: ParserDiagnostic[];
  capabilities: ParserCapability[];
  enhancement: ParserEnhancementReport;
  evidence: string[];
};

export type ParserLanguageCoverage = {
  language: string;
  fileCount: number;
  parsedFileCount: number;
  functionCount: number;
  diagnosticCount: number;
  status: "ast-ready" | "ast-warning" | "partial" | "unsupported";
  semanticLayer?: string;
  semanticStatus?: "executed" | "partial" | "missing" | "not-applicable";
};

export type ParserEnhancementReport = {
  status: "base" | "merged" | "unavailable";
  source: string;
  mergedFunctions: number;
  addedFunctions: number;
  addedEdges: number;
  confidenceGain: number;
  evidence: string;
  next: string;
};

export type ParserCapability = {
  name: string;
  layer: "Tree-sitter" | "LSP" | "Compiler API" | "Heuristic" | "Bridge";
  status: "active" | "ready" | "missing" | "planned";
  coverage: number;
  evidence: string;
  next: string;
};

export type LocalLibraryCategory =
  | "数学模型库"
  | "算法模型库"
  | "效率知识库"
  | "安全规则库"
  | "稳定性规则库"
  | "语言生态库"
  | "运行环境库"
  | "电子元件参数库"
  | "语义索引库"
  | "工具适配器";

export type LocalLibraryStatus = "成熟数据" | "部分具备" | "种子数据" | "需要建设" | "后续扩展";

export type KnowledgeRuleCategory =
  | "math"
  | "algorithm"
  | "efficiency"
  | "security"
  | "stability"
  | "language_api";

export type KnowledgeRuleKind =
  | "formula"
  | "pattern"
  | "complexity"
  | "risk"
  | "api_signature"
  | "guard";

export type KnowledgeRuleSeverity = "info" | "warn" | "risk" | "critical";

export type KnowledgeSourceVersion = {
  id: string;
  name: string;
  version: string;
  scope: KnowledgeRuleCategory[];
  updatedAt: string;
  evidence: string;
};

export type KnowledgeConcept = {
  id: string;
  category: KnowledgeRuleCategory;
  name: string;
  summary: string;
  tags: string[];
  sourceVersionId: string;
};

export type KnowledgeRule = {
  id: string;
  category: KnowledgeRuleCategory;
  kind: KnowledgeRuleKind;
  name: string;
  summary: string;
  appliesTo: string[];
  signalPatterns: string[];
  inputs: string[];
  outputs: string[];
  severity: KnowledgeRuleSeverity;
  confidenceBase: number;
  recommendation: string;
  evidenceSource: string;
  sourceVersionId: string;
  tags: string[];
  formula?: string;
  complexity?: string;
  language?: string;
  safeAlternative?: string;
};

export type KnowledgeRuleEvidence = {
  id: string;
  ruleId: string;
  evidenceType: "regex" | "ast" | "type" | "runtime" | "dependency";
  matcher: string;
  weight: number;
  positiveExample: string;
  negativeExample: string;
};

export type LanguageApiRule = {
  id: string;
  language: string;
  module: string;
  apiName: string;
  signature: string;
  behavior: string;
  returns: string;
  riskTags: string[];
  safeAlternative: string;
  sourceVersionId: string;
};

export type KnowledgeRuleMatch = {
  id: string;
  ruleId: string;
  ruleName: string;
  category: KnowledgeRuleCategory;
  severity: KnowledgeRuleSeverity;
  functionId: string;
  functionName: string;
  fileName: string;
  line: number;
  confidence: number;
  matchedSignals: string[];
  evidence: string;
  recommendation: string;
  sourceVersionId: string;
  tags: string[];
  evidenceGrade: "compiler" | "parser" | "heuristic";
  evidenceLimitation: string;
};

export type KnowledgeRuleReport = {
  totalMatches: number;
  matchedFunctionCount: number;
  criticalCount: number;
  riskCount: number;
  warnCount: number;
  infoCount: number;
  topMatches: KnowledgeRuleMatch[];
  matches: KnowledgeRuleMatch[];
};

export type KnowledgeRuleCoverageArea = {
  category: KnowledgeRuleCategory;
  label: string;
  ruleCount: number;
  targetCount: number;
  percent: number;
  status: "已成型" | "可用但需扩展" | "缺口明显";
  missing: string[];
  next: string;
};

export type KnowledgeRuleEvolutionStage = {
  id: string;
  name: string;
  layer: "Light Web" | "Alpha Feature Map" | "Deep Evidence Web";
  status: "已成型" | "联动中" | "待建设";
  coverage: number;
  summary: string;
  next: string;
};

export type KnowledgeRuleCoverageReport = {
  overall: number;
  status: "种子可用" | "可用于项目初筛" | "接近 Alpha 规则库";
  summary: string;
  ruleCount: number;
  conceptCount: number;
  evidenceCount: number;
  languageApiCount: number;
  languageCount: number;
  severityCoverage: Record<KnowledgeRuleSeverity, number>;
  evidenceTypeCoverage: Record<KnowledgeRuleEvidence["evidenceType"], number>;
  areas: KnowledgeRuleCoverageArea[];
  gaps: string[];
  completed: string[];
  evolution: KnowledgeRuleEvolutionStage[];
  dataQuality: {
    score: number;
    status: "seed" | "reviewable" | "validated";
    coverage: number;
    traceability: number;
    freshness: number;
    benchmarkReproducibility: number;
    repairVerification: number;
    conflictControl: number;
    evidence: string[];
    blockers: string[];
  };
};

export type LocalLibraryAuditItem = {
  name: string;
  category: LocalLibraryCategory;
  purpose: string;
  dataScope: string;
  status: LocalLibraryStatus;
  priority: "P0" | "P1" | "P2";
  coverage: number;
  recommendation: string;
};

export type MapQualityReport = {
  readabilityScore: number;
  overlapCount: number;
  minNodeDistance: number;
  clickTarget: number;
  primaryChannelCount: number;
  issueSegmentCount: number;
  unrelatedCrossingCount: number;
  bridgeCount: number;
  basinCount: number;
  aggregateNodeCount: number;
  status: "清晰" | "可用但需优化" | "需要整理";
  notes: string[];
};

export type BuildProgressItem = {
  name: string;
  percent: number;
  status: "已完成" | "进行中" | "待构建";
  next: string;
};

export type ProjectCompletionArea = {
  name: string;
  weight: number;
  percent: number;
  status: "已成型" | "建设中" | "待建设";
  evidence: string;
  next: string;
};

export type ProjectCompletionReport = {
  overall: number;
  confidence: number;
  stage: "可视化原型" | "核心能力建设" | "Alpha 内核" | "Beta 准备";
  summary: string;
  areas: ProjectCompletionArea[];
  remaining: string[];
};

export type SemanticIndexTable = {
  name: string;
  rows: number;
  purpose: string;
};

export type SemanticIndexQuery = {
  name: string;
  resultCount: number;
  evidence: string;
};

export type SemanticIndexHotspot = {
  label: string;
  value: number;
  severity: "low" | "medium" | "high";
  evidence: string;
};

export type DeepKnowledgeDatabaseLayer = {
  name: string;
  tableCount: number;
  seededRows: number;
  coverage: number;
  status: "active" | "seeded" | "missing";
  purpose: string;
  next: string;
};

export type DeepWebFeatureSpaceReport = {
  id: string;
  name: string;
  dimensionKey: string;
  weight: number;
  coverage: number;
  signalSources: string[];
  targetTables: string[];
  purpose: string;
};

export type DeepWebModelLayerReport = {
  id: string;
  name: string;
  layerKind: "input" | "encoder" | "projection" | "attention" | "classifier" | "ranker";
  activation: "linear" | "relu" | "sigmoid" | "softmax" | "cosine";
  inputDimensions: string[];
  outputDimensions: string[];
  coverage: number;
  runtimeModes: string[];
  purpose: string;
};

export type DeepWebLanguageAdapterReport = {
  id: string;
  language: string;
  parserStack: string[];
  runtimeModes: string[];
  featureDimensions: string[];
  confidence: number;
  readiness: "ready" | "partial" | "planned";
  fallbackStrategy: string;
};

export type DeepWebProjectionReport = {
  id: string;
  sourceTable: string;
  targetTable: string;
  projectionKind: "feature" | "evidence" | "language" | "runtime" | "repair";
  featureDimensions: string[];
  weight: number;
  coverage: number;
  mappingFormula: string;
};

export type DeepWebValidationScenarioReport = {
  id: string;
  dimensionKey: string;
  validationKind:
    | "project_trace"
    | "fault_replay"
    | "benchmark_replay"
    | "repair_verification"
    | "version_window"
    | "language_contract"
    | "environment_probe"
    | "hardware_bounds";
  sourceTable: string;
  requiredEvidence: string[];
  passCriteria: string;
  maturityWeight: number;
  coverage: number;
  status: "blocked" | "ready" | "passed";
  evidence: string;
};

export type DeepWebValidationEvidenceKind =
  | "project_replay"
  | "lexical_trace"
  | "benchmark_distribution"
  | "benchmark_before_after"
  | "repair_verification"
  | "dependency_version_probe"
  | "language_contract_probe"
  | "environment_probe"
  | "hardware_bounds_probe";

export type DeepWebValidationEvidenceReport = {
  id: string;
  scenarioId: string;
  dimensionKey: string;
  evidenceKind: DeepWebValidationEvidenceKind;
  sourceTable: string;
  sourceId: string;
  sourceName: string;
  dimensions: Record<string, number>;
  confidence: number;
  passed: boolean;
  replay: boolean;
  verificationLevel: "candidate" | "static_evidence" | "runtime_observed" | "benchmark_observed" | "repair_verified";
  maturityEligible: boolean;
  evidence: string;
};

export type DeepWebMaturityStage = "缺失" | "基础覆盖" | "成熟验证";

export type DeepWebDimensionMaturityReport = {
  dimensionKey: string;
  name: string;
  stage: DeepWebMaturityStage;
  score: number;
  coverage: number;
  seedEvidenceCount: number;
  projectEvidenceCount: number;
  teacherEvidenceCount: number;
  validationEvidenceCount: number;
  replayEvidenceCount: number;
  blockers: string[];
  next: string;
  evidence: string[];
};

export type DeepWebMaturityReport = {
  status: DeepWebMaturityStage;
  score: number;
  missingCount: number;
  baseCoverageCount: number;
  matureValidationCount: number;
  targetCount: number;
  validationScenarioCount: number;
  passedScenarioCount: number;
  summary: string;
  dimensions: DeepWebDimensionMaturityReport[];
  next: string;
};

export type DeepWebVectorLabel =
  | "safe"
  | "flow_warning"
  | "security_risk"
  | "stability_risk"
  | "performance_hotspot"
  | "repair_candidate";

export type DeepWebGeneratedVectorReport = {
  id: string;
  sourceTable: string;
  sourceId: string;
  sourceName: string;
  pseudoLabel: DeepWebVectorLabel;
  dimensions: Record<string, number>;
  magnitude: number;
  confidence: number;
  evidence: string;
};

export type DeepWebCentroidReport = {
  label: DeepWebVectorLabel;
  sampleCount: number;
  confidence: number;
  dominantDimensions: string[];
  vector: Record<string, number>;
};

export type DeepWebContrastivePairReport = {
  id: string;
  anchorVectorId: string;
  positiveVectorId: string;
  negativeVectorId: string;
  label: DeepWebVectorLabel;
  margin: number;
  confidence: number;
  evidence: string;
};

export type DeepWebInferenceRunReport = {
  id: string;
  sourceVectorId: string;
  sourceTable: string;
  sourceId: string;
  predictedClass: DeepWebVectorLabel;
  confidence: number;
  outputScores: Record<DeepWebVectorLabel, number>;
  evidence: string;
};

export type DeepWebSupervisionSource =
  | "expert_seed"
  | "rule_match"
  | "fault_sample"
  | "benchmark"
  | "sdk_api"
  | "version_constraint"
  | "repair_recipe"
  | "validation_evidence"
  | "library_entry"
  | "human_review";

export type DeepWebExpertLabelReport = {
  id: string;
  sourceKind: DeepWebSupervisionSource;
  sourceId: string;
  targetVectorId?: string;
  targetPattern: string;
  label: DeepWebVectorLabel;
  confidence: number;
  trustScore: number;
  evidence: string;
  correctiveAction: string;
};

export type DeepWebSupervisedAssignmentReport = {
  vectorId: string;
  vectorName: string;
  predictedLabel: DeepWebVectorLabel;
  teacherLabel: DeepWebVectorLabel;
  trustScore: number;
  consensusScore: number;
  corrected: boolean;
  evidence: string;
};

export type DeepWebTeacherReliabilityReport = {
  sourceKind: DeepWebSupervisionSource;
  labelCount: number;
  acceptedCount: number;
  quarantinedCount: number;
  conflictCount: number;
  reliabilityScore: number;
  status: "trusted" | "watch" | "quarantined";
  evidence: string;
};

export type DeepWebQuarantinedLabelReport = {
  id: string;
  vectorId: string;
  vectorName: string;
  sourceKind: DeepWebSupervisionSource;
  candidateLabels: DeepWebVectorLabel[];
  reason: "teacher_conflict" | "low_trust" | "weak_evidence" | "unsafe_consensus";
  confidence: number;
  evidence: string;
  recommendedAction: string;
};

export type DeepWebRollbackSnapshotReport = {
  id: string;
  protectedTables: string[];
  trigger: string;
  rollbackPolicy: string;
  evidence: string;
};

export type DeepWebSupervisedReport = {
  status: "seed_teacher" | "expert_supervised" | "guarded_calibration" | "calibrated";
  teacherSampleCount: number;
  candidateTeacherMatchCount: number;
  matchedTeacherCount: number;
  quarantinedSampleCount: number;
  conflictCount: number;
  correctedPredictionCount: number;
  falsePositiveGuardCount: number;
  supervisedCentroidCount: number;
  trustScore: number;
  consensusRate: number;
  lossBefore: number;
  lossAfter: number;
  improvement: number;
  calibrationWeights: Record<string, number>;
  labelBreakdown: Record<DeepWebVectorLabel, number>;
  expertLabels: DeepWebExpertLabelReport[];
  assignments: DeepWebSupervisedAssignmentReport[];
  teacherReliability: DeepWebTeacherReliabilityReport[];
  quarantinedSamples: DeepWebQuarantinedLabelReport[];
  rollbackSnapshot: DeepWebRollbackSnapshotReport;
  centroids: DeepWebCentroidReport[];
  evidence: string[];
  next: string;
};

export type DeepWebErrorSignalKind =
  | "teacher_conflict"
  | "low_consensus"
  | "weak_evidence"
  | "high_confidence_low_evidence"
  | "prediction_teacher_drift"
  | "benchmark_deviation"
  | "repair_unverified"
  | "rollback_triggered";

export type DeepWebErrorSignalReport = {
  id: string;
  signalKind: DeepWebErrorSignalKind;
  severity: "watch" | "risk" | "critical";
  sourceId: string;
  sourceName: string;
  affectedLabel?: DeepWebVectorLabel;
  confidence: number;
  confidenceImpact: number;
  knowledgeScoreImpact: number;
  fitnessImpact: number;
  evidence: string;
  containmentAction: string;
};

export type DeepWebGeneReport = {
  id: string;
  geneKind: "dimension_weight" | "teacher_weight" | "threshold" | "expression_gate";
  name: string;
  expression: number;
  inheritedFrom: string;
  mutationDelta: number;
  evidence: string;
};

export type DeepWebGenomeReport = {
  id: string;
  generation: number;
  parentId?: string;
  strategy: "stable_parent" | "mutation" | "crossover" | "rollback_candidate";
  fitnessScore: number;
  accepted: boolean;
  genes: Record<string, number>;
  evidence: string;
};

export type DeepWebFitnessReport = {
  id: string;
  genomeId: string;
  accuracyProxy: number;
  stabilityProxy: number;
  safetyProxy: number;
  generalizationProxy: number;
  regressionPenalty: number;
  fitnessScore: number;
  evidence: string;
};

export type DeepWebEvolutionReport = {
  status: "stable_parent" | "mutating" | "selected" | "rollback";
  generationCount: number;
  geneCount: number;
  selectedGenomeId: string;
  selectedWeights: Record<string, number>;
  mutationCount: number;
  crossoverCount: number;
  acceptedMutationCount: number;
  errorSignalCount: number;
  fitnessScore: number;
  genes: DeepWebGeneReport[];
  genomes: DeepWebGenomeReport[];
  fitness: DeepWebFitnessReport[];
  expressionSummary: string[];
  evidence: string[];
  next: string;
};

export type DeepWebSelfSupervisedReport = {
  status: "warming" | "learning" | "stable";
  epochCount: number;
  pseudoLabelCount: number;
  vectorCount: number;
  centroidCount: number;
  contrastivePairCount: number;
  lossBefore: number;
  lossAfter: number;
  improvement: number;
  learningRate: number;
  updatedWeights: Record<string, number>;
  labelBreakdown: Record<DeepWebVectorLabel, number>;
  centroids: DeepWebCentroidReport[];
  contrastivePairs: DeepWebContrastivePairReport[];
  evidence: string[];
  next: string;
};

export type DeepWebExtremeTestCategory =
  | "database_stress"
  | "vector_stress"
  | "flow_stress"
  | "supervision_stress"
  | "replay_stress"
  | "rollback_stress";

export type DeepWebExtremeTestReport = {
  id: string;
  name: string;
  category: DeepWebExtremeTestCategory;
  target: "database" | "deepweb" | "hybrid";
  loadFactor: number;
  passThreshold: number;
  score: number;
  status: "passed" | "watch" | "blocked";
  evidence: string;
  recommendation: string;
};

export type DeepWebOptimizationReport = {
  status: "optimized" | "watch" | "blocked";
  score: number;
  databaseScore: number;
  deepWebScore: number;
  passedExtremeTests: number;
  totalExtremeTests: number;
  bottlenecks: string[];
  completed: string[];
  next: string;
};

export type DeepWebIrrigationSourceKind =
  | "project_scan"
  | "rule_teacher"
  | "validation_replay"
  | "runtime_trace"
  | "benchmark_profile"
  | "repair_recipe"
  | "environment_probe"
  | "hardware_probe"
  | "extreme_test"
  | "inference_feedback";

export type DeepWebIrrigationBatchReport = {
  id: string;
  sourceKind: DeepWebIrrigationSourceKind;
  sourceTable: string;
  evidenceCount: number;
  acceptedCount: number;
  isolatedCount: number;
  qualityScore: number;
  targetDimensions: string[];
  status: "accepted" | "review" | "isolated";
  evidence: string;
  next: string;
};

export type DeepWebIrrigationEpochReport = {
  id: string;
  stage: "collect" | "label" | "replay" | "calibrate" | "checkpoint";
  status: "passed" | "watch" | "blocked";
  score: number;
  evidenceCount: number;
  evidence: string;
  action: string;
};

export type DeepWebWeightDeltaReport = {
  dimensionKey: string;
  name: string;
  beforeWeight: number;
  candidateWeight: number;
  acceptedWeight: number;
  delta: number;
  gate: "accepted" | "clamped" | "rejected";
  evidence: string;
};

export type DeepWebIrrigationReport = {
  status: "hydrated" | "guarded" | "blocked";
  cycleId: string;
  evidenceInflowCount: number;
  acceptedEvidenceCount: number;
  isolatedEvidenceCount: number;
  dataQualityScore: number;
  teacherAlignmentScore: number;
  replayScore: number;
  stabilityScore: number;
  supervisionGain: number;
  weightUpdateCount: number;
  stableSnapshot: string;
  batches: DeepWebIrrigationBatchReport[];
  epochs: DeepWebIrrigationEpochReport[];
  weightDeltas: DeepWebWeightDeltaReport[];
  evidence: string[];
  next: string;
};

export type DeepWebReplaySnapshot = {
  id: string;
  projectName: string;
  projectHash: string;
  createdAt: number;
  fileCount: number;
  functionCount: number;
  issueCount: number;
  deepWebCoverage: number;
  irrigationScore: number;
  optimizationScore: number;
  acceptedEvidenceCount: number;
  isolatedEvidenceCount: number;
  vectorCount: number;
  inferenceRunCount: number;
  teacherTrustScore: number;
  teacherConsensusRate: number;
  maturityScore: number;
  stableSnapshot: string;
  status: "stable" | "watch" | "blocked";
  dimensionScores: Record<string, number>;
  labelBreakdown: Record<DeepWebVectorLabel, number>;
  evidence: string[];
};

export type DeepWebReplayComparison = {
  id: string;
  currentSnapshotId: string;
  baselineSnapshotId?: string;
  status: "improved" | "stable" | "watch" | "regressed";
  driftScore: number;
  regressionScore: number;
  improvementScore: number;
  changedDimensions: string[];
  evidence: string;
};

export type DeepWebReplayMemoryReport = {
  status: "empty" | "warming" | "learning" | "stable";
  snapshotCount: number;
  stableSnapshotCount: number;
  currentSnapshot: DeepWebReplaySnapshot;
  comparison: DeepWebReplayComparison;
  replayReadinessScore: number;
  promotionScore: number;
  regressionRiskScore: number;
  memoryHealthScore: number;
  next: string;
};

export type DeepWebModelBaseline = {
  id: string;
  status: "stable" | "candidate" | "quarantined" | "rollback";
  featureSchemaVersion: string;
  weights: Record<string, number>;
  networkParameters?: DeepWebTrainableHeadParameters;
  selectedGenomeId: string;
  trustScore: number;
  consensusRate: number;
  fitnessScore: number;
  regressionRiskScore: number;
  checksum: string;
  createdAt: number;
};

export type DeepWebTrainableHeadParameters = {
  architecture: "14x12x6";
  dimensionOrder: string[];
  labelOrder: DeepWebVectorLabel[];
  inputHiddenWeights: number[][];
  hiddenBias: number[];
  hiddenOutputWeights: number[][];
  outputBias: number[];
};

export type DeepWebTrainableHeadReport = {
  status: "warming" | "trained_candidate" | "validated_candidate";
  architecture: "14x12x6";
  trainingSampleCount: number;
  validationSampleCount: number;
  classCount: number;
  epochCount: number;
  learningRate: number;
  trainLossBefore: number;
  trainLossAfter: number;
  validationLossBefore: number;
  validationLossAfter: number;
  improvement: number;
  inherited: boolean;
  parameters: DeepWebTrainableHeadParameters;
  evidence: string[];
  next: string;
};

export type DeepWebNeuralDatabaseReport = {
  status: "种子特征网" | "多维映射网" | "DeepWeb 神经数据库";
  mode: "Local Deterministic ML" | "Self-Supervised DeepWeb" | "Expert-Supervised DeepWeb" | "Hybrid Runtime ML";
  coverage: number;
  dimensionCount: number;
  activeDimensionCount: number;
  modelLayerCount: number;
  projectionCount: number;
  adapterCount: number;
  trainingSampleCount: number;
  validationScenarioCount: number;
  validationEvidenceCount: number;
  extremeTestCount: number;
  extremePassCount: number;
  optimizationScore: number;
  irrigationScore: number;
  generatedVectorCount: number;
  inferenceRunCount: number;
  multiDimensionalScore: number;
  languageAdaptabilityScore: number;
  featureSpaces: DeepWebFeatureSpaceReport[];
  modelLayers: DeepWebModelLayerReport[];
  languageAdapters: DeepWebLanguageAdapterReport[];
  projections: DeepWebProjectionReport[];
  validationScenarios: DeepWebValidationScenarioReport[];
  validationEvidence: DeepWebValidationEvidenceReport[];
  extremeTests: DeepWebExtremeTestReport[];
  optimization: DeepWebOptimizationReport;
  irrigation: DeepWebIrrigationReport;
  generatedVectors: DeepWebGeneratedVectorReport[];
  inferenceRuns: DeepWebInferenceRunReport[];
  supervised: DeepWebSupervisedReport;
  errorSignals: DeepWebErrorSignalReport[];
  evolution: DeepWebEvolutionReport;
  maturity: DeepWebMaturityReport;
  selfSupervised: DeepWebSelfSupervisedReport;
  trainableHead: DeepWebTrainableHeadReport;
  completed: string[];
  gaps: string[];
};

export type DeepKnowledgeDatabaseReport = {
  status: "初始规则库" | "Alpha 深层库" | "深层证据库";
  coverage: number;
  tableCount: number;
  activeTableCount: number;
  seededTableCount: number;
  seedRowCount: number;
  missingLayers: string[];
  completed: string[];
  layers: DeepKnowledgeDatabaseLayer[];
  deepWeb: DeepWebNeuralDatabaseReport;
};

export type SemanticIndexReport = {
  adapterName: string;
  storageMode: "Memory Snapshot" | "SQLite Ready" | "sql.js Ready";
  integrityScore: number;
  fileCount: number;
  functionCount: number;
  symbolCount: number;
  callEdgeCount: number;
  flowEdgeCount: number;
  knowledgeItemCount: number;
  tables: SemanticIndexTable[];
  queries: SemanticIndexQuery[];
  hotspots: SemanticIndexHotspot[];
  deepDatabase: DeepKnowledgeDatabaseReport;
  next: string[];
};

export type RuntimeScenario = {
  name: string;
  inputShape: string;
  pathLength: number;
  status: "pass" | "warning" | "blocked" | "overflow";
  risk: string;
  evidence: string;
};

export type RuntimeGuard = {
  name: string;
  status: "ready" | "weak" | "missing";
  evidence: string;
};

export type RuntimeSandboxReport = {
  mode: "Static Dry-run" | "Controlled Runtime";
  readinessScore: number;
  deterministicScore: number;
  breakpointCount: number;
  riskCount: number;
  estimatedSteps: number;
  resourceBudget: {
    maxSteps: number;
    maxBranchFanout: number;
    timeoutMs: number;
    memoryMb: number;
  };
  scenarios: RuntimeScenario[];
  guards: RuntimeGuard[];
  next: string[];
};

export type ControlledRuntimeAdapter = "node" | "python" | "rust" | "java" | "c" | "cpp";

export type ControlledRuntimeTool = {
  adapter: ControlledRuntimeAdapter;
  label: string;
  available: boolean;
  command: string;
  version: string;
  evidence: string;
};

export type ControlledRuntimeAvailabilityReport = {
  status: "ready" | "partial" | "unavailable" | "web-preview";
  tools: ControlledRuntimeTool[];
  availableCount: number;
  totalCount: number;
  evidence: string;
  safetyBoundary: string[];
  extensionSlots: Array<{
    id: "language-runtime" | "frontend-runtime" | "embedded-target" | string;
    label: string;
    status: "reserved" | "available" | "disabled" | string;
    requiredContracts: string[];
  }>;
};

export type ControlledRuntimeFile = {
  path: string;
  content: string;
  language: string;
};

export type ControlledRuntimeRequest = {
  projectId: string;
  projectName: string;
  adapter: ControlledRuntimeAdapter;
  entryPath: string;
  files: ControlledRuntimeFile[];
  args: string[];
  stdin: string;
  timeoutMs: number;
  maxOutputBytes: number;
  experimentKind: "baseline" | "stress" | "fault" | "security";
  sampleId: string;
  repetition: number;
  breakpoints: Array<{
    path: string;
    line: number;
  }>;
};

export type ControlledRuntimeExecutionReport = {
  id: string;
  projectId: string;
  projectName: string;
  adapter: ControlledRuntimeAdapter;
  status: "passed" | "failed" | "timeout" | "compile_failed" | "unavailable" | "rejected";
  evidenceGrade: "真实执行";
  experimentKind?: "baseline" | "stress" | "fault" | "security";
  sampleId?: string;
  repetition?: number;
  inputBytes?: number;
  traceEvents?: Array<{
    functionName: string;
    event: "enter" | "exit" | "error" | "transfer";
    dataNames: string[];
    from?: string;
    to?: string;
  }>;
  traceSource?: "instrumentation-sidecar" | "stdout-compat" | "taint-probe" | "instrumentation-sidecar+taint-probe" | "none";
  sanitizerStatus?: "not-requested" | "passed" | "finding" | "unavailable";
  sanitizerFindings?: string[];
  debugSnapshots?: Array<{
    path: string;
    line: number;
    functionName: string;
    locals: Record<string, string>;
  }>;
  entryPath: string;
  commandLabel: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  compileOutput: string;
  fileCount: number;
  totalBytes: number;
  startedAt: number;
  finishedAt: number;
  databasePath: string;
  sandboxKind: "macos_sandbox" | "linux_bubblewrap" | "windows_job_object" | "windows_appcontainer_job" | "process_boundary";
  sandboxStatus: "enforced" | "partial" | "unavailable";
  sandboxEvidence: string;
  cpuTimeMs: number;
  peakMemoryBytes: number;
  childProcessCount: number;
  childProcesses: Array<{
    pid: number;
    parentPid: number | null;
    name: string;
    cpuTimeMs: number;
    peakMemoryBytes: number;
  }>;
  fileChanges: Array<{
    path: string;
    kind: "created" | "modified" | "deleted";
    beforeBytes: number | null;
    afterBytes: number | null;
  }>;
  isolation: string[];
  evidence: string[];
};

export type ControlledRuntimeCertificationItem = {
  adapter: ControlledRuntimeAdapter;
  label: string;
  status: "passed" | "failed" | "missing" | "not-run";
  toolAvailable: boolean;
  compiledAndExecuted: boolean;
  traceCaptured: boolean;
  fileObservationCaptured: boolean;
  resourceObservationCaptured: boolean;
  sandboxEnforced: boolean;
  score: number;
  runId: string | null;
  evidence: string[];
};

export type ControlledRuntimeCertificationReport = {
  scope: "host-v1";
  status: "certified" | "partial" | "not-run";
  score: number;
  passedCount: number;
  totalCount: number;
  items: ControlledRuntimeCertificationItem[];
  evidence: string[];
  remaining: string[];
};

export type DigitalTwinEvidenceGrade = "静态推断" | "模型仿真" | "真实执行";

export type DigitalTwinExperimentKind =
  | "静态分析"
  | "动态仿真"
  | "压力测试"
  | "容错传播"
  | "算法替换"
  | "安全攻击"
  | "环境迁移";

export type DigitalTwinExperiment = {
  id: string;
  kind: DigitalTwinExperimentKind;
  name: string;
  objective: string;
  evidenceGrade: DigitalTwinEvidenceGrade;
  claimStatus: "已验证" | "已观察" | "未证明";
  claimReason: string;
  status: "通过" | "观察" | "风险" | "阻塞" | "等待执行";
  confidence: number;
  affectedNodeIds: string[];
  inputModel: string;
  expectedBehavior: string;
  observedOrEstimated: string;
  metrics: {
    performance: number;
    stability: number;
    security: number;
    resource: number;
  };
  evidence: string[];
  nextAction: string;
  runtimeStatistics?: {
    sampleCount: number;
    passedCount: number;
    failureRate: number;
    p50DurationMs: number;
    p95DurationMs: number;
    maxDurationMs: number;
    totalCpuTimeMs: number;
    peakMemoryBytes: number;
  };
};

export type DigitalTwinVariant = {
  id: string;
  name: string;
  target: string;
  change: string;
  evidenceGrade: DigitalTwinEvidenceGrade;
  estimatedPerformanceGain: number;
  estimatedStabilityDelta: number;
  estimatedSecurityDelta: number;
  estimatedResourceDelta: number;
  fitScore: number;
  validationGate: string;
  recommendation: "推荐验证" | "谨慎验证" | "不建议";
  evidence: string;
};

export type ProgramDigitalTwinReport = {
  status: "模型已建立" | "可仿真" | "已有实测校准";
  fidelityScore: number;
  coverageScore: number;
  executedExperimentCount: number;
  simulatedExperimentCount: number;
  inferredExperimentCount: number;
  validatedExperimentCount: number;
  sourceCount: number;
  sinkCount: number;
  experiments: DigitalTwinExperiment[];
  variants: DigitalTwinVariant[];
  summary: string;
  limitations: string[];
  next: string[];
};

export type VerificationEvidenceGrade =
  | "heuristic"
  | "parser"
  | "compiler"
  | "knowledge"
  | "runtime"
  | "benchmark"
  | "formal";

export type FormalVerificationRecord = {
  id: string;
  projectId: string;
  obligationId: string;
  title: string;
  status: "proved" | "counterexample" | "unknown" | "error";
  solver: string;
  solverVersion: string;
  formulaHash: string;
  formula: string;
  result: string;
  durationMs: number;
  sandboxStatus: string;
  evidence: string[];
  createdAt: number;
  fileName?: string;
  functionId?: string;
  line?: number;
  counterexample?: string;
  callChain?: string[];
};

export type ContractEvidenceGrade = "compiler" | "lsp" | "ast" | "parser" | "lexical";

export type ProjectContractClause = {
  id: string;
  functionId: string;
  fileName: string;
  line: number;
  kind: "parameter-type" | "parameter-nullability" | "parameter-range" | "callsite-range" | "return-type" | "exception" | "state" | "transaction" | "resource" | "lifecycle" | "alias" | "ownership" | "concurrency" | "security";
  subject: string;
  predicate: string;
  description: string;
  evidenceGrade: ContractEvidenceGrade;
  confidence: number;
  evidence: string;
  smtEligible: boolean;
  smtReason: string;
  smtFormula?: string;
  callChain?: string[];
};

export type FunctionContract = {
  id: string;
  functionId: string;
  functionName: string;
  fileName: string;
  language: string;
  startLine: number;
  clauses: ProjectContractClause[];
  evidenceGrade: ContractEvidenceGrade;
  confidence: number;
};

export type ProjectContractReport = {
  status: "empty" | "partial" | "contract-ready";
  functionCount: number;
  coveredFunctionCount: number;
  clauseCount: number;
  smtEligibleCount: number;
  securityClauseCount: number;
  compilerBackedCount: number;
  contracts: FunctionContract[];
  gaps: string[];
  evidence: string[];
};

export type VerificationObligation = {
  id: string;
  domain: "functionality" | "security" | "stability" | "performance" | "environment";
  title: string;
  requirement: string;
  status: "proved" | "observed" | "violated" | "unproved" | "blocked";
  evidenceGrade: VerificationEvidenceGrade;
  confidence: number;
  sourceIds: string[];
  evidence: string[];
  missingEvidence: string[];
};

export type RepairVerificationGate = {
  id: "static" | "formal" | "regression" | "benchmark" | "security" | "approval";
  label: string;
  status: "passed" | "failed" | "pending";
  evidence: string;
};

export type VerifiedRepairCandidate = {
  id: string;
  name: string;
  target: string;
  change: string;
  status: "proposed" | "eligible" | "rejected" | "verified";
  sourceIds: string[];
  gates: RepairVerificationGate[];
  predictedPerformanceGain: number;
  predictedStabilityDelta: number;
  predictedSecurityDelta: number;
  safeToWriteBack: boolean;
};

export type ProgramVerificationReport = {
  status: "foundation" | "evidence-linked" | "verification-ready" | "formally-verified";
  score: number;
  soundnessCap: number;
  obligationCount: number;
  provedCount: number;
  observedCount: number;
  violatedCount: number;
  unprovedCount: number;
  blockedCount: number;
  formalEvidenceCount: number;
  runtimeEvidenceCount: number;
  benchmarkEvidenceCount: number;
  knowledgeCoverage: number;
  deepWebCoverage: number;
  obligations: VerificationObligation[];
  repairCandidates: VerifiedRepairCandidate[];
  evidence: string[];
  gaps: string[];
  next: string[];
  contracts: ProjectContractReport;
};

export type SpeedOption = {
  name: string;
  target: string;
  efficiencyGain: number;
  stabilityRisk: number;
  fitScore: number;
  model: string;
  reason: string;
};

export type WorkspaceAnalysis = {
  mainFile: CodeFile | null;
  entryFunction: FunctionInfo | null;
  entryTree: FlowNode[];
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  taintFlow: TaintFlowReport;
  issues: AnalysisIssue[];
  diagnosticEvidenceAudit: DiagnosticEvidenceAudit;
  securityIssues: AnalysisIssue[];
  elementConflicts: AnalysisIssue[];
  environmentIssues: AnalysisIssue[];
  speedOptions: SpeedOption[];
  modelLayers: { name: string; role: string; localSource: string; status: string }[];
  localLibraryAudit: LocalLibraryAuditItem[];
  mapQuality: MapQualityReport;
  hydrologyModel: HydrologyModelReport;
  knowledgeRuleReport: KnowledgeRuleReport;
  knowledgeRuleCoverage: KnowledgeRuleCoverageReport;
  semanticIndex: SemanticIndexReport;
  runtimeSandbox: RuntimeSandboxReport;
  digitalTwin: ProgramDigitalTwinReport;
  programVerification: ProgramVerificationReport;
  projectCompletion: ProjectCompletionReport;
  buildProgress: {
    overall: number;
    items: BuildProgressItem[];
    nextMilestones: string[];
  };
  closureScore: number;
  damScore: number;
  environmentScore: number;
};

export type LogicInventoryItem = {
  category: string;
  scope: string;
  currentFunctions: string[];
  nextModule: string;
  status: "已成型" | "需抽离" | "需替换";
};
