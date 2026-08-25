import type { FunctionInfo, GraphEdge } from "../analysis/types.ts";
import { buildFunctionPathModel } from "./path-sensitive-ir.ts";

export type AbstractHeapObject = {
  id: string;
  allocationFunctionId: string;
  allocationLine: number;
  type: "allocation-site" | "parameter" | "unknown-return";
  escaped: boolean;
};

export type PointsToConstraint = {
  kind: "address" | "copy" | "call-argument" | "return" | "call-result" | "field-store" | "field-load" | "container-store" | "container-load";
  from: string;
  to: string;
  evidence: string;
  base?: string;
  field?: string;
};

export type ContextHeapState = {
  contextId: string;
  functionId: string;
  pointsTo: Record<string, string[]>;
  fieldPointsTo: Record<string, string[]>;
  allocationObjectIds: string[];
};

export type SeparationObligation = {
  id: string;
  kind: "disjoint" | "exclusive-owner" | "escaped-owner";
  objectIds: string[];
  status: "proved-by-abstraction" | "violated" | "unknown";
  evidence: string;
};

export type WholeProgramPointsToReport = {
  objects: AbstractHeapObject[];
  constraints: PointsToConstraint[];
  pointsTo: Record<string, string[]>;
  contextPointsTo: Record<string, string[]>;
  contextHeapStates: ContextHeapState[];
  fieldPointsTo: Record<string, string[]>;
  containerElementPointsTo: Record<string, string[]>;
  dynamicDispatchTargets: Array<{ callerId: string; receiver: string; method: string; targetIds: string[]; status: "resolved" | "ambiguous" | "unresolved" }>;
  aliasSets: Array<{ objectId: string; variables: string[] }>;
  contexts: Array<{ id: string; callerId: string; calleeId: string; callLine: number; depth: number }>;
  separationObligations: SeparationObligation[];
  escapedObjectIds: string[];
  unresolvedCallCount: number;
  iterations: number;
  converged: boolean;
  evidence: string[];
};

export function buildWholeProgramPointsTo(functions: FunctionInfo[], edges: GraphEdge[], maxIterations = 256, contextDepth = 2): WholeProgramPointsToReport {
  const byId = new Map(functions.map((fn) => [fn.id, fn]));
  const calledFunctionIds = new Set(edges.filter((edge) => !edge.kind || edge.kind === "call").map((edge) => edge.to));
  const objects: AbstractHeapObject[] = [];
  const constraints: PointsToConstraint[] = [];
  const points = new Map<string, Set<string>>();
  const fieldPoints = new Map<string, Set<string>>();
  const containerElementPoints = new Map<string, Set<string>>();
  const contextPoints = new Map<string, Set<string>>();
  const contexts: WholeProgramPointsToReport["contexts"] = [];
  const escaped = new Set<string>();
  const address = (variable: string, object: AbstractHeapObject, evidence: string) => {
    objects.push(object);
    constraints.push({ kind: "address", from: object.id, to: variable, evidence });
    add(points, variable, object.id);
  };

  for (const fn of functions) {
    const model = buildFunctionPathModel(fn);
    for (const param of fn.params.map(parameterName).filter(Boolean)) {
      if (!calledFunctionIds.has(fn.id)) {
        const object = { id: `param:${safe(fn.id)}:${safe(param)}`, allocationFunctionId: fn.id, allocationLine: fn.startLine, type: "parameter" as const, escaped: false };
        address(key(fn.id, param), object, `${fn.fileName}:${fn.startLine} externally reachable parameter object ${param}`);
      }
    }
    for (const object of model.heapObjects) {
      address(key(fn.id, object.owner), { id: object.id, allocationFunctionId: fn.id, allocationLine: object.allocatedLine, type: "allocation-site", escaped: false }, `${fn.fileName}:${object.allocatedLine} allocation-site`);
    }
    for (const alias of model.aliases) constraints.push({ kind: "copy", from: key(fn.id, alias.owner), to: key(fn.id, alias.alias), evidence: `${fn.fileName}:${alias.line} AST alias assignment` });
    for (const match of fn.body.matchAll(/\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)/g)) {
      constraints.push({ kind: "field-store", from: key(fn.id, match[3]), to: key(fn.id, match[1]), base: key(fn.id, match[1]), field: match[2], evidence: `${fn.fileName} field-sensitive store .${match[2]}` });
    }
    for (const match of fn.body.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g)) {
      constraints.push({ kind: "field-load", from: key(fn.id, match[2]), to: key(fn.id, match[1]), base: key(fn.id, match[2]), field: match[3], evidence: `${fn.fileName} field-sensitive load .${match[3]}` });
    }
    for (const match of fn.body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\[\s*([^\]]+)\s*\]\s*=\s*([A-Za-z_$][\w$]*)/g)) {
      constraints.push({ kind: "container-store", from: key(fn.id, match[3]), to: key(fn.id, match[1]), base: key(fn.id, match[1]), field: containerSlot(match[2]), evidence: `${fn.fileName} container element store [${match[2].trim()}]` });
    }
    for (const match of fn.body.matchAll(/\b([A-Za-z_$][\w$]*)\.(?:push|append|add)\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
      constraints.push({ kind: "container-store", from: key(fn.id, match[2]), to: key(fn.id, match[1]), base: key(fn.id, match[1]), field: "[*]", evidence: `${fn.fileName} container append` });
    }
    for (const match of fn.body.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\[\s*([^\]]+)\s*\]/g)) {
      constraints.push({ kind: "container-load", from: key(fn.id, match[2]), to: key(fn.id, match[1]), base: key(fn.id, match[2]), field: containerSlot(match[3]), evidence: `${fn.fileName} container element load [${match[3].trim()}]` });
    }
    for (const match of fn.body.matchAll(/\breturn\s+([A-Za-z_$][\w$]*)/g)) {
      constraints.push({ kind: "return", from: key(fn.id, match[1]), to: key(fn.id, "$return"), evidence: `${fn.fileName} return ${match[1]}` });
    }
  }

  let unresolvedCallCount = 0;
  for (const edge of edges.filter((item) => !item.kind || item.kind === "call")) {
    const caller = byId.get(edge.from);
    const callee = byId.get(edge.to);
    if (!caller || !callee) { unresolvedCallCount += 1; continue; }
    const call = findCall(caller.body, callee.name);
    if (!call) { unresolvedCallCount += 1; continue; }
    const params = callee.params.map(parameterName);
    const contextId = `${safe(caller.id)}>${safe(callee.id)}@${call.line}`;
    contexts.push({ id: contextId, callerId: caller.id, calleeId: callee.id, callLine: call.line, depth: 1 });
    call.arguments.forEach((argument, index) => {
      const variable = simpleIdentifier(argument);
      if (!variable || !params[index]) return;
      constraints.push({ kind: "call-argument", from: key(caller.id, variable), to: key(callee.id, params[index]), evidence: `${caller.name} -> ${callee.name} argument ${index + 1}` });
      for (const objectId of points.get(key(caller.id, variable)) ?? []) add(contextPoints, `${contextId}::${callee.id}::${params[index]}`, objectId);
    });
    if (call.assignee) constraints.push({ kind: "call-result", from: key(callee.id, "$return"), to: key(caller.id, call.assignee), evidence: `${callee.name} return -> ${caller.name}.${call.assignee}` });
  }

  let changed = true;
  let iterations = 0;
  while (changed && iterations < maxIterations) {
    changed = false;
    iterations += 1;
    for (const constraint of constraints) {
      if (constraint.kind === "address") continue;
      if (constraint.kind === "field-store") {
        for (const baseObject of points.get(constraint.base ?? constraint.to) ?? []) {
          for (const valueObject of points.get(constraint.from) ?? []) changed = add(fieldPoints, `${baseObject}.${constraint.field ?? "*"}`, valueObject) || changed;
        }
        continue;
      }
      if (constraint.kind === "field-load") {
        for (const baseObject of points.get(constraint.base ?? constraint.from) ?? []) {
          for (const valueObject of fieldPoints.get(`${baseObject}.${constraint.field ?? "*"}`) ?? []) changed = add(points, constraint.to, valueObject) || changed;
        }
        continue;
      }
      if (constraint.kind === "container-store") {
        for (const baseObject of points.get(constraint.base ?? constraint.to) ?? []) {
          for (const valueObject of points.get(constraint.from) ?? []) changed = add(containerElementPoints, `${baseObject}.${constraint.field ?? "[*]"}`, valueObject) || changed;
        }
        continue;
      }
      if (constraint.kind === "container-load") {
        for (const baseObject of points.get(constraint.base ?? constraint.from) ?? []) {
          const exact = containerElementPoints.get(`${baseObject}.${constraint.field ?? "[*]"}`) ?? new Set<string>();
          const wildcard = containerElementPoints.get(`${baseObject}.[*]`) ?? new Set<string>();
          for (const valueObject of [...exact, ...wildcard]) changed = add(points, constraint.to, valueObject) || changed;
        }
        continue;
      }
      for (const objectId of points.get(constraint.from) ?? []) changed = add(points, constraint.to, objectId) || changed;
    }
  }
  for (const context of contexts) {
    const caller = byId.get(context.callerId);
    const callee = byId.get(context.calleeId);
    if (!caller || !callee) continue;
    const call = findCall(caller.body, callee.name);
    const params = callee.params.map(parameterName);
    call?.arguments.forEach((argument, index) => {
      const variable = simpleIdentifier(argument);
      if (!variable || !params[index]) return;
      for (const objectId of points.get(key(caller.id, variable)) ?? []) {
        add(contextPoints, `${context.id}::${callee.id}::${params[index]}`, objectId);
      }
    });
    const calleeReturn = points.get(key(context.calleeId, "$return")) ?? new Set<string>();
    for (const objectId of calleeReturn) add(contextPoints, `${context.id}::${context.calleeId}::$return`, objectId);
  }
  if (contextDepth > 1) {
    const firstLevelContexts = [...contexts];
    const contextsByCaller = new Map<string, WholeProgramPointsToReport["contexts"]>();
    const pointsByContext = new Map<string, Array<[string, Set<string>]>>();
    for (const context of firstLevelContexts) contextsByCaller.set(context.callerId, [...(contextsByCaller.get(context.callerId) ?? []), context]);
    for (const [name, objectIds] of contextPoints) {
      const separator = name.indexOf("::");
      if (separator < 0) continue;
      const contextId = name.slice(0, separator);
      pointsByContext.set(contextId, [...(pointsByContext.get(contextId) ?? []), [name.slice(separator + 2), objectIds]]);
    }
    for (const outer of firstLevelContexts) for (const inner of contextsByCaller.get(outer.calleeId) ?? []) {
      const context = { id: `${outer.id}>${inner.id}`, callerId: outer.callerId, calleeId: inner.calleeId, callLine: inner.callLine, depth: 2 };
      contexts.push(context);
      for (const [variable, objectIds] of pointsByContext.get(inner.id) ?? []) for (const objectId of objectIds) add(contextPoints, `${context.id}::${variable}`, objectId);
    }
  }
  const allocationsByFunction = new Map<string, AbstractHeapObject[]>();
  const constraintsByFunction = new Map<string, PointsToConstraint[]>();
  const addressTargetsByObject = new Map<string, string[]>();
  const contextSeeds = new Map<string, Map<string, Set<string>>>();
  for (const object of objects.filter((item) => item.type === "allocation-site")) {
    allocationsByFunction.set(object.allocationFunctionId, [...(allocationsByFunction.get(object.allocationFunctionId) ?? []), object]);
  }
  for (const constraint of constraints) {
    if (constraint.kind === "address") {
      addressTargetsByObject.set(constraint.from, [...(addressTargetsByObject.get(constraint.from) ?? []), constraint.to]);
      continue;
    }
    const functionId = functionOwner(constraint.to) || functionOwner(constraint.from);
    if (functionId) constraintsByFunction.set(functionId, [...(constraintsByFunction.get(functionId) ?? []), constraint]);
  }
  for (const [name, objectIds] of contextPoints) {
    const separator = name.indexOf("::");
    if (separator < 0) continue;
    const contextId = name.slice(0, separator);
    const variable = name.slice(separator + 2);
    const seeds = contextSeeds.get(contextId) ?? new Map<string, Set<string>>();
    for (const objectId of objectIds) add(seeds, variable, objectId);
    contextSeeds.set(contextId, seeds);
  }
  const contextHeapStates = contexts.map((context) => buildContextHeapState(
    context,
    byId,
    allocationsByFunction.get(context.calleeId) ?? [],
    constraintsByFunction.get(context.calleeId) ?? [],
    addressTargetsByObject,
    contextSeeds.get(context.id) ?? new Map(),
    maxIterations,
  ));
  const dynamicDispatchTargets = buildDynamicDispatchTargets(functions);
  for (const fn of functions) {
    for (const objectId of points.get(key(fn.id, "$return")) ?? []) escaped.add(objectId);
  }
  const finalizedObjects = objects.map((object) => ({ ...object, escaped: escaped.has(object.id) }));
  const variablesByObject = new Map<string, string[]>();
  for (const [variable, objectIds] of points) for (const objectId of objectIds) {
    variablesByObject.set(objectId, [...(variablesByObject.get(objectId) ?? []), variable]);
  }
  const aliasSets = finalizedObjects
    .map((object) => ({ objectId: object.id, variables: (variablesByObject.get(object.id) ?? []).sort() }))
    .filter((item) => item.variables.length > 1);
  const separationObligations = buildSeparationObligations(finalizedObjects, variablesByObject, escaped);
  return {
    objects: finalizedObjects,
    constraints,
    pointsTo: Object.fromEntries([...points].map(([variable, objectIds]) => [variable, [...objectIds].sort()])),
    contextPointsTo: Object.fromEntries([...contextPoints].map(([variable, objectIds]) => [variable, [...objectIds].sort()])),
    contextHeapStates,
    fieldPointsTo: Object.fromEntries([...fieldPoints].map(([field, objectIds]) => [field, [...objectIds].sort()])),
    containerElementPointsTo: Object.fromEntries([...containerElementPoints].map(([field, objectIds]) => [field, [...objectIds].sort()])),
    dynamicDispatchTargets,
    aliasSets,
    contexts,
    separationObligations,
    escapedObjectIds: [...escaped].sort(),
    unresolvedCallCount,
    iterations,
    converged: !changed,
    evidence: [
      `${finalizedObjects.length} 个抽象对象，${constraints.length} 条 inclusion constraints，${aliasSets.length} 个跨变量别名集。`,
      `固定点 ${!changed ? "收敛" : "达到迭代上限"}于 ${iterations} 轮；未解析调用 ${unresolvedCallCount}。`,
      `allocation-site 对象 + 字段/容器元素敏感 heap map + ${contextDepth}-call-string 上下文；独立上下文堆 ${contextHeapStates.length} 个，分离义务 ${separationObligations.length} 条。`,
      `动态派发点 ${dynamicDispatchTargets.length} 个，其中未解析 ${dynamicDispatchTargets.filter((item) => item.status === "unresolved").length} 个。`,
      "上下文深度达到配置边界后保守合并；动态反射调用保留未知。",
    ],
  };
}

function buildContextHeapState(
  context: WholeProgramPointsToReport["contexts"][number],
  byId: Map<string, FunctionInfo>,
  allocationObjects: AbstractHeapObject[],
  localConstraints: PointsToConstraint[],
  addressTargetsByObject: Map<string, string[]>,
  seeds: Map<string, Set<string>>,
  maxIterations: number,
): ContextHeapState {
  const fn = byId.get(context.calleeId);
  const local = new Map<string, Set<string>>();
  const fields = new Map<string, Set<string>>();
  if (!fn) return { contextId: context.id, functionId: context.calleeId, pointsTo: {}, fieldPointsTo: {}, allocationObjectIds: [] };
  for (const [variable, objectIds] of seeds) for (const objectId of objectIds) add(local, variable, objectId);
  const allocationObjectIds: string[] = [];
  for (const object of allocationObjects) {
    const contextualId = `ctx:${safe(context.id)}:${object.id}`;
    allocationObjectIds.push(contextualId);
    for (const target of addressTargetsByObject.get(object.id) ?? []) add(local, target, contextualId);
  }
  let changed = true, iteration = 0;
  while (changed && iteration < maxIterations) {
    changed = false; iteration += 1;
    for (const constraint of localConstraints) {
      if (constraint.kind === "field-store" || constraint.kind === "container-store") {
        for (const baseObject of local.get(constraint.base ?? constraint.to) ?? []) for (const value of local.get(constraint.from) ?? []) changed = add(fields, `${baseObject}.${constraint.field ?? "*"}`, value) || changed;
      } else if (constraint.kind === "field-load" || constraint.kind === "container-load") {
        for (const baseObject of local.get(constraint.base ?? constraint.from) ?? []) for (const value of fields.get(`${baseObject}.${constraint.field ?? "*"}`) ?? []) changed = add(local, constraint.to, value) || changed;
      } else {
        for (const value of local.get(constraint.from) ?? []) changed = add(local, constraint.to, value) || changed;
      }
    }
  }
  return {
    contextId: context.id,
    functionId: fn.id,
    pointsTo: Object.fromEntries([...local].map(([name, values]) => [name, [...values].sort()])),
    fieldPointsTo: Object.fromEntries([...fields].map(([name, values]) => [name, [...values].sort()])),
    allocationObjectIds,
  };
}

function buildDynamicDispatchTargets(functions: FunctionInfo[]): WholeProgramPointsToReport["dynamicDispatchTargets"] {
  const byName = new Map<string, string[]>();
  for (const fn of functions) byName.set(fn.name, [...(byName.get(fn.name) ?? []), fn.id]);
  return functions.flatMap((caller) => [...caller.body.matchAll(/\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => {
    const targetIds = byName.get(match[2]) ?? [];
    return { callerId: caller.id, receiver: match[1], method: match[2], targetIds, status: targetIds.length === 1 ? "resolved" as const : targetIds.length > 1 ? "ambiguous" as const : "unresolved" as const };
  }));
}

function containerSlot(value: string) {
  const normalized = value.trim();
  return /^(?:\d+|["'][^"']+["'])$/.test(normalized) ? `[${normalized}]` : "[*]";
}

function buildSeparationObligations(objects: AbstractHeapObject[], variablesByObject: Map<string, string[]>, escaped: Set<string>): SeparationObligation[] {
  const obligations: SeparationObligation[] = [];
  const allocationGroups = new Map<string, AbstractHeapObject[]>();
  for (const object of objects.filter((item) => item.type === "allocation-site")) allocationGroups.set(object.allocationFunctionId, [...(allocationGroups.get(object.allocationFunctionId) ?? []), object]);
  for (const group of allocationGroups.values()) for (let index = 0; index < group.length; index += 1) for (const right of group.slice(index + 1)) {
    const left = group[index];
    const leftVariables = new Set(variablesByObject.get(left.id) ?? []);
    const sharedVariable = (variablesByObject.get(right.id) ?? []).find((variable) => leftVariables.has(variable));
    obligations.push({ id: `sep:${left.id}:${right.id}`, kind: "disjoint", objectIds: [left.id, right.id], status: sharedVariable ? "violated" : "proved-by-abstraction", evidence: sharedVariable ? `${sharedVariable} 同时指向两个分配点。` : "不同 allocation-site 在当前抽象中保持分离。" });
  }
  for (const object of objects.filter((item) => item.type === "allocation-site")) {
    const owners = variablesByObject.get(object.id) ?? [];
    obligations.push({ id: `owner:${object.id}`, kind: escaped.has(object.id) ? "escaped-owner" : "exclusive-owner", objectIds: [object.id], status: escaped.has(object.id) ? "unknown" : owners.length === 1 ? "proved-by-abstraction" : "unknown", evidence: escaped.has(object.id) ? "对象经返回值逃逸，所有权需由调用方继续证明。" : `当前可能所有者 ${owners.join("、") || "无"}。` });
  }
  return obligations;
}

function add(map: Map<string, Set<string>>, variable: string, object: string) {
  const current = map.get(variable) ?? new Set<string>();
  const before = current.size;
  current.add(object);
  map.set(variable, current);
  return current.size !== before;
}

function key(functionId: string, variable: string) { return `${functionId}::${variable}`; }
function functionOwner(variable: string) { return variable.includes("::") ? variable.slice(0, variable.indexOf("::")) : ""; }
function safe(value: string) { return value.replace(/[^a-zA-Z0-9_]/g, "_"); }
function parameterName(value: string) { return value.replace(/^\s*(?:self|this)\s*[:,]?\s*$/, "").split(/[:=]/)[0].replace(/^(?:const|let|var|final|mut|ref|in|out)\s+/, "").trim().split(/\s+/).at(-1) ?? ""; }
function simpleIdentifier(value: string) { return value.trim().match(/^[A-Za-z_$][\w$]*$/)?.[0] ?? ""; }

function findCall(body: string, callee: string) {
  const escaped = callee.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:([A-Za-z_$][\\w$]*)\\s*=\\s*)?(?:\\b|\\.)${escaped}\\s*\\(([^)]*)\\)`).exec(body);
  return match ? { assignee: match[1] ?? "", arguments: splitArguments(match[2]), line: body.slice(0, match.index).split(/\r?\n/).length } : null;
}

function splitArguments(value: string) {
  const result: string[] = [];
  let start = 0, depth = 0, quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) { if (char === quote && value[index - 1] !== "\\") quote = ""; continue; }
    if (`'"\``.includes(char)) quote = char;
    else if ("([{<".includes(char)) depth += 1;
    else if (")]}>".includes(char)) depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) { result.push(value.slice(start, index).trim()); start = index + 1; }
  }
  result.push(value.slice(start).trim());
  return result.filter(Boolean);
}
