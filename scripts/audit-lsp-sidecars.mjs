import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  await readFile(resolve(root, "src-tauri/lsp-sidecars/manifest.json"), "utf8"),
);
let available = 0;

for (const tool of manifest.tools) {
  const path = find(tool.command);
  const state = path ? "system" : "missing";
  if (path) available += 1;
  console.log(`${tool.id.padEnd(14)} ${state.padEnd(8)} ${path || ""}`);
}

console.log(`\n${available}/${manifest.tools.length} system language servers available.`);
console.log(
  "System availability proves local execution only. Release verification still requires a portable package and checksums.json.",
);

function find(command) {
  try {
    const resolver = process.platform === "win32" ? "where" : "which";
    const value = execFileSync(resolver, [command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .find(Boolean);
    if (!value) return "";
    access(value);
    return value;
  } catch {
    return "";
  }
}
