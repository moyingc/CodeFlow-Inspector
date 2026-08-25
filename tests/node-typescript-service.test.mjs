import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTypeScriptProject } from "../src/lib/parser/node-typescript-service.mjs";

test("node TypeScript service extracts compiler-backed function facts", async () => {
  const report = await analyzeTypeScriptProject([
    {
      id: "virtual-controller",
      name: "src/controller.ts",
      language: "TypeScript",
      content: `
type SourceFile = { path: string; content: string };
type AnalysisReport = { total: number; label: string };

export function analyzeProject(files: SourceFile[]): AnalysisReport {
  const parsed = parseFiles(files);
  return renderReport(parsed);
}

function parseFiles(files: SourceFile[]): string[] {
  return files.map((file) => file.path);
}

const renderReport = (paths: string[]): AnalysisReport => {
  return { total: paths.length, label: String(paths.length) };
};

class RuntimeProbe {
  run(input: string): number {
    return input.length;
  }

  get ready(): boolean {
    return true;
  }
}
`,
    },
  ]);

  const names = report.functions.map((fn) => fn.name);
  assert.equal(report.adapterName, "NodeTypeScriptServiceAdapter");
  assert.equal(report.mode, "Compiler API");
  assert.match(report.evidence.join(" / "), /typescript loaded in Node-only adapter/);
  assert.ok(names.includes("analyzeProject"));
  assert.ok(names.includes("parseFiles"));
  assert.ok(names.includes("renderReport"));
  assert.ok(names.includes("RuntimeProbe.run"));
  assert.ok(names.includes("RuntimeProbe.ready"));

  const analyze = report.functions.find((fn) => fn.name === "analyzeProject");
  assert.equal(analyze?.returnType, "AnalysisReport");
  assert.deepEqual(analyze?.params, ["files: SourceFile[]"]);
  assert.ok(report.edges.some((edge) => /analyzeProject\(\) calls parseFiles\(\)/.test(edge.evidence)));
  assert.ok(report.edges.some((edge) => /analyzeProject\(\) calls renderReport\(\)/.test(edge.evidence)));
});
