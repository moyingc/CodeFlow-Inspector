import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const bundleRoot = resolve(root, "src-tauri/target/release/bundle");
const installerPattern = /\.(?:dmg|exe|deb|AppImage)$/;

function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return collect(path);
    return installerPattern.test(entry.name) && statSync(path).isFile() ? [path] : [];
  });
}

const lines = collect(bundleRoot)
  .sort()
  .map((path) => `${createHash("sha256").update(readFileSync(path)).digest("hex")}  ${relative(bundleRoot, path)}`);

if (!lines.length) throw new Error(`No release installers found in ${bundleRoot}`);
writeFileSync(resolve(bundleRoot, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
console.log(`Wrote ${lines.length} installer checksums.`);
