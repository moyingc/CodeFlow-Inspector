import type {
  CodeFile,
  ControlledRuntimeExecutionReport,
  DeepKnowledgeDatabaseLayer,
  DeepKnowledgeDatabaseReport,
  DeepWebModelBaseline,
  FlowEdge,
  FlowNode,
  FunctionInfo,
  GraphEdge,
  KnowledgeRuleReport,
  LocalLibraryAuditItem,
  SemanticIndexHotspot,
  SemanticIndexQuery,
  SemanticIndexReport,
  SemanticIndexTable,
} from "@/src/lib/analysis/types";
import {
  buildDeepWebNeuralDatabaseReport,
  deepWebSeedCount,
  localDeepWebFeatureSpaces,
  localDeepWebLanguageAdapters,
  localDeepWebModelLayers,
  localDeepWebProjections,
  localDeepWebTrainingSamples,
} from "@/src/lib/library/deepweb-neural-database";
import {
  deepKnowledgeRowsByTable,
  deepKnowledgeSeedCount,
  localBenchmarkProfiles,
  localDeepKnowledgeTableCatalog,
  localEnvironmentProfiles,
  localFaultSamples,
  localHardwareComponentProfiles,
  localKnowledgeFeatureVectors,
  localRepairRecipes,
  localSdkApiProfiles,
  localVersionConstraints,
} from "@/src/lib/library/deep-knowledge-database";
import {
  localKnowledgeConcepts,
  localKnowledgeRuleEvidence,
  localKnowledgeRules,
  localKnowledgeSourceVersions,
  localLanguageApiRules,
} from "@/src/lib/library/local-knowledge-rules";
import {
  localMatureLibraryEntries,
  localMatureLibraryTargets,
  matureLibraryTotalCount,
} from "@/src/lib/library/mature-local-library";

export function buildLocalGraphIndex(
  files: CodeFile[],
  functions: FunctionInfo[],
  callEdges: GraphEdge[],
  flowNodes: FlowNode[],
  flowEdges: FlowEdge[],
  localLibraryAudit: LocalLibraryAuditItem[],
  knowledgeRuleReport: KnowledgeRuleReport,
  runtimeExecutions: ControlledRuntimeExecutionReport[] = [],
  deepWebBaseline?: DeepWebModelBaseline | null,
): SemanticIndexReport {
  const symbolCount = countSymbols(functions);
  const deepDatabase = buildDeepKnowledgeDatabaseReport(
    files,
    functions,
    callEdges,
    flowNodes,
    flowEdges,
    symbolCount,
    knowledgeRuleReport,
    runtimeExecutions,
    deepWebBaseline,
  );
  const tables = buildIndexTables(files, functions, callEdges, flowNodes, flowEdges, symbolCount, knowledgeRuleReport, deepDatabase);
  const queries = buildIndexQueries(functions, callEdges, flowNodes, flowEdges, localLibraryAudit, knowledgeRuleReport, deepDatabase);
  const hotspots = buildIndexHotspots(functions, flowNodes, flowEdges, localLibraryAudit, knowledgeRuleReport, deepDatabase);
  const integrityScore = scoreIndexIntegrity(files, functions, callEdges, flowEdges, localLibraryAudit, hotspots, knowledgeRuleReport, deepDatabase);

  return {
    adapterName: "MemoryGraphIndex",
    storageMode: "SQLite Ready",
    integrityScore,
    fileCount: files.length,
    functionCount: functions.length,
    symbolCount,
    callEdgeCount: callEdges.length,
    flowEdgeCount: flowEdges.length,
    knowledgeItemCount:
      localKnowledgeRules.length +
      localKnowledgeConcepts.length +
      localKnowledgeRuleEvidence.length +
      localLanguageApiRules.length +
      matureLibraryTotalCount() +
      deepWebSeedCount() +
      deepDatabase.deepWeb.validationEvidenceCount +
      deepDatabase.deepWeb.supervised.teacherSampleCount +
      deepDatabase.deepWeb.irrigation.acceptedEvidenceCount,
    tables,
    queries,
    hotspots,
    deepDatabase,
    next: [
      "把 analysis_runs、project_files、project_functions、function_symbols、call_edges、flow_nodes、flow_edges 落到 sql.js/OPFS SQLite。",
      "增加 file hash 增量扫描，只重建变更文件的函数和边。",
      "为每条问题、推荐和水路颜色保存 evidence_id，支持点击追溯。",
      "把 version_constraints、sdk_api_profiles、fault_samples、benchmark_profiles、repair_recipes 接入真实命中评分。",
      "把 DeepWeb 专家监督标签、监督 epoch、候选向量、类别中心、对比样本和推理运行持久化，逐步用真实故障样本和 benchmark 样本校准本地权重。",
    ],
  };
}

function buildIndexTables(
  files: CodeFile[],
  functions: FunctionInfo[],
  callEdges: GraphEdge[],
  flowNodes: FlowNode[],
  flowEdges: FlowEdge[],
  symbolCount: number,
  knowledgeRuleReport: KnowledgeRuleReport,
  deepDatabase: DeepKnowledgeDatabaseReport,
): SemanticIndexTable[] {
  const dynamicRows: Record<string, number> = {
    analysis_runs: files.length ? 1 : 0,
    project_files: files.length,
    project_functions: functions.length,
    function_symbols: symbolCount,
    call_edges: callEdges.length,
    flow_nodes: flowNodes.length,
    flow_edges: flowEdges.length,
    data_flow_traces: flowEdges.filter((edge) => edge.primary).length,
    taint_paths: new Set(flowEdges.flatMap((edge) => edge.taintPathIds ?? [])).size,
    debug_breakpoints: 0,
    source_versions: localKnowledgeSourceVersions.length,
    knowledge_concepts: localKnowledgeConcepts.length,
    knowledge_rules: localKnowledgeRules.length,
    rule_evidence: localKnowledgeRuleEvidence.length,
    rule_matches: knowledgeRuleReport.totalMatches,
    language_apis: localLanguageApiRules.length,
    library_domains: Object.keys(localMatureLibraryTargets).length,
    library_entries: localMatureLibraryEntries.length,
    deepweb_feature_spaces: localDeepWebFeatureSpaces.length,
    deepweb_model_layers: localDeepWebModelLayers.length,
    deepweb_language_adapters: localDeepWebLanguageAdapters.length,
    deepweb_projections: localDeepWebProjections.length,
    deepweb_feature_vectors:
      files.length +
      functions.length +
      callEdges.length +
      flowNodes.length +
      flowEdges.length +
      knowledgeRuleReport.totalMatches +
      localMatureLibraryEntries.length +
      localVersionConstraints.length +
      localSdkApiProfiles.length +
      localFaultSamples.length +
      localBenchmarkProfiles.length +
      localRepairRecipes.length +
      localHardwareComponentProfiles.length +
      localEnvironmentProfiles.length,
    deepweb_training_samples: localDeepWebTrainingSamples.length + deepDatabase.deepWeb.supervised.teacherSampleCount,
    deepweb_validation_scenarios: deepDatabase.deepWeb.validationScenarioCount,
    deepweb_validation_evidence: deepDatabase.deepWeb.validationEvidenceCount,
    deepweb_extreme_test_runs: deepDatabase.deepWeb.extremeTestCount,
    database_optimization_profiles: 6,
    deepweb_irrigation_runs: 1,
    deepweb_irrigation_evidence: deepDatabase.deepWeb.irrigation.evidenceInflowCount,
    deepweb_irrigation_epochs: deepDatabase.deepWeb.irrigation.epochs.length,
    deepweb_weight_update_events: deepDatabase.deepWeb.irrigation.weightDeltas.length,
    deepweb_replay_memory_snapshots: 1,
    deepweb_replay_comparisons: 1,
    deepweb_replay_promotion_decisions: deepDatabase.deepWeb.irrigation.weightUpdateCount + deepDatabase.deepWeb.validationEvidenceCount,
    deepweb_local_sqlite_journal: deepDatabase.deepWeb.irrigation.weightUpdateCount + deepDatabase.deepWeb.validationEvidenceCount + 2,
    deepweb_local_storage_engines: 1,
    deepweb_local_snapshot_exports: 0,
    deepweb_supervision_labels: deepDatabase.deepWeb.supervised.teacherSampleCount,
    deepweb_supervised_assignments: deepDatabase.deepWeb.supervised.assignments.length,
    deepweb_teacher_reliability: deepDatabase.deepWeb.supervised.teacherReliability.length,
    deepweb_quarantined_labels: deepDatabase.deepWeb.supervised.quarantinedSampleCount,
    deepweb_error_signals: deepDatabase.deepWeb.errorSignals.length,
    deepweb_label_centroids: deepDatabase.deepWeb.supervised.centroids.length,
    deepweb_contrastive_pairs: deepDatabase.deepWeb.selfSupervised.contrastivePairCount,
    deepweb_self_supervised_epochs: deepDatabase.deepWeb.selfSupervised.epochCount,
    deepweb_supervised_epochs: deepDatabase.deepWeb.supervised.matchedTeacherCount ? 1 : 0,
    deepweb_rollback_snapshots: 1,
    deepweb_gene_pool: deepDatabase.deepWeb.evolution.geneCount,
    deepweb_genome_generations: deepDatabase.deepWeb.evolution.generationCount,
    deepweb_gene_expression: deepDatabase.deepWeb.evolution.genes.filter((gene) => gene.geneKind === "expression_gate").length,
    deepweb_fitness_scores: deepDatabase.deepWeb.evolution.fitness.length,
    deepweb_inference_runs: deepDatabase.deepWeb.inferenceRunCount,
    deepweb_model_versions: 1,
    deepweb_trainable_head_runs: 1,
  };

  return localDeepKnowledgeTableCatalog.map((table) => ({
    name: table.name,
    rows: dynamicRows[table.name] ?? deepKnowledgeRowsByTable(table.name),
    purpose: table.purpose,
  }));
}

function buildIndexQueries(
  functions: FunctionInfo[],
  callEdges: GraphEdge[],
  flowNodes: FlowNode[],
  flowEdges: FlowEdge[],
  localLibraryAudit: LocalLibraryAuditItem[],
  knowledgeRuleReport: KnowledgeRuleReport,
  deepDatabase: DeepKnowledgeDatabaseReport,
): SemanticIndexQuery[] {
  const indexedIds = new Set(functions.map((fn) => fn.id));
  const connectedIds = new Set(callEdges.flatMap((edge) => [edge.from, edge.to]));
  const isolatedCount = functions.filter((fn) => !connectedIds.has(fn.id)).length;
  const unvalidatedInputs = functions.filter((fn) => fn.externalInputs.length && !fn.validations.length);
  const riskyFunctions = functions.filter((fn) => fn.risks.length);
  const openWaterNodes = flowNodes.filter((node) => node.status === "Open" || node.status === "Blocked" || node.status === "Overflow Risk");
  const lowKnowledge = localLibraryAudit.filter((item) => item.coverage < 25);
  const criticalRules = localKnowledgeRules.filter((rule) => rule.severity === "critical");
  const criticalRuleMatches = knowledgeRuleReport.matches.filter((match) => match.severity === "critical");

  return [
    {
      name: "入口到输出路径",
      resultCount: flowEdges.filter((edge) => edge.primary).length,
      evidence: "用于确认主河道是否从输入连到输出。",
    },
    {
      name: "未净化外部输入",
      resultCount: unvalidatedInputs.length,
      evidence: unvalidatedInputs.map((fn) => fn.name).slice(0, 4).join(", ") || "当前未发现。",
    },
    {
      name: "风险函数",
      resultCount: riskyFunctions.length,
      evidence: riskyFunctions.map((fn) => `${fn.name}:${fn.risks[0]}`).slice(0, 4).join(" / ") || "当前未发现。",
    },
    {
      name: "孤立函数",
      resultCount: isolatedCount,
      evidence: indexedIds.size ? "用于发现未接入主控树的支线代码。" : "等待导入函数。",
    },
    {
      name: "异常水段",
      resultCount: openWaterNodes.length,
      evidence: openWaterNodes.map((node) => node.name).slice(0, 4).join(", ") || "当前水路闭合。",
    },
    {
      name: "低覆盖知识库",
      resultCount: lowKnowledge.length,
      evidence: lowKnowledge.map((item) => item.name).slice(0, 4).join(", ") || "知识库覆盖基础可用。",
    },
    {
      name: "高危规则",
      resultCount: criticalRules.length,
      evidence: criticalRules.map((rule) => rule.name).slice(0, 4).join(", ") || "当前没有高危规则。",
    },
    {
      name: "规则命中函数",
      resultCount: knowledgeRuleReport.matchedFunctionCount,
      evidence: knowledgeRuleReport.topMatches.map((match) => match.functionName).slice(0, 4).join(", ") || "当前没有规则命中。",
    },
    {
      name: "高危规则命中",
      resultCount: criticalRuleMatches.length,
      evidence: criticalRuleMatches.map((match) => `${match.functionName}:${match.ruleName}`).slice(0, 3).join(" / ") || "当前没有高危命中。",
    },
    {
      name: "深层数据库表",
      resultCount: deepDatabase.tableCount,
      evidence: `${deepDatabase.status} · ${deepDatabase.coverage}% · ${deepDatabase.seedRowCount} 条深层种子。`,
    },
    {
      name: "成熟本地库条目",
      resultCount: localMatureLibraryEntries.length,
      evidence: `覆盖 ${Object.keys(localMatureLibraryTargets).length} 类库，已进入 library_entries 可查询层。`,
    },
    {
      name: "DeepWeb 多维映射",
      resultCount: deepDatabase.deepWeb.dimensionCount,
      evidence: `${deepDatabase.deepWeb.activeDimensionCount}/${deepDatabase.deepWeb.dimensionCount} 维激活 · ${deepDatabase.deepWeb.projectionCount} 条投影边 · ${deepDatabase.deepWeb.mode}`,
    },
    {
      name: "DeepWeb 成熟验证",
      resultCount: deepDatabase.deepWeb.maturity.matureValidationCount,
      evidence: `${deepDatabase.deepWeb.maturity.status} · ${deepDatabase.deepWeb.maturity.passedScenarioCount}/${deepDatabase.deepWeb.maturity.validationScenarioCount} 场景通过 · ${deepDatabase.deepWeb.maturity.summary}`,
    },
    {
      name: "DeepWeb 验证证据",
      resultCount: deepDatabase.deepWeb.validationEvidenceCount,
      evidence: deepDatabase.deepWeb.validationEvidence
        .slice(0, 4)
        .map((item) => `${item.dimensionKey}:${item.evidenceKind}`)
        .join(" / "),
    },
    {
      name: "DeepWeb 极限测试优化",
      resultCount: deepDatabase.deepWeb.extremePassCount,
      evidence: `${deepDatabase.deepWeb.optimization.status} · DB ${deepDatabase.deepWeb.optimization.databaseScore}% · DeepWeb ${deepDatabase.deepWeb.optimization.deepWebScore}% · ${deepDatabase.deepWeb.optimization.passedExtremeTests}/${deepDatabase.deepWeb.optimization.totalExtremeTests} tests`,
    },
    {
      name: "DeepWeb 监督浇灌",
      resultCount: deepDatabase.deepWeb.irrigation.acceptedEvidenceCount,
      evidence: `${deepDatabase.deepWeb.irrigation.status} · 稳定门 ${deepDatabase.deepWeb.irrigation.stabilityScore}% · 流入 ${deepDatabase.deepWeb.irrigation.evidenceInflowCount} · 隔离 ${deepDatabase.deepWeb.irrigation.isolatedEvidenceCount}`,
    },
    {
      name: "DeepWeb 回放记忆",
      resultCount: deepDatabase.deepWeb.irrigation.weightUpdateCount + deepDatabase.deepWeb.validationEvidenceCount,
      evidence: `current snapshot ready · replay comparison ready · promotion decisions ${deepDatabase.deepWeb.irrigation.weightUpdateCount + deepDatabase.deepWeb.validationEvidenceCount}`,
    },
    {
      name: "DeepWeb SQLite 同步日志",
      resultCount: deepDatabase.deepWeb.irrigation.weightUpdateCount + deepDatabase.deepWeb.validationEvidenceCount + 2,
      evidence: "localStorage journal · SQL export ready · sql.js writer pending",
    },
    {
      name: "DeepWeb 本地持久化引擎",
      resultCount: 1,
      evidence: "IndexedDB durable store ready · sql.js/OPFS writer pending",
    },
    {
      name: "DeepWeb 本地快照导出",
      resultCount: 0,
      evidence: "runtime export action ready · waits for browser IndexedDB snapshot",
    },
    {
      name: "DeepWeb 语言适配",
      resultCount: deepDatabase.deepWeb.adapterCount,
      evidence: `${deepDatabase.deepWeb.languageAdaptabilityScore}% · ${deepDatabase.deepWeb.languageAdapters
        .map((adapter) => adapter.language)
        .slice(0, 4)
        .join(", ")}`,
    },
    {
      name: "版本差异约束",
      resultCount: localVersionConstraints.length,
      evidence: localVersionConstraints.map((item) => `${item.packageName}:${item.apiName}`).slice(0, 4).join(", "),
    },
    {
      name: "SDK/API 画像",
      resultCount: localSdkApiProfiles.length,
      evidence: localSdkApiProfiles.map((item) => `${item.sdkName}.${item.apiName}`).slice(0, 4).join(", "),
    },
    {
      name: "真实故障样本",
      resultCount: localFaultSamples.length,
      evidence: localFaultSamples.map((item) => item.failureMode).slice(0, 4).join(", "),
    },
    {
      name: "性能基准与修复配方",
      resultCount: localBenchmarkProfiles.length + localRepairRecipes.length,
      evidence: `benchmark ${localBenchmarkProfiles.length} · recipes ${localRepairRecipes.length}`,
    },
    {
      name: "硬件与环境画像",
      resultCount: localHardwareComponentProfiles.length + localEnvironmentProfiles.length,
      evidence: `hardware ${localHardwareComponentProfiles.length} · environment ${localEnvironmentProfiles.length}`,
    },
  ];
}

function buildIndexHotspots(
  functions: FunctionInfo[],
  flowNodes: FlowNode[],
  flowEdges: FlowEdge[],
  localLibraryAudit: LocalLibraryAuditItem[],
  knowledgeRuleReport: KnowledgeRuleReport,
  deepDatabase: DeepKnowledgeDatabaseReport,
): SemanticIndexHotspot[] {
  const maxComplexity = Math.max(0, ...functions.map((fn) => fn.complexity));
  const lowConfidence = functions.filter((fn) => fn.confidence < 70).length;
  const issueEdges = flowEdges.filter((edge) => ["Open", "Overflow Risk", "Blocked"].includes(edge.status)).length;
  const openNodes = flowNodes.filter((node) => ["Open", "Overflow Risk", "Blocked"].includes(node.status)).length;
  const lowestCoverage = Math.min(100, ...localLibraryAudit.map((item) => item.coverage));
  const ruleCoverage = localKnowledgeRules.length;
  const matureLibraryCoverage = matureLibraryTotalCount();
  const deepWebCoverage = deepDatabase.deepWeb.coverage;
  const criticalRuleMatches = knowledgeRuleReport.criticalCount;

  return [
    {
      label: "最高复杂度",
      value: maxComplexity,
      severity: maxComplexity >= 8 ? "high" : maxComplexity >= 5 ? "medium" : "low",
      evidence: functions.find((fn) => fn.complexity === maxComplexity)?.name ?? "等待函数。",
    },
    {
      label: "低置信函数",
      value: lowConfidence,
      severity: lowConfidence >= 6 ? "high" : lowConfidence >= 2 ? "medium" : "low",
      evidence: "置信度低于 70 的函数数量。",
    },
    {
      label: "问题水段",
      value: issueEdges + openNodes,
      severity: issueEdges + openNodes >= 5 ? "high" : issueEdges + openNodes >= 2 ? "medium" : "low",
      evidence: "Open、Blocked、Overflow Risk 节点和边。",
    },
    {
      label: "知识库最低覆盖",
      value: lowestCoverage,
      severity: lowestCoverage < 18 ? "high" : lowestCoverage < 30 ? "medium" : "low",
      evidence: localLibraryAudit.find((item) => item.coverage === lowestCoverage)?.name ?? "等待知识库。",
    },
    {
      label: "本地规则条目",
      value: ruleCoverage,
      severity: ruleCoverage >= 24 ? "low" : ruleCoverage >= 12 ? "medium" : "high",
      evidence: "数学、算法、效率、安全、稳定和语言 API 规则总数。",
    },
    {
      label: "成熟库条目",
      value: matureLibraryCoverage,
      severity: matureLibraryCoverage >= 96 ? "low" : matureLibraryCoverage >= 48 ? "medium" : "high",
      evidence: "数学、算法、效率、安全、稳定、语言、环境、硬件、索引和适配器成熟条目总数。",
    },
    {
      label: "DeepWeb覆盖",
      value: deepWebCoverage,
      severity: deepWebCoverage >= 76 ? "low" : deepWebCoverage >= 56 ? "medium" : "high",
      evidence: `${deepDatabase.deepWeb.activeDimensionCount}/${deepDatabase.deepWeb.dimensionCount} 维 · ${deepDatabase.deepWeb.modelLayerCount} 层 · ${deepDatabase.deepWeb.adapterCount} 语言适配器`,
    },
    {
      label: "高危规则命中",
      value: criticalRuleMatches,
      severity: criticalRuleMatches >= 3 ? "high" : criticalRuleMatches >= 1 ? "medium" : "low",
      evidence: knowledgeRuleReport.topMatches.find((match) => match.severity === "critical")?.ruleName ?? "当前没有高危命中。",
    },
    {
      label: "深层库覆盖",
      value: deepDatabase.coverage,
      severity: deepDatabase.coverage >= 72 ? "low" : deepDatabase.coverage >= 48 ? "medium" : "high",
      evidence: `${deepDatabase.tableCount} 张表 · ${deepDatabase.seedRowCount} 条种子 · ${deepDatabase.missingLayers.join("、") || "核心层已覆盖"}`,
    },
  ];
}

function scoreIndexIntegrity(
  files: CodeFile[],
  functions: FunctionInfo[],
  callEdges: GraphEdge[],
  flowEdges: FlowEdge[],
  localLibraryAudit: LocalLibraryAuditItem[],
  hotspots: SemanticIndexHotspot[],
  knowledgeRuleReport: KnowledgeRuleReport,
  deepDatabase: DeepKnowledgeDatabaseReport,
) {
  let score = 48;
  if (files.length) score += 8;
  if (functions.length) score += 14;
  if (callEdges.length) score += 10;
  if (flowEdges.length) score += 10;
  if (localLibraryAudit.length >= 8) score += 8;
  if (localKnowledgeRules.length >= 24) score += 8;
  if (matureLibraryTotalCount() >= 96) score += 10;
  if (deepDatabase.deepWeb.coverage >= 58) score += 8;
  if (deepDatabase.deepWeb.activeDimensionCount >= 10) score += 6;
  if (knowledgeRuleReport.totalMatches) score += 4;
  if (deepDatabase.tableCount >= 20) score += 8;
  if (deepDatabase.seedRowCount >= 24) score += 6;
  score += Math.max(0, Math.round((deepDatabase.coverage - 52) / 8));
  score -= hotspots.filter((hotspot) => hotspot.severity === "high").length * 8;
  score -= hotspots.filter((hotspot) => hotspot.severity === "medium").length * 4;
  return Math.max(12, Math.min(96, Math.round(score)));
}

function buildDeepKnowledgeDatabaseReport(
  files: CodeFile[],
  functions: FunctionInfo[],
  callEdges: GraphEdge[],
  flowNodes: FlowNode[],
  flowEdges: FlowEdge[],
  symbolCount: number,
  knowledgeRuleReport: KnowledgeRuleReport,
  runtimeExecutions: ControlledRuntimeExecutionReport[],
  deepWebBaseline?: DeepWebModelBaseline | null,
): DeepKnowledgeDatabaseReport {
  const deepWeb = buildDeepWebNeuralDatabaseReport(
    files,
    functions,
    callEdges,
    flowNodes,
    flowEdges,
    knowledgeRuleReport,
    runtimeExecutions,
    deepWebBaseline,
  );
  const layerGroups = groupDeepTablesByLayer();
  const layers: DeepKnowledgeDatabaseLayer[] = Array.from(layerGroups.entries()).map(([layerName, tables]) => {
    const seededRows = tables.reduce(
      (sum, table) => sum + tableRuntimeRows(table.name, files, functions, callEdges, flowNodes, flowEdges, symbolCount, knowledgeRuleReport, deepWeb),
      0,
    );
    const seededTables = tables.filter((table) => table.maturity === "seeded" || table.maturity === "active").length;
    const coverage = Math.min(100, Math.round((seededTables / tables.length) * 54 + Math.min(1, seededRows / Math.max(1, tables.length * 3)) * 46));
    const status = coverage >= 72 ? "active" : coverage >= 42 ? "seeded" : "missing";

    return {
      name: layerName,
      tableCount: tables.length,
      seededRows,
      coverage,
      status,
      purpose: tables.map((table) => table.requiredFor[0]).slice(0, 3).join(" / "),
      next: nextForDeepLayer(layerName, status),
    };
  });
  const tableCount = localDeepKnowledgeTableCatalog.length;
  const activeTableCount = localDeepKnowledgeTableCatalog.filter((table) => table.maturity === "active").length;
  const seededTableCount = localDeepKnowledgeTableCatalog.filter((table) => table.maturity !== "missing").length;
  const seedRowCount = deepKnowledgeSeedCount();
  const coverage = Math.min(
    100,
    Math.round(average(layers.map((layer) => layer.coverage)) * 0.58 + Math.min(100, seedRowCount * 2.2) * 0.2 + deepWeb.coverage * 0.22),
  );
  const status = coverage >= 76 ? "深层证据库" : coverage >= 52 ? "Alpha 深层库" : "初始规则库";
  const missingLayers = layers.filter((layer) => layer.coverage < 72).map((layer) => layer.name);

  return {
    status,
    coverage,
    tableCount,
    activeTableCount,
    seededTableCount,
    seedRowCount,
    missingLayers,
    layers,
    completed: [
      "已把项目扫描结果表与知识规则表拆开，支持文件夹导入后的持久化索引。",
      "已增加成熟知识层：library_domains、library_entries，用于保存本地数学、算法、效率、安全、稳定、语言、环境和硬件库。",
      "已增加深层特征、版本差异、SDK/API 画像、故障样本、性能基准、修复配方和硬件环境表。",
      "已建立 DeepWeb 神经数据库层，用本地专家监督 ML 把单独数据库投影到多维深层特征空间。",
      "已为规则命中到水文节点/水路浮窗保留 evidence 与 recipe 的数据库落点。",
    ],
    deepWeb,
  };
}

function groupDeepTablesByLayer() {
  const groups = new Map<string, typeof localDeepKnowledgeTableCatalog>();
  localDeepKnowledgeTableCatalog.forEach((table) => {
    groups.set(table.layer, [...(groups.get(table.layer) ?? []), table]);
  });
  return groups;
}

function tableRuntimeRows(
  tableName: string,
  files: CodeFile[],
  functions: FunctionInfo[],
  callEdges: GraphEdge[],
  flowNodes: FlowNode[],
  flowEdges: FlowEdge[],
  symbolCount: number,
  knowledgeRuleReport: KnowledgeRuleReport,
  deepWeb: DeepKnowledgeDatabaseReport["deepWeb"],
) {
  const rowCounts: Record<string, number> = {
    analysis_runs: files.length ? 1 : 0,
    project_files: files.length,
    project_functions: functions.length,
    function_symbols: symbolCount,
    call_edges: callEdges.length,
    flow_nodes: flowNodes.length,
    flow_edges: flowEdges.length,
    data_flow_traces: flowEdges.filter((edge) => edge.primary).length,
    taint_paths: new Set(flowEdges.flatMap((edge) => edge.taintPathIds ?? [])).size,
    debug_breakpoints: 0,
    source_versions: localKnowledgeSourceVersions.length,
    knowledge_concepts: localKnowledgeConcepts.length,
    knowledge_rules: localKnowledgeRules.length,
    rule_evidence: localKnowledgeRuleEvidence.length,
    rule_matches: knowledgeRuleReport.totalMatches,
    language_apis: localLanguageApiRules.length,
    library_domains: Object.keys(localMatureLibraryTargets).length,
    library_entries: localMatureLibraryEntries.length,
    knowledge_feature_vectors: localKnowledgeFeatureVectors.length,
    deepweb_feature_spaces: localDeepWebFeatureSpaces.length,
    deepweb_model_layers: localDeepWebModelLayers.length,
    deepweb_language_adapters: localDeepWebLanguageAdapters.length,
    deepweb_projections: localDeepWebProjections.length,
    deepweb_feature_vectors:
      files.length +
      functions.length +
      callEdges.length +
      flowNodes.length +
      flowEdges.length +
      knowledgeRuleReport.totalMatches +
      localMatureLibraryEntries.length +
      localVersionConstraints.length +
      localSdkApiProfiles.length +
      localFaultSamples.length +
      localBenchmarkProfiles.length +
      localRepairRecipes.length +
      localHardwareComponentProfiles.length +
      localEnvironmentProfiles.length,
    deepweb_training_samples: localDeepWebTrainingSamples.length + deepWeb.supervised.teacherSampleCount,
    deepweb_validation_scenarios: deepWeb.validationScenarioCount,
    deepweb_validation_evidence: deepWeb.validationEvidenceCount,
    deepweb_extreme_test_runs: deepWeb.extremeTestCount,
    database_optimization_profiles: 6,
    deepweb_irrigation_runs: 1,
    deepweb_irrigation_evidence: deepWeb.irrigation.evidenceInflowCount,
    deepweb_irrigation_epochs: deepWeb.irrigation.epochs.length,
    deepweb_weight_update_events: deepWeb.irrigation.weightDeltas.length,
    deepweb_replay_memory_snapshots: 1,
    deepweb_replay_comparisons: 1,
    deepweb_replay_promotion_decisions: deepWeb.irrigation.weightUpdateCount + deepWeb.validationEvidenceCount,
    deepweb_local_sqlite_journal: deepWeb.irrigation.weightUpdateCount + deepWeb.validationEvidenceCount + 2,
    deepweb_local_storage_engines: 1,
    deepweb_local_snapshot_exports: 0,
    deepweb_supervision_labels: deepWeb.supervised.teacherSampleCount,
    deepweb_teacher_reliability: deepWeb.supervised.teacherReliability.length,
    deepweb_quarantined_labels: deepWeb.supervised.quarantinedSampleCount,
    deepweb_error_signals: deepWeb.errorSignals.length,
    deepweb_label_centroids: deepWeb.supervised.centroids.length,
    deepweb_contrastive_pairs: deepWeb.selfSupervised.contrastivePairCount,
    deepweb_self_supervised_epochs: deepWeb.selfSupervised.epochCount,
    deepweb_supervised_epochs: deepWeb.supervised.matchedTeacherCount ? 1 : 0,
    deepweb_rollback_snapshots: 1,
    deepweb_gene_pool: deepWeb.evolution.geneCount,
    deepweb_genome_generations: deepWeb.evolution.generationCount,
    deepweb_gene_expression: deepWeb.evolution.genes.filter((gene) => gene.geneKind === "expression_gate").length,
    deepweb_fitness_scores: deepWeb.evolution.fitness.length,
    deepweb_inference_runs: deepWeb.inferenceRunCount,
    version_constraints: localVersionConstraints.length,
    sdk_api_profiles: localSdkApiProfiles.length,
    fault_samples: localFaultSamples.length,
    benchmark_profiles: localBenchmarkProfiles.length,
    repair_recipes: localRepairRecipes.length,
    hardware_component_profiles: localHardwareComponentProfiles.length,
    environment_profiles: localEnvironmentProfiles.length,
  };
  return rowCounts[tableName] ?? 0;
}

function nextForDeepLayer(layerName: string, status: DeepKnowledgeDatabaseLayer["status"]) {
  if (status === "missing") return "先建表和最小种子，再接入本地索引。";
  if (layerName === "运行样本层") return "下一步接入真实 dry-run、断点命中、溢出样本和回归样本。";
  if (layerName === "版本生态层") return "下一步按语言、框架、SDK 版本解析 lockfile 和 manifest。";
  if (layerName === "修复推荐层") return "下一步把 recipe 与规则命中、测试验证和修复前后 diff 绑定。";
  if (layerName === "硬件环境层") return "下一步按设备型号、datasheet 和运行配置补参数证据。";
  if (layerName === "深层特征层") return "下一步用特征向量融合 AST、data flow、runtime 和 benchmark 证据。";
  if (layerName === "成熟知识层") return "下一步把 library_entries 与规则命中、版本样本和水文浮窗双向绑定。";
  if (layerName === "DeepWeb神经层") return "下一步把专家监督标签、监督 epoch、对比样本和 deepweb_inference_runs 持久化，并用真实故障/benchmark 样本校准权重。";
  return "下一步落到 sql.js/OPFS SQLite 并支持增量更新。";
}

function countSymbols(functions: FunctionInfo[]) {
  return functions.reduce(
    (sum, fn) =>
      sum +
      fn.params.length +
      fn.outputs.length +
      fn.externalInputs.length +
      fn.validations.length +
      fn.sideEffects.length +
      fn.risks.length,
    0,
  );
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
