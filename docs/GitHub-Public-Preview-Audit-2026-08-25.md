# GitHub Public Preview Audit (2026-08-25)

Chinese version: [GitHub公开预览审计-2026-08-25.md](GitHub公开预览审计-2026-08-25.md)

## Conclusion

The project is suitable for an **Alpha / Research Preview** to collect feedback. It must not be described as stable, as a production security prover, or as a mature all-language analysis platform.

A ban on commercial use is incompatible with the OSI Open Source Definition. Under a noncommercial license, release material must use “source-available,” not “Open Source.”

## Digital-Twin Algorithm Candidates

- Algorithm experiments select the highest-benefit strategy from `speedOptions` and output performance, stability, resource, and suitability estimates.
- A strategy does not carry a deterministic source edit, so it cannot automatically produce candidate code.
- The repair workbench previously placed the original text in both editors, making the candidate appear identical. Strategy candidates now leave suggested code empty until a real edit exists.
- The Diff layer rejects unchanged replacement text, identical workspace hashes, ambiguous targets, and stale edits.

## Boundary Between Twins and Tests

Both may consume one controlled execution's exit code, stdout/stderr, CPU, memory, trace, file changes, and isolation evidence. They may not treat that evidence as the same conclusion:

- Tests determine whether a declared expectation passed; a twin compares system behavior under changed conditions.
- Functional, smoke, and integration tests may consume a baseline run but need their own assertions. Exit code zero alone cannot pass all of them.
- Performance and load tests may consume stress samples, but load results require scale, concurrency, and duration. Twin stress experiments additionally require capacity boundaries and degradation curves.
- Algorithm replacement may consume only A/B output from a real candidate Diff. With no code change, the result remains unproved.

## Quality State Before Publication

- Frontend and contract tests: 84/84 passed.
- npm production dependency audit: zero known vulnerabilities.
- ESLint: zero errors and ten unused-code warnings.
- Rust desktop tests initially found an LLDB `statistics` extension-field compatibility issue; the corrected replay test passed.
- Local secret-pattern scanning found no common token or private key.
- `src-tauri/target`, local sidecars, installers, temporary reports, and the feedback PDF are ignored by Git.

## Decisions Still Required

1. Select an OSI license, or retain a noncommercial source-available license and label it accurately.
2. Initialize the repository and confirm the first tracked file set.
3. Replace outdated prototype language in README with current capabilities, limits, and the smallest demonstration flow.
4. After the first push, inspect Linux, Windows, and macOS GitHub Actions results.
5. Enable Private Vulnerability Reporting, Dependabot, branch protection, and required checks.

## Gap to Established Products

The main gap is not page count. It is the accumulated language and framework models, rule precision, false-positive regression corpus, large-project benchmarks, IDE/CI ecosystem, compatibility matrix, and security response process. The differentiators are local-first operation, explanations for non-specialists, visual data paths, controlled-runtime evidence, and gated candidate repairs. The preview should collect reproducible feedback around those strengths rather than compete on raw rule count with mature SAST products.
