import type { ControlledRuntimeExecutionReport } from "@/src/lib/analysis/types";

export function runtimeSupervisionEligible(run: ControlledRuntimeExecutionReport) {
  return (
    (run.experimentKind ?? "baseline") === "baseline" &&
    run.status === "passed" &&
    run.sandboxStatus === "enforced" &&
    (run.traceEvents?.length ?? 0) > 0
  );
}

export function buildStressRuntimeBatches(runtimeExecutions: ControlledRuntimeExecutionReport[]) {
  const batches = new Map<string, ControlledRuntimeExecutionReport[]>();
  for (const run of runtimeExecutions.filter((item) => item.experimentKind === "stress")) {
    const match = run.sampleId?.match(/^(stress-bounded-16x-\d+)-\d{2}$/);
    if (!match) continue;
    const batch = batches.get(match[1]) ?? [];
    batch.push(run);
    batches.set(match[1], batch);
  }
  return Array.from(batches.entries()).map(([id, runs]) => {
    const orderedRuns = runs.sort((a, b) => a.finishedAt - b.finishedAt);
    const passedCount = orderedRuns.filter((run) => run.status === "passed").length;
    const failureRate = Math.round((orderedRuns.length - passedCount) / Math.max(1, orderedRuns.length) * 100);
    const durations = orderedRuns.map((run) => run.durationMs).sort((a, b) => a - b);
    const stronglyIsolated = orderedRuns.every((run) => run.sandboxStatus === "enforced");
    return {
      id,
      runs: orderedRuns,
      passedCount,
      failureRate,
      p95DurationMs: percentile(durations, 0.95),
      peakMemoryBytes: orderedRuns.reduce((peak, run) => Math.max(peak, run.peakMemoryBytes), 0),
      stronglyIsolated,
      trainingEligible: orderedRuns.length >= 16 && failureRate <= 5 && stronglyIsolated,
    };
  });
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1))];
}
