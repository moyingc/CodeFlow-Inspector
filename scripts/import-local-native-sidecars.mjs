import { execFileSync } from "node:child_process";
import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const destination = join(root, "src-tauri", "lsp-sidecars", target);

const packages = [
  {
    id: "gopls",
    command: find("gopls"),
    version: commandOutput("gopls", ["version"]).split(/\s+/).at(-1) || "unknown",
    licenses: ["/opt/homebrew/Cellar/gopls/0.23.0/LICENSE"],
    origin: "https://go.googlesource.com/tools",
  },
  {
    id: "rust-analyzer",
    command: find("rust-analyzer"),
    version: commandOutput("rust-analyzer", ["--version"]).replace(/^rust-analyzer\s+/, "").trim(),
    licenses: [
      "/opt/homebrew/Cellar/rust-analyzer/2026-07-27/LICENSE-APACHE",
      "/opt/homebrew/Cellar/rust-analyzer/2026-07-27/LICENSE-MIT",
    ],
    origin: "https://github.com/rust-lang/rust-analyzer",
  },
];

for (const item of packages) {
  if (!item.command) throw new Error(`${item.id} is not installed`);
  assertPortableMacBinary(item.command);
  const packageRoot = join(destination, item.id);
  const executable = join(packageRoot, "bin", item.id);
  await mkdir(dirname(executable), { recursive: true });
  await mkdir(join(packageRoot, "licenses"), { recursive: true });
  await copyFile(item.command, executable);
  for (const license of item.licenses) {
    await access(license);
    await copyFile(license, join(packageRoot, "licenses", basename(license)));
  }
  await writeFile(join(packageRoot, "VERSION"), `${item.version}\n`);
  await writeFile(
    join(packageRoot, "ORIGIN.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      id: item.id,
      version: item.version,
      source: item.origin,
      importedFrom: item.command,
      target,
      packageKind: "native-binary",
    }, null, 2)}\n`,
  );
  console.log(`Prepared ${item.id} ${item.version} for ${target}.`);
}

function find(command) {
  try {
    return execFileSync("which", [command], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function commandOutput(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function assertPortableMacBinary(path) {
  if (process.platform !== "darwin") return;
  const output = execFileSync("otool", ["-L", path], { encoding: "utf8" });
  const unsafe = output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean)
    .filter((dependency) =>
      !dependency.startsWith("/usr/lib/") &&
      !dependency.startsWith("/System/Library/") &&
      !dependency.startsWith("@loader_path/") &&
      !dependency.startsWith("@executable_path/"),
    );
  if (unsafe.length) {
    throw new Error(`${path} is not portable; external libraries: ${unsafe.join(", ")}`);
  }
}
