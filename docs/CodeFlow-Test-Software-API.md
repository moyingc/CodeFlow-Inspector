# CodeFlow Test Software Interface

Chinese version: [CodeFlow测试软件接口文档.md](CodeFlow测试软件接口文档.md)

## 1. Scope

This document describes the test interfaces of the CodeFlow local desktop application itself. It is not public HTTP API documentation and does not require an analyzed project to provide interface documentation.

The interfaces combine static analysis, real controlled execution, debugging, performance samples, repair A/B experiments, and human usability acceptance into traceable, exportable, and reproducible results.

## 2. Test Orchestration

Entry point: `src/lib/testing/software-test-plan.ts`

```ts
buildSoftwareTestReport({
  files,
  functions,
  issues,
  experiments,
  runtimeExecutions,
  usabilityPassedIds,
  projectUpdatedAt,
  repair,
}): SoftwareTestReport
```

Supported test types are `functional`, `smoke`, `regression`, `integration`, `performance`, `load`, `usability`, and `repair-verification`.

Unified statuses:

- `passed`: passing evidence matches the current version.
- `failed`: a real sample or verification gate failed.
- `blocked`: a required execution condition is missing.
- `not-run`: conditions may exist, but the test has not run for the current version or requires revalidation.

Every `SoftwareTestResult` must include a summary, evidence, and missing conditions. Failed results should include expected and actual behavior, reproduction steps, severity, and repair guidance. Static scans must never substitute for a real passing test result.

## 3. Version Revalidation

The report derives a `versionFingerprint` from project file names and content hashes. When the project modification time is newer than the last real execution, historical passes are downgraded to `not-run` and marked for revalidation.

```text
Import new version -> calculate fingerprint -> identify stale evidence ->
run smoke/regression/integration -> run performance and load ->
verify repairs -> confirm usability -> export report
```

### 3.1 Integrated Execution and Progress

The test page lets users select functional, smoke, regression, integration, performance, load, usability, and repair-verification checks. Automated items enter the controlled runner in selection order. Manual items and items without an executable candidate only record their conditions; they do not fabricate execution.

The twin page supports static analysis, dynamic simulation, stress testing, fault propagation, algorithm replacement, security attacks, and environment migration. Execution and refresh operations maintain one progress structure:

```ts
type SuiteProgress = {
  running: boolean;
  completed: number;
  total: number;
  current: string;
  message: string;
  updatedAt: number | null;
};
```

The UI must show completed count, percentage, current step, latest update time, and a progress bar. An HTTP preview can validate selection and progress UI, but cannot execute local code.

## 4. Native Controlled Runtime

The Tauri command `codeflow_run_controlled` accepts a fixed language adapter and a temporary project copy, never an arbitrary shell string. It returns `ControlledRuntimeExecutionReport` with:

- build and exit status;
- stdout, stderr, and truncation state;
- elapsed time, CPU time, and peak memory;
- child process tree;
- file changes;
- trace and sanitizer results;
- sandbox type, execution state, and isolation evidence.

A language extension must register fixed commands, entry-file rules, build steps, resource limits, and health checks. Embedded and frontend adapters must return the same result structure.

## 5. Debug Interface

Desktop debug sessions use:

- `codeflow_debug_availability`
- `codeflow_debug_create_session`
- `codeflow_debug_set_breakpoints`
- `codeflow_debug_launch`
- `codeflow_debug_session`
- `codeflow_debug_continue`
- `codeflow_debug_next`
- `codeflow_debug_step_in`
- `codeflow_debug_step_out`
- `codeflow_debug_pause`
- `codeflow_debug_disconnect`

Repair validation must record breakpoint verification, stop location, call stack, scopes, variables, and process-tree cleanup after exit.

## 6. Parsing and Environment

The native parsing chain exposes:

- `codeflow_parse_workspace_ast`
- `codeflow_parse_typescript_compiler`
- `codeflow_parse_workspace_lsp`
- `codeflow_lsp_availability`
- `codeflow_lsp_sidecar_status`

Parsing is prerequisite evidence. Successful Compiler/LSP execution only establishes the availability of syntax, types, definitions, references, and related semantics. It does not prove functional correctness.

## 7. Formal and Security Interfaces

- `codeflow_run_formal_policy_suite`: run local policy proofs.
- `codeflow_run_project_smt_batch`: batch project contracts through SMT.
- `codeflow_sync_security_assertions`: store permission, identity, and taint-attack assertion results.

Formal proofs and security assertions enter the report as evidence, while retaining their scope and every unproved boundary.

## 8. PDF Reporting

The page calls `exportElementAsLocalPdf(element, fileName)`. Desktop mode opens the system save dialog through `codeflow_save_report_pdf`; web preview uses a browser download.

Exports must include passed, failed, blocked, and not-run results; defect records; missing configuration; version fingerprint and revalidation state; and runtime, performance, repair, and security evidence. Collapsed content expands in the export snapshot. Reports are generated locally and do not upload source or results.

## 9. Adapter Contract

The common definition is in `src/lib/extensions/adapter-contract.ts`. Every extension declares `id`, `kind`, `contractVersion`, `input`, `output`, `healthCheck`, and `isolation`. The testing adapter ID is `testing.project`; it consumes project code and existing evidence and returns `SoftwareTestReport`.

## 10. Compatibility and Security Constraints

- Desktop commands accept structured arguments only, never arbitrary shell input.
- An analyzed project has no public-network access by default.
- Tests run in a temporary project copy.
- Missing tools, environment, or evidence must produce an explicit status, never a fabricated success.
- Results stored locally or in native SQLite must include project ID, version fingerprint, and timestamp.
- New interfaces should remain backward compatible; breaking changes require a new `contractVersion`.
