# CodeFlow Inspector Knowledge Package Phase 1 Archive

Chinese version: [知识包第一阶段封存记录.md](知识包第一阶段封存记录.md)

Archive date: 2026-08-02  
Scope: official OSV, NVD, MITRE CWE, and CISA KEV supply chain  
Conclusion: the phase-one engineering chain is complete; knowledge maturity reaches 60% only after a four-source package passes quality gates and is activated.

## 1. Archived Capability

```text
official download -> SHA-256 raw archive -> normalization -> per-record license gate
-> unknown-license quarantine -> four-source replay -> local HMAC-SHA256 integrity signature
-> manual activation -> atomic switch -> previous-version rollback -> append-only audit
```

- OSV reads the modified index and selected advisories; unknown upstream licensing remains quarantined.
- NVD reads CVE 2.0 by modification window and retains CVE, CWE, CPE, CVSS severity, and references.
- CWE reads official ZIP/XML and normalizes weakness ID, abstraction, and description.
- KEV reads official JSON and retains exploitation priority, added date, remediation deadline, and required action.
- All four sources are mandatory. Activation requires a validation score of at least 90 plus revalidated content hash and local signature.
- SQLite triggers forbid updates or deletion of raw artifacts and audit events.

## 2. Database Boundary

| Table | Purpose |
| --- | --- |
| `knowledge_sources` | Official source, license, attribution, last-check state |
| `knowledge_pack_versions` | Manifest, hashes, signatures, activation state |
| `knowledge_raw_artifacts` | Immutable official artifacts and SHA-256 |
| `knowledge_records` | Normalized vulnerability, weakness, and priority records |
| `knowledge_validation_runs` | Format, license, replay, and signature gates |
| `knowledge_pack_state` | Current and previous version pointers |
| `knowledge_pack_events` | Append-only download, archive, activation, rollback log |

Runtime schema, Drizzle schema, and migration `0024_knowledge_pack_supply_chain.sql` are aligned.

## 3. Legal-Use Gates

Download permission is not redistribution permission. NVD attribution and non-endorsement are retained; MITRE copyright, trademark, and Terms of Use identifiers remain with CWE; OSV records inherit authoritative upstream licensing and unknown records stay out of the active set; KEV is remediation-priority evidence, not proof of current exploitability. The phase-one HMAC detects local tampering and is not a public publisher signature; future cross-device distribution should use Ed25519/TUF-style signing.

## 4. Desktop Operations

Users can inspect source/license state, import and normalize a package into quarantine, inspect counts and validation, manually activate a signed version, and roll back. Browser preview cannot download, sign, or activate knowledge.

## 5. Acceptance Evidence

- Rust compilation passes.
- Offline tests cover all adapters, unknown OSV license quarantine, four-source completeness, signature changes, and immutable triggers.
- Live replay: `cargo test official_source_adapters_live_smoke -- --ignored --nocapture`.
- On 2026-08-02 all four official endpoints downloaded and normalized successfully; one test passed in about eight seconds.
- Frontend build, ESLint, and Node regression tests pass.

## 6. Completion Meaning

Without an activated official package, maturity remains 38% because only seed data exists. A validated, activated four-source package raises it to 60%, meaning a verifiable official security supply chain exists, not that knowledge is complete. The next Beta work is real experiment orchestration, project dependency-to-CVE/CWE matching, before/after repair validation, and SDK/benchmark/hardware-datasheet packages.

## 7. Explicit Exclusions

Phase one does not claim complete software-error coverage, exploitability from a static hit, public-signature equivalence for local HMAC, or coverage of SDK differences, benchmarks, hardware data sheets, and real repair benefit.
