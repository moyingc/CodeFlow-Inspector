import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = process.env.CODEFLOW_TARGET_TRIPLE || execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const packageRoot = join(root, "src-tauri", "debug-sidecars", target);
const files = {};

for (const path of await walk(packageRoot)) {
  if (path.endsWith("checksums.json")) continue;
  files[relative(packageRoot, path).replaceAll("\\", "/")] = await sha256(path);
}

const lock = {
  schemaVersion: 1,
  target,
  generatedAt: Date.now(),
  files,
};
await writeFile(join(packageRoot, "checksums.json"), `${JSON.stringify(lock, null, 2)}\n`);
const manifestPath = join(root, "src-tauri", "debug-sidecars", "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
for (const profile of manifest.profiles) {
  const prefix = `${profile.id}/`;
  const packageFiles = Object.entries(files).filter(([path]) => path.startsWith(prefix));
  profile.package.checksums[target] = createHash("sha256")
    .update(packageFiles.map(([path, hash]) => `${path}\0${hash}`).join("\n"))
    .digest("hex");
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Locked ${Object.keys(files).length} files for debug sidecars (${target}).`);

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(path)));
    else if (entry.isFile() && (await stat(path)).size >= 0) output.push(path);
  }
  return output.sort();
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
