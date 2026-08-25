import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { extractProjectDependencies } from "../src/lib/security/dependency-knowledge-matcher.ts";

const root = new URL("../", import.meta.url);

test("dependency extraction distinguishes manifest ranges from exact versions", () => {
  const files = [
    { id: "npm", name: "package.json", language: "JSON", content: JSON.stringify({ dependencies: { next: "^16.2.12" } }) },
    { id: "python", name: "requirements.txt", language: "Text", content: "fastapi==0.116.0\n" },
    { id: "rust", name: "Cargo.toml", language: "TOML", content: "[dependencies]\nserde = \"1.0.219\"\n" },
    { id: "go", name: "go.mod", language: "Go", content: "require example.org/lib v1.2.3\n" },
    { id: "java", name: "pom.xml", language: "XML", content: "<dependency><groupId>org.demo</groupId><artifactId>core</artifactId><version>2.1.0</version></dependency>" },
  ];
  const dependencies = extractProjectDependencies(files);
  assert.deepEqual(dependencies.map((item) => `${item.ecosystem}:${item.name}:${item.version}`), [
    "npm:next:^16.2.12",
    "PyPI:fastapi:0.116.0",
    "crates.io:serde:1.0.219",
    "Go:example.org/lib:1.2.3",
    "Maven:org.demo:core:2.1.0",
  ]);
  assert.equal(dependencies.find((item) => item.name === "next")?.exact, false);
  assert.equal(dependencies.find((item) => item.name === "fastapi")?.exact, true);
});

test("lockfiles override manifest ranges with exact installed versions", () => {
  const files = [
    { id: "manifest", name: "package.json", language: "JSON", content: JSON.stringify({ dependencies: { next: "^16.2.0" } }) },
    { id: "npm-lock", name: "package-lock.json", language: "JSON", content: JSON.stringify({ packages: { "node_modules/next": { version: "16.2.12" } } }) },
    { id: "poetry", name: "poetry.lock", language: "TOML", content: '[[package]]\nname = "fastapi"\nversion = "0.116.0"\n' },
    { id: "cargo", name: "Cargo.lock", language: "TOML", content: '[[package]]\nname = "serde"\nversion = "1.0.219"\n' },
    { id: "go", name: "go.sum", language: "Text", content: "example.org/lib v1.2.3 h1:abc\n" },
    { id: "gradle", name: "gradle.lockfile", language: "Text", content: "org.demo:core:2.1.0=runtimeClasspath\n" },
  ];
  const dependencies = extractProjectDependencies(files);
  assert.deepEqual(dependencies.map((item) => `${item.ecosystem}:${item.name}:${item.version}:${item.resolution}`), [
    "npm:next:16.2.12:lockfile",
    "PyPI:fastapi:0.116.0:lockfile",
    "crates.io:serde:1.0.219:lockfile",
    "Go:example.org/lib:1.2.3:lockfile",
    "Maven:org.demo:core:2.1.0:lockfile",
  ]);
  assert.ok(dependencies.every((item) => item.exact));
});

test("desktop local defense is default-deny and fail-closed", async () => {
  const [policy, importer, runtime, lsp, config, page] = await Promise.all([
    readFile(new URL("src-tauri/src/network_policy.rs", root), "utf8"),
    readFile(new URL("src-tauri/src/knowledge_pack.rs", root), "utf8"),
    readFile(new URL("src-tauri/src/lib.rs", root), "utf8"),
    readFile(new URL("src-tauri/src/lsp.rs", root), "utf8"),
    readFile(new URL("src-tauri/tauri.conf.json", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
  ]);
  assert.match(policy, /AtomicBool::new\(false\)/);
  assert.match(policy, /ALLOWED_KNOWLEDGE_HOSTS/);
  assert.match(policy, /network_policy_events_no_delete/);
  assert.match(importer, /redirect\(reqwest::redirect::Policy::none\(\)\)/);
  assert.match(importer, /read_bounded_response/);
  assert.match(importer, /verify_pack_integrity\(conn, app, pack_id\)/);
  assert.match(importer, /lower\(ecosystem\) = lower\(\?3\)/);
  assert.match(runtime, /local defense refused to execute project code/);
  assert.match(runtime, /\.env_clear\(\)/);
  assert.match(runtime, /controlled_runtime_path/);
  assert.match(runtime, /Temporary project copy was destroyed/);
  assert.match(runtime, /output-flooding/);
  assert.doesNotMatch(runtime, /\(allow file-read\*\)\n/);
  assert.match(lsp, /deny network\*/);
  assert.match(policy, /private_network_allowed: true/);
  assert.match(policy, /bridging_allowed: false/);
  assert.match(policy, /require_private_endpoint/);
  assert.match(runtime, /codeflow_validate_private_endpoint/);
  assert.match(config, /connect-src 'none'/);
  assert.match(page, /官方知识更新公网授权/);
});
