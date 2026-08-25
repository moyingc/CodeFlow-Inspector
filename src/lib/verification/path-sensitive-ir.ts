import type { FunctionInfo } from "@/src/lib/analysis/types";

export type PathBasicBlock = {
  id: string;
  startLine: number;
  endLine: number;
  kind: "entry" | "branch" | "loop" | "statement" | "exit" | "exception";
  predicates: string[];
  successors: string[];
};

export type SsaAssignment = {
  variable: string;
  version: number;
  symbol: string;
  expression: string;
  line: number;
};

export type PhiAssignment = {
  blockId: string;
  variable: string;
  symbol: string;
  inputs: string[];
};

export type FunctionPathModel = {
  functionId: string;
  blocks: PathBasicBlock[];
  assignments: SsaAssignment[];
  phiAssignments: PhiAssignment[];
  normalPathPredicates: string[];
  aliases: Array<{ owner: string; alias: string; line: number }>;
  exceptionEdges: Array<{ from: string; to: string }>;
  ownershipEvents: Array<{ event: string; line: number }>;
  concurrencyEvents: Array<{ event: string; line: number }>;
  heapObjects: Array<{ id: string; owner: string; allocatedLine: number; releaseCount: number }>;
  concurrencyInterleavings: Array<{ id: string; eventA: string; eventB: string; guarded: boolean }>;
  evidence: string[];
};

export function buildFunctionPathModel(fn: FunctionInfo): FunctionPathModel {
  if (fn.astControlFlow?.nodes.length) return buildAstFunctionPathModel(fn);
  const lines = fn.body.split(/\r?\n/);
  const versions = new Map<string, number>();
  const assignments: SsaAssignment[] = [];
  const aliases: FunctionPathModel["aliases"] = [];
  const normalPathPredicates: string[] = [];
  const blocks = lines.map<PathBasicBlock>((source, index) => {
    const text = source.trim();
    const line = fn.startLine + index;
    const kind = /^(?:if|else\s+if|switch|case)\b/.test(text) ? "branch"
      : /^(?:for|while|loop)\b/.test(text) ? "loop"
        : /\b(throw|raise)\b/.test(text) ? "exception"
          : /\b(return|yield)\b/.test(text) ? "exit"
            : index === 0 ? "entry" : "statement";
    const guard = text.match(/^if\s*\(?\s*([^){:]+)\s*\)?\s*:?/i)?.[1]?.trim();
    if (guard && /\b(throw|raise)\b/.test(lines.slice(index, index + 2).join(" "))) {
      const inverted = invertSimplePredicate(guard);
      if (inverted) normalPathPredicates.push(inverted);
    }
    const assignment = text.match(/^(?:const|let|var|auto|int|long|float|double|String|[A-Za-z_]\w*\s+)?\s*([A-Za-z_$][\w$]*)\s*=\s*(?!=)(.+?);?$/);
    if (assignment) {
      const variable = assignment[1];
      const expression = assignment[2].replace(/;$/, "").trim();
      const version = (versions.get(variable) ?? 0) + 1;
      versions.set(variable, version);
      assignments.push({ variable, version, symbol: `${safe(variable)}_${version}`, expression, line });
      if (/^[A-Za-z_$][\w$]*$/.test(expression) && expression !== variable) aliases.push({ owner: expression, alias: variable, line });
    }
    return {
      id: `${fn.id}-block-${index}`,
      startLine: line,
      endLine: line,
      kind,
      predicates: guard ? [guard] : [],
      successors: [],
    };
  });
  blocks.forEach((block, index) => {
    if (!["exit", "exception"].includes(block.kind) && blocks[index + 1]) block.successors.push(blocks[index + 1].id);
    if (["branch", "loop"].includes(block.kind) && blocks[index + 2]) block.successors.push(blocks[index + 2].id);
  });
  return {
    functionId: fn.id,
    blocks,
    assignments,
    phiAssignments: [],
    normalPathPredicates: [...new Set(normalPathPredicates)],
    aliases,
    exceptionEdges: [],
    ownershipEvents: [],
    concurrencyEvents: [],
    heapObjects: [],
    concurrencyInterleavings: [],
    evidence: [
      `${blocks.length} 个基本块，${assignments.length} 个 SSA 赋值版本。`,
      `${normalPathPredicates.length} 个由异常保护反推的正常路径谓词，${aliases.length} 个直接别名。`,
    ],
  };
}

function buildAstFunctionPathModel(fn: FunctionInfo): FunctionPathModel {
  const control = fn.astControlFlow!;
  const versions = new Map<string, number>();
  const assignments: SsaAssignment[] = [];
  const aliases: FunctionPathModel["aliases"] = [];
  const ownershipEvents: FunctionPathModel["ownershipEvents"] = [];
  const concurrencyEvents: FunctionPathModel["concurrencyEvents"] = [];
  const definitionsByNode = new Map<string, string[]>();
  const heapObjects: FunctionPathModel["heapObjects"] = [];
  for (const node of control.nodes) {
    definitionsByNode.set(node.id, node.definitions);
    for (const variable of node.definitions) {
      const version = (versions.get(variable) ?? 0) + 1;
      versions.set(variable, version);
      assignments.push({ variable, version, symbol: `${safe(variable)}_${version}`, expression: node.uses.join(" ") || "ast-write", line: node.startLine });
      if (node.uses.length === 1 && node.uses[0] !== variable) aliases.push({ owner: node.uses[0], alias: variable, line: node.startLine });
    }
    node.ownershipEvents.forEach((event) => ownershipEvents.push({ event, line: node.startLine }));
    node.concurrencyEvents.forEach((event) => concurrencyEvents.push({ event, line: node.startLine }));
    if (node.definitions.length && node.ownershipEvents.some((event) => /open|acquire|new/.test(event))) {
      node.definitions.forEach((owner) => heapObjects.push({
        id: `heap_${safe(fn.id)}_${safe(owner)}_${node.startLine}`,
        owner,
        allocatedLine: node.startLine,
        releaseCount: control.nodes.filter((candidate) => candidate.uses.includes(owner) && candidate.ownershipEvents.some((event) => /close|free|release|drop|dispose/.test(event))).length,
      }));
    }
  }
  const incoming = new Map<string, string[]>();
  for (const edge of control.edges) incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  const phiAssignments: PhiAssignment[] = [];
  for (const [blockId, predecessors] of incoming) {
    if (predecessors.length < 2) continue;
    const variables = predecessors.flatMap((id) => definitionsByNode.get(id) ?? []);
    for (const variable of new Set(variables)) {
      const inputs = assignments.filter((item) => item.variable === variable).map((item) => item.symbol).slice(-predecessors.length);
      if (inputs.length < 2) continue;
      const version = (versions.get(variable) ?? 0) + 1;
      versions.set(variable, version);
      phiAssignments.push({ blockId, variable, symbol: `${safe(variable)}_${version}`, inputs });
    }
  }
  const blocks: PathBasicBlock[] = control.nodes.map((node) => ({
    id: node.id,
    startLine: node.startLine,
    endLine: node.endLine,
    kind: node.kind === "branch" ? "branch"
      : node.kind === "loop" ? "loop"
        : node.kind === "return" || node.kind === "exit" ? "exit"
          : node.kind === "throw" || node.kind === "catch" ? "exception"
            : node.kind === "entry" ? "entry" : "statement",
    predicates: [],
    successors: control.edges.filter((edge) => edge.from === node.id).map((edge) => edge.to),
  }));
  const exceptionEdges = control.edges.filter((edge) => edge.kind === "exception").map((edge) => ({ from: edge.from, to: edge.to }));
  const launchEvents = concurrencyEvents.filter((item) => /spawn|thread|promise\.all|asyncio\.gather/.test(item.event));
  const guarded = concurrencyEvents.some((item) => /mutex|lock|atomic|synchronized/.test(item.event));
  const concurrencyInterleavings = launchEvents.flatMap((left, index) => launchEvents.slice(index + 1).map((right) => ({
    id: `schedule_${safe(fn.id)}_${index}`,
    eventA: `${left.event}@${left.line}`,
    eventB: `${right.event}@${right.line}`,
    guarded,
  })));
  return {
    functionId: fn.id,
    blocks,
    assignments,
    phiAssignments,
    normalPathPredicates: [],
    aliases,
    exceptionEdges,
    ownershipEvents,
    concurrencyEvents,
    heapObjects,
    concurrencyInterleavings,
    evidence: [
      `Tree-sitter AST CFG：${blocks.length} 个节点、${control.edges.length} 条边、${exceptionEdges.length} 条异常边。`,
      `SSA ${assignments.length} 个版本、phi ${phiAssignments.length} 个、直接别名 ${aliases.length} 个。`,
      `所有权事件 ${ownershipEvents.length} 个、堆对象 ${heapObjects.length} 个、并发事件 ${concurrencyEvents.length} 个、有界交错 ${concurrencyInterleavings.length} 个。`,
    ],
  };
}

export function buildPathSensitiveModels(functions: FunctionInfo[]) {
  return functions.map(buildFunctionPathModel);
}

function invertSimplePredicate(value: string) {
  const match = value.match(/^([A-Za-z_$][\w$]*)\s*(<=|>=|<|>|==|!=)\s*(-?\d+(?:\.\d+)?|null|None|nil)$/);
  if (!match) return null;
  const inverse = ({ "<": ">=", "<=": ">", ">": "<=", ">=": "<", "==": "!=", "!=": "==" } as Record<string, string>)[match[2]];
  return `${match[1]} ${inverse} ${match[3]}`;
}

function safe(value: string) { return value.replace(/[^a-zA-Z0-9_]/g, "_"); }
