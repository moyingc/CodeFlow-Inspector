export function mergeCompilerReportIntoParseResult(files, baseResult, compilerReport) {
  if (!compilerReport?.functions?.length) {
    return withEnhancement(baseResult, {
      status: "unavailable",
      source: compilerReport?.adapterName ?? "NodeParserBridge",
      mergedFunctions: 0,
      addedFunctions: 0,
      addedEdges: 0,
      confidenceGain: 0,
      evidence: "没有收到可融合的 Compiler 函数事实。",
      next: "确认 NodeParserBridge 是否成功返回 functions 和 edges。",
    });
  }

  const baseFunctions = baseResult.functions.map((fn) => ({ ...fn, calls: [...(fn.calls ?? [])] }));
  const functionById = new Map(baseFunctions.map((fn) => [fn.id, fn]));
  const compilerToMergedId = new Map();
  let mergedFunctions = 0;
  let addedFunctions = 0;
  let confidenceGain = 0;

  for (const fact of compilerReport.functions) {
    const match = findMatchingFunction(baseFunctions, fact);
    if (match) {
      const before = match.confidence ?? 0;
      upgradeFunction(match, fact, compilerReport.adapterName);
      compilerToMergedId.set(fact.id, match.id);
      confidenceGain += Math.max(0, (match.confidence ?? before) - before);
      mergedFunctions += 1;
    } else {
      const created = createFunctionFromFact(files, fact, compilerReport.adapterName);
      baseFunctions.push(created);
      functionById.set(created.id, created);
      compilerToMergedId.set(fact.id, created.id);
      addedFunctions += 1;
    }
  }

  for (const fact of compilerReport.functions) {
    const sourceId = compilerToMergedId.get(fact.id);
    const source = sourceId ? functionById.get(sourceId) : null;
    if (!source) continue;
    const mappedCalls = (fact.calls ?? [])
      .map((call) => findMergedIdByCall(baseFunctions, call))
      .filter(Boolean);
    source.calls = Array.from(new Set([...(source.calls ?? []), ...mappedCalls]));
  }

  const baseEdges = [...baseResult.edges];
  const edgeKeys = new Set(baseEdges.map((edge) => `${edge.from}->${edge.to}`));
  let addedEdges = 0;

  for (const edge of compilerReport.edges ?? []) {
    const from = compilerToMergedId.get(edge.from);
    const to = compilerToMergedId.get(edge.to);
    if (!from || !to || from === to) continue;
    const key = `${from}->${to}`;
    if (edgeKeys.has(key)) continue;
    baseEdges.push({
      from,
      to,
      kind: "call",
      confidence: edge.confidence ?? 92,
      evidence: `Compiler fusion · ${edge.evidence ?? "call edge"}`,
    });
    edgeKeys.add(key);
    addedEdges += 1;
  }

  const report = {
    ...baseResult.report,
    adapterName: "Hybrid Local ParserAdapter + NodeParserBridge",
    reliabilityScore: Math.min(98, (baseResult.report.reliabilityScore ?? 60) + Math.min(10, Math.round((mergedFunctions + addedEdges) / 2))),
    functionCount: baseFunctions.length,
    edgeCount: baseEdges.length,
    capabilities: activateCompilerCapability(baseResult.report.capabilities ?? [], compilerReport),
    enhancement: {
      status: "merged",
      source: compilerReport.adapterName ?? "NodeTypeScriptServiceAdapter",
      mergedFunctions,
      addedFunctions,
      addedEdges,
      confidenceGain,
      evidence: `${mergedFunctions} 个函数融合 Compiler 事实，新增 ${addedFunctions} 个函数，新增 ${addedEdges} 条调用边。`,
      next: "把融合结果写入 Semantic Index，并刷新水系图、Runtime Lab 和修复推荐中心。",
    },
    evidence: [
      ...(baseResult.report.evidence ?? []),
      ...(compilerReport.evidence ?? []).slice(0, 4).map((item) => `Compiler: ${item}`),
      "Parser fusion completed",
    ],
  };

  return {
    functions: baseFunctions,
    edges: baseEdges,
    report,
  };
}

function withEnhancement(baseResult, enhancement) {
  return {
    ...baseResult,
    report: {
      ...baseResult.report,
      enhancement,
    },
  };
}

function findMatchingFunction(functions, fact) {
  const normalizedFactFile = normalizePath(fact.fileName ?? "");
  return functions.find((fn) => {
    const sameFile = sameFileName(fn.fileName, normalizedFactFile);
    if (!sameFile) return false;
    const sameName = fn.name === fact.name || fn.name === fact.shortName || fn.name.split(".").at(-1) === fact.shortName;
    const nearLine = Math.abs((fn.startLine ?? 0) - (fact.startLine ?? 0)) <= 3;
    return sameName && nearLine;
  });
}

function upgradeFunction(fn, fact, adapterName) {
  fn.params = fact.params?.length ? fact.params : fn.params;
  fn.returnType = betterReturnType(fn.returnType, fact.returnType);
  fn.outputs = fn.returnType && fn.returnType !== "void" ? Array.from(new Set([...(fn.outputs ?? []), fn.returnType])) : fn.outputs;
  fn.dataShape = `(${(fn.params ?? []).map((param) => param.split(":")[1]?.trim() || "unknown").join(", ") || "void"}) -> ${fn.returnType}`;
  fn.confidence = Math.min(98, Math.max(fn.confidence ?? 0, fact.confidence ?? 90));
  fn.source = "Parser Fact";
  fn.parser = `Fusion(${adapterName ?? "NodeTypeScriptServiceAdapter"})`;
  fn.parseEvidence = Array.from(
    new Set([
      ...(fn.parseEvidence ?? []),
      ...(fact.evidence ?? []),
      "NodeParserBridge fusion",
      "compiler-backed type evidence",
    ]),
  );
}

function createFunctionFromFact(files, fact, adapterName) {
  const file = files.find((item) => sameFileName(item.name, fact.fileName)) ?? files[0];
  const body = file ? sliceLines(file.content, fact.startLine, fact.endLine) : "";
  const params = fact.params ?? [];
  const returnType = fact.returnType ?? "unknown";
  const outputs = returnType && returnType !== "void" ? [returnType] : ["state change/void"];

  return {
    id: `compiler:${fact.id}`,
    name: fact.name,
    fileId: file?.id ?? fact.fileName,
    fileName: fact.fileName,
    language: file?.language ?? "TypeScript",
    startLine: fact.startLine,
    endLine: fact.endLine,
    params,
    returnType,
    outputs,
    calls: [],
    summary: `${fact.name} 来自 Node Compiler 服务；返回 ${returnType}，调用 ${(fact.calls ?? []).join(", ") || "无显式下游"}。`,
    dataShape: `(${params.map((param) => param.split(":")[1]?.trim() || "unknown").join(", ") || "void"}) -> ${returnType}`,
    complexity: Math.max(1, (body.match(/\b(if|else if|for|while|switch|case|catch|try|await)\b/g) ?? []).length + 1),
    category: inferCategoryFromName(fact.name),
    body,
    sideEffects: [],
    externalInputs: params.length ? ["函数参数"] : [],
    validations: [],
    risks: [],
    source: "Parser Fact",
    confidence: fact.confidence ?? 90,
    parser: `Fusion(${adapterName ?? "NodeTypeScriptServiceAdapter"})`,
    parseEvidence: [...(fact.evidence ?? []), "NodeParserBridge fusion", "compiler-only function"],
  };
}

function activateCompilerCapability(capabilities, compilerReport) {
  const seen = new Set();
  const next = capabilities.map((capability) => {
    seen.add(capability.layer);
    if (capability.layer !== "Compiler API") return capability;
    return {
      ...capability,
      status: "active",
      coverage: Math.max(capability.coverage ?? 0, 68),
      evidence: `${compilerReport.functionCount ?? compilerReport.functions?.length ?? 0} 个函数来自 ${compilerReport.adapterName ?? "Node Compiler"}。`,
      next: "继续接 LSP references、diagnostics 和项目级 symbol graph。",
    };
  });

  if (!seen.has("Compiler API")) {
    next.push({
      name: "TypeScript 编译器适配",
      layer: "Compiler API",
      status: "active",
      coverage: 68,
      evidence: `${compilerReport.functionCount ?? compilerReport.functions?.length ?? 0} 个函数来自 Node Compiler。`,
      next: "继续接 LSP references、diagnostics 和项目级 symbol graph。",
    });
  }

  return next;
}

function findMergedIdByCall(functions, call) {
  return functions.find((fn) => fn.name === call || fn.name.split(".").at(-1) === call)?.id ?? "";
}

function betterReturnType(current, incoming) {
  if (!incoming || incoming === "unknown") return current;
  if (!current || current === "unknown" || current === "inferred") return incoming;
  return current.length <= incoming.length ? current : incoming;
}

function inferCategoryFromName(name) {
  const lower = name.toLowerCase();
  if (/parse|read|scan|detect/.test(lower)) return "解析";
  if (/build|render|create|make/.test(lower)) return "构建";
  if (/validate|check|guard|assert/.test(lower)) return "校验";
  if (/simulate|debug|trace|run/.test(lower)) return "仿真";
  if (/load|fetch|query|input/.test(lower)) return "输入";
  if (/save|write|send|export|return/.test(lower)) return "输出";
  if (/model|score|optimize|rank|calculate/.test(lower)) return "模型";
  return "业务";
}

function sameFileName(a, b) {
  const left = normalizePath(a ?? "");
  const right = normalizePath(b ?? "");
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function normalizePath(path) {
  return String(path).replace(/\\/g, "/");
}

function sliceLines(content, startLine, endLine) {
  return String(content)
    .split("\n")
    .slice(Math.max(0, (startLine ?? 1) - 1), Math.max(startLine ?? 1, endLine ?? startLine))
    .join("\n");
}
