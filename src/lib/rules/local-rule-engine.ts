import type {
  AnalysisIssue,
  FunctionInfo,
  GraphEdge,
  KnowledgeRule,
  KnowledgeRuleMatch,
  KnowledgeRuleReport,
} from "@/src/lib/analysis/types";
import { localKnowledgeRules } from "@/src/lib/library/local-knowledge-rules";
import { escapeRegExp } from "@/src/lib/analysis/utils";

export function evaluateKnowledgeRules(
  functions: FunctionInfo[],
  graphEdges: GraphEdge[],
): KnowledgeRuleReport {
  const incoming = countEdges(graphEdges, "to");
  const outgoing = countEdges(graphEdges, "from");
  const matches = functions.flatMap((fn) =>
    localKnowledgeRules
      .map((rule) => matchRule(fn, rule, incoming.get(fn.id) ?? 0, outgoing.get(fn.id) ?? 0))
      .filter((match): match is KnowledgeRuleMatch => Boolean(match)),
  );
  const sortedMatches = [...matches].sort((a, b) => {
    const severityDelta = severityWeight(b.severity) - severityWeight(a.severity);
    if (severityDelta !== 0) return severityDelta;
    return b.confidence - a.confidence;
  });

  return {
    totalMatches: matches.length,
    matchedFunctionCount: new Set(matches.map((match) => match.functionId)).size,
    criticalCount: matches.filter((match) => match.severity === "critical").length,
    riskCount: matches.filter((match) => match.severity === "risk").length,
    warnCount: matches.filter((match) => match.severity === "warn").length,
    infoCount: matches.filter((match) => match.severity === "info").length,
    topMatches: sortedMatches.slice(0, 10),
    matches,
  };
}

export function applyKnowledgeRuleMatches(
  functions: FunctionInfo[],
  matches: KnowledgeRuleMatch[],
): FunctionInfo[] {
  const matchesByFunction = groupMatchesByFunction(matches);

  return functions.map((fn) => {
    const functionMatches = matchesByFunction.get(fn.id) ?? [];
    if (!functionMatches.length) return fn;

    const riskLabels = functionMatches
      .filter((match) => match.severity !== "info")
      .map((match) => riskLabelForRuleMatch(match));
    const parseEvidence = functionMatches
      .slice(0, 5)
      .map((match) => `规则命中：${match.ruleName} ${match.confidence}%`);

    return {
      ...fn,
      risks: unique([...fn.risks, ...riskLabels]),
      parseEvidence: unique([...(fn.parseEvidence ?? []), ...parseEvidence]),
      confidence: Math.max(35, Math.min(96, Math.round((fn.confidence + bestRuleConfidence(functionMatches)) / 2))),
    };
  });
}

export function buildKnowledgeRuleIssues(matches: KnowledgeRuleMatch[]): AnalysisIssue[] {
  return matches
    .filter((match) => match.severity !== "info")
    .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || b.confidence - a.confidence)
    .slice(0, 20)
    .map((match) => {
      const effectiveConfidence = match.evidenceGrade === "heuristic" ? Math.min(68, match.confidence) : match.confidence;
      return {
        id: `rule-${match.ruleId}-${match.functionId}`,
        title: match.ruleName,
        category: issueCategoryForMatch(match),
        severity: issueSeverityForRule(match.severity),
        status:
          match.evidenceGrade === "heuristic"
            ? "Possible" as const
            : effectiveConfidence >= 76
              ? "Likely" as const
              : "Possible" as const,
        message: `${match.evidence}。${match.recommendation}。${match.evidenceLimitation}`,
        evidence:
          `${match.fileName}:${match.line} ${match.functionName}() · ${match.matchedSignals.join(", ")} · ` +
          `证据等级 ${match.evidenceGrade}`,
        confidence: effectiveConfidence,
      };
    });
}

export function ruleMatchesForFunction(matches: KnowledgeRuleMatch[], functionId: string) {
  return matches.filter((match) => match.functionId === functionId);
}

function matchRule(
  fn: FunctionInfo,
  rule: KnowledgeRule,
  incomingCount: number,
  outgoingCount: number,
): KnowledgeRuleMatch | null {
  const text = functionSearchText(fn);
  const matchedSignals = rule.signalPatterns.filter((signal) =>
    signalMatchesFunction(signal, fn, text, incomingCount, outgoingCount),
  );
  if (!matchedSignals.length) return null;
  if (!passesRuleContext(rule, fn, text, incomingCount, outgoingCount, matchedSignals)) return null;

  const confidence = scoreRuleConfidence(rule, fn, matchedSignals);
  const evidenceGrade = ruleEvidenceGrade(fn);
  return {
    id: `match-${rule.id}-${fn.id}`,
    ruleId: rule.id,
    ruleName: rule.name,
    category: rule.category,
    severity: rule.severity,
    functionId: fn.id,
    functionName: fn.name,
    fileName: fn.fileName,
    line: fn.startLine,
    confidence: evidenceGrade === "heuristic" ? Math.min(68, confidence) : confidence,
    matchedSignals,
    evidence: `${rule.evidenceSource} · ${matchedSignals.slice(0, 3).join(" / ")}`,
    recommendation: rule.recommendation,
    sourceVersionId: rule.sourceVersionId,
    tags: rule.tags,
    evidenceGrade,
    evidenceLimitation:
      evidenceGrade === "heuristic"
        ? "当前只有词法/启发式信号，必须补 AST、类型、版本或运行证据后才能确认问题"
        : evidenceGrade === "compiler"
          ? "编译器已确认代码结构，但问题是否在真实输入下触发仍需运行验证"
          : "解析器已确认局部结构，跨文件类型和运行触发条件仍需补证据",
  };
}

function ruleEvidenceGrade(fn: FunctionInfo): KnowledgeRuleMatch["evidenceGrade"] {
  const parserEvidence = `${fn.parser ?? ""} ${(fn.parseEvidence ?? []).join(" ")}`;
  if (/compiler|typechecker|language service/i.test(parserEvidence)) return "compiler";
  if (fn.source === "Parser Fact" && !/heuristic|fallback/i.test(parserEvidence)) return "parser";
  return "heuristic";
}

function functionSearchText(fn: FunctionInfo) {
  return [
    fn.name,
    fn.fileName,
    fn.language,
    fn.returnType,
    fn.dataShape,
    fn.category,
    fn.summary,
    fn.body,
    fn.params.join(" "),
    fn.outputs.join(" "),
    fn.sideEffects.join(" "),
    fn.externalInputs.join(" "),
    fn.validations.join(" "),
    fn.risks.join(" "),
    fn.source,
    fn.parser ?? "",
    fn.parseEvidence?.join(" ") ?? "",
  ]
    .join("\n")
    .toLowerCase();
}

function signalMatchesFunction(
  signal: string,
  fn: FunctionInfo,
  text: string,
  incomingCount: number,
  outgoingCount: number,
) {
  const normalized = signal.toLowerCase();

  if (normalized === "outdegree = 0") return outgoingCount === 0;
  if (normalized === "return missing") return !hasRealOutput(fn);
  if (normalized === "sideeffects empty") return !fn.sideEffects.length;
  if (normalized === "same parameter name") return false;
  if (normalized === "multiple type annotations") return false;
  if (normalized === "unknown + typed") return fn.params.some((param) => /unknown|any/i.test(param));
  if (normalized === "parser fact") return fn.source === "Parser Fact";
  if (normalized === "ast") return /ast|compiler|typescript/i.test(`${fn.parser ?? ""} ${fn.parseEvidence?.join(" ") ?? ""}`);
  if (normalized === "runtime") return false;
  if (normalized === "heuristic") return fn.source === "Heuristic" || /heuristic/i.test(fn.parser ?? "");
  if (normalized === "entry function") return incomingCount === 0 && outgoingCount > 0;
  if (normalized === "call edge") return incomingCount + outgoingCount > 0;
  if (normalized === "unreachable function") return incomingCount === 0 && outgoingCount === 0;
  if (normalized === "for await") return /\bfor\s+await\b/.test(text);
  if (normalized === "for ... await") return /\bfor\b[\s\S]{0,180}\bawait\b/.test(text);
  if (normalized === "while ... await") return /\bwhile\b[\s\S]{0,180}\bawait\b/.test(text);
  if (normalized === "await inside loop") return /\b(for|while)\b[\s\S]{0,180}\bawait\b/.test(text);
  if (normalized === "for ... for") return /\bfor\b[\s\S]{0,220}\bfor\b/.test(text);
  if (normalized === "while ... while") return /\bwhile\b[\s\S]{0,220}\bwhile\b/.test(text);
  if (normalized === ".map(... .filter") return /\.map\([\s\S]{0,240}\.filter\(/.test(text);
  if (normalized === "while (true)") return /while\s*\(\s*true\s*\)/.test(text);
  if (normalized === "for (;;)") return /for\s*\(\s*;\s*;\s*\)/.test(text);
  if (normalized === "calls itself") return fn.calls.includes(fn.id);
  if (normalized === "recursive") return /\brecurs/.test(text) || fn.calls.includes(fn.id);
  if (normalized === "shell=true") return /shell\s*=\s*true/.test(text);

  if (/^[a-z0-9_]+$/i.test(signal)) {
    return new RegExp(`\\b${escapeRegExp(normalized)}\\b`).test(text);
  }

  return text.includes(normalized);
}

function passesRuleContext(
  rule: KnowledgeRule,
  fn: FunctionInfo,
  text: string,
  incomingCount: number,
  outgoingCount: number,
  matchedSignals: string[],
) {
  switch (rule.id) {
    case "security-unvalidated-input":
      return (fn.externalInputs.length > 0 || hasExternalInputSignal(text)) && !fn.validations.length;
    case "security-sql-injection":
      return hasSqlSink(text) && (hasStringInterpolation(text) || fn.externalInputs.length > 0);
    case "security-command-exec":
      return hasCommandExecutionSignal(text);
    case "security-path-traversal":
      return hasFilePathSink(text) && (fn.externalInputs.length > 0 || /\.\.\//.test(text));
    case "security-secret-leak":
      return hasSensitiveSignal(text) && hasOutputSink(text);
    case "efficiency-unbounded-growth":
      return !hasCapacityGuard(text);
    case "stability-missing-timeout":
      return hasExternalCallSignal(text) && !hasTimeoutGuard(text);
    case "stability-retry-no-backoff":
      return hasRetrySignal(text) && !/backoff|exponential|maxattempt|max_attempt|limit|timeout/.test(text);
    case "stability-null-boundary":
      return hasNullableSignal(text) && !/if\s*\(|guard|assert|throw|default|fallback|\?\?/.test(text);
    case "stability-infinite-loop":
      return matchedSignals.some((signal) => ["while (true)", "for (;;)", "recursive", "calls itself"].includes(signal.toLowerCase()));
    case "math-reachability-closure":
      return outgoingCount === 0 && !hasRealOutput(fn) && !fn.sideEffects.length;
    case "algorithm-bfs-entry-tree":
      return incomingCount === 0 && outgoingCount > 0;
    case "algorithm-binary-search-precondition":
      return /binarysearch|bisect|\bmid\b/.test(text) && !/sorted|sort\(|monotonic|ordered/.test(text);
    case "algorithm-top-k-heap-fit":
      return /sort/.test(text) && /slice|limit|top|rank/.test(text);
    case "algorithm-streaming-large-data":
      return /readfile|json\.parse|response\.json|load/.test(text) && !/stream|cursor|chunk|page|pagination/.test(text);
    case "efficiency-unbounded-promise-all":
      return /promise\.all/.test(text) && /\.map\(|fetch\(|query\(/.test(text) && !/p-limit|plimit|concurr|batch|chunk|queue/.test(text);
    case "efficiency-n-plus-one-query":
      return /\b(for|while)\b|\.map\(/.test(text) && /query\(|findmany|select/.test(text);
    case "efficiency-large-json-parse":
      return /json\.parse|response\.json|json\.loads/.test(text) && !/limit|maxbytes|max_bytes|try|catch|except|schema/.test(text);
    case "security-xss-sink":
      return /innerhtml|dangerouslysetinnerhtml|document\.write|v-html/.test(text);
    case "security-ssrf-request":
      return /fetch\(|requests\.get|http\.get|axios/.test(text) && (/url|request|req\.|input|params/.test(text) || fn.externalInputs.length > 0);
    case "security-insecure-deserialization":
      return /pickle\.load|pickle\.loads|yaml\.load|deserialize|unserialize/.test(text);
    case "security-missing-auth-mutation":
      return hasMutationSignal(text) && !/auth|permission|authorize|owner|tenant|role|policy/.test(text);
    case "security-weak-crypto":
      return /md5|sha1/.test(text) || (/createhash|crypto/.test(text) && /password|token|secret|signature/.test(text));
    case "security-csrf-mutation":
      return hasMutationSignal(text) && /cookie|session|post|put|patch|delete/.test(text) && !/csrf|samesite|origin|referer/.test(text);
    case "security-cors-wildcard-credentials":
      return /cors|access-control-allow-origin|credentials/.test(text) && (/\*/.test(text) || /origin\s*:\s*true|origin\s*=>|reflect/.test(text));
    case "security-jwt-weak-verify":
      return /jwt|jsonwebtoken|decode|verify/.test(text) && (!/issuer|audience|algorithm|algorithms|expiresin|exp|nbf/.test(text) || /alg\s*:\s*["']none|decode\(/.test(text));
    case "security-dependency-vulnerability":
      return /package\.json|requirements\.txt|pom\.xml|cargo\.toml|go\.mod/.test(text);
    case "security-orm-raw-query":
      return /queryrawunsafe|\$queryrawunsafe|\$executerawunsafe|raw\(|text\(|createquery/.test(text) && (hasStringInterpolation(text) || fn.externalInputs.length > 0);
    case "security-framework-template-injection":
      return /render\(|template|jinja|ejs|handlebars/.test(text) && (fn.externalInputs.length > 0 || /request|req\.|params|input/.test(text));
    case "stability-idempotency-missing":
      return hasMutationSignal(text) && /retry|send|charge|create|insert/.test(text) && !/idempot|unique|dedupe|nonce/.test(text);
    case "stability-partial-write-transaction":
      return mutationSignalCount(text) >= 2 && !/transaction|rollback|atomic|compensat/.test(text);
    case "stability-resource-cleanup":
      return /open\(|connect|lock|subscribe/.test(text) && !/close|finally|defer|using|unsubscribe|unlock/.test(text);
    case "stability-timezone-clock":
      return /date|datetime|now|cron|schedule/.test(text) && !/utc|timezone|tz|iso/.test(text);
    case "stability-lock-contention":
      return /mutex|lock|synchronized|reentrantlock|rwlock/.test(text) && !/trylock|timeout|finally|defer|unlock/.test(text);
    case "stability-lost-update-race":
      return /read/.test(text) && /update|save|write/.test(text) && !/transaction|version|compareandset|cas|atomic/.test(text);
    case "stability-message-idempotency":
      return /kafka|sqs|rabbit|mqtt|consumer|subscribe/.test(text) && hasMutationSignal(text) && !/idempot|dedupe|messageid|unique/.test(text);
    case "stability-device-offline":
      return /sensor|serial|mqtt|gpio|i2c|spi|uart/.test(text) && !/heartbeat|reconnect|offline|timeout|retry/.test(text);
    case "stability-hardware-watchdog-missing":
      return /pwm|relay|motor|actuator|servo|gpio/.test(text) && !/watchdog|safestop|emergency|timeout|maxduration/.test(text);
    case "efficiency-orm-overfetch":
      return /findmany|include|select \*|all\(/.test(text) && !/limit|cursor|take|select\s*:\s*\{|projection/.test(text);
    case "efficiency-index-missing-query":
      return /where|orderby|join|filter/.test(text) && !/index|explain|queryplan/.test(text);
    default:
      return true;
  }
}

function scoreRuleConfidence(rule: KnowledgeRule, fn: FunctionInfo, matchedSignals: string[]) {
  const parserBonus = fn.source === "Parser Fact" ? 5 : fn.parser?.includes("Compiler") ? 7 : 0;
  const signalBonus = Math.min(10, matchedSignals.length * 3);
  const sourceBonus = Math.max(-6, Math.min(6, (fn.confidence - 70) / 4));
  const raw = Math.max(45, Math.min(96, Math.round(rule.confidenceBase * 100 + parserBonus + signalBonus + sourceBonus)));
  return ruleEvidenceGrade(fn) === "heuristic" ? Math.min(68, raw) : raw;
}

function groupMatchesByFunction(matches: KnowledgeRuleMatch[]) {
  const groups = new Map<string, KnowledgeRuleMatch[]>();
  matches.forEach((match) => {
    groups.set(match.functionId, [...(groups.get(match.functionId) ?? []), match]);
  });
  return groups;
}

function bestRuleConfidence(matches: KnowledgeRuleMatch[]) {
  return Math.max(50, ...matches.map((match) => match.confidence));
}

function riskLabelForRuleMatch(match: KnowledgeRuleMatch) {
  if (match.ruleId === "security-sql-injection" || match.ruleId === "security-orm-raw-query" || match.ruleId.includes("sqlalchemy") || match.ruleId.includes("queryraw") || match.ruleId.includes("java-sql")) return "SQL 注入风险";
  if (match.ruleId === "security-command-exec" || match.ruleId === "language-api-node-exec" || match.ruleId === "language-api-python-subprocess" || match.ruleId.includes("java-runtime") || match.ruleId.includes("c-system")) return "命令执行风险";
  if (match.ruleId === "security-path-traversal" || match.ruleId === "language-api-node-readfile" || match.ruleId === "language-api-python-open") return "路径穿越风险";
  if (match.ruleId.includes("c-strcpy")) return "溢流风险";
  if (match.ruleId.includes("device-offline")) return "设备离线风险";
  if (match.ruleId.includes("watchdog")) return "看门狗缺失风险";
  if (match.ruleId === "efficiency-unbounded-growth") return "溢流风险";
  if (match.ruleId === "stability-infinite-loop") return "堵塞/无限循环";
  return match.ruleName;
}

function issueCategoryForMatch(match: KnowledgeRuleMatch): AnalysisIssue["category"] {
  if (match.category === "security") return "security";
  if (match.category === "efficiency" || match.category === "algorithm") return "performance";
  if (match.category === "stability") return "flow";
  if (match.category === "language_api" && (match.tags.includes("security") || match.severity === "critical")) return "security";
  return "quality";
}

function issueSeverityForRule(severity: KnowledgeRuleMatch["severity"]): AnalysisIssue["severity"] {
  if (severity === "critical") return "Critical";
  if (severity === "risk") return "High";
  if (severity === "warn") return "Medium";
  return "Low";
}

function severityWeight(severity: KnowledgeRuleMatch["severity"]) {
  if (severity === "critical") return 4;
  if (severity === "risk") return 3;
  if (severity === "warn") return 2;
  return 1;
}

function countEdges(edges: GraphEdge[], key: "from" | "to") {
  const counts = new Map<string, number>();
  edges.forEach((edge) => counts.set(edge[key], (counts.get(edge[key]) ?? 0) + 1));
  return counts;
}

function hasRealOutput(fn: FunctionInfo) {
  return fn.outputs.some((output) => output !== "state change/void" && output !== "void");
}

function hasExternalInputSignal(text: string) {
  return /request|req\.|process\.env|argv|input\(|open\(|fetch\(|formdata|searchparams/.test(text);
}

function hasSqlSink(text: string) {
  return /query\(|execute\(|select\s+|insert\s+|update\s+|delete\s+from/.test(text);
}

function hasStringInterpolation(text: string) {
  return /\$\{|`[\s\S]*select|'\s*\+|"\s*\+|\+\s*req|\+\s*input|\+\s*params/.test(text);
}

function hasCommandExecutionSignal(text: string) {
  return /exec\(|eval\(|function\(|spawn\(|shell\s*=\s*true|subprocess/.test(text);
}

function hasFilePathSink(text: string) {
  return /readfile|writefile|open\(|path\.join|pathlib|fs\./.test(text);
}

function hasSensitiveSignal(text: string) {
  return /secret|token|password|apikey|api_key|privatekey|private_key/.test(text);
}

function hasOutputSink(text: string) {
  return /console\.log|logger|print\(|response|return|throw/.test(text);
}

function hasCapacityGuard(text: string) {
  return /limit|max|capacity|length\s*[<>=]|size\s*[<>=]|slice\(|splice\(|shift\(|ttl|lru/.test(text);
}

function hasExternalCallSignal(text: string) {
  return /fetch\(|axios|readfile|subprocess|serial|request\(|http\.|https\./.test(text);
}

function hasTimeoutGuard(text: string) {
  return /timeout|abortcontroller|abortsignal|signal|settimeout|deadline/.test(text);
}

function hasRetrySignal(text: string) {
  return /retry|while|for|catch/.test(text);
}

function hasNullableSignal(text: string) {
  return /find\(|\.get\(|optional|null|undefined|none/.test(text);
}

function hasMutationSignal(text: string) {
  return /delete|update|create|insert|save|charge|send|write|post|put|patch/.test(text);
}

function mutationSignalCount(text: string) {
  return ["delete", "update", "create", "insert", "save", "write", "post", "put", "patch"].filter((signal) => text.includes(signal)).length;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
