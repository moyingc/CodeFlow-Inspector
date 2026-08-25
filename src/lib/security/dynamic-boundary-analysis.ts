import type { ControlledRuntimeExecutionReport, FunctionInfo } from "../analysis/types.ts";

export type DynamicBoundaryKind = "ffi" | "reflection" | "dynamic-code" | "dynamic-import" | "native-process";

export type DynamicBoundaryFact = {
  id: string;
  functionId: string;
  functionName: string;
  fileName: string;
  line: number;
  kind: DynamicBoundaryKind;
  expression: string;
  status: "runtime-observed" | "static-candidate";
  runtimeRunIds: string[];
  evidence: string[];
};

const PATTERNS: Array<{ kind: DynamicBoundaryKind; pattern: RegExp; label: string }> = [
  { kind: "dynamic-code", pattern: /\b(?:eval|exec|compile|new\s+Function|Function)\s*\(/g, label: "运行期代码生成" },
  { kind: "reflection", pattern: /\b(?:getattr|setattr|hasattr|Class\.forName|getMethod|getDeclaredMethod|Method\.invoke|reflect\.|Type\.GetType|Activator\.CreateInstance)\s*\(/g, label: "反射调用" },
  { kind: "dynamic-import", pattern: /\b(?:import|require|importlib\.import_module|__import__)\s*\(/g, label: "动态模块加载" },
  { kind: "ffi", pattern: /\b(?:ctypes\.|cffi\.|ffi\.|dlopen|dlsym|LoadLibrary|GetProcAddress|JNIEXPORT|native\s+\w+|extern\s+["']C["']|libloading)\b/g, label: "FFI/native 边界" },
  { kind: "native-process", pattern: /\b(?:child_process|subprocess|ProcessBuilder|Runtime\.getRuntime|std::process::Command|system\s*\(|popen\s*\()\b/g, label: "本地进程边界" },
];

export function analyzeDynamicBoundaries(functions: FunctionInfo[], runtime: ControlledRuntimeExecutionReport[] = []): DynamicBoundaryFact[] {
  return functions.flatMap((fn) => PATTERNS.flatMap(({ kind, pattern, label }) => {
    pattern.lastIndex = 0;
    return [...fn.body.matchAll(pattern)].slice(0, 64).map((match, index) => {
      const line = fn.startLine + fn.body.slice(0, match.index ?? 0).split(/\r?\n/).length - 1;
      const expression = fn.body.slice(match.index ?? 0, (match.index ?? 0) + 120).split(/\r?\n/)[0].trim();
      const observedRuns = runtime.filter((run) => (run.traceEvents ?? []).some((event) => {
        if (event.event !== "transfer" || event.from !== `<${kind}>`) return false;
        const target = event.to?.toLowerCase().trim();
        return !target || target === "unknown" || expression.toLowerCase().includes(target);
      }));
      return {
        id: `boundary:${fn.id}:${kind}:${line}:${index}`,
        functionId: fn.id,
        functionName: fn.name,
        fileName: fn.fileName,
        line,
        kind,
        expression,
        status: observedRuns.length ? "runtime-observed" as const : "static-candidate" as const,
        runtimeRunIds: observedRuns.map((run) => run.id),
        evidence: observedRuns.length
          ? [`${label}在 ${observedRuns.length} 次受控运行中触发边界 trace。`]
          : [`${fn.fileName}:${line} 识别 ${label}，尚无受控运行事件证明实际触发。`],
      };
    });
  }));
}
