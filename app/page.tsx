"use client";

import { ChangeEvent, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { IssueList } from "@/app/components/IssueList";
import { LogicInventoryPanel } from "@/app/components/LogicInventoryPanel";
import { MovableGraphViewport } from "@/app/components/MovableGraphViewport";
import { WaterCanalDiagram, type WaterDeepWebBinding, type WaterDeepWebBindingMap } from "@/app/components/WaterCanalDiagram";
import { WorkspaceNavigator, type NavigationMode } from "@/app/components/WorkspaceNavigator";
import { exportElementAsLocalPdf } from "@/src/lib/report/local-pdf-export";
import { buildSoftwareTestReport, usabilityChecklist } from "@/src/lib/testing/software-test-plan";
import type {
  CodeFile,
  ControlledRuntimeAdapter,
  ControlledRuntimeAvailabilityReport,
  ControlledRuntimeExecutionReport,
  DeepWebErrorSignalReport,
  DeepWebGeneratedVectorReport,
  DeepWebInferenceRunReport,
  DeepWebMaturityStage,
  DeepWebModelBaseline,
  DeepWebNeuralDatabaseReport,
  DeepWebSupervisedAssignmentReport,
  DeepWebVectorLabel,
  FlowEdge,
  FlowNode,
  FormalVerificationRecord,
  FunctionInfo,
  GraphEdge,
  GraphMode,
  TypeDeclarationInfo,
  WorkspaceAnalysis,
} from "@/src/lib/analysis/types";
import { runFormalPolicySuite, runProjectContractProofs } from "@/src/lib/verification/formal-verifier";
import { escapeRegExp, shorten } from "@/src/lib/analysis/utils";
import { buildCompleteSoftwareInterpretation as buildSoftwareInterpretation } from "@/src/lib/explanation/software-explanation";
import { sampleFiles } from "@/src/lib/fixtures/sample-project";
import {
  analyzeWorkspace,
  buildTrace,
  classifyFlowRole,
  inferNodeCapacity,
  layoutGraph,
  logicInventory,
  nodeConfidence,
} from "@/src/lib/flow/flow-engine";
import {
  buildRecommendations,
} from "@/src/lib/parser/heuristic-parser";
import {
  buildDeepWebReplayMemoryReport,
  buildDeepWebReplaySnapshot,
  clearDeepWebReplaySnapshots,
  getDeepWebReplaySnapshotPayload,
  parseDeepWebReplaySnapshotsPayload,
  saveDeepWebReplaySnapshot,
  subscribeDeepWebReplayMemory,
} from "@/src/lib/memory/deepweb-memory-store";
import {
  buildDeepWebSqliteJournalReport,
  buildDeepWebSqliteJournalRows,
  clearDeepWebSqliteJournal,
  getDeepWebSqliteJournalPayload,
  parseDeepWebSqliteJournalPayload,
  subscribeDeepWebSqliteJournal,
  syncDeepWebSqliteJournal,
} from "@/src/lib/persistence/deepweb-sqlite-journal";
import {
  buildDeepWebIndexedDbUnavailableReport,
  clearDeepWebIndexedDbJournal,
  exportDeepWebIndexedDbSnapshot,
  importDeepWebIndexedDbSnapshot,
  syncDeepWebIndexedDbJournal,
  type DeepWebIndexedDbSyncReport,
} from "@/src/lib/persistence/deepweb-indexeddb-store";
import {
  buildDeepWebOpfsSqliteUnavailableReport,
  clearDeepWebOpfsSqliteDatabase,
  exportDeepWebOpfsSqliteDatabase,
  syncDeepWebOpfsSqliteDatabase,
  type DeepWebOpfsSqliteReport,
} from "@/src/lib/persistence/deepweb-opfs-sqlite-store";
import {
  buildNativeCodeIndexSqliteRows,
  buildNativeSqliteUnavailableReport,
  clearNativeSqliteDatabase,
  loadNativeDeepWebModelBaseline,
  loadNativeWorkspaceProjectStore,
  syncNativeSqliteWriters,
  type NativeSqliteReport,
} from "@/src/lib/persistence/native-sqlite-writer";
import {
  activateKnowledgePack,
  buildKnowledgePackWebPreviewReport,
  importPhaseOneKnowledgePack,
  importSupplementalKnowledgeBundle,
  activateSupplementalKnowledgeBundle,
  inspectKnowledgePacks,
  rollbackKnowledgePack,
  type KnowledgePackStatusReport,
  type SupplementalKnowledgeReport,
} from "@/src/lib/persistence/knowledge-pack-manager";
import {
  buildNetworkPolicyWebPreview,
  inspectNetworkPolicy,
  setNetworkPolicy,
  type NetworkPolicyReport,
} from "@/src/lib/security/local-security-defense";
import {
  matchProjectDependencies,
  type ProjectKnowledgeMatchReport,
} from "@/src/lib/security/dependency-knowledge-matcher";
import {
  buildLocalSecurityAttackCorpus,
  executeSecurityAssertionSuite,
  evaluateSecurityCorpusMaturity,
  inferSecurityFrameworks,
  loadSecurityCorpusHistory,
  persistSecurityAssertionResults,
  type SecurityAssertionResult,
} from "@/src/lib/security/security-assertions";
import { parseWorkspace } from "@/src/lib/parser/local-parser";
import type { WorkspaceParseResult } from "@/src/lib/parser/local-parser";
import {
  mergeNativeAstReport,
  parseWorkspaceWithNativeAst,
} from "@/src/lib/parser/native-ast-parser";
import {
  mergeNativeLspReport,
  parseWorkspaceWithNativeLsp,
} from "@/src/lib/parser/native-lsp-parser";
import {
  mergeNativeTypeScriptCompilerReport,
  parseWorkspaceWithNativeTypeScriptCompiler,
} from "@/src/lib/parser/native-typescript-compiler";
import {
  buildRuntimeWebPreviewReport,
  buildControlledRuntimeCertification,
  certifyControlledRuntimeOnHost,
  executeControlledRuntime,
  inspectControlledRuntimeTools,
  recommendedRuntimeAdapter,
  recommendedRuntimeEntry,
  runtimeAdapterDefinitions,
} from "@/src/lib/runtime/controlled-runtime";
import {
  executeGeneratedRepairSuggestions,
  generateCandidateDiffFromSuggestions,
  type RepairCandidateExperiment,
} from "@/src/lib/repair/candidate-diff";
import {
  approveRepairExperiment,
  rollbackRepairWriteBack,
  writeBackApprovedRepair,
  type RepairApproval,
  type RepairRollbackSnapshot,
} from "@/src/lib/repair/repair-workflow";
import {
  buildLspSidecarWebPreviewReport,
  inspectLspSidecars,
  setLspSidecarEnabled,
  type LspSidecarStatusReport,
} from "@/src/lib/runtime/lsp-sidecar-manager";
import {
  buildUnavailableDebugAvailability,
  continueDebugSession,
  createDebugSession,
  disconnectDebugSession,
  inspectDebugAvailability,
  launchDebugSession,
  nextDebugSession,
  setDebugBreakpoints,
  stepInDebugSession,
  stepOutDebugSession,
} from "@/src/lib/debug/debug-session";
import type { DebugAvailability, DebugSession } from "@/src/lib/debug/types";
import { localExtensionAdapters } from "@/src/lib/extensions/adapter-contract";
import {
  downloadExtensionAdapterTemplate,
  importExtensionAdapterFile,
  loadImportedExtensionAdapters,
  removeImportedExtensionAdapter,
  type ImportedExtensionAdapter,
} from "@/src/lib/extensions/adapter-import";
import {
  buildRuntimeCostReport,
  buildSystemCapacityWebPreview,
  formatBytes,
  inspectSystemCapacity,
  type SystemCapacityReport,
} from "@/src/lib/runtime/runtime-cost";
import {
  detectLanguage,
  directoryInputProps,
  readCodeFiles,
  simpleHash,
} from "@/src/lib/workspace/files";
import {
  buildWorkspaceProjectSqliteRows,
  buildWorkspaceProjectStoreUnavailableReport,
  exportWorkspaceProjectBackup,
  loadWorkspaceProjectStore,
  parseWorkspaceProjectBackup,
  saveWorkspaceProjectStore,
  type WorkspaceProjectRecord,
  type WorkspaceProjectStoreReport,
  type WorkspaceProjectSource,
} from "@/src/lib/workspace/project-store";

export type WorkspacePage = "projects" | "map" | "files" | "modules" | "inspect" | "twin" | "testing" | "diagnostics" | "reports" | "hardcore" | "knowledge" | "settings";
type WorkspaceProject = WorkspaceProjectRecord;

const workspacePages: { id: WorkspacePage; label: string; shortLabel: string; group: "项目" | "解析" | "实验" | "系统" }[] = [
  { id: "projects", label: "项目中心", shortLabel: "项", group: "项目" },
  { id: "map", label: "数据流总览", shortLabel: "流", group: "项目" },
  { id: "files", label: "文件解析", shortLabel: "文", group: "解析" },
  { id: "modules", label: "模块解析", shortLabel: "模", group: "解析" },
  { id: "inspect", label: "函数解析", shortLabel: "函", group: "解析" },
  { id: "diagnostics", label: "问题诊断", shortLabel: "诊", group: "实验" },
  { id: "twin", label: "孪生实验", shortLabel: "孪", group: "实验" },
  { id: "testing", label: "测试与验证", shortLabel: "测", group: "实验" },
  { id: "reports", label: "分析报告", shortLabel: "报", group: "实验" },
  { id: "hardcore", label: "分析内核", shortLabel: "核", group: "系统" },
  { id: "knowledge", label: "本地知识", shortLabel: "知", group: "系统" },
  { id: "settings", label: "设置", shortLabel: "设", group: "系统" },
];

type IntegratedTestId = "functional" | "smoke" | "regression" | "integration" | "performance" | "load" | "usability" | "repair-verification";
type TwinExperimentSelection = "静态分析" | "动态仿真" | "压力测试" | "容错传播" | "算法替换" | "安全攻击" | "环境迁移";

const integratedTestOptions: Array<{ id: IntegratedTestId; label: string; mode: "auto" | "manual" | "candidate" }> = [
  { id: "functional", label: "功能测试", mode: "auto" },
  { id: "smoke", label: "冒烟测试", mode: "auto" },
  { id: "regression", label: "回归测试", mode: "auto" },
  { id: "integration", label: "集成测试", mode: "auto" },
  { id: "performance", label: "性能测试", mode: "auto" },
  { id: "load", label: "负载测试", mode: "auto" },
  { id: "usability", label: "可用性测试", mode: "manual" },
  { id: "repair-verification", label: "修复结果验证", mode: "candidate" },
];

const twinExperimentOptions: Array<{ id: TwinExperimentSelection; mode: "runtime" | "model" | "candidate" }> = [
  { id: "静态分析", mode: "model" },
  { id: "动态仿真", mode: "runtime" },
  { id: "压力测试", mode: "runtime" },
  { id: "容错传播", mode: "runtime" },
  { id: "算法替换", mode: "candidate" },
  { id: "安全攻击", mode: "runtime" },
  { id: "环境迁移", mode: "model" },
];

type SuiteProgress = {
  running: boolean;
  completed: number;
  total: number;
  current: string;
  message: string;
  updatedAt: number | null;
};

const idleSuiteProgress: SuiteProgress = { running: false, completed: 0, total: 0, current: "等待开始", message: "尚未执行。", updatedAt: null };

const sampleWorkspaceProject: WorkspaceProject = {
  id: "sample-project",
  name: "示例项目 CodeFlow",
  files: sampleFiles,
  source: "sample",
  createdAt: 0,
  updatedAt: 0,
};

const navigationModeEvent = "codeflow-navigation-mode-change";
const workspacePageStoreKey = "codeflow-project-last-pages";

function subscribeNavigationMode(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(navigationModeEvent, listener);
  return () => window.removeEventListener(navigationModeEvent, listener);
}

function getNavigationMode(): NavigationMode {
  if (typeof window === "undefined") return "standard";
  const stored = window.localStorage.getItem("codeflow-navigation-mode");
  return stored === "standard" || stored === "compact" ? stored : "standard";
}

function readProjectPage(projectId: string): WorkspacePage {
  if (typeof window === "undefined") return "map";
  try {
    const pages = JSON.parse(window.localStorage.getItem(workspacePageStoreKey) ?? "{}") as Record<string, WorkspacePage>;
    return workspacePages.some((page) => page.id === pages[projectId]) ? pages[projectId] : "map";
  } catch {
    return "map";
  }
}

function saveProjectPage(projectId: string, page: WorkspacePage) {
  if (typeof window === "undefined") return;
  try {
    const pages = JSON.parse(window.localStorage.getItem(workspacePageStoreKey) ?? "{}") as Record<string, WorkspacePage>;
    window.localStorage.setItem(workspacePageStoreKey, JSON.stringify({ ...pages, [projectId]: page }));
  } catch {
    // Navigation persistence is optional; project data remains in SQLite.
  }
}

function ruleSeverityClass(severity: string) {
  if (severity === "critical") return "critical";
  if (severity === "risk") return "high";
  if (severity === "warn") return "medium";
  return "low";
}

function maturityStageClass(stage: DeepWebMaturityStage) {
  if (stage === "成熟验证") return "mature";
  if (stage === "基础覆盖") return "base";
  return "missing";
}

function buildWaterDeepWebBindings(nodes: FlowNode[], edges: FlowEdge[], deepWeb: DeepWebNeuralDatabaseReport): WaterDeepWebBindingMap {
  const vectorsBySource = new Map(deepWeb.generatedVectors.map((vector) => [`${vector.sourceTable}:${vector.sourceId}`, vector]));
  const inferenceByVector = new Map(deepWeb.inferenceRuns.map((run) => [run.sourceVectorId, run]));
  const assignmentByVector = new Map(deepWeb.supervised.assignments.map((assignment) => [assignment.vectorId, assignment]));
  const signalsByVector = deepWeb.errorSignals.reduce((acc, signal) => {
    acc.set(signal.sourceId, [...(acc.get(signal.sourceId) ?? []), signal]);
    return acc;
  }, new Map<string, DeepWebErrorSignalReport[]>());

  const nodeBindings = nodes.reduce<Record<string, WaterDeepWebBinding>>((acc, node) => {
    const sourceId = node.functionId ?? node.id;
    const vector = vectorsBySource.get(`project_functions:${sourceId}`);
    const binding = vector ? buildDeepWebBinding(vector, inferenceByVector.get(vector.id), assignmentByVector.get(vector.id), signalsByVector.get(vector.id) ?? [], deepWeb) : null;
    if (binding) acc[node.id] = binding;
    return acc;
  }, {});

  const edgeBindings = edges.reduce<Record<string, WaterDeepWebBinding>>((acc, edge) => {
    const vector = vectorsBySource.get(`flow_edges:${edge.id}`);
    const fallbackSignals = [nodeBindings[edge.from], nodeBindings[edge.to]].filter(Boolean);
    const binding = vector
      ? buildDeepWebBinding(vector, inferenceByVector.get(vector.id), assignmentByVector.get(vector.id), signalsByVector.get(vector.id) ?? [], deepWeb)
      : mergeFallbackEdgeBinding(fallbackSignals);
    if (binding) acc[edge.id] = binding;
    return acc;
  }, {});

  return { nodes: nodeBindings, edges: edgeBindings };
}

function buildDeepWebBinding(
  vector: DeepWebGeneratedVectorReport,
  inference: DeepWebInferenceRunReport | undefined,
  assignment: DeepWebSupervisedAssignmentReport | undefined,
  signals: DeepWebErrorSignalReport[],
  deepWeb: DeepWebNeuralDatabaseReport,
): WaterDeepWebBinding {
  const predictedClass = inference?.predictedClass ?? vector.pseudoLabel;
  const teacherLabel = assignment?.teacherLabel;
  const signalConfidenceImpact = average(signals.map((signal) => signal.confidenceImpact));
  const signalKnowledgeImpact = average(signals.map((signal) => signal.knowledgeScoreImpact));
  const signalFitnessImpact = average(signals.map((signal) => signal.fitnessImpact));
  const confidence = clampScore(
    Math.round(
      (inference?.confidence ?? vector.confidence) * 0.44 +
        (assignment?.trustScore ?? vector.confidence) * 0.34 +
        vector.confidence * 0.22 -
        signalConfidenceImpact * 0.28,
    ),
  );
  const knowledgeScore = clampScore(
    Math.round((assignment?.consensusScore ?? vector.confidence) * 0.58 + (assignment?.trustScore ?? vector.confidence) * 0.42 - signalKnowledgeImpact * 0.42),
  );
  const fitnessScore = clampScore(Math.round(deepWeb.evolution.fitnessScore - signalFitnessImpact * 0.58));
  const activeLabel = teacherLabel ?? predictedClass;

  return {
    level: deepWebBindingLevel(activeLabel, signals, confidence, knowledgeScore, fitnessScore),
    predictedClass,
    teacherLabel,
    corrected: assignment?.corrected ?? false,
    confidence,
    knowledgeScore,
    fitnessScore,
    confidenceImpact: Math.round(signalConfidenceImpact),
    knowledgeScoreImpact: Math.round(signalKnowledgeImpact),
    fitnessImpact: Math.round(signalFitnessImpact),
    evidence: uniqueLines([
      vector.evidence,
      inference?.evidence,
      assignment?.evidence,
      ...signals.map((signal) => `${signal.signalKind}：${signal.evidence}`),
    ]),
    recommendations: uniqueLines([
      ...signals.map((signal) => signal.containmentAction),
      recommendationForDeepWebLabel(activeLabel),
    ]),
  };
}

function mergeFallbackEdgeBinding(bindings: WaterDeepWebBinding[]): WaterDeepWebBinding | null {
  if (!bindings.length) return null;
  const strongest = [...bindings].sort((a, b) => deepWebLevelRank(b.level) - deepWebLevelRank(a.level) || b.confidenceImpact - a.confidenceImpact)[0];
  return {
    ...strongest,
    confidence: clampScore(Math.round(average(bindings.map((binding) => binding.confidence)))),
    knowledgeScore: clampScore(Math.round(average(bindings.map((binding) => binding.knowledgeScore)))),
    fitnessScore: clampScore(Math.round(average(bindings.map((binding) => binding.fitnessScore)))),
    evidence: uniqueLines(["数据路径继承上下游函数的 DeepWeb 信号。", ...bindings.flatMap((binding) => binding.evidence.slice(0, 2)).map(productTerminology)]),
    recommendations: uniqueLines(bindings.flatMap((binding) => binding.recommendations.slice(0, 2))),
  };
}

function deepWebBindingLevel(
  label: string,
  signals: DeepWebErrorSignalReport[],
  confidence: number,
  knowledgeScore: number,
  fitnessScore: number,
): WaterDeepWebBinding["level"] {
  if (signals.some((signal) => signal.severity === "critical") || fitnessScore < 42) return "critical";
  if (label === "security_risk" || label === "stability_risk" || signals.some((signal) => signal.severity === "risk") || knowledgeScore < 58) return "risk";
  if (label === "flow_warning" || label === "performance_hotspot" || label === "repair_candidate" || signals.length || confidence < 72) return "warn";
  return "none";
}

function deepWebLevelRank(level: WaterDeepWebBinding["level"]) {
  if (level === "critical") return 3;
  if (level === "risk") return 2;
  if (level === "warn") return 1;
  return 0;
}

function recommendationForDeepWebLabel(label: string) {
  const recommendations: Record<DeepWebVectorLabel, string> = {
    safe: "保持当前数据路径证据，继续积累真实运行样本。",
    flow_warning: "补齐输入输出契约、返回出口、错误出口和路径断点验证。",
    security_risk: "检查外部输入、权限、命令/SQL/DOM sink，并优先替换为安全 API。",
    stability_risk: "补超时、事务边界、资源释放和异常出口，再用运行样本验证。",
    performance_hotspot: "用 benchmark 比较替代算法、批量策略或缓存策略，确认吞吐和稳定性。",
    repair_candidate: "先在沙箱运行修复配方，测试通过后再提升为高可信样本。",
  };
  return recommendations[(label as DeepWebVectorLabel) in recommendations ? (label as DeepWebVectorLabel) : "flow_warning"];
}

function uniqueLines(lines: Array<string | undefined>) {
  return Array.from(new Set(lines.filter((line): line is string => Boolean(line)).map((line) => shorten(line, 150)))).slice(0, 6);
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

type SoftwareFunctionInsight = {
  id: string;
  name: string;
  technical: string;
  description: string;
  evidence: string;
};

type SoftwareModuleInsight = {
  id: string;
  title: string;
  purpose: string;
  confidence: number;
  evidence: string;
  actions: string[];
  functions: SoftwareFunctionInsight[];
};

type SoftwareFlowInsight = {
  id: string;
  index: number;
  technical: string;
  description: string;
  evidence: string;
};

type SoftwareEvidenceInsight = {
  label: string;
  detail: string;
};

type SoftwareNarrativeBlock = {
  title: string;
  body: string;
};

type SoftwareModuleRule = {
  id: string;
  title: string;
  purpose: string;
  signals: string[];
  fallbackCategories?: string[];
};

const softwareModuleRules: SoftwareModuleRule[] = [
  {
    id: "project_management",
    title: "项目 / 目标管理",
    purpose: "负责创建、删除、读取项目树，并维护项目、阶段、目标之间的层级关系。",
    signals: ["project", "goal", "stage", "tree", "markdown", "workspace", "milestone", "roadmap"],
  },
  {
    id: "task_management",
    title: "任务 / 条目管理",
    purpose: "负责创建、读取、更新、删除、开始、结束和完成具体任务或待办条目。",
    signals: ["task", "todo", "note", "job", "complete", "start", "end", "branch"],
  },
  {
    id: "schedule_time",
    title: "日程 / 排期 / 时间块",
    purpose: "负责根据时间、优先级和可用窗口生成计划，并把任务安排到具体时间段。",
    signals: ["schedule", "calendar", "daily", "routine", "time block", "timeblock", "available minutes", "slot", "due", "overdue"],
  },
  {
    id: "reminder_notification",
    title: "提醒 / 通知",
    purpose: "负责检查即将发生或已经过期的事项，并生成待处理提醒。",
    signals: ["reminder", "notify", "notification", "alert", "pending", "apscheduler", "scheduler", "cron"],
  },
  {
    id: "dashboard_progress",
    title: "Dashboard / 进度 / 日志",
    purpose: "负责汇总状态、进度、积分、活动日志和统计视图。",
    signals: ["dashboard", "progress", "log", "activity", "score", "point", "metric", "stats", "report", "summary"],
  },
  {
    id: "data_persistence",
    title: "数据持久化 / 数据库",
    purpose: "负责数据库查询、写入、事务、模型和本地数据文件读写。",
    signals: ["db", "database", "sqlite", "sql", "sqlalchemy", "orm", "model", "schema", "repository", "crud", "save", "load"],
    fallbackCategories: ["模型"],
  },
  {
    id: "api_backend",
    title: "接口 / 后端控制",
    purpose: "负责接收请求、调度业务函数，并把结果组织成接口响应。",
    signals: ["api", "route", "endpoint", "controller", "handler", "request", "response", "fastapi", "server", "router"],
  },
  {
    id: "frontend_ui",
    title: "前端界面 / 交互",
    purpose: "负责页面状态、表单输入、按钮操作和界面渲染。",
    signals: ["app", "component", "page", "view", "react", "vite", "tauri", "state", "setstate", "form", "button", "ui"],
  },
  {
    id: "file_import_export",
    title: "文件 / 导入导出",
    purpose: "负责读取、解析、生成或导出文件内容。",
    signals: ["file", "files", "import", "export", "upload", "download", "readfile", "writefile", "csv", "json", "markdown"],
  },
  {
    id: "code_analysis",
    title: "代码解析 / 函数流",
    purpose: "负责解析代码结构、抽取函数、建立调用图和数据流。",
    signals: ["parse", "parser", "analyze", "analysis", "ast", "lsp", "tree sitter", "graph", "function", "flow", "hydrology", "code"],
    fallbackCategories: ["解析"],
  },
  {
    id: "runtime_simulation",
    title: "运行 / 仿真 / 沙箱",
    purpose: "负责运行样本、模拟执行路径、收集轨迹和隔离外部进程。",
    signals: ["runtime", "sandbox", "simulate", "simulation", "trace", "test", "process", "subprocess", "execute", "run"],
    fallbackCategories: ["仿真"],
  },
  {
    id: "recommendation_optimization",
    title: "推荐 / 优化 / 算法",
    purpose: "负责评分、排序、推荐、效率比较和算法替代方案选择。",
    signals: ["recommend", "rank", "score", "optimize", "optimization", "algorithm", "benchmark", "calculate", "priority", "filter"],
  },
  {
    id: "security_validation",
    title: "校验 / 权限 / 安全",
    purpose: "负责输入校验、权限边界、异常出口和危险调用检查。",
    signals: ["validate", "validation", "check", "guard", "sanitize", "auth", "permission", "role", "token", "csrf", "security"],
    fallbackCategories: ["校验"],
  },
  {
    id: "hardware_device",
    title: "硬件 / 设备接口",
    purpose: "负责传感器、串口、网络设备或电子元件交互。",
    signals: ["hardware", "device", "sensor", "serial", "gpio", "mqtt", "pwm", "actuator", "relay"],
  },
  {
    id: "business_core",
    title: "核心业务流程",
    purpose: "负责当前项目特有的业务处理，尚未归入更具体模块。",
    signals: ["business", "service", "workflow", "manager", "core"],
    fallbackCategories: ["业务", "构建", "输入"],
  },
];

function buildSoftwareDesignReport(
  files: CodeFile[],
  functions: FunctionInfo[],
  edges: GraphEdge[],
  analysis: WorkspaceAnalysis,
  modules: SoftwareModuleInsight[],
  flow: SoftwareFlowInsight[],
  mainPurpose: string,
  inputSummary: string,
  outputs: string,
  issueSummary: string,
  qualitySummary: string,
): SoftwareNarrativeBlock[] {
  const mainFileName = analysis.mainFile?.name ?? files[0]?.name ?? "未识别文件";
  const entryName = analysis.entryFunction?.name ?? analysis.hydrologyModel.entryName ?? "未识别入口";
  const flowNames = flow.slice(0, 12).map((step) => step.technical.split(" · ")[0]).join(" -> ") || entryName;
  const moduleNarrative = modules
    .map((module) => `${module.title}模块包含 ${module.functions.length} 个函数，${module.purpose}${module.functions.length ? `代表函数有 ${module.functions.slice(0, 8).map((fn) => fn.name).join("、")}。` : ""}`)
    .join("");
  const functionNarrative = modules
    .flatMap((module) =>
      module.functions.map(
        (fn) =>
          `${fn.name}：${stripFunctionPrefix(fn.description, fn.name)}${fn.evidence}`,
      ),
    )
    .join("");

  return [
    {
      title: "设计意图反推",
      body:
        `从代码结构反推，这个项目不是一组零散工具函数，而是围绕“${mainPurpose}”组织起来的软件。` +
        `主控文件 ${mainFileName} 负责把入口、业务处理、数据保存和输出串起来；入口函数 ${entryName} 是当前最像起点的函数。` +
        `它先接收 ${inputSummary}，再把数据交给不同模块处理，最后形成 ${outputs} 这些输出或状态变化。` +
        `这个判断来自文件路径、函数命名、参数类型、返回值、调用边、导入依赖、环境引用和本地规则命中，不是只看某一个关键词。`,
    },
    {
      title: "整体业务能力",
      body:
        `这段代码应该提供的业务能力可以拆成这些部分：${moduleNarrative || "当前函数数量太少，暂时只能看到局部业务能力。"}` +
        `如果把它当成完整软件来理解，用户触发某个入口后，系统会先读入请求、表单、数据库会话或配置，再执行创建、查询、更新、删除、调度、提醒、统计、返回等动作。`,
    },
    {
      title: "主控数据流",
      body:
        `这段代码主要在做“${mainPurpose}”。它大概从 ${entryName} 开始，按 ${flowNames} 的顺序处理数据，最后把结果送到 ${outputs}。` +
        `中间的函数不是孤立执行的：有的负责取得输入，有的负责把输入整理成业务对象，有的负责校验权限、类型或范围，有的负责写数据库或更新状态，` +
        `有的负责计算进度、分数、推荐或排期，有的负责返回接口结果或驱动界面刷新。`,
    },
    {
      title: "函数作用全量说明",
      body:
        functionNarrative ||
        "当前没有足够函数可展开。导入完整文件夹后，这里会按模块列出每个 function 在软件里的职责、输入、输出、上下游和证据。",
    },
    {
      title: "算法与实用设计",
      body: buildAlgorithmDesignNarrative(functions, modules),
    },
    {
      title: "问题与验证边界",
      body:
        `当前优先检查项是 ${issueSummary}；${qualitySummary}` +
        `这些结论仍然是静态代码反推：它能帮助接手者理解设计意图和风险位置，但业务正确性还需要用接口回放、真实输入样本、数据库状态和前端交互测试来验证。`,
    },
  ];
}

function buildSoftwareModules(files: CodeFile[], functions: FunctionInfo[], edges: GraphEdge[], analysis: WorkspaceAnalysis) {
  const stageByFunctionId = new Map(analysis.hydrologyModel.stages.map((stage) => [stage.functionId, stage]));
  const functionById = new Map(functions.map((fn) => [fn.id, fn]));
  const moduleBuckets = new Map<string, { rule: SoftwareModuleRule; score: number; functions: FunctionInfo[] }>();

  functions.forEach((fn) => {
    const scored = softwareModuleRules
      .map((rule) => ({ rule, score: scoreFunctionForModule(fn, rule, files) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0]?.score > 0 ? scored[0] : { rule: softwareModuleRules.at(-1) as SoftwareModuleRule, score: 1 };
    const current = moduleBuckets.get(best.rule.id) ?? { rule: best.rule, score: 0, functions: [] };
    current.score += best.score;
    current.functions.push(fn);
    moduleBuckets.set(best.rule.id, current);
  });

  return Array.from(moduleBuckets.values())
    .sort((a, b) => b.functions.length - a.functions.length || b.score - a.score)
    .map((bucket) => {
      const insights = bucket.functions
        .sort((a, b) => (stageByFunctionId.get(a.id)?.index ?? 9999) - (stageByFunctionId.get(b.id)?.index ?? 9999) || a.startLine - b.startLine)
        .map((fn) => buildSoftwareFunctionInsight(fn, bucket.rule, edges, functionById, stageByFunctionId));
      return {
        id: bucket.rule.id,
        title: bucket.rule.title,
        purpose: buildModulePurpose(bucket.rule, insights),
        confidence: moduleConfidence(bucket.score, insights.length),
        evidence: buildModuleEvidence(bucket.rule, insights),
        actions: buildModuleActions(insights),
        functions: insights,
      };
    });
}

function scoreFunctionForModule(fn: FunctionInfo, rule: SoftwareModuleRule, files: CodeFile[]) {
  const file = files.find((item) => item.id === fn.fileId);
  const text = searchableFunctionText(fn, file);
  const nameText = splitIdentifier(fn.name);
  const pathText = splitIdentifier(fn.fileName);
  const signalScore = rule.signals.reduce((score, signal) => {
    const term = signal.toLowerCase();
    if (containsSignal(nameText, term)) return score + 14;
    if (containsSignal(pathText, term)) return score + 3;
    if (containsSignal(text, term)) return score + 2;
    return score;
  }, 0);
  const categoryScore = rule.fallbackCategories?.includes(fn.category) ? 4 : 0;
  const domainPenalty = rule.id === "data_persistence" && hasBusinessDomainSignal(nameText) ? 8 : 0;
  const securityPenalty = rule.id === "security_validation" && !hasSecurityNameSignal(nameText) ? 5 : 0;
  return Math.max(0, signalScore + categoryScore - domainPenalty - securityPenalty);
}

function searchableFunctionText(fn: FunctionInfo, file?: CodeFile) {
  return [
    fn.name,
    splitIdentifier(fn.name),
    fn.fileName,
    splitIdentifier(fn.fileName),
    fn.language,
    fn.summary,
    fn.category,
    fn.returnType,
    fn.dataShape,
    fn.params.join(" "),
    fn.outputs.join(" "),
    fn.sideEffects.join(" "),
    fn.externalInputs.join(" "),
    fn.validations.join(" "),
    fn.risks.join(" "),
    fn.calls.join(" "),
    file?.imports?.join(" "),
    file?.environmentRefs?.join(" "),
    file?.deviceRefs?.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function containsSignal(text: string, signal: string) {
  if (!signal.trim()) return false;
  return text.includes(signal);
}

function hasBusinessDomainSignal(text: string) {
  return /\b(project|goal|stage|task|todo|note|daily|routine|schedule|time\s*block|timeblock|reminder|dashboard|progress|score)\b/.test(text);
}

function hasSecurityNameSignal(text: string) {
  return /\b(validate|check|ensure|guard|auth|permission|role|token|session|csrf|security)\b/.test(text);
}

function splitIdentifier(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildSoftwareFunctionInsight(
  fn: FunctionInfo,
  rule: SoftwareModuleRule,
  edges: GraphEdge[],
  functionById: Map<string, FunctionInfo>,
  stageByFunctionId: Map<string, WorkspaceAnalysis["hydrologyModel"]["stages"][number]>,
): SoftwareFunctionInsight {
  const downstream = edges
    .filter((edge) => edge.from === fn.id)
    .map((edge) => functionById.get(edge.to)?.name ?? edge.to)
    .filter(Boolean)
    .slice(0, 4);
  const upstream = edges
    .filter((edge) => edge.to === fn.id)
    .map((edge) => functionById.get(edge.from)?.name ?? edge.from)
    .filter(Boolean)
    .slice(0, 3);
  const stage = stageByFunctionId.get(fn.id);
  const action = inferFunctionAction(fn, rule);
  const inputText = summarizeFunctionInputs(fn);
  const outputText = summarizeFunctionOutputs(fn);
  const callText = downstream.length ? `会把数据交给 ${downstream.join("、")}` : "当前没有识别到明确下游函数";
  const upstreamText = upstream.length ? `上游来自 ${upstream.join("、")}` : "可能是入口、事件回调或独立工具函数";
  const guardText = fn.validations.length ? `保护动作：${fn.validations.join("、")}` : "保护动作：未识别到明显校验";
  const sideEffectText = fn.sideEffects.length ? `副作用：${fn.sideEffects.join("、")}` : "副作用：主要通过返回值或内部结果继续传递";
  const riskText = fn.risks.length ? `风险提示：${uniquePhrases(fn.risks).join("、")}` : "风险提示：暂未命中高置信风险";

  return {
    id: fn.id,
    name: fn.name,
    technical: `${fn.fileName}:${fn.startLine} · ${fn.parser ?? fn.source} · complexity ${fn.complexity} · ${fn.dataShape}`,
    description:
      `${fn.name} 属于“${rule.title}”模块，主要负责${action}。` +
      `输入是 ${inputText}；输出是 ${outputText}；${upstreamText}，${callText}。` +
      `${guardText}；${sideEffectText}；${riskText}。`,
    evidence: `证据：函数名、文件路径、参数/返回、调用边${stage ? `、数据流角色 ${stage.codeRole}/${flowRoleLabel(stage.waterRole)}` : ""}。`,
  };
}

function inferFunctionAction(fn: FunctionInfo, rule: SoftwareModuleRule) {
  const words = splitIdentifier(fn.name);
  const target = inferFunctionTarget(words, rule.title);
  if (/\b(create|add|new|insert)\b/.test(words)) return `创建${target}`;
  if (/\b(delete|remove|destroy)\b/.test(words)) return `删除${target}`;
  if (/\b(update|edit|patch|set)\b/.test(words)) return `更新${target}`;
  if (/\b(get|list|load|fetch|read|query|find)\b/.test(words)) return `读取或查询${target}`;
  if (/\b(start|begin|run|execute)\b/.test(words)) return `启动或执行${target}`;
  if (/\b(end|finish|complete|close)\b/.test(words)) return `结束或完成${target}`;
  if (/\b(mark|acknowledge|confirm)\b/.test(words)) return `标记或确认${target}`;
  if (/\b(parse|convert|normalize|transform)\b/.test(words)) return `解析、转换或整理${target}`;
  if (/\b(validate|check|ensure|guard)\b/.test(words)) return `校验${target}的边界和合法性`;
  if (/\b(build|generate|render)\b/.test(words)) return `生成或组装${target}`;
  if (/\b(calculate|score|rank|recommend|filter)\b/.test(words)) return `计算、筛选或推荐${target}`;
  if (/\b(schedule|plan|assign)\b/.test(words)) return `安排${target}进入计划或时间段`;
  return `处理${target}相关业务步骤`;
}

function inferFunctionTarget(words: string, fallbackTitle: string) {
  const dictionary: Array<[RegExp, string]> = [
    [/\bproject\b|\btree\b/, "项目/项目树"],
    [/\bgoal\b|\bstage\b/, "目标/阶段"],
    [/\btask\b|\btodo\b|\bjob\b/, "任务"],
    [/\bnote\b/, "笔记/记录"],
    [/\bdaily\b|\broutine\b/, "日常任务"],
    [/\btime\s*block\b|\btimeblock\b|\bslot\b/, "时间块"],
    [/\bschedule\b|\bcalendar\b/, "排期"],
    [/\breminder\b|\bnotification\b|\balert\b/, "提醒"],
    [/\bdashboard\b/, "Dashboard 数据"],
    [/\bprogress\b|\blog\b|\bactivity\b/, "进度/日志"],
    [/\buser\b|\bauth\b|\bsession\b|\btoken\b/, "用户/权限"],
    [/\bfile\b|\bmarkdown\b|\bjson\b|\bcsv\b/, "文件内容"],
    [/\bgraph\b|\bflow\b|\bfunction\b|\bparser\b|\bcode\b/, "代码结构/函数流"],
    [/\bruntime\b|\bsandbox\b|\btrace\b|\bprocess\b/, "运行轨迹"],
  ];
  return dictionary.find(([pattern]) => pattern.test(words))?.[1] ?? fallbackTitle.replace(/\s*\/\s*/g, "/");
}

function summarizeFunctionInputs(fn: FunctionInfo) {
  const values = uniquePhrases([...fn.params, ...fn.externalInputs]).slice(0, 5);
  return values.length ? values.join("、") : "隐式上下文、组件状态或内部变量";
}

function summarizeFunctionOutputs(fn: FunctionInfo) {
  const values = uniquePhrases([...fn.outputs.map(cleanOutputPhrase), fn.returnType && fn.returnType !== "void" ? fn.returnType : undefined]).slice(0, 5);
  return values.length ? values.join("、") : "状态变化、void 或下游副作用";
}

function cleanOutputPhrase(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  if (/^\d+$/.test(trimmed)) return "";
  if (/^\[[^\]]+/.test(trimmed)) return "列表结果";
  if (/^\{.+/.test(trimmed)) return "结构化对象";
  if (/^['"`].+['"`]$/.test(trimmed)) return "固定文本/常量结果";
  return trimmed;
}

function buildModulePurpose(rule: SoftwareModuleRule, functions: SoftwareFunctionInsight[]) {
  const sampleActions = functions.slice(0, 4).map((fn) => functionActionText(fn.description));
  if (!sampleActions.length) return rule.purpose;
  return `${rule.purpose} 当前命中的主要动作包括：${sampleActions.join("、")}。`;
}

function functionActionText(description: string) {
  const match = description.match(/主要负责(.+?)。/);
  return match?.[1] ?? "处理业务步骤";
}

function moduleConfidence(score: number, functionCount: number) {
  return clampScore(Math.round(52 + Math.min(38, score / Math.max(1, functionCount)) + Math.min(10, functionCount)));
}

function buildModuleEvidence(rule: SoftwareModuleRule, functions: SoftwareFunctionInsight[]) {
  const sampleFunctions = functions.slice(0, 5).map((fn) => fn.name).join("、");
  return `命中模块规则“${rule.title}”；证据函数：${sampleFunctions || "暂无"}。`;
}

function buildModuleActions(functions: SoftwareFunctionInsight[]) {
  return uniquePhrases(functions.map((fn) => functionActionText(fn.description))).slice(0, 6).map((action) => `${action}`);
}

function buildSoftwareMainFlow(
  analysis: WorkspaceAnalysis,
  functions: FunctionInfo[],
  modules: SoftwareModuleInsight[],
): SoftwareFlowInsight[] {
  const moduleByFunctionId = new Map(modules.flatMap((featureModule) => featureModule.functions.map((fn) => [fn.id, featureModule] as const)));
  const functionById = new Map(functions.map((fn) => [fn.id, fn]));
  if (analysis.hydrologyModel.stages.length) {
    return analysis.hydrologyModel.stages.map((stage, index) => {
      const fn = functionById.get(stage.functionId);
      const featureModule = moduleByFunctionId.get(stage.functionId);
      return {
        id: stage.id,
        index: index + 1,
        technical: `${stage.functionName} · ${stage.codeRole} · ${stage.fileName}:${stage.line}`,
        description:
          `${stage.functionName} 在主流程中承担“${stage.codeRole}”角色，数据流图里对应“${flowRoleLabel(stage.waterRole)}”。` +
          `${featureModule ? `它属于“${featureModule.title}”模块。` : ""}` +
          `输入数据：${stage.dataIn.length ? stage.dataIn.join("、") : summarizeFunctionInputs(fn ?? fallbackFunction(stage))}；` +
          `输出数据：${stage.dataOut.length ? stage.dataOut.join("、") : summarizeFunctionOutputs(fn ?? fallbackFunction(stage))}。` +
          `${humanizeHydrologyStage(stage.codeRole)}`,
        evidence: `证据：处理阶段 ${stage.index + 1}、上下游 ${stage.upstreamCount}/${stage.downstreamCount}、置信度 ${stage.confidence}%。`,
      };
    });
  }

  return functions.map((fn, index) => {
    const featureModule = moduleByFunctionId.get(fn.id);
    return {
      id: fn.id,
      index: index + 1,
      technical: `${fn.name} · ${fn.fileName}:${fn.startLine} · complexity ${fn.complexity}`,
      description: `${fn.name} ${featureModule ? `属于“${featureModule.title}”模块，` : ""}${fn.summary}`,
      evidence: `证据：函数顺序来自文件扫描和本地 ParserAdapter。`,
    };
  });
}

function fallbackFunction(stage: WorkspaceAnalysis["hydrologyModel"]["stages"][number]): FunctionInfo {
  return {
    id: stage.functionId,
    name: stage.functionName,
    fileId: stage.fileName,
    fileName: stage.fileName,
    language: "",
    startLine: stage.line,
    endLine: stage.line,
    params: stage.dataIn,
    returnType: "unknown",
    outputs: stage.dataOut,
    calls: [],
    summary: stage.evidence,
    dataShape: "unknown",
    complexity: 1,
    category: "业务",
    body: "",
    sideEffects: [],
    externalInputs: [],
    validations: [],
    risks: [],
    source: "Heuristic",
    confidence: stage.confidence,
  };
}

function buildSoftwareEvidenceSources(
  files: CodeFile[],
  functions: FunctionInfo[],
  edges: GraphEdge[],
  analysis: WorkspaceAnalysis,
  modules: SoftwareModuleInsight[],
): SoftwareEvidenceInsight[] {
  const parsers = uniquePhrases(functions.map((fn) => fn.parser ?? fn.source));
  const imports = uniquePhrases(files.flatMap((file) => file.imports ?? [])).slice(0, 8);
  const envRefs = uniquePhrases(files.flatMap((file) => file.environmentRefs ?? [])).slice(0, 6);
  return [
    { label: "入口证据", detail: `${analysis.entryFunction?.name ?? "未识别"} · ${analysis.mainFile?.name ?? "未识别主控文件"}` },
    { label: "解析器证据", detail: parsers.join("、") || "LocalHeuristicParser" },
    { label: "调用图证据", detail: `${functions.length} 个函数、${edges.length} 条调用边、${analysis.hydrologyModel.stageCount} 个处理阶段` },
    { label: "模块证据", detail: modules.map((module) => `${module.title} ${module.functions.length}`).join("、") || "暂无模块归纳" },
    { label: "依赖/环境证据", detail: [...imports, ...envRefs].slice(0, 10).join("、") || "未识别显式依赖或环境引用" },
    { label: "规则证据", detail: `${analysis.knowledgeRuleReport.matches.length} 条本地规则命中，${analysis.issues.length} 个问题候选` },
  ];
}

function stripFunctionPrefix(description: string, name: string) {
  return description.replace(new RegExp(`^${escapeRegExp(name)}\\s+属于“[^”]+”模块，`), "");
}

function buildAlgorithmDesignNarrative(functions: FunctionInfo[], modules: SoftwareModuleInsight[]) {
  const text = `${functions.map((fn) => `${fn.name} ${fn.summary} ${fn.body}`).join(" ")} ${modules.map((module) => module.title).join(" ")}`.toLowerCase();
  const moduleIds = new Set(modules.map((module) => module.id));
  const sentences: string[] = [];

  if (moduleIds.has("project_management") || /\b(project|goal|stage|tree|markdown)\b/.test(text)) {
    sentences.push("项目/目标相关代码体现的是层级树设计：项目作为根节点，目标或阶段作为中间层，任务作为叶子节点；树结构适合用递归、父子 id、聚合完成率来维护。");
  }
  if (moduleIds.has("task_management") || /\b(task|complete|start|end|branch)\b/.test(text)) {
    sentences.push("任务相关代码体现的是状态机设计：任务会在创建、开始、结束、完成、错过、分支等状态之间流转，因此需要记录时间、状态、备注、积分和日志。");
  }
  if (moduleIds.has("schedule_time") || /\b(schedule|available_minutes|time_block|timeblock|priority|queue|slot)\b/.test(text)) {
    sentences.push("排期相关代码体现的是约束分配算法：它会把可用时间、任务优先级、预计时长、已存在时间块和分支任务放在一起做匹配，更像贪心排程、队列分配或优先级排序。");
  }
  if (moduleIds.has("recommendation_optimization") || /\b(recommend|rank|score|filter|priority|difficulty)\b/.test(text)) {
    sentences.push("推荐相关代码体现的是评分/过滤模型：先按可用时间、难度、优先级或上下文过滤候选，再计算分数并排序，目标是推荐当前最适合执行的任务或数据项。");
  }
  if (moduleIds.has("reminder_notification") || /\b(reminder|pending|overdue|scheduler|apscheduler|cron)\b/.test(text)) {
    sentences.push("提醒相关代码体现的是定时扫描设计：系统定期检查即将开始、已经过期、未完成或需要确认的事项，再把它们写成待处理提醒。");
  }
  if (moduleIds.has("dashboard_progress") || /\b(dashboard|progress|activity|log|metric|stats)\b/.test(text)) {
    sentences.push("Dashboard 和 Progress 相关代码体现的是聚合统计设计：它把任务、项目、目标、时间块、日志和积分汇总成今日状态、完成率、进度树和活动记录。");
  }
  if (moduleIds.has("data_persistence") || /\b(db|sqlite|sqlalchemy|session|commit|query)\b/.test(text)) {
    sentences.push("数据库相关代码体现的是 CRUD 和事务边界设计：业务函数通过 Session 查询、创建、更新和删除记录，正确性依赖提交、回滚、关系维护和异常出口。");
  }
  if (moduleIds.has("frontend_ui") || /\b(react|component|state|setstate|form|button)\b/.test(text)) {
    sentences.push("前端相关代码体现的是状态驱动界面设计：组件保存输入框、列表、选中项和加载结果，通过调用后端接口刷新页面状态。");
  }
  if (moduleIds.has("api_backend") || /\b(api|route|endpoint|fastapi|request|response)\b/.test(text)) {
    sentences.push("接口相关代码体现的是控制器设计：路由层负责接收请求，调用 CRUD/服务函数，然后把数据库对象或业务结果整理成响应。");
  }
  if (moduleIds.has("code_analysis") || /\b(parse|ast|graph|flow|function|hydrology)\b/.test(text)) {
    sentences.push("代码解析相关代码体现的是图模型设计：先抽取函数节点，再根据调用关系建立边，最后用图遍历、数据流角色和风险规则解释数据从入口到输出的路径。");
  }
  if (moduleIds.has("runtime_simulation") || /\b(sandbox|runtime|trace|subprocess|process|simulate)\b/.test(text)) {
    sentences.push("运行仿真相关代码体现的是沙箱回放设计：它把输入样本送入隔离进程或模拟轨迹，观察输出、异常、阻塞和资源使用情况。");
  }
  if (moduleIds.has("security_validation") || /\b(validate|auth|permission|token|sanitize|csrf)\b/.test(text)) {
    sentences.push("安全与校验相关代码体现的是边界保护设计：外部输入进入业务前需要类型、权限、范围、SQL/命令/路径等危险出口检查。");
  }

  if (!sentences.length) {
    sentences.push("当前代码主要体现顺序业务编排：入口函数接收输入，多个内部函数依次加工数据，最后通过返回值、状态写入或接口响应输出结果。");
  }

  return sentences.join("");
}

function summarizeFunctionCategories(functions: FunctionInfo[]) {
  const counts = functions.reduce<Record<string, number>>((acc, fn) => {
    acc[fn.category] = (acc[fn.category] ?? 0) + 1;
    return acc;
  }, {});
  const entries = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([category, count]) => `${category} ${count} 个`);
  return entries.length ? entries.join("、") : "暂未识别明确职责";
}

function summarizeInputs(files: CodeFile[], functions: FunctionInfo[]) {
  const functionInputs = uniquePhrases(functions.flatMap((fn) => [...fn.params, ...fn.externalInputs]));
  const imports = uniquePhrases(files.flatMap((file) => file.imports ?? []));
  const envRefs = uniquePhrases(files.flatMap((file) => file.environmentRefs ?? []));
  const parts = [
    functionInputs.length ? `函数参数/外部输入（${functionInputs.slice(0, 5).join("、")}）` : "",
    imports.length ? `依赖库（${imports.slice(0, 4).join("、")}）` : "",
    envRefs.length ? `环境配置（${envRefs.slice(0, 3).join("、")}）` : "",
  ].filter(Boolean);
  return parts.length ? parts.join("、") : "代码里的隐式上下文和内部变量";
}

function summarizeIssues(analysis: WorkspaceAnalysis) {
  const titles = uniquePhrases(analysis.issues.map((issue) => issue.title));
  if (!titles.length) return "暂无高置信问题";
  return titles.slice(0, 4).join("、");
}

function summarizeQualitySignals(analysis: WorkspaceAnalysis) {
  const scores = [
    `闭合度 ${analysis.closureScore}%`,
    `安全边界 ${analysis.damScore}%`,
    `环境完整度 ${analysis.environmentScore}%`,
  ];
  const riskHint = analysis.hydrologyModel.riskCount
    ? `数据流模型还标出 ${analysis.hydrologyModel.riskCount} 个风险路径，需要点开节点或连接查看证据。`
    : "数据流模型暂未标出高风险路径，可以继续补运行样本验证。";
  return `${scores.join("、")}。${riskHint}`;
}

function uniquePhrases(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function inferSoftwarePurpose(modules: SoftwareModuleInsight[], functions: FunctionInfo[], analysis: WorkspaceAnalysis) {
  const text = `${functions.map((fn) => `${fn.name} ${fn.summary} ${fn.category}`).join(" ")} ${analysis.hydrologyModel.summary}`.toLowerCase();
  const moduleIds = new Set(modules.map((module) => module.id));
  const functionNameText = splitIdentifier(functions.map((fn) => fn.name).join(" "));
  const hasTaskDomain = moduleIds.has("task_management") || /\b(task|todo|note|daily|routine|reminder|schedule|goal)\b/.test(functionNameText);
  const hasProjectSuite = moduleIds.has("project_management") || /\b(project|goal|stage|tree)\b/.test(functionNameText);
  const hasAuthNameSignals = /\b(user|auth|login|logout|session|token|permission|role)\b/.test(functionNameText);
  const hasCodeAnalysisNameSignals = /\b(parse|analyze|analysis|graph|flow|function|code|parser|runtime|sandbox|hydrology)\b/.test(functionNameText);
  if (moduleIds.has("code_analysis") && hasCodeAnalysisNameSignals) {
    return "解析代码、建立函数图和数据流，并检查运行、稳定性或安全风险";
  }
  if ((hasProjectSuite || hasTaskDomain) && hasTaskDomain) {
    return "管理项目、目标、任务、日程排期、提醒和进度数据";
  }
  if (moduleIds.has("code_analysis") && (moduleIds.has("runtime_simulation") || moduleIds.has("security_validation"))) {
    return "解析代码、建立函数图和数据流，并检查运行、稳定性或安全风险";
  }
  if (moduleIds.has("hardware_device")) return "连接硬件设备、读取外部信号，并把数据送入业务或控制流程";
  if (moduleIds.has("frontend_ui") && moduleIds.has("api_backend")) return "通过前端界面和后端接口协同完成业务数据处理";
  if (moduleIds.has("data_persistence") && moduleIds.has("api_backend")) return "围绕数据库和接口完成业务数据的读取、写入和响应";
  if (hasAuthNameSignals) return "处理用户身份、权限和会话";
  if (/task|schedule|reminder|daily|goal|todo/.test(text)) return "管理项目、任务、提醒或日程数据";
  if (/parse|analyze|graph|flow|function|code|parser|runtime|sandbox|hydrology/.test(text)) return "解析代码、建立函数图和数据流";
  if (/crud|create|update|delete|query|database|sqlite|sql/.test(text)) return "读写数据库并完成增删改查流程";
  if (/request|api|route|server|controller|handler/.test(text)) return "接收请求并调度后端业务流程";
  const topModules = modules.slice(0, 3).map((module) => module.title);
  if (topModules.length) return `围绕${topModules.join("、")}组织主要业务流程`;
  return "接收输入、调用函数处理数据，并返回或保存结果";
}

// Kept temporarily for workspace snapshot migration; the active explanation
// pipeline lives in src/lib/explanation/software-explanation.ts.
void [
  buildSoftwareDesignReport,
  buildSoftwareModules,
  buildSoftwareMainFlow,
  buildSoftwareEvidenceSources,
  summarizeFunctionCategories,
  summarizeInputs,
  summarizeIssues,
  summarizeQualitySignals,
  inferSoftwarePurpose,
];

function humanizeHydrologyStage(role: string) {
  const descriptions: Record<string, string> = {
    主控入口: "程序从这里开始组织主要流程。",
    入参采集: "这里负责接收或读取外部传入的数据。",
    净化过滤: "这里检查数据是否合法、安全、符合预期。",
    转换处理: "这里把输入加工成后续函数需要的形态。",
    分流调度: "这里根据条件把数据送往不同分支。",
    汇聚合并: "这里把多个来源的数据合并成一个结果。",
    容量存储: "这里会缓存、保存或批量承载数据。",
    结果输出: "这里把处理结果返回、写入或发送出去。",
    异常边界: "这里处理失败、异常或兜底出口。",
  };
  return descriptions[role] ?? "这里负责当前流程中的一个处理步骤。";
}

function createWorkspaceProject(
  files: CodeFile[],
  source: WorkspaceProjectSource,
  preferredName?: string,
): WorkspaceProject {
  const timestamp = Date.now();
  const name = preferredName?.trim() || inferProjectName(files, source);
  const id = `${source}-${simpleHash(`${name}-${timestamp}-${files.map((file) => file.hash ?? file.name).join("|")}`)}`;
  return {
    id,
    name,
    files: files.map((file) => ({ ...file, id: `${id}:${file.id}` })),
    source,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function inferProjectName(files: CodeFile[], source: WorkspaceProjectSource) {
  const names = files.map((file) => file.name).filter(Boolean);
  const firstPath = names.find((name) => name.includes("/")) ?? names[0];
  const root = firstPath?.split("/").filter(Boolean)[0];
  if (root && !root.includes(".")) return root;
  if (source === "draft") return names[0] ? `草稿项目 ${names[0]}` : "草稿项目";
  if (source === "folder") return "导入文件夹项目";
  if (source === "files") return names[0] ? `文件集合 ${names[0].split("/").pop()}` : "文件集合项目";
  return "示例项目";
}

function inferProjectNameFromInput(incomingFiles: File[], parsedFiles: CodeFile[], source: WorkspaceProjectSource) {
  const folderRoot = incomingFiles
    .map((file) => ("webkitRelativePath" in file ? String(file.webkitRelativePath) : ""))
    .find((path) => path.includes("/"))
    ?.split("/")
    .filter(Boolean)[0];
  return folderRoot || inferProjectName(parsedFiles, source);
}

function projectSourceLabel(source: WorkspaceProjectSource) {
  const labels: Record<WorkspaceProjectSource, string> = {
    sample: "示例",
    folder: "文件夹",
    files: "多文件",
    draft: "草稿",
  };
  return labels[source];
}

function projectLanguageSummary(files: CodeFile[]) {
  const summary = files.reduce<Record<string, number>>((acc, file) => {
    acc[file.language] = (acc[file.language] ?? 0) + 1;
    return acc;
  }, {});
  const text = Object.entries(summary)
    .sort((a, b) => b[1] - a[1])
    .map(([language, count]) => `${language} ${count}`)
    .join("、");
  return text || "未知语言";
}

function projectUpdatedLabel(project: WorkspaceProject) {
  if (project.updatedAt === 0) return "内置示例";
  return new Date(project.updatedAt).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildFileSummaries(
  files: CodeFile[],
  functions: FunctionInfo[],
  declarations: TypeDeclarationInfo[],
  analysis: WorkspaceAnalysis,
) {
  return files.map((file) => {
    const fileFunctions = functions.filter((fn) => fn.fileId === file.id || fn.fileName === file.name);
    const fileDeclarations = declarations.filter((item) => item.fileId === file.id || item.fileName === file.name);
    const fileIssues = analysis.issues.filter((issue) => issue.evidence.includes(file.name) || issue.message.includes(file.name));
    const roles = uniquePhrases([
      ...fileFunctions.map((fn) => fn.category),
      ...fileDeclarations.map((item) => item.role),
    ]).slice(0, 5);
    return {
      id: file.id,
      name: file.name,
      language: file.language,
      functions: fileFunctions,
      declarations: fileDeclarations,
      issueCount: fileIssues.length,
      roles,
      size: file.size ?? file.content.length,
    };
  });
}

function traceBreakpointImpactIds(breakpoints: Set<string>, edges: GraphEdge[]) {
  const affected = new Set<string>();
  const queue = [...breakpoints];
  const visited = new Set(queue);
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    edges.filter((edge) => edge.from === current).forEach((edge) => {
      if (visited.has(edge.to)) return;
      visited.add(edge.to);
      affected.add(edge.to);
      queue.push(edge.to);
    });
  }
  return affected;
}

function normalizedIssueGroupTitle(title: string) {
  const normalized = title.trim().toLocaleLowerCase().replace(/[\s_-]+/g, " ");
  if (/sql\s*注入(?:水路|路径|风险)?/i.test(normalized)) return "sql 注入风险";
  if (/命令(?:执行|注入)(?:水路|路径|风险)?/i.test(normalized)) return "命令执行风险";
  if (/路径穿越/.test(normalized)) return "路径穿越风险";
  return normalized;
}

function issueCategoryLabel(category: string) {
  return ({
    flow: "数据路径",
    security: "安全",
    environment: "运行环境",
    performance: "性能",
    quality: "代码质量",
  } as Record<string, string>)[category] ?? category;
}

function experimentConclusion(status: string, claimStatus: string) {
  if (status === "阻塞") return "实验未完成：运行被阻止，需要先解决运行条件。";
  if (status === "风险") return claimStatus === "已验证" ? "实验确认存在风险，需要处理后重新验证。" : "实验观察到风险信号，但证据尚不足以定案。";
  if (status === "通过") return claimStatus === "已验证" ? "实验通过，并已有可回放证据。" : "当前结果正常，但还需要真实运行证据确认。";
  if (status === "等待执行") return "尚未执行，当前内容只是实验计划，不是结果。";
  return claimStatus === "未证明" ? "当前只有分析线索，尚不能得出确定结论。" : "已取得观察结果，仍需结合证据判断。";
}

function runtimeCostStatusLabel(status: "comfortable" | "acceptable" | "strained" | "unknown") {
  return status === "comfortable" ? "余量充足" : status === "acceptable" ? "可以运行" : status === "strained" ? "资源紧张" : "待测本机";
}

function runtimeFailureExplanation(status: string, stderr: string, compileOutput: string) {
  if (status !== "failed" && status !== "rejected" && status !== "unavailable") return "本次运行已完成，没有进程级失败。";
  const evidence = `${stderr}\n${compileOutput}`;
  if (/ERR_MODULE_NOT_FOUND|Cannot find module|ModuleNotFoundError|No module named/i.test(evidence)) {
    return "失败原因：隔离副本中缺少项目依赖，或当前文件不是可独立运行的程序入口。请准备锁文件对应的本地依赖，并选择 main、index、app、server 等真实入口后重试。";
  }
  if (/command not found|No such file or directory|ENOENT/i.test(evidence)) return "失败原因：当前语言运行器或入口文件不存在。请在设置页检查本机工具链，再重新选择入口。";
  if (/timed out|timeout|SIGKILL/i.test(evidence)) return "失败原因：程序超过受控运行时限，已被沙箱终止。请检查阻塞、死循环或等待外部服务的代码。";
  if (/Permission denied|Operation not permitted|sandbox/i.test(evidence)) return "失败原因：程序尝试访问沙箱禁止的网络、目录或系统能力。该限制是本地安全策略的一部分。";
  return `失败原因：进程以失败状态结束。${stderr.trim().split("\n").find(Boolean) ?? compileOutput.trim().split("\n").find(Boolean) ?? "没有返回可解析的错误文本。"}`;
}

function flowRoleLabel(value: string) {
  const labels: Record<string, string> = {
    水源: "输入节点",
    管道: "处理节点",
    阀门: "验证节点",
    水箱: "状态/缓存节点",
    泵: "异步调度节点",
    排水口: "输出节点",
    分流口: "分支节点",
    堵塞: "阻塞风险",
    溢流: "容量风险",
    回流: "循环/回边",
    主河道: "主路径",
    "分岔溪口": "分支节点",
    "溪流汇聚口": "汇聚节点",
    "湖泊/水库": "集合/缓存节点",
  };
  return labels[value] ?? productTerminology(value);
}

function capacityLabel(value: string) {
  const labels: Record<string, string> = {
    小溪: "轻量传递",
    河道: "常规传递",
    水池: "有界缓冲",
    水库: "固定集合",
    湖: "大型集合/缓存",
  };
  return labels[value] ?? productTerminology(value);
}

function statusLabelForProduct(value: string) {
  const labels: Record<string, string> = {
    Closed: "路径完整",
    "Partially Closed": "部分完整",
    Open: "路径不完整",
    Blocked: "执行阻塞",
    "Overflow Risk": "容量风险",
  };
  return labels[value] ?? productTerminology(value);
}

function productTerminology(value: string) {
  return value
    .replaceAll("水流法", "数据流分析")
    .replaceAll("水文图", "数据流图")
    .replaceAll("水系图", "数据流图")
    .replaceAll("函数水系", "函数数据流")
    .replaceAll("主河道", "主路径")
    .replaceAll("水路", "数据路径")
    .replaceAll("流域", "模块域")
    .replaceAll("堤坝", "安全边界")
    .replaceAll("溢流", "容量超限")
    .replaceAll("阀门", "验证节点")
    .replaceAll("水源", "输入节点")
    .replaceAll("排水口", "输出节点")
    .replaceAll("湖泊/水库", "集合/缓存节点")
    .replaceAll("湖水", "数据容量")
    .replaceAll("回流", "循环路径")
    .replaceAll("堵塞", "阻塞");
}

function NarrativeText({ text, className = "" }: { text: string; className?: string }) {
  const sentences = (productTerminology(text).match(/[^。！？]+[。！？]?/g) ?? [text])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const paragraphs: string[] = [];
  for (let index = 0; index < sentences.length; index += 2) {
    paragraphs.push(sentences.slice(index, index + 2).join(""));
  }
  return (
    <div className={`narrative-text ${className}`.trim()}>
      {paragraphs.map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>)}
    </div>
  );
}

export default function Home() {
  const [projects, setProjects] = useState<WorkspaceProject[]>([sampleWorkspaceProject]);
  const [activeProjectId, setActiveProjectId] = useState(sampleWorkspaceProject.id);
  const [draftCode, setDraftCode] = useState(sampleFiles[0].content);
  const [draftName, setDraftName] = useState("scratch.ts");
  const [graphMode, setGraphMode] = useState<GraphMode>("water");
  const [workspacePage, setWorkspacePage] = useState<WorkspacePage>("map");
  const navigationMode = useSyncExternalStore(subscribeNavigationMode, getNavigationMode, () => "standard");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedWaterId, setSelectedWaterId] = useState<string | null>(null);
  const [projectBreakpoints, setProjectBreakpoints] = useState<Record<string, string[]>>({});
  const [projectStoreLoaded, setProjectStoreLoaded] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [projectActionMessage, setProjectActionMessage] = useState("项目操作会自动保存到本地数据库。");
  const [removedProject, setRemovedProject] = useState<WorkspaceProject | null>(null);
  const [projectStoreReport, setProjectStoreReport] = useState<WorkspaceProjectStoreReport>(() =>
    buildWorkspaceProjectStoreUnavailableReport(),
  );
  const [indexedDbReport, setIndexedDbReport] = useState<DeepWebIndexedDbSyncReport>(() =>
    buildDeepWebIndexedDbUnavailableReport(),
  );
  const [indexedDbExportMessage, setIndexedDbExportMessage] = useState("等待导出 DeepWeb 本地快照。");
  const [opfsSqliteReport, setOpfsSqliteReport] = useState<DeepWebOpfsSqliteReport>(() =>
    buildDeepWebOpfsSqliteUnavailableReport(),
  );
  const [opfsSqliteExportMessage, setOpfsSqliteExportMessage] = useState("等待导出可查询 SQLite 数据库。");
  const [nativeSqliteReport, setNativeSqliteReport] = useState<NativeSqliteReport>(() =>
    buildNativeSqliteUnavailableReport(),
  );
  const [deepWebBaseline, setDeepWebBaseline] = useState<DeepWebModelBaseline | null>(null);
  const [knowledgePackReport, setKnowledgePackReport] = useState<KnowledgePackStatusReport>(() =>
    buildKnowledgePackWebPreviewReport(),
  );
  const [knowledgePackBusy, setKnowledgePackBusy] = useState(false);
  const [knowledgePackMessage, setKnowledgePackMessage] = useState("等待检查本地知识包。" );
  const [supplementalKnowledge, setSupplementalKnowledge] = useState<SupplementalKnowledgeReport | null>(null);
  const [networkPolicy, setNetworkPolicyReport] = useState<NetworkPolicyReport>(() => buildNetworkPolicyWebPreview());
  const [networkPolicyBusy, setNetworkPolicyBusy] = useState(false);
  const [dependencyKnowledgeReport, setDependencyKnowledgeReport] = useState<ProjectKnowledgeMatchReport>({
    status: "web-preview", activePackId: null, dependencyCount: 0, confirmedCount: 0, reviewCount: 0, matches: [], evidence: [],
  });
  const [runtimeAvailability, setRuntimeAvailability] = useState<ControlledRuntimeAvailabilityReport>(() =>
    buildRuntimeWebPreviewReport(),
  );
  const [systemCapacity, setSystemCapacity] = useState<SystemCapacityReport>(() => buildSystemCapacityWebPreview());
  const [importedExtensionAdapters, setImportedExtensionAdapters] = useState<ImportedExtensionAdapter[]>([]);
  const [extensionImportMessage, setExtensionImportMessage] = useState("可以导入声明式扩展包；可执行 sidecar 仍需签名安装。" );
  const [lspSidecars, setLspSidecars] = useState<LspSidecarStatusReport>(() =>
    buildLspSidecarWebPreviewReport(),
  );
  const [debugAvailability, setDebugAvailability] = useState<DebugAvailability>(() =>
    buildUnavailableDebugAvailability(),
  );
  const [debugSession, setDebugSession] = useState<DebugSession | null>(null);
  const [debugBreakpointLine, setDebugBreakpointLine] = useState(1);
  const [debugBusy, setDebugBusy] = useState(false);
  const [debugMessage, setDebugMessage] = useState("尚未启动桌面调试会话。");
  const [runtimeAdapter, setRuntimeAdapter] = useState<ControlledRuntimeAdapter>(() => recommendedRuntimeAdapter(sampleFiles));
  const [runtimeEntry, setRuntimeEntry] = useState(() =>
    recommendedRuntimeEntry(sampleFiles, recommendedRuntimeAdapter(sampleFiles)),
  );
  const [runtimeStdin, setRuntimeStdin] = useState("");
  const [runtimeRunning, setRuntimeRunning] = useState(false);
  const [runtimeMessage, setRuntimeMessage] = useState("尚未执行当前项目。");
  const [selectedIntegratedTests, setSelectedIntegratedTests] = useState<IntegratedTestId[]>(["functional", "smoke", "regression", "integration", "performance", "load"]);
  const [integratedTestProgress, setIntegratedTestProgress] = useState<SuiteProgress>(idleSuiteProgress);
  const [selectedTwinExperiments, setSelectedTwinExperiments] = useState<TwinExperimentSelection[]>(["静态分析", "动态仿真", "压力测试", "容错传播", "安全攻击"]);
  const [twinSuiteProgress, setTwinSuiteProgress] = useState<SuiteProgress>(idleSuiteProgress);
  const [securityAssertions, setSecurityAssertions] = useState<SecurityAssertionResult[]>([]);
  const [securityAssertionMessage, setSecurityAssertionMessage] = useState("尚未运行权限、身份和污染攻击断言。");
  const [runtimeCertificationRuns, setRuntimeCertificationRuns] = useState<ControlledRuntimeExecutionReport[]>([]);
  const [projectRuntimeExecutions, setProjectRuntimeExecutions] = useState<Record<string, ControlledRuntimeExecutionReport[]>>({});
  const [projectFormalProofs, setProjectFormalProofs] = useState<Record<string, FormalVerificationRecord[]>>({});
  const [formalBusy, setFormalBusy] = useState(false);
  const [formalMessage, setFormalMessage] = useState("尚未运行本地形式化策略证明。");
  const [repairFileName, setRepairFileName] = useState(sampleFiles[0].name);
  const [repairOriginalCode, setRepairOriginalCode] = useState("");
  const [repairSuggestedCode, setRepairSuggestedCode] = useState("");
  const [repairReason, setRepairReason] = useState("根据诊断证据生成的确定性修复建议");
  const [repairResult, setRepairResult] = useState<RepairCandidateExperiment | null>(null);
  const [repairApproval, setRepairApproval] = useState<RepairApproval | null>(null);
  const [repairRollbacks, setRepairRollbacks] = useState<Record<string, RepairRollbackSnapshot>>({});
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairMessage, setRepairMessage] = useState("先载入精确代码片段，再生成候选 Diff。描述型配方不会直接修改源码。");
  const [reportExportMessage, setReportExportMessage] = useState("PDF 将在本机生成，不上传报告内容。");
  const [projectUsabilityChecks, setProjectUsabilityChecks] = useState<Record<string, string[]>>({});
  const [functionSearch, setFunctionSearch] = useState("");
  const [reportIncludeDetails, setReportIncludeDetails] = useState(true);
  const [mapDefaultSpacing, setMapDefaultSpacing] = useState(145);
  const [mapDefaultZoom, setMapDefaultZoom] = useState(72);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setReportIncludeDetails(window.localStorage.getItem("codeflow.report.includeDetails") !== "false");
      setMapDefaultSpacing(Number(window.localStorage.getItem("codeflow.map.spacing")) || 145);
      setMapDefaultZoom(Number(window.localStorage.getItem("codeflow.map.zoom")) || 72);
      try {
        setProjectUsabilityChecks(JSON.parse(window.localStorage.getItem("codeflow.usability-checks") ?? "{}"));
      } catch {
        setProjectUsabilityChecks({});
      }
      setImportedExtensionAdapters(loadImportedExtensionAdapters());
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    inspectSystemCapacity().then((report) => {
      if (!cancelled) setSystemCapacity(report);
    });
    return () => { cancelled = true; };
  }, []);
  const runtimeCertification = useMemo(
    () => buildControlledRuntimeCertification(runtimeAvailability, runtimeCertificationRuns),
    [runtimeAvailability, runtimeCertificationRuns],
  );
  const replaySnapshotPayload = useSyncExternalStore(
    subscribeDeepWebReplayMemory,
    getDeepWebReplaySnapshotPayload,
    () => "[]",
  );

  function changeNavigationMode(mode: NavigationMode) {
    window.localStorage.setItem("codeflow-navigation-mode", mode);
    window.dispatchEvent(new Event(navigationModeEvent));
  }
  const sqliteJournalPayload = useSyncExternalStore(
    subscribeDeepWebSqliteJournal,
    getDeepWebSqliteJournalPayload,
    () => "[]",
  );

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? sampleWorkspaceProject;
  const visibleProjects = useMemo(() => {
    const query = projectSearch.trim().toLocaleLowerCase();
    if (!query) return projects;
    return projects.filter((project) =>
      [project.name, projectSourceLabel(project.source), projectLanguageSummary(project.files)]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [projectSearch, projects]);
  const files = activeProject.files;
  const breakpoints = useMemo(
    () => new Set(projectBreakpoints[activeProject.id] ?? []),
    [activeProject.id, projectBreakpoints],
  );
  const runtimeExecutions = useMemo(
    () => projectRuntimeExecutions[activeProject.id] ?? [],
    [activeProject.id, projectRuntimeExecutions],
  );
  const formalProofs = useMemo(
    () => projectFormalProofs[activeProject.id] ?? [],
    [activeProject.id, projectFormalProofs],
  );
  const baseParseResult = useMemo(() => parseWorkspace(files), [files]);
  const [enhancedParseState, setEnhancedParseState] = useState<{
    base: WorkspaceParseResult;
    result: WorkspaceParseResult;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    matchProjectDependencies(files)
      .then((report) => {
        if (!cancelled) setDependencyKnowledgeReport(report);
      })
      .catch((error: unknown) => {
        if (!cancelled) setDependencyKnowledgeReport({
          status: "no-active-pack", activePackId: null, dependencyCount: 0, confirmedCount: 0, reviewCount: 0, matches: [],
          evidence: [error instanceof Error ? error.message : "依赖知识匹配失败。"],
        });
      });
    return () => {
      cancelled = true;
    };
  }, [files, knowledgePackReport.activePackId]);

  useEffect(() => {
    let cancelled = false;
    inspectNetworkPolicy()
      .then((report) => {
        if (!cancelled) setNetworkPolicyReport(report);
      })
      .catch(() => {
        if (!cancelled) setNetworkPolicyReport(buildNetworkPolicyWebPreview());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function changeNetworkPolicy(enabled: boolean) {
    setNetworkPolicyBusy(true);
    try {
      setNetworkPolicyReport(await setNetworkPolicy(enabled));
      setKnowledgePackMessage(enabled
        ? "本次会话已授权官方知识源公网出口；本机/内网 IPC 与公网仍隔离，项目代码不能继承权限。"
        : "公网总闸已关闭；本机与内网 IPC 保持可用，但不能桥接或代理到公网。" );
    } catch (error) {
      setKnowledgePackMessage(error instanceof Error ? error.message : "网络策略切换失败。" );
    } finally {
      setNetworkPolicyBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    inspectKnowledgePacks()
      .then((report) => {
        if (!cancelled) {
          setKnowledgePackReport(report);
          setKnowledgePackMessage(report.status === "web-preview" ? "请在 Tauri 桌面程序中管理知识包。" : "本地知识包状态已读取。" );
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setKnowledgePackMessage(error instanceof Error ? error.message : "知识包状态读取失败。" );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runKnowledgePackAction(action: () => Promise<KnowledgePackStatusReport>, success: string) {
    setKnowledgePackBusy(true);
    setKnowledgePackMessage("正在执行知识包质量门，请不要关闭程序。" );
    try {
      const report = await action();
      setKnowledgePackReport(report);
      setKnowledgePackMessage(report.status === "web-preview" ? "请在 Tauri 桌面程序中执行此操作。" : success);
    } catch (error) {
      setKnowledgePackMessage(error instanceof Error ? error.message : "知识包操作失败。" );
    } finally {
      setKnowledgePackBusy(false);
    }
  }

  async function importSupplementalKnowledge(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file || knowledgePackBusy) return;
    setKnowledgePackBusy(true);
    setKnowledgePackMessage("正在校验补充知识证据包并写入隔离区。" );
    try {
      const report = await importSupplementalKnowledgeBundle(await file.text());
      setSupplementalKnowledge(report);
      setKnowledgePackMessage(`补充证据包已隔离：${report.recordCount} 条记录。检查来源后再激活。`);
    } catch (error) {
      setKnowledgePackMessage(error instanceof Error ? error.message : "补充知识证据包导入失败。" );
    } finally {
      setKnowledgePackBusy(false);
    }
  }

  async function activateSupplementalKnowledge() {
    if (!supplementalKnowledge || knowledgePackBusy) return;
    setKnowledgePackBusy(true);
    try {
      const report = await activateSupplementalKnowledgeBundle(supplementalKnowledge.bundleId);
      setSupplementalKnowledge(report);
      setKnowledgePackMessage(`补充知识证据包签名与逐记录哈希重放通过，已激活 ${report.recordCount} 条记录。`);
    } catch (error) {
      setKnowledgePackMessage(error instanceof Error ? error.message : "补充知识证据包激活失败。" );
    } finally {
      setKnowledgePackBusy(false);
    }
  }

  async function importExtensionAdapter(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setExtensionImportMessage("正在校验扩展声明、禁止字段和 SHA-256。" );
    try {
      const imported = await importExtensionAdapterFile(file);
      setImportedExtensionAdapters(loadImportedExtensionAdapters());
      setExtensionImportMessage(`${imported.name} ${imported.version} 已注册；健康检查通过后才能连接实际实现。`);
    } catch (error) {
      setExtensionImportMessage(error instanceof Error ? error.message : "扩展声明导入失败。" );
    }
  }

  function removeExtensionAdapter(packageId: string) {
    removeImportedExtensionAdapter(packageId);
    setImportedExtensionAdapters(loadImportedExtensionAdapters());
    setExtensionImportMessage("扩展声明已从本机注册表移除，内置分析能力未受影响。" );
  }

  useEffect(() => {
    let cancelled = false;
    async function runNativeImportChain() {
      try {
        const astReport = await parseWorkspaceWithNativeAst(files);
        const astResult = mergeNativeAstReport(files, baseParseResult, astReport);
        if (!cancelled) {
          setEnhancedParseState({
            base: baseParseResult,
            result: astResult,
          });
        }
        if (!astReport) return;
        const compilerReport = await parseWorkspaceWithNativeTypeScriptCompiler(files);
        const compilerResult = mergeNativeTypeScriptCompilerReport(
          files,
          astResult,
          compilerReport,
        );
        if (!cancelled) {
          setEnhancedParseState({
            base: baseParseResult,
            result: compilerResult,
          });
        }
        const lspReport = await parseWorkspaceWithNativeLsp(
          activeProject.id,
          files,
          astReport,
        );
        if (!cancelled) {
          setEnhancedParseState({
            base: baseParseResult,
            result: mergeNativeLspReport(compilerResult, lspReport),
          });
        }
      } catch (error) {
        if (cancelled) return;
        setEnhancedParseState({
          base: baseParseResult,
          result: {
            ...baseParseResult,
            report: {
              ...baseParseResult.report,
              enhancement: {
                status: "unavailable",
                source: "TauriTreeSitterWorkspaceParser + LSP",
                mergedFunctions: 0,
                addedFunctions: 0,
                addedEdges: 0,
                confidenceGain: 0,
                evidence:
                  error instanceof Error
                    ? error.message
                    : "Native AST/LSP import chain failed.",
                next: "保留候选扫描结果并检查桌面解析服务。",
              },
            },
          },
        });
      }
    }
    void runNativeImportChain();
    return () => {
      cancelled = true;
    };
  }, [activeProject.id, baseParseResult, files]);
  const parseResult =
    enhancedParseState?.base === baseParseResult
      ? enhancedParseState.result
      : baseParseResult;
  const functions = parseResult.functions;
  const declarations = parseResult.declarations;
  const edges = parseResult.edges;
  const analysis = useMemo(
    () => analyzeWorkspace(files, functions, edges, breakpoints, runtimeExecutions, deepWebBaseline, formalProofs),
    [files, functions, edges, breakpoints, runtimeExecutions, deepWebBaseline, formalProofs],
  );
  const runtimeCost = useMemo(() => buildRuntimeCostReport({
    fileCount: files.length,
    functionCount: functions.length,
    edgeCount: edges.length,
    sourceBytes: files.reduce((sum, file) => sum + new TextEncoder().encode(file.content).byteLength, 0),
    runs: runtimeExecutions,
    host: systemCapacity,
  }), [edges.length, files, functions.length, runtimeExecutions, systemCapacity]);
  const extensionAdapters = useMemo(() => [
    ...new Map(
      [...localExtensionAdapters, ...importedExtensionAdapters.map((item) => item.adapter)]
        .map((adapter) => [adapter.id, adapter]),
    ).values(),
  ], [importedExtensionAdapters]);
  const softwareTestReport = useMemo(() => buildSoftwareTestReport({
    files,
    functions,
    issues: analysis.issues,
    experiments: analysis.digitalTwin.experiments,
    runtimeExecutions,
    usabilityPassedIds: projectUsabilityChecks[activeProject.id] ?? [],
    projectUpdatedAt: activeProject.updatedAt,
    repair: repairResult?.experiment ? {
      status: repairResult.experiment.status,
      evidence: repairResult.experiment.evidence,
    } : null,
  }), [activeProject.id, activeProject.updatedAt, analysis.digitalTwin.experiments, analysis.issues, files, functions, projectUsabilityChecks, repairResult, runtimeExecutions]);

  function toggleUsabilityCheck(checkId: string) {
    setProjectUsabilityChecks((current) => {
      const selected = new Set(current[activeProject.id] ?? []);
      if (selected.has(checkId)) selected.delete(checkId);
      else selected.add(checkId);
      const next = { ...current, [activeProject.id]: [...selected] };
      window.localStorage.setItem("codeflow.usability-checks", JSON.stringify(next));
      return next;
    });
  }
  const issueGroupCount = useMemo(
    () => new Set(analysis.issues.map((issue) => `${issue.category}:${normalizedIssueGroupTitle(issue.title)}`)).size,
    [analysis.issues],
  );
  const groupedIssueReport = useMemo(() => {
    const groups = new Map<string, { title: string; category: string; severity: string; confidence: number; locations: string[]; messages: string[] }>();
    analysis.issues.forEach((issue) => {
      const title = normalizedIssueGroupTitle(issue.title);
      const key = `${issue.category}:${title}`;
      const existing = groups.get(key) ?? { title, category: issue.category, severity: issue.severity, confidence: issue.confidence, locations: [], messages: [] };
      existing.confidence = Math.max(existing.confidence, issue.confidence);
      existing.locations.push(issue.evidence);
      existing.messages.push(issue.message);
      groups.set(key, existing);
    });
    return [...groups.values()];
  }, [analysis.issues]);
  const breakpointImpactIds = useMemo(
    () => traceBreakpointImpactIds(breakpoints, edges),
    [breakpoints, edges],
  );
  const currentReplaySnapshot = useMemo(
    () => buildDeepWebReplaySnapshot(files, analysis),
    [files, analysis],
  );
  const replaySnapshots = useMemo(
    () => parseDeepWebReplaySnapshotsPayload(replaySnapshotPayload),
    [replaySnapshotPayload],
  );
  const replayMemoryReport = useMemo(
    () => buildDeepWebReplayMemoryReport(currentReplaySnapshot, replaySnapshots),
    [currentReplaySnapshot, replaySnapshots],
  );
  const sqliteJournalRows = useMemo(
    () => parseDeepWebSqliteJournalPayload(sqliteJournalPayload),
    [sqliteJournalPayload],
  );
  const currentDeepWebSqliteRows = useMemo(
    () => buildDeepWebSqliteJournalRows(replayMemoryReport, analysis.semanticIndex.deepDatabase.deepWeb),
    [analysis.semanticIndex.deepDatabase.deepWeb, replayMemoryReport],
  );
  const sqliteJournalPreviewRows = useMemo(
    () => {
      const currentKeys = new Set(currentDeepWebSqliteRows.map((row) => `${row.tableName}:${row.primaryKey}`));
      return [
        ...currentDeepWebSqliteRows,
        ...sqliteJournalRows.filter((row) => !currentKeys.has(`${row.tableName}:${row.primaryKey}`)),
      ];
    },
    [currentDeepWebSqliteRows, sqliteJournalRows],
  );
  const sqliteJournalReport = useMemo(
    () => buildDeepWebSqliteJournalReport(sqliteJournalPreviewRows, replayMemoryReport),
    [sqliteJournalPreviewRows, replayMemoryReport],
  );
  const workspaceProjectSqliteRows = useMemo(
    () => buildWorkspaceProjectSqliteRows(projects, activeProjectId),
    [activeProjectId, projects],
  );
  const softwareInterpretation = useMemo(
    () => buildSoftwareInterpretation(files, functions, edges, analysis),
    [files, functions, edges, analysis],
  );
  const nativeCodeIndexRows = useMemo(
    () => buildNativeCodeIndexSqliteRows(activeProject, functions, edges, parseResult.report, analysis),
    [activeProject, analysis, edges, functions, parseResult.report],
  );
  const fileSummaries = useMemo(
    () => buildFileSummaries(files, functions, declarations, analysis),
    [files, functions, declarations, analysis],
  );
  const projectStoreMessage = projectStoreLoaded
    ? `${projectStoreReport.storageMode} · ${projectStoreReport.status} · ${projectStoreReport.projectCount} 项目 / ${projectStoreReport.fileCount} 文件。${projectStoreReport.evidence}`
    : "项目库等待本地程序数据库挂载。";

  const runtimeEntryOptions = useMemo(() => {
    const patterns: Record<ControlledRuntimeAdapter, RegExp> = {
      node: /\.(mjs|cjs|js|mts|cts|ts)$/i,
      python: /\.py$/i,
      rust: /\.rs$/i,
      java: /\.java$/i,
      c: /\.c$/i,
      cpp: /\.(cc|cpp|cxx)$/i,
    };
    const excluded = /(^|\/)(eslint|vite|vitest|jest|next|postcss|tailwind|webpack|rollup|babel|prettier)\.config\.|(^|\/)(build|setup|conftest)\.[^/]+$|\.(test|spec)\.[^/]+$/i;
    return files.filter((file) => patterns[runtimeAdapter].test(file.name) && !excluded.test(file.name));
  }, [files, runtimeAdapter]);

  const selectedFunction =
    functions.find((fn) => fn.id === selectedId) ?? analysis.entryFunction ?? functions[0] ?? null;
  const graphNodes = useMemo(
    () => layoutGraph(functions, edges, graphMode, analysis),
    [functions, edges, graphMode, analysis],
  );
  const graphCanvasSize = useMemo(() => ({
    width: Math.max(1220, ...graphNodes.map((node) => node.x + 250)),
    height: Math.max(660, ...graphNodes.map((node) => node.y + 150)),
  }), [graphNodes]);
  const selectedTrace = useMemo(
    () => buildTrace(selectedFunction, functions, edges, breakpoints),
    [selectedFunction, functions, edges, breakpoints],
  );
  const selectedWaterNode =
    analysis.flowNodes.find((node) => node.id === selectedWaterId) ?? null;
  const deepWebBindings = useMemo(
    () => buildWaterDeepWebBindings(analysis.flowNodes, analysis.flowEdges, analysis.semanticIndex.deepDatabase.deepWeb),
    [analysis.flowNodes, analysis.flowEdges, analysis.semanticIndex.deepDatabase.deepWeb],
  );

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      loadNativeWorkspaceProjectStore()
        .then((nativeStore) => nativeStore ?? loadWorkspaceProjectStore())
        .then((stored) => {
          if (cancelled) return;
          if (stored?.projects.length) {
            setProjects(stored.projects);
            const restoredProject =
              stored.projects.find((project) => project.id === stored.activeProjectId) ?? stored.projects[0];
            const adapter = recommendedRuntimeAdapter(restoredProject.files);
            setActiveProjectId(restoredProject.id);
            setWorkspacePage(readProjectPage(restoredProject.id));
            setRuntimeAdapter(adapter);
            setRuntimeEntry(recommendedRuntimeEntry(restoredProject.files, adapter));
          }
          setProjectStoreLoaded(true);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setProjectStoreReport(
            buildWorkspaceProjectStoreUnavailableReport(
              error instanceof Error ? error.message : "本地程序项目数据库恢复失败。",
            ),
          );
          setProjectStoreLoaded(true);
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadNativeDeepWebModelBaseline()
      .then((baseline) => {
        if (!cancelled) {
          setDeepWebBaseline((current) => (current?.id === baseline?.id ? current : baseline));
        }
      })
      .catch(() => {
        if (!cancelled) setDeepWebBaseline(null);
      });
    return () => {
      cancelled = true;
    };
  }, [nativeSqliteReport.lastSyncedAt]);

  useEffect(() => {
    let cancelled = false;
    inspectLspSidecars()
      .then((report) => {
        if (!cancelled) setLspSidecars(report);
      })
      .catch(() => {
        if (!cancelled) setLspSidecars(buildLspSidecarWebPreviewReport());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    inspectControlledRuntimeTools()
      .then((report) => {
        if (!cancelled) setRuntimeAvailability(report);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRuntimeAvailability({
            ...buildRuntimeWebPreviewReport(),
            status: "unavailable",
            evidence: error instanceof Error ? error.message : "本机运行工具链检测失败。",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    inspectDebugAvailability()
      .then((report) => {
        if (!cancelled) setDebugAvailability(report);
      })
      .catch(() => {
        if (!cancelled) setDebugAvailability(buildUnavailableDebugAvailability());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!projectStoreLoaded) return;
    let cancelled = false;
    saveWorkspaceProjectStore(projects, activeProjectId)
      .then((report) => {
        if (!cancelled) setProjectStoreReport(report);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setProjectStoreReport(
            buildWorkspaceProjectStoreUnavailableReport(
              error instanceof Error ? error.message : "本地程序项目数据库保存失败。",
            ),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, projectStoreLoaded, projects]);

  useEffect(() => {
    saveDeepWebReplaySnapshot(currentReplaySnapshot);
  }, [currentReplaySnapshot]);

  useEffect(() => {
    syncDeepWebSqliteJournal(replayMemoryReport);
  }, [replayMemoryReport]);

  useEffect(() => {
    let cancelled = false;
    syncDeepWebIndexedDbJournal(sqliteJournalPreviewRows)
      .then((report) => {
        if (!cancelled) setIndexedDbReport(report);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setIndexedDbReport(
            buildDeepWebIndexedDbUnavailableReport(error instanceof Error ? error.message : "IndexedDB sync failed"),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sqliteJournalPreviewRows]);

  useEffect(() => {
    let cancelled = false;
    syncDeepWebOpfsSqliteDatabase(sqliteJournalPreviewRows)
      .then((report) => {
        if (!cancelled) setOpfsSqliteReport(report);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setOpfsSqliteReport(
            buildDeepWebOpfsSqliteUnavailableReport(error instanceof Error ? error.message : "sql.js/OPFS SQLite sync failed"),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sqliteJournalPreviewRows]);

  useEffect(() => {
    let cancelled = false;
    syncNativeSqliteWriters({
      workspaceRows: workspaceProjectSqliteRows,
      deepWebRows: sqliteJournalPreviewRows,
      codeIndexRows: nativeCodeIndexRows,
    })
      .then((report) => {
        if (!cancelled) setNativeSqliteReport(report);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setNativeSqliteReport(
            buildNativeSqliteUnavailableReport(error instanceof Error ? error.message : "native SQLite sync failed"),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [nativeCodeIndexRows, sqliteJournalPreviewRows, workspaceProjectSqliteRows]);

  const languageSummary = useMemo(() => {
    return files.reduce<Record<string, number>>((acc, file) => {
      acc[file.language] = (acc[file.language] ?? 0) + 1;
      return acc;
    }, {});
  }, [files]);

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const incomingFiles = Array.from(event.target.files ?? []);
    event.currentTarget.value = "";
    if (!incomingFiles.length) return;

    setProjectActionMessage(`正在分批读取 ${incomingFiles.length} 个文件，项目内容不会被截断。`);
    readCodeFiles(incomingFiles, (progress) => {
      const percent = progress.totalBytes
        ? Math.round((progress.completedBytes / progress.totalBytes) * 100)
        : Math.round((progress.completedFiles / Math.max(1, progress.totalFiles)) * 100);
      setProjectActionMessage(`正在导入完整项目：${progress.completedFiles}/${progress.totalFiles} 文件 · ${percent}%`);
    })
      .then((nextFiles) => {
        const parsedFiles = nextFiles.length ? nextFiles : sampleFiles;
        const source = incomingFiles.some((file) => ("webkitRelativePath" in file ? String(file.webkitRelativePath) : "").includes("/")) ? "folder" : "files";
        addProject(parsedFiles, source, inferProjectNameFromInput(incomingFiles, parsedFiles, source));
      })
      .catch((error: unknown) => {
        setProjectActionMessage(error instanceof Error ? error.message : "项目读取失败，未写入本地数据库。");
      });
  }

  function analyzeDraft() {
    const content = draftCode.trim();
    if (!content) return;

    const file: CodeFile = {
      id: `draft-${simpleHash(`${draftName}-${content}`)}`,
      name: draftName || "scratch.txt",
      language: detectLanguage(draftName, content),
      content,
      size: content.length,
      hash: simpleHash(content),
    };
    addProject([file], "draft", `草稿项目 ${file.name}`);
  }

  function addProject(nextFiles: CodeFile[], source: WorkspaceProjectSource, preferredName?: string) {
    const project = createWorkspaceProject(nextFiles, source, preferredName);
    setProjects((current) => [project, ...current]);
    setActiveProjectId(project.id);
    saveProjectPage(project.id, "projects");
    setWorkspacePage("projects");
    setSelectedId(null);
    setSelectedWaterId(null);
    const adapter = recommendedRuntimeAdapter(project.files);
    setRuntimeAdapter(adapter);
    setRuntimeEntry(recommendedRuntimeEntry(project.files, adapter));
    setRuntimeStdin("");
    setRuntimeMessage("尚未执行当前项目。");
  }

  function activateProject(projectId: string) {
    const project = projects.find((candidate) => candidate.id === projectId);
    setActiveProjectId(projectId);
    setSelectedId(null);
    setSelectedWaterId(null);
    setWorkspacePage(readProjectPage(projectId));
    if (project) {
      const adapter = recommendedRuntimeAdapter(project.files);
      setRuntimeAdapter(adapter);
      setRuntimeEntry(recommendedRuntimeEntry(project.files, adapter));
      setRuntimeStdin("");
      setRuntimeMessage((projectRuntimeExecutions[project.id] ?? []).length ? "已恢复当前项目的本次会话执行记录。" : "尚未执行当前项目。");
    }
  }

  function deleteProject(projectId: string) {
    if (projects.length <= 1) return;
    const removed = projects.find((project) => project.id === projectId) ?? null;
    const nextProjects = projects.filter((project) => project.id !== projectId);
    setProjects(nextProjects.length ? nextProjects : [sampleWorkspaceProject]);
    if (projectId === activeProjectId) {
      const fallback = nextProjects[0] ?? sampleWorkspaceProject;
      setActiveProjectId(fallback.id);
      setSelectedId(null);
      setSelectedWaterId(null);
      const adapter = recommendedRuntimeAdapter(fallback.files);
      setRuntimeAdapter(adapter);
      setRuntimeEntry(recommendedRuntimeEntry(fallback.files, adapter));
      setRuntimeStdin("");
      setRuntimeMessage("尚未执行当前项目。");
    }
    setProjectBreakpoints((current) => {
      const next = { ...current };
      delete next[projectId];
      return next;
    });
    setRemovedProject(removed);
    setProjectActionMessage(removed ? `已移除“${removed.name}”，在离开项目中心前可以撤销。` : "项目已移除。");
  }

  function restoreRemovedProject() {
    if (!removedProject) return;
    setProjects((current) => [removedProject, ...current.filter((project) => project.id !== removedProject.id)]);
    setActiveProjectId(removedProject.id);
    setRemovedProject(null);
    setProjectActionMessage(`已恢复“${removedProject.name}”。`);
  }

  function navigateWorkspacePage(page: WorkspacePage) {
    if (page === "inspect" && graphMode !== "water" && graphMode !== "calls") setGraphMode("water");
    saveProjectPage(activeProject.id, page);
    setWorkspacePage(page);
  }

  function beginProjectRename(project: WorkspaceProject) {
    setRenamingProjectId(project.id);
    setProjectNameDraft(project.name);
  }

  function commitProjectRename(projectId: string) {
    const name = projectNameDraft.trim().slice(0, 120);
    if (!name) return;
    setProjects((current) => current.map((project) => (
      project.id === projectId ? { ...project, name, updatedAt: Date.now() } : project
    )));
    setRenamingProjectId(null);
    setProjectActionMessage(`项目已重命名为“${name}”。`);
  }

  function duplicateProject(project: WorkspaceProject) {
    const copy = createWorkspaceProject(project.files, project.source, `${project.name} · 副本`);
    setProjects((current) => [copy, ...current]);
    setActiveProjectId(copy.id);
    setProjectActionMessage(`已创建“${copy.name}”，原项目保持不变。`);
  }

  function exportProjectBackup() {
    try {
      const backup = exportWorkspaceProjectBackup(projects, activeProject.id);
      downloadTextFile(`codeflow-workspace-${backup.exportedAt}.json`, JSON.stringify(backup, null, 2));
      setProjectActionMessage(`已导出 ${backup.projects.length} 个项目的完整性校验备份。`);
    } catch (error) {
      setProjectActionMessage(error instanceof Error ? error.message : "项目备份导出失败。");
    }
  }

  async function importProjectBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const backup = parseWorkspaceProjectBackup(await file.text());
      const restored = backup.projects.map((project) =>
        createWorkspaceProject(project.files, project.source, `${project.name} · 恢复`),
      );
      setProjects((current) => [...restored, ...current]);
      setActiveProjectId(restored[0].id);
      const adapter = recommendedRuntimeAdapter(restored[0].files);
      setRuntimeAdapter(adapter);
      setRuntimeEntry(recommendedRuntimeEntry(restored[0].files, adapter));
      setProjectActionMessage(`完整性校验通过，已安全合并恢复 ${restored.length} 个项目；现有项目没有被覆盖。`);
    } catch (error) {
      setProjectActionMessage(error instanceof Error ? error.message : "项目备份恢复失败。");
    }
  }

  function toggleBreakpoint(id: string) {
    setProjectBreakpoints((current) => {
      const next = new Set(current[activeProject.id] ?? []);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { ...current, [activeProject.id]: Array.from(next) };
    });
  }

  function clearReplayMemory() {
    clearDeepWebReplaySnapshots();
  }

  function clearSqliteJournal() {
    clearDeepWebSqliteJournal();
  }

  function clearIndexedDbStore() {
    clearDeepWebIndexedDbJournal()
      .then(setIndexedDbReport)
      .catch((error: unknown) => {
        setIndexedDbReport(
          buildDeepWebIndexedDbUnavailableReport(error instanceof Error ? error.message : "IndexedDB clear failed"),
        );
      });
  }

  function clearOpfsSqliteStore() {
    clearDeepWebOpfsSqliteDatabase()
      .then((report) => {
        setOpfsSqliteReport(report);
        setOpfsSqliteExportMessage(report.evidence);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "sql.js/OPFS SQLite clear failed";
        setOpfsSqliteReport(buildDeepWebOpfsSqliteUnavailableReport(message));
        setOpfsSqliteExportMessage(message);
      });
  }

  function clearNativeSqliteStore() {
    clearNativeSqliteDatabase()
      .then(setNativeSqliteReport)
      .catch((error: unknown) => {
        setNativeSqliteReport(
          buildNativeSqliteUnavailableReport(error instanceof Error ? error.message : "native SQLite clear failed"),
        );
      });
  }

  function runCurrentProject() {
    if (!runtimeEntry || runtimeRunning) return;
    setRuntimeRunning(true);
    setRuntimeMessage("正在临时项目副本中执行；超时会自动终止。");
    executeControlledRuntime(
      activeProject.id,
      activeProject.name,
      files,
      runtimeAdapter,
      runtimeEntry,
      runtimeStdin,
    )
      .then((report) => {
        setProjectRuntimeExecutions((current) => ({
          ...current,
          [activeProject.id]: [...(current[activeProject.id] ?? []), report].slice(-20),
        }));
        setRuntimeMessage(
          `${report.evidenceGrade} · ${report.status} · ${report.durationMs}ms · 退出码 ${report.exitCode ?? "无"}`,
        );
      })
      .catch((error: unknown) => {
        setRuntimeMessage(error instanceof Error ? error.message : "受控执行失败。");
      })
      .finally(() => setRuntimeRunning(false));
  }

  function appendRuntimeEvidence(report: ControlledRuntimeExecutionReport, limit = 120) {
    setProjectRuntimeExecutions((current) => ({
      ...current,
      [activeProject.id]: [...(current[activeProject.id] ?? []), report].slice(-limit),
    }));
  }

  async function runIntegratedTestSuite() {
    if (runtimeRunning || integratedTestProgress.running) return;
    if (runtimeAvailability.status === "web-preview" || !runtimeEntry) {
      setIntegratedTestProgress({
        running: false,
        completed: 0,
        total: selectedIntegratedTests.length,
        current: "无法启动",
        message: runtimeAvailability.status === "web-preview" ? "真实集成测试只能在桌面程序中运行。" : "当前项目没有可执行入口。",
        updatedAt: Date.now(),
      });
      return;
    }
    const selected = integratedTestOptions.filter((option) => selectedIntegratedTests.includes(option.id));
    if (!selected.length) {
      setIntegratedTestProgress({ ...idleSuiteProgress, message: "请至少勾选一种测试。", updatedAt: Date.now() });
      return;
    }
    const testEntry = files.find((file) => /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[^.]+$/i.test(file.name))?.name;
    setRuntimeRunning(true);
    setIntegratedTestProgress({ running: true, completed: 0, total: selected.length, current: selected[0].label, message: "正在准备受控项目副本。", updatedAt: Date.now() });
    let completed = 0;
    const notes: string[] = [];
    try {
      for (const option of selected) {
        setIntegratedTestProgress((current) => ({ ...current, current: option.label, message: `正在处理 ${option.label}。`, updatedAt: Date.now() }));
        if (option.mode === "manual") {
          const checked = projectUsabilityChecks[activeProject.id]?.length ?? 0;
          notes.push(`${option.label}：人工验收 ${checked}/${usabilityChecklist.length}`);
        } else if (option.mode === "candidate") {
          notes.push(`${option.label}：${repairResult?.experiment ? repairResult.experiment.status : "缺少候选 A/B 结果"}`);
        } else if (option.id === "regression" && !testEntry) {
          notes.push("回归测试：缺少自动化测试入口，已记录为阻塞");
        } else {
          const sampleCount = option.id === "load" ? 5 : option.id === "performance" ? 3 : 1;
          for (let index = 0; index < sampleCount; index += 1) {
            setIntegratedTestProgress((current) => ({ ...current, message: sampleCount > 1 ? `${option.label}样本 ${index + 1}/${sampleCount}` : `执行 ${option.label}`, updatedAt: Date.now() }));
            const kind = option.id === "performance" || option.id === "load" ? "stress" as const : "baseline" as const;
            const report = await executeControlledRuntime(
              activeProject.id,
              activeProject.name,
              files,
              runtimeAdapter,
              option.id === "regression" && testEntry ? testEntry : runtimeEntry,
              runtimeStdin,
              { experimentKind: kind, sampleId: `integrated-${option.id}-${Date.now()}-${index + 1}`, repetition: 1 },
            );
            appendRuntimeEvidence(report);
            notes.push(`${option.label} ${index + 1}/${sampleCount}：${report.status}`);
          }
        }
        completed += 1;
        setIntegratedTestProgress((current) => ({ ...current, completed, message: `${option.label} 已完成或已记录缺失条件。`, updatedAt: Date.now() }));
      }
      setRuntimeMessage(`集成测试入口完成 ${completed}/${selected.length}；结果已刷新到测试页和 PDF 报告。`);
      setIntegratedTestProgress({ running: false, completed, total: selected.length, current: "全部处理完成", message: notes.slice(-4).join("；"), updatedAt: Date.now() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "集成测试执行失败。";
      setRuntimeMessage(message);
      setIntegratedTestProgress((current) => ({ ...current, running: false, completed, current: "执行中断", message, updatedAt: Date.now() }));
    } finally {
      setRuntimeRunning(false);
    }
  }

  async function runSelectedTwinExperiments(experimentIds = selectedTwinExperiments) {
    if (runtimeRunning || twinSuiteProgress.running) return;
    const selected = twinExperimentOptions.filter((option) => experimentIds.includes(option.id));
    if (!selected.length) {
      setTwinSuiteProgress({ ...idleSuiteProgress, message: "请至少勾选一种孪生实验。", updatedAt: Date.now() });
      return;
    }
    if (selected.some((option) => option.mode === "runtime") && (runtimeAvailability.status === "web-preview" || !runtimeEntry)) {
      setTwinSuiteProgress({ running: false, completed: 0, total: selected.length, current: "无法启动真实实验", message: runtimeAvailability.status === "web-preview" ? "真实实验只能在桌面程序中运行。" : "当前项目没有可执行入口。", updatedAt: Date.now() });
      return;
    }
    setRuntimeRunning(true);
    setTwinSuiteProgress({ running: true, completed: 0, total: selected.length, current: selected[0].id, message: "正在刷新孪生证据。", updatedAt: Date.now() });
    let completed = 0;
    try {
      for (const option of selected) {
        setTwinSuiteProgress((current) => ({ ...current, current: option.id, message: `正在处理 ${option.id}。`, updatedAt: Date.now() }));
        if (option.mode === "model") {
          await Promise.resolve();
        } else if (option.mode === "candidate") {
          if (!repairResult?.experiment) {
            setTwinSuiteProgress((current) => ({ ...current, message: "算法替换缺少候选 Diff 与 A/B 结果，已保留为待验证。", updatedAt: Date.now() }));
          }
        } else {
          const sampleCount = option.id === "压力测试" ? 16 : 1;
          const kind = option.id === "压力测试" ? "stress" as const : option.id === "容错传播" ? "fault" as const : option.id === "安全攻击" ? "security" as const : "baseline" as const;
          const input = option.id === "容错传播"
            ? JSON.stringify({ codeflowExperiment: "fault", value: null, dependencyAvailable: false, timeoutHintMs: 1 })
            : option.id === "安全攻击"
              ? JSON.stringify({ codeflowExperiment: "security", value: "' OR 1=1 --", path: "../../outside", command: "; echo blocked", size: 8192 })
              : runtimeStdin;
          for (let index = 0; index < sampleCount; index += 1) {
            setTwinSuiteProgress((current) => ({ ...current, message: sampleCount > 1 ? `${option.id}样本 ${index + 1}/${sampleCount}` : `执行 ${option.id}`, updatedAt: Date.now() }));
            const report = await executeControlledRuntime(activeProject.id, activeProject.name, files, runtimeAdapter, runtimeEntry, input, {
              experimentKind: kind,
              sampleId: `twin-${kind}-${Date.now()}-${index + 1}`,
              repetition: 1,
            });
            appendRuntimeEvidence(report);
          }
        }
        completed += 1;
        setTwinSuiteProgress((current) => ({ ...current, completed, message: `${option.id} 已刷新。`, updatedAt: Date.now() }));
      }
      setTwinSuiteProgress({ running: false, completed, total: selected.length, current: "孪生证据已刷新", message: `已处理 ${completed}/${selected.length} 类实验。`, updatedAt: Date.now() });
      setRuntimeMessage(`孪生集成实验完成 ${completed}/${selected.length}；静态、模型和真实证据已重新计算。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "孪生集成实验失败。";
      setTwinSuiteProgress((current) => ({ ...current, running: false, completed, current: "执行中断", message, updatedAt: Date.now() }));
      setRuntimeMessage(message);
    } finally {
      setRuntimeRunning(false);
    }
  }

  function refreshTwinProgress() {
    const selected = analysis.digitalTwin.experiments.filter((experiment) => selectedTwinExperiments.includes(experiment.kind));
    const completed = selected.filter((experiment) => experiment.claimStatus !== "未证明" || experiment.status !== "等待执行").length;
    setTwinSuiteProgress({
      running: false,
      completed,
      total: selectedTwinExperiments.length,
      current: "证据状态已刷新",
      message: `当前选择中 ${completed}/${selectedTwinExperiments.length} 类已有观察或验证证据。`,
      updatedAt: Date.now(),
    });
  }

  async function launchCurrentDebugSession() {
    if (!runtimeEntry || debugBusy || debugAvailability.status === "unavailable") return;
    setDebugBusy(true);
    setDebugMessage("正在启动受管 DAP、校验断点并等待第一次暂停。");
    try {
      const created = await createDebugSession({
        projectId: activeProject.id,
        projectName: activeProject.name,
        adapter: runtimeAdapter,
      });
      await setDebugBreakpoints({
        sessionId: created.id,
        source: { path: runtimeEntry },
        breakpoints: [{ line: debugBreakpointLine }],
      });
      const launched = await launchDebugSession({
        sessionId: created.id,
        entryPath: runtimeEntry,
        files: files.map((file) => ({ path: file.name, content: file.content, language: file.language })),
        stopOnEntry: true,
      });
      setDebugSession(launched.session);
      setDebugMessage(
        launched.session.lastStop
          ? `已暂停在 ${launched.session.stackFrames[0]?.source.path ?? runtimeEntry}:${launched.session.stackFrames[0]?.line ?? debugBreakpointLine}，变量已刷新。`
          : `调试会话状态：${launched.session.state}`,
      );
    } catch (error) {
      setDebugMessage(error instanceof Error ? error.message : "桌面调试启动失败。");
    } finally {
      setDebugBusy(false);
    }
  }

  async function runDebugAction(action: "next" | "stepIn" | "stepOut" | "continue" | "disconnect") {
    if (!debugSession || debugBusy) return;
    const threadId = debugSession.lastStop?.threadId ?? debugSession.threads[0]?.id;
    if (!threadId && action !== "disconnect") {
      setDebugMessage("当前会话没有可操作的暂停线程。");
      return;
    }
    setDebugBusy(true);
    setDebugMessage(`正在执行 ${action} 并等待真实 DAP 事件。`);
    try {
      const result = action === "disconnect"
        ? await disconnectDebugSession({ sessionId: debugSession.id, terminateDebuggee: true })
        : action === "next"
          ? await nextDebugSession({ sessionId: debugSession.id, threadId: threadId! })
          : action === "stepIn"
            ? await stepInDebugSession({ sessionId: debugSession.id, threadId: threadId! })
            : action === "stepOut"
              ? await stepOutDebugSession({ sessionId: debugSession.id, threadId: threadId! })
              : await continueDebugSession({ sessionId: debugSession.id, threadId: threadId! });
      setDebugSession(result.session);
      setDebugMessage(`真实 DAP 返回：${result.session.state}；事件 ${result.session.eventLog.at(-1)?.kind ?? action}。`);
    } catch (error) {
      setDebugMessage(error instanceof Error ? error.message : "调试命令失败。");
    } finally {
      setDebugBusy(false);
    }
  }

  async function runDigitalTwinSuite() {
    const allExperiments = twinExperimentOptions.map((option) => option.id);
    setSelectedTwinExperiments(allExperiments);
    await runSelectedTwinExperiments(allExperiments);
  }

  function runSecurityAssertions() {
    if (!runtimeEntry || runtimeRunning) return;
    setRuntimeRunning(true);
    setSecurityAssertions([]);
    setSecurityAssertionMessage(`正在执行 ${buildLocalSecurityAttackCorpus().length} 个本地攻击样本；未明确拒绝的身份用例不会判为通过。`);
    executeSecurityAssertionSuite(activeProject.id, activeProject.name, files, runtimeAdapter, runtimeEntry, (report) => {
      setProjectRuntimeExecutions((current) => ({
        ...current,
        [activeProject.id]: [...(current[activeProject.id] ?? []), report].slice(-60),
      }));
    })
      .then(async (results) => {
        setSecurityAssertions(results);
        const persistence = await persistSecurityAssertionResults(activeProject.id, results, inferSecurityFrameworks(files));
        const history = await loadSecurityCorpusHistory();
        const passed = results.filter((item) => item.status === "passed").length;
        const failed = results.filter((item) => item.status === "failed").length;
        const inconclusive = results.length - passed - failed;
        const maturity = evaluateSecurityCorpusMaturity(results);
        const historyText = history
          ? `历史 ${history.projectCount} 项目 / ${history.frameworkCount} 框架 / ${history.replaySpanDays} 天 / 单案例最少 ${history.minimumCaseReplayCount} 次。${history.stableTeacherEligible ? "已通过稳定老师门禁。" : "尚未通过稳定老师门禁。"}`
          : "网页预览不能读取桌面 SQLite 历史，稳定老师门禁保持关闭。";
        setSecurityAssertionMessage(`攻击断言完成：通过 ${passed}，失败 ${failed}，未证实/运行器拦截 ${inconclusive}；覆盖 ${maturity.coverage}%，结论率 ${maturity.conclusiveRate}%，SQLite 写入 ${persistence.rowCount ?? 0} 行。${maturity.eligibleForDeepWebSupervision ? "本轮可作为监督候选。" : "本轮不进入 DeepWeb 监督。"}${historyText}`);
      })
      .catch((error: unknown) => setSecurityAssertionMessage(error instanceof Error ? error.message : "攻击断言执行失败。"))
      .finally(() => setRuntimeRunning(false));
  }

  function runFormalVerification() {
    if (formalBusy) return;
    setFormalBusy(true);
    setFormalMessage("正在受控隔离环境中运行 Z3，并保存公式与求解结果。");
    Promise.all([
      runFormalPolicySuite(activeProject.id),
      runProjectContractProofs(activeProject.id, analysis.programVerification.contracts),
    ])
      .then(([policyRecords, contractRecords]) => {
        const records = [...policyRecords, ...contractRecords];
        setProjectFormalProofs((current) => ({ ...current, [activeProject.id]: records }));
        const proved = records.filter((record) => record.status === "proved").length;
        const counterexamples = records.filter((record) => record.status === "counterexample").length;
        setFormalMessage(`Z3 完成 ${records.length} 条证明：${proved} 条成立，${counterexamples} 条找到反例；记录已写入桌面 SQLite。`);
      })
      .catch((error: unknown) => {
        setFormalMessage(error instanceof Error ? error.message : "形式化证明失败。");
      })
      .finally(() => setFormalBusy(false));
  }

  function loadSelectedFunctionForRepair() {
    const target = selectedFunction;
    const file = target ? files.find((item) => item.name === target.fileName) : files.find((item) => item.name === repairFileName) ?? files[0];
    if (!file) return;
    setRepairFileName(file.name);
    setRepairOriginalCode(target?.body?.trim() || file.content);
    setRepairSuggestedCode(target?.body?.trim() || file.content);
    setRepairResult(null);
    setRepairApproval(null);
    setRepairMessage(target ? `已载入 ${target.name} 的精确原文；请只编辑建议代码一侧。` : `已载入 ${file.name}。`);
  }

  function currentRepairSuggestion() {
    return [{
      id: `manual-reviewed-${simpleHash(`${repairFileName}:${repairOriginalCode}:${repairSuggestedCode}`)}`,
      fileName: repairFileName,
      originalCode: repairOriginalCode,
      suggestedCode: repairSuggestedCode,
      reason: repairReason.trim() || "用户审查后的确定性修复",
      evidenceIds: analysis.issues.slice(0, 5).map((issue) => issue.id),
      confidence: 100,
      deterministic: true,
    }];
  }

  async function prepareRepairDiff() {
    if (repairBusy) return;
    if (!repairOriginalCode || !repairSuggestedCode || repairOriginalCode === repairSuggestedCode) {
      setRepairMessage("无法生成 Diff：建议代码必须包含经过审查的真实修改。");
      return;
    }
    setRepairBusy(true);
    try {
      const patch = await generateCandidateDiffFromSuggestions(`repair-${Date.now()}`, files, currentRepairSuggestion());
      setRepairResult({ patch });
      setRepairApproval(null);
      setRepairMessage(patch.status === "ready" ? "候选 Diff 已生成；源项目未修改。下一步运行 A/B 实验。" : patch.rejectionReason ?? "候选生成失败。");
    } catch (error) {
      setRepairMessage(error instanceof Error ? error.message : "候选 Diff 生成失败。");
    } finally {
      setRepairBusy(false);
    }
  }

  async function runRepairExperiment() {
    if (repairBusy || !runtimeEntry || runtimeAvailability.status === "web-preview" || repairOriginalCode === repairSuggestedCode || repairResult?.patch.status !== "ready") {
      setRepairMessage(runtimeAvailability.status === "web-preview" ? "真实 A/B 只能在桌面程序中运行。" : "请先形成真实代码修改并生成可验证 Diff。 ");
      return;
    }
    setRepairBusy(true);
    setRepairMessage("正在临时副本中执行基线、候选、压力和攻击 A/B；不会覆盖本地项目。");
    try {
      const result = await executeGeneratedRepairSuggestions({
        projectId: activeProject.id,
        projectName: activeProject.name,
        candidateId: repairResult?.patch.id ?? `repair-${Date.now()}`,
        files,
        suggestions: currentRepairSuggestion(),
        adapter: runtimeAdapter,
        entryPath: runtimeEntry,
        stdin: runtimeStdin,
        onResult: (report) => setProjectRuntimeExecutions((current) => ({
          ...current,
          [activeProject.id]: [...(current[activeProject.id] ?? []), report].slice(-120),
        })),
      });
      setRepairResult(result);
      setRepairApproval(null);
      setRepairMessage(result.experiment
        ? `A/B ${result.experiment.status}；输出等价 ${result.experiment.outputEquivalent ? "通过" : "失败"}；性能变化 ${result.experiment.performanceDeltaPercent}%。`
        : result.patch.rejectionReason ?? "候选未进入实验。" );
    } catch (error) {
      setRepairMessage(error instanceof Error ? error.message : "修复 A/B 实验失败。");
    } finally {
      setRepairBusy(false);
    }
  }

  function approveCurrentRepair() {
    if (!repairResult) return;
    try {
      const approval = approveRepairExperiment(repairResult);
      setRepairApproval(approval);
      setRepairMessage("当前候选哈希已获本地用户批准；项目尚未写回。");
    } catch (error) {
      setRepairMessage(error instanceof Error ? error.message : "候选批准失败。");
    }
  }

  async function writeBackCurrentRepair() {
    if (!repairResult || !repairApproval || repairBusy) return;
    setRepairBusy(true);
    try {
      const written = await writeBackApprovedRepair({ projectId: activeProject.id, currentFiles: files, patch: repairResult.patch, approval: repairApproval });
      setProjects((current) => current.map((project) => project.id === activeProject.id
        ? { ...project, files: written.files, updatedAt: Date.now() }
        : project));
      setRepairRollbacks((current) => ({ ...current, [activeProject.id]: written.rollback }));
      setRepairResult(null);
      setRepairApproval(null);
      setRepairMessage(`${written.evidence.join(" ")} 可使用一键回滚恢复。`);
    } catch (error) {
      setRepairMessage(error instanceof Error ? error.message : "安全写回失败。");
    } finally {
      setRepairBusy(false);
    }
  }

  async function rollbackLastRepair() {
    const snapshot = repairRollbacks[activeProject.id];
    if (!snapshot || repairBusy) return;
    setRepairBusy(true);
    try {
      const restored = await rollbackRepairWriteBack(files, snapshot);
      setProjects((current) => current.map((project) => project.id === activeProject.id
        ? { ...project, files: restored, updatedAt: Date.now() }
        : project));
      setRepairRollbacks((current) => {
        const next = { ...current };
        delete next[activeProject.id];
        return next;
      });
      setRepairMessage("完整性校验通过，上一轮修复已回滚。修复后的新改动没有被覆盖。");
    } catch (error) {
      setRepairMessage(error instanceof Error ? error.message : "一键回滚失败。");
    } finally {
      setRepairBusy(false);
    }
  }

  async function exportAnalysisReport() {
    const report = document.getElementById("project-analysis-report");
    if (!report) {
      setReportExportMessage("导出失败：没有找到报告内容。");
      return;
    }
    setReportExportMessage("正在本机排版并生成 PDF…");
    try {
      const savedPath = await exportElementAsLocalPdf(report, `${activeProject.name}-CodeFlow-分析报告`);
      setReportExportMessage(`PDF 已保存：${savedPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setReportExportMessage(message.includes("REPORT_SAVE_CANCELLED") ? "已取消保存，报告内容没有写入磁盘。" : `导出失败：${message}`);
    }
  }

  function runRuntimeCertification() {
    if (runtimeRunning || runtimeAvailability.status === "web-preview") return;
    setRuntimeRunning(true);
    setRuntimeMessage("正在依次认证 Node、Python、Rust、Java、C 和 C++；每项都必须通过真实执行、trace、文件监控和强隔离。 ");
    const collected: ControlledRuntimeExecutionReport[] = [];
    certifyControlledRuntimeOnHost(runtimeAvailability, (report) => {
      collected.push(report);
      setRuntimeCertificationRuns([...collected]);
      setRuntimeMessage(`${report.adapter} 宿主机认证：${report.status} · ${report.sandboxStatus}`);
    })
      .then((report) => {
        setRuntimeMessage(`六语言宿主机认证 ${report.passedCount}/${report.totalCount}，能力得分 ${report.score}%。`);
      })
      .catch((error: unknown) => {
        setRuntimeMessage(error instanceof Error ? error.message : "六语言宿主机认证失败。");
      })
      .finally(() => setRuntimeRunning(false));
  }

  function exportIndexedDbSnapshot() {
    exportDeepWebIndexedDbSnapshot()
      .then((report) => {
        setIndexedDbExportMessage(report.evidence);
        if (report.payload && report.status !== "unavailable") {
          downloadTextFile(`codeflow-deepweb-${report.exportedAt}.json`, report.payload);
        }
      })
      .catch((error: unknown) => {
        setIndexedDbExportMessage(error instanceof Error ? error.message : "IndexedDB snapshot export failed");
      });
  }

  function importIndexedDbSnapshot(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    file
      .text()
      .then((payload) => importDeepWebIndexedDbSnapshot(payload))
      .then((report) => {
        setIndexedDbReport(report);
        setIndexedDbExportMessage(`导入完成：${report.evidence}`);
      })
      .catch((error: unknown) => {
        setIndexedDbExportMessage(error instanceof Error ? error.message : "IndexedDB snapshot import failed");
      });
  }

  function exportOpfsSqliteDatabase() {
    exportDeepWebOpfsSqliteDatabase(sqliteJournalPreviewRows)
      .then(({ report, bytes, filename }) => {
        setOpfsSqliteReport(report);
        if (bytes.byteLength > 0 && report.status !== "unavailable") {
          downloadBinaryFile(filename, bytes, "application/vnd.sqlite3");
          setOpfsSqliteExportMessage(`已导出 ${filename} · ${Math.ceil(bytes.byteLength / 1024)} KB。`);
          return;
        }
        setOpfsSqliteExportMessage(report.evidence);
      })
      .catch((error: unknown) => {
        setOpfsSqliteExportMessage(error instanceof Error ? error.message : "sql.js/OPFS SQLite export failed");
      });
  }

  function downloadTextFile(filename: string, content: string) {
    if (typeof document === "undefined") return;
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function downloadBinaryFile(filename: string, bytes: Uint8Array, type = "application/octet-stream") {
    if (typeof document === "undefined") return;
    const blob = new Blob([bytes], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <main className={`desktop-workspace navigation-${navigationMode}`}>
      <WorkspaceNavigator
        pages={workspacePages}
        activePage={workspacePage}
        onPageChange={(page) => navigateWorkspacePage(page as WorkspacePage)}
        projects={projects.map((project) => ({ id: project.id, name: project.name }))}
        activeProjectId={activeProject.id}
        onProjectChange={activateProject}
        mode={navigationMode}
        onModeChange={changeNavigationMode}
      />

      <section className="workspace-shell">
      <header className="workspace-commandbar">
        <div className="workspace-title">
          <span>{workspacePages.find((page) => page.id === workspacePage)?.group}</span>
          <strong>{workspacePages.find((page) => page.id === workspacePage)?.label}</strong>
          <small>{activeProject.name}</small>
        </div>
        <div className="command-metrics" aria-label="当前分析状态">
          <span><b>{files.length}</b> 文件</span>
          <span><b>{functions.length}</b> 函数</span>
          <span className={issueGroupCount ? "metric-alert" : ""}><b>{issueGroupCount}</b> 风险类型</span>
          <span><b>{parseResult.report.reliabilityScore}%</b> 解析</span>
        </div>
      </header>

      <section className="scoreboard" aria-label="项目诊断概览">
        <article>
          <span>主控入口</span>
          <strong>{analysis.mainFile?.name.split("/").pop() ?? "未识别"}</strong>
          <small>{analysis.entryFunction?.name ?? "等待导入项目"}</small>
        </article>
        <article>
          <span>数据流闭合度</span>
          <strong>{analysis.closureScore}%</strong>
          <small>输入到返回路径完整度</small>
        </article>
        <article>
          <span>安全边界</span>
          <strong>{analysis.damScore}%</strong>
          <small>验证、权限、容量与入侵风险</small>
        </article>
        <article>
          <span>运行环境</span>
          <strong>{analysis.environmentScore}%</strong>
          <small>依赖、运行时、配置和测试基础</small>
        </article>
        <article>
          <span>本地解析层</span>
          <strong>{parseResult.report.reliabilityScore}%</strong>
          <small>{parseResult.report.adapterName}</small>
        </article>
      </section>

      {(workspacePage === "map" || workspacePage === "inspect") && (
        <section className="project-analysis-bar" aria-label="当前项目解析概览">
          <div className="project-analysis-summary">
            <div>
              <span>当前项目</span>
              <strong>{activeProject.name}</strong>
              <small>项目数据、图谱、断点与诊断独立保存</small>
            </div>
            <div>
              <span>语言</span>
              <p>{Object.entries(languageSummary).map(([language, count]) => `${language} ${count}`).join(" · ") || "等待导入"}</p>
            </div>
            <div>
              <span>解析器</span>
              <strong>{parseResult.report.adapterName}</strong>
              <small>{parseResult.report.mode} · {parseResult.report.functionCount} 函数 · {parseResult.report.declarationCount} 类型/模型 · {parseResult.report.edgeCount} 条关系</small>
            </div>
            <div>
              <span>诊断归并</span>
              <strong>{issueGroupCount} 类风险</strong>
              <small>{analysis.issues.length} 个受影响位置</small>
            </div>
          </div>
          <details className="project-analysis-tools">
            <summary>查看解析证据</summary>
            <div className="project-analysis-tools-body">
              <div className="project-parser-evidence">
                <strong>{parseResult.report.enhancement.source}</strong>
                <span>{parseResult.report.enhancement.status} · {parseResult.report.enhancement.evidence}</span>
                <small>{parseResult.report.evidence.slice(0, 4).join(" / ")}</small>
              </div>
              <div className="capability-list">
                {parseResult.report.capabilities.map((capability) => (
                  <span className={`capability-${capability.status}`} key={capability.name}>
                    {capability.layer} {capability.coverage}%
                  </span>
                ))}
              </div>
            </div>
          </details>
        </section>
      )}

      {workspacePage === "projects" && (
        <section className="project-library-page" aria-label="多项目工作区">
          <article className="analysis-card wide-card">
            <div className="panel-heading">
              <h2>项目库</h2>
              <span>多项目隔离</span>
            </div>
            <p className="software-brief">
              每个项目拥有独立的文件、函数图、数据流、诊断、断点和 DeepWeb 记录。导入、复制或恢复不会覆盖其他项目。
            </p>
            <div className="project-import-hub" aria-label="导入项目">
              <div>
                <strong>导入项目</strong>
                <span>这里是唯一的代码导入口。选择整个文件夹可保留项目层级，也可以导入一组独立代码文件。</span>
              </div>
              <div className="project-import-actions">
                <label>
                  <input
                    type="file"
                    multiple
                    onChange={handleFiles}
                    accept=".ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.cs,.cpp,.cc,.c,.h,.php,.rb,.kt,.swift,.json,.toml,.yaml,.yml,.md"
                  />
                  <span>选择代码文件</span>
                </label>
                <label>
                  <input type="file" multiple onChange={handleFiles} {...directoryInputProps} />
                  <span>选择项目文件夹</span>
                </label>
              </div>
            </div>
            <div className="project-library-toolbar">
              <label>
                <span>搜索项目</span>
                <input value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="名称、来源或语言" />
              </label>
              <button onClick={exportProjectBackup}>导出备份</button>
              <label className="project-backup-import">
                <input type="file" accept="application/json,.json" onChange={(event) => void importProjectBackup(event)} />
                <span>合并恢复</span>
              </label>
            </div>
            <div className="project-action-status">
              <p>{projectActionMessage} {projectStoreMessage}</p>
              {removedProject && <button onClick={restoreRemovedProject}>撤销移除</button>}
            </div>
            <div className="project-list">
              {visibleProjects.map((project) => {
                const active = project.id === activeProject.id;
                return (
                  <div className={active ? "project-row active" : "project-row"} key={project.id}>
                    <div>
                      {renamingProjectId === project.id ? (
                        <div className="project-rename-row">
                          <input
                            value={projectNameDraft}
                            maxLength={120}
                            autoFocus
                            onChange={(event) => setProjectNameDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") commitProjectRename(project.id);
                              if (event.key === "Escape") setRenamingProjectId(null);
                            }}
                          />
                          <button onClick={() => commitProjectRename(project.id)}>保存</button>
                          <button onClick={() => setRenamingProjectId(null)}>取消</button>
                        </div>
                      ) : <strong>{project.name}</strong>}
                      <span>
                        {projectSourceLabel(project.source)} · {project.files.length} 文件 · {projectLanguageSummary(project.files)}
                      </span>
                      <small>{projectUpdatedLabel(project)}</small>
                    </div>
                    <div>
                      <button onClick={() => activateProject(project.id)}>{active ? "当前项目" : "打开"}</button>
                      <button onClick={() => beginProjectRename(project)}>重命名</button>
                      <button onClick={() => duplicateProject(project)}>复制</button>
                      <button disabled={projects.length <= 1} onClick={() => deleteProject(project.id)}>
                        移除
                      </button>
                    </div>
                  </div>
                );
              })}
              {!visibleProjects.length && <div className="empty-state">没有匹配的项目。</div>}
            </div>
          </article>

          <article className="analysis-card">
            <div className="panel-heading">
              <h2>当前项目上下文</h2>
              <span>{activeProject.name}</span>
            </div>
            <div className="project-scope-grid">
              {[
                ["项目总览", "只显示当前项目的主控入口、数据流图、诊断评分和软件解析。"],
                ["文件页", "按文件拆开看函数、语言、问题数量和文件职责，避免多文件混成一团。"],
                ["模块页", "跨文件按功能域归纳，比如任务、排期、提醒、数据库、前端或代码解析。"],
                ["函数页", "只看当前项目内选中的 function，断点也按项目隔离保存。"],
              ].map(([title, body]) => (
                <div key={title}>
                  <strong>{title}</strong>
                  <span>{body}</span>
                </div>
              ))}
            </div>
          </article>
        </section>
      )}

      {workspacePage === "knowledge" && (
        <section className="knowledge-pack-page" aria-label="本地知识包供应链">
          <article className="analysis-card wide-card knowledge-pack-overview">
            <div className="panel-heading">
              <h2>官方知识包</h2>
              <span>{knowledgePackReport.status} · 成熟度 {knowledgePackReport.knowledgeMaturity}%</span>
            </div>
            <p className="software-brief">
              四个适配器只从 OSV、NVD、MITRE CWE 与 CISA KEV 官方地址读取数据。下载内容先进入不可变隔离区，
              通过格式、许可证、四源回放和本机签名检查后才允许激活；未知许可证记录不会进入分析知识集。
            </p>
            <div className={networkPolicy.enabled ? "network-defense enabled" : "network-defense locked"}>
              <div>
                <strong>{networkPolicy.enabled ? "官方知识公网已授权" : "公网总闸已锁定"}</strong>
                <span>{networkPolicy.scope}</span>
              </div>
              <label className="network-policy-switch">
                <input
                  type="checkbox"
                  checked={networkPolicy.enabled}
                  disabled={networkPolicyBusy || networkPolicy.mode === "web-preview"}
                  onChange={(event) => void changeNetworkPolicy(event.target.checked)}
                />
                <span>官方知识更新公网授权</span>
              </label>
            </div>
            <div className="knowledge-pack-metrics">
              <span><b>{knowledgePackReport.sourceCount}/4</b>官方源</span>
              <span><b>{knowledgePackReport.activeRecordCount}</b>激活记录</span>
              <span><b>{knowledgePackReport.quarantinedRecordCount}</b>隔离记录</span>
              <span><b>{knowledgePackReport.eventCount}</b>审计事件</span>
            </div>
            <div className="knowledge-pack-actions">
              <button
                className="primary-action"
                disabled={knowledgePackBusy || knowledgePackReport.status === "web-preview" || !networkPolicy.enabled}
                onClick={() => void runKnowledgePackAction(importPhaseOneKnowledgePack, "四源知识包已下载、校验并封存；请检查后激活。")}
              >
                {knowledgePackBusy ? "质量门执行中…" : "导入第一阶段知识包"}
              </button>
              <button
                disabled={knowledgePackBusy || !knowledgePackReport.previousPackId}
                onClick={() => void runKnowledgePackAction(rollbackKnowledgePack, "上一版知识包已恢复。")}
              >
                回滚上一版
              </button>
              <label className="knowledge-file-action">
                导入 SDK/故障/基准/硬件/修复证据包
                <input type="file" accept="application/json,.json" hidden onChange={(event) => void importSupplementalKnowledge(event)} />
              </label>
              <button disabled={knowledgePackBusy || supplementalKnowledge?.status !== "staged"} onClick={() => void activateSupplementalKnowledge()}>
                激活补充证据包
              </button>
            </div>
            <p className="knowledge-pack-message">{knowledgePackMessage}</p>
            {supplementalKnowledge ? <small>补充包 {supplementalKnowledge.bundleId} · {supplementalKnowledge.status} · {supplementalKnowledge.recordCount} 条 · {supplementalKnowledge.contentHash.slice(0, 16)}</small> : null}
            <small className="knowledge-pack-path">数据库：{knowledgePackReport.databasePath}</small>
          </article>

          <article className="analysis-card wide-card extension-import-panel">
            <div className="panel-heading">
              <h2>扩展库与适配器导入</h2>
              <span>{importedExtensionAdapters.length} 个本机扩展声明</span>
            </div>
            <p className="software-brief">
              知识数据继续使用上方的证据包入口并进入 native SQLite 隔离区。这里导入解析器、运行器、调试器、测试器或报告器的声明文件，
              只注册输入输出契约与健康检查，不执行包内代码，也不会绕过 sidecar 签名和沙箱。
            </p>
            <div className="knowledge-pack-actions">
              <label className="knowledge-file-action">
                导入扩展声明
                <input type="file" accept="application/json,.json" hidden onChange={(event) => void importExtensionAdapter(event)} />
              </label>
              <button type="button" onClick={downloadExtensionAdapterTemplate}>下载声明模板</button>
            </div>
            <p className="knowledge-pack-message">{extensionImportMessage}</p>
            <div className="extension-registry-list">
              {importedExtensionAdapters.map((item) => (
                <div key={item.packageId}>
                  <span><strong>{item.name}</strong><small>{item.packageId} · {item.version}</small></span>
                  <span>{item.adapter.kind} · {item.adapter.input} → {item.adapter.output}</span>
                  <small>SHA-256 {item.artifactHash.slice(0, 16)}… · {item.adapter.isolation} · {item.adapter.healthCheck}</small>
                  <button type="button" onClick={() => removeExtensionAdapter(item.packageId)}>移除声明</button>
                </div>
              ))}
              {!importedExtensionAdapters.length && <div className="empty-state">尚未导入扩展声明。内置六类 Adapter Contract 保持可用。</div>}
            </div>
          </article>

          <article className="analysis-card wide-card">
            <div className="panel-heading">
              <h2>来源与许可证门禁</h2>
              <span>逐记录判定</span>
            </div>
            <div className="knowledge-source-grid">
              {knowledgePackReport.sources.map((source) => (
                <div key={source.id} className={source.lastStatus === "imported" ? "source-ready" : "source-waiting"}>
                  <div><strong>{source.name}</strong><span>{source.recordCount} 条</span></div>
                  <small>{source.licenseId}</small>
                  <p>商业使用：{source.commercialAllowed ? "允许" : "阻止"}；再分发：{source.redistributionAllowed ? "允许" : "限制"}</p>
                  <small>{source.evidence}</small>
                </div>
              ))}
            </div>
          </article>

          <article className="analysis-card wide-card">
            <div className="panel-heading">
              <h2>封存版本</h2>
              <span>{knowledgePackReport.packCount} 个版本</span>
            </div>
            <div className="knowledge-version-list">
              {knowledgePackReport.packs.map((pack) => (
                <div key={pack.id} className={pack.status === "active" ? "knowledge-version active" : "knowledge-version"}>
                  <div>
                    <strong>{pack.version}</strong>
                    <span>{pack.status} · 校验 {pack.validationScore}% · {pack.recordCount} 条</span>
                    <small>SHA-256 {pack.contentHash.slice(0, 16)}… · 本机签名 {pack.signatureValid ? "有效" : "无效"}</small>
                  </div>
                  <button
                    disabled={knowledgePackBusy || pack.status === "active" || !pack.signatureValid || pack.validationScore < 90}
                    onClick={() => void runKnowledgePackAction(() => activateKnowledgePack(pack.id), "签名知识包已原子激活。")}
                  >
                    {pack.status === "active" ? "当前版本" : "激活"}
                  </button>
                </div>
              ))}
              {!knowledgePackReport.packs.length && <div className="empty-state">尚无封存知识包。桌面程序联网后可执行首次导入。</div>}
            </div>
          </article>

          <article className="analysis-card wide-card">
            <div className="panel-heading"><h2>法律与证据记录</h2><span>激活前保留</span></div>
            <div className="knowledge-notice-grid">
              {[...knowledgePackReport.legalNotices, ...knowledgePackReport.evidence].map((notice, index) => (
                <p key={`${index}-${notice}`}>{notice}</p>
              ))}
            </div>
          </article>
        </section>
      )}

      {(workspacePage === "map" || workspacePage === "inspect") && (
      <section className={`product-grid ${workspacePage === "map" ? "map-focused" : "inspect-focused"}`}>
        <aside hidden className="source-panel" aria-label="旧版代码输入和项目概览">
          <div className="panel-heading">
            <h2>流体解析边栏</h2>
            <span>{analysis.entryFunction?.name ?? "入口待识别"}</span>
          </div>
          <div className="flow-sidebar-summary">
            <div><span>主控文件</span><strong>{analysis.mainFile?.name.split("/").pop() ?? "未识别"}</strong></div>
            <div><span>闭环</span><strong>{analysis.closureScore}%</strong></div>
            <div><span>安全</span><strong>{analysis.damScore}%</strong></div>
            <div><span>问题</span><strong>{analysis.issues.length}</strong></div>
          </div>
          <p className="flow-sidebar-note">当前只呈现 {activeProject.name}，其他项目的数据、图谱和诊断保持隔离。</p>

          <details className="sidebar-collapsible">
            <summary>导入或创建项目</summary>
            <div className="sidebar-collapsible-body">
          <label className="file-drop">
            <input
              type="file"
              multiple
              onChange={handleFiles}
              accept=".ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.cs,.cpp,.cc,.c,.h,.php,.rb,.kt,.swift,.json,.toml,.yaml,.yml,.md"
            />
            <strong>导入代码文件</strong>
            <span>选择多个文件并创建一个新项目，不覆盖当前项目。</span>
          </label>

          <label className="file-drop compact-drop">
            <input type="file" multiple onChange={handleFiles} {...directoryInputProps} />
            <strong>导入整个文件夹</strong>
            <span>创建独立项目，自动过滤依赖目录，并尝试找到 main、index、app、server 等主控文件。</span>
          </label>

          <div className="input-stack">
            <label>
              文件名
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="例如 src/main.ts"
              />
            </label>
            <label>
              粘贴代码
              <textarea
                value={draftCode}
                onChange={(event) => setDraftCode(event.target.value)}
                spellCheck={false}
              />
            </label>
            <button className="primary-action" onClick={analyzeDraft}>
              创建草稿项目
            </button>
          </div>
            </div>
          </details>

          <div className="summary-block">
            <h3>语言覆盖</h3>
            <div className="language-list">
              {Object.entries(languageSummary).map(([language, count]) => (
                <span key={language}>
                  {language}
                  <b>{count}</b>
                </span>
              ))}
            </div>
          </div>

          <details className="sidebar-collapsible technical-collapsible">
            <summary>解析技术与证据</summary>
            <div className="sidebar-collapsible-body">
          <div className="summary-block compact-summary-block">
            <h3>本地模型</h3>
            <div className="model-stack">
              {analysis.modelLayers.map((layer) => (
                <div key={layer.name}>
                  <strong>{layer.name}</strong>
                  <span>{layer.role}</span>
                  <small>
                    {layer.localSource} · {layer.status}
                  </small>
                </div>
              ))}
            </div>
          </div>

          <div className="summary-block compact-summary-block">
            <h3>本地解析</h3>
            <div className="parser-card">
              <strong>{parseResult.report.adapterName}</strong>
              <span>
                {parseResult.report.mode} · {parseResult.report.functionCount} 函数 · {parseResult.report.edgeCount} 边
              </span>
              <small>
                {parseResult.report.enhancement.source} · {parseResult.report.enhancement.status} · {parseResult.report.enhancement.evidence}
              </small>
              <small>{parseResult.report.evidence.slice(0, 4).join(" / ")}</small>
              <div className="capability-list">
                {parseResult.report.capabilities.map((capability) => (
                  <span className={`capability-${capability.status}`} key={capability.name}>
                    {capability.layer} {capability.coverage}%
                  </span>
                ))}
              </div>
            </div>
          </div>
            </div>
          </details>
        </aside>

        <section className="graph-panel" id="function-graph" aria-label="函数图可视化">
          <div className="panel-heading graph-heading">
            <div>
              <h2>{workspacePage === "inspect" ? "函数关系" : "项目数据路径"}</h2>
              <span>{workspacePage === "inspect" ? "查看函数处理顺序、上下游调用和断点影响" : "从主控入口开始，观察输入、处理、输出与异常路径"}</span>
            </div>
            <div className="segmented" role="tablist" aria-label="图谱模式">
              {(workspacePage === "inspect"
                ? [["water", "函数路径"], ["calls", "调用流"]]
                : [["water", "数据路径"], ["entry", "代码树"], ["calls", "调用流"], ["folders", "文件层级"], ["fsm", "FSM"]]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  className={graphMode === mode ? "active" : ""}
                  onClick={() => setGraphMode(mode as GraphMode)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {graphMode === "water" ? (
            <WaterCanalDiagram
              nodes={analysis.flowNodes}
              edges={analysis.flowEdges}
              selectedNode={workspacePage === "inspect" ? null : selectedWaterNode}
              onSelect={workspacePage === "inspect" ? (id) => { if (id) setSelectedId(id); } : setSelectedWaterId}
              deepWebBindings={workspacePage === "inspect" ? undefined : deepWebBindings}
              presentation={workspacePage === "inspect" ? "breakpoints" : "diagnostics"}
              interactiveDetails={workspacePage !== "inspect"}
            />
          ) : graphMode === "folders" ? (
            <MovableGraphViewport
              label="可移动文件层级图"
              contentWidth={Math.max(900, fileSummaries.length * 264 + 32)}
              contentHeight={Math.max(430, 250 + Math.ceil(Math.max(0, ...fileSummaries.map((file) => file.functions.length)) / 2) * 40)}
            >
            <div className="horizontal-file-tree" aria-label="横向文件树方格表">
              {fileSummaries.map((file, index) => (
                <section className="file-tree-tile" key={file.id}>
                  <div className="file-tree-index">{String(index + 1).padStart(2, "0")}</div>
                  <header>
                    <strong>{file.name.split("/").pop()}</strong>
                    <span>{file.language}</span>
                  </header>
                  <small>{file.name}</small>
                  <dl>
                    <div><dt>函数</dt><dd>{file.functions.length}</dd></div>
                    <div><dt>模型</dt><dd>{file.declarations.length}</dd></div>
                    <div><dt>问题</dt><dd>{file.issueCount}</dd></div>
                  </dl>
                  <div className="file-tree-functions">
                    {file.functions.map((fn) => (
                      <button key={fn.id} onClick={() => setSelectedId(fn.id)}>{fn.name}</button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            </MovableGraphViewport>
          ) : (
            <MovableGraphViewport
              label={`${graphMode === "entry" ? "代码树" : graphMode === "calls" ? "调用流" : "FSM"}可移动图谱`}
              contentWidth={graphCanvasSize.width}
              contentHeight={graphCanvasSize.height}
            >
            <div className="graph-canvas">
              <svg viewBox={`0 0 ${graphCanvasSize.width} ${graphCanvasSize.height}`} role="img" aria-label="代码流图谱">
                {edges
                  .map((edge) => {
                    const from = graphNodes.find((node) => node.id === edge.from);
                    const to = graphNodes.find((node) => node.id === edge.to);
                    if (!from || !to) return null;
                    return (
                      <g key={`${edge.from}-${edge.to}`}>
                        <path
                          className="edge-path"
                          d={`M ${from.x + 180} ${from.y + 36} C ${from.x + 250} ${from.y + 36}, ${to.x - 88} ${to.y + 36}, ${to.x} ${to.y + 36}`}
                        />
                        <circle className="edge-dot" cx={to.x - 4} cy={to.y + 36} r="4" />
                      </g>
                    );
                  })
                  .filter(Boolean)}

                {graphNodes.map((node) => {
                  const isSelected = selectedFunction?.id === node.id;
                  const hasBreakpoint = breakpoints.has(node.id);
                  const isBreakpointAffected = breakpointImpactIds.has(node.id);
                  const waterRole = classifyFlowRole(node.fn);
                  return (
                    <g
                      key={node.id}
                      className={`graph-node ${isSelected ? "selected" : ""} ${hasBreakpoint ? "breakpoint" : ""} ${isBreakpointAffected ? "breakpoint-affected" : ""}`}
                      transform={`translate(${node.x}, ${node.y})`}
                      onClick={() => setSelectedId(node.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setSelectedId(node.id);
                      }}
                    >
                      <rect width="190" height="88" rx="8" />
                      <text x="14" y="25" className="node-title">
                        {shorten(node.fn.name, 22)}
                      </text>
                      <text x="14" y="49" className="node-meta">
                        {flowRoleLabel(waterRole)} · {node.fn.returnType}
                      </text>
                      <text x="14" y="70" className="node-meta">
                        {node.fn.confidence}% · {shorten(node.fn.fileName.split("/").pop() ?? node.fn.fileName, 22)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            </MovableGraphViewport>
          )}

          <div className="function-table">
            <div className="table-header">
              <span>函数</span>
              <span>数据流角色</span>
              <span>输入/输出</span>
              <span>置信度</span>
            </div>
            {functions.map((fn) => (
              <button
                className={selectedFunction?.id === fn.id ? "table-row selected" : "table-row"}
                key={fn.id}
                onClick={() => setSelectedId(fn.id)}
              >
                <span>
                  <strong>{fn.name}</strong>
                  <small>{fn.fileName}</small>
                </span>
                <span>{flowRoleLabel(classifyFlowRole(fn))}</span>
                <span>{fn.params.length ? fn.params.join(", ") : fn.outputs.join(", ")}</span>
                <span>{fn.confidence}%</span>
              </button>
            ))}
          </div>
        </section>

        {workspacePage === "inspect" && (
        <aside className="inspector-panel" aria-label="函数细节和调试仿真">
          <div className="panel-heading">
            <h2>函数检查器</h2>
            <span>{selectedFunction ? (selectedFunction.parser ?? selectedFunction.source) : "等待选择"}</span>
          </div>

          {selectedFunction ? (
            <>
              <section className="detail-section">
                <div className="function-title-line">
                  <h3>{selectedFunction.name}</h3>
                  <button
                    className={breakpoints.has(selectedFunction.id) ? "breakpoint-button active" : "breakpoint-button"}
                    onClick={() => toggleBreakpoint(selectedFunction.id)}
                  >
                    {breakpoints.has(selectedFunction.id) ? "取消断点" : "设置断点"}
                  </button>
                </div>
                <p>{selectedFunction.summary}</p>
                <dl className="meta-grid">
                  <div>
                    <dt>位置</dt>
                    <dd>
                      {selectedFunction.fileName}:{selectedFunction.startLine}
                    </dd>
                  </div>
                  <div>
                    <dt>数据类型</dt>
                    <dd>{selectedFunction.dataShape}</dd>
                  </div>
                  <div>
                    <dt>数据流角色</dt>
                    <dd>{flowRoleLabel(classifyFlowRole(selectedFunction))}</dd>
                  </div>
                  <div>
                    <dt>复杂度</dt>
                    <dd>{selectedFunction.complexity}</dd>
                  </div>
                  <div>
                    <dt>解析证据</dt>
                    <dd>{selectedFunction.parseEvidence?.slice(-2).join(" · ") ?? selectedFunction.source}</dd>
                  </div>
                </dl>
              </section>

              <section className="detail-section">
                <h3>传递数据与边界</h3>
                <div className="tag-list">
                  {[...selectedFunction.externalInputs, ...selectedFunction.validations, ...selectedFunction.sideEffects, ...selectedFunction.risks].map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                  {!selectedFunction.externalInputs.length &&
                    !selectedFunction.validations.length &&
                    !selectedFunction.sideEffects.length &&
                    !selectedFunction.risks.length && <span>未发现显式数据元素</span>}
                </div>
              </section>

              <section className="detail-section">
                <h3>检查与推荐</h3>
                <ul className="recommendation-list">
                  {buildRecommendations(selectedFunction).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            </>
          ) : (
            <p className="empty-state">导入代码后选择一个函数查看数据流、断点和修正建议。</p>
          )}
        </aside>
        )}
      </section>
      )}

      <section className={`analysis-grid page-${workspacePage}`} aria-label="深度分析模块">
        <article className="analysis-card wide-card testing-page" data-page="testing">
          <div className="panel-heading">
            <div>
              <h2>测试与验证</h2>
              <span>版本 {softwareTestReport.versionFingerprint} · 成功与失败使用同一证据口径</span>
            </div>
            <button type="button" onClick={() => navigateWorkspacePage("reports")}>查看并导出完整报告</button>
          </div>

          <section className="test-status-summary" aria-label="测试结果摘要">
            <div className="test-passed"><b>{softwareTestReport.summary.passed}</b><span>通过</span></div>
            <div className="test-failed"><b>{softwareTestReport.summary.failed}</b><span>失败</span></div>
            <div className="test-blocked"><b>{softwareTestReport.summary.blocked}</b><span>阻塞</span></div>
            <div className="test-not-run"><b>{softwareTestReport.summary["not-run"]}</b><span>未执行</span></div>
          </section>

          <section className="integrated-suite-control" aria-label="集成测试选择">
            <div className="software-subheading"><h3>集成测试入口</h3><span>勾选后按顺序执行或记录缺失条件</span></div>
            <div className="test-bubble-options">
              {integratedTestOptions.map((option) => (
                <label className={selectedIntegratedTests.includes(option.id) ? "is-selected" : ""} key={option.id}>
                  <input
                    type="checkbox"
                    checked={selectedIntegratedTests.includes(option.id)}
                    onChange={() => setSelectedIntegratedTests((current) => current.includes(option.id) ? current.filter((id) => id !== option.id) : [...current, option.id])}
                  />
                  <span>{option.label}</span>
                  <small>{option.mode === "auto" ? "自动" : option.mode === "manual" ? "人工" : "需候选"}</small>
                </label>
              ))}
            </div>
            <div className="suite-progress-panel">
              <div><strong>{integratedTestProgress.current}</strong><span>{integratedTestProgress.total ? Math.round(integratedTestProgress.completed / integratedTestProgress.total * 100) : 0}% · {integratedTestProgress.completed}/{integratedTestProgress.total}</span></div>
              <progress max={Math.max(1, integratedTestProgress.total)} value={integratedTestProgress.completed} />
              <p>{integratedTestProgress.message}{integratedTestProgress.updatedAt ? ` · 更新 ${new Date(integratedTestProgress.updatedAt).toLocaleTimeString("zh-CN")}` : ""}</p>
            </div>
            <div className="suite-control-actions">
              <button type="button" className="runtime-run-button" disabled={runtimeRunning || integratedTestProgress.running || !selectedIntegratedTests.length} onClick={() => void runIntegratedTestSuite()}>
                {integratedTestProgress.running ? "正在执行选中测试…" : "执行选中测试"}
              </button>
              <button type="button" onClick={() => setSelectedIntegratedTests(integratedTestOptions.map((option) => option.id))}>全选</button>
              <button type="button" onClick={() => setSelectedIntegratedTests([])}>清空</button>
            </div>
          </section>

          <nav className="test-action-bar" aria-label="测试执行入口">
            <button type="button" onClick={() => navigateWorkspacePage("twin")}>运行、性能与负载实验</button>
            <button type="button" onClick={() => navigateWorkspacePage("twin")}>Debug 与修复 A/B</button>
            <button type="button" onClick={() => navigateWorkspacePage("diagnostics")}>查看失败与安全问题</button>
            <button type="button" onClick={() => navigateWorkspacePage("reports")}>导出测试报告</button>
          </nav>

          {softwareTestReport.missingCapabilities.length > 0 && (
            <section className="test-missing-panel">
              <div className="software-subheading"><h3>缺失提醒</h3><span>缺失证据不会被算作通过</span></div>
              <ul>{softwareTestReport.missingCapabilities.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
          )}

          <section className="test-result-grid">
            {softwareTestReport.results.map((result) => (
              <article className={`test-result test-result-${result.status}`} key={result.id}>
                <header><h3>{result.name}</h3><span>{result.status === "passed" ? "通过" : result.status === "failed" ? "失败" : result.status === "blocked" ? "阻塞" : "未执行"}</span></header>
                <p>{result.summary}</p>
                {result.evidence.length > 0 && <details><summary>成功/失败证据 · {result.evidence.length}</summary><ul>{result.evidence.map((item) => <li key={item}>{item}</li>)}</ul></details>}
                {result.missingRequirements.length > 0 && <details open><summary>待补条件 · {result.missingRequirements.length}</summary><ul>{result.missingRequirements.map((item) => <li key={item}>{item}</li>)}</ul></details>}
                {result.defect && (
                  <details open className="test-defect-record">
                    <summary>缺陷记录 · {result.defect.severity}</summary>
                    <dl>
                      <div><dt>预期</dt><dd>{result.defect.expected}</dd></div>
                      <div><dt>实际</dt><dd>{result.defect.actual}</dd></div>
                      <div><dt>复现</dt><dd>{result.defect.reproduction}</dd></div>
                      <div><dt>修复与 Debug</dt><dd>{result.defect.recommendation}</dd></div>
                    </dl>
                  </details>
                )}
              </article>
            ))}
          </section>

          <section className="usability-checklist">
            <div className="software-subheading"><h3>可用性人工验收</h3><span>人工确认会保存在当前设备</span></div>
            <p>可用性不能只靠代码扫描判定。请实际操作后逐项确认；版本变化后仍应重新检查。</p>
            <div>
              {usabilityChecklist.map((item) => (
                <label key={item.id}>
                  <input type="checkbox" checked={(projectUsabilityChecks[activeProject.id] ?? []).includes(item.id)} onChange={() => toggleUsabilityCheck(item.id)} />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </section>
        </article>

        <article className="analysis-card wide-card settings-page" data-page="settings">
          <div className="panel-heading">
            <div><h2>本地软件设置</h2><span>设置只保存在本机，不发送到网络</span></div>
          </div>
          <div className="settings-grid">
            <section>
              <h3>PDF 报告</h3>
              <label className="settings-toggle">
                <input type="checkbox" checked={reportIncludeDetails} onChange={(event) => { setReportIncludeDetails(event.target.checked); window.localStorage.setItem("codeflow.report.includeDetails", String(event.target.checked)); }} />
                <span>导出全部折叠证据与详细记录</span>
              </label>
              <p>导出时弹出系统“另存为”，由你选择文件名和保存位置。</p>
            </section>
            <section>
              <h3>图谱默认视图</h3>
              <label><span>节点间距</span><input type="range" min="90" max="240" step="5" value={mapDefaultSpacing} onChange={(event) => { setMapDefaultSpacing(Number(event.target.value)); window.localStorage.setItem("codeflow.map.spacing", event.target.value); }} /><b>{mapDefaultSpacing}%</b></label>
              <label><span>初始缩放</span><input type="range" min="25" max="180" step="5" value={mapDefaultZoom} onChange={(event) => { setMapDefaultZoom(Number(event.target.value)); window.localStorage.setItem("codeflow.map.zoom", event.target.value); }} /><b>{mapDefaultZoom}%</b></label>
              <p>新打开的图谱读取这些值；当前图仍可使用拖动、滚轮缩放和适合窗口。</p>
            </section>
            <section>
              <h3>项目证据</h3>
              <p>Compiler/LSP、受控运行和环境检查是软件能力；每个导入项目仍需单独产生证据。静态语义可自动补齐，真实执行必须由你明确启动。</p>
              <button type="button" onClick={() => navigateWorkspacePage("twin")}>前往项目证据与实验</button>
            </section>
            <section>
              <h3>网络边界</h3>
              <p>{networkPolicy.enabled ? "公网知识更新已按白名单开放。" : "公网连接已关闭；本机和获准内网能力保持独立。"}</p>
              <button type="button" onClick={() => navigateWorkspacePage("diagnostics")}>查看本地安全防御</button>
            </section>
          </div>
        </article>

        <article className="analysis-card wide-card project-report" data-page="reports" id="project-analysis-report">
          <div className="panel-heading">
            <div>
              <h2>项目完整分析报告</h2>
              <span suppressHydrationWarning>{activeProject.name} · {new Date().toLocaleDateString("zh-CN")}</span>
            </div>
            <div className="report-export-actions">
              <button type="button" onClick={() => void exportAnalysisReport()}>导出 PDF</button>
              <small>{reportExportMessage}</small>
            </div>
          </div>
          <nav className="internal-page-directory" aria-label="报告目录">
            <a href="#report-summary">结论摘要</a>
            <a href="#report-runtime-cost">运行成本</a>
            <a href="#report-issues">问题报告</a>
            <a href="#report-security">安全报告</a>
            <a href="#report-twin">孪生报告</a>
            <a href="#report-testing">测试结果</a>
            <a href="#report-repair">修复建议</a>
            <a href="#report-extensions">扩展接口</a>
          </nav>

          <section className="report-section" id="report-summary">
            <div className="software-subheading"><h3>结论摘要</h3><span>先看结论，再看证据</span></div>
            <div className="report-summary-grid">
              <div><b>{parseResult.report.reliabilityScore}%</b><span>代码解析可靠度</span></div>
              <div><b>{analysis.closureScore}%</b><span>输入到输出完整度</span></div>
              <div><b>{issueGroupCount}</b><span>归并后的风险类型</span></div>
              <div><b>{analysis.digitalTwin.validatedExperimentCount}/{analysis.digitalTwin.experiments.length}</b><span>已验证实验</span></div>
            </div>
            <NarrativeText text={softwareInterpretation.overview} />
          </section>

          <section className="report-section" id="report-runtime-cost">
            <div className="software-subheading"><h3>运行成本与本机承载</h3><span>{runtimeCostStatusLabel(runtimeCost.status)} · {runtimeCost.score ? `${runtimeCost.score}%` : "待测"}</span></div>
            <p>{runtimeCost.summary}</p>
            <div className="report-summary-grid">
              <div><b>{formatBytes(runtimeCost.projectedPeakMemoryBytes)}</b><span>预计峰值内存</span></div>
              <div><b>{runtimeCost.projectedCpuThreads}</b><span>预计逻辑线程</span></div>
              <div><b>{formatBytes(runtimeCost.projectedDiskBytes)}</b><span>预计本地磁盘</span></div>
              <div><b>{runtimeCost.confidence}%</b><span>{runtimeCost.evidenceGrade}</span></div>
            </div>
            {runtimeCost.recommendations.map((item) => <p key={item}>{item}</p>)}
          </section>

          <section className="report-section" id="report-issues">
            <div className="software-subheading"><h3>问题报告</h3><span>{groupedIssueReport.length} 类，{analysis.issues.length} 个位置</span></div>
            <div className="report-issue-list">
              {groupedIssueReport.map((group) => (
                <details key={`${group.category}:${group.title}`}>
                  <summary><strong>{group.title}</strong><span>{issueCategoryLabel(group.category)} · {group.severity} · {group.confidence}% · {group.locations.length} 处</span></summary>
                  <p>{[...new Set(group.messages)].join(" ")}</p>
                  <small>{[...new Set(group.locations)].slice(0, 12).join("；")}</small>
                </details>
              ))}
              {!groupedIssueReport.length && <p className="empty-state">当前分析没有形成可报告的问题组。</p>}
            </div>
          </section>

          <section className="report-section" id="report-security">
            <div className="software-subheading"><h3>安全报告</h3><span>安全边界 {analysis.damScore}%</span></div>
            <p>{analysis.securityIssues.length ? `发现 ${analysis.securityIssues.length} 个受影响位置，归属于 ${new Set(analysis.securityIssues.map((issue) => normalizedIssueGroupTitle(issue.title))).size} 类安全风险。` : "当前静态与运行证据中没有确认高风险安全入口。"}</p>
            <IssueList issues={analysis.securityIssues} empty="当前没有可列出的安全问题。" />
          </section>

          <section className="report-section" id="report-twin">
            <div className="software-subheading"><h3>孪生实验报告</h3><span>保真度 {analysis.digitalTwin.fidelityScore}%</span></div>
            <div className="report-experiment-list">
              {analysis.digitalTwin.experiments.map((experiment) => (
                <section key={experiment.id}>
                  <div><strong>{experiment.kind} · {experiment.name}</strong><span>{experiment.status} · {experiment.claimStatus}</span></div>
                  <p>{experimentConclusion(experiment.status, experiment.claimStatus)}</p>
                  <small>{experiment.observedOrEstimated}</small>
                </section>
              ))}
            </div>
          </section>

          <section className="report-section" id="report-testing">
            <div className="software-subheading"><h3>测试与验证报告</h3><span>版本 {softwareTestReport.versionFingerprint}</span></div>
            <p>通过 {softwareTestReport.summary.passed} 项，失败 {softwareTestReport.summary.failed} 项，阻塞 {softwareTestReport.summary.blocked} 项，未执行 {softwareTestReport.summary["not-run"]} 项。</p>
            {softwareTestReport.missingCapabilities.length > 0 && (
              <details open><summary>缺失提醒 · {softwareTestReport.missingCapabilities.length}</summary><ul>{softwareTestReport.missingCapabilities.map((item) => <li key={item}>{item}</li>)}</ul></details>
            )}
            <div className="report-test-list">
              {softwareTestReport.results.map((result) => (
                <details open key={`report-${result.id}`}>
                  <summary><strong>{result.name}</strong><span>{result.status === "passed" ? "通过" : result.status === "failed" ? "失败" : result.status === "blocked" ? "阻塞" : "未执行"}</span></summary>
                  <p>{result.summary}</p>
                  {result.evidence.map((item) => <small key={item}>证据：{item}</small>)}
                  {result.missingRequirements.map((item) => <small key={item}>待补：{item}</small>)}
                  {result.defect && <p>缺陷 {result.defect.severity}。预期：{result.defect.expected} 实际：{result.defect.actual} 复现：{result.defect.reproduction} 建议：{result.defect.recommendation}</p>}
                </details>
              ))}
            </div>
          </section>

          <section className="report-section" id="report-repair">
            <div className="software-subheading"><h3>修复建议与验证状态</h3><span>{repairResult?.experiment?.status ?? "尚未运行 A/B"}</span></div>
            <p>{repairMessage}</p>
            <div className="report-repair-grid">
              <div><strong>建议来源</strong><span>{repairReason}</span></div>
              <div><strong>候选状态</strong><span>{repairResult?.patch.status ?? "未生成 Diff"}</span></div>
              <div><strong>审批状态</strong><span>{repairApproval ? "当前哈希已批准" : "未批准"}</span></div>
              <div><strong>恢复能力</strong><span>{repairRollbacks[activeProject.id] ? "已有校验快照" : "写回后生成快照"}</span></div>
            </div>
          </section>

          <section className="report-section" id="report-extensions">
            <div className="software-subheading"><h3>统一扩展接口</h3><span>Adapter Contract 1.0</span></div>
            <p>新增解析器、运行器、调试器、知识包或报告模块时，都必须声明输入、输出、健康检查和隔离方式，不能直接绕过现有安全边界。</p>
            <div className="extension-adapter-grid">
              {extensionAdapters.map((adapter) => (
                <div key={adapter.id}>
                  <strong>{adapter.id}</strong>
                  <span>{adapter.kind} · v{adapter.contractVersion} · {adapter.isolation}</span>
                  <small>{adapter.input} → {adapter.output}</small>
                  <small>自检：{adapter.healthCheck}</small>
                </div>
              ))}
            </div>
          </section>
        </article>

        <article className="analysis-card wide-card" data-page="files" id="file-index">
          <div className="panel-heading">
            <h2>文件页</h2>
            <span>{activeProject.name}</span>
          </div>
          <div className="file-layer-list">
            {fileSummaries.map((file) => (
              <section key={file.id}>
                <div>
                  <h3>{file.name}</h3>
                  <span>{file.language}</span>
                </div>
                <p>
                  这个文件包含 {file.functions.length} 个可执行函数和 {file.declarations.length} 个类型/数据模型，
                  当前识别职责为 {file.roles.join("、") || "待归纳"}；文件大小约 {file.size} 字符，关联问题 {file.issueCount} 个。
                </p>
                <div className="software-action-line">
                  {file.functions.slice(0, 10).map((fn) => (
                    <button key={fn.id} onClick={() => { setSelectedId(fn.id); navigateWorkspacePage("inspect"); }}>
                      {fn.name}
                    </button>
                  ))}
                </div>
                {file.declarations.length > 0 && (
                  <div className="file-declaration-list" aria-label={`${file.name} 类型与数据模型`}>
                    {file.declarations.map((declaration) => (
                      <details key={declaration.id} className="file-declaration-card">
                        <summary>
                          <span>
                            <strong>{declaration.name}</strong>
                            <small>{declaration.kind} · {declaration.role}</small>
                          </span>
                          <b>{declaration.fields.length} 字段</b>
                        </summary>
                        <div className="declaration-meta">
                          <span>继承：{declaration.baseTypes.join("、") || "无"}</span>
                          <span>位置：第 {declaration.startLine} 行</span>
                          <span>解析：{declaration.parser} · {declaration.confidence}%</span>
                        </div>
                        {declaration.fields.length > 0 ? (
                          <div className="declaration-field-grid">
                            {declaration.fields.map((field) => (
                              <div key={`${declaration.id}:${field.name}`}>
                                <strong>{field.name}</strong>
                                <code>{field.type}</code>
                                <span>{field.required ? "必填" : `可选${field.defaultValue !== undefined ? ` · 默认 ${field.defaultValue}` : ""}`}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="declaration-inheritance-note">
                            该模型没有新增字段，主要复用 {declaration.baseTypes.join("、") || "基类"} 的字段约束。
                          </p>
                        )}
                        {declaration.configuration.length > 0 && (
                          <small className="declaration-config">配置：{declaration.configuration.join(" · ")}</small>
                        )}
                      </details>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </article>

        <article className="analysis-card wide-card" data-page="modules">
          <div className="panel-heading">
            <h2>模块页</h2>
            <span>跨文件功能域</span>
          </div>
          <div className="module-page-list">
            {softwareInterpretation.modules.map((module) => (
              <section key={module.id}>
                <div className="software-module-head">
                  <h3>{module.title}</h3>
                  <span>{module.confidence}%</span>
                </div>
                <p>{module.purpose}</p>
                <small>{module.evidence}</small>
                <div className="module-function-grid">
                  {module.functions.map((fn) => (
                    <button key={fn.id} onClick={() => { setSelectedId(fn.id); navigateWorkspacePage("inspect"); }}>
                      <strong>{fn.name}</strong>
                      <span>{fn.description}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </article>

        <article className="analysis-card wide-card software-analysis-page" data-page="files" id="software-analysis">
          <div className="panel-heading">
            <h2>项目与文件解析</h2>
            <span>{softwareInterpretation.coverage.status} · 结构覆盖 {softwareInterpretation.coverage.score}%</span>
          </div>
          <nav className="internal-page-directory" aria-label="本页目录">
            <a href="#software-overview">总体说明</a>
            <a href="#software-architecture">软件架构</a>
            <a href="#design-report">设计反推</a>
            <a href="#file-responsibilities">文件职责</a>
          </nav>
          <div className="explanation-coverage-strip" aria-label="解读覆盖率">
            {[
              ["文件", softwareInterpretation.coverage.fileCoverage],
              ["函数", softwareInterpretation.coverage.functionCoverage],
              ["模块", softwareInterpretation.coverage.moduleCoverage],
              ["主流程", softwareInterpretation.coverage.flowCoverage],
              ["证据", softwareInterpretation.coverage.evidenceCoverage],
            ].map(([label, score]) => (
              <span key={label}>
                <b>{score}%</b>
                {label}
              </span>
            ))}
          </div>
          <div className="software-parse-grid" id="software-overview">
            <section>
              <h3>技术说明</h3>
              <NarrativeText text={softwareInterpretation.technical} />
            </section>
            <section>
              <h3>功能解读</h3>
              <NarrativeText text={softwareInterpretation.overview} />
            </section>
          </div>

          <div className="software-analysis-block" id="software-architecture">
            <div className="software-subheading">
              <h3>软件架构</h3>
              <span>{softwareInterpretation.modules.length} 个协作模块</span>
            </div>
            <NarrativeText text={softwareInterpretation.architecture} className="software-architecture-text" />
            {softwareInterpretation.coverage.gaps.length > 0 && (
              <div className="explanation-gap-list">
                {softwareInterpretation.coverage.gaps.map((gap) => <span key={gap}>{gap}</span>)}
              </div>
            )}
          </div>

          <div className="software-analysis-block" id="design-report">
            <div className="software-subheading">
              <h3>设计反推报告</h3>
              <span>{softwareInterpretation.designReport.length} 段说明</span>
            </div>
            <div className="software-report-list">
              {softwareInterpretation.designReport.map((block) => (
                <section key={block.title}>
                  <h4>{block.title}</h4>
                  <NarrativeText text={block.body} />
                </section>
              ))}
            </div>
          </div>

          <div className="software-analysis-block" id="file-responsibilities">
            <div className="software-subheading">
              <h3>文件职责清单</h3>
              <span>{softwareInterpretation.files.length} 个文件</span>
            </div>
            <div className="software-file-explanation-list">
              {softwareInterpretation.files.map((file) => (
                <section key={file.id}>
                  <div>
                    <strong>{file.path}</strong>
                    <span>{file.language} · {file.role}</span>
                  </div>
                  <p>{file.responsibility}</p>
                  <small>{file.evidence}</small>
                  {file.functions.length > 0 && <code>{file.functions.join(" · ")}</code>}
                </section>
              ))}
            </div>
          </div>
        </article>

        <article className="analysis-card wide-card software-analysis-page function-analysis-explanation" data-page="inspect">
          <div className="panel-heading">
            <div>
              <h2>功能与函数解读</h2>
              <span>从功能模块进入每个函数的输入、处理、输出与证据</span>
            </div>
          </div>
          <nav className="internal-page-directory function-directory" aria-label="函数解读目录">
            <a href="#module-inventory">功能模块</a>
            <a href="#main-flow">完整主流程</a>
            <a href="#evidence-sources">解析证据</a>
            <a href="#function-graph">返回函数图</a>
            <label>
              <span>搜索函数</span>
              <input value={functionSearch} onChange={(event) => setFunctionSearch(event.target.value)} placeholder="名称、职责、算法或文件" />
            </label>
          </nav>
          <div className="software-analysis-block" id="module-inventory">
            <div className="software-subheading">
              <h3>功能模块清单</h3>
              <span>{softwareInterpretation.modules.length} 个模块</span>
            </div>
            <div className="software-module-list">
              {softwareInterpretation.modules.map((module) => {
                const query = functionSearch.trim().toLocaleLowerCase();
                const visibleFunctions = query
                  ? module.functions.filter((fn) => `${fn.name} ${fn.technical} ${fn.description} ${fn.processing} ${fn.algorithm} ${fn.evidence}`.toLocaleLowerCase().includes(query))
                  : module.functions;
                if (query && !visibleFunctions.length && !`${module.title} ${module.purpose}`.toLocaleLowerCase().includes(query)) return null;
                return (
                <section key={module.id} id={`module-${module.id}`} className="software-module-section">
                  <div className="software-module-head">
                    <h4>{module.title}</h4>
                    <span>{module.confidence}%</span>
                  </div>
                  <p>{module.purpose}</p>
                  <div className="software-action-line">
                    {module.actions.map((action) => (
                      <span key={action}>{action}</span>
                    ))}
                  </div>
                  <small>{module.evidence}</small>
                  <div className="software-subheading compact">
                    <h3>函数职责详解</h3>
                    <span>{module.functions.length} 个函数</span>
                  </div>
                  <ol className="software-function-list">
                    {visibleFunctions.map((fn) => (
                      <li key={fn.id}>
                        <strong>{fn.name}</strong>
                        <code>技术标注：{fn.technical}</code>
                        <span>作用说明：{fn.description}</span>
                        <dl className="function-explanation-contract">
                          <div><dt>输入</dt><dd>{fn.inputs}</dd></div>
                          <div><dt>处理</dt><dd>{fn.processing}</dd></div>
                          <div><dt>输出</dt><dd>{fn.outputs}</dd></div>
                          <div><dt>算法</dt><dd>{fn.algorithm}</dd></div>
                          <div><dt>数据结构</dt><dd>{fn.dataStructures.join("、") || "未识别专用容器"}</dd></div>
                          <div><dt>边界</dt><dd>{fn.guards}</dd></div>
                        </dl>
                        <span className={`function-certainty certainty-${fn.certainty}`}>{fn.certainty} · {fn.uncertainty}</span>
                        <small>{fn.evidence}</small>
                      </li>
                    ))}
                  </ol>
                </section>
              );})}
            </div>
          </div>

          <div className="software-analysis-block" id="main-flow">
            <div className="software-subheading">
              <h3>完整主流程</h3>
              <span>{softwareInterpretation.flow.length} 个步骤</span>
            </div>
            <ol className="software-flow-list">
              {softwareInterpretation.flow.map((step) => (
                <li key={step.id}>
                  <b>{String(step.index).padStart(2, "0")}</b>
                  <div>
                    <strong>{step.technical}</strong>
                    <span>{step.description}</span>
                    <small>{step.evidence}</small>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="software-analysis-block" id="evidence-sources">
            <div className="software-subheading">
              <h3>证据来源</h3>
              <span>{softwareInterpretation.evidence.length} 类证据</span>
            </div>
            <div className="software-evidence-grid">
              {softwareInterpretation.evidence.map((item) => (
                <div key={item.label}>
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </article>

        <article className="analysis-card wide-card" data-page="hardcore">
          <div className="panel-heading">
            <h2>分析内核职责</h2>
            <span>当前程序内部模块边界</span>
          </div>
          <LogicInventoryPanel items={logicInventory} />
        </article>

        <article className="analysis-card wide-card" data-page="hardcore">
          <div className="panel-heading">
            <h2>全语言解析验收</h2>
            <span>
              {parseResult.report.languageCoverage?.filter((item) => item.status === "ast-ready").length ?? 0}/
              {parseResult.report.languageCoverage?.length ?? 0} 当前语言 AST 完整
            </span>
          </div>
          <p className="software-brief">
            “支持”按当前项目逐语言验收：语法层必须真实生成 AST；语义层必须明确标出 Compiler/LSP
            是否执行。缺失工具、语法错误和不适用状态分别显示，不用总分掩盖。
          </p>
          <div className="language-capability-grid">
            {(parseResult.report.languageCoverage ?? []).map((item) => (
              <div className={`language-capability language-capability-${item.status}`} key={item.language}>
                <div>
                  <strong>{item.language}</strong>
                  <span>{item.status}</span>
                </div>
                <p>
                  AST {item.parsedFileCount}/{item.fileCount} 文件 · {item.functionCount} 函数 · {item.diagnosticCount} 语法诊断
                </p>
                <small>
                  语义：{item.semanticLayer ?? "等待语义融合"} · {item.semanticStatus ?? "pending"}
                </small>
              </div>
            ))}
            {!parseResult.report.languageCoverage?.length ? (
              <p className="runtime-message">请在桌面程序中导入代码项目，Tree-sitter 完成后会生成逐语言验收结果。</p>
            ) : null}
          </div>
        </article>

        <article className="analysis-card wide-card" data-page="hardcore">
          <div className="panel-heading">
            <h2>LSP Sidecar 管理</h2>
            <span>
              {lspSidecars.status} · {lspSidecars.availableCount}/{lspSidecars.toolCount} 可用 · {lspSidecars.verifiedCount} 校验
            </span>
          </div>
          <p className="software-brief">
            默认解析链优先使用校验锁定的桌面 sidecar，其次使用应用数据目录中的受管工具，最后才回退到系统安装。
            只有哈希与构建锁一致的工具会标记为“已校验”；系统工具可以真实执行，但不会冒充安装包内置能力。
          </p>
          <div className="runtime-tool-grid">
            {lspSidecars.tools.map((tool) => (
              <div className={tool.available ? "runtime-tool-ready" : "runtime-tool-missing"} key={tool.id}>
                <strong>{tool.label}</strong>
                <span>
                  {tool.state} · {tool.verified ? "已校验" : tool.available ? "未锁定" : "不可用"}
                </span>
                <small>{tool.version || tool.evidence}</small>
                <small>{tool.languages.join(" / ")} · {tool.packageKind}</small>
                <button
                  disabled={lspSidecars.status === "web-preview"}
                  onClick={() => {
                    void setLspSidecarEnabled(tool.id, !tool.enabled).then(setLspSidecars);
                  }}
                >
                  {tool.enabled ? "停用" : "启用"}
                </button>
              </div>
            ))}
          </div>
          <p className="runtime-message">
            平台：{lspSidecars.target}。{lspSidecars.evidence.join(" ")}
          </p>
        </article>

        <article className="analysis-card wide-card" data-page="hardcore">
          <div className="panel-heading">
            <h2>桌面调试运行器</h2>
            <span>
              {debugAvailability.status} · {debugAvailability.availableCount}/{debugAvailability.totalCount} 启动器 · {debugAvailability.adapters.filter((adapter) => adapter.verified).length} 已认证
            </span>
          </div>
          <p className="software-brief">
            本软件通过 Tauri IPC 调用本地调试内核，不部署 localhost 网站或 HTTP 后端。Node 使用 vscode-js-debug，Python 使用
            debugpy，Java 由 JDT LS 装载 java-debug-server，Rust、C 和 C++ 共用 lldb-dap。少数调试协议需要端口时，只允许在单次
            会话内使用 127.0.0.1 内部 DAP IPC，外部网络仍被 macOS 沙箱拒绝，会话结束后立即关闭。
          </p>
          <div className="runtime-tool-grid">
            {debugAvailability.adapters.map((adapter) => (
              <div className={adapter.verified ? "runtime-tool-ready" : "runtime-tool-missing"} key={`debug-${adapter.adapter}`}>
                <strong>{adapter.adapter.toUpperCase()}</strong>
                <span>{adapter.backend} · {adapter.optional ? "嵌入式预留接口" : adapter.verified ? "包已认证" : adapter.available ? "已探测，未认证" : "未安装"}</span>
                <small>{adapter.version || adapter.evidence}</small>
                <small>{adapter.executablePath || "等待桌面 sidecar 安装"}</small>
              </div>
            ))}
            {!debugAvailability.adapters.length ? (
              <p className="runtime-message">请在 Tauri 桌面程序中检查调试 sidecar；浏览器预览不会创建模拟调试器。</p>
            ) : null}
          </div>
          <p className="runtime-message">
            {debugAvailability.evidence.join(" ")} 包认证只证明文件可信；真实回放验收还必须经过断点命中、栈/作用域/变量、继续执行和进程清理。
          </p>
        </article>

        <article className="analysis-card wide-card" data-page="hardcore">
          <div className="panel-heading">
            <h2>本地库体检</h2>
            <span>知识库/数据底座</span>
          </div>
          <div className="library-audit-grid">
            {analysis.localLibraryAudit.map((item) => (
              <div className={`library-row library-${item.status}`} key={item.name}>
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    {item.priority} · {item.status}
                  </span>
                </div>
                <p>
                  <b>{item.category}</b> · {item.purpose}
                </p>
                <label className="library-coverage">
                  <b>{item.coverage}%</b>
                  <i style={{ width: `${item.coverage}%` }} />
                </label>
                <small>数据范围：{item.dataScope}</small>
                <small>{item.recommendation}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="analysis-card wide-card" data-page="hardcore">
          <div className="panel-heading">
            <h2>规则覆盖自检</h2>
            <span>
              {analysis.knowledgeRuleCoverage.overall}% · {analysis.knowledgeRuleCoverage.status}
            </span>
          </div>
          <p className="completion-summary">{analysis.knowledgeRuleCoverage.summary}</p>
          <div className="hardcore-metrics">
            <span>
              <b>{analysis.knowledgeRuleCoverage.ruleCount}</b>
              规则
            </span>
            <span>
              <b>{analysis.knowledgeRuleCoverage.conceptCount}</b>
              概念
            </span>
            <span>
              <b>{analysis.knowledgeRuleCoverage.evidenceCount}</b>
              证据
            </span>
            <span>
              <b>{analysis.knowledgeRuleCoverage.languageApiCount}</b>
              API
            </span>
          </div>
          <div className="rule-evolution-grid">
            {analysis.knowledgeRuleCoverage.evolution.map((stage) => (
              <div className={`rule-evolution-card evolution-${stage.status}`} key={stage.id}>
                <div>
                  <strong>{stage.name}</strong>
                  <span>
                    {stage.layer} · {stage.status}
                  </span>
                </div>
                <label>
                  <b>{stage.coverage}%</b>
                  <i style={{ width: `${stage.coverage}%` }} />
                </label>
                <small>{stage.summary}</small>
                <small>{stage.next}</small>
              </div>
            ))}
          </div>
          <div className="rule-coverage-grid">
            {analysis.knowledgeRuleCoverage.areas.map((area) => (
              <div className={`rule-coverage-area rule-coverage-${area.status}`} key={area.category}>
                <div>
                  <strong>{area.label}</strong>
                  <span>
                    {area.ruleCount}/{area.targetCount} · {area.percent}%
                  </span>
                </div>
                <label>
                  <b>{area.percent}%</b>
                  <i style={{ width: `${area.percent}%` }} />
                </label>
                <small>{area.missing.length ? `缺口：${area.missing.join(", ")}` : "关键标签已覆盖。"}</small>
                <small>{area.next}</small>
              </div>
            ))}
          </div>
          <div className="coverage-gap-grid">
            <section>
              <h3>已完成</h3>
              <ul>
                {analysis.knowledgeRuleCoverage.completed.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
            <section>
              <h3>仍需补漏</h3>
              <ul>
                {analysis.knowledgeRuleCoverage.gaps.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          </div>
        </article>

        <article className="analysis-card wide-card" data-page="hardcore">
          <div className="panel-heading">
            <h2>本地函数图索引</h2>
            <span>
              {analysis.semanticIndex.adapterName} · {analysis.semanticIndex.integrityScore}%
            </span>
          </div>
          <div className="hardcore-grid">
            <div className="hardcore-metrics">
              <span>
                <b>{analysis.semanticIndex.fileCount}</b>
                文件
              </span>
              <span>
                <b>{analysis.semanticIndex.functionCount}</b>
                函数
              </span>
              <span>
                <b>{analysis.semanticIndex.symbolCount}</b>
                符号
              </span>
              <span>
                <b>{analysis.semanticIndex.callEdgeCount}</b>
                调用边
              </span>
              <span>
                <b>{analysis.semanticIndex.flowEdgeCount}</b>
                数据流边
              </span>
              <span>
                <b>{analysis.semanticIndex.knowledgeItemCount}</b>
                知识项
              </span>
              <span>
                <b>{analysis.semanticIndex.deepDatabase.tableCount}</b>
                DB表
              </span>
              <span>
                <b>{analysis.semanticIndex.deepDatabase.seedRowCount}</b>
                深层种子
              </span>
            </div>
            <div className="deep-db-summary">
              <div>
                <strong>Code Flow 本地数据库</strong>
                <span>
                  {analysis.semanticIndex.deepDatabase.coverage}% · {analysis.semanticIndex.deepDatabase.status}
                </span>
              </div>
              <p>
                已激活 {analysis.semanticIndex.deepDatabase.activeTableCount} 张核心表，
                已规划 {analysis.semanticIndex.deepDatabase.seededTableCount} 张可落地表；
                缺口层：
                {analysis.semanticIndex.deepDatabase.missingLayers.join("、") || "核心层已覆盖"}。
              </p>
              <ul>
                {analysis.semanticIndex.deepDatabase.completed.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="deep-db-summary deepweb-summary">
              <div>
                <strong>DeepWeb 神经数据库</strong>
                <span>
                  {analysis.semanticIndex.deepDatabase.deepWeb.coverage}% · {analysis.semanticIndex.deepDatabase.deepWeb.status}
                </span>
              </div>
              <p>
                {analysis.semanticIndex.deepDatabase.deepWeb.mode} · 多维特征
                {analysis.semanticIndex.deepDatabase.deepWeb.activeDimensionCount}/
                {analysis.semanticIndex.deepDatabase.deepWeb.dimensionCount} 激活；
                语言适配 {analysis.semanticIndex.deepDatabase.deepWeb.languageAdaptabilityScore}%；
                生成向量 {analysis.semanticIndex.deepDatabase.deepWeb.generatedVectorCount}。
              </p>
              <div className="hardcore-metrics">
                <span>
                  <b>{analysis.semanticIndex.deepDatabase.deepWeb.modelLayerCount}</b>
                  模型层
                </span>
                <span>
                  <b>{analysis.semanticIndex.deepDatabase.deepWeb.projectionCount}</b>
                  投影边
                </span>
                <span>
                  <b>{analysis.semanticIndex.deepDatabase.deepWeb.adapterCount}</b>
                  语言适配器
                </span>
                <span>
                  <b>{analysis.semanticIndex.deepDatabase.deepWeb.trainingSampleCount}</b>
                  训练样本
                </span>
                <span>
                  <b>{analysis.semanticIndex.deepDatabase.deepWeb.supervised.teacherSampleCount}</b>
                  老师标签
                </span>
                <span>
                  <b>{analysis.semanticIndex.deepDatabase.deepWeb.supervised.matchedTeacherCount}</b>
                  监督命中
                </span>
                <span>
                  <b>{analysis.semanticIndex.deepDatabase.deepWeb.supervised.quarantinedSampleCount}</b>
                  隔离样本
                </span>
                <span>
                  <b>{analysis.semanticIndex.deepDatabase.deepWeb.supervised.conflictCount}</b>
                  老师冲突
                </span>
                <span>
                  <b>{analysis.semanticIndex.deepDatabase.deepWeb.inferenceRunCount}</b>
                  推理运行
                </span>
                <span>
                  <b>{analysis.semanticIndex.deepDatabase.deepWeb.supervised.centroids.length}</b>
                  类别中心
                </span>
                <span>
                  <b>{analysis.semanticIndex.deepDatabase.deepWeb.selfSupervised.contrastivePairCount}</b>
                  对比样本
                </span>
                <span>
                  <b>{analysis.semanticIndex.deepDatabase.deepWeb.validationScenarioCount}</b>
                  验证场景
                </span>
                <span>
                  <b>{analysis.semanticIndex.deepDatabase.deepWeb.validationEvidenceCount}</b>
                  验证证据
                </span>
                <span>
                  <b>{analysis.semanticIndex.deepDatabase.deepWeb.extremePassCount}/{analysis.semanticIndex.deepDatabase.deepWeb.extremeTestCount}</b>
                  极限测试
                </span>
                <span>
                  <b>{analysis.semanticIndex.deepDatabase.deepWeb.optimizationScore}%</b>
                  优化门槛
                </span>
                <span>
                  <b>{analysis.semanticIndex.deepDatabase.deepWeb.irrigationScore}%</b>
                  浇灌稳定门
                </span>
                <span>
                  <b>{analysis.semanticIndex.deepDatabase.deepWeb.irrigation.acceptedEvidenceCount}</b>
                  吸收证据
                </span>
                <span>
                  <b>
                    {analysis.semanticIndex.deepDatabase.deepWeb.maturity.matureValidationCount}/
                    {analysis.semanticIndex.deepDatabase.deepWeb.maturity.targetCount}
                  </b>
                  成熟验证
                </span>
              </div>
              <div className="deepweb-learning-panel">
                <div>
                  <strong>专家监督学习闭环</strong>
                  <span>
                    {analysis.semanticIndex.deepDatabase.deepWeb.supervised.status} ·
                    loss {analysis.semanticIndex.deepDatabase.deepWeb.supervised.lossBefore} -&gt;
                    {analysis.semanticIndex.deepDatabase.deepWeb.supervised.lossAfter}
                  </span>
                </div>
                <p>
                  老师样本 {analysis.semanticIndex.deepDatabase.deepWeb.supervised.teacherSampleCount}；
                  命中 {analysis.semanticIndex.deepDatabase.deepWeb.supervised.matchedTeacherCount}；
                  纠错 {analysis.semanticIndex.deepDatabase.deepWeb.supervised.correctedPredictionCount}；
                  信任 {analysis.semanticIndex.deepDatabase.deepWeb.supervised.trustScore}%；
                  共识 {analysis.semanticIndex.deepDatabase.deepWeb.supervised.consensusRate}%。
                </p>
                <small>
                  校准权重：
                  {Object.entries(analysis.semanticIndex.deepDatabase.deepWeb.supervised.calibrationWeights)
                    .slice(0, 6)
                    .map(([key, value]) => `${key}:${value}`)
                    .join(" · ")}
                </small>
              </div>
              <div className="deepweb-learning-panel deepweb-guard-panel">
                <div>
                  <strong>可训练神经分类头</strong>
                  <span>
                    {analysis.semanticIndex.deepDatabase.deepWeb.trainableHead.status} ·
                    {analysis.semanticIndex.deepDatabase.deepWeb.trainableHead.architecture}
                  </span>
                </div>
                <p>
                  训练 {analysis.semanticIndex.deepDatabase.deepWeb.trainableHead.trainingSampleCount}；
                  验证 {analysis.semanticIndex.deepDatabase.deepWeb.trainableHead.validationSampleCount}；
                  类别 {analysis.semanticIndex.deepDatabase.deepWeb.trainableHead.classCount}/6；
                  epoch {analysis.semanticIndex.deepDatabase.deepWeb.trainableHead.epochCount}；
                  验证改善 {analysis.semanticIndex.deepDatabase.deepWeb.trainableHead.improvement}%。
                </p>
                <small>
                  validation loss {analysis.semanticIndex.deepDatabase.deepWeb.trainableHead.validationLossBefore} -&gt;
                  {analysis.semanticIndex.deepDatabase.deepWeb.trainableHead.validationLossAfter}；
                  {analysis.semanticIndex.deepDatabase.deepWeb.trainableHead.inherited
                    ? `已继承稳定父模型 ${deepWebBaseline?.id ?? "native SQLite baseline"}`
                    : "当前没有可继承的稳定父模型"}。
                </small>
              </div>
              <div className="deepweb-learning-panel deepweb-guard-panel">
                <div>
                  <strong>防错护栏</strong>
                  <span>{analysis.semanticIndex.deepDatabase.deepWeb.supervised.rollbackSnapshot.trigger}</span>
                </div>
                <p>
                  隔离 {analysis.semanticIndex.deepDatabase.deepWeb.supervised.quarantinedSampleCount}；
                  冲突 {analysis.semanticIndex.deepDatabase.deepWeb.supervised.conflictCount}；
                  误报护栏 {analysis.semanticIndex.deepDatabase.deepWeb.supervised.falsePositiveGuardCount}。
                </p>
                <small>{analysis.semanticIndex.deepDatabase.deepWeb.supervised.rollbackSnapshot.rollbackPolicy}</small>
              </div>
              <div className="deepweb-learning-panel deepweb-evolution-panel">
                <div>
                  <strong>基因进化层</strong>
                  <span>
                    {analysis.semanticIndex.deepDatabase.deepWeb.evolution.status} ·
                    fitness {analysis.semanticIndex.deepDatabase.deepWeb.evolution.fitnessScore}%
                  </span>
                </div>
                <p>
                  基因 {analysis.semanticIndex.deepDatabase.deepWeb.evolution.geneCount}；
                  基因组 {analysis.semanticIndex.deepDatabase.deepWeb.evolution.generationCount}；
                  错误信号 {analysis.semanticIndex.deepDatabase.deepWeb.evolution.errorSignalCount}；
                  接受变异 {analysis.semanticIndex.deepDatabase.deepWeb.evolution.acceptedMutationCount}。
                </p>
                <small>
                  选中 {analysis.semanticIndex.deepDatabase.deepWeb.evolution.selectedGenomeId}：
                  {analysis.semanticIndex.deepDatabase.deepWeb.evolution.expressionSummary.join(" ")}
                </small>
              </div>
              <div className="deepweb-learning-panel deepweb-candidate-panel">
                <div>
                  <strong>自监督候选层</strong>
                  <span>
                    {analysis.semanticIndex.deepDatabase.deepWeb.selfSupervised.status} ·
                    loss {analysis.semanticIndex.deepDatabase.deepWeb.selfSupervised.lossBefore} -&gt;
                    {analysis.semanticIndex.deepDatabase.deepWeb.selfSupervised.lossAfter}
                  </span>
                </div>
                <p>
                  伪标签 {analysis.semanticIndex.deepDatabase.deepWeb.selfSupervised.pseudoLabelCount}；
                  改善 {analysis.semanticIndex.deepDatabase.deepWeb.selfSupervised.improvement}%；
                  学习率 {analysis.semanticIndex.deepDatabase.deepWeb.selfSupervised.learningRate}。
                </p>
                <small>
                  候选权重：
                  {Object.entries(analysis.semanticIndex.deepDatabase.deepWeb.selfSupervised.updatedWeights)
                    .slice(0, 6)
                    .map(([key, value]) => `${key}:${value}`)
                    .join(" · ")}
                </small>
              </div>
              <div className="deepweb-learning-panel deepweb-maturity-panel">
                <div>
                  <strong>DeepWeb 证据质量</strong>
                  <span>
                    {analysis.semanticIndex.deepDatabase.deepWeb.maturity.status} ·
                    {analysis.semanticIndex.deepDatabase.deepWeb.maturity.score}%
                  </span>
                </div>
                <p>
                  缺失 {analysis.semanticIndex.deepDatabase.deepWeb.maturity.missingCount}；
                  基础覆盖 {analysis.semanticIndex.deepDatabase.deepWeb.maturity.baseCoverageCount}；
                  成熟验证 {analysis.semanticIndex.deepDatabase.deepWeb.maturity.matureValidationCount}；
                  场景通过 {analysis.semanticIndex.deepDatabase.deepWeb.maturity.passedScenarioCount}/
                  {analysis.semanticIndex.deepDatabase.deepWeb.maturity.validationScenarioCount}。
                </p>
                <small>{analysis.semanticIndex.deepDatabase.deepWeb.maturity.next}</small>
              </div>
              <div className="deepweb-learning-panel deepweb-optimization-panel">
                <div>
                  <strong>极限测试优化</strong>
                  <span>
                    {analysis.semanticIndex.deepDatabase.deepWeb.optimization.status} ·
                    {analysis.semanticIndex.deepDatabase.deepWeb.optimization.score}%
                  </span>
                </div>
                <p>
                  数据库 {analysis.semanticIndex.deepDatabase.deepWeb.optimization.databaseScore}%；
                  DeepWeb {analysis.semanticIndex.deepDatabase.deepWeb.optimization.deepWebScore}%；
                  极限测试 {analysis.semanticIndex.deepDatabase.deepWeb.optimization.passedExtremeTests}/
                  {analysis.semanticIndex.deepDatabase.deepWeb.optimization.totalExtremeTests}。
                </p>
                <small>
                  {analysis.semanticIndex.deepDatabase.deepWeb.optimization.bottlenecks.join("、") ||
                    analysis.semanticIndex.deepDatabase.deepWeb.optimization.next}
                </small>
              </div>
              <div className="deepweb-learning-panel deepweb-irrigation-panel">
                <div>
                  <strong>监督浇灌迭代</strong>
                  <span>
                    {analysis.semanticIndex.deepDatabase.deepWeb.irrigation.status} ·
                    {analysis.semanticIndex.deepDatabase.deepWeb.irrigation.stabilityScore}%
                  </span>
                </div>
                <p>
                  流入 {analysis.semanticIndex.deepDatabase.deepWeb.irrigation.evidenceInflowCount}；
                  吸收 {analysis.semanticIndex.deepDatabase.deepWeb.irrigation.acceptedEvidenceCount}；
                  隔离 {analysis.semanticIndex.deepDatabase.deepWeb.irrigation.isolatedEvidenceCount}；
                  权重更新 {analysis.semanticIndex.deepDatabase.deepWeb.irrigation.weightUpdateCount}。
                </p>
                <small>{analysis.semanticIndex.deepDatabase.deepWeb.irrigation.next}</small>
              </div>
              <div className="deepweb-learning-panel deepweb-memory-panel">
                <div>
                  <strong>DeepWeb 回放记忆库</strong>
                  <span>
                    {replayMemoryReport.status} · {replayMemoryReport.memoryHealthScore}%
                  </span>
                </div>
                <p>
                  历史快照 {replayMemoryReport.snapshotCount}；
                  稳定基线 {replayMemoryReport.stableSnapshotCount}；
                  回放准备 {replayMemoryReport.replayReadinessScore}%；
                  晋级分 {replayMemoryReport.promotionScore}%；
                  退化风险 {replayMemoryReport.regressionRiskScore}%。
                </p>
                <small>{replayMemoryReport.comparison.evidence}</small>
                <button className="memory-clear-button" onClick={clearReplayMemory}>
                  清空本地记忆
                </button>
              </div>
              <div className="deepweb-learning-panel deepweb-sqlite-panel">
                <div>
                  <strong>SQLite-ready 本地同步</strong>
                  <span>
                    {sqliteJournalReport.status} · {sqliteJournalReport.rowCount} rows
                  </span>
                </div>
                <p>
                  表 {sqliteJournalReport.tableCount}；
                  快照 {sqliteJournalReport.snapshotRows}；
                  对比 {sqliteJournalReport.comparisonRows}；
                  晋级 {sqliteJournalReport.promotionRows}；
                  待同步 {sqliteJournalReport.pendingRows}。
                </p>
                <small>{sqliteJournalReport.next}</small>
                <code className="sqlite-preview">
                  {shorten(sqliteJournalReport.sqlPreview || "等待生成 SQL journal", 240)}
                </code>
                <button className="memory-clear-button" onClick={clearSqliteJournal}>
                  清空同步日志
                </button>
              </div>
              <div className="deepweb-learning-panel deepweb-opfs-panel">
                <div>
                  <strong>sql.js/OPFS SQLite 查询库</strong>
                  <span>
                    {opfsSqliteReport.status} · {opfsSqliteReport.queryableRows} rows
                  </span>
                </div>
                <p>
                  表 {opfsSqliteReport.tableCount}；
                  文件 {Math.ceil(opfsSqliteReport.databaseBytes / 1024)} KB；
                  引擎 {opfsSqliteReport.storageMode}。
                </p>
                <small>{opfsSqliteReport.evidence}</small>
                <small>{opfsSqliteReport.next}</small>
                <code className="sqlite-preview">
                  {shorten(opfsSqliteReport.queryPreview || "等待 SQLite SELECT 查询预览", 240)}
                </code>
                {opfsSqliteReport.sampleRows.length > 0 && (
                  <div className="sqlite-sample-list">
                    {opfsSqliteReport.sampleRows.slice(0, 3).map((row, index) => (
                      <small key={`${String(row.project_name ?? "project")}-${index}`}>
                        样例 {String(row.project_name ?? "unknown")} · DeepWeb {String(row.deepweb_coverage ?? "-")} ·
                        证据吸收 {String(row.irrigation_score ?? "-")} · {String(row.status ?? "unknown")}
                      </small>
                    ))}
                  </div>
                )}
                <small>{opfsSqliteExportMessage}</small>
                <div className="engine-action-row">
                  <button className="memory-clear-button" onClick={exportOpfsSqliteDatabase}>
                    导出 SQLite 数据库
                  </button>
                  <button className="memory-clear-button" onClick={clearOpfsSqliteStore}>
                    清空 SQLite 文件
                  </button>
                </div>
              </div>
              <div className="deepweb-learning-panel native-sqlite-panel">
                <div>
                  <strong>Native SQLite 桌面写入器</strong>
                  <span>
                    {nativeSqliteReport.status} · {nativeSqliteReport.rowCount} rows
                  </span>
                </div>
                <p>
                  桌面壳 {nativeSqliteReport.storageMode}；
                  表 {nativeSqliteReport.tableCount}；
                  writer {nativeSqliteReport.writerKind}。
                </p>
                <small>{nativeSqliteReport.evidence}</small>
                <small>数据库：{nativeSqliteReport.databasePath}</small>
                <small>{nativeSqliteReport.next}</small>
                <code className="sqlite-preview">
                  analysis_runs / project_files / project_functions / call_edges / flow_nodes / flow_edges /
                  deepweb_replay_memory_snapshots / deepweb_local_sqlite_journal
                </code>
                <button className="memory-clear-button" onClick={clearNativeSqliteStore}>
                  清空 native SQLite
                </button>
              </div>
              <div className="deepweb-learning-panel deepweb-indexeddb-panel">
                <div>
                  <strong>IndexedDB 持久化引擎</strong>
                  <span>
                    {indexedDbReport.status} · {indexedDbReport.rowCount} rows
                  </span>
                </div>
                <p>
                  写入 {indexedDbReport.writtenRows}；
                  表 {indexedDbReport.tableCount}；
                  last {indexedDbReport.lastSyncedAt || "pending"}。
                </p>
                <small>{indexedDbReport.evidence}</small>
                <small>{indexedDbReport.next}</small>
                <small>{indexedDbExportMessage}</small>
                <div className="engine-action-row">
                  <button className="memory-clear-button" onClick={exportIndexedDbSnapshot}>
                    导出持久化快照
                  </button>
                  <label className="memory-clear-button snapshot-import-label">
                    导入持久化快照
                    <input type="file" accept=".json,application/json" onChange={importIndexedDbSnapshot} />
                  </label>
                  <button className="memory-clear-button" onClick={clearIndexedDbStore}>
                    清空持久化库
                  </button>
                </div>
              </div>
              <div className="deepweb-maturity-grid">
                {analysis.semanticIndex.deepDatabase.deepWeb.maturity.dimensions.map((dimension) => (
                  <div className={`deepweb-maturity-card maturity-${maturityStageClass(dimension.stage)}`} key={dimension.dimensionKey}>
                    <div>
                      <strong>{dimension.name}</strong>
                      <span>
                        {dimension.stage} · {dimension.score}%
                      </span>
                    </div>
                    <p>
                      seed {dimension.seedEvidenceCount} · project {dimension.projectEvidenceCount} · teacher {dimension.teacherEvidenceCount} · validation
                      {dimension.validationEvidenceCount}
                    </p>
                    <small>{dimension.blockers.slice(0, 3).join("、") || dimension.next}</small>
                  </div>
                ))}
              </div>
              <ul>
                {analysis.semanticIndex.deepDatabase.deepWeb.completed.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="query-list">
              {analysis.semanticIndex.deepDatabase.deepWeb.supervised.centroids.map((centroid) => (
                <div key={centroid.label}>
                  <strong>{centroid.label}</strong>
                  <span>
                    {centroid.sampleCount} samples · {centroid.confidence}%
                  </span>
                  <small>{centroid.dominantDimensions.join(", ")}</small>
                </div>
              ))}
            </div>
            <div className="query-list">
              {analysis.semanticIndex.deepDatabase.deepWeb.validationScenarios.map((scenario) => (
                <div key={scenario.id}>
                  <strong>{scenario.dimensionKey}</strong>
                  <span>
                    {scenario.status} · {scenario.coverage}%
                  </span>
                  <small>
                    {scenario.validationKind} · {scenario.sourceTable} · {scenario.passCriteria}
                  </small>
                </div>
              ))}
            </div>
            <div className="query-list">
              {analysis.semanticIndex.deepDatabase.deepWeb.validationEvidence.map((item) => (
                <div key={item.id}>
                  <strong>{item.sourceName}</strong>
                  <span>
                    {item.dimensionKey} · {item.confidence}% · {item.passed ? "passed" : "blocked"}
                  </span>
                  <small>
                    {item.evidenceKind} · {item.replay ? "replay" : "probe"} · {item.evidence}
                  </small>
                </div>
              ))}
            </div>
            <div className="query-list">
              {analysis.semanticIndex.deepDatabase.deepWeb.extremeTests.map((test) => (
                <div key={test.id}>
                  <strong>{test.name}</strong>
                  <span>
                    {test.status} · {test.score}/{test.passThreshold}
                  </span>
                  <small>
                    {test.category} · {test.target} · load {test.loadFactor} · {test.evidence}
                  </small>
                </div>
              ))}
            </div>
            <div className="query-list">
              {analysis.semanticIndex.deepDatabase.deepWeb.irrigation.batches.map((batch) => (
                <div key={batch.id}>
                  <strong>{batch.sourceKind}</strong>
                  <span>
                    {batch.status} · quality {batch.qualityScore}% · {batch.acceptedCount}/{batch.evidenceCount}
                  </span>
                  <small>
                    {batch.sourceTable} · {batch.targetDimensions.join(", ")} · {batch.evidence}
                  </small>
                </div>
              ))}
            </div>
            <div className="query-list">
              {analysis.semanticIndex.deepDatabase.deepWeb.irrigation.epochs.map((epoch) => (
                <div key={epoch.id}>
                  <strong>{epoch.stage}</strong>
                  <span>
                    {epoch.status} · {epoch.score}% · evidence {epoch.evidenceCount}
                  </span>
                  <small>
                    {epoch.evidence} · {epoch.action}
                  </small>
                </div>
              ))}
            </div>
            <div className="query-list">
              {analysis.semanticIndex.deepDatabase.deepWeb.irrigation.weightDeltas.slice(0, 8).map((delta) => (
                <div key={delta.dimensionKey}>
                  <strong>{delta.name}</strong>
                  <span>
                    {delta.gate} · {delta.beforeWeight} -&gt; {delta.acceptedWeight}
                  </span>
                  <small>
                    candidate {delta.candidateWeight} · delta {delta.delta} · {delta.evidence}
                  </small>
                </div>
              ))}
            </div>
            <div className="query-list">
              {[currentReplaySnapshot, ...replaySnapshots.filter((snapshot) => snapshot.id !== currentReplaySnapshot.id).slice(0, 5)].map((snapshot) => (
                <div key={snapshot.id}>
                  <strong>{snapshot.projectName}</strong>
                  <span>
                    {snapshot.status} · DeepWeb {snapshot.deepWebCoverage}% · irrigation {snapshot.irrigationScore}%
                  </span>
                  <small>
                    {snapshot.fileCount} files · {snapshot.functionCount} functions · accepted {snapshot.acceptedEvidenceCount} · isolated {snapshot.isolatedEvidenceCount}
                  </small>
                </div>
              ))}
            </div>
            <div className="query-list">
              {sqliteJournalPreviewRows.slice(0, 8).map((row) => (
                <div key={row.id}>
                  <strong>{row.tableName}</strong>
                  <span>
                    {row.status} · {row.primaryKey}
                  </span>
                  <small>{shorten(row.sql, 180)}</small>
                </div>
              ))}
            </div>
            <div className="query-list">
              {analysis.semanticIndex.deepDatabase.deepWeb.supervised.assignments.slice(0, 8).map((assignment) => (
                <div key={assignment.vectorId}>
                  <strong>{assignment.vectorName}</strong>
                  <span>
                    {assignment.teacherLabel} · {assignment.trustScore}%
                  </span>
                  <small>
                    {assignment.corrected ? `纠正 ${assignment.predictedLabel}` : "预测一致"} · {assignment.evidence}
                  </small>
                </div>
              ))}
            </div>
            <div className="query-list">
              {analysis.semanticIndex.deepDatabase.deepWeb.supervised.teacherReliability.map((teacher) => (
                <div key={teacher.sourceKind}>
                  <strong>{teacher.sourceKind}</strong>
                  <span>
                    {teacher.status} · {teacher.reliabilityScore}%
                  </span>
                  <small>{teacher.evidence}</small>
                </div>
              ))}
            </div>
            <div className="query-list">
              {analysis.semanticIndex.deepDatabase.deepWeb.supervised.quarantinedSamples.map((sample) => (
                <div key={sample.id}>
                  <strong>{sample.vectorName}</strong>
                  <span>
                    {sample.reason} · {sample.confidence}%
                  </span>
                  <small>{sample.recommendedAction}</small>
                </div>
              ))}
            </div>
            <div className="query-list">
              {analysis.semanticIndex.deepDatabase.deepWeb.errorSignals.slice(0, 8).map((signal) => (
                <div key={signal.id}>
                  <strong>{signal.signalKind}</strong>
                  <span>
                    {signal.severity} · {signal.confidence}%
                  </span>
                  <small>
                    置信 -{signal.confidenceImpact} · 知识 -{signal.knowledgeScoreImpact} · 适应度 -{signal.fitnessImpact} ·
                    {signal.containmentAction}
                  </small>
                </div>
              ))}
            </div>
            <div className="query-list">
              {analysis.semanticIndex.deepDatabase.deepWeb.evolution.genomes.map((genome) => (
                <div key={genome.id}>
                  <strong>{genome.strategy}</strong>
                  <span>
                    {genome.accepted ? "accepted" : "blocked"} · {genome.fitnessScore}%
                  </span>
                  <small>{genome.evidence}</small>
                </div>
              ))}
            </div>
            <div className="query-list">
              {analysis.semanticIndex.deepDatabase.deepWeb.evolution.genes.slice(0, 8).map((gene) => (
                <div key={gene.id}>
                  <strong>{gene.name}</strong>
                  <span>
                    {gene.geneKind} · {gene.expression}%
                  </span>
                  <small>{gene.evidence}</small>
                </div>
              ))}
            </div>
            <div className="query-list">
              {analysis.semanticIndex.deepDatabase.deepWeb.generatedVectors.slice(0, 8).map((vector) => (
                <div key={vector.id}>
                  <strong>{vector.sourceName}</strong>
                  <span>
                    {vector.pseudoLabel} · {vector.confidence}%
                  </span>
                  <small>
                    {vector.sourceTable} · magnitude {vector.magnitude}
                  </small>
                </div>
              ))}
            </div>
            <div className="query-list">
              {analysis.semanticIndex.deepDatabase.deepWeb.inferenceRuns.slice(0, 8).map((run) => (
                <div key={run.id}>
                  <strong>{run.predictedClass}</strong>
                  <span>{run.confidence}%</span>
                  <small>
                    {run.sourceTable} · {Object.entries(run.outputScores)
                      .slice(0, 3)
                      .map(([key, value]) => `${key}:${value}`)
                      .join(" · ")}
                  </small>
                </div>
              ))}
            </div>
            <div className="deep-layer-list">
              {analysis.semanticIndex.deepDatabase.deepWeb.modelLayers.map((layer) => (
                <div className="deep-layer-active" key={layer.id}>
                  <div>
                    <strong>{layer.name}</strong>
                    <span>
                      {layer.layerKind} · {layer.activation} · {layer.coverage}%
                    </span>
                  </div>
                  <small>
                    {layer.inputDimensions.join(", ")} -&gt; {layer.outputDimensions.join(", ")}
                  </small>
                  <small>{layer.purpose}</small>
                </div>
              ))}
            </div>
            <div className="query-list">
              {analysis.semanticIndex.deepDatabase.deepWeb.featureSpaces.slice(0, 8).map((space) => (
                <div key={space.id}>
                  <strong>{space.name}</strong>
                  <span>{space.coverage}%</span>
                  <small>
                    {space.dimensionKey} · {space.targetTables.slice(0, 3).join(", ")}
                  </small>
                </div>
              ))}
            </div>
            <div className="query-list">
              {analysis.semanticIndex.deepDatabase.deepWeb.languageAdapters.slice(0, 6).map((adapter) => (
                <div key={adapter.id}>
                  <strong>{adapter.language}</strong>
                  <span>
                    {adapter.confidence}% · {adapter.readiness}
                  </span>
                  <small>{adapter.parserStack.slice(0, 3).join(" / ")}</small>
                </div>
              ))}
            </div>
            <div className="query-list">
              {analysis.semanticIndex.deepDatabase.deepWeb.projections.slice(0, 6).map((projection) => (
                <div key={projection.id}>
                  <strong>
                    {projection.sourceTable} -&gt; {projection.targetTable}
                  </strong>
                  <span>{projection.coverage}%</span>
                  <small>{projection.mappingFormula}</small>
                </div>
              ))}
            </div>
            <div className="coverage-gap-grid">
              <section>
                <h3>DeepWeb 缺口</h3>
                <ul>
                  {analysis.semanticIndex.deepDatabase.deepWeb.gaps.map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ul>
              </section>
            </div>
            <div className="deep-layer-list">
              {analysis.semanticIndex.deepDatabase.layers.map((layer) => (
                <div className={`deep-layer-${layer.status}`} key={layer.name}>
                  <div>
                    <strong>{layer.name}</strong>
                    <span>
                      {layer.tableCount} 表 · {layer.seededRows} rows · {layer.coverage}%
                    </span>
                  </div>
                  <small>{layer.purpose}</small>
                  <small>{layer.next}</small>
                </div>
              ))}
            </div>
            <div className="index-table-list">
              {analysis.semanticIndex.tables.map((table) => (
                <div key={table.name}>
                  <strong>{table.name}</strong>
                  <span>{table.rows} rows</span>
                  <small>{table.purpose}</small>
                </div>
              ))}
            </div>
            <div className="query-list">
              {analysis.semanticIndex.queries.map((query) => (
                <div key={query.name}>
                  <strong>{query.name}</strong>
                  <span>{query.resultCount}</span>
                  <small>{query.evidence}</small>
                </div>
              ))}
            </div>
            <div className="hotspot-list">
              {analysis.semanticIndex.hotspots.map((hotspot) => (
                <div className={`hotspot-${hotspot.severity}`} key={hotspot.label}>
                  <strong>{hotspot.label}</strong>
                  <span>{hotspot.value}</span>
                  <small>{hotspot.evidence}</small>
                </div>
              ))}
            </div>
          </div>
        </article>

        <article className="analysis-card wide-card" data-page="hardcore">
          <div className="panel-heading">
            <h2>Runtime Lab</h2>
            <span>
              {analysis.runtimeSandbox.mode} · {analysis.runtimeSandbox.readinessScore}%
            </span>
          </div>
          <div className="runtime-grid">
            <div className="runtime-budget">
              <span>
                <b>{analysis.runtimeSandbox.deterministicScore}%</b>
                确定性
              </span>
              <span>
                <b>{analysis.runtimeSandbox.estimatedSteps}</b>
                预估步骤
              </span>
              <span>
                <b>{analysis.runtimeSandbox.breakpointCount}</b>
                断点
              </span>
              <span>
                <b>{analysis.runtimeSandbox.riskCount}</b>
                风险场景
              </span>
            </div>
            <div className="scenario-list">
              {analysis.runtimeSandbox.scenarios.map((scenario) => (
                <div className={`scenario-${scenario.status}`} key={scenario.name}>
                  <div>
                    <strong>{scenario.name}</strong>
                    <span>{scenario.status}</span>
                  </div>
                  <p>{scenario.risk}</p>
                  <small>
                    {scenario.inputShape} · {scenario.pathLength} steps · {scenario.evidence}
                  </small>
                </div>
              ))}
            </div>
            <div className="guard-list">
              {analysis.runtimeSandbox.guards.map((guard) => (
                <div className={`guard-${guard.status}`} key={guard.name}>
                  <strong>{guard.name}</strong>
                  <span>{guard.status}</span>
                  <small>{guard.evidence}</small>
                </div>
              ))}
            </div>
          </div>
        </article>

        <article className="analysis-card wide-card controlled-runtime-panel" data-page="twin">
          <div className="panel-heading">
            <h2>Tauri 受控运行器</h2>
            <span>
              {runtimeAvailability.status} · {runtimeAvailability.availableCount}/{runtimeAvailability.totalCount} 工具链
            </span>
          </div>
          <p className="software-brief">
            只有点击“执行当前项目”才会运行代码。运行器使用固定语言适配器和临时项目副本，不接受任意 shell 命令；
            超时、编译结果、退出码、stdout 和 stderr 会写入 native SQLite，并反馈给数字孪生。
          </p>
          <div className="runtime-tool-grid">
            {runtimeAvailability.tools.map((tool) => (
              <div className={tool.available ? "runtime-tool-ready" : "runtime-tool-missing"} key={tool.adapter}>
                <strong>{tool.label}</strong>
                <span>{tool.available ? "可用" : "缺失"}</span>
                <small>{tool.version || tool.evidence}</small>
              </div>
            ))}
          </div>
          <details className="runtime-extension-slots">
            <summary>适配器扩展接口 · {(runtimeAvailability.extensionSlots ?? []).length} 类预留</summary>
            <p>以后新增语言、前端运行环境或嵌入式目标时，由这里注册；不会开放任意 shell 命令。</p>
            <div className="runtime-tool-grid">
              {(runtimeAvailability.extensionSlots ?? []).map((slot) => (
                <div className="runtime-tool-reserved" key={slot.id}>
                  <strong>{slot.label}</strong>
                  <span>{slot.status}</span>
                  <small>{slot.requiredContracts[0]}</small>
                </div>
              ))}
            </div>
          </details>
          <section className="runtime-certification-panel" aria-label="六语言宿主机认证">
            <div className="panel-heading">
              <h3>六语言宿主机认证</h3>
              <span>{runtimeCertification.status} · {runtimeCertification.passedCount}/{runtimeCertification.totalCount} · {runtimeCertification.score}%</span>
            </div>
            <p>这里不是工具安装数量。每种语言必须真实编译和执行，并同时取得函数 trace、文件改动、进程资源和 OS 强隔离证据。</p>
            <div className="runtime-tool-grid">
              {runtimeCertification.items.map((item) => (
                <div className={item.status === "passed" ? "runtime-tool-ready" : "runtime-tool-missing"} key={`cert-${item.adapter}`}>
                  <strong>{item.label}</strong>
                  <span>{item.status} · {item.score}%</span>
                  <small>
                    执行 {item.compiledAndExecuted ? "是" : "否"} · trace {item.traceCaptured ? "是" : "否"} · 文件 {item.fileObservationCaptured ? "是" : "否"} · 资源 {item.resourceObservationCaptured ? "是" : "否"} · 隔离 {item.sandboxEnforced ? "是" : "否"}
                  </small>
                </div>
              ))}
            </div>
            <button
              className="runtime-run-button"
              disabled={runtimeRunning || runtimeAvailability.status === "web-preview"}
              onClick={runRuntimeCertification}
            >
              {runtimeRunning ? "认证中…" : "认证六语言运行器"}
            </button>
          </section>
          <div className="runtime-control-grid">
            <label>
              <span>语言运行器</span>
              <select
                value={runtimeAdapter}
                onChange={(event) => {
                  const adapter = event.target.value as ControlledRuntimeAdapter;
                  setRuntimeAdapter(adapter);
                  setRuntimeEntry(recommendedRuntimeEntry(files, adapter));
                }}
              >
                {runtimeAdapterDefinitions().map((adapter) => (
                  <option value={adapter.adapter} key={adapter.adapter}>{adapter.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>入口文件</span>
              <select value={runtimeEntry} onChange={(event) => setRuntimeEntry(event.target.value)}>
                {!runtimeEntryOptions.length && <option value="">当前项目没有匹配入口</option>}
                {runtimeEntryOptions.map((file) => <option value={file.name} key={file.id}>{file.name}</option>)}
              </select>
            </label>
            <label className="runtime-stdin-field">
              <span>标准输入（可选）</span>
              <textarea
                value={runtimeStdin}
                onChange={(event) => setRuntimeStdin(event.target.value)}
                placeholder="只有程序主动读取 stdin 时才会使用"
                rows={3}
              />
            </label>
            <button
              className="runtime-run-button"
              disabled={runtimeRunning || !runtimeEntry || runtimeAvailability.status === "web-preview"}
              onClick={runCurrentProject}
            >
              {runtimeRunning ? "执行中…" : "执行当前项目"}
            </button>
            <button
              className="runtime-run-button"
              disabled={runtimeRunning || !runtimeEntry || runtimeAvailability.status === "web-preview"}
              onClick={() => void runSelectedTwinExperiments()}
            >
              {runtimeRunning ? "实验中…" : "执行已勾选孪生实验"}
            </button>
            <button
              className="runtime-run-button"
              disabled={runtimeRunning || !runtimeEntry || runtimeAvailability.status === "web-preview"}
              onClick={runSecurityAssertions}
            >
              {runtimeRunning ? "验证中…" : "运行安全攻击断言"}
            </button>
          </div>
          <p className="runtime-message">{runtimeMessage}</p>
          {runtimeAvailability.status === "web-preview" && <p className="runtime-failure-reason">真实实验只能在桌面程序内启动；HTTP 预览不具备本机进程权限。</p>}
          {!runtimeEntry && <p className="runtime-failure-reason">当前语言没有找到安全的程序入口。配置文件和测试文件不会再被自动当作入口，请从真实 main、index、app、server 文件开始。</p>}
          <div className="runtime-history-list">
            {runtimeExecutions.slice().reverse().map((run) => (
              <details key={run.id}>
                <summary>
                  <strong>{run.experimentKind ?? "baseline"} · {run.adapter} · {run.status}</strong>
                  <span>{run.durationMs}ms · exit {run.exitCode ?? "none"} · {new Date(run.finishedAt).toLocaleTimeString("zh-CN")}</span>
                </summary>
                <small>{run.commandLabel}</small>
                <p>
                  样本：{run.sampleId ?? "未标注"}；输入 {run.inputBytes ?? 0} bytes；规模 {run.repetition ?? 1}x；
                  隔离：{run.sandboxKind} / {run.sandboxStatus}；CPU 时间约 {run.cpuTimeMs}ms；
                  峰值内存 {(run.peakMemoryBytes / 1024 / 1024).toFixed(1)}MB；进程树 {run.childProcessCount} 个；
                  文件改动 {run.fileChanges.length} 项。
                </p>
                <small>
                  {(run.traceEvents?.length ?? 0) > 0
                    ? `内部路径：已采集 ${run.traceEvents?.length ?? 0} 条轨迹；来源 ${run.traceSource ?? "unknown"}。`
                    : "内部路径：自动插桩未能安全定位入口，本次只证明进程级输入、输出和资源观测。"}
                </small>
                <small>
                  动态 sanitizer：{run.sanitizerStatus ?? "not-requested"}
                  {run.sanitizerFindings?.length ? `；反例 ${run.sanitizerFindings.join("；")}` : "；没有动态反例时只表示本次运行未观察到。"}
                </small>
                <small>{run.sandboxEvidence}</small>
                <p className={run.status === "failed" || run.status === "rejected" || run.status === "unavailable" ? "runtime-failure-reason" : "runtime-success-reason"}>
                  {runtimeFailureExplanation(run.status, run.stderr, run.compileOutput)}
                </p>
                {run.childProcesses.length > 0 && (
                  <p>
                    子进程：{run.childProcesses.map((process) => `${process.name}#${process.pid}`).join("、")}
                  </p>
                )}
                {run.fileChanges.length > 0 && (
                  <p>
                    文件改动：{run.fileChanges.slice(0, 12).map((change) => `${change.kind} ${change.path}`).join("；")}
                  </p>
                )}
                {run.compileOutput && <pre>{run.compileOutput}</pre>}
                {run.stdout && <pre>{run.stdout}</pre>}
                {run.stderr && <pre>{run.stderr}</pre>}
              </details>
            ))}
          </div>
          <section className="runtime-certification-panel" aria-label="桌面活调试会话">
            <div className="panel-heading">
              <h3>真实断点调试（DAP）</h3>
              <span>{debugSession?.state ?? "未启动"} · {runtimeAdapter.toUpperCase()}</span>
            </div>
            <p>
              调试启动后，程序会在指定代码行暂停，方便查看当时执行到哪里、变量是什么以及由谁调用。断点、调用栈、作用域、变量和执行事件都来自真实 DAP 响应，不使用页面模拟数据。
            </p>
            <div className="debug-purpose-grid">
              <span><b>断点</b>确认指定代码是否真的执行</span>
              <span><b>调用栈</b>查看是谁按什么顺序调用</span>
              <span><b>变量</b>检查暂停时的真实值和作用域</span>
              <span><b>单步</b>逐行观察状态如何变化</span>
            </div>
            <div className="runtime-control-grid">
              <label>
                <span>断点行</span>
                <input
                  type="number"
                  min={1}
                  value={debugBreakpointLine}
                  onChange={(event) => setDebugBreakpointLine(Math.max(1, Number(event.target.value) || 1))}
                />
              </label>
              <button
                className="runtime-run-button"
                disabled={debugBusy || !runtimeEntry || debugAvailability.status === "unavailable"}
                onClick={() => void launchCurrentDebugSession()}
              >
                {debugBusy ? "正在启动调试…" : "启动调试并暂停"}
              </button>
              <button disabled={debugBusy || debugSession?.state !== "stopped"} onClick={() => void runDebugAction("next")}>单步</button>
              <button disabled={debugBusy || debugSession?.state !== "stopped"} onClick={() => void runDebugAction("stepIn")}>步入</button>
              <button disabled={debugBusy || debugSession?.state !== "stopped"} onClick={() => void runDebugAction("stepOut")}>步出</button>
              <button disabled={debugBusy || debugSession?.state !== "stopped"} onClick={() => void runDebugAction("continue")}>继续</button>
              <button disabled={debugBusy || !debugSession || debugSession.state === "terminated"} onClick={() => void runDebugAction("disconnect")}>结束</button>
            </div>
            <p className="runtime-message">{debugMessage}</p>
            {debugSession?.lastStop ? (
              <div className="runtime-history-list">
                <details open>
                  <summary>
                    <strong>{debugSession.lastStop.reason} · {debugSession.stackFrames[0]?.name ?? "当前栈帧"}</strong>
                    <span>{debugSession.stackFrames[0]?.source.path}:{debugSession.stackFrames[0]?.line}</span>
                  </summary>
                  <p>
                    局部变量：{debugSession.variables.length
                      ? debugSession.variables.map((variable) => `${variable.name}=${variable.value}`).join("；")
                      : "当前栈帧没有可展开变量"}
                  </p>
                  <small>
                    {debugSession.eventLog.slice(-6).map((event) => `${event.kind}: ${event.detail}`).join(" | ")}
                  </small>
                </details>
              </div>
            ) : null}
          </section>
          <div className="runtime-safety-note">
            <strong>安全边界</strong>
            <span>{runtimeAvailability.safetyBoundary.join("；")}</span>
          </div>
        </article>

        <article className="analysis-card wide-card runtime-cost-panel" data-page="twin" id="runtime-cost">
          <div className="panel-heading">
            <h2>运行成本与本机承载</h2>
            <span>{runtimeCostStatusLabel(runtimeCost.status)} · {runtimeCost.score ? `${runtimeCost.score}%` : "待测"} · {runtimeCost.evidenceGrade}</span>
          </div>
          <p className="completion-summary">{runtimeCost.summary}</p>
          <div className="runtime-cost-grid">
            {runtimeCost.dimensions.map((dimension) => (
              <section className={`runtime-cost-${dimension.status}`} key={dimension.id}>
                <div><strong>{dimension.label}</strong><span>{runtimeCostStatusLabel(dimension.status)} · {dimension.score ? `${dimension.score}%` : "待测"}</span></div>
                <b>{dimension.required}</b>
                <small>本机：{dimension.available}</small>
                <p>{dimension.explanation}</p>
              </section>
            ))}
          </div>
          <div className="runtime-cost-summary">
            <span><b>{formatBytes(systemCapacity.totalMemoryBytes)}</b>本机内存</span>
            <span><b>{formatBytes(systemCapacity.availableMemoryBytes)}</b>当前可用内存</span>
            <span><b>{formatBytes(systemCapacity.availableDiskBytes)}</b>当前可用磁盘</span>
            <span><b>{runtimeCost.confidence}%</b>评估置信度</span>
          </div>
          <details>
            <summary>计算依据与降低成本建议</summary>
            <ul>{runtimeCost.recommendations.map((item) => <li key={item}>{item}</li>)}</ul>
            {runtimeCost.evidence.map((item) => <small key={item}>证据：{item}</small>)}
          </details>
        </article>

        <article className="analysis-card wide-card digital-twin-panel" data-page="twin">
          <div className="panel-heading">
            <h2>Program Verification</h2>
            <span>
              {analysis.programVerification.status} · {analysis.programVerification.score}%
            </span>
          </div>
          <p className="completion-summary">
            把代码事实、知识规则、DeepWeb 证据融合、受控运行和数字孪生实验转换成可回放的证明义务。
            当前可靠上限为 {analysis.programVerification.soundnessCap}%；没有形式化证据时不会显示为完全证明。
          </p>
          <div className="hardcore-metrics">
            <span><b>{analysis.programVerification.obligationCount}</b>证明义务</span>
            <span><b>{analysis.programVerification.provedCount}</b>已证明</span>
            <span><b>{analysis.programVerification.observedCount}</b>已观察</span>
            <span><b>{analysis.programVerification.violatedCount}</b>已违反</span>
            <span><b>{analysis.programVerification.runtimeEvidenceCount}</b>运行证据</span>
            <span><b>{analysis.programVerification.formalEvidenceCount}</b>形式化证据</span>
            <span><b>{analysis.knowledgeRuleCoverage.dataQuality.score}%</b>知识数据质量</span>
            <span><b>{analysis.programVerification.contracts.coveredFunctionCount}/{analysis.programVerification.contracts.functionCount}</b>函数契约</span>
            <span><b>{analysis.programVerification.contracts.smtEligibleCount}</b>可求解契约</span>
          </div>
          <div className="runtime-actions">
            <button type="button" onClick={runFormalVerification} disabled={formalBusy}>
              {formalBusy ? "Z3 求解中" : "运行本地 Z3 证明"}
            </button>
            <span>{formalMessage}</span>
          </div>
          {formalProofs.length > 0 && (
            <div className="runtime-result-list">
              {formalProofs.map((proof) => (
                <section key={proof.id} className={`verification-${proof.status === "counterexample" ? "violated" : proof.status}`}>
                  <strong>{proof.title}</strong>
                  <span>{proof.status} · {proof.solverVersion} · {proof.durationMs}ms</span>
                  <small>公式哈希 {proof.formulaHash.slice(0, 16)} · 隔离 {proof.sandboxStatus}</small>
                  {proof.callChain?.length ? <small>调用链 {proof.callChain.join(" -> ")}</small> : null}
                  {proof.counterexample ? <details><summary>查看 Z3 反例</summary><pre>{proof.counterexample}</pre></details> : null}
                </section>
              ))}
            </div>
          )}
          <div className="twin-experiment-grid">
            {analysis.programVerification.obligations.slice(0, 12).map((obligation) => (
              <section className={`twin-experiment verification-${obligation.status}`} key={obligation.id}>
                <div>
                  <strong>{obligation.title}</strong>
                  <span>{obligation.status} · {obligation.evidenceGrade} · {obligation.confidence}%</span>
                </div>
                <p>{obligation.requirement}</p>
                <small>{obligation.evidence[0] ?? "尚无证据"}</small>
                {obligation.missingEvidence.length > 0 && (
                  <details>
                    <summary>还缺什么</summary>
                    <ul>{obligation.missingEvidence.slice(0, 5).map((item) => <li key={item}>{item}</li>)}</ul>
                  </details>
                )}
              </section>
            ))}
          </div>
          <details className="verification-contracts">
            <summary>项目契约与代码位置</summary>
            <p>{analysis.programVerification.contracts.evidence.join("；")}</p>
            {analysis.programVerification.contracts.contracts.slice(0, 20).map((contract) => (
              <section key={contract.id}>
                <strong>{contract.functionName}</strong>
                <span>{contract.fileName}:{contract.startLine} · {contract.evidenceGrade} · {contract.clauses.length} 条</span>
                <small>{contract.clauses.slice(0, 5).map((clause) => `${clause.kind}: ${clause.predicate}`).join("；")}</small>
              </section>
            ))}
          </details>
          <div className="twin-limitations">
            <strong>当前项目的证明边界</strong>
            <p>验证内核已经接入本地 Z3、函数契约和可回放证明记录；以下内容表示当前导入项目还没有生成足够证据，不代表这些能力尚未开发。</p>
            {analysis.programVerification.gaps.map((gap) => <p key={gap}>{gap}</p>)}
          </div>
        </article>

        <article className="analysis-card wide-card digital-twin-panel" data-page="twin">
          <div className="panel-heading">
            <h2>Program Digital Twin</h2>
            <span>
              {analysis.digitalTwin.status} · 保真度 {analysis.digitalTwin.fidelityScore}%
            </span>
          </div>
          <p className="completion-summary">{analysis.digitalTwin.summary}</p>
          <section className="integrated-suite-control twin-suite-control" aria-label="孪生实验选择与进度">
            <div className="software-subheading"><h3>孪生集成实验</h3><span>勾选实验类型，实时刷新进度与证据</span></div>
            <div className="test-bubble-options twin-bubble-options">
              {twinExperimentOptions.map((option) => (
                <label className={selectedTwinExperiments.includes(option.id) ? "is-selected" : ""} key={option.id}>
                  <input
                    type="checkbox"
                    checked={selectedTwinExperiments.includes(option.id)}
                    onChange={() => setSelectedTwinExperiments((current) => current.includes(option.id) ? current.filter((id) => id !== option.id) : [...current, option.id])}
                  />
                  <span>{option.id}</span>
                  <small>{option.mode === "runtime" ? "真实" : option.mode === "model" ? "模型" : "需候选"}</small>
                </label>
              ))}
            </div>
            <div className="suite-progress-panel">
              <div><strong>{twinSuiteProgress.current}</strong><span>{twinSuiteProgress.total ? Math.round(twinSuiteProgress.completed / twinSuiteProgress.total * 100) : 0}% · {twinSuiteProgress.completed}/{twinSuiteProgress.total}</span></div>
              <progress max={Math.max(1, twinSuiteProgress.total)} value={twinSuiteProgress.completed} />
              <p>{twinSuiteProgress.message}{twinSuiteProgress.updatedAt ? ` · 更新 ${new Date(twinSuiteProgress.updatedAt).toLocaleTimeString("zh-CN")}` : ""}</p>
            </div>
            <div className="suite-control-actions">
              <button type="button" className="runtime-run-button" disabled={runtimeRunning || twinSuiteProgress.running || !selectedTwinExperiments.length} onClick={() => void runSelectedTwinExperiments()}>
                {twinSuiteProgress.running ? "孪生实验执行中…" : "执行选中孪生实验"}
              </button>
              <button type="button" disabled={runtimeRunning || twinSuiteProgress.running} onClick={() => void runDigitalTwinSuite()}>全部实验</button>
              <button type="button" onClick={refreshTwinProgress}>刷新证据进度</button>
              <button type="button" onClick={() => setSelectedTwinExperiments(twinExperimentOptions.map((option) => option.id))}>全选</button>
              <button type="button" onClick={() => setSelectedTwinExperiments([])}>清空</button>
            </div>
          </section>
          <div className={`twin-overall-conclusion ${analysis.digitalTwin.experiments.some((item) => item.status === "风险" || item.status === "阻塞") ? "has-risk" : "is-clear"}`}>
            <strong>本轮结论</strong>
            <p>
              {analysis.digitalTwin.executedExperimentCount === 0
                ? "当前没有真实执行结果，页面展示的是静态分析和实验计划，不能据此断言程序运行正常。"
                : analysis.digitalTwin.experiments.some((item) => item.status === "风险" || item.status === "阻塞")
                  ? `真实实验已运行，但仍有 ${analysis.digitalTwin.experiments.filter((item) => item.status === "风险" || item.status === "阻塞").length} 类风险或阻塞。应先处理失败项，再重新运行同一组输入。`
                  : `已取得 ${analysis.digitalTwin.executedExperimentCount} 类真实执行证据，当前未观察到阻塞性结果；尚未验证的实验仍不能视为通过。`}
            </p>
          </div>
          <div className="hardcore-metrics">
            <span>
              <b>{analysis.digitalTwin.coverageScore}%</b>
              实验覆盖
            </span>
            <span>
              <b>{analysis.digitalTwin.executedExperimentCount}</b>
              真实执行
            </span>
            <span>
              <b>{analysis.digitalTwin.simulatedExperimentCount}</b>
              模型仿真
            </span>
            <span>
              <b>{analysis.digitalTwin.inferredExperimentCount}</b>
              静态推断
            </span>
            <span>
              <b>{analysis.digitalTwin.validatedExperimentCount}</b>
              目标已验证
            </span>
            <span>
              <b>{analysis.digitalTwin.sourceCount}/{analysis.digitalTwin.sinkCount}</b>
              输入源/输出口
            </span>
          </div>
          <div className="twin-experiment-grid">
            {analysis.digitalTwin.experiments.map((experiment) => (
              <section className={`twin-experiment twin-status-${experiment.status}`} key={experiment.id}>
                <div>
                  <strong>{experiment.kind} · {experiment.name}</strong>
                  <span>{experiment.evidenceGrade} · {experiment.claimStatus} · {experiment.confidence}%</span>
                </div>
                <p>{experiment.objective}</p>
                <p className="experiment-plain-conclusion"><b>直接结论：</b>{experimentConclusion(experiment.status, experiment.claimStatus)}</p>
                <small><b>结论边界：</b>{experiment.claimReason}</small>
                <dl className="twin-metric-strip">
                  <div><dt>性能</dt><dd>{experiment.metrics.performance}</dd></div>
                  <div><dt>稳定</dt><dd>{experiment.metrics.stability}</dd></div>
                  <div><dt>安全</dt><dd>{experiment.metrics.security}</dd></div>
                  <div><dt>资源</dt><dd>{experiment.metrics.resource}</dd></div>
                </dl>
                <small><b>输入模型：</b>{experiment.inputModel}</small>
                <small><b>当前结果：</b>{experiment.observedOrEstimated}</small>
                <details>
                  <summary>证据与验证动作</summary>
                  <ul>
                    {experiment.evidence.slice(0, 6).map((evidence) => <li key={evidence}>{evidence}</li>)}
                  </ul>
                  <p>{experiment.nextAction}</p>
                </details>
              </section>
            ))}
          </div>
        </article>

        <article className="analysis-card wide-card security-assertion-panel" data-page="twin">
          <div className="panel-heading">
            <h2>权限、身份与攻击断言</h2>
            <span>真实输入 · 独立污点探针 · 动态 sanitizer</span>
          </div>
          <p className="completion-summary">{securityAssertionMessage}</p>
          <div className="security-assertion-grid">
            {(securityAssertions.length ? securityAssertions : buildLocalSecurityAttackCorpus()).map((item) => {
              const result = "sample" in item ? item : null;
              const sample = result?.sample ?? item;
              return (
                <section className={`security-assertion-${result?.status ?? "pending"}`} key={sample.id}>
                  <div><strong>{sample.title}</strong><span>{result?.status ?? "待运行"}</span></div>
                  <small>{sample.kind} · 预期 {sample.expected}</small>
                  {result?.evidence.map((line) => <p key={line}>{line}</p>)}
                </section>
              );
            })}
          </div>
          <button className="runtime-run-button" onClick={runSecurityAssertions} disabled={runtimeRunning || !runtimeEntry || runtimeAvailability.status === "web-preview"}>
            {runtimeRunning ? "验证中…" : "执行全部安全断言"}
          </button>
        </article>

        <article className="analysis-card wide-card repair-workflow" data-page="twin">
          <div className="panel-heading">
            <h2>修复审批与安全写回</h2>
            <span>Diff → A/B → 批准 → 写回 → 回滚</span>
          </div>
          <p className="completion-summary">{repairMessage}</p>
          <section className="repair-sandbox-candidates">
            <div className="software-subheading">
              <h3>沙箱候选与模拟结果</h3>
              <span>选择建议 → 生成 Diff → 项目副本 A/B → 审批写回</span>
            </div>
            <div className="twin-variant-list">
              {analysis.programVerification.repairCandidates.map((candidate) => (
                <section key={candidate.id}>
                  <div><strong>{candidate.name}</strong><span>{candidate.status} · {candidate.safeToWriteBack ? "允许写回" : "等待验证"}</span></div>
                  <p>{candidate.target}：{candidate.change}</p>
                  <div className="twin-delta-row">
                    <span>性能 +{candidate.predictedPerformanceGain}%</span>
                    <span>稳定 {candidate.predictedStabilityDelta}%</span>
                    <span>安全 {candidate.predictedSecurityDelta >= 0 ? "+" : ""}{candidate.predictedSecurityDelta}%</span>
                    <span>门禁 {candidate.gates.filter((gate) => gate.status === "passed").length}/{candidate.gates.length}</span>
                  </div>
                  <small>{candidate.gates.map((gate) => `${gate.label}:${gate.status}`).join(" · ")}</small>
                  <button type="button" onClick={() => {
                    setRepairReason(`${candidate.name}：${candidate.change}`);
                    loadSelectedFunctionForRepair();
                    setRepairSuggestedCode("");
                    setRepairMessage("已载入修复工作台。这个候选目前只有算法策略和收益估计，尚未生成候选代码；请根据策略编辑“建议代码”，产生真实变化后再生成 Diff。 ");
                  }}>载入修复工作台</button>
                </section>
              ))}
              {!analysis.programVerification.repairCandidates.length && <div className="empty-state">证据不足时不会生成可能误导用户的源码修改。</div>}
            </div>
          </section>
          <ol className="repair-progress" aria-label="修复流程状态">
            <li className={repairOriginalCode && repairSuggestedCode ? "done" : "current"}><b>1</b><span>准备原文与建议</span></li>
            <li className={repairResult?.patch.status === "ready" ? "done" : repairOriginalCode && repairSuggestedCode ? "current" : "pending"}><b>2</b><span>生成并检查 Diff</span></li>
            <li className={repairResult?.experiment?.status === "passed" ? "done" : repairResult?.patch.status === "ready" ? "current" : "pending"}><b>3</b><span>运行 A/B 验证</span></li>
            <li className={repairApproval ? "done" : repairResult?.experiment?.status === "passed" ? "current" : "pending"}><b>4</b><span>批准当前版本</span></li>
            <li className={repairRollbacks[activeProject.id] ? "done" : repairApproval ? "current" : "pending"}><b>5</b><span>写回并保留回滚</span></li>
          </ol>
          <div className="repair-editor-grid">
            <label>
              目标文件
              <select value={repairFileName} onChange={(event) => { setRepairFileName(event.target.value); setRepairResult(null); setRepairApproval(null); }}>
                {files.map((file) => <option key={file.id} value={file.name}>{file.name}</option>)}
              </select>
            </label>
            <label>
              修复理由
              <input value={repairReason} onChange={(event) => setRepairReason(event.target.value)} />
            </label>
            <label>
              精确原文
              <textarea value={repairOriginalCode} onChange={(event) => { setRepairOriginalCode(event.target.value); setRepairResult(null); setRepairApproval(null); }} />
            </label>
            <label>
              建议代码
              <textarea
                value={repairSuggestedCode}
                placeholder="算法策略候选尚未生成代码。请在这里写入经过审查的真实修改，或载入具有确定性代码配方的候选。"
                onChange={(event) => { setRepairSuggestedCode(event.target.value); setRepairResult(null); setRepairApproval(null); }}
              />
            </label>
          </div>
          <div className="repair-actions">
            <button onClick={loadSelectedFunctionForRepair}>载入当前函数</button>
            <button
              onClick={() => void prepareRepairDiff()}
              disabled={repairBusy || !repairOriginalCode || !repairSuggestedCode || repairOriginalCode === repairSuggestedCode}
              title={repairOriginalCode === repairSuggestedCode ? "建议代码尚未发生变化" : "生成项目副本 Diff"}
            >生成 Diff</button>
            <button
              onClick={() => void runRepairExperiment()}
              disabled={repairBusy || !runtimeEntry || runtimeAvailability.status === "web-preview" || repairOriginalCode === repairSuggestedCode || repairResult?.patch.status !== "ready"}
              title={runtimeAvailability.status === "web-preview" ? "真实 A/B 只能在桌面程序运行" : repairResult?.patch.status !== "ready" ? "请先生成并检查 Diff" : "在隔离副本中运行 A/B"}
            >运行 A/B</button>
            <button onClick={approveCurrentRepair} disabled={repairBusy || repairResult?.experiment?.status !== "passed" || Boolean(repairApproval)}>批准当前哈希</button>
            <button className="primary-action" onClick={() => void writeBackCurrentRepair()} disabled={repairBusy || !repairApproval}>安全写回</button>
            <button onClick={() => void rollbackLastRepair()} disabled={repairBusy || !repairRollbacks[activeProject.id]}>一键回滚</button>
          </div>
          <div className="repair-next-action" aria-live="polite">
            {!repairOriginalCode
              ? "下一步：先载入当前函数或一个修复候选。"
              : repairOriginalCode === repairSuggestedCode
                ? "当前不能继续：建议代码与原文完全相同，尚未形成修改。这里不是无人监督的自动改码；请先编辑建议代码。"
                : !repairResult || repairResult.patch.status !== "ready"
                  ? "下一步：生成并检查 Diff。此时只修改项目副本，不写回源项目。"
                  : runtimeAvailability.status === "web-preview"
                    ? "当前不能运行 A/B：HTTP 预览没有本机进程权限，请在桌面程序中继续。"
                    : !runtimeEntry
                      ? "当前不能运行 A/B：尚未选择真实程序入口。"
                      : !repairResult.experiment
                        ? "下一步：在隔离项目副本中运行基线与候选 A/B。"
                        : repairResult.experiment.status !== "passed"
                          ? "当前不能批准：A/B 的输出等价、隔离或回归门禁未通过。"
                          : !repairApproval
                            ? "下一步：人工检查实验结果并批准当前候选哈希。"
                            : "下一步：安全写回；系统会同时保存可校验的一键回滚快照。"}
          </div>
          {repairResult?.patch.unifiedDiff ? <pre className="repair-diff">{repairResult.patch.unifiedDiff}</pre> : null}
          {repairResult ? (
            <details className="repair-detail-panel" open>
              <summary>候选修改详细信息</summary>
              <div>
                <span>状态 <b>{repairResult.patch.status}</b></span>
                <span>影响文件 <b>{repairResult.patch.changedFiles.length}</b></span>
                <span>基线 <code>{repairResult.patch.baselineHash.slice(0, 16)}</code></span>
                <span>候选 <code>{repairResult.patch.candidateHash.slice(0, 16)}</code></span>
              </div>
              <p>{repairResult.patch.evidence.join(" ")}</p>
              {repairApproval ? <p>批准时间：{new Date(repairApproval.approvedAt).toLocaleString("zh-CN")}；只批准当前候选哈希。</p> : null}
            </details>
          ) : null}
          {repairResult?.experiment ? (
            <div className="repair-gate-strip">
              <span>输出等价 <b>{repairResult.experiment.outputEquivalent ? "通过" : "失败"}</b></span>
              <span>强隔离 <b>{repairResult.experiment.allSandboxed ? "通过" : "失败"}</b></span>
              <span>基线 P95 <b>{repairResult.experiment.baselineP95Ms}ms</b></span>
              <span>候选 P95 <b>{repairResult.experiment.candidateP95Ms}ms</b></span>
            </div>
          ) : null}
          {repairRollbacks[activeProject.id] ? (
            <details className="repair-detail-panel">
              <summary>回滚快照详情</summary>
              <p>
                快照 {repairRollbacks[activeProject.id].id}，保存于 {new Date(repairRollbacks[activeProject.id].createdAt).toLocaleString("zh-CN")}。
                回滚前会再次校验当前候选哈希，项目已有新改动时会拒绝覆盖。
              </p>
            </details>
          ) : null}
          <div className="twin-limitations repair-evidence-boundary">
            <strong>当前项目的实验边界</strong>
            <p>沙箱、受控运行、资源采样和 A/B 门禁已经接入；以下内容表示当前项目本轮实验尚缺的动态证据。</p>
            {analysis.digitalTwin.limitations.map((item) => <p key={item}>{item}</p>)}
          </div>
        </article>

        <article className="analysis-card wide-card function-control-workbench" data-page="inspect">
          <div className="panel-heading">
            <div>
              <h2>主控代码树与执行轨迹</h2>
              <span>选择代码树中的函数，右侧轨迹同步显示它的上下游、断点和影响范围</span>
            </div>
          </div>
          <div className="function-control-grid">
            <section className="control-tree-pane">
              <header><strong>入口到函数层级</strong><span>{analysis.entryTree.length} 个节点</span></header>
              <div className="control-tree-canvas">
                {analysis.entryTree.map((node, index) => (
                  <button
                    type="button"
                    key={`${node.id}-${index}`}
                    className={`control-tree-node depth-${Math.min(node.depth ?? index, 8)} ${selectedFunction?.id === node.id ? "selected" : ""}`}
                    style={{ gridColumn: Math.min(9, (node.depth ?? 0) + 1) }}
                    onClick={() => setSelectedId(node.id)}
                  >
                    <strong>{node.name}</strong>
                    <span>{node.role} · {node.status}</span>
                    <small>上游 {node.upstreamIds?.length ?? 0} · 下游 {node.downstreamIds?.length ?? 0}</small>
                  </button>
                ))}
              </div>
            </section>
            <section className="control-trace-pane">
              <header><strong>执行轨迹</strong><span>{selectedFunction?.name ?? "等待选择"}</span></header>
              <div className="trace-list synchronized-trace">
                {selectedTrace.map((step, index) => (
                  <button
                    type="button"
                    className={`${step.stop ? "trace-step stop" : "trace-step"} ${selectedFunction?.id === step.id ? "selected" : ""}`}
                    key={`${step.id}-${index}`}
                    onClick={() => setSelectedId(step.id)}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div><strong>{step.name}</strong><small>{step.note}</small></div>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </article>

        <article className="analysis-card wide-card" data-page="map">
          <div className="panel-heading">
            <h2>水流法主控模型</h2>
            <span>用虚拟地形组织从输入到输出的数据路径</span>
          </div>
          <details className="water-method-principle">
            <summary>水流法与 Software Digital Twin</summary>
            <div className="software-twin-pipeline" aria-label="程序数字孪生分析管线">
              {['代码', 'AST', 'Program Graph', 'Data Flow', 'Runtime Simulation', 'System Model', 'Optimization'].map((step, index) => (
                <span key={step}>{step}{index < 6 ? <b>→</b> : null}</span>
              ))}
            </div>
            <p>语义层完整保存函数的参数、返回值、异常、状态和多对多调用关系；函数并不被强制改成单输入或单输出。</p>
            <p>水流表现层才把每个函数收束成一条入口干线和一条出口干线：多源在节点前汇聚，多分支在节点后展开，无关路径由虚拟地形分道绕行。</p>
          </details>
          <p className="completion-summary">{productTerminology(analysis.hydrologyModel.summary)}</p>
          <div className="hydrology-metrics">
            <span>
              <b>{analysis.hydrologyModel.stageCount}</b>
              处理阶段
            </span>
            <span>
              <b>{analysis.hydrologyModel.confluenceCount}</b>
              汇聚/分流
            </span>
            <span>
              <b>{analysis.hydrologyModel.storageCount}</b>
              容量节点
            </span>
            <span>
              <b>{analysis.hydrologyModel.riskCount}</b>
              警戒节点
            </span>
          </div>
          <div className="hydrology-columns">
            <section>
              <h3>水流法处理阶段</h3>
              <div className="hydrology-stage-list">
                {analysis.hydrologyModel.stages.slice(0, 10).map((stage) => (
                  <button
                    key={stage.id}
                    className={`hydrology-stage risk-${stage.riskLevel}`}
                    onClick={() => setSelectedWaterId(stage.functionId)}
                  >
                    <span>{String(stage.index).padStart(2, "0")}</span>
                    <div>
                      <strong>{shorten(stage.functionName, 28)}</strong>
                      <small>
                        {stage.codeRole} · {flowRoleLabel(stage.waterRole)} · {capacityLabel(stage.capacity)} · {stage.confidence}%
                      </small>
                      <small>
                        {stage.dataIn.join(", ")} -&gt; {stage.dataOut.join(", ")}
                      </small>
                    </div>
                  </button>
                ))}
                {!analysis.hydrologyModel.stages.length && (
                  <div className="empty-state">导入代码后生成从主控入口到输出口的数据流阶段。</div>
                )}
              </div>
            </section>
            <section>
              <h3>汇聚与分支节点</h3>
              <div className="hydrology-confluence-list">
                {analysis.hydrologyModel.confluences.slice(0, 6).map((point) => (
                  <button
                    key={point.id}
                    className={`hydrology-confluence risk-${point.riskLevel}`}
                    onClick={() => setSelectedWaterId(point.functionId)}
                  >
                    <div>
                      <strong>{shorten(point.name, 24)}</strong>
                      <span>{flowRoleLabel(point.waterRole)}</span>
                    </div>
                    <small>
                      上游 {point.upstreamCount} · 下游 {point.downstreamCount} · {capacityLabel(point.capacity)} · {point.confidence}%
                    </small>
                    <small>{productTerminology(point.evidence)}</small>
                  </button>
                ))}
                {!analysis.hydrologyModel.confluences.length && (
                  <div className="empty-state">当前没有明显的多源汇聚、分流或容量节点。</div>
                )}
              </div>
            </section>
          </div>
        </article>

        <article className="analysis-card wide-card map-integrity-report" data-page="map">
          <div className="panel-heading">
            <h2>水流法完整性</h2>
              <span>路径诊断与证据</span>
          </div>
          <div className="flow-list">
            <div className="flow-row closed">
              <strong>函数水流图</strong>
              <span>
                {analysis.flowEdges.length} 条边 · {analysis.flowEdges.filter((edge) => edge.kind === "闭环线路").length} 条闭环线路
              </span>
              <small>以虚拟地形组织主路径；每个函数保留一条主入口和一条主出口，多源在入口前汇聚，多分支在出口后分流，诊断只通过颜色和点击详情表达。</small>
            </div>
            <div className={`flow-row ${analysis.mapQuality.overlapCount ? "partially-closed" : "closed"}`}>
              <strong>地图可读性</strong>
              <span>
                {analysis.mapQuality.readabilityScore}% · {analysis.mapQuality.status}
              </span>
              <small>
                重叠 {analysis.mapQuality.overlapCount} · 无关交叉 {analysis.mapQuality.unrelatedCrossingCount} · 隔离通道 {analysis.mapQuality.bridgeCount} · 模块域 {analysis.mapQuality.basinCount} · 点击热区 {analysis.mapQuality.clickTarget}px
              </small>
            </div>
            <div className={`flow-row ${analysis.taintFlow.exposedPathCount ? "open" : analysis.taintFlow.candidatePathCount ? "partially-closed" : "closed"}`}>
              <strong>精确 Source-to-sink</strong>
              <span>
                {analysis.taintFlow.pathCount} 条路径 · 暴露 {analysis.taintFlow.exposedPathCount} · 已净化 {analysis.taintFlow.sanitizedPathCount} · 候选 {analysis.taintFlow.candidatePathCount}
              </span>
              <small>{analysis.taintFlow.summary}</small>
            </div>
            {analysis.taintFlow.paths.filter((path) => path.status !== "sanitized").slice(0, 6).map((path) => (
              <div className={`flow-row ${path.status === "exposed" ? "open" : "partially-closed"}`} key={path.id}>
                <strong>{path.sourceFunctionName} → {path.sinkFunctionName}</strong>
                <span>{path.sourceKind} → {path.sinkKind} · {path.evidenceGrade} · {path.confidence}%</span>
                <small>{path.functionIds.join(" → ")}{path.dataNames.length ? ` · 数据 ${path.dataNames.join(", ")}` : " · 数据绑定待补证"}</small>
              </div>
            ))}
            {analysis.flowNodes.map((node) => (
              <div className={`flow-row ${node.status.toLowerCase().replace(/\s+/g, "-")}`} key={node.id}>
                <strong>{node.name}</strong>
                <span>
                  {capacityLabel(node.capacity ?? inferNodeCapacity(node))} · {statusLabelForProduct(node.status)} · {nodeConfidence(node)}%
                </span>
                <small>{productTerminology(node.note)}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="analysis-card" data-page="diagnostics">
          <div className="panel-heading">
            <h2>诊断证据完整度</h2>
            <span>{analysis.diagnosticEvidenceAudit.status} · {analysis.diagnosticEvidenceAudit.completionScore}%</span>
          </div>
          <div className="hardcore-metrics diagnostic-evidence-metrics">
            <span><b>{analysis.diagnosticEvidenceAudit.confirmed}</b>真实确认</span>
            <span><b>{analysis.diagnosticEvidenceAudit.likely}</b>结构支持</span>
            <span><b>{analysis.diagnosticEvidenceAudit.possible}</b>候选待证</span>
            <span><b>{analysis.diagnosticEvidenceAudit.unknown}</b>未知</span>
          </div>
          <div className="diagnostic-evidence-summary">
            {analysis.diagnosticEvidenceAudit.evidence.map((item) => <p key={item}>{item}</p>)}
          </div>
          <details className="diagnostic-gap-details">
            <summary>哪些结论还不能确认</summary>
            <p>这里列出的不是软件开发进度，而是当前导入项目中缺少的编译、运行或环境信息。缺少这些证据时，相关问题只作为待核实线索，不会被当成确定错误。</p>
            <ul>
              {analysis.diagnosticEvidenceAudit.gaps.map((gap) => <li key={gap}>{gap}</li>)}
              {!analysis.diagnosticEvidenceAudit.gaps.length && <li>当前诊断已有结构与运行证据闭环。</li>}
            </ul>
          </details>
          <div className="runtime-actions">
            <button type="button" onClick={() => navigateWorkspacePage("hardcore")}>检查 Compiler / LSP 工具</button>
            <button type="button" onClick={() => navigateWorkspacePage("twin")}>生成当前项目运行证据</button>
          </div>
          <p className="project-isolation-note">
            软件具备这些分析能力，不等于每个新导入项目已经产生证据。当前项目的解析状态是：{parseResult.report.enhancement.status}；{parseResult.report.enhancement.evidence}
          </p>
        </article>

        <article className="analysis-card" data-page="diagnostics">
          <div className="panel-heading">
            <h2>安全检查</h2>
            <span>内部边界与外部入侵</span>
          </div>
          <IssueList issues={analysis.securityIssues} empty="当前未发现高置信安全入口。" />
        </article>

        <article className="analysis-card" data-page="diagnostics">
          <div className="panel-heading">
            <h2>数据元素检查</h2>
            <span>类型、状态与传递冲突</span>
          </div>
          <IssueList issues={analysis.elementConflicts} empty="当前未发现明显数据元素冲突。" />
        </article>

        <article className="analysis-card" data-page="diagnostics">
          <div className="panel-heading">
            <h2>运行环境检查</h2>
            <span>运行环境缺失影响</span>
          </div>
          <IssueList issues={analysis.environmentIssues} empty="当前环境载体基础完整。" />
        </article>

        <article className="analysis-card wide-card" data-page="diagnostics hardcore">
          <div className="panel-heading">
            <h2>本地规则命中</h2>
            <span>
              {analysis.knowledgeRuleReport.totalMatches} 条 · {analysis.knowledgeRuleReport.matchedFunctionCount} 函数
            </span>
          </div>
          <div className="hardcore-metrics">
            <span>
              <b>{analysis.knowledgeRuleReport.criticalCount}</b>
              Critical
            </span>
            <span>
              <b>{analysis.knowledgeRuleReport.riskCount}</b>
              Risk
            </span>
            <span>
              <b>{analysis.knowledgeRuleReport.warnCount}</b>
              Warn
            </span>
            <span>
              <b>{analysis.knowledgeRuleReport.infoCount}</b>
              Info
            </span>
          </div>
          <div className="issue-list">
            {analysis.knowledgeRuleReport.topMatches.map((match) => (
              <div className={`issue-row severity-${ruleSeverityClass(match.severity)}`} key={match.id}>
                <div>
                  <strong>{match.ruleName}</strong>
                  <span>
                    {match.severity} · {match.confidence}%
                  </span>
                </div>
                <p>{match.recommendation}</p>
                <small>
                  {match.functionName} · {match.fileName}:{match.line} · {match.matchedSignals.join(", ")}
                </small>
              </div>
            ))}
            {!analysis.knowledgeRuleReport.topMatches.length && (
              <div className="empty-state">当前项目没有命中本地规则，导入更完整的项目后会生成规则证据。</div>
            )}
          </div>
        </article>

        <article className="analysis-card wide-card" data-page="diagnostics">
          <div className="panel-heading">
            <h2>本地安全防御</h2>
            <span>{networkPolicy.enabled ? "官方公网受限开启" : "公网隔离"}</span>
          </div>
          <div className="local-defense-grid">
            <div><strong>公网总闸</strong><span>{networkPolicy.enabled ? "仅官方知识源" : "公网 IP 全部拒绝"}</span></div>
            <div><strong>本机 / 内网</strong><span>{networkPolicy.privateNetworkAllowed ? "独立可用" : "已关闭"}</span></div>
            <div><strong>内外网桥接</strong><span>{networkPolicy.bridgingAllowed ? "允许" : "永久禁止"}</span></div>
            <div><strong>入站服务</strong><span>{networkPolicy.inboundListener ? "发现监听" : "桌面内核不监听端口"}</span></div>
            <div><strong>项目执行</strong><span>无 OS 断网沙箱则拒绝</span></div>
            <div><strong>WebView</strong><span>生产 CSP connect-src none</span></div>
          </div>
          <p className="software-brief">{networkPolicy.scope}</p>
          <div className="defense-hosts">
            {networkPolicy.allowedHosts.map((host) => <span key={host}>{host}</span>)}
          </div>
          {networkPolicy.evidence.map((evidence) => <p className="project-isolation-note" key={evidence}>{evidence}</p>)}
        </article>

        <article className="analysis-card wide-card" data-page="diagnostics">
          <div className="panel-heading">
            <h2>依赖漏洞匹配</h2>
            <span>{dependencyKnowledgeReport.confirmedCount} 确认 · {dependencyKnowledgeReport.reviewCount} 待验证</span>
          </div>
          <p className="software-brief">
            已从 manifest 中识别 {dependencyKnowledgeReport.dependencyCount} 个依赖，只查询当前激活且签名有效的本地知识包。
            包名和版本窗口同时吻合才算确认；KEV 仅提高修复优先级。
          </p>
          <div className="dependency-match-list">
            {dependencyKnowledgeReport.matches.slice(0, 30).map((match) => (
              <div className={`dependency-match ${match.matchStatus}`} key={`${match.sourceFile}-${match.dependencyName}-${match.advisoryId}`}>
                <div>
                  <strong>{match.dependencyName} {match.dependencyVersion}</strong>
                  <span>{match.advisoryId} · {match.severity} · {match.confidence}%{match.kevPriority ? " · KEV优先" : ""}</span>
                </div>
                <p>{match.title}</p>
                <small>{match.sourceFile} · {match.cweIds.join("、") || "未提供 CWE"} · {match.evidence}</small>
              </div>
            ))}
            {!dependencyKnowledgeReport.matches.length && <div className="empty-state">{dependencyKnowledgeReport.evidence[0] ?? "当前激活知识包未命中项目依赖。"}</div>}
          </div>
        </article>

        <article className="analysis-card wide-card" data-page="diagnostics">
          <div className="panel-heading">
            <h2>流速控制</h2>
            <span>效率增长与稳定性下降权衡</span>
          </div>
          <div className="speed-grid">
            {analysis.speedOptions.map((option) => (
              <div className="speed-option" key={`${option.name}-${option.target}`}>
                <div>
                  <strong>{option.name}</strong>
                  <span>{option.target}</span>
                </div>
                <div className="metric-bars">
                  <label>
                    效率增长
                    <b>{option.efficiencyGain}%</b>
                    <i style={{ width: `${option.efficiencyGain}%` }} />
                  </label>
                  <label>
                    稳定风险
                    <b>{option.stabilityRisk}%</b>
                    <i style={{ width: `${option.stabilityRisk}%` }} />
                  </label>
                  <label>
                    适配评分
                    <b>{option.fitScore}%</b>
                    <i style={{ width: `${option.fitScore}%` }} />
                  </label>
                </div>
                <small>{option.model}：{option.reason}</small>
              </div>
            ))}
          </div>
        </article>
      </section>

      </section>
    </main>
  );
}
