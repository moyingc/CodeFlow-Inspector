# LSP Default Import Chain

Chinese version: [LSP默认导入链.md](LSP默认导入链.md)

Desktop project import follows this fixed sequence:

1. Tree-sitter uses the language grammar to identify file structure, function boundaries, parameters, calls, and candidate macro locations.
2. A fixed LSP is selected by language; the project cannot supply an arbitrary command.
3. Request `documentSymbol`, `hover`, `definition`, and `references`, and collect compiler diagnostics.
4. Rust macro sites request `rust-analyzer/expandMacro`; C/C++ candidates request clangd `textDocument/ast`.
5. Real reference locations complete cross-file call edges and bind the evidence to functions and graph nodes.
6. Missing, failed, or timed-out LSP execution falls back to Tree-sitter AST and is never presented as executed.

## Language Mapping

| Language | Default semantic service | Fixed launch |
| --- | --- | --- |
| Python | Pyright | `pyright-langserver --stdio` |
| Java | Eclipse JDT LS | `jdtls -data <temporary-workspace>` |
| C/C++ | clangd | `clangd --background-index=0 --clang-tidy=0 --log=error` |
| Go | gopls | `gopls serve` |
| Rust | rust-analyzer | `rust-analyzer` |

## Local Discovery

The application checks dedicated environment variables, current `PATH`, Homebrew, `/usr/local/bin`, `~/.cargo/bin`, `~/go/bin`, and `~/.local/bin`. Desktop mode first checks managed packages in application data and bundled installer sidecars; see [LSP Sidecar Management](LSP-Sidecar-Management.md).

- `CODEFLOW_PYRIGHT_PATH`
- `CODEFLOW_JDTLS_PATH`
- `CODEFLOW_CLANGD_PATH`
- `CODEFLOW_GOPLS_PATH`
- `CODEFLOW_RUST_ANALYZER_PATH`

An override must reference a real file. Tool states are `missing`, `skipped`, `executed`, `partial`, and `failed`; only `executed` and `partial` count as real semantic execution.

## Security Boundary

- Only the five fixed language servers run, without a shell.
- Analyzed code is copied to a temporary workspace; network proxies point to an unreachable local port.
- Rust build scripts, proc macros, and cache priming are disabled by default.
- Java autobuild and automatic Gradle import are disabled.
- Every service has an import timeout; timeout returns existing facts marked `partial`.
- Compiler diagnostics are not runtime verification and cannot directly advance stable DeepWeb training.

## Current Validation

Rust unit tests cover protocol frames, honest missing-tool detection, and Tree-sitter macro-site extraction. All five default LSPs have passed real protocol tests on the development machine. Package status still distinguishes `system-ready` from `checksum-verified` and never presents a development installation as a relocatable package.
