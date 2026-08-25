import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTypeScriptProjectViaNode } from "../src/lib/parser/node-parser-bridge.mjs";

test("node parser bridge runs TypeScript compiler service out of process", async () => {
  const report = await analyzeTypeScriptProjectViaNode(
    [
      {
        id: "virtual-bridge",
        name: "src/bridge.ts",
        language: "TypeScript",
        content: `
export function controller(input: string): number {
  return calculate(input);
}

function calculate(value: string): number {
  return value.length;
}
`,
      },
    ],
    { timeoutMs: 8000 },
  );

  assert.equal(report.bridgeName, "NodeParserBridge");
  assert.equal(report.transport, "child_process");
  assert.equal(report.adapterName, "NodeTypeScriptServiceAdapter");
  assert.ok(report.functions.some((fn) => fn.name === "controller" && fn.returnType === "number"));
  assert.ok(report.functions.some((fn) => fn.name === "calculate" && fn.params[0] === "value: string"));
  assert.ok(report.edges.some((edge) => /controller\(\) calls calculate\(\)/.test(edge.evidence)));
});
