import type { FunctionInfo } from "../analysis/types.ts";
import { buildFunctionPathModel } from "./path-sensitive-ir.ts";

export type ConcurrentTransition = {
  id: string;
  functionId: string;
  taskId: string;
  event: string;
  line: number;
  reads: string[];
  writes: string[];
  guarded: boolean;
  lockset: string[];
  atomicOrder: "relaxed" | "acquire" | "release" | "acq_rel" | "seq_cst" | "unknown";
};

export type ConcurrencyCounterexample = {
  id: string;
  variable: string;
  transitionA: string;
  transitionB: string;
  schedule: string[];
  reason: string;
};

export type ConcurrencyStateSpaceReport = {
  transitions: ConcurrentTransition[];
  exploredStateCount: number;
  exploredScheduleCount: number;
  partialOrderReductionCount: number;
  frontierCount: number;
  frontierReasons: { stateBound: number; depthBound: number; taskBound: number };
  backtrackPointCount: number;
  sleepSetPrunedCount: number;
  happensBeforeEdges: Array<{ from: string; to: string; reason: string }>;
  synchronizationEdges: Array<{ from: string; to: string; primitive: string; reason: string }>;
  counterexamples: ConcurrencyCounterexample[];
  bound: { maxStates: number; maxDepth: number; maxTasks: number };
  completeWithinBounds: boolean;
  hasPotentiallyUnboundedLoop: boolean;
  evidence: string[];
};

export function exploreConcurrencyStateSpace(functions: FunctionInfo[], maxStates = 4_096, maxDepth = 24, maxTasks = 32): ConcurrencyStateSpaceReport {
  const transitions = functions.flatMap((fn) => transitionsForFunction(fn));
  const byTask = new Map<string, ConcurrentTransition[]>();
  transitions.forEach((transition) => byTask.set(transition.taskId, [...(byTask.get(transition.taskId) ?? []), transition]));
  const tasks = [...byTask.keys()].sort();
  const initial = Object.fromEntries(tasks.map((task) => [task, 0]));
  const seen = new Set<string>();
  const schedules = new Set<string>();
  const counterexamples = new Map<string, ConcurrencyCounterexample>();
  let reduced = 0;
  let frontierCount = 0;
  let backtrackPointCount = 0;
  let sleepSetPrunedCount = 0;
  const frontierReasons = { stateBound: 0, depthBound: 0, taskBound: 0 };
  const happensBeforeEdges: ConcurrencyStateSpaceReport["happensBeforeEdges"] = [];
  const synchronizationEdges = buildSynchronizationEdges(transitions);
  happensBeforeEdges.push(...synchronizationEdges.map((edge) => ({ from: edge.from, to: edge.to, reason: edge.reason })));

  const visit = (positions: Record<string, number>, schedule: string[], sleepSet: Set<string>) => {
    const stateKey = `${tasks.map((task) => `${task}:${positions[task]}`).join("|")}::sleep=${[...sleepSet].sort().join(",")}`;
    if (seen.has(stateKey)) return;
    if (seen.size >= maxStates) { frontierCount += 1; frontierReasons.stateBound += 1; return; }
    if (schedule.length >= maxDepth) { frontierCount += 1; frontierReasons.depthBound += 1; return; }
    if (tasks.length > maxTasks) { frontierCount += 1; frontierReasons.taskBound += 1; return; }
    seen.add(stateKey);
    const enabled = tasks.flatMap((task) => {
      const transition = byTask.get(task)?.[positions[task] ?? 0];
      return transition ? [transition] : [];
    });
    if (!enabled.length) { schedules.add(schedule.join(">")); return; }
    detectRaces(enabled, schedule, counterexamples);
    const awake = enabled.filter((transition) => !sleepSet.has(transition.id));
    sleepSetPrunedCount += enabled.length - awake.length;
    if (!awake.length) { schedules.add(`${schedule.join(">")}>sleep-complete`); return; }
    const first = awake[0];
    const persistent = [first, ...awake.slice(1).filter((transition) => !independent(first, transition))];
    reduced += awake.length - persistent.length;
    backtrackPointCount += Math.max(0, persistent.length - 1);
    for (const transition of persistent) {
      const nextSleep = new Set([...sleepSet].filter((id) => {
        const sleeping = transitions.find((item) => item.id === id);
        return sleeping ? independent(sleeping, transition) : false;
      }));
      for (const candidate of awake) if (candidate.id !== transition.id && independent(candidate, transition)) nextSleep.add(candidate.id);
      const previousSameTask = schedule.slice().reverse().map((id) => transitions.find((item) => item.id === id)).find((item) => item?.taskId === transition.taskId);
      if (previousSameTask) happensBeforeEdges.push({ from: previousSameTask.id, to: transition.id, reason: "program-order" });
      visit({ ...positions, [transition.taskId]: (positions[transition.taskId] ?? 0) + 1 }, [...schedule, transition.id], nextSleep);
    }
  };
  visit(initial, [], new Set());
  const hasPotentiallyUnboundedLoop = functions.some((fn) => fn.astControlFlow?.edges.some((edge) => edge.kind === "back"));
  return {
    transitions,
    exploredStateCount: seen.size,
    exploredScheduleCount: schedules.size,
    partialOrderReductionCount: reduced,
    frontierCount,
    frontierReasons,
    backtrackPointCount,
    sleepSetPrunedCount,
    happensBeforeEdges: uniqueEdges(happensBeforeEdges),
    synchronizationEdges,
    counterexamples: [...counterexamples.values()],
    bound: { maxStates, maxDepth, maxTasks },
    completeWithinBounds: frontierCount === 0,
    hasPotentiallyUnboundedLoop,
    evidence: [
      `${transitions.length} 个事件级并发 transition，探索 ${seen.size} 个状态、${schedules.size} 条终止调度；同步边 ${synchronizationEdges.length}。`,
      `DPOR 回溯点 ${backtrackPointCount}，sleep-set/独立顺序约简 ${sleepSetPrunedCount + reduced}；未探索前沿 ${frontierCount}（状态 ${frontierReasons.stateBound} / 深度 ${frontierReasons.depthBound} / 任务 ${frontierReasons.taskBound}）。`,
      hasPotentiallyUnboundedLoop ? "存在循环回边；无限交错不可穷举，结论仅覆盖声明边界。" : "未发现 AST 循环回边；结论仍受动态任务创建和反射限制。",
    ],
  };
}

function uniqueEdges(edges: ConcurrencyStateSpaceReport["happensBeforeEdges"]) {
  return [...new Map(edges.map((edge) => [`${edge.from}->${edge.to}:${edge.reason}`, edge])).values()];
}

function transitionsForFunction(fn: FunctionInfo): ConcurrentTransition[] {
  const model = buildFunctionPathModel(fn);
  const launches = model.concurrencyEvents.filter((item) => /spawn|thread|promise\.all|asyncio\.gather|async|await|go\b/.test(item.event));
  if (launches.length < 2) return [];
  const fallbackWrites = [...new Set(model.assignments.map((item) => item.variable).filter((value) => /state|shared|global|cache|count|this|self/i.test(value)))];
  const fallbackReads = [...new Set(model.assignments.flatMap((item) => item.expression.match(/[A-Za-z_$][\w$]*/g) ?? []))];
  return launches.map((launch, index) => ({
    id: `${fn.id}:task-${index}:${launch.line}`,
    functionId: fn.id,
    taskId: `${fn.id}:task-${index}`,
    event: launch.event,
    line: launch.line,
    reads: eventAccess(fn, launch.line).reads.length ? eventAccess(fn, launch.line).reads : fallbackReads,
    writes: eventAccess(fn, launch.line).writes.length ? eventAccess(fn, launch.line).writes : fallbackWrites,
    guarded: locksetAt(fn.body, fn.startLine, launch.line).length > 0 || /atomic|synchronized|semaphore/.test(launch.event),
    lockset: locksetAt(fn.body, fn.startLine, launch.line),
    atomicOrder: atomicOrderAt(fn.body, fn.startLine, launch.line),
  }));
}

function eventAccess(fn: FunctionInfo, line: number) {
  const exact = fn.astControlFlow?.nodes.filter((node) => node.startLine <= line && node.endLine >= line) ?? [];
  return {
    reads: [...new Set(exact.flatMap((node) => node.uses))],
    writes: [...new Set(exact.flatMap((node) => node.definitions))],
  };
}

function locksetAt(body: string, startLine: number, line: number) {
  const active = new Set<string>();
  body.split(/\r?\n/).slice(0, Math.max(1, line - startLine + 1)).forEach((sourceLine) => {
    for (const match of sourceLine.matchAll(/\b([A-Za-z_$][\w$]*)\.(?:lock|acquire)\s*\(|\b(?:lock|synchronized)\s*\(\s*([A-Za-z_$][\w$]*)/g)) active.add(match[1] || match[2]);
    for (const match of sourceLine.matchAll(/\b([A-Za-z_$][\w$]*)\.(?:unlock|release)\s*\(/g)) active.delete(match[1]);
  });
  return [...active].sort();
}

function atomicOrderAt(body: string, startLine: number, line: number): ConcurrentTransition["atomicOrder"] {
  const sourceLine = body.split(/\r?\n/)[Math.max(0, line - startLine)] ?? "";
  const match = sourceLine.match(/memory_order_(relaxed|acquire|release|acq_rel|seq_cst)|Ordering::(Relaxed|Acquire|Release|AcqRel|SeqCst)/);
  if (!match) return /\batomic\b|Atomic[A-Z]/.test(sourceLine) ? "seq_cst" : "unknown";
  const normalized = (match[1] ?? match[2]).replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  return normalized as ConcurrentTransition["atomicOrder"];
}

function buildSynchronizationEdges(transitions: ConcurrentTransition[]): ConcurrencyStateSpaceReport["synchronizationEdges"] {
  const edges: ConcurrencyStateSpaceReport["synchronizationEdges"] = [];
  transitions.forEach((left, index) => transitions.slice(index + 1).forEach((right) => {
    if (left.taskId === right.taskId) return;
    for (const lock of left.lockset.filter((item) => right.lockset.includes(item))) edges.push({ from: left.id, to: right.id, primitive: lock, reason: `shared-lock:${lock}` });
    if (left.atomicOrder !== "unknown" && right.atomicOrder !== "unknown") edges.push({ from: left.id, to: right.id, primitive: "atomic", reason: `atomic-order:${left.atomicOrder}->${right.atomicOrder}` });
  }));
  return edges;
}

function independent(left: ConcurrentTransition, right: ConcurrentTransition) {
  if (left.taskId === right.taskId) return false;
  return !left.writes.some((name) => right.writes.includes(name) || right.reads.includes(name)) &&
    !right.writes.some((name) => left.reads.includes(name));
}

function detectRaces(enabled: ConcurrentTransition[], schedule: string[], output: Map<string, ConcurrencyCounterexample>) {
  enabled.forEach((left, index) => enabled.slice(index + 1).forEach((right) => {
  if (left.lockset.some((lock) => right.lockset.includes(lock))) return;
  if (left.atomicOrder !== "unknown" && right.atomicOrder !== "unknown") return;
    const variable = left.writes.find((name) => right.writes.includes(name) || right.reads.includes(name)) ?? right.writes.find((name) => left.reads.includes(name));
    if (!variable) return;
    const id = `race:${left.id}:${right.id}:${variable}`;
    output.set(id, { id, variable, transitionA: left.id, transitionB: right.id, schedule: [...schedule, left.id, right.id], reason: `两个未保护 transition 对 ${variable} 存在冲突访问。` });
  }));
}
