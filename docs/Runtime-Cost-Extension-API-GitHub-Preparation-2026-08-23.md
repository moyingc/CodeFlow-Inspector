# Runtime Cost, Extension Interface, and GitHub Preparation Archive

Chinese version: [运行成本-扩展接口-GitHub准备-2026-08-23.md](运行成本-扩展接口-GitHub准备-2026-08-23.md)

Date: 2026-08-23

## Goals

1. Estimate whether the current machine can carry an imported project's CPU, memory, disk, and process pressure.
2. Preserve a simple import entry for future language, embedded, frontend, knowledge, testing, and reporting extensions.
3. Prepare GitHub feedback without leaking local project data.

## Runtime Cost

- Tauri exposes read-only `codeflow_system_capacity`, using `sysinfo` for logical CPUs, total/available memory, and free local-volume space.
- Project cost combines file count, function count, data edges, source bytes, and controlled-runtime records.
- Real CPU time, peak memory, and child process trees calibrate estimates when runs exist; otherwise the UI labels them static estimates.
- HTTP preview has no host memory/disk permission and must display “host measurement pending.”
- The complete PDF includes estimated peak memory, threads, disk, evidence grade, and cost-reduction advice.

## Extension Import

- Knowledge data follows the native SQLite quarantine, hash, signature replay, and activation chain.
- Adapter Contract 1.0 supports manifest import and template download.
- A manifest may register only input, output, health check, and isolation.
- `command`, `script`, `binary`, `executable`, shell, and install hooks are rejected.
- Executable sidecars still require a separate signed installation path, health check, and sandbox gate.

## GitHub Feedback Preparation

Bug and feature forms, PR checks, `CONTRIBUTING.md`, and `SECURITY.md` were added. Vulnerabilities use Private Vulnerability Reporting. Public issues must not include local source, databases, secrets, private paths, or runtime output. GitHub Actions builds localized desktop packages and runs controlled-runtime acceptance on macOS, Linux, and Windows.

## Verification

- `npm run build`: passed.
- `npm test`: 84/84 passed.
- `cargo check --locked`: passed.
- `npm run lint`: zero errors; ten existing unused-code warnings remained.
- Desktop-width HTTP review found no text overflow in runtime-cost and extension-import regions.

## Decisions That Were Still Manual

Repository name, visibility, software license, security-report recipient, and final repository URL still required owner decisions at the date of this record.
