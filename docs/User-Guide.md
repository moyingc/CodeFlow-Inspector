# CodeFlow Inspector User Guide

[中文](用户使用手册.md) | [Product vision and technology](Product-Vision-and-Technology.md) | [Back to English documentation](../README.en-US.md)

## 1. What the application does

CodeFlow Inspector is a local desktop code-analysis application. It turns a source project into a queryable software-system model so you can investigate:

- What does this project do as a whole?
- Where is the main entry point, and how does data reach its results?
- What responsibility belongs to each file, module, and function?
- Which conclusions come from an AST, compiler, LSP, real execution, tests, or proof?
- Which paths may expose input, authorization, injection, resource, or environment risks?
- Can the current computer carry the estimated runtime and analysis cost?
- Does a proposed change actually improve performance, stability, or security?

The product is local-first. Source, indexes, execution records, and reports stay on the device by default. Knowledge updates cannot access the public network without explicit authorization.

## 2. Release boundary

The current release is an **Alpha / Research Preview**. Start with sanitized, non-confidential projects.

Evidence grades are kept separate:

| Evidence | Meaning |
| --- | --- |
| Parser / AST | A parser confirmed syntax, function boundaries, parameters, or calls |
| Compiler / LSP | A compiler or language server confirmed types, definitions, references, macros, or diagnostics |
| Rule / Knowledge | The local knowledge base found a pattern worth reviewing |
| Runtime | Controlled execution observed an exit code, output, exception, duration, or resource use |
| Test / Benchmark | A version-matched test or benchmark produced a comparable result |
| SMT / Proof | A solver proved a bounded obligation or produced a counterexample within its stated model |

A high-confidence candidate is not automatically a proven defect. Always read the location, cause, evidence grade, and missing conditions together.

## 3. Installation and first launch

1. Download the package matching the operating system, CPU architecture, and locale.
2. Install and launch CodeFlow Inspector.
3. Pyright, JDT LS, clangd, gopls, and rust-analyzer are not required to start the application.
4. For deeper cross-file language semantics, follow the [language tool installation guide](Language-Tool-Installation.md).
5. Keep public-network access disabled during the first evaluation.

Unsigned macOS preview packages may trigger a system warning. Download only from this project's GitHub Releases and verify the published integrity information.

## 4. Import a project

Open **Project Center**:

1. Choose **Select Project Folder** to retain the complete directory hierarchy.
2. Use **Select Code Files** only for a small set of standalone files.
3. Wait for batched import, parsing, and local indexing.
4. Confirm the detected file count, languages, and update time.
5. Select **Open**.

Import the project root when possible. Lockfiles, manifests, build files, and tests provide important dependency, environment, and runtime-entry evidence.

### Multiple projects

- **Open** switches the active project without overwriting another project.
- **Rename** changes only the display name in CodeFlow Inspector.
- **Duplicate** creates an isolated copy for version comparison.
- **Remove** removes a project and offers an immediate undo action.
- **Export Backup** exports recoverable project-library data.
- **Merge Restore** validates and merges a backup without replacing existing projects.

Never attach secrets, production databases, personal data, or proprietary source to a public issue.

## 5. Navigation

The sidebar is organized into four groups:

- **Project**: Project Center and Data Flow Overview.
- **Analysis**: File, Module, and Function Analysis.
- **Experiment**: Diagnostics, Digital Twin, Testing, and Reports.
- **System**: Analysis Core, Local Knowledge, and Settings.

On macOS, hold `Command + Shift` to open the navigation dial. Move the pointer or use arrow keys, release to enter the selected page, or press `Esc` to cancel. Standard and compact sidebar modes change navigation density only.

## 6. Data Flow Overview

The overview follows primary inputs through function processing, state changes, outputs, and exceptional paths.

The Flow-First layout uses logical depth for execution order and places same-depth functions within fan sectors. Semantic edges remain independent; a shared visual corridor never merges unrelated data.

### Canvas controls

- Drag the canvas to pan.
- Use the wheel or trackpad to zoom.
- **Fit** shows the complete current graph.
- **Reset** restores the default viewport.
- Spacing and zoom controls adjust readable density.
- View filters switch between the spine, overview, primary paths, and issue paths.

Select a node or channel to inspect upstream and downstream relationships, inputs, outputs, confidence, issue cause, and evidence. Normal paths remain visually quiet; only affected nodes and propagated segments receive diagnostic color.

Channel width represents estimated load or aggregated flow, not literal network bandwidth. A Confluence is created only for real semantic data convergence. Visual multi-lane corridors preserve each channel ID and complete source-to-target trace.

## 7. File, module, and function analysis

**File Analysis** shows language, functions, models, responsibilities, and related issues per file.

**Module Analysis** groups related behavior across files, such as entry control, persistence, task management, scheduling, notifications, UI state, or security boundaries. These analytical modules do not alter the source tree.

**Function Analysis** provides location, language, parser, complexity, parameters, return values, a detailed purpose explanation, algorithm or processing strategy, upstream and downstream calls, inputs, outputs, side effects, graph views, breakpoints, propagated issues, and repair guidance.

Inferred design intent helps a new maintainer form a working model. It does not replace the author's documentation, business requirements, or runtime validation.

## 8. Diagnostics and security

Open **Diagnostics** to review findings grouped by category. One risk pattern affecting many functions is presented as one group with multiple locations.

Review external input reaching SQL, command, DOM, path, or file operations; binding and allowlists; identity and authorization; exceptions, timeout, retry, transaction, and resource release; dependency and runtime gaps; and source-to-sink sanitization state.

When compiler, LSP, runtime, or version evidence is missing, the application marks a finding for verification instead of presenting a rule match as an established vulnerability.

## 9. Digital twin and controlled execution

The Digital Twin page combines static models with controlled runtime evidence. Real execution starts only after an explicit user action.

1. Select a language adapter and real entry file.
2. Inspect tool and isolation availability.
3. Select static analysis, dynamic simulation, stress, fault propagation, algorithm substitution, security attack, or environment migration.
4. Run the selected experiments.
5. Follow the progress bar, current step, timestamp, and failure reason.
6. Review stdout, stderr, exit code, duration, CPU, peak memory, child processes, and file changes.

Controlled execution uses fixed adapters and a temporary project copy. It does not accept an arbitrary shell command, and public network access is denied by default. Missing tools, entries, dependencies, or isolation capabilities remain failed, blocked, or unavailable.

Runtime Cost estimates memory, CPU threads, and disk needs. Estimates are planning signals until real samples improve confidence; they are not production capacity guarantees.

## 10. Debugging

When a compatible debug adapter is detected:

1. Set a breakpoint in Function Analysis.
2. Select the runtime entry and line on the Digital Twin page.
3. Launch and pause the session.
4. Inspect stack frames, scopes, and variables.
5. Step over, step in, step out, continue, pause, or disconnect.

If launch fails, read the displayed cause and inspect runtime and adapter status in **Analysis Core**. The HTTP preview cannot create a real desktop debug session.

## 11. Testing and validation

On **Testing and Validation**, select Functional, Smoke, Regression, Integration, Performance, Load, Usability, or Repair Verification.

Automatic items run in order. Manual usability items and repair-dependent items record their requirements instead of fabricating a pass. Results use `passed`, `failed`, `blocked`, and `not-run`. A project version change can invalidate an older passing record.

Usability checks require real user operation and manual confirmation. Static analysis cannot replace usability acceptance.

## 12. Repair, A/B, write-back, and rollback

The repair workflow does not overwrite source immediately:

1. Load a candidate from a function or finding.
2. Review the reason, exact source, and suggested code.
3. Generate and inspect the diff.
4. Run A/B, regression, security, and benchmark gates in a project copy.
5. Approve only the current candidate hash.
6. Perform safe write-back.
7. Use one-click rollback if the result is unacceptable.

A descriptive recommendation with no effective source change cannot be written back. Estimated performance gains require same-input, same-environment comparison before becoming validated evidence.

## 13. Reports and PDF export

The complete report includes the executive summary, runtime cost, issues, security, digital-twin experiments, all test outcomes and missing conditions, repair validation, and extension information.

Choose whether to include all expanded evidence under **Settings > PDF Report**. **Export PDF** opens the native Save As dialog. The report is generated locally and is not uploaded by default.

## 14. Analysis Core, Local Knowledge, and Settings

**Analysis Core** reports Tree-sitter, compiler/LSP, language-server, runtime, debugger, database, and evidence availability. `missing` means the host cannot find a tool; `system` means a user-installed tool was found; `verified` means a package matches the build lock.

**Local Knowledge** updates only from allow-listed sources through download, license, quarantine, replay, signature, activation, and rollback gates. No online update occurs while the public-network switch is off. Local supplemental evidence and declarative extension manifests can be imported without executing arbitrary package code.

**Settings** controls PDF detail, default graph spacing and zoom, project-evidence navigation, and network-boundary status. Settings remain local.

## 15. Recommended workflow

```text
Import the complete project
→ Read the data-flow overview and software interpretation
→ Drill down through files, modules, and functions
→ Inspect causes and evidence grades
→ Add only the language and runtime tools you need
→ Run controlled experiments and selected tests
→ Review runtime cost and security paths
→ Validate a repair in a project copy
→ Approve write-back or roll back
→ Export the complete PDF report
```

## 16. Troubleshooting

- **Zero functions:** inspect AST status in Analysis Core and confirm that the source language and files are supported.
- **Installed tool remains missing:** quit and restart the application, then follow the [language tool guide](Language-Tool-Installation.md).
- **Experiment button disabled:** check for a real entry file, an installed runtime, desktop mode, and another active operation.
- **Repeated security title:** expand the grouped risk to see each affected location; locations are not automatically separate vulnerabilities.
- **Graph crossings:** use primary-path or module aggregation views and zoom into a local region. Complex callbacks and cycles can require cross-sector paths.
- **HTTP versus desktop:** HTTP is a UI preview only. Native files, SQLite, LSP, execution, debugging, sandboxing, and host resources require Tauri desktop mode.

## 17. Feedback and security reports

Include the CodeFlow Inspector version and locale, operating system and CPU architecture, analyzed language and tool version, exact steps, expected and actual result, and a minimal sanitized reproduction.

Report source disclosure, sandbox escape, signature bypass, or network-policy bypass privately through GitHub Private Vulnerability Reporting.
