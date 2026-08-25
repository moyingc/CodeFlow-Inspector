# CodeFlow Inspector Non-Hydrology Core v1 Engineering Certification

Chinese version: [非水流Core-v1工程认证-2026-08-12.md](非水流Core-v1工程认证-2026-08-12.md)

Date: 2026-08-12

## Certification Conclusion

- Non-hydrology Core v1 engineering implementation: 100%.
- Non-hydrology Core v1 engineering acceptance: 100%, status `certified`.
- Long-term real-project maturity is not claimed as 100%; it depends on project diversity, long replay history, attack corpora, benchmarks, and supervised DeepWeb samples.
- Certification excludes flow-map layout and visual language, long-term DeepWeb training volume, macOS notarization, and Linux/Windows release-machine acceptance.

Machine-readable report: `build/core-v1-acceptance-latest.json`.

## Closed Core Chains

1. Local Tauri desktop shell, multi-project isolation, native SQLite, backup, and recovery.
2. Real Tree-sitter AST for 15 languages with Compiler/LSP enhancement and capability-degradation records.
3. Controlled Node, Python, Java, Rust, C, and C++ execution plus real DAP breakpoint, stack, scope, and variable replay.
4. Technical and functional explanations across files, functions, modules, primary flow, algorithms, and evidence boundaries.
5. Signed local knowledge packages with quarantine, replay, activation, and rollback.
6. Trainable DeepWeb head, teacher-evidence gates, model versions, and training history.
7. In-process protocol experiments for FastAPI, Flask, Django, Express, and Spring.
8. Context heap, field/container points-to, dynamic dispatch candidates, event-level concurrency, and synchronization edges.
9. Java, Rust, and C/C++ dynamic-boundary probes and runtime-trace supplementation.
10. Program Digital Twin, Z3 contracts, counterexample call chains, candidate Diff, A/B, and gated writeback/rollback.
11. A 10,000-function points-to/taint benchmark converging in about 2.3 seconds in the recorded synthetic fixture.
12. Public network denied by default; official-source public permission is separate from local/private-network permission, with no permission inheritance or network bridging.

## All-Language Meaning

“All-language Core v1 mature” means each of the 15 declared languages has a real AST path and no heuristic scan is presented as AST. Languages with Compiler/LSP support receive types, definitions, references, and diagnostics. Swift uses controlled `swiftc -typecheck/-dump-ast` when SourceKit is constrained. SQL Language Server limitations are labeled `limited`, with Tree-sitter providing structure. Unverified PATH tools are compatibility probes and do not count toward portable-sidecar certification.

## Network Boundary

- The public-network switch controls public knowledge updates, not local IPC.
- Loopback and RFC private addresses must pass Tauri private-endpoint validation; only literal IPs are accepted to avoid DNS rebinding.
- The project runner remains disconnected at OS level and cannot inherit knowledge-update permission.
- The application provides no proxy, port forwarding, routing bridge, or public inbound service.

## Acceptance Evidence

- `npm run verify:core-v1`: passed.
- ESLint: zero warnings and zero errors at certification time.
- Frontend/Node: 74 passed, zero failed.
- Cargo: 72 passed, zero failed; one official online-source test intentionally ignored.
- Production build and `cargo check`: passed.

## Items That Are No Longer Engineering Gaps

Protocol orchestration, context heap, event concurrency, dynamic boundaries, the 10k benchmark, and desktop automatic acceptance are in Core v1. Future work extends coverage, validates more real projects, and accumulates model data; it must not retroactively reduce the certified engineering completion result.
