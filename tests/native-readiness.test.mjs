import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("native desktop readiness keeps current CodeFlow pillars intact", async () => {
  const [packageJson, page, projectStore, opfsSqliteStore, nativeSqliteWriter, controlledRuntime, digitalTwin, dbSchema, workspaceMigration, digitalTwinMigration, runtimeMigration, tauriConfig, tauriCargo, tauriLib] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("src/lib/workspace/project-store.ts", root), "utf8"),
    readFile(new URL("src/lib/persistence/deepweb-opfs-sqlite-store.ts", root), "utf8"),
    readFile(new URL("src/lib/persistence/native-sqlite-writer.ts", root), "utf8"),
    readFile(new URL("src/lib/runtime/controlled-runtime.ts", root), "utf8"),
    readFile(new URL("src/lib/twin/program-digital-twin.ts", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("drizzle/0019_misty_jackpot.sql", root), "utf8"),
    readFile(new URL("drizzle/0020_square_corsair.sql", root), "utf8"),
    readFile(new URL("drizzle/0021_huge_morbius.sql", root), "utf8"),
    readFile(new URL("src-tauri/tauri.conf.json", root), "utf8"),
    readFile(new URL("src-tauri/Cargo.toml", root), "utf8"),
    readFile(new URL("src-tauri/src/lib.rs", root), "utf8"),
  ]);
  const scripts = JSON.parse(packageJson).scripts;

  assert.equal(
    scripts["verify:integrity"],
    "npm run docs:check-bilingual && npm run lint && npm test",
  );
  assert.equal(scripts["docs:check-bilingual"], "node scripts/check-bilingual-docs.mjs");
  assert.equal(scripts["desktop:dev"], "tauri dev");
  assert.equal(scripts["desktop:build"], "tauri build");
  assert.match(packageJson, /"sql\.js"/);
  assert.match(packageJson, /"@tauri-apps\/cli"/);

  [
    /parseWorkspace/,
    /analyzeWorkspace/,
    /WaterCanalDiagram/,
    /workspacePages/,
    /projectBreakpoints/,
    /buildSoftwareInterpretation/,
    /buildSoftwareDesignReport/,
    /buildWaterDeepWebBindings/,
    /syncDeepWebSqliteJournal/,
    /syncDeepWebIndexedDbJournal/,
    /syncDeepWebOpfsSqliteDatabase/,
    /exportDeepWebOpfsSqliteDatabase/,
    /clearDeepWebOpfsSqliteDatabase/,
    /syncNativeSqliteWriters/,
    /buildNativeCodeIndexSqliteRows/,
    /clearNativeSqliteDatabase/,
    /nativeSqliteReport/,
    /DeepWeb 神经数据库/,
    /SQLite-ready 本地同步/,
    /sql\.js\/OPFS SQLite 查询库/,
    /Native SQLite 桌面写入器/,
    /IndexedDB 持久化引擎/,
    /本地程序数据库/,
    /native SQLite/,
    /Program Digital Twin/,
    /孪生实验/,
    /沙箱候选与模拟结果/,
    /Tauri 受控运行器/,
    /执行当前项目/,
    /真实执行/,
    /诊断证据完整度/,
  ].forEach((pattern) => assert.match(page, pattern));
  assert.match(tauriLib, /codeflow_save_report_pdf/);

  [
    /WORKSPACE_PROJECT_DB_NAME/,
    /WORKSPACE_PROJECT_METADATA_STORE/,
    /WORKSPACE_PROJECT_FILE_STORE/,
    /WORKSPACE_PROJECT_STATE_STORE/,
    /WORKSPACE_PROJECT_EVENT_STORE/,
    /WORKSPACE_PROJECT_ENGINE_STORE/,
    /loadWorkspaceProjectStore/,
    /saveWorkspaceProjectStore/,
    /buildWorkspaceProjectSqliteRows/,
    /Local program project database/,
    /legacyBrowserStorage/,
  ].forEach((pattern) => assert.match(projectStore, pattern));

  [
    /DEEPWEB_OPFS_SQLITE_DB_FILE/,
    /DEEPWEB_SQLITE_TABLE_COUNT/,
    /loadSqlJs/,
    /initializeDeepWebSchema/,
    /queryPreviewSql/,
    /navigator/,
    /getDirectory/,
    /sql\.js OPFS SQLite/,
    /sql\.js IndexedDB SQLite file/,
    /application\/vnd\.sqlite3|SQLite/,
    /CREATE TABLE IF NOT EXISTS deepweb_replay_memory_snapshots/,
    /deepweb_local_sqlite_journal/,
    /deepweb_local_storage_engines/,
  ].forEach((pattern) => assert.match(opfsSqliteStore, pattern));

  [
    /NATIVE_SQLITE_DB_FILE/,
    /codeflow\.sqlite3/,
    /Tauri native SQLite/,
    /buildNativeCodeIndexSqliteRows/,
    /syncNativeSqliteWriters/,
    /loadNativeWorkspaceProjectStore/,
    /clearNativeSqliteDatabase/,
    /codeflow_sync_workspace_projects/,
    /codeflow_sync_deepweb_journal/,
    /codeflow_sync_code_index/,
    /analysis_runs/,
    /project_functions/,
    /flow_nodes/,
    /flow_edges/,
    /digital_twin_experiments/,
    /digital_twin_variants/,
    /program_verification_runs/,
    /verification_obligations/,
    /verified_repair_candidates/,
    /repair_verification_gates/,
    /formal_verification_runs/,
    /deepweb_local_sqlite_journal/,
  ].forEach((pattern) => assert.match(nativeSqliteWriter, pattern));

  [
    /inspectControlledRuntimeTools/,
    /executeControlledRuntime/,
    /executeRepairVerificationExperiment/,
    /baselineP95Ms/,
    /candidateP95Ms/,
    /codeflow_runtime_availability/,
    /codeflow_run_controlled/,
    /浏览器预览不会执行导入代码/,
    /recommendedRuntimeAdapter/,
  ].forEach((pattern) => assert.match(controlledRuntime, pattern));

  [
    /buildProgramDigitalTwin/,
    /静态分析/,
    /动态仿真/,
    /压力测试/,
    /容错传播/,
    /算法替换/,
    /安全攻击/,
    /环境迁移/,
    /真实执行/,
    /模型仿真/,
    /静态推断/,
    /不自动修改源代码/,
  ].forEach((pattern) => assert.match(digitalTwin, pattern));

  [
    /workspaceProjects/,
    /workspaceProjectFiles/,
    /workspaceProjectState/,
    /workspaceProjectEvents/,
    /workspaceProjectStorageEngines/,
    /analysisRuns/,
    /projectFiles/,
    /projectFunctions/,
    /flowNodes/,
    /flowEdges/,
    /digitalTwinExperiments/,
    /digitalTwinVariants/,
    /programVerificationRuns/,
    /verificationObligations/,
    /verifiedRepairCandidates/,
    /repairVerificationGates/,
    /formalVerificationRuns/,
    /runtimeExecutionRuns/,
    /deepwebFeatureVectors/,
    /deepwebInferenceRuns/,
    /deepwebLocalSqliteJournal/,
    /deepwebLocalStorageEngines/,
    /native_sqlite/,
  ].forEach((pattern) => assert.match(dbSchema, pattern));

  [
    /CodeFlow Inspector/,
    /withGlobalTauri/,
    /devUrl/,
    /http:\/\/localhost:3000/,
    /frontendDist/,
    /\.\.\/dist\/client/,
  ].forEach((pattern) => assert.match(tauriConfig, pattern));

  [
    /tauri-build/,
    /tauri =/,
    /rusqlite/,
    /bundled/,
    /serde_json/,
  ].forEach((pattern) => assert.match(tauriCargo, pattern));

  [
    /codeflow_native_sqlite_status/,
    /codeflow_load_workspace_projects/,
    /codeflow_sync_workspace_projects/,
    /codeflow_sync_deepweb_journal/,
    /codeflow_sync_code_index/,
    /codeflow_clear_native_database/,
    /codeflow_runtime_availability/,
    /codeflow_run_controlled/,
    /NATIVE_SCHEMA/,
    /CREATE TABLE IF NOT EXISTS analysis_runs/,
    /CREATE TABLE IF NOT EXISTS project_functions/,
    /CREATE TABLE IF NOT EXISTS digital_twin_experiments/,
    /CREATE TABLE IF NOT EXISTS digital_twin_variants/,
    /CREATE TABLE IF NOT EXISTS program_verification_runs/,
    /CREATE TABLE IF NOT EXISTS verification_obligations/,
    /CREATE TABLE IF NOT EXISTS verified_repair_candidates/,
    /CREATE TABLE IF NOT EXISTS repair_verification_gates/,
    /CREATE TABLE IF NOT EXISTS formal_verification_runs/,
    /codeflow_run_formal_policy_suite/,
    /CREATE TABLE IF NOT EXISTS runtime_execution_runs/,
    /temporary project copy/,
    /no shell/i,
    /CPU time, memory, process count, timeout and output limits/,
    /CREATE TABLE IF NOT EXISTS deepweb_replay_memory_snapshots/,
    /CREATE TABLE IF NOT EXISTS native_sqlite_writes/,
    /validate_row/,
    /INSERT OR REPLACE INTO/,
  ].forEach((pattern) => assert.match(tauriLib, pattern));

  const projectTableIndex = workspaceMigration.indexOf("CREATE TABLE `workspace_projects`");
  const fileTableIndex = workspaceMigration.indexOf("CREATE TABLE `workspace_project_files`");
  const stateTableIndex = workspaceMigration.indexOf("CREATE TABLE `workspace_project_state`");
  const engineTableIndex = workspaceMigration.indexOf("CREATE TABLE `workspace_project_storage_engines`");

  assert.ok(projectTableIndex >= 0);
  assert.ok(fileTableIndex > projectTableIndex);
  assert.ok(stateTableIndex > projectTableIndex);
  assert.ok(engineTableIndex > projectTableIndex);
  assert.match(workspaceMigration, /workspace_project_files_project_idx/);
  assert.match(workspaceMigration, /workspace_project_storage_engines_status_idx/);
  assert.match(digitalTwinMigration, /CREATE TABLE `digital_twin_experiments`/);
  assert.match(digitalTwinMigration, /CREATE TABLE `digital_twin_variants`/);
  assert.match(runtimeMigration, /CREATE TABLE `runtime_execution_runs`/);
  await access(new URL("public/sql-wasm.wasm", root));
  await access(new URL("src-tauri/icons/icon.png", root));
});

test("runtime observability and DeepWeb maturity gates are evidence backed", async () => {
  const [runtimeSource, runtimeSchema, neuralSchema, deepWebSource, trainableHeadSource, conformanceSource] = await Promise.all([
    readFile(new URL("src-tauri/src/lib.rs", root), "utf8"),
    readFile(new URL("drizzle/0022_conscious_the_professor.sql", root), "utf8"),
    readFile(new URL("drizzle/0023_productive_wong.sql", root), "utf8"),
    readFile(new URL("src/lib/library/deepweb-neural-database.ts", root), "utf8"),
    readFile(new URL("src/lib/library/deepweb-trainable-head.ts", root), "utf8"),
    readFile(new URL("src/lib/audit/design-conformance.ts", root), "utf8"),
  ]);

  assert.match(runtimeSource, /macos_sandbox/);
  assert.match(runtimeSource, /linux_bubblewrap/);
  assert.match(runtimeSource, /windows_appcontainer_job/);
  assert.match(runtimeSource, /JOB_OBJECT_LIMIT_PROCESS_MEMORY/);
  assert.match(runtimeSource, /refresh_process_observations/);
  assert.match(runtimeSource, /diff_file_snapshots/);
  assert.match(runtimeSchema, /peak_memory_bytes/);
  assert.match(runtimeSchema, /child_processes/);
  assert.match(runtimeSchema, /file_changes/);
  assert.match(neuralSchema, /deepweb_trainable_head_runs/);
  assert.match(neuralSchema, /network_parameters/);
  assert.match(deepWebSource, /maturityEligible/);
  assert.match(deepWebSource, /runtime_observed/);
  assert.match(deepWebSource, /benchmark_observed/);
  assert.match(deepWebSource, /repair_verified/);
  assert.match(trainableHeadSource, /trainSample/);
  assert.match(trainableHeadSource, /validationLossAfter/);
  assert.match(trainableHeadSource, /MAX_EPOCHS/);
  assert.match(conformanceSource, /种子规则和静态命中不能代替运行、benchmark 或修复验证样本/);
});

test("official knowledge packs are gated, signed, activatable and reversible", async () => {
  const [manager, page, rustModule, tauriLib, schema, migration, archive] = await Promise.all([
    readFile(new URL("src/lib/persistence/knowledge-pack-manager.ts", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("src-tauri/src/knowledge_pack.rs", root), "utf8"),
    readFile(new URL("src-tauri/src/lib.rs", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("drizzle/0024_knowledge_pack_supply_chain.sql", root), "utf8"),
    readFile(new URL("docs/知识包第一阶段封存记录.md", root), "utf8"),
  ]);

  [/OSV/, /NVD/, /CWE/, /KEV/, /codeflow_import_knowledge_pack/, /codeflow_activate_knowledge_pack/, /codeflow_rollback_knowledge_pack/]
    .forEach((pattern) => assert.match(`${manager}\n${tauriLib}`, pattern));
  [/知识包/, /来源与许可证门禁/, /封存版本/, /回滚上一版/]
    .forEach((pattern) => assert.match(page, pattern));
  [/normalize_osv/, /normalize_nvd/, /normalize_cwe/, /normalize_kev/, /HMAC-SHA256/, /quarantined/, /verify_pack_integrity/]
    .forEach((pattern) => assert.match(rustModule, pattern));
  [/knowledgeSources/, /knowledgePackVersions/, /knowledgeRawArtifacts/, /knowledgeRecords/, /knowledgePackEvents/]
    .forEach((pattern) => assert.match(schema, pattern));
  assert.match(migration, /knowledge_pack_events_no_update/);
  assert.match(migration, /knowledge_raw_artifacts_no_delete/);
  assert.match(archive, /联网回放结果/);
});

test("native Tree-sitter parser is wired into the default workspace import flow", async () => {
  const [cargo, tauriSource, page, nativeAst, localParser] = await Promise.all([
    readFile(new URL("src-tauri/Cargo.toml", root), "utf8"),
    readFile(new URL("src-tauri/src/lib.rs", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("src/lib/parser/native-ast-parser.ts", root), "utf8"),
    readFile(new URL("src/lib/parser/local-parser.ts", root), "utf8"),
  ]);

  [
    /tree-sitter-python/,
    /tree-sitter-rust/,
    /tree-sitter-java/,
    /tree-sitter-kotlin-sqry/,
    /tree-sitter-cpp/,
    /tree-sitter-go/,
    /tree-sitter-swift/,
    /tree-sitter-typescript/,
  ].forEach((pattern) => assert.match(cargo, pattern));
  assert.match(tauriSource, /fn codeflow_parse_workspace_ast/);
  assert.match(tauriSource, /native_ast_parser_extracts_functions_for_every_bundled_language/);
  assert.match(nativeAst, /parseWorkspaceWithNativeAst/);
  assert.match(nativeAst, /mergeNativeAstReport/);
  assert.match(tauriSource, /AST function boundary/);
  assert.match(page, /parseWorkspaceWithNativeAst\(files\)/);
  assert.match(page, /setEnhancedParseState/);
  assert.match(localParser, /Tauri 内置 native grammar/);
});

test("language servers enrich the default import chain without faking missing tools", async () => {
  const [cargo, tauriSource, lspSource, page, nativeLsp] = await Promise.all([
    readFile(new URL("src-tauri/Cargo.toml", root), "utf8"),
    readFile(new URL("src-tauri/src/lib.rs", root), "utf8"),
    readFile(new URL("src-tauri/src/lsp.rs", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("src/lib/parser/native-lsp-parser.ts", root), "utf8"),
  ]);

  assert.match(cargo, /url =/);
  assert.match(tauriSource, /codeflow_lsp_availability/);
  assert.match(tauriSource, /codeflow_parse_workspace_lsp/);
  [
    /pyright-langserver/,
    /jdtls/,
    /clangd/,
    /gopls/,
    /rust-analyzer/,
    /textDocument\/documentSymbol/,
    /textDocument\/hover/,
    /textDocument\/references/,
    /textDocument\/definition/,
    /textDocument\/publishDiagnostics/,
    /rust-analyzer\/expandMacro/,
    /textDocument\/ast/,
    /was not found on PATH/,
    /clangd_returns_real_semantic_facts_when_installed/,
  ].forEach((pattern) => assert.match(lspSource, pattern));
  [
    /parseWorkspaceWithNativeLsp/,
    /mergeNativeLspReport/,
    /ast-fact:/,
    /cross-file reference/,
    /macroFacts/,
  ].forEach((pattern) => assert.match(nativeLsp, pattern));
  assert.match(page, /parseWorkspaceWithNativeLsp/);
  assert.match(page, /mergeNativeLspReport/);
});

test("desktop LSP sidecars have a manifest, checksum gate and management surface", async () => {
  const [packageJson, tauriConfig, tauriSource, sidecarSource, manifest, manager, page, locker] =
    await Promise.all([
      readFile(new URL("package.json", root), "utf8"),
      readFile(new URL("src-tauri/tauri.conf.json", root), "utf8"),
      readFile(new URL("src-tauri/src/lib.rs", root), "utf8"),
      readFile(new URL("src-tauri/src/sidecar.rs", root), "utf8"),
      readFile(new URL("src-tauri/lsp-sidecars/manifest.json", root), "utf8"),
      readFile(new URL("src/lib/runtime/lsp-sidecar-manager.ts", root), "utf8"),
      readFile(new URL("app/page.tsx", root), "utf8"),
      readFile(new URL("scripts/lock-lsp-sidecars.mjs", root), "utf8"),
    ]);

  [
    /desktop:lock-sidecars/,
    /desktop:audit-sidecars/,
    /desktop:build:sidecars/,
  ].forEach((pattern) => assert.match(packageJson, pattern));
  assert.match(tauriConfig, /lsp-sidecars\/manifest\.json/);
  assert.match(tauriSource, /codeflow_lsp_sidecar_status/);
  assert.match(tauriSource, /codeflow_set_lsp_sidecar_enabled/);
  [
    /managed_root/,
    /bundled_roots/,
    /resolve_tool/,
    /sha256_file/,
    /checksums\.json/,
    /system-ready/,
    /disabled/,
  ].forEach((pattern) => assert.match(sidecarSource, pattern));
  ["pyright", "jdtls", "clangd", "gopls", "rust-analyzer"].forEach((tool) =>
    assert.match(manifest, new RegExp(tool)),
  );
  assert.match(manager, /inspectLspSidecars/);
  assert.match(manager, /setLspSidecarEnabled/);
  assert.match(page, /LSP Sidecar 管理/);
  assert.match(page, /已校验/);
  assert.match(locker, /checksums\.json/);
  assert.match(locker, /tauri\.sidecars\.generated\.json/);
  assert.match(locker, /system Homebrew wrappers are not accepted as release sidecars/);
});
