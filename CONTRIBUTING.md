# Contributing to CodeFlow Inspector

[中文](CONTRIBUTING.zh-CN.md)

CodeFlow Inspector is a local-first desktop code-analysis system. Contributions must preserve the separation between semantic facts, visual presentation, deterministic knowledge, learned ranking, controlled execution, and formal proof.

## Before opening a pull request

1. Create a focused issue with a minimal, non-confidential reproduction.
2. Keep imported source code, local SQLite databases, runtime output, sidecar binaries, signing material, and user paths out of commits.
3. Run `npm run lint` and `npm test`.
4. When Rust or native commands change, run `cargo test --locked` in `src-tauri`.
5. Check both `zh-CN` and `en-US` desktop layouts for visible text changes.

## Analysis integrity

- Do not change the Semantic Graph merely to make a graph look cleaner.
- Do not label heuristic or estimated output as compiler, runtime, or proof evidence.
- Do not visually merge independent semantic channels.
- Keep network access denied unless the user explicitly enables an allow-listed knowledge update.
- Imported executable adapters must remain staged until checksum, health-check, and isolation requirements pass.

## Feedback that helps

Include the product version, operating system, affected language, evidence grade, exact steps, expected result, actual result, and a minimal sample project. Never attach proprietary projects or secrets.
