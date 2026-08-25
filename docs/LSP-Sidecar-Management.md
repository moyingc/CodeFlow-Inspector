# LSP Sidecar Management

Chinese version: [LSP-Sidecar管理.md](LSP-Sidecar管理.md)

## Goal

The desktop application does not rely only on terminal `PATH`. LSP tools resolve in this order:

1. Per-tool environment override for development and recovery.
2. Managed package in the application data directory.
3. Bundled sidecar in installer resources.
4. System-installed tool as a development fallback.

The status page distinguishes `bundled`, `managed`, `system`, `missing`, and `disabled`. A system tool can produce real semantic evidence, but it is shown as verified only when its SHA-256 matches the build lock.

## Package Shapes

| Tool | Shape | Complete-package requirement |
| --- | --- | --- |
| Pyright | Node runtime package | Dedicated Node runtime, Pyright files, relative launcher |
| JDT LS | JVM runtime package | JDT LS plugins, managed JRE, relative launcher |
| clangd | Native binary | Platform clangd and license |
| gopls | Native binary | Platform gopls and Go SDK or explicit SDK dependency |
| rust-analyzer | Native binary | Platform rust-analyzer and Rust sysroot/toolchain |

Copying Homebrew launch scripts alone is incomplete because they still reference Homebrew Node, Java, or Cellar paths. Build scripts reject packages without `VERSION` or a launcher so a developer-only fake sidecar is not shipped.

## Package Directory

```text
src-tauri/lsp-sidecars/<target>/
  checksums.json
  pyright/VERSION
  pyright/bin/pyright-langserver
  jdtls/VERSION
  jdtls/bin/jdtls
  clangd/VERSION
  clangd/bin/clangd
  gopls/VERSION
  gopls/bin/gopls
  rust-analyzer/VERSION
  rust-analyzer/bin/rust-analyzer
```

`npm run desktop:lock-sidecars` checks all five packages and writes target-triple filenames, SHA-256 build locks, and `tauri.sidecars.generated.json`. `npm run desktop:build:sidecars` builds a sidecar installer only after the lock succeeds.

## Current Development-Machine Evidence

The macOS ARM64 development machine has launched Pyright 1.1.411, Eclipse JDT LS 1.60.0, clangd 17, gopls 0.23.0, and rust-analyzer 2026-07-27.

Validation starts a JSON-RPC/LSP session and performs initialize, open-file, documentSymbol, hover, definition, references, and diagnostics requests; clangd also has a macro-semantic AST test. This establishes `system-ready`, not cross-machine `verified`. Cross-platform releases still require complete relocatable packages for each target, plus signing and license archival.
