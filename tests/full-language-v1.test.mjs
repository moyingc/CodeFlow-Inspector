import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("full-language v1 reports AST control facts and per-language truth", async () => {
  const [nativeCore, astClient, compilerClient, lspClient, page, tauriConfig] = await Promise.all([
    readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/parser/native-ast-parser.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/parser/native-typescript-compiler.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/parser/native-lsp-parser.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  ]);

  assert.match(nativeCore, /AstLanguageCoverage/);
  assert.match(nativeCore, /collect_ast_control_metrics/);
  assert.match(nativeCore, /branch_count/);
  assert.match(nativeCore, /loop_count/);
  assert.match(nativeCore, /return_count/);
  assert.match(nativeCore, /write_count/);
  assert.match(nativeCore, /native_ast_parser_extracts_functions_for_every_bundled_language/);
  assert.match(nativeCore, /native_ast_parser_uses_control_nodes_for_complexity/);
  assert.match(nativeCore, /codeflow_parse_typescript_compiler/);
  assert.match(nativeCore, /controlled_typescript_compiler_returns_real_type_facts/);
  assert.match(astClient, /languageCoverage/);
  assert.match(astClient, /complexity: fact\.complexity/);
  assert.match(compilerClient, /mergeNativeTypeScriptCompilerReport/);
  assert.match(compilerClient, /compiler-backed type and symbol fact/);
  assert.match(lspClient, /semanticStatus/);
  assert.match(lspClient, /TypeScript Compiler API/);
  assert.match(page, /parseWorkspaceWithNativeTypeScriptCompiler/);
  assert.match(page, /全语言解析验收/);
  assert.match(page, /不用总分掩盖/);
  assert.match(tauriConfig, /node-typescript-worker\.mjs/);
  assert.match(tauriConfig, /node_modules\/typescript/);
});
