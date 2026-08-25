import assert from "node:assert/strict";
import test from "node:test";

import { buildCompleteSoftwareInterpretation } from "../src/lib/explanation/software-explanation.ts";

function fn(overrides) {
  return {
    id: overrides.name,
    name: overrides.name,
    fileId: overrides.fileId,
    fileName: overrides.fileName,
    language: overrides.language,
    startLine: 1,
    endLine: 8,
    params: [],
    returnType: "unknown",
    outputs: [],
    calls: [],
    summary: "",
    dataShape: "unknown",
    complexity: 1,
    category: "业务",
    body: "",
    sideEffects: [],
    externalInputs: [],
    validations: [],
    risks: [],
    source: "Parser Fact",
    confidence: 92,
    parser: "Tree-sitter AST",
    parseEvidence: ["AST function boundary", "LSP signature"],
    ...overrides,
  };
}

function analysisFor(files, functions, edges) {
  const incoming = new Map();
  const outgoing = new Map();
  edges.forEach((edge) => {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
  });
  return {
    mainFile: files[0] ?? null,
    entryFunction: functions[0] ?? null,
    flowEdges: edges.map((edge, index) => ({ id: `flow-${index}`, from: edge.from, to: edge.to, kind: "水路", status: "Closed", volume: 50, confidence: 90, evidence: edge.evidence, evidenceGrade: "ast" })),
    issues: [],
    closureScore: 90,
    damScore: 88,
    environmentScore: 86,
    knowledgeRuleReport: { matches: [] },
    hydrologyModel: {
      entryName: functions[0]?.name ?? "unknown",
      outputNames: functions.filter((item) => !outgoing.has(item.id)).map((item) => item.name),
      stageCount: functions.length,
      confluenceCount: 0,
      storageCount: 0,
      riskCount: 0,
      summary: "fixture",
      analogy: [],
      confluences: [],
      stages: functions.map((item, index) => ({
        id: `stage-${item.id}`, functionId: item.id, functionName: item.name, fileName: item.fileName, line: item.startLine,
        index, codeRole: index === 0 ? "主控入口" : outgoing.has(item.id) ? "转换处理" : "结果输出",
        waterRole: index === 0 ? "源头" : outgoing.has(item.id) ? "主河道" : "出水口", capacity: "河道",
        dataIn: item.params, dataOut: item.outputs, upstreamCount: incoming.get(item.id) ?? 0, downstreamCount: outgoing.get(item.id) ?? 0,
        confidence: item.confidence, riskLevel: "none", evidence: "fixture stage",
      })),
    },
  };
}

test("explanation v1 structurally covers every file and function", () => {
  const files = [
    { id: "api", name: "backend/api.py", language: "Python", content: "", imports: ["fastapi"] },
    { id: "db", name: "backend/repository.py", language: "Python", content: "", imports: ["sqlalchemy"] },
    { id: "config", name: "requirements.txt", language: "Text", content: "fastapi" },
  ];
  const functions = [
    fn({ name: "create_order", fileId: "api", fileName: "backend/api.py", language: "Python", params: ["payload: OrderInput"], returnType: "Order", outputs: ["order"], calls: ["save_order"], body: "def create_order(payload):\n validate(payload)\n return save_order(payload)", validations: ["validate payload"], externalInputs: ["HTTP request"] }),
    fn({ name: "save_order", fileId: "db", fileName: "backend/repository.py", language: "Python", params: ["order: Order"], returnType: "Order", outputs: ["order"], body: "def save_order(order):\n db.add(order)\n db.commit()\n return order", sideEffects: ["database write"] }),
  ];
  const edges = [{ from: "create_order", to: "save_order", kind: "call", confidence: 94, evidence: "LSP reference" }];
  const report = buildCompleteSoftwareInterpretation(files, functions, edges, analysisFor(files, functions, edges));
  assert.equal(report.coverage.status, "v1 完整");
  assert.equal(report.coverage.score, 100);
  assert.equal(report.coverage.fileCoverage, 100);
  assert.equal(report.coverage.functionCoverage, 100);
  assert.equal(report.coverage.moduleCoverage, 100);
  assert.equal(report.files.length, 3);
  assert.equal(report.modules.flatMap((module) => module.functions).length, 2);
  assert.match(report.modules.flatMap((module) => module.functions).find((item) => item.name === "save_order").algorithm, /事务/);
});

test("explanation v1 identifies numerical, collection and control strategies", () => {
  const files = [{ id: "math", name: "src/ranker.cpp", language: "C++", content: "" }];
  const functions = [
    fn({ name: "rank_candidates", fileId: "math", fileName: "src/ranker.cpp", language: "C++", params: ["std::vector<Candidate> items"], returnType: "std::vector<Candidate>", outputs: ["items"], body: "for (auto &item : items) { item.score = compute_score(item); } std::sort(items.begin(), items.end()); return items;", calls: ["compute_score"], complexity: 3 }),
    fn({ name: "compute_score", fileId: "math", fileName: "src/ranker.cpp", language: "C++", params: ["Candidate item"], returnType: "double", outputs: ["score"], body: "return item.quality * 0.7 - item.cost * 0.3;" }),
  ];
  const edges = [{ from: "rank_candidates", to: "compute_score", kind: "call", confidence: 95, evidence: "clangd reference" }];
  const report = buildCompleteSoftwareInterpretation(files, functions, edges, analysisFor(files, functions, edges));
  const ranking = report.modules.flatMap((module) => module.functions).find((item) => item.name === "rank_candidates");
  assert.match(ranking.algorithm, /排序/);
  assert.ok(ranking.dataStructures.some((item) => item.includes("Array/List/Vec/Slice")));
  assert.match(ranking.processing, /遍历/);
});

test("explanation v1 preserves uncertainty instead of inventing behavior", () => {
  const files = [{ id: "native", name: "src/native.rs", language: "Rust", content: "" }];
  const functions = [fn({ name: "x", fileId: "native", fileName: "src/native.rs", language: "Rust", returnType: "unknown", body: "fn x() { opaque!(); }", source: "Heuristic", confidence: 48, parser: "FallbackScanner", parseEvidence: [] })];
  const report = buildCompleteSoftwareInterpretation(files, functions, [], analysisFor(files, functions, []));
  const explanation = report.modules[0].functions[0];
  assert.equal(explanation.certainty, "候选解释");
  assert.match(explanation.uncertainty, /返回类型未由类型系统确认/);
  assert.match(report.overview, /不把推断写成事实/);
});
