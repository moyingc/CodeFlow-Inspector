# CodeFlow Inspector

[中文](README.zh-CN.md) | [Home](README.md)

CodeFlow Inspector is a local-first desktop application that turns source projects into structured semantic evidence. It helps users understand software behavior, call relationships, data paths, runtime requirements, performance, stability, and security boundaries.

## Status

The current release is an **Alpha / Research Preview** intended for sanitized, non-confidential projects and reproducible feedback. Candidate findings, statistical estimates, Compiler/LSP evidence, controlled-runtime evidence, and formal proof are kept at distinct evidence grades. Unverified inferences are not presented as established facts.

## Capabilities

- Import and isolate multiple projects, with project metadata, indexes, and experiments stored in local SQLite.
- Extract ASTs, types, definitions, references, macros, and diagnostics through Tree-sitter, compilers, and LSP servers.
- Render function graphs, call flows, code trees, file hierarchy, FSM views, and aggregated views for large projects.
- Trace inputs, parameters, state changes, exceptional paths, and sensitive operations from source to sink.
- Run controlled execution, debugging, resource observation, and digital-twin experiments in temporary project copies and OS isolation boundaries.
- Inspect validation, authorization, SQL/command/path injection, resource limits, environment gaps, and dependency risks.
- Generate candidate diffs and validate them through A/B replay, regression tests, and benchmark comparisons before approval.
- Export structured PDF reports locally without uploading project source or report contents by default.

## Language tooling

The application itself installs and starts without third-party language servers, and its baseline static analysis does not require a remote model API. To keep downloads manageable and avoid redistributing large third-party runtimes on their behalf, the current public packages do not bundle Pyright, JDT LS, clangd, gopls, or rust-analyzer.

Tree-sitter and local analysis remain available when these optional tools are missing. Cross-file types, definitions, references, macros, and compiler diagnostics are then explicitly marked as lacking LSP evidence. After installing a tool, restart the desktop application and CodeFlow Inspector will detect it automatically; no source-code changes are required.

- [English language tool installation guide](docs/Language-Tool-Installation.md)
- [中文语言工具安装指南](docs/语言工具安装指南.md)

Real compilation and execution require the corresponding Node.js, Python, JDK, Rust, or C/C++ toolchain on the host. CodeFlow Inspector detects and certifies compatible tools. It does not connect to the network or install third-party software without explicit user authorization.

## Development

Development requires Node.js 22+, stable Rust, and the platform dependencies required by Tauri 2.

```bash
npm ci
npm run lint
npm test
npm run desktop:dev
```

The HTTP preview exists only for UI development and regression checks. Native file access, SQLite, LSP sidecars, controlled execution, debugging, and system resource inspection require the Tauri desktop application.

## Feedback and security

- Use the Bug Report template with a minimal, sanitized reproduction for ordinary defects.
- Use the Feature Request template for languages, analysis models, visualizations, and workflows.
- Report source disclosure, sandbox escape, signature bypass, or network-policy bypass privately through GitHub Private Vulnerability Reporting.
- Read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) before contributing.

## License

CodeFlow Inspector is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). Reading, research, testing, modification, and other noncommercial uses are permitted under its terms. This is not an OSI-approved open-source license. Commercial use requires a separate license.
