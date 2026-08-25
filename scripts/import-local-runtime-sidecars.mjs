import { execFileSync } from "node:child_process";
import { access, chmod, copyFile, cp, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

if (process.platform !== "darwin") {
  throw new Error("This importer currently builds the macOS arm64 package only.");
}

const root = resolve(import.meta.dirname, "..");
const target = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const packageRoot = join(root, "src-tauri", "lsp-sidecars", target);
const eplLicense = join(root, "src-tauri", "licenses", "EPL-2.0.html");

await packagePyright();
await packageJdtls();
await packageClangd();

async function packagePyright() {
  const destination = join(packageRoot, "pyright");
  await reset(destination);
  const node = await realpath(find("node"));
  const nodeRoot = resolve(node, "../..");
  const pyrightLauncher = await realpath(find("pyright-langserver"));
  const pyrightRoot = dirname(pyrightLauncher);
  await bundleMachO({
    executable: node,
    executableTarget: join(destination, "runtime/node/bin/node"),
    libraryDirectory: join(destination, "runtime/node/lib"),
    seeds: [join(nodeRoot, "lib/libnode.147.dylib")],
    licenseDirectory: join(destination, "licenses/node-dependencies"),
  });
  await cp(pyrightRoot, join(destination, "runtime/pyright"), { recursive: true });
  const launcher = join(destination, "bin/pyright-langserver");
  await writeExecutable(
    launcher,
    `#!/bin/sh\nROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"\nexec "$ROOT/runtime/node/bin/node" "$ROOT/runtime/pyright/langserver.index.js" "$@"\n`,
  );
  await copyFile(join(pyrightRoot, "LICENSE.txt"), join(destination, "licenses/PYRIGHT-LICENSE.txt"));
  await writeMetadata(destination, {
    id: "pyright",
    version: JSON.parse(await readFile(join(pyrightRoot, "package.json"), "utf8")).version,
    source: "https://github.com/microsoft/pyright",
    runtime: `Node ${commandOutput(node, ["--version"])}`,
    packageKind: "node-runtime-package",
  });
  smoke(launcher, ["--help"], "pyright portable launcher");
}

async function packageJdtls() {
  const destination = join(packageRoot, "jdtls");
  await reset(destination);
  await access(eplLicense);
  const source = "/opt/homebrew/Cellar/jdtls/1.60.0/libexec";
  const javaHome = "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home";
  await cp(source, join(destination, "runtime/jdtls"), { recursive: true });
  const jre = join(destination, "runtime/jre");
  execFileSync(join(javaHome, "bin/jlink"), [
    "--module-path", join(javaHome, "jmods"),
    "--add-modules", "java.se,jdk.unsupported,jdk.compiler,jdk.jdi,jdk.management,jdk.zipfs",
    "--strip-debug",
    "--no-header-files",
    "--no-man-pages",
    "--compress", "zip-6",
    "--output", jre,
  ], { stdio: "inherit" });
  await mkdir(join(destination, "licenses"), { recursive: true });
  await copyFile(eplLicense, join(destination, "licenses/EPL-2.0.html"));
  const launcherJar = (await readdir(join(destination, "runtime/jdtls/plugins")))
    .find((name) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(name));
  if (!launcherJar) throw new Error("JDT LS Equinox launcher was not found");
  const launcher = join(destination, "bin/jdtls");
  await writeExecutable(
    launcher,
    `#!/bin/bash\nset -e\nROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"\nDATA="$ROOT/workspace"\nJVM_ARGS=()\nPASS=()\nwhile [ "$#" -gt 0 ]; do\n  case "$1" in\n    --jvm-arg=*) JVM_ARGS+=("\${1#--jvm-arg=}") ;;\n    -data) DATA="$2"; shift ;;\n    *) PASS+=("$1") ;;\n  esac\n  shift\ndone\nexec "$ROOT/runtime/jre/bin/java" -Djdk.xml.maxGeneralEntitySizeLimit=0 -Djdk.xml.totalEntitySizeLimit=0 -Declipse.application=org.eclipse.jdt.ls.core.id1 -Dosgi.bundles.defaultStartLevel=4 -Declipse.product=org.eclipse.jdt.ls.core.product -Dosgi.checkConfiguration=true -Dosgi.sharedConfiguration.area="$ROOT/runtime/jdtls/config_mac" -Dosgi.sharedConfiguration.area.readOnly=true -Dosgi.configuration.cascaded=true -Xms256m --add-modules=ALL-SYSTEM --add-opens java.base/java.util=ALL-UNNAMED --add-opens java.base/java.lang=ALL-UNNAMED "\${JVM_ARGS[@]}" -jar "$ROOT/runtime/jdtls/plugins/${launcherJar}" -data "$DATA" "\${PASS[@]}"\n`,
  );
  await writeMetadata(destination, {
    id: "jdtls",
    version: "1.60.0",
    source: "https://github.com/eclipse-jdtls/eclipse.jdt.ls",
    runtime: `OpenJDK jlink image (${commandOutput(join(jre, "bin/java"), ["--version"]).split("\n")[0]})`,
    packageKind: "jvm-runtime-package",
  });
  smoke(join(jre, "bin/java"), ["-version"], "JDT portable JRE");
}

async function packageClangd() {
  const destination = join(packageRoot, "clangd");
  await reset(destination);
  const llvmRoot = "/opt/homebrew/Cellar/llvm/22.1.8";
  const executable = join(llvmRoot, "bin/clangd");
  await bundleMachO({
    executable,
    executableTarget: join(destination, "bin/clangd"),
    libraryDirectory: join(destination, "lib"),
    seeds: [join(llvmRoot, "lib/libclang-cpp.dylib"), join(llvmRoot, "lib/libLLVM.dylib")],
    licenseDirectory: join(destination, "licenses/dependencies"),
  });
  await mkdir(join(destination, "licenses"), { recursive: true });
  await copyFile(join(llvmRoot, "LICENSE.TXT"), join(destination, "licenses/LLVM-LICENSE.txt"));
  await writeMetadata(destination, {
    id: "clangd",
    version: "22.1.8",
    source: "https://github.com/llvm/llvm-project",
    runtime: "native Mach-O dependency closure",
    packageKind: "native-binary",
  });
  smoke(join(destination, "bin/clangd"), ["--version"], "clangd portable binary");
}

async function bundleMachO({ executable, executableTarget, libraryDirectory, seeds, licenseDirectory }) {
  const queue = [
    await realpath(executable),
    ...(await Promise.all(seeds.map((seed) => realpath(seed)))),
  ];
  const records = new Map();
  while (queue.length) {
    const path = queue.shift();
    if (records.has(path)) continue;
    const dependencies = machoDependencies(path);
    records.set(path, dependencies);
    for (const dependency of dependencies) {
      let resolved = null;
      if (dependency.startsWith("/opt/homebrew/")) {
        resolved = await realpath(dependency);
      } else if (dependency.startsWith("@loader_path/")) {
        resolved = await realpath(
          join(dirname(path), dependency.slice("@loader_path/".length)),
        ).catch(() => null);
      } else if (dependency.startsWith("@rpath/")) {
        resolved = await realpath(join(dirname(path), basename(dependency))).catch(() => null);
      }
      if (resolved && !records.has(resolved)) queue.push(resolved);
    }
  }
  await mkdir(dirname(executableTarget), { recursive: true });
  await mkdir(libraryDirectory, { recursive: true });
  await copyFile(executable, executableTarget);
  const executableReal = await realpath(executable);
  const copied = new Map([[executableReal, executableTarget]]);
  for (const source of records.keys()) {
    if (source === executableReal) continue;
    const targetPath = join(libraryDirectory, basename(source));
    await copyFile(source, targetPath);
    copied.set(source, targetPath);
  }
  for (const [source, targetPath] of copied) {
    const isExecutable = source === executableReal;
    for (const dependency of records.get(source) ?? []) {
      const dependencySource = await resolveDependencySource(dependency, records);
      if (!dependencySource || !copied.has(dependencySource)) continue;
      const replacement = isExecutable
        ? `@loader_path/../lib/${basename(dependencySource)}`
        : `@loader_path/${basename(dependencySource)}`;
      execFileSync("install_name_tool", ["-change", dependency, replacement, targetPath]);
    }
    if (!isExecutable) {
      execFileSync("install_name_tool", ["-id", `@loader_path/${basename(targetPath)}`, targetPath]);
    }
    execFileSync("codesign", ["--force", "--sign", "-", targetPath], { stdio: "ignore" });
  }
  await copyDependencyLicenses([...records.keys()], licenseDirectory);
}

async function resolveDependencySource(dependency, records) {
  if (dependency.startsWith("/opt/homebrew/")) return realpath(dependency);
  if (dependency.startsWith("@rpath/") || dependency.startsWith("@loader_path/")) {
    const name = basename(dependency);
    const versionPrefix = name.endsWith(".dylib")
      ? `${name.slice(0, -".dylib".length)}.`
      : `${name}.`;
    return [...records.keys()].find((path) => {
      const candidate = basename(path);
      return candidate === name || candidate.startsWith(versionPrefix);
    }) ?? null;
  }
  return null;
}

function machoDependencies(path) {
  return execFileSync("otool", ["-L", path], { encoding: "utf8" })
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean)
    .filter((value) => !value.startsWith("/usr/lib/") && !value.startsWith("/System/Library/"));
}

async function copyDependencyLicenses(paths, destination) {
  await mkdir(destination, { recursive: true });
  const roots = new Set();
  for (const path of paths) {
    const match = path.match(/^(\/opt\/homebrew\/Cellar\/[^/]+\/[^/]+)/);
    if (match) roots.add(match[1]);
  }
  for (const cellarRoot of roots) {
    const formula = cellarRoot.split("/").at(-2);
    const entries = await readdir(cellarRoot);
    const licenses = entries.filter((name) => /^(LICENSE|COPYING|NOTICE)/i.test(name));
    for (const name of licenses) {
      const source = join(cellarRoot, name);
      if ((await stat(source)).isFile()) {
        await copyFile(source, join(destination, `${formula}-${name}`));
      }
    }
  }
}

async function writeMetadata(destination, metadata) {
  await mkdir(join(destination, "licenses"), { recursive: true });
  await writeFile(join(destination, "VERSION"), `${metadata.version}\n`);
  await writeFile(join(destination, "ORIGIN.json"), `${JSON.stringify({
    schemaVersion: 1,
    ...metadata,
    target,
  }, null, 2)}\n`);
}

async function writeExecutable(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  await chmod(path, 0o755);
}

async function reset(path) {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
}

function smoke(command, args, label) {
  try {
    execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000 });
  } catch (error) {
    const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`.trim();
    if (!output && error.status !== 0) throw new Error(`${label} failed: ${error.message}`);
  }
  console.log(`Verified ${label}.`);
}

function find(command) {
  return execFileSync("which", [command], { encoding: "utf8" }).trim();
}

function commandOutput(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}
