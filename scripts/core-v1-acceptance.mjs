import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "docs/core-v1-acceptance-manifest.json"), "utf8"));
const runCommands = process.argv.includes("--run");
const gates = manifest.gates.map((gate) => {
  const missingFiles = gate.files.filter((file) => !existsSync(resolve(root, file)));
  const content = gate.files.filter((file) => existsSync(resolve(root, file))).map((file) => readFileSync(resolve(root, file), "utf8")).join("\n");
  const missingMarkers = (gate.markers ?? []).filter((marker) => !content.includes(marker));
  return { ...gate, status: missingFiles.length || missingMarkers.length ? "failed" : "passed", missingFiles, missingMarkers };
});

const commands = runCommands ? [
  ["lint", "npx", ["eslint", ".", "--ignore-pattern", "dist", "--ignore-pattern", ".next", "--ignore-pattern", "src-tauri/target", "--ignore-pattern", "src-tauri/lsp-sidecars", "--max-warnings", "0"]],
  ["build", "npm", ["run", "build"]],
  ["node-tests", "node", ["--test", ...readdirSync(resolve(root, "tests")).filter((name) => name.endsWith(".test.mjs")).map((name) => `tests/${name}`)]],
  ["cargo-check", "cargo", ["check"], false, "src-tauri"],
  // Desktop sidecars are intentionally serialized: parallel LSP/DAP startup can
  // exhaust compiler services and turn host load into false protocol failures.
  ["cargo-tests", "cargo", ["test", "--lib", "--", "--test-threads=1"], false, "src-tauri"],
].map(([id, command, args, shell = false, cwd = "."]) => {
  const outcome = spawnSync(command, args, { cwd: resolve(root, cwd), encoding: "utf8", shell, timeout: 20 * 60_000, maxBuffer: 32 * 1024 * 1024 });
  return { id, status: outcome.status === 0 ? "passed" : "failed", exitCode: outcome.status, outputTail: `${outcome.stdout ?? ""}\n${outcome.stderr ?? ""}`.trim().split(/\r?\n/).slice(-20) };
}) : [];

const implementationScore = Math.round(gates.filter((gate) => gate.status === "passed").reduce((sum, gate) => sum + gate.weight, 0));
const commandPass = runCommands && commands.every((item) => item.status === "passed");
const report = {
  manifestId: manifest.id,
  generatedAt: Date.now(),
  scope: manifest.scope,
  implementationScore,
  implementationStatus: implementationScore < 100 ? "incomplete" : commandPass ? "certified" : "structure-ready",
  engineeringMaturityStatus: commandPass ? "certified" : "not-certified",
  longitudinalMaturityStatus: "requires-real-project-history",
  excludes: manifest.excludes,
  gates,
  commands,
  remaining: [
    ...gates.filter((gate) => gate.status !== "passed").map((gate) => ({ id: gate.id, kind: "implementation-gate", missingFiles: gate.missingFiles, missingMarkers: gate.missingMarkers })),
    ...commands.filter((command) => command.status !== "passed").map((command) => ({ id: command.id, kind: "verification-command", exitCode: command.exitCode, outputTail: command.outputTail })),
  ],
};
const output = resolve(root, "build/core-v1-acceptance-latest.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (runCommands ? report.implementationStatus !== "certified" : implementationScore !== 100) process.exitCode = 1;
