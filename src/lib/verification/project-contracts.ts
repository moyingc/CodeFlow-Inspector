import type {
  ContractEvidenceGrade,
  FunctionContract,
  FunctionInfo,
  GraphEdge,
  ProjectContractClause,
  ProjectContractReport,
  TaintFlowReport,
} from "@/src/lib/analysis/types";
import { buildFunctionPathModel } from "./path-sensitive-ir.ts";
import { buildWholeProgramPointsTo } from "./whole-program-memory.ts";
import { exploreConcurrencyStateSpace } from "./concurrency-state-space.ts";

export function buildProjectContracts(functions: FunctionInfo[], taintFlow: TaintFlowReport, edges: GraphEdge[] = []): ProjectContractReport {
  const contracts = functions.map(buildFunctionContract);
  const pointsTo = buildWholeProgramPointsTo(functions, edges);
  const concurrency = exploreConcurrencyStateSpace(functions);
  attachSecurityContracts(contracts, taintFlow);
  attachCallSiteRangeContracts(contracts, functions, edges);
  attachInterproceduralOwnershipContracts(contracts, functions, edges);
  attachWholeProgramMemoryContracts(contracts, functions, pointsTo);
  attachConcurrencyStateSpaceContracts(contracts, functions, concurrency);
  attachGraphCallChains(contracts, edges);
  const clauses = contracts.flatMap((contract) => contract.clauses);
  const coveredFunctionCount = contracts.filter((contract) => contract.clauses.length > 0).length;
  const compilerBackedCount = clauses.filter((clause) => ["compiler", "lsp", "ast"].includes(clause.evidenceGrade)).length;
  const smtEligibleCount = clauses.filter((clause) => clause.smtEligible).length;
  return {
    status: !clauses.length ? "empty" : coveredFunctionCount === functions.length && compilerBackedCount > 0 ? "contract-ready" : "partial",
    functionCount: functions.length,
    coveredFunctionCount,
    clauseCount: clauses.length,
    smtEligibleCount,
    securityClauseCount: clauses.filter((clause) => clause.kind === "security").length,
    compilerBackedCount,
    contracts,
    gaps: unique([
      coveredFunctionCount < functions.length ? `${functions.length - coveredFunctionCount} 个函数没有可证契约。` : "",
      compilerBackedCount < clauses.length ? `${clauses.length - compilerBackedCount} 条契约仍来自 parser/lexical 证据。` : "",
      smtEligibleCount < clauses.length ? `${clauses.length - smtEligibleCount} 条契约只能检查，尚不能安全编译为 SMT。` : "",
      "业务意图契约仍需由测试、文档或调用方断言补充，不能仅凭函数名生成。",
    ]),
    evidence: [
      `${coveredFunctionCount}/${functions.length} 个函数生成契约，${clauses.length} 条子句。`,
      `${compilerBackedCount} 条由 Compiler/LSP/AST 支持，${smtEligibleCount} 条可进入 SMT。`,
      `${taintFlow.pathCount} 条 source-to-sink 路径转换为 ${clauses.filter((clause) => clause.kind === "security").length} 条安全契约。`,
      `${clauses.filter((clause) => clause.kind === "callsite-range").length} 个调用点实参与被调函数范围契约完成绑定。`,
      ...pointsTo.evidence,
      ...concurrency.evidence,
    ],
  };
}

function attachWholeProgramMemoryContracts(
  contracts: FunctionContract[],
  functions: FunctionInfo[],
  report: ReturnType<typeof buildWholeProgramPointsTo>,
) {
  const fnById = new Map(functions.map((fn) => [fn.id, fn]));
  const contractById = new Map(contracts.map((contract) => [contract.functionId, contract]));
  for (const alias of report.aliasSets.slice(0, 128)) {
    const object = report.objects.find((item) => item.id === alias.objectId);
    const fn = object ? fnById.get(object.allocationFunctionId) : undefined;
    const contract = fn ? contractById.get(fn.id) : undefined;
    if (!fn || !contract || alias.variables.length < 2) continue;
    const symbol = `points_to_${safeSymbol(alias.objectId)}`;
    const item = clause(fn, `points-to-${safeSymbol(alias.objectId)}`, "alias", alias.variables.join(" = "), `${symbol}_alias_count = ${alias.variables.length}`, `${alias.variables.length} 个跨函数变量可能指向同一抽象对象；释放、修改和逃逸必须按共享别名处理。`, functionEvidenceGrade(fn), `${report.evidence.join("；")}；${alias.variables.join("、")}`, true, "allocation-site points-to 固定点已收敛；字段为保守合并。", object.allocationLine);
    item.smtFormula = `(set-logic QF_LIA)\n(declare-const ${symbol}_alias_count Int)\n(assert (= ${symbol}_alias_count ${alias.variables.length}))\n(assert (not (>= ${symbol}_alias_count 1)))\n(check-sat)`;
    contract.clauses.push(item);
  }
  for (const obligation of report.separationObligations.filter((item) => item.status !== "proved-by-abstraction").slice(0, 128)) {
    const object = report.objects.find((item) => item.id === obligation.objectIds[0]);
    const fn = object ? fnById.get(object.allocationFunctionId) : undefined;
    const contract = fn ? contractById.get(fn.id) : undefined;
    if (!fn || !contract) continue;
    const symbol = `separation_${safeSymbol(obligation.id)}`;
    const item = clause(fn, symbol, "ownership", obligation.objectIds.join(" * "), `separated_${symbol}`, obligation.kind === "escaped-owner" ? "对象逃逸后，调用方必须继续承担所有权与释放证明。" : "两个逻辑堆片段必须保持分离，不能由同一写入别名同时修改。", functionEvidenceGrade(fn), `${obligation.status}；${obligation.evidence}`, true, "基于 allocation-site、字段敏感 points-to 和有限 call-string 上下文生成。", object.allocationLine);
    item.smtFormula = `(set-logic QF_UF)\n(declare-const separated_${symbol} Bool)\n(assert (= separated_${symbol} ${obligation.status === "violated" ? "false" : "true"}))\n(assert (not separated_${symbol}))\n(check-sat)`;
    contract.clauses.push(item);
  }
}

function attachConcurrencyStateSpaceContracts(
  contracts: FunctionContract[],
  functions: FunctionInfo[],
  report: ReturnType<typeof exploreConcurrencyStateSpace>,
) {
  const fnById = new Map(functions.map((fn) => [fn.id, fn]));
  const contractById = new Map(contracts.map((contract) => [contract.functionId, contract]));
  for (const race of report.counterexamples.slice(0, 128)) {
    const transition = report.transitions.find((item) => item.id === race.transitionA);
    const fn = transition ? fnById.get(transition.functionId) : undefined;
    const contract = fn ? contractById.get(fn.id) : undefined;
    if (!fn || !contract) continue;
    const symbol = safeSymbol(race.id);
    const item = clause(fn, `schedule-${symbol}`, "concurrency", race.variable, `ordered_${symbol}`, `有界调度发现 ${race.variable} 的冲突访问，必须增加锁、原子操作或串行执行边界。`, functionEvidenceGrade(fn), `${race.reason} 调度：${race.schedule.join(" -> ")}；${report.evidence.join("；")}`, true, "反例覆盖当前状态/深度边界；未探索前沿保持未知。", transition.line);
    item.smtFormula = `(set-logic QF_UF)\n(declare-const ordered_${symbol} Bool)\n(assert (= ordered_${symbol} false))\n(assert (not ordered_${symbol}))\n(check-sat)`;
    contract.clauses.push(item);
  }
}

function buildFunctionContract(fn: FunctionInfo): FunctionContract {
  const evidenceGrade = functionEvidenceGrade(fn);
  const pathModel = buildFunctionPathModel(fn);
  const clauses: ProjectContractClause[] = [];
  fn.params.forEach((raw, index) => {
    const parameter = parseParameter(raw, fn.language, index);
    clauses.push(clause(fn, `param-type-${index}`, "parameter-type", parameter.name, `type(${safeSymbol(parameter.name)}) = ${parameter.type}`, `${parameter.name} 应符合声明类型 ${parameter.type}。`, evidenceGrade, `${fn.parser ?? "Parser"} 函数签名：${raw}`, isSmtScalar(parameter.type), isSmtScalar(parameter.type) ? "标量类型可映射为 Bool/Int/Real。" : "复杂对象、指针或容器暂不直接编码。"));
    if (!parameter.nullable && isReferenceLike(parameter.type)) {
      clauses.push(clause(fn, `param-null-${index}`, "parameter-nullability", parameter.name, `${safeSymbol(parameter.name)} != null`, `${parameter.name} 的类型没有声明可空。`, evidenceGrade, `${fn.parser ?? "Parser"} 参数类型：${parameter.type}`, false, "SMT-LIB 标量模型不把语言对象引用伪装为整数地址。"));
    }
  });
  const returnType = normalizeType(fn.returnType);
  if (returnType && !isVoidType(returnType) && returnType !== "inferred" && returnType !== "unknown") {
    clauses.push(clause(fn, "return-type", "return-type", "return", `type(result) = ${returnType}`, `返回值应符合 ${returnType}。`, evidenceGrade, `${fn.parser ?? "Parser"} 返回类型：${fn.returnType}`, isSmtScalar(returnType), isSmtScalar(returnType) ? "标量返回值可编码。" : "复杂返回对象保留为类型检查义务。"));
  }
  extractExplicitExceptions(fn).forEach((item, index) => {
    clauses.push(clause(fn, `exception-${index}`, "exception", item.subject, item.predicate, item.description, evidenceGrade, item.evidence, false, "异常条件需要路径条件与异常出口 CFG 才能形式化。", item.line));
  });
  extractGuardedRanges(fn).forEach((item, index) => {
    clauses.push(clause(fn, `range-${index}`, "parameter-range", item.subject, item.predicate, item.description, evidenceGrade, item.evidence, true, "整数/实数边界可编码为 QF_LIA/QF_LRA。", item.line));
  });
  extractStructuralInvariants(fn).forEach((item, index) => {
    const invariant = clause(fn, `${item.kind}-${index}`, item.kind, item.subject, item.predicate, item.description, evidenceGrade, item.evidence, true, "结构状态可编码为布尔不变量；结论只覆盖当前提取到的语句，不代表路径完整证明。", item.line);
    invariant.smtFormula = implicationCounterexampleFormula(item.subject, item.acquired, item.released);
    invariant.callChain = [fn.id];
    clauses.push(invariant);
  });
  extractAdvancedStateInvariants(fn, pathModel).forEach((item, index) => {
    const invariant = clause(fn, `${item.kind}-${index}`, item.kind, item.subject, item.predicate, item.description, evidenceGrade, `${item.evidence}；${pathModel.evidence.join("；")}`, true, "显式别名、释放次数或并发保护事实可编码；动态别名和跨线程调度仍保持未知。", item.line);
    invariant.smtFormula = item.smtFormula;
    invariant.callChain = [fn.id];
    clauses.push(invariant);
  });
  return {
    id: `contract-${fn.id}`,
    functionId: fn.id,
    functionName: fn.name,
    fileName: fn.fileName,
    language: fn.language,
    startLine: fn.startLine,
    clauses,
    evidenceGrade,
    confidence: clauses.length ? Math.min(fn.confidence, evidenceGrade === "lexical" ? 62 : 94) : 0,
  };
}

function attachCallSiteRangeContracts(contracts: FunctionContract[], functions: FunctionInfo[], edges: GraphEdge[]) {
  const functionById = new Map(functions.map((fn) => [fn.id, fn]));
  const contractById = new Map(contracts.map((contract) => [contract.functionId, contract]));
  for (const edge of edges) {
    if (edge.kind && edge.kind !== "call") continue;
    const caller = functionById.get(edge.from);
    const callee = functionById.get(edge.to);
    const callerContract = contractById.get(edge.from);
    const calleeContract = contractById.get(edge.to);
    if (!caller || !callee || !callerContract || !calleeContract) continue;
    const ranges = calleeContract.clauses.filter((item) => item.kind === "parameter-range");
    if (!ranges.length) continue;
    const call = findSimpleCall(caller, callee.name);
    if (!call) continue;
    const parameters = callee.params.map((raw, index) => parseParameter(raw, callee.language, index));
    for (const range of ranges) {
      const parameterIndex = parameters.findIndex((parameter) => parameter.name === range.subject);
      const argument = call.arguments[parameterIndex]?.trim();
      const constraint = parseRangePredicate(range.predicate);
      if (parameterIndex < 0 || !argument || !constraint) continue;
      const symbol = `call_arg_${safeSymbol(caller.id)}_${safeSymbol(callee.id)}_${parameterIndex}`;
      const symbolic = parseLinearExpression(argument);
      if (!isNumericLiteral(argument) && !symbolic) continue;
      const item = clause(
        caller,
        `callsite-${safeSymbol(callee.id)}-${parameterIndex}-${call.line}`,
        "callsite-range",
        `${caller.name} -> ${callee.name}.${range.subject}`,
        `${argument} ${constraint.operator} ${constraint.boundary}`,
        `调用 ${callee.name} 时传入 ${argument}；该实参必须满足被调函数的正常范围 ${range.predicate}。`,
        strongestGrade(callerContract.evidenceGrade, calleeContract.evidenceGrade),
        `${caller.fileName}:${call.line} ${call.source}；被调契约：${range.evidence}`,
        true,
        isNumericLiteral(argument) ? "字面实参与参数位置已绑定，可把违反被调范围交给 Z3。" : "线性实参与调用方正常路径谓词已绑定，可把跨过程范围蕴含交给 Z3。",
        call.line,
      );
      item.smtFormula = isNumericLiteral(argument)
        ? rangeCounterexampleFormula(symbol, argument, constraint.operator, constraint.boundary)
        : symbolicRangeCounterexampleFormula(symbol, symbolic!, callerContract.clauses, constraint.operator, constraint.boundary);
      if (!item.smtFormula) continue;
      item.callChain = unique([...buildUpstreamCallChain(caller.id, edges), callee.id]);
      callerContract.clauses.push(item);
    }
  }
}

function attachGraphCallChains(contracts: FunctionContract[], edges: GraphEdge[]) {
  for (const contract of contracts) {
    const chain = buildUpstreamCallChain(contract.functionId, edges);
    for (const item of contract.clauses) {
      if (!item.callChain?.length) item.callChain = chain;
    }
  }
}

function buildUpstreamCallChain(target: string, edges: GraphEdge[]) {
  const callEdges = edges.filter((edge) => !edge.kind || edge.kind === "call");
  const incoming = new Map<string, string[]>();
  for (const edge of callEdges) incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  const queue: string[][] = [[target]];
  const visited = new Set<string>();
  while (queue.length) {
    const reversePath = queue.shift()!;
    const current = reversePath.at(-1)!;
    if (visited.has(current) || reversePath.length > 64) continue;
    visited.add(current);
    const parents = incoming.get(current) ?? [];
    if (!parents.length) return [...reversePath].reverse();
    for (const parent of parents) {
      if (!reversePath.includes(parent)) queue.push([...reversePath, parent]);
    }
  }
  return [target];
}

function attachSecurityContracts(contracts: FunctionContract[], taintFlow: TaintFlowReport) {
  const byFunction = new Map(contracts.map((contract) => [contract.functionId, contract]));
  taintFlow.paths.forEach((path) => {
    const contract = byFunction.get(path.sinkFunctionId) ?? byFunction.get(path.sourceFunctionId);
    if (!contract) return;
    const grade: ContractEvidenceGrade = path.evidenceGrade === "runtime" ? "compiler" : path.evidenceGrade;
    contract.clauses.push({
      id: `contract-security-${path.id}`,
      functionId: contract.functionId,
      fileName: contract.fileName,
      line: contract.startLine,
      kind: "security",
      subject: `${path.sourceFunctionName} -> ${path.sinkFunctionName}`,
      predicate: `tainted_${safeSymbol(path.id)} -> sanitized_${safeSymbol(path.id)}`,
      description: `${path.sourceKind} 输入到达 ${path.sinkKind} sink 前必须被验证或净化。`,
      evidenceGrade: grade,
      confidence: path.confidence,
      evidence: `taint-status=${path.status}；${path.evidence.join("；")}`,
      smtEligible: true,
      smtReason: "污点与净化状态可用布尔蕴含表达；路径事实仍由静态或运行证据决定。",
      callChain: path.functionIds,
    });
  });
}

function findSimpleCall(fn: FunctionInfo, calleeName: string) {
  const pattern = new RegExp(`\\b${escapeRegExp(calleeName)}\\s*\\(([^()]{0,1000})\\)`, "g");
  const match = pattern.exec(fn.body);
  if (!match) return null;
  const offset = fn.body.slice(0, match.index).split(/\r?\n/).length - 1;
  return {
    arguments: splitArguments(match[1]),
    line: fn.startLine + offset,
    source: match[0].replace(/\s+/g, " ").trim(),
  };
}

function splitArguments(value: string) {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote && value[index - 1] !== "\\") quote = "";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    else if ("[{(".includes(char)) depth += 1;
    else if ("]})".includes(char)) depth -= 1;
    else if (char === "," && depth === 0) {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result;
}

function parseRangePredicate(value: string) {
  const match = value.match(/^[A-Za-z_$][\w$]*\s*(>=|>|<=|<)\s*(-?\d+(?:\.\d+)?)$/);
  return match ? { operator: match[1], boundary: match[2] } : null;
}

function isNumericLiteral(value: string) { return /^-?\d+(?:\.\d+)?$/.test(value); }

function parseLinearExpression(value: string) {
  const compact = value.replace(/\s+/g, "");
  const direct = compact.match(/^([A-Za-z_$][\w$]*)(?:([+-])(\d+))?$/);
  if (direct) return { variable: direct[1], offset: direct[2] === "-" ? -Number(direct[3]) : Number(direct[3] ?? 0) };
  const reversed = compact.match(/^(\d+)\+([A-Za-z_$][\w$]*)$/);
  return reversed ? { variable: reversed[2], offset: Number(reversed[1]) } : null;
}

function rangeCounterexampleFormula(symbol: string, argument: string, operator: string, boundary: string) {
  const sort = argument.includes(".") || boundary.includes(".") ? "Real" : "Int";
  return `(set-logic ${sort === "Real" ? "QF_LRA" : "QF_LIA"})\n(declare-const ${symbol} ${sort})\n(assert (= ${symbol} ${argument}))\n(assert (not (${operator} ${symbol} ${boundary})))\n(check-sat)\n(get-model)`;
}

function symbolicRangeCounterexampleFormula(symbol: string, expression: { variable: string; offset: number }, callerClauses: ProjectContractClause[], operator: string, boundary: string) {
  const constraints = callerClauses
    .filter((item) => item.kind === "parameter-range" && item.subject === expression.variable)
    .map((item) => parseRangePredicate(item.predicate))
    .filter((item): item is { operator: string; boundary: string } => Boolean(item));
  if (!constraints.length) return undefined;
  const variable = `${symbol}_${safeSymbol(expression.variable)}`;
  const value = expression.offset === 0 ? variable : expression.offset > 0 ? `(+ ${variable} ${expression.offset})` : `(- ${variable} ${Math.abs(expression.offset)})`;
  return `(set-logic QF_LIA)\n(declare-const ${variable} Int)\n${constraints.map((item) => `(assert (${item.operator} ${variable} ${item.boundary}))`).join("\n")}\n(assert (not (${operator} ${value} ${boundary})))\n(check-sat)\n(get-model)`;
}

function implicationCounterexampleFormula(subject: string, acquired: boolean, released: boolean) {
  const symbol = safeSymbol(subject);
  return `(set-logic QF_UF)\n(declare-const ${symbol}_entered Bool)\n(declare-const ${symbol}_completed Bool)\n(assert (= ${symbol}_entered ${acquired}))\n(assert (= ${symbol}_completed ${released}))\n(assert (not (=> ${symbol}_entered ${symbol}_completed)))\n(check-sat)\n(get-model)`;
}

function extractStructuralInvariants(fn: FunctionInfo) {
  const definitions: Array<{ kind: "transaction" | "resource" | "lifecycle"; subject: string; acquire: RegExp; release: RegExp; description: string }> = [
    { kind: "transaction", subject: "transaction", acquire: /\b(?:beginTransaction|BEGIN\s+TRANSACTION|(?:db|session|transaction)\.begin)\b/i, release: /\b(?:commit|rollback)\s*\(/i, description: "事务开始后，正常或异常出口必须执行 commit 或 rollback。" },
    { kind: "resource", subject: "resource", acquire: /\b(?:open|fopen|connect|acquire|lock)\s*\(|new\s+(?:FileInputStream|FileOutputStream|Socket)\b/i, release: /\b(?:close|fclose|dispose|unlock|release)\s*\(|\btry\s*\(/i, description: "资源取得后必须关闭、释放，或由语言级资源作用域托管。" },
    { kind: "lifecycle", subject: "lifecycle", acquire: /(?:\.start\s*\(|\bstart[A-Z_]\w*\s*\()/, release: /(?:\.(?:stop|shutdown|terminate|dispose)\s*\(|\b(?:stop|shutdown|terminate|dispose)[A-Z_]\w*\s*\()/, description: "组件启动后必须存在停止、关闭或销毁路径。" },
  ];
  return definitions.flatMap((definition) => {
    const acquired = definition.acquire.test(fn.body);
    if (!acquired) return [];
    const released = definition.release.test(fn.body);
    const match = fn.body.match(definition.acquire);
    const offset = fn.body.slice(0, match?.index ?? 0).split(/\r?\n/).length - 1;
    return [{
      kind: definition.kind,
      subject: `${definition.subject}_${safeSymbol(fn.id)}`,
      predicate: `${definition.subject}_entered -> ${definition.subject}_completed`,
      description: definition.description,
      evidence: `${fn.fileName}:${fn.startLine + offset} 结构扫描：entered=${acquired}，completed=${released}。`,
      line: fn.startLine + offset,
      acquired,
      released,
    }];
  });
}

function extractAdvancedStateInvariants(fn: FunctionInfo, pathModel: ReturnType<typeof buildFunctionPathModel>) {
  const items: Array<{ kind: "alias" | "ownership" | "concurrency"; subject: string; predicate: string; description: string; evidence: string; line: number; smtFormula: string }> = [];
  for (const alias of pathModel.aliases.slice(0, 8)) {
    const release = (name: string) => [...fn.body.matchAll(new RegExp(`\\b(?:free|close|dispose|release|unlock)\\s*\\(\\s*${escapeRegExp(name)}\\s*\\)|\\b${escapeRegExp(name)}\\.(?:close|dispose|release|unlock)\\s*\\(`, "g"))].length;
    const releaseCount = release(alias.owner) + release(alias.alias);
    if (releaseCount < 2) continue;
    const symbol = `alias_release_${safeSymbol(fn.id)}_${safeSymbol(alias.owner)}`;
    items.push({
      kind: "alias", subject: `${alias.alias} aliases ${alias.owner}`, predicate: `${symbol} <= 1`,
      description: `${alias.alias} 与 ${alias.owner} 指向同一资源时不得重复释放。`,
      evidence: `${fn.fileName}:${alias.line} 直接赋值别名，检测到 ${releaseCount} 个释放调用。`, line: alias.line,
      smtFormula: `(set-logic QF_LIA)\n(declare-const ${symbol} Int)\n(assert (= ${symbol} ${releaseCount}))\n(assert (not (<= ${symbol} 1)))\n(check-sat)\n(get-model)`,
    });
  }
  const acquisition = fn.body.match(/(?:const|let|var|auto|[A-Za-z_]\w*)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:open|fopen|connect|acquire|new\s+(?:FileInputStream|FileOutputStream|Socket))\b/);
  if (acquisition) {
    const owner = acquisition[1];
    const releases = [...fn.body.matchAll(new RegExp(`\\b(?:free|close|dispose|release)\\s*\\(\\s*${escapeRegExp(owner)}\\s*\\)|\\b${escapeRegExp(owner)}\\.(?:close|dispose|release)\\s*\\(`, "g"))].length;
    const symbol = `owner_release_${safeSymbol(fn.id)}_${safeSymbol(owner)}`;
    items.push({ kind: "ownership", subject: owner, predicate: `${symbol} = 1`, description: `${owner} 取得资源所有权后必须恰好释放一次。`, evidence: `显式资源取得后检测到 ${releases} 个对应释放调用。`, line: fn.startLine, smtFormula: `(set-logic QF_LIA)\n(declare-const ${symbol} Int)\n(assert (= ${symbol} ${releases}))\n(assert (not (= ${symbol} 1)))\n(check-sat)\n(get-model)` });
  }
  const astAcquireCount = pathModel.ownershipEvents.filter((item) => /open|acquire|new/.test(item.event)).length;
  const astReleaseCount = pathModel.ownershipEvents.filter((item) => /close|free|release|drop|dispose|unlock/.test(item.event)).length;
  if (astAcquireCount && astAcquireCount !== astReleaseCount) {
    const symbol = `ast_owner_balance_${safeSymbol(fn.id)}`;
    items.push({ kind: "ownership", subject: `${fn.name} AST ownership`, predicate: `${symbol} = 0`, description: "AST 路径中的资源取得和释放必须配对。", evidence: `${pathModel.evidence.join("；")}；acquire=${astAcquireCount} release=${astReleaseCount}。`, line: pathModel.ownershipEvents[0]?.line ?? fn.startLine, smtFormula: `(set-logic QF_LIA)\n(declare-const ${symbol} Int)\n(assert (= ${symbol} ${astAcquireCount - astReleaseCount}))\n(assert (not (= ${symbol} 0)))\n(check-sat)\n(get-model)` });
  }
  for (const object of pathModel.heapObjects.filter((item) => item.releaseCount !== 1)) {
    const symbol = `heap_release_${safeSymbol(object.id)}`;
    items.push({ kind: "ownership", subject: object.id, predicate: `${symbol} = 1`, description: `堆对象 ${object.owner} 必须沿全部出口恰好释放一次。`, evidence: `${fn.fileName}:${object.allocatedLine} AST 分配点；release=${object.releaseCount}。`, line: object.allocatedLine, smtFormula: `(set-logic QF_LIA)\n(declare-const ${symbol} Int)\n(assert (= ${symbol} ${object.releaseCount}))\n(assert (not (= ${symbol} 1)))\n(check-sat)\n(get-model)` });
  }
  const concurrent = pathModel.concurrencyEvents.some((item) => /spawn|thread|promise\.all|asyncio\.gather|await/.test(item.event)) || /\b(?:Promise\.all|new\s+Thread|std::thread::spawn|threading\.Thread|go\s+[A-Za-z_]|tokio::spawn|asyncio\.gather)\b/.test(fn.body);
  const sharedWrite = /\b(?:global|shared|state|this\.[A-Za-z_]\w*)\s*(?:=|\+=|-=|\+\+|--)/.test(fn.body);
  if (concurrent && sharedWrite) {
    const synchronized = pathModel.concurrencyEvents.some((item) => /mutex|lock|atomic|synchronized/.test(item.event)) || /\b(?:Mutex|Lock|synchronized|atomic|Semaphore|with_lock|lock\s*\()/i.test(fn.body);
    const symbol = `concurrency_guard_${safeSymbol(fn.id)}`;
    items.push({ kind: "concurrency", subject: fn.name, predicate: "concurrent_write -> synchronized", description: "并发共享状态写入必须由锁、原子操作或串行化边界保护。", evidence: `检测到并发启动与共享写入；同步保护=${synchronized}。`, line: fn.startLine, smtFormula: `(set-logic QF_UF)\n(declare-const ${symbol}_write Bool)\n(declare-const ${symbol}_guarded Bool)\n(assert (= ${symbol}_write true))\n(assert (= ${symbol}_guarded ${synchronized}))\n(assert (not (=> ${symbol}_write ${symbol}_guarded)))\n(check-sat)\n(get-model)` });
  }
  for (const schedule of pathModel.concurrencyInterleavings.filter((item) => !item.guarded)) {
    const symbol = safeSymbol(schedule.id);
    items.push({ kind: "concurrency", subject: schedule.id, predicate: "happens_before(a,b) or happens_before(b,a)", description: "两个并发事件访问共享状态时必须存在 happens-before 关系。", evidence: `有界交错 ${schedule.eventA} || ${schedule.eventB}，未发现锁/原子边界。`, line: fn.startLine, smtFormula: `(set-logic QF_UF)\n(declare-const ${symbol}_ab Bool)\n(declare-const ${symbol}_ba Bool)\n(assert (not (or ${symbol}_ab ${symbol}_ba)))\n(check-sat)\n(get-model)` });
  }
  return items;
}

function attachInterproceduralOwnershipContracts(contracts: FunctionContract[], functions: FunctionInfo[], edges: GraphEdge[]) {
  const byId = new Map(functions.map((fn) => [fn.id, fn]));
  const contractById = new Map(contracts.map((contract) => [contract.functionId, contract]));
  for (const edge of edges.filter((item) => !item.kind || item.kind === "call")) {
    const caller = byId.get(edge.from);
    const callee = byId.get(edge.to);
    const callerContract = contractById.get(edge.from);
    if (!caller || !callee || !callerContract || !callee.astControlFlow) continue;
    const call = findSimpleCall(caller, callee.name);
    if (!call) continue;
    const calleeReleases = callee.astControlFlow.nodes.some((node) => node.ownershipEvents.some((event) => /close|free|release|drop|dispose/.test(event)));
    if (!calleeReleases) continue;
    const argument = call.arguments.find((value) => /^[A-Za-z_$][\w$]*$/.test(value));
    if (!argument) continue;
    const callOffset = caller.body.indexOf(call.source);
    const usedAfter = callOffset >= 0 && new RegExp(`\\b${escapeRegExp(argument)}\\b`).test(caller.body.slice(callOffset + call.source.length));
    const symbol = `interproc_owner_${safeSymbol(caller.id)}_${safeSymbol(callee.id)}_${safeSymbol(argument)}`;
    const item = clause(caller, `interproc-owner-${safeSymbol(callee.id)}-${call.line}`, "ownership", argument, `consumed_${symbol} -> !used_after_${symbol}`, `${callee.name} 释放实参所指资源后，${caller.name} 不得继续使用 ${argument}。`, strongestGrade(functionEvidenceGrade(caller), functionEvidenceGrade(callee)), `${caller.fileName}:${call.line} AST 调用边；被调函数 AST 包含释放事件；usedAfter=${usedAfter}。`, true, "跨过程所有权转移已绑定到调用边；反射和动态分派仍保持未知。", call.line);
    item.smtFormula = `(set-logic QF_UF)\n(declare-const consumed_${symbol} Bool)\n(declare-const used_after_${symbol} Bool)\n(assert (= consumed_${symbol} true))\n(assert (= used_after_${symbol} ${usedAfter}))\n(assert (not (=> consumed_${symbol} (not used_after_${symbol}))))\n(check-sat)\n(get-model)`;
    item.callChain = unique([...buildUpstreamCallChain(caller.id, edges), callee.id]);
    callerContract.clauses.push(item);
  }
}

function strongestGrade(left: ContractEvidenceGrade, right: ContractEvidenceGrade): ContractEvidenceGrade {
  const order: ContractEvidenceGrade[] = ["lexical", "parser", "ast", "lsp", "compiler"];
  return order[Math.min(order.indexOf(left), order.indexOf(right))] ?? "lexical";
}

function parseParameter(raw: string, language: string, index: number) {
  const cleaned = raw.replace(/\s*=.*$/, "").trim();
  if (cleaned.includes(":")) {
    const [name, ...rest] = cleaned.split(":");
    const type = normalizeType(rest.join(":"));
    const rawName = name.trim();
    return { name: rawName.replace(/\?$/, "").replace(/^(self|this)$/, (value) => value) || `arg${index}`, type: type || "unknown", nullable: rawName.endsWith("?") || nullableType(type) };
  }
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (/go/i.test(language) && parts.length >= 2) {
    const name = parts[0];
    const type = normalizeType(parts.slice(1).join(" "));
    return { name, type, nullable: nullableType(type) };
  }
  if (/java|c\+\+|cpp|c|go|rust/i.test(language) && parts.length >= 2) {
    const name = parts.at(-1)?.replace(/^[*&]+/, "") ?? `arg${index}`;
    const type = normalizeType(parts.slice(0, -1).join(" "));
    return { name, type, nullable: nullableType(type) };
  }
  return { name: cleaned || `arg${index}`, type: "unknown", nullable: true };
}

function extractExplicitExceptions(fn: FunctionInfo) {
  const lines = fn.body.split(/\r?\n/);
  return lines.flatMap((line, index) => {
    if (!/\b(throw|raise)\b/.test(line)) return [];
    return [{
      subject: "exception",
      predicate: line.trim(),
      description: "实现包含显式异常出口，调用方需要处理该失败路径。",
      evidence: `${fn.fileName}:${fn.startLine + index} ${line.trim()}`,
      line: fn.startLine + index,
    }];
  }).slice(0, 8);
}

function extractGuardedRanges(fn: FunctionInfo) {
  const results: Array<{ subject: string; predicate: string; description: string; evidence: string; line: number }> = [];
  const pattern = /if\s*\(?\s*([A-Za-z_$][\w$]*)\s*(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)\s*\)?\s*:?\s*(?:\r?\n\s*)?(?:throw|raise)\b/g;
  for (const match of fn.body.matchAll(pattern)) {
    const [, name, operator, boundary] = match;
    const validOperator = ({ "<": ">=", "<=": ">", ">": "<=", ">=": "<" } as Record<string, string>)[operator];
    const offset = fn.body.slice(0, match.index ?? 0).split(/\r?\n/).length - 1;
    results.push({
      subject: name,
      predicate: `${safeSymbol(name)} ${validOperator} ${boundary}`,
      description: `${name} 违反 ${operator} ${boundary} 时实现会抛出异常，因此正常路径要求 ${validOperator} ${boundary}。`,
      evidence: `${fn.fileName}:${fn.startLine + offset} ${match[0].replace(/\s+/g, " ").trim()}`,
      line: fn.startLine + offset,
    });
  }
  return results.slice(0, 12);
}

function clause(fn: FunctionInfo, suffix: string, kind: ProjectContractClause["kind"], subject: string, predicate: string, description: string, evidenceGrade: ContractEvidenceGrade, evidence: string, smtEligible: boolean, smtReason: string, line = fn.startLine): ProjectContractClause {
  return { id: `contract-${fn.id}-${suffix}`, functionId: fn.id, fileName: fn.fileName, line, kind, subject, predicate, description, evidenceGrade, confidence: Math.min(fn.confidence, evidenceGrade === "lexical" ? 62 : 94), evidence, smtEligible, smtReason };
}

function functionEvidenceGrade(fn: FunctionInfo): ContractEvidenceGrade {
  const evidence = `${fn.parser ?? ""} ${(fn.parseEvidence ?? []).join(" ")}`.toLowerCase();
  if (evidence.includes("compiler")) return "compiler";
  if (evidence.includes("lsp")) return "lsp";
  if (evidence.includes("tree-sitter") || evidence.includes("ast")) return "ast";
  if (fn.source === "Parser Fact") return "parser";
  return "lexical";
}

function normalizeType(value: string) { return value.trim().replace(/\s+/g, " "); }
function nullableType(type: string) { return /(^|[<|\s])(optional|option|nullable|null|none)([>]|$)|\?$|\*/i.test(type); }
function isVoidType(type: string) { return /^(void|none|unit|\(\))$/i.test(type); }
function isReferenceLike(type: string) { return !isSmtScalar(type) && !/^(unknown|any|object)$/i.test(type); }
function isSmtScalar(type: string) { return /^(bool|boolean|int|integer|i\d+|u\d+|long|short|float|double|real|number|usize|isize)$/i.test(type); }
function safeSymbol(value: string) { return value.replace(/[^a-zA-Z0-9_]/g, "_") || "value"; }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function unique(values: string[]) { return [...new Set(values.filter(Boolean))]; }
