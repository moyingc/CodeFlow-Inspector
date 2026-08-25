import type { CodeFile, FunctionInfo, GraphEdge, WorkspaceAnalysis } from "../analysis/types.ts";

export type ExplanationCertainty = "已证实" | "高可信推断" | "候选解释" | "信息不足";

export type CompleteFunctionExplanation = {
  id: string;
  name: string;
  technical: string;
  description: string;
  evidence: string;
  responsibility: string;
  algorithm: string;
  dataStructures: string[];
  inputs: string;
  processing: string;
  outputs: string;
  upstream: string;
  downstream: string;
  sideEffects: string;
  guards: string;
  certainty: ExplanationCertainty;
  uncertainty: string;
};

export type CompleteModuleExplanation = {
  id: string;
  title: string;
  purpose: string;
  confidence: number;
  evidence: string;
  actions: string[];
  functions: CompleteFunctionExplanation[];
  files: string[];
  collaboration: string;
};

export type CompleteFileExplanation = {
  id: string;
  path: string;
  language: string;
  role: string;
  responsibility: string;
  imports: string[];
  functions: string[];
  evidence: string;
};

export type CompleteSoftwareInterpretation = {
  technical: string;
  overview: string;
  architecture: string;
  modules: CompleteModuleExplanation[];
  files: CompleteFileExplanation[];
  flow: Array<{ id: string; index: number; technical: string; description: string; evidence: string }>;
  evidence: Array<{ label: string; detail: string }>;
  designReport: Array<{ title: string; body: string }>;
  coverage: {
    status: "v1 完整" | "待补结构证据";
    score: number;
    fileCoverage: number;
    functionCoverage: number;
    moduleCoverage: number;
    flowCoverage: number;
    evidenceCoverage: number;
    explainedFileCount: number;
    explainedFunctionCount: number;
    uncertainFunctionCount: number;
    gaps: string[];
  };
};

type ModuleRule = {
  id: string;
  title: string;
  purpose: string;
  signals: string[];
  categories?: string[];
};

const moduleRules: ModuleRule[] = [
  rule("entry_control", "入口与流程控制", "接收启动、请求、事件或命令，并组织后续模块执行。", ["main", "app", "bootstrap", "controller", "handler", "route", "entry", "start"]),
  rule("domain_business", "领域业务", "实现项目自身的核心业务规则和状态变化。", ["service", "manager", "workflow", "business", "project", "task", "order", "user", "account"], ["业务"]),
  rule("data_persistence", "数据持久化", "负责查询、写入、事务、模型映射和持久状态。", ["database", "sqlite", "sql", "orm", "repository", "crud", "query", "save", "load", "model"], ["模型"]),
  rule("api_network", "接口与网络", "负责协议请求、响应、连接和远程数据交换。", ["api", "http", "request", "response", "socket", "client", "server", "fetch", "router"]),
  rule("frontend_ui", "界面与交互", "负责页面、组件、表单、用户操作和可视状态。", ["component", "page", "view", "render", "react", "ui", "form", "button", "state"]),
  rule("parse_transform", "解析与数据转换", "把原始文本、文件、协议或对象转换成内部结构。", ["parse", "decode", "encode", "serialize", "deserialize", "convert", "transform", "normalize", "token", "graph"], ["解析"]),
  rule("algorithm_math", "算法与数学模型", "负责计算、搜索、排序、评分、优化、统计或数值模型。", ["algorithm", "calculate", "compute", "score", "rank", "sort", "search", "optimize", "matrix", "vector", "model"]),
  rule("schedule_concurrency", "调度与并发", "负责任务队列、时间调度、异步协作、线程或并发控制。", ["schedule", "queue", "worker", "thread", "async", "await", "promise", "lock", "semaphore", "cron"]),
  rule("security_validation", "安全与校验", "负责输入验证、身份权限、净化、加密和危险边界保护。", ["validate", "sanitize", "guard", "auth", "permission", "token", "security", "encrypt", "decrypt", "hash"], ["校验"]),
  rule("runtime_system", "运行时与系统资源", "负责进程、文件、内存、设备、操作系统和运行环境交互。", ["runtime", "process", "spawn", "exec", "file", "path", "memory", "device", "hardware", "serial", "gpio"], ["仿真"]),
  rule("observability", "日志与可观测性", "负责日志、指标、追踪、诊断和运行状态汇总。", ["log", "metric", "trace", "telemetry", "diagnostic", "report", "monitor", "progress"]),
  rule("test_quality", "测试与质量保障", "负责测试样本、断言、夹具、回归和结果核对。", ["test", "spec", "assert", "fixture", "mock", "benchmark", "verify"]),
  rule("configuration", "配置与依赖环境", "负责配置、环境变量、依赖装配和功能开关。", ["config", "setting", "environment", "env", "dependency", "manifest", "feature", "option"]),
  rule("general_processing", "通用处理", "承接暂时无法归入特定领域的局部计算或辅助步骤。", [], ["构建", "输入"]),
];

export function buildCompleteSoftwareInterpretation(
  files: CodeFile[],
  functions: FunctionInfo[],
  edges: GraphEdge[],
  analysis: WorkspaceAnalysis,
): CompleteSoftwareInterpretation {
  const functionMap = new Map(functions.map((fn) => [fn.id, fn]));
  const stageMap = new Map(analysis.hydrologyModel.stages.map((stage) => [stage.functionId, stage]));
  const assignments = functions.map((fn) => ({ fn, rule: selectModule(fn, files.find((file) => file.id === fn.fileId)) }));
  const explanationMap = new Map(
    assignments.map(({ fn, rule }) => [fn.id, explainFunction(fn, rule, edges, functionMap, stageMap.get(fn.id))]),
  );
  const modules = buildModules(assignments, explanationMap, edges);
  const fileExplanations = files.map((file) => explainFile(file, functions.filter((fn) => fn.fileId === file.id), modules));
  const flow = buildMainFlow(functions, edges, analysis, explanationMap);
  const purpose = inferPurpose(modules, fileExplanations, functions);
  const architecture = explainArchitecture(files, functions, modules, analysis);
  const moduleNarrative = explainModuleCollaboration(modules);
  const flowNarrative = explainFlowNarrative(flow, functions.length);
  const evidence = buildEvidence(files, functions, edges, analysis, modules);
  const coverage = buildCoverage(files, functions, edges, modules, fileExplanations, flow, explanationMap);
  const entry = analysis.entryFunction?.name ?? analysis.hydrologyModel.entryName ?? "尚未识别入口";
  const mainFile = analysis.mainFile?.name ?? files[0]?.name ?? "尚未识别主控文件";
  const outputs = analysis.hydrologyModel.outputNames.join("、") || terminalFunctions(functions, edges).map((fn) => fn.name).join("、") || "尚未识别明确输出";
  const languages = unique(files.map((file) => file.language)).join("、") || "未知语言";

  return {
    technical:
      `技术说明：本地解析器读取了 ${files.length} 个文件，涉及 ${languages}，识别出 ${functions.length} 个函数、${edges.length} 条调用关系和 ${analysis.flowEdges.length} 条数据传递关系。` +
      `系统把 ${mainFile} 识别为主控候选，把 ${entry} 识别为主要入口，并按照“文件职责、函数输入输出、调用关系、模块协作、入口到结果”的顺序重建程序结构。` +
      `${architecture}${moduleNarrative}` +
      `所有结论都区分 Compiler、LSP、Tree-sitter、AST 等解析事实与本地规则推断；证据不足的内容只作为候选解释。`,
    overview:
      `功能解读：从现有代码能够确认，这个软件主要用于${purpose}。程序通常由 ${entry} 接收 ${summarizeProjectInputs(functions)}，` +
      `再把数据交给不同模块完成读取、校验、转换、业务处理、持久化或结果输出。${moduleNarrative}${flowNarrative}` +
      `最终可识别的结果包括 ${outputs}。本报告已解释 ${coverage.explainedFileCount}/${files.length} 个文件和 ${coverage.explainedFunctionCount}/${functions.length} 个函数；` +
      `${coverage.uncertainFunctionCount} 个函数仍缺少充分的类型、调用或运行证据，因此保留不确定标记，不把推断写成事实。`,
    architecture,
    modules,
    files: fileExplanations,
    flow,
    evidence,
    designReport: buildDesignReport(purpose, architecture, modules, fileExplanations, flow, analysis, coverage),
    coverage,
  };
}

function rule(id: string, title: string, purpose: string, signals: string[], categories?: string[]): ModuleRule {
  return { id, title, purpose, signals, categories };
}

function selectModule(fn: FunctionInfo, file?: CodeFile) {
  const name = words(fn.name);
  const path = words(fn.fileName);
  const contract = words(`${fn.summary} ${fn.params.join(" ")} ${fn.returnType} ${fn.sideEffects.join(" ")} ${file?.imports?.join(" ") ?? ""}`);
  const ranked = moduleRules.map((candidate) => {
    const signalScore = candidate.signals.reduce((score, signal) => {
      const term = words(signal);
      return score + (containsTerm(name, term) ? 18 : 0) + (containsTerm(path, term) ? 7 : 0) + (containsTerm(contract, term) ? 2 : 0);
    }, 0);
    return { candidate, score: signalScore + (candidate.categories?.includes(fn.category) ? 5 : 0) };
  }).sort((a, b) => b.score - a.score);
  return ranked[0]?.score ? ranked[0].candidate : moduleRules[moduleRules.length - 1];
}

function explainFunction(
  fn: FunctionInfo,
  moduleRule: ModuleRule,
  edges: GraphEdge[],
  functionMap: Map<string, FunctionInfo>,
  stage?: WorkspaceAnalysis["hydrologyModel"]["stages"][number],
): CompleteFunctionExplanation {
  const upstreamNames = edges.filter((edge) => edge.to === fn.id).map((edge) => functionMap.get(edge.from)?.name ?? edge.from);
  const downstreamNames = edges.filter((edge) => edge.from === fn.id).map((edge) => functionMap.get(edge.to)?.name ?? edge.to);
  const responsibility = functionResponsibility(fn, moduleRule);
  const algorithm = explainAlgorithm(fn);
  const dataStructures = detectDataStructures(fn);
  const inputs = functionInputs(fn);
  const outputs = functionOutputs(fn);
  const processing = explainProcessing(fn, algorithm, dataStructures);
  const sideEffects = fn.sideEffects.length ? unique(fn.sideEffects).join("、") : "没有解析到明确外部副作用，主要通过返回值或局部状态传递结果";
  const guards = fn.validations.length ? unique(fn.validations).join("、") : fn.externalInputs.length ? "存在外部输入，但尚未解析到明确校验" : "没有外部输入证据，未要求额外入口校验";
  const certainty = functionCertainty(fn, edges);
  const uncertainty = functionUncertainty(fn, upstreamNames, downstreamNames, certainty);
  const technical = `${fn.fileName}:${fn.startLine}-${fn.endLine} · ${fn.language} · ${fn.parser ?? fn.source} · complexity ${fn.complexity} · ${fn.dataShape}`;
  const upstream = upstreamNames.length ? unique(upstreamNames).join("、") : "没有识别到调用它的函数，可能是入口、回调、公开 API 或未解析的动态调用";
  const downstream = downstreamNames.length ? unique(downstreamNames).join("、") : "没有识别到下游函数，结果可能直接返回、写入状态或调用外部库";
  return {
    id: fn.id,
    name: fn.name,
    technical,
    responsibility,
    algorithm,
    dataStructures,
    inputs,
    processing,
    outputs,
    upstream,
    downstream,
    sideEffects,
    guards,
    certainty,
    uncertainty,
    description:
      `${fn.name} 负责${responsibility}。它接收 ${inputs}，随后${processing}，最终产生 ${outputs}。` +
      `上游：${upstream}；下游：${downstream}。算法/策略：${algorithm}。数据结构：${dataStructures.join("、") || "未识别到专用容器"}。` +
      `副作用：${sideEffects}。保护边界：${guards}。可信度：${certainty}。${uncertainty}`,
    evidence:
      `证据：${fn.source} ${fn.confidence}%；${fn.parser ?? "无专用解析器"}；` +
      `${stage ? `代码流程角色 ${stage.codeRole}；` : ""}` +
      `${(fn.parseEvidence ?? []).slice(-3).join("；") || "函数签名、主体和调用边"}。`,
  };
}

function buildModules(
  assignments: Array<{ fn: FunctionInfo; rule: ModuleRule }>,
  explanations: Map<string, CompleteFunctionExplanation>,
  edges: GraphEdge[],
) {
  const buckets = new Map<string, { rule: ModuleRule; functions: FunctionInfo[] }>();
  assignments.forEach(({ fn, rule: moduleRule }) => {
    const bucket = buckets.get(moduleRule.id) ?? { rule: moduleRule, functions: [] };
    bucket.functions.push(fn);
    buckets.set(moduleRule.id, bucket);
  });
  return Array.from(buckets.values()).map(({ rule: moduleRule, functions }) => {
    const functionInsights = functions.map((fn) => explanations.get(fn.id)).filter((item): item is CompleteFunctionExplanation => Boolean(item));
    const ids = new Set(functions.map((fn) => fn.id));
    const incoming = edges.filter((edge) => !ids.has(edge.from) && ids.has(edge.to)).length;
    const outgoing = edges.filter((edge) => ids.has(edge.from) && !ids.has(edge.to)).length;
    const confidence = Math.round(functions.reduce((sum, fn) => sum + fn.confidence, 0) / Math.max(1, functions.length));
    return {
      id: moduleRule.id,
      title: moduleRule.title,
      purpose: `${moduleRule.purpose} 本项目中具体承担：${unique(functionInsights.map((item) => item.responsibility)).slice(0, 6).join("、")}。`,
      confidence,
      evidence: `${functions.length} 个函数、${unique(functions.map((fn) => fn.fileName)).length} 个文件、${incoming} 条跨模块输入、${outgoing} 条跨模块输出。`,
      actions: unique(functionInsights.map((item) => item.responsibility)).slice(0, 8),
      functions: functionInsights,
      files: unique(functions.map((fn) => fn.fileName)),
      collaboration: `从其他模块接收 ${incoming} 条调用，并向其他模块输出 ${outgoing} 条调用。`,
    };
  }).sort((a, b) => b.functions.length - a.functions.length || a.title.localeCompare(b.title));
}

function explainFile(file: CodeFile, functions: FunctionInfo[], modules: CompleteModuleExplanation[]): CompleteFileExplanation {
  const moduleNames = modules.filter((module) => module.functions.some((fn) => functions.some((candidate) => candidate.id === fn.id))).map((module) => module.title);
  const role = fileRole(file, functions);
  return {
    id: file.id,
    path: file.name,
    language: file.language,
    role,
    responsibility: functions.length
      ? `这个文件主要负责${unique(functions.map((fn) => functionResponsibility(fn, selectModule(fn, file)))).slice(0, 8).join("、")}，属于 ${moduleNames.join("、") || "通用处理"}。`
      : `这个文件没有解析到函数，作用主要由文件类型和依赖判断为“${role}”；它可能是配置、数据、声明、资源或尚未支持的代码结构。`,
    imports: unique(file.imports ?? []),
    functions: functions.map((fn) => fn.name),
    evidence: `${file.language} · ${functions.length} 个函数 · ${(file.imports ?? []).length} 个依赖 · ${(file.environmentRefs ?? []).length} 个环境引用。`,
  };
}

function buildMainFlow(
  functions: FunctionInfo[],
  edges: GraphEdge[],
  analysis: WorkspaceAnalysis,
  explanations: Map<string, CompleteFunctionExplanation>,
) {
  const orderedIds = orderedReachableIds(analysis.entryFunction?.id, functions, edges);
  return orderedIds.map((id, index) => {
    const fn = functions.find((candidate) => candidate.id === id);
    const explanation = explanations.get(id);
    const stage = analysis.hydrologyModel.stages.find((candidate) => candidate.functionId === id);
    return {
      id: `complete-flow-${id}`,
      index: index + 1,
      technical: `${fn?.name ?? id} · ${stage?.codeRole ?? "处理节点"} · ${fn?.fileName ?? "未知文件"}:${fn?.startLine ?? 0}`,
      description: explanation
        ? `${explanation.name} 接收 ${explanation.inputs}，${explanation.processing}，然后产生 ${explanation.outputs}。下一步流向：${explanation.downstream}。`
        : "该步骤存在于调用图，但没有足够函数事实生成说明。",
      evidence: explanation?.evidence ?? "证据不足。",
    };
  });
}

function buildDesignReport(
  purpose: string,
  architecture: string,
  modules: CompleteModuleExplanation[],
  files: CompleteFileExplanation[],
  flow: CompleteSoftwareInterpretation["flow"],
  analysis: WorkspaceAnalysis,
  coverage: CompleteSoftwareInterpretation["coverage"],
) {
  const moduleText = modules.map((module) => `${module.title}包含 ${module.functions.length} 个函数。${module.purpose}${module.collaboration}`).join(" ");
  const fileText = files.map((file) => `${file.path}（${file.language}）属于${file.role}，${file.responsibility}`).join(" ");
  const flowText = flow.slice(0, 40).map((step) => step.technical.split(" · ")[0]).join(" -> ") || "尚未形成可达主流程";
  const allFunctions = modules.flatMap((module) => module.functions);
  const algorithmText = unique(allFunctions.map((fn) => `${fn.name}：${fn.algorithm}`)).slice(0, 24).join(" ");
  const contractText = unique(allFunctions.map((fn) => `${fn.name} 接收 ${fn.inputs}，产生 ${fn.outputs}`)).slice(0, 24).join("；");
  const boundaryText = unique(allFunctions.map((fn) => `${fn.name}：${fn.guards}`)).slice(0, 20).join("；");
  const uncertain = allFunctions.filter((fn) => fn.certainty === "候选解释" || fn.certainty === "信息不足");
  return [
    {
      title: "设计意图与使用目标",
      body: `从文件组织、入口函数、函数名称、输入输出和调用关系反推，这个项目的核心目标是${purpose}。` +
        `它不是把每个函数孤立运行，而是由入口接收数据，经过职责明确的模块处理，再把结果返回、保存或交给外部接口。` +
        `${architecture}这说明作者倾向于按功能职责拆分代码，并通过函数调用组合完整业务能力。`,
    },
    {
      title: "架构与模块协作",
      body: moduleText || "当前没有解析到可组织的函数模块，因此还不能可靠判断模块边界。",
    },
    {
      title: "文件职责与代码组织",
      body: fileText || "当前没有可解释文件。" ,
    },
    {
      title: "完整执行主流程",
      body: `当前从入口能够还原出的执行顺序为 ${flowText}。箭头表示已识别的调用或数据传递方向；不在入口可达路径中的函数仍保留在文件和模块清单中，可能由框架、回调、测试或外部接口触发。`,
    },
    {
      title: "函数契约与数据设计",
      body: contractText ? `主要函数契约如下：${contractText}。这些契约用于说明数据从哪里进入、经过哪些处理以及以何种形式离开函数。` : "当前没有足够的函数输入输出证据。",
    },
    {
      title: "算法与实现策略",
      body: algorithmText ? `代码中识别到的主要实现策略包括：${algorithmText}。这些判断来自函数主体和调用事实；若只有函数名称证据，则仍属于候选解释。` : "当前没有识别到可确认的专用算法，代码主要表现为顺序处理和函数组合。",
    },
    {
      title: "安全、稳定性与运行环境",
      body: `当前输入到输出完整度为 ${analysis.closureScore}%，安全边界评分为 ${analysis.damScore}%，环境完整度为 ${analysis.environmentScore}%。` +
        `${boundaryText ? `已识别的函数保护边界包括：${boundaryText}。` : "尚未识别到明确的输入保护边界。"}` +
        `这些分数用于确定检查优先级，不等同于程序已经通过安全审计或业务正确性证明。`,
    },
    {
      title: "反推结论与待确认事项",
      body: `结构覆盖率为 ${coverage.score}%。${uncertain.length ? `${uncertain.length} 个函数仍需确认：${uncertain.slice(0, 20).map((fn) => fn.name).join("、")}。` : "当前函数均有较完整的结构证据。"}` +
        `动态调用、反射、运行期生成代码、外部服务响应和源码中没有表达的业务规则，必须通过 LSP、真实运行、测试样本或设计文档继续验证。`,
    },
  ];
}

function buildEvidence(files: CodeFile[], functions: FunctionInfo[], edges: GraphEdge[], analysis: WorkspaceAnalysis, modules: CompleteModuleExplanation[]) {
  return [
    { label: "结构覆盖", detail: `${files.length} 个文件、${functions.length} 个函数、${modules.length} 个模块` },
    { label: "入口与输出", detail: `${analysis.entryFunction?.name ?? "未识别入口"} -> ${analysis.hydrologyModel.outputNames.join("、") || "未识别输出"}` },
    { label: "解析事实", detail: unique(functions.map((fn) => `${fn.parser ?? fn.source} ${fn.confidence}%`)).slice(0, 12).join("、") || "无函数解析事实" },
    { label: "调用与数据", detail: `${edges.length} 条调用边、${analysis.flowEdges.length} 条数据传递关系、${analysis.flowEdges.filter((edge) => edge.evidenceGrade === "runtime").length} 条运行观测关系` },
    { label: "依赖与环境", detail: `${unique(files.flatMap((file) => file.imports ?? [])).length} 个依赖、${unique(files.flatMap((file) => file.environmentRefs ?? [])).length} 个环境引用` },
    { label: "诊断与规则", detail: `${analysis.knowledgeRuleReport.matches.length} 条规则命中、${analysis.issues.length} 个诊断候选；问题结论与功能说明分开呈现` },
  ];
}

function buildCoverage(
  files: CodeFile[],
  functions: FunctionInfo[],
  edges: GraphEdge[],
  modules: CompleteModuleExplanation[],
  fileExplanations: CompleteFileExplanation[],
  flow: CompleteSoftwareInterpretation["flow"],
  explanations: Map<string, CompleteFunctionExplanation>,
): CompleteSoftwareInterpretation["coverage"] {
  const functionCoverage = ratio(explanations.size, functions.length);
  const fileCoverage = ratio(fileExplanations.length, files.length);
  const moduleFunctionCount = new Set(modules.flatMap((module) => module.functions.map((fn) => fn.id))).size;
  const moduleCoverage = ratio(moduleFunctionCount, functions.length);
  const reachable = new Set(flow.map((step) => step.id.replace("complete-flow-", ""))).size;
  const flowCoverage = ratio(reachable, functions.length);
  const evidenceCount = functions.filter((fn) => fn.parser || fn.parseEvidence?.length || fn.source).length;
  const evidenceCoverage = ratio(evidenceCount, functions.length);
  const structuralScores = [fileCoverage, functionCoverage, moduleCoverage, evidenceCoverage];
  const score = functions.length ? Math.round(structuralScores.reduce((sum, value) => sum + value, 0) / structuralScores.length) : files.length ? fileCoverage : 0;
  const uncertainFunctionCount = Array.from(explanations.values()).filter((item) => item.certainty === "候选解释" || item.certainty === "信息不足").length;
  const gaps = [
    fileCoverage < 100 ? "存在未生成职责的文件" : "",
    functionCoverage < 100 ? "存在未生成说明的函数" : "",
    moduleCoverage < 100 ? "存在未归类函数" : "",
    flowCoverage < 100 ? `${functions.length - reachable} 个函数不在入口可达主流程中，已保留在模块/文件说明` : "",
    evidenceCoverage < 100 ? "部分函数缺少 Parser/Compiler/LSP/AST 证据" : "",
    !edges.length && functions.length > 1 ? "调用图为空，函数顺序不能作为真实主流程" : "",
  ].filter(Boolean);
  return {
    status: score === 100 ? "v1 完整" : "待补结构证据",
    score,
    fileCoverage,
    functionCoverage,
    moduleCoverage,
    flowCoverage,
    evidenceCoverage,
    explainedFileCount: fileExplanations.length,
    explainedFunctionCount: explanations.size,
    uncertainFunctionCount,
    gaps,
  };
}

function functionResponsibility(fn: FunctionInfo, moduleRule: ModuleRule) {
  const name = words(fn.name);
  const target = targetPhrase(name, moduleRule.title);
  if (/\b(create|add|insert|new)\b/.test(name)) return `创建${target}`;
  if (/\b(delete|remove|destroy|drop)\b/.test(name)) return `删除${target}`;
  if (/\b(update|edit|patch|set|write)\b/.test(name)) return `更新或写入${target}`;
  if (/\b(get|list|load|fetch|read|query|find|select)\b/.test(name)) return `读取或查询${target}`;
  if (/\b(parse|decode|deserialize|tokenize)\b/.test(name)) return `解析${target}并构造内部结构`;
  if (/\b(encode|serialize|render|export|format)\b/.test(name)) return `把${target}组织成输出格式`;
  if (/\b(validate|check|ensure|guard|verify)\b/.test(name)) return `校验${target}并阻止非法状态继续传播`;
  if (/\b(analyze|analyse|inspect|audit|scan)\b/.test(name)) return `分析或检查${target}`;
  if (/\b(calculate|compute|score|rank|sort|search|optimize|recommend)\b/.test(name)) return `计算、比较或选择${target}`;
  if (/\b(run|execute|start|schedule|dispatch|handle)\b/.test(name)) return `启动、调度或处理${target}`;
  if (/\b(build|generate|assemble|merge|collect)\b/.test(name)) return `收集并组装${target}`;
  if (fn.summary && !/function|method|处理业务步骤|处理当前模块的业务逻辑|主要负责处理/i.test(fn.summary)) return normalizeSentence(cleanCodeSummary(fn.summary));
  return `处理${target}相关步骤`;
}

function explainAlgorithm(fn: FunctionInfo) {
  const text = `${fn.name} ${fn.summary} ${fn.body}`;
  const lower = text.toLowerCase();
  const algorithms: string[] = [];
  if (new RegExp(`\\b${escapeRegExp(fn.name)}\\s*\\(`).test(fn.body.replace(new RegExp(`(?:function|def|fn|func)\\s+${escapeRegExp(fn.name)}[^\\n{]*`, "i"), ""))) algorithms.push("递归：函数会再次调用自身，需要关注终止条件和调用栈");
  if (/\b(bfs|breadth.first|queue)\b/.test(lower)) algorithms.push("广度优先/队列遍历：按层处理待访问元素");
  if (/\b(dfs|depth.first|stack)\b/.test(lower)) algorithms.push("深度优先/栈遍历：沿分支深入后回溯");
  if (/binary.search|二分|mid\s*=/.test(lower)) algorithms.push("二分查找：每轮缩小一半搜索范围");
  if (/\.sort\s*\(|sorted\s*\(|sort\.slice|collections\.sort/.test(lower)) algorithms.push("排序：先建立有序结果，再进行选择或输出");
  if (/\.filter\s*\(|\bfilter\s*\(/.test(lower)) algorithms.push("过滤：按条件保留符合要求的数据");
  if (/\.map\s*\(|\bmap\s*\(/.test(lower)) algorithms.push("映射：逐项把输入转换为新值");
  if (/\.reduce\s*\(|\breduce\s*\(|\bfold\s*\(/.test(lower)) algorithms.push("归约/聚合：把多个元素合并为一个结果");
  if (/priority|heap|score|rank/.test(lower)) algorithms.push("优先级评分：计算权重后排序或选择候选");
  if (/cache|memo|lru/.test(lower)) algorithms.push("缓存/记忆化：用额外内存减少重复计算或 I/O");
  if (/transaction|commit|rollback/.test(lower)) algorithms.push("事务：把多步写操作作为整体提交或回滚");
  if (/switch\s*\(|\bmatch\b|case\s+/.test(lower)) algorithms.push("状态/分支机：按离散条件进入不同处理路径");
  if (/regex|regexp|\.match\s*\(|re\.compile/.test(lower)) algorithms.push("模式匹配：用正则或规则识别文本结构");
  if (/async|await|promise|future|thread|goroutine|channel/.test(lower)) algorithms.push("异步/并发协作：等待外部任务或让多个任务交错执行");
  if (/for\s*\(|for\s+.+\s+in\s+|while\s*\(/.test(lower) && !algorithms.some((item) => /遍历/.test(item))) algorithms.push("线性遍历：逐项检查或处理集合中的元素");
  return algorithms.length ? unique(algorithms).join("；") : "顺序处理/直接调用：当前没有识别到专用算法，主要按语句和函数调用顺序完成工作";
}

function detectDataStructures(fn: FunctionInfo) {
  const text = `${fn.params.join(" ")} ${fn.returnType} ${fn.outputs.join(" ")} ${fn.body}`.toLowerCase();
  const structures: string[] = [];
  if (/\b(array|list|vec|vector|slice|tuple)\b|\[\]|\[[^\]]*\]/.test(text)) structures.push("顺序集合（Array/List/Vec/Slice）");
  if (/\b(map|dict|dictionary|hashmap|record)\b|\{\s*\w+\s*:/.test(text)) structures.push("键值映射（Map/Dict/Record）");
  if (/\b(set|hashset)\b/.test(text)) structures.push("去重集合（Set）");
  if (/\b(queue|deque|channel)\b/.test(text)) structures.push("队列/通道");
  if (/\b(stack)\b/.test(text)) structures.push("栈");
  if (/\b(tree|node|children|parent)\b/.test(text)) structures.push("树/层级节点");
  if (/\b(graph|edge|vertex|adjacency)\b/.test(text)) structures.push("图/边集合");
  if (/\b(stream|buffer|bytes|bytearray)\b/.test(text)) structures.push("流/缓冲区");
  if (/\b(model|entity|row|session|query)\b/.test(text)) structures.push("持久化实体/数据库结果");
  return unique(structures);
}

function explainProcessing(fn: FunctionInfo, algorithm: string, structures: string[]) {
  const steps: string[] = [];
  if (fn.validations.length) steps.push(`先执行 ${unique(fn.validations).join("、")} 等校验`);
  if (/try\s*\{|\btry:|catch\s*\(|except\b/.test(fn.body)) steps.push("在异常边界内执行核心操作并处理失败出口");
  if (/\bif\b|switch\s*\(|\bmatch\b/.test(fn.body)) steps.push("根据条件选择处理分支");
  if (/for\s*\(|for\s+.+\s+in\s+|while\s*\(/.test(fn.body)) steps.push("遍历输入或重复执行步骤");
  if (fn.calls.length) steps.push(`调用 ${fn.calls.slice(0, 8).join("、")} 完成子步骤`);
  if (structures.length) steps.push(`使用 ${structures.join("、")} 保存或传递中间数据`);
  if (!steps.length) steps.push(`按顺序执行局部语句；${algorithm}`);
  return steps.join("，再");
}

function functionInputs(fn: FunctionInfo) {
  const values = unique([...fn.params, ...fn.externalInputs]);
  return values.length ? values.join("、") : "隐式上下文、对象状态或无显式输入";
}

function functionOutputs(fn: FunctionInfo) {
  const values = unique([...fn.outputs.filter((value) => !["void", "state change/void"].includes(value)), fn.returnType && fn.returnType !== "void" ? fn.returnType : ""]);
  return values.length ? values.join("、") : fn.sideEffects.length ? `状态变化（${unique(fn.sideEffects).join("、")}）` : "void/无显式返回";
}

function functionCertainty(fn: FunctionInfo, edges: GraphEdge[]): ExplanationCertainty {
  const hasStrongParser = /Compiler|LSP|Tree-sitter|AST/i.test(`${fn.parser} ${(fn.parseEvidence ?? []).join(" ")}`);
  const linked = edges.some((edge) => edge.from === fn.id || edge.to === fn.id);
  if (hasStrongParser && fn.confidence >= 88 && (linked || fn.params.length || fn.outputs.length)) return "已证实";
  if (fn.source === "Parser Fact" && fn.confidence >= 72) return "高可信推断";
  if (fn.body || fn.name) return "候选解释";
  return "信息不足";
}

function functionUncertainty(fn: FunctionInfo, upstream: string[], downstream: string[], certainty: ExplanationCertainty) {
  const gaps = [
    !fn.returnType || ["unknown", "inferred"].includes(fn.returnType) ? "返回类型未由类型系统确认" : "",
    !upstream.length ? "上游调用可能来自框架、回调、反射或外部入口" : "",
    !downstream.length && fn.calls.length ? "部分被调用目标没有解析到项目内定义" : "",
    fn.source === "Heuristic" ? "函数边界或职责来自启发式扫描" : "",
  ].filter(Boolean);
  return gaps.length ? `未确定项：${gaps.join("；")}。` : certainty === "已证实" ? "当前结构证据完整，但业务规则仍需运行样本验证。" : "仍需运行样本验证业务含义。";
}

function fileRole(file: CodeFile, functions: FunctionInfo[]) {
  const text = words(`${file.name} ${(file.imports ?? []).join(" ")} ${functions.map((fn) => fn.name).join(" ")}`);
  if (/package json|requirements|cargo toml|pom xml|gradle|config|manifest|dockerfile/.test(text)) return "依赖或运行环境配置";
  if (/test|spec|fixture|mock|benchmark/.test(text)) return "测试与验证载体";
  if (/main|index|app|server|controller|bootstrap/.test(text)) return "入口或主控文件";
  if (/model|entity|schema|database|repository|crud/.test(text)) return "数据模型或持久化文件";
  if (/component|page|view|ui|screen/.test(text)) return "界面与交互文件";
  if (/parser|compiler|analyzer|flow|graph/.test(text)) return "解析与分析文件";
  if (!functions.length) return "配置、声明、资源或未解析文件";
  return "业务或辅助实现文件";
}

function inferPurpose(modules: CompleteModuleExplanation[], files: CompleteFileExplanation[], functions: FunctionInfo[]) {
  const dominant = modules.slice().sort((a, b) => b.functions.length - a.functions.length).slice(0, 5);
  const subjects = inferDomainSubjects(functions);
  if (dominant.length) {
    const subjectText = subjects.length ? `管理和处理 ${subjects.join("、")} 等核心对象` : "处理项目中的核心数据";
    return `${subjectText}，并由 ${dominant.map((module) => module.title).join("、")} 共同完成对应业务`;
  }
  const fileRoles = unique(files.map((file) => file.role));
  return fileRoles.length ? `组织${fileRoles.join("、")}` : functions.length ? "处理代码中定义的数据和业务步骤" : "提供配置、声明或资源数据";
}

function explainArchitecture(files: CodeFile[], functions: FunctionInfo[], modules: CompleteModuleExplanation[], analysis: WorkspaceAnalysis) {
  const layers = modules.map((module) => module.title).join(" -> ") || "尚未形成模块层";
  const storage = modules.some((module) => module.id === "data_persistence") ? "存在持久化层" : "未识别独立持久化层";
  const interfaceLayer = modules.some((module) => ["api_network", "frontend_ui", "entry_control"].includes(module.id)) ? "存在入口/接口/界面层" : "入口层证据不足";
  return `架构上可见 ${files.length} 个文件和 ${modules.length} 个功能模块，主要协作顺序为 ${layers}；${interfaceLayer}，${storage}。` +
    `入口能够连接 ${analysis.hydrologyModel.stageCount}/${functions.length} 个函数，跨模块关系由函数调用和数据传递证据建立。`;
}

function explainModuleCollaboration(modules: CompleteModuleExplanation[]) {
  if (!modules.length) return "当前还没有足够证据划分功能模块。";
  return modules.slice(0, 8).map((module, index) =>
    `${index === 0 ? "其中，" : "随后，"}${module.title}由 ${module.functions.map((fn) => fn.name).slice(0, 8).join("、")} 等函数组成，` +
    `主要负责 ${module.actions.slice(0, 6).join("、") || normalizeSentence(module.purpose)}。`,
  ).join("");
}

function explainFlowNarrative(flow: CompleteSoftwareInterpretation["flow"], functionCount: number) {
  if (!flow.length) return "当前没有足够的调用证据还原执行顺序。";
  const path = flow.slice(0, 18).map((step) => step.technical.split(" · ")[0]).join(" -> ");
  const remainder = flow.length > 18 ? `，其后还有 ${flow.length - 18} 个步骤` : "";
  return `当前可还原的主要执行顺序是 ${path}${remainder}。入口路径覆盖 ${flow.length}/${functionCount} 个函数。`;
}

function inferDomainSubjects(functions: FunctionInfo[]) {
  const ignored = new Set([
    "all", "auto", "strict", "future", "today", "current", "data", "result", "process", "item", "value", "handler", "service", "manager", "helper",
    "analyze", "files", "function", "graph", "flow", "integrity", "test", "validate", "build", "run", "parse", "render", "collect", "output", "runtime", "case",
  ]);
  return unique(functions.flatMap((fn) => targetPhrase(words(fn.name), "").split(" ")))
    .filter((word) => word.length > 2 && !ignored.has(word))
    .map(domainSubjectLabel)
    .slice(0, 8);
}

function orderedReachableIds(entryId: string | undefined, functions: FunctionInfo[], edges: GraphEdge[]) {
  const valid = new Set(functions.map((fn) => fn.id));
  const outgoing = new Map<string, string[]>();
  edges.forEach((edge) => {
    if (valid.has(edge.from) && valid.has(edge.to)) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  });
  const queue = entryId && valid.has(entryId) ? [entryId] : functions[0] ? [functions[0].id] : [];
  const visited = new Set<string>();
  const ordered: string[] = [];
  while (queue.length) {
    const id = queue.shift();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    ordered.push(id);
    (outgoing.get(id) ?? []).forEach((next) => queue.push(next));
  }
  functions.filter((fn) => !visited.has(fn.id)).sort((a, b) => a.fileName.localeCompare(b.fileName) || a.startLine - b.startLine).forEach((fn) => ordered.push(fn.id));
  return ordered;
}

function terminalFunctions(functions: FunctionInfo[], edges: GraphEdge[]) {
  const withOutput = new Set(edges.map((edge) => edge.from));
  return functions.filter((fn) => !withOutput.has(fn.id));
}

function summarizeProjectInputs(functions: FunctionInfo[]) {
  const inputs = unique(functions.flatMap((fn) => [...fn.params, ...fn.externalInputs])).slice(0, 12);
  return inputs.length ? inputs.join("、") : "内部状态或无显式输入";
}

function targetPhrase(name: string, fallback: string) {
  const cleaned = name.replace(/\b(create|add|insert|new|delete|remove|destroy|drop|update|edit|patch|set|write|get|list|load|fetch|read|query|find|select|parse|decode|deserialize|tokenize|encode|serialize|render|export|format|validate|check|ensure|guard|verify|analyze|analyse|inspect|audit|scan|calculate|compute|score|rank|sort|search|optimize|recommend|run|execute|start|schedule|dispatch|handle|build|generate|assemble|merge|collect)\b/g, "").trim();
  return readableTarget(cleaned || fallback);
}

function readableTarget(value: string) {
  const labels: Array<[RegExp, string]> = [
    [/^dam safety$/, "安全检查结果"],
    [/^payload$/, "输入载荷"],
    [/^flow integrity test$/, "数据流完整性测试"],
    [/^test case$/, "测试用例"],
    [/^function graph$/, "函数图"],
    [/^process output$/, "进程输出"],
    [/^runtime result$/, "运行结果"],
    [/^files?$/, "代码文件"],
    [/^report$/, "分析报告"],
    [/^project$/, "项目"],
  ];
  return labels.find(([pattern]) => pattern.test(value))?.[1] ?? value;
}

function domainSubjectLabel(value: string) {
  const labels: Record<string, string> = {
    project: "项目",
    task: "任务",
    note: "笔记",
    goal: "目标",
    reminder: "提醒",
    schedule: "日程",
    user: "用户",
    session: "会话",
    order: "订单",
    product: "产品",
    device: "设备",
  };
  return labels[value] ?? value;
}

function cleanCodeSummary(value: string) {
  return value
    .replace(/[；;]?\s*水流角色为\s*[^；;，,。]+/g, "")
    .replace(/[；;]?\s*水文角色为\s*[^；;，,。]+/g, "")
    .replace(/水路/g, "数据传递关系")
    .replace(/水系图/g, "调用图");
}

function containsTerm(haystack: string, term: string) {
  return new RegExp(`(?:^|\\s)${escapeRegExp(term)}(?:$|\\s)`).test(haystack);
}

function normalizeSentence(value: string) {
  return value.trim().replace(/[。.]$/, "");
}

function words(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_./:\-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function unique(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function ratio(part: number, total: number) {
  if (!total) return 100;
  return Math.round((part / total) * 100);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
