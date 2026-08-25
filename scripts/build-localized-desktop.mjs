import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const locale = process.argv[2] === "en-US" ? "en-US" : "zh-CN";
const root = resolve(import.meta.dirname, "..");
const tauriRoot = resolve(root, "src-tauri");
const generatedConfigPath = resolve(tauriRoot, "tauri.sidecars.generated.json");
const localeConfigPath = resolve(tauriRoot, `tauri.${locale}.generated.json`);
const bundleRoot = resolve(tauriRoot, "target/release/bundle");
const targetTriple = process.env.CODEFLOW_RELEASE_TARGET ?? {
  darwin: process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin",
  win32: process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc",
  linux: process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu",
}[process.platform];

if (!targetTriple) throw new Error(`Unsupported release platform: ${process.platform}/${process.arch}`);

function run(command, args, env = process.env, attempts = 1) {
  let result;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
    if (result.status === 0) return;
    if (attempt < attempts) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  }
  process.exit(result?.status ?? 1);
}

run("npm", ["run", "desktop:lock-sidecars:partial"]);

const sidecarConfig = JSON.parse(readFileSync(generatedConfigPath, "utf8"));
const english = locale === "en-US";
const productName = english ? "CodeFlow Inspector EN" : "CodeFlow Inspector 中文版";
const platformResources = {};
for (const family of ["lsp-sidecars", "debug-sidecars"]) {
  const relativePath = `${family}/${targetTriple}`;
  if (existsSync(resolve(tauriRoot, relativePath))) platformResources[relativePath] = relativePath;
}
const localizedConfig = {
  ...sidecarConfig,
  bundle: {
    ...(sidecarConfig.bundle ?? {}),
    resources: {
      ...(sidecarConfig.bundle?.resources ?? {}),
      ...platformResources,
    },
  },
  productName,
  identifier: english ? "local.codeflow.inspector.en" : "local.codeflow.inspector.zh",
  build: {
    beforeBuildCommand: "npm run desktop:web:build",
    frontendDist: "../dist-desktop",
  },
  app: {
    windows: [{
      label: "main",
      title: english ? "CodeFlow Inspector" : "CodeFlow Inspector 中文版",
      width: 1440,
      height: 960,
      minWidth: 1120,
      minHeight: 760,
      resizable: true,
    }],
  },
};

writeFileSync(localeConfigPath, `${JSON.stringify(localizedConfig, null, 2)}\n`);
if (process.platform !== "win32") {
  // Tauri refreshes existing bundles in place. Vendor archives can preserve
  // read-only bits, so normalize only local build copies before packaging.
  run("chmod", ["-R", "u+w", resolve(tauriRoot, "lsp-sidecars"), resolve(tauriRoot, "debug-sidecars"), resolve(tauriRoot, "target/release")]);
}
const bundles = process.platform === "darwin" ? "app" : process.platform === "win32" ? "nsis" : "deb,appimage";
run(
  resolve(root, "node_modules/.bin/tauri"),
  ["build", "--bundles", bundles, "--config", localeConfigPath],
  { ...process.env, NEXT_PUBLIC_CODEFLOW_LOCALE: locale, VITE_CODEFLOW_LOCALE: locale },
);

if (process.platform === "darwin") {
  const dmgRoot = resolve(bundleRoot, "dmg");
  const appPath = resolve(bundleRoot, "macos", `${productName}.app`);
  const architecture = targetTriple.startsWith("aarch64") ? "aarch64" : "x64";
  const dmgPath = resolve(dmgRoot, `${productName}_0.1.0_${architecture}.dmg`);
  const stagedDmgPath = resolve(tmpdir(), `${productName}_${process.pid}.partial.dmg`);
  mkdirSync(dmgRoot, { recursive: true });
  run("codesign", ["--force", "--deep", "--sign", "-", "--identifier", localizedConfig.identifier, appPath]);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  run("hdiutil", ["create", "-volname", productName, "-srcfolder", appPath, "-format", "UDZO", stagedDmgPath], process.env, 3);
  renameSync(stagedDmgPath, dmgPath);
}
