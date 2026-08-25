import type {
  CodeFile,
  ControlledRuntimeAdapter,
  ControlledRuntimeExecutionReport,
} from "@/src/lib/analysis/types";
import { prepareProtocolExperiment } from "./protocol-experiment.ts";

export type SecurityAssertionKind =
  | "unauthenticated"
  | "wrong-role"
  | "cross-tenant"
  | "expired-token"
  | "sql-injection"
  | "path-traversal"
  | "command-injection"
  | "oversized-input"
  | "csrf"
  | "ssrf"
  | "unsafe-deserialization"
  | "template-injection"
  | "jwt-confusion"
  | "mass-assignment"
  | "open-redirect"
  | "header-injection";

export type SecurityAttackSample = {
  id: string;
  kind: SecurityAssertionKind;
  title: string;
  payload: string;
  canary: string;
  expected: "explicit-denial" | "no-canary-leak" | "bounded-rejection";
  provenance: string;
  weaknessIds: string[];
  protocol: "generic-json" | "http-request" | "framework-request";
  frameworkHints: string[];
};

export type SecurityAttackCorpusManifest = {
  id: string;
  version: string;
  checksum: string;
  caseCount: number;
  provenance: string[];
};

export type SecurityAssertionResult = {
  sample: SecurityAttackSample;
  run: ControlledRuntimeExecutionReport;
  status: "passed" | "failed" | "inconclusive" | "harness-blocked";
  evidence: string[];
};

export type SecurityCorpusMaturityReport = {
  status: "seed" | "replay-covered" | "mature-validation-candidate";
  coverage: number;
  conclusiveRate: number;
  passedCount: number;
  failedCount: number;
  inconclusiveCount: number;
  eligibleForDeepWebSupervision: boolean;
  projectCount: number;
  frameworkCount: number;
  replaySpanDays: number;
  minimumCaseReplayCount: number;
  evidence: string[];
};

export function buildLocalSecurityAttackCorpus(): SecurityAttackSample[] {
  return [
    identitySample("unauthenticated", "未登录访问", { authorization: null, action: "read-private" }),
    identitySample("wrong-role", "越权角色访问", { user: "codeflow-auditor", role: "viewer", action: "admin-delete" }),
    identitySample("cross-tenant", "跨租户对象访问", { tenantId: "tenant-a", objectTenantId: "tenant-b", action: "read" }),
    identitySample("expired-token", "过期会话访问", { token: "codeflow.expired.local-token", expiresAt: 1, action: "write" }),
    dataSample("sql-injection", "SQL 注入输入", { query: "' OR 1=1 --", value: "CODEFLOW_CANARY_SQL" }),
    dataSample("path-traversal", "路径穿越输入", { path: "../../CODEFLOW_CANARY_PATH", action: "read" }),
    dataSample("command-injection", "命令拼接输入", { command: "; printf CODEFLOW_CANARY_COMMAND", action: "preview" }),
    {
      id: "security-oversized-input-v1",
      kind: "oversized-input",
      title: "有界超大输入",
      payload: JSON.stringify({ value: "A".repeat(64 * 1024), canary: "CODEFLOW_CANARY_SIZE" }),
      canary: "CODEFLOW_CANARY_SIZE",
      expected: "bounded-rejection",
      provenance: "CWE-400 bounded local regression",
      weaknessIds: ["CWE-400"],
      protocol: "generic-json",
      frameworkHints: ["all"],
    },
    frameworkSample("csrf", "跨站请求伪造", "CWE-352", { method: "POST", headers: { origin: "https://attacker.invalid" }, cookies: { session: "local-placeholder" }, csrfToken: null }),
    frameworkSample("ssrf", "服务端请求伪造", "CWE-918", { method: "POST", body: { url: "http://127.0.0.1:1/CODEFLOW_CANARY_SSRF" } }),
    frameworkSample("unsafe-deserialization", "不安全反序列化", "CWE-502", { body: { type: "__codeflow_unknown_type__", payload: "CODEFLOW_CANARY_DESERIALIZE" } }),
    frameworkSample("template-injection", "模板表达式注入", "CWE-1336", { query: { template: "{{CODEFLOW_CANARY_TEMPLATE}}" } }),
    frameworkSample("jwt-confusion", "JWT 算法混淆", "CWE-347", { headers: { authorization: "Bearer eyJhbGciOiJub25lIn0.eyJjYW5hcnkiOiJDT0RFRkxPV19DQU5BUllfSldUIn0." } }, "explicit-denial"),
    frameworkSample("mass-assignment", "批量赋值越权", "CWE-915", { method: "PATCH", body: { displayName: "test", role: "admin", isAdmin: true, canary: "CODEFLOW_CANARY_MASS" } }),
    frameworkSample("open-redirect", "开放重定向", "CWE-601", { query: { next: "https://attacker.invalid/CODEFLOW_CANARY_REDIRECT" } }),
    frameworkSample("header-injection", "响应头注入", "CWE-113", { headers: { "x-return-to": "safe\r\nX-CodeFlow-Canary: injected" } }),
  ];
}

export function buildSecurityAttackCorpusManifest(): SecurityAttackCorpusManifest {
  const corpus = buildLocalSecurityAttackCorpus();
  const version = "2026.08.12-v3";
  const canonical = corpus.map(({ id, kind, payload, expected, weaknessIds }) => ({ id, kind, payload, expected, weaknessIds }));
  return {
    id: `codeflow-security-corpus-${version}`,
    version,
    checksum: stableChecksum(JSON.stringify(canonical)),
    caseCount: corpus.length,
    provenance: [...new Set(corpus.map((item) => item.provenance))],
  };
}

export function evaluateSecurityCorpusMaturity(results: SecurityAssertionResult[], history: Array<{ projectId: string; framework: string; createdAt: number; status: SecurityAssertionResult["status"] }> = []): SecurityCorpusMaturityReport {
  const manifest = buildSecurityAttackCorpusManifest();
  const uniqueCases = new Set(results.map((item) => item.sample.id)).size;
  const passedCount = results.filter((item) => item.status === "passed").length;
  const failedCount = results.filter((item) => item.status === "failed").length;
  const inconclusiveCount = results.length - passedCount - failedCount;
  const coverage = Math.round(uniqueCases / manifest.caseCount * 100);
  const conclusiveRate = results.length ? Math.round((passedCount + failedCount) / results.length * 100) : 0;
  const projectCount = new Set(history.map((item) => item.projectId)).size;
  const frameworkCount = new Set(history.map((item) => item.framework).filter(Boolean)).size;
  const timestamps = history.map((item) => item.createdAt).filter(Number.isFinite);
  const replaySpanDays = timestamps.length > 1 ? Math.floor((Math.max(...timestamps) - Math.min(...timestamps)) / 86_400_000) : 0;
  const minimumCaseReplayCount = results.length ? Math.min(...[...new Set(results.map((item) => item.sample.id))].map((id) => results.filter((item) => item.sample.id === id).length)) : 0;
  const replayEligible = coverage === 100 && conclusiveRate === 100 && results.every((item) => item.run.sandboxStatus === "enforced");
  const historicallyMature = projectCount >= 20 && frameworkCount >= 5 && replaySpanDays >= 30 && minimumCaseReplayCount >= 3;
  const eligibleForDeepWebSupervision = replayEligible;
  return {
    status: replayEligible && historicallyMature ? "mature-validation-candidate" : coverage === 100 ? "replay-covered" : "seed",
    coverage,
    conclusiveRate,
    passedCount,
    failedCount,
    inconclusiveCount,
    eligibleForDeepWebSupervision,
    projectCount,
    frameworkCount,
    replaySpanDays,
    minimumCaseReplayCount,
    evidence: [
      `corpus ${manifest.version} ${manifest.checksum}；案例覆盖 ${uniqueCases}/${manifest.caseCount}。`,
      `动态结论率 ${conclusiveRate}%：通过 ${passedCount}、失败反例 ${failedCount}、未证实/拦截 ${inconclusiveCount}。`,
      replayEligible ? "本轮回放满足监督候选门禁；只有历史成熟门禁同时通过后才可晋级稳定老师。" : "未满足完整强隔离结论门禁，不进入 DeepWeb 稳定监督。",
      `长期成熟历史：${projectCount} 个项目、${frameworkCount} 个框架、跨度 ${replaySpanDays} 天、单案例最少回放 ${minimumCaseReplayCount} 次；稳定老师门槛为 20 项目 / 5 框架 / 30 天 / 每案例 3 次。`,
    ],
  };
}

export function evaluateSecurityAssertion(sample: SecurityAttackSample, run: ControlledRuntimeExecutionReport): SecurityAssertionResult {
  const combined = `${run.stdout}\n${run.stderr}`.toLowerCase();
  const explicitDenial = /\b(unauthorized|forbidden|denied|permission denied|access denied|invalid token|expired token|401|403)\b/i.test(combined);
  const explicitInputRejection = /\b(invalid input|validation failed|rejected|blocked|sanitized|bad request|unprocessable|400|422)\b/i.test(combined);
  const canaryLeak = combined.includes(sample.canary.toLowerCase()) ||
    (run.traceEvents ?? []).some((event) => event.event === "transfer" && event.from === "<stdin>");
  const sanitizerFinding = run.sanitizerStatus === "finding" || Boolean(run.sanitizerFindings?.length);
  const evidence = [
    `运行状态 ${run.status}，退出码 ${run.exitCode ?? "无"}。`,
    `动态污点探针 ${canaryLeak ? "观察到输入流向输出或文件" : "未观察到 canary 泄漏"}。`,
    `Sanitizer ${run.sanitizerStatus ?? "not-requested"}。`,
  ];

  if (run.status === "rejected" || run.status === "unavailable") {
    return { sample, run, status: "harness-blocked", evidence: [...evidence, "运行器或隔离层拒绝了实验；这不能证明目标程序已正确鉴权。"] };
  }
  if (sanitizerFinding || canaryLeak) {
    return { sample, run, status: "failed", evidence: [...evidence, sanitizerFinding ? "动态 sanitizer 已产生可复现反例。" : "攻击输入已跨越目标程序边界。"] };
  }
  if (sample.expected === "explicit-denial") {
    return explicitDenial
      ? { sample, run, status: "passed", evidence: [...evidence, "目标程序返回了明确拒绝证据。"] }
      : { sample, run, status: "inconclusive", evidence: [...evidence, "没有泄漏，但也没有明确的 401/403/拒绝语义，不能判定权限检查通过。"] };
  }
  if (sample.expected === "bounded-rejection") {
    const bounded = !run.timedOut && !run.stdoutTruncated && !run.stderrTruncated && run.status !== "failed";
    return { sample, run, status: bounded ? "passed" : "failed", evidence: [...evidence, bounded ? "超大输入在限制内完成，未触发超时或输出洪泛。" : "超大输入导致失败、超时或输出洪泛。"] };
  }
  return explicitInputRejection
    ? { sample, run, status: "passed", evidence: [...evidence, "目标程序给出了明确输入拒绝或净化语义，且未观察到 canary 泄漏。"] }
    : { sample, run, status: "inconclusive", evidence: [...evidence, "未观察到泄漏，但也没有目标程序读取并拒绝/净化该输入的证据；不能把无输出当作安全通过。"] };
}

export async function executeSecurityAssertionSuite(
  projectId: string,
  projectName: string,
  files: CodeFile[],
  adapter: ControlledRuntimeAdapter,
  entryPath: string,
  onRun?: (run: ControlledRuntimeExecutionReport) => void,
): Promise<SecurityAssertionResult[]> {
  const { executeControlledRuntime } = await import("../runtime/controlled-runtime.ts");
  const results: SecurityAssertionResult[] = [];
  for (const sample of buildLocalSecurityAttackCorpus()) {
    const protocol = prepareProtocolExperiment(files, sample);
    const run = await executeControlledRuntime(projectId, `${projectName} · security assertions`, protocol?.files ?? files, protocol?.adapter ?? adapter, protocol?.entryPath ?? entryPath, protocol?.stdin ?? sample.payload, {
      experimentKind: "security",
      sampleId: sample.id,
      repetition: 1,
    });
    onRun?.(run);
    const result = evaluateSecurityAssertion(sample, run);
    results.push(protocol ? { ...result, evidence: [...protocol.evidence, ...result.evidence] } : {
      ...result,
      evidence: sample.protocol === "generic-json" ? result.evidence : ["未识别受支持的本地框架协议入口，本轮只保留普通 stdin 候选，不构成协议安全证明。", ...result.evidence],
    });
  }
  return results;
}

export function inferSecurityFrameworks(files: CodeFile[]): string[] {
  const text = files.map((file) => `${file.name}\n${file.content}`).join("\n").toLowerCase();
  const signatures: Array<[string, RegExp]> = [
    ["FastAPI", /\bfastapi\b/], ["Django", /\bdjango\b/], ["Express", /\bexpress\b/],
    ["Spring", /\b(?:springframework|spring-boot)\b/], ["Rails", /\b(?:rails|actioncontroller)\b/],
    ["React", /\b(?:react-dom|from\s+["']react["'])\b/], ["Tauri", /\b(?:tauri|__tauri__)\b/],
  ];
  return signatures.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

export async function persistSecurityAssertionResults(projectId: string, results: SecurityAssertionResult[], projectFrameworks: string[] = []) {
  const invoke = nativeInvoke();
  if (!invoke) return { status: "web-preview", rowCount: 0 };
  const corpus = buildSecurityAttackCorpusManifest();
  const now = Date.now();
  const rows = [
    {
      tableName: "security_attack_corpora", primaryKey: corpus.id, sqlText: "",
      payload: { id: corpus.id, version: corpus.version, checksum: corpus.checksum, case_count: corpus.caseCount, provenance: corpus.provenance, status: "active", created_at: now },
    },
    ...buildLocalSecurityAttackCorpus().map((sample) => ({
      tableName: "security_attack_cases", primaryKey: `${corpus.id}:${sample.id}`, sqlText: "",
      payload: {
        id: `${corpus.id}:${sample.id}`, corpus_id: corpus.id, sample_id: sample.id, kind: sample.kind,
        title: sample.title, protocol: sample.protocol, framework_hints: sample.frameworkHints,
        weakness_ids: sample.weaknessIds, expected: sample.expected, payload_hash: stableChecksum(sample.payload),
        provenance: sample.provenance, created_at: now,
      },
    })),
    ...results.map((result) => ({
      tableName: "security_assertion_runs", primaryKey: `${result.run.id}:${result.sample.id}`, sqlText: "",
      payload: { id: `${result.run.id}:${result.sample.id}`, corpus_id: corpus.id, project_id: projectId, sample_id: result.sample.id, status: result.status, runtime_run_id: result.run.id, framework_hints: projectFrameworks, evidence: result.evidence, created_at: now },
    })),
  ];
  return invoke<{ status: string; rowCount: number }>("codeflow_sync_security_assertions", { rows });
}

export type NativeSecurityCorpusHistory = {
  projectCount: number;
  frameworkCount: number;
  replaySpanDays: number;
  replayCount: number;
  minimumCaseReplayCount: number;
  conclusiveRate: number;
  stableTeacherEligible: boolean;
  evidence: string[];
};

export async function loadSecurityCorpusHistory(): Promise<NativeSecurityCorpusHistory | null> {
  const invoke = nativeInvoke();
  if (!invoke) return null;
  return invoke<NativeSecurityCorpusHistory>("codeflow_security_corpus_history");
}

function identitySample(kind: Extract<SecurityAssertionKind, "unauthenticated" | "wrong-role" | "cross-tenant" | "expired-token">, title: string, value: Record<string, unknown>): SecurityAttackSample {
  const canary = `CODEFLOW_CANARY_${kind.replaceAll("-", "_").toUpperCase()}`;
  return { id: `security-${kind}-v3`, kind, title, payload: JSON.stringify({ ...value, canary }), canary, expected: "explicit-denial", provenance: "OWASP authorization testing pattern / local non-network replay", weaknessIds: kind === "cross-tenant" ? ["CWE-639"] : ["CWE-862", "CWE-863"], protocol: "framework-request", frameworkHints: ["FastAPI", "Django", "Express", "Spring", "Rails"] };
}

function dataSample(kind: Extract<SecurityAssertionKind, "sql-injection" | "path-traversal" | "command-injection">, title: string, value: Record<string, unknown>): SecurityAttackSample {
  const canary = Object.values(value).find((item) => typeof item === "string" && item.includes("CODEFLOW_CANARY")) as string | undefined
    ?? `CODEFLOW_CANARY_${kind.replaceAll("-", "_").toUpperCase()}`;
  const weaknessIds = kind === "sql-injection" ? ["CWE-89"] : kind === "path-traversal" ? ["CWE-22"] : ["CWE-78"];
  return { id: `security-${kind}-v3`, kind, title, payload: JSON.stringify({ ...value, canary }), canary, expected: "no-canary-leak", provenance: "CWE canonical attack shape / local inert canary replay", weaknessIds, protocol: "framework-request", frameworkHints: ["FastAPI", "Django", "Express", "Spring", "Rails"] };
}

function frameworkSample(kind: Extract<SecurityAssertionKind, "csrf" | "ssrf" | "unsafe-deserialization" | "template-injection" | "jwt-confusion" | "mass-assignment" | "open-redirect" | "header-injection">, title: string, weaknessId: string, request: Record<string, unknown>, expected: SecurityAttackSample["expected"] = "no-canary-leak"): SecurityAttackSample {
  const canary = `CODEFLOW_CANARY_${kind.replaceAll("-", "_").toUpperCase()}`;
  return { id: `security-${kind}-v3`, kind, title, payload: JSON.stringify({ codeflowProtocol: "http-request-v1", request, canary }), canary, expected, provenance: `CWE ${weaknessId} canonical safe local replay`, weaknessIds: [weaknessId], protocol: "http-request", frameworkHints: ["FastAPI", "Django", "Express", "Spring", "Rails"] };
}

function stableChecksum(value: string) {
  let first = 0x811c9dc5, second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    first = Math.imul(first ^ value.charCodeAt(index), 0x01000193) >>> 0;
    second = Math.imul(second ^ (value.charCodeAt(index) + index), 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
function nativeInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const current = window as Window & { __TAURI__?: { invoke?: TauriInvoke; core?: { invoke?: TauriInvoke } }; __TAURI_INTERNALS__?: { invoke?: TauriInvoke } };
  return current.__TAURI_INTERNALS__?.invoke ?? current.__TAURI__?.core?.invoke ?? current.__TAURI__?.invoke ?? null;
}
