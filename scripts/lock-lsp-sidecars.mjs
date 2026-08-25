import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, chmod, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const target = process.env.CODEFLOW_TARGET_TRIPLE || hostTarget();
const packageRoot = resolve(
  process.env.CODEFLOW_LSP_PACKAGE_ROOT ||
    join(projectRoot, "src-tauri", "lsp-sidecars", target),
);
const manifest = JSON.parse(
  await readFile(join(projectRoot, "src-tauri", "lsp-sidecars", "manifest.json"), "utf8"),
);
const versions = {};
const files = {};
const missing = [];
const lockedTools = [];

for (const tool of manifest.tools) {
  if (tool.versionPolicy !== "build-lock") continue;
  const executable = join(
    packageRoot,
    tool.id,
    "bin",
    `${tool.command}${process.platform === "win32" ? ".exe" : ""}`,
  );
  try {
    await access(executable);
  } catch {
    missing.push(relative(projectRoot, executable));
    continue;
  }
  const versionFile = join(packageRoot, tool.id, "VERSION");
  try {
    versions[tool.id] = (await readFile(versionFile, "utf8")).trim();
  } catch {
    missing.push(relative(projectRoot, versionFile));
  }
  const targetExecutable = targetExecutablePath(executable, target);
  await unlink(targetExecutable).catch(() => {});
  if (process.platform !== "win32") await chmod(executable, 0o755);
  lockedTools.push(tool.id);
}

if (missing.length && process.env.CODEFLOW_SIDECAR_ALLOW_PARTIAL !== "1") {
  console.error("LSP sidecar package is incomplete:");
  missing.forEach((item) => console.error(`- ${item}`));
  console.error(
    "Provide complete portable packages through CODEFLOW_LSP_PACKAGE_ROOT; system Homebrew wrappers are not accepted as release sidecars.",
  );
  process.exitCode = 1;
} else {
  for (const path of await walk(packageRoot)) {
    if (path.endsWith("checksums.json")) continue;
    files[relative(packageRoot, path).replaceAll("\\", "/")] = await sha256(path);
  }
  const lock = {
    schemaVersion: 1,
    target,
    generatedAt: Date.now(),
    versions,
    files,
  };
  await writeFile(
    join(packageRoot, "checksums.json"),
    `${JSON.stringify(lock, null, 2)}\n`,
  );
  await writeFile(
    join(projectRoot, "src-tauri", "tauri.sidecars.generated.json"),
    `${JSON.stringify(
      {
        bundle: {
          resources: {
            [relative(join(projectRoot, "src-tauri"), packageRoot).replaceAll("\\", "/")]:
              `lsp-sidecars/${target}`,
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `Locked ${Object.keys(files).length} files for ${Object.keys(versions).length} LSP sidecars (${target}): ${lockedTools.join(", ") || "none"}.`,
  );
  if (missing.length) {
    console.log(`Partial package: ${missing.length} tools remain system/managed fallbacks.`);
  }
}

function hostTarget() {
  return execFileSync("rustc", ["--print", "host-tuple"], {
    encoding: "utf8",
  }).trim();
}

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
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

function targetExecutablePath(executable, triple) {
  if (process.platform === "win32" && executable.endsWith(".exe")) {
    return `${executable.slice(0, -4)}-${triple}.exe`;
  }
  return `${executable}-${triple}`;
}
