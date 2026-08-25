# CodeFlow Inspector: Product Vision and Technology

[中文](产品理念与技术介绍.md) | [Detailed user guide](User-Guide.md) | [Back to English documentation](../README.en-US.md)

## Positioning

**CodeFlow Inspector turns source code into an understandable, traceable, and experiment-ready software-system model.**

It is not merely a function browser, an alert list, or a chat window that sends code to a remote model. It is designed to help a non-programmer understand what software does while giving an engineer the technical evidence behind every conclusion.

## Why this product exists

Software understanding is fragmented across IDEs, static scanners, test frameworks, profilers, security platforms, and documentation. A maintainer needs a connected answer:

> Where does data enter, what transforms it, where does it change, why is a path risky, and what tradeoff would a different implementation create?

CodeFlow Inspector moves code understanding from reading isolated text to observing a system. It models inputs, functions, state, storage, exceptions, and outputs, then reconnects static facts, runtime evidence, security knowledge, experiments, and repair history.

## From source to a program digital twin

```text
Source Code
→ AST / Compiler / LSP Facts
→ Semantic Program Graph
→ Control and Data Flow
→ Controlled Runtime Evidence
→ Program Digital Twin
→ Test, Optimization, and Repair Decisions
```

The goal is not just a more attractive diagram. It is a software model that can answer, “What evidence supports this?”

## Product principles

### Two audiences, one evidence base

For a non-engineer, the product provides structured explanations of the project, modules, and functions. For an engineer, it retains source locations, parameters, return values, complexity, types, calls, source-to-sink paths, runtime cost, and evidence grades.

Plain-language and technical views are derived from the same structured facts so they do not become conflicting narratives.

### Flow-First visualization

Logical data order is the primary layout constraint. Inputs begin at the high side of the model and outputs expand along the main axis. Functions at the same flow depth share a radial layer, while modules and branches occupy stable angular sectors.

Node density expands a layer's angular span. Routing, confluence, split, and crossing pressure adjust only the relevant inter-layer spacing. Once real function positions are frozen, routing can move only virtual junctions, waypoints, and multi-lane shared corridors.

The defining rule is: **visual simplification must never change program semantics.** A Confluence exists only for real data convergence. A visual corridor used to reduce crossings preserves every semantic channel, lane order, and source-to-target trace.

### Evidence before conclusions

Parser, compiler/LSP, knowledge rules, runtime observations, tests, benchmarks, and SMT results remain separate. A rule match is a review lead, a runtime event is a sampled fact, and a proof is valid only within its stated model.

Users can inspect why something changed color, which code triggered it, how reliable it is, what evidence is missing, and how to validate or repair it.

### Local knowledge and DeepWeb evidence fusion

The local knowledge model covers language APIs, algorithms, complexity, performance, security, stability, environments, dependencies, hardware boundaries, failure modes, and repair recipes.

DeepWeb is not a general-purpose LLM and does not replace a compiler or solver. It is a local, task-specific multidimensional evidence-fusion and ranking kernel. It maps code features, graph structure, rule matches, environments, experiments, and repair outcomes into candidate risks and priorities while retaining teacher evidence, confidence, and training gates.

High score alone does not promote a candidate into stable knowledge. Results without trusted evidence or successful repair replay remain candidates, reducing the risk of self-reinforcing errors in a system with limited user feedback.

### Program digital twin

Static analysis describes what code may do. Controlled execution records what happened for a specific input. The digital twin combines both for dynamic simulation, stress inputs, fault propagation, algorithm substitution, resource and stability tradeoffs, security assertions, and environment migration.

Without a real runtime sample, an experiment remains explicitly modeled or estimated. Predicted performance is never presented as a benchmark.

### Repair as a reversible workflow

A candidate moves through exact source capture, suggested code, diff generation, project-copy A/B, regression and security gates, user approval, hash-bound write-back, and one-click rollback.

The objective is not “fastest at any cost.” It is a suitable balance of performance, stability, security, resource use, and maintainability.

### Local-first security boundary

CodeFlow Inspector is a desktop application. Core native work does not depend on a localhost service. Tauri IPC connects the interface to the Rust host, and project evidence is persisted locally.

Public network access is off by default. Knowledge updates require explicit allow-listed authorization. Controlled runs use fixed adapters, temporary project copies, resource limits, child-process cleanup, and available OS isolation. Reports are generated locally.

## Implemented technology

### Desktop and interface

- Tauri 2 desktop shell and native IPC.
- React 19, Next.js 16, TypeScript, and a Vite desktop pipeline.
- Separate Chinese and English release builds.
- Multi-project isolation, backup and restore, and native SQLite persistence.

### Parsing and program graphs

- Multi-language Tree-sitter AST support, including TypeScript/JavaScript, Python, Java, C/C++, Go, Rust, C#, Kotlin, PHP, Ruby, Swift, Shell, and SQL.
- A TypeScript Compiler bridge and optional LSP adapter chain.
- Detection of system or managed Pyright, JDT LS, clangd, gopls, and rust-analyzer installations.
- Functions, calls, control flow, definitions/uses, source-to-sink paths, aliases, heap objects, and bounded concurrency models.
- Adaptive Flow-First Fan Layout, multi-lane corridors, and local crossing repair.

### Analysis, knowledge, and verification

- Local structures for mathematics, algorithms, efficiency, security, stability, language APIs, environments, hardware, and repair recipes.
- Deterministic rules and multidimensional DeepWeb evidence fusion.
- License, quarantine, replay, signature, activation, and rollback gates for CVE/CWE/KEV/OSV knowledge packs.
- A local Z3 project-contract batch interface; only real solver records count as proof evidence.
- Finding consolidation, source-to-sink security paths, and dynamic boundary analysis.

### Runtime, testing, and repair

- Fixed controlled-runtime adapters for Node.js, Python, Java, Rust, C, and C++.
- stdout/stderr, exit code, duration, CPU, peak memory, process tree, and file-change records.
- DAP session interfaces for breakpoints, stacks, scopes, and variables.
- Functional, smoke, regression, integration, performance, load, usability, and repair-validation orchestration.
- Candidate diffs, A/B replay, safe write-back, and integrity-checked rollback snapshots.
- Structured local PDF reporting.

## How it complements existing tools

| Tool category | Primary answer | CodeFlow Inspector adds |
| --- | --- | --- |
| IDE / code browser | Where is the definition and who calls it? | The full data path, module purpose, and evidence context |
| Static scanner | Which patterns may be dangerous? | Propagation, evidence grades, missing conditions, and runtime validation |
| Profiler | What was slow in one run? | Algorithm alternatives, stability, resources, and repair A/B |
| Architecture diagram | What does the system look like? | A code-derived model with file, function, and source-to-sink drill-down |
| Remote AI assistant | Can the code be explained conversationally? | Local analysis, deterministic evidence, and no required source upload |

The product does not try to replace every specialist tool. It organizes their kinds of evidence into one understandable and testable system view.

## Use cases

- Onboarding into an unfamiliar or undocumented codebase.
- Explaining software behavior and risk to non-developers.
- Reviewing propagation from external inputs to sensitive sinks.
- Building evidence for refactoring, algorithm replacement, or environment migration.
- Validating a candidate repair before source write-back.
- Producing traceable reports for security, testing, and maintenance discussions.
- Teaching program structure, data flow, and evidence boundaries together.

## What it is not

- It is not a certified security product that guarantees every vulnerability will be found.
- It is not a general-purpose large language model.
- It is not infinitely precise across every dynamic language feature or concurrency interleaving.
- It is not an autonomous agent that can safely rewrite production code without testing.
- It is not a cloud source-code host.

Reflection, runtime code generation, FFI, macros, cross-language internals, and real concurrency may still require dynamic traces or specialist tools.

## Current release position

The current release is suitable as a public noncommercial Alpha / Research Preview for gathering reproducible feedback on parsing, layouts, evidence quality, runtime compatibility, and workflows.

The desktop product path is present, but maturity comes from continued validation rather than the number of named features. Minimal sanitized projects are especially valuable for improving language adapters, graph routing, failure samples, benchmarks, and repair replay.

## Vision

Code analysis should give every software stakeholder an explorable system map rather than an isolated alert list:

> Understand what it does, trace where data goes, distinguish fact from inference, and see the cost before making the change.
