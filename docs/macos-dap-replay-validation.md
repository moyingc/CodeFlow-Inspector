# macOS DAP Sidecar Replay Validation

Date: 2026-08-08
Target: aarch64-apple-darwin

## Desktop boundary

- The product is a Tauri desktop application and uses Tauri IPC.
- It does not deploy or depend on a localhost HTTP service.
- DAP adapters that require a socket are restricted to temporary `127.0.0.1` process IPC.
- The macOS sandbox denies external network access while allowing only localhost DAP traffic.

## Locked adapters

- vscode-js-debug 1.102.0
- debugpy 1.8.16 for CPython 3.11
- vscode-java-debug 0.58.5 / Java Debug plugin 0.53.2
- Apple LLDB DAP host adapter with a locked wrapper, reference binary and license record

All managed package files are listed in `src-tauri/debug-sidecars/aarch64-apple-darwin/checksums.json`.
The package aggregates are locked in `src-tauri/debug-sidecars/manifest.json`.

## Real replay gates passed

- Python: initialize, verified breakpoint, stopped, threads, stack, scopes, variables, continue, terminated, process cleanup.
- Node: parent/target DAP sessions, provisional breakpoint resolved by a real breakpoint stop, stack, scopes, variables, continue, terminated, session cleanup.
- Java: JDT LS bundle installation, `vscode.java.startDebugSession`, DAP initialize, compiled class launch, verified breakpoint, stack, scopes, variables, continue, terminated.
- LLDB: real C compilation with debug symbols, DAP initialize, verified breakpoint, stack, scopes, variables, continue and process exit.

Rust and C++ now have independent compiled LLDB DAP fixtures covering verified breakpoints, stopped events, stack/scopes/variables, continue and process exit. Full Cargo/CMake project build orchestration remains a separate capability from language-level DAP validation.

## Remaining product integration

The adapter packages and replay protocol are verified. The public Tauri commands still need a live-session coordinator that owns adapter/debuggee processes across UI calls. Until that coordinator is connected, `codeflow_debug_launch` intentionally refuses to execute imported project code.
