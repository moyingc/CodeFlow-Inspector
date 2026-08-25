import type {
  CodeFile,
  ControlledRuntimeAdapter,
  ControlledRuntimeAvailabilityReport,
  ControlledRuntimeCertificationReport,
  ControlledRuntimeExecutionReport,
  ControlledRuntimeRequest,
} from "@/src/lib/analysis/types";
import { instrumentRuntimeProject } from "./auto-instrumentation.ts";

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type RuntimeWindow = Window & {
  __TAURI__?: {
    invoke?: TauriInvoke;
    core?: { invoke?: TauriInvoke };
  };
  __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
};

export function buildRuntimeWebPreviewReport(): ControlledRuntimeAvailabilityReport {
  return {
    status: "web-preview",
    tools: runtimeAdapterDefinitions().map((tool) => ({
      ...tool,
      available: false,
      version: "",
      evidence: "需要在 Tauri 桌面程序中检测本机工具链。",
    })),
    availableCount: 0,
    totalCount: runtimeAdapterDefinitions().length,
    evidence: "浏览器预览不会执行导入代码。",
    safetyBoundary: [
      "只允许固定语言适配器，不接受任意 shell 命令。",
      "必须由用户点击执行，不在导入或分析时自动运行。",
      "桌面运行使用临时项目副本、超时和输出上限。",
    ],
    extensionSlots: [
      {
        id: "language-runtime",
        label: "Additional language runtime",
        status: "reserved",
        requiredContracts: ["用于继续接入 Swift、Go、C#、Kotlin 等语言。"],
      },
      {
        id: "frontend-runtime",
        label: "Frontend and WebView runtime",
        status: "reserved",
        requiredContracts: ["用于接入浏览器、WebView、Bun、Deno 和框架测试。"],
      },
      {
        id: "embedded-target",
        label: "Embedded and cross-compile target",
        status: "reserved",
        requiredContracts: ["用于接入 Arduino、PlatformIO、Zephyr、厂商 SDK 与硬件探针。"],
      },
    ],
  };
}

export async function inspectControlledRuntimeTools(): Promise<ControlledRuntimeAvailabilityReport> {
  const invoke = nativeInvoke();
  if (!invoke) return buildRuntimeWebPreviewReport();
  return invoke("codeflow_runtime_availability");
}

export async function executeControlledRuntime(
  projectId: string,
  projectName: string,
  files: CodeFile[],
  adapter: ControlledRuntimeAdapter,
  entryPath: string,
  stdin = "",
  experiment: Pick<ControlledRuntimeRequest, "experimentKind" | "sampleId" | "repetition"> = {
    experimentKind: "baseline",
    sampleId: "baseline-user-input",
    repetition: 1,
  },
): Promise<ControlledRuntimeExecutionReport> {
  const invoke = nativeInvoke();
  if (!invoke) {
    throw new Error("受控运行器只在 Tauri 桌面程序中可用，浏览器预览不会执行导入代码。");
  }
  const request: ControlledRuntimeRequest = {
    projectId,
    projectName,
    adapter,
    entryPath,
    files: instrumentRuntimeProject(files, adapter, entryPath).files.map((file) => ({
      path: file.name,
      content: file.content,
      language: file.language,
    })),
    args: [],
    stdin,
    timeoutMs: 5_000,
    maxOutputBytes: 256_000,
    breakpoints: [],
    ...experiment,
  };
  return invoke("codeflow_run_controlled", { request });
}

export async function executeDigitalTwinExperimentSuite(
  projectId: string,
  projectName: string,
  files: CodeFile[],
  adapter: ControlledRuntimeAdapter,
  entryPath: string,
  userInput = "",
  onResult?: (report: ControlledRuntimeExecutionReport) => void,
) {
  const base = userInput || JSON.stringify({ codeflowExperiment: "baseline", value: "sample" });
  const batchId = Date.now();
  const samples: Array<{
    kind: ControlledRuntimeRequest["experimentKind"];
    id: string;
    repetition: number;
    stdin: string;
  }> = [
    { kind: "baseline", id: "baseline-standard", repetition: 1, stdin: base },
    ...Array.from({ length: 16 }, (_, index) => ({
      kind: "stress" as const,
      id: `stress-bounded-16x-${batchId}-${String(index + 1).padStart(2, "0")}`,
      repetition: 1,
      stdin: base,
    })),
    { kind: "fault", id: "fault-null-and-missing-dependency", repetition: 1, stdin: JSON.stringify({ codeflowExperiment: "fault", value: null, dependencyAvailable: false, timeoutHintMs: 1 }) },
    { kind: "security", id: "security-local-pollution", repetition: 1, stdin: JSON.stringify({ codeflowExperiment: "security", value: "' OR 1=1 --", path: "../../outside", command: "; echo blocked", size: 8192 }) },
  ];
  const reports: ControlledRuntimeExecutionReport[] = [];
  for (const sample of samples) {
    const report = await executeControlledRuntime(projectId, projectName, files, adapter, entryPath, sample.stdin, {
      experimentKind: sample.kind,
      sampleId: sample.id,
      repetition: sample.repetition,
    });
    reports.push(report);
    onResult?.(report);
  }
  return reports;
}

export type RepairVerificationExperimentReport = {
  candidateId: string;
  status: "passed" | "failed";
  outputEquivalent: boolean;
  baselineP95Ms: number;
  candidateP95Ms: number;
  performanceDeltaPercent: number;
  allSandboxed: boolean;
  runIds: string[];
  evidence: string[];
};

export async function executeRepairVerificationExperiment(
  projectId: string,
  projectName: string,
  candidateId: string,
  baselineFiles: CodeFile[],
  candidateFiles: CodeFile[],
  adapter: ControlledRuntimeAdapter,
  entryPath: string,
  stdin = "",
  onResult?: (report: ControlledRuntimeExecutionReport) => void,
): Promise<RepairVerificationExperimentReport> {
  if (!candidateId.trim() || !candidateFiles.length) throw new Error("修复实验需要明确候选 ID 和候选代码副本。");
  const safeId = candidateId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
  const execute = async (files: CodeFile[], phase: "baseline" | "candidate", kind: ControlledRuntimeRequest["experimentKind"], index: number, payload: string) => {
    const report = await executeControlledRuntime(projectId, `${projectName} · repair ${safeId} ${phase}`, files, adapter, entryPath, payload, {
      experimentKind: kind,
      sampleId: `repair-${safeId}-${phase}-${kind}-${String(index).padStart(2, "0")}`,
      repetition: 1,
    });
    onResult?.(report);
    return report;
  };
  const baselineRegression = await execute(baselineFiles, "baseline", "baseline", 1, stdin);
  const candidateRegression = await execute(candidateFiles, "candidate", "baseline", 1, stdin);
  const baselineStress: ControlledRuntimeExecutionReport[] = [];
  const candidateStress: ControlledRuntimeExecutionReport[] = [];
  for (let index = 1; index <= 16; index += 1) {
    baselineStress.push(await execute(baselineFiles, "baseline", "stress", index, stdin));
    candidateStress.push(await execute(candidateFiles, "candidate", "stress", index, stdin));
  }
  const securityPayload = JSON.stringify({ codeflowExperiment: "security", value: "' OR 1=1 --", path: "../../outside", command: "; echo blocked" });
  const candidateSecurity = await execute(candidateFiles, "candidate", "security", 1, securityPayload);
  const allRuns = [baselineRegression, candidateRegression, ...baselineStress, ...candidateStress, candidateSecurity];
  const outputEquivalent = baselineRegression.status === "passed" && candidateRegression.status === "passed" &&
    baselineRegression.stdout === candidateRegression.stdout;
  const baselineP95Ms = percentile95(baselineStress.map((run) => run.durationMs));
  const candidateP95Ms = percentile95(candidateStress.map((run) => run.durationMs));
  const performanceDeltaPercent = baselineP95Ms
    ? Math.round((baselineP95Ms - candidateP95Ms) / baselineP95Ms * 10_000) / 100
    : 0;
  const allSandboxed = allRuns.every((run) => run.sandboxStatus === "enforced");
  const securityCounterexample = candidateSecurity.sanitizerStatus === "finding" ||
    Boolean(candidateSecurity.sanitizerFindings?.length) ||
    (candidateSecurity.traceEvents ?? []).some((event) => event.event === "transfer" && event.from === "<stdin>");
  const passed = outputEquivalent && allSandboxed && candidateStress.every((run) => run.status === "passed") &&
    candidateSecurity.status === "passed" && !securityCounterexample;
  return {
    candidateId,
    status: passed ? "passed" : "failed",
    outputEquivalent,
    baselineP95Ms,
    candidateP95Ms,
    performanceDeltaPercent,
    allSandboxed,
    runIds: allRuns.map((run) => run.id),
    evidence: [
      `相同输入输出 ${outputEquivalent ? "一致" : "不一致"}`,
      `基线 P95 ${baselineP95Ms}ms · 候选 P95 ${candidateP95Ms}ms · 变化 ${performanceDeltaPercent}%`,
      `强隔离 ${allSandboxed ? "全部通过" : "存在缺口"} · 候选压力样本 ${candidateStress.length}`,
      `安全反例 ${securityCounterexample ? "已观察到，禁止写回" : "本次攻击样本未观察到"} · sanitizer ${candidateSecurity.sanitizerStatus ?? "not-requested"}`,
    ],
  };
}

function percentile95(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : 0;
}

export async function certifyControlledRuntimeOnHost(
  availability: ControlledRuntimeAvailabilityReport,
  onResult?: (report: ControlledRuntimeExecutionReport) => void,
) {
  const reports: ControlledRuntimeExecutionReport[] = [];
  for (const definition of runtimeAdapterDefinitions()) {
    if (!availability.tools.find((tool) => tool.adapter === definition.adapter)?.available) continue;
    const fixture = runtimeCertificationFixture(definition.adapter);
    const report = await executeControlledRuntime(
      "__codeflow_runtime_certification__",
      "CodeFlow six-language host certification",
      fixture.files,
      definition.adapter,
      fixture.entryPath,
      "certification-input",
      {
        experimentKind: "baseline",
        sampleId: `certification-${definition.adapter}-v1`,
        repetition: 1,
      },
    );
    reports.push(report);
    onResult?.(report);
  }
  return buildControlledRuntimeCertification(availability, reports);
}

export function buildControlledRuntimeCertification(
  availability: ControlledRuntimeAvailabilityReport,
  reports: ControlledRuntimeExecutionReport[],
): ControlledRuntimeCertificationReport {
  const items = runtimeAdapterDefinitions().map((definition) => {
    const tool = availability.tools.find((candidate) => candidate.adapter === definition.adapter);
    const run = reports
      .filter((candidate) => candidate.adapter === definition.adapter && candidate.sampleId === `certification-${definition.adapter}-v1`)
      .sort((a, b) => b.finishedAt - a.finishedAt)[0];
    const compiledAndExecuted = run?.status === "passed" && run.exitCode === 0;
    const traceCaptured = (run?.traceEvents?.length ?? 0) >= 2;
    const fileObservationCaptured = run?.fileChanges.some((change) => change.path === "certification-output.txt" && change.kind === "created") ?? false;
    const resourceObservationCaptured = Boolean(run && run.childProcessCount > 0 && run.durationMs >= 0 && run.peakMemoryBytes >= 0);
    const sandboxEnforced = run?.sandboxStatus === "enforced";
    const checks = [Boolean(tool?.available), compiledAndExecuted, traceCaptured, fileObservationCaptured, resourceObservationCaptured, sandboxEnforced];
    const score = Math.round(checks.filter(Boolean).length / checks.length * 100);
    const status = !tool?.available ? "missing" as const : !run ? "not-run" as const : score === 100 ? "passed" as const : "failed" as const;
    return {
      adapter: definition.adapter,
      label: definition.label,
      status,
      toolAvailable: Boolean(tool?.available),
      compiledAndExecuted,
      traceCaptured,
      fileObservationCaptured,
      resourceObservationCaptured,
      sandboxEnforced,
      score,
      runId: run?.id ?? null,
      evidence: [
        tool?.version || tool?.evidence || "工具链未检测",
        run ? `${run.status} · exit ${run.exitCode ?? "none"} · ${run.durationMs}ms` : "尚未运行宿主机认证",
        run?.sandboxEvidence ?? "尚无强隔离证据",
      ],
    };
  });
  const passedCount = items.filter((item) => item.status === "passed").length;
  const score = Math.round(items.reduce((sum, item) => sum + item.score, 0) / Math.max(1, items.length));
  const remaining = items.flatMap((item) => item.status === "passed" ? [] : [`${item.label}：${item.status === "not-run" ? "等待认证" : item.status === "missing" ? "工具链缺失" : "编译、trace、文件监控、资源监控或强隔离未全部通过"}`]);
  return {
    scope: "host-v1",
    status: passedCount === items.length ? "certified" : reports.length ? "partial" : "not-run",
    score,
    passedCount,
    totalCount: items.length,
    items,
    evidence: [
      `${passedCount}/${items.length} 个语言适配器通过同构真实执行认证。`,
      "认证要求固定命令、编译/执行、自动插桩独立 trace、文件改动、资源观测和 OS 强隔离同时成立。",
    ],
    remaining,
  };
}

export function recommendedRuntimeAdapter(files: CodeFile[]): ControlledRuntimeAdapter {
  const languages = new Set(files.map((file) => file.language));
  if (languages.has("TypeScript") || languages.has("JavaScript")) return "node";
  if (languages.has("Python")) return "python";
  if (languages.has("Rust")) return "rust";
  if (languages.has("Java")) return "java";
  if (languages.has("C++")) return "cpp";
  return "c";
}

export function recommendedRuntimeEntry(files: CodeFile[], adapter: ControlledRuntimeAdapter) {
  const extensions: Record<ControlledRuntimeAdapter, RegExp> = {
    node: /\.(mjs|cjs|js|mts|cts|ts)$/i,
    python: /\.py$/i,
    rust: /\.rs$/i,
    java: /\.java$/i,
    c: /\.c$/i,
    cpp: /\.(cc|cpp|cxx)$/i,
  };
  const excluded = /(^|\/)(eslint|vite|vitest|jest|next|postcss|tailwind|webpack|rollup|babel|prettier)\.config\.|(^|\/)(build|setup|conftest)\.[^/]+$|\.(test|spec)\.[^/]+$/i;
  const candidates = files.filter((file) => extensions[adapter].test(file.name) && !excluded.test(file.name));
  return (
    candidates.find((file) => /(^|\/)(src\/)?(main|index|app|server|cli|program)\.[^/]+$/i.test(file.name))?.name ??
    candidates[0]?.name ??
    ""
  );
}

export function runtimeAdapterDefinitions() {
  return [
    { adapter: "node" as const, label: "Node.js", command: "node" },
    { adapter: "python" as const, label: "Python", command: "python3" },
    { adapter: "rust" as const, label: "Rust / Cargo", command: "cargo" },
    { adapter: "java" as const, label: "Java / JVM", command: "java" },
    { adapter: "c" as const, label: "C", command: "cc" },
    { adapter: "cpp" as const, label: "C++", command: "c++" },
  ];
}

function runtimeCertificationFixture(adapter: ControlledRuntimeAdapter): { entryPath: string; files: CodeFile[] } {
  const fixtures: Record<ControlledRuntimeAdapter, { path: string; language: string; content: string }> = {
    node: { path: "main.js", language: "JavaScript", content: `require("fs").writeFileSync("certification-output.txt", "ok");` },
    python: { path: "main.py", language: "Python", content: `open("certification-output.txt", "w", encoding="utf-8").write("ok")\n` },
    rust: { path: "main.rs", language: "Rust", content: `fn main(){std::fs::write("certification-output.txt","ok").unwrap();}` },
    java: { path: "Main.java", language: "Java", content: `import java.nio.file.*; public class Main { public static void main(String[] a) throws Exception { Files.writeString(Path.of("certification-output.txt"), "ok"); } }` },
    c: { path: "main.c", language: "C", content: `#include <stdio.h>\nint main(void){FILE*f=fopen("certification-output.txt","w");if(!f)return 2;fputs("ok",f);fclose(f);return 0;}` },
    cpp: { path: "main.cpp", language: "C++", content: `#include <fstream>\nint main(){std::ofstream("certification-output.txt")<<"ok";}` },
  };
  const fixture = fixtures[adapter];
  return { entryPath: fixture.path, files: [{ id: `runtime-certification-${adapter}`, name: fixture.path, language: fixture.language, content: fixture.content }] };
}

function nativeInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const runtimeWindow = window as RuntimeWindow;
  return runtimeWindow.__TAURI__?.core?.invoke ?? runtimeWindow.__TAURI__?.invoke ?? runtimeWindow.__TAURI_INTERNALS__?.invoke ?? null;
}
