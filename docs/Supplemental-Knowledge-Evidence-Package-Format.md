# Supplemental Knowledge Evidence Package Format

Chinese version: [补充知识证据包格式.md](补充知识证据包格式.md)

SDK, real-fault, benchmark, hardware-datasheet, and repair-validation evidence uses one offline JSON import format. Record volume does not imply trust. SHA-256, HTTPS provenance, license, RFC3339 time, and kind-specific fields must pass before quarantine; activation replays the package signature and every record hash.

```json
{
  "sourceName": "Example verified lab",
  "sourceUrl": "https://example.org/codeflow-evidence/2026-08",
  "licenseId": "CC-BY-4.0",
  "version": "2026.08",
  "publishedAt": "2026-08-09T12:00:00Z",
  "records": [
    {
      "id": "bench-sort-001",
      "kind": "benchmark",
      "title": "Stable sort comparison",
      "evidence": "Replayed 30 times on the declared host profile",
      "observedAt": "2026-08-09T11:00:00Z",
      "payload": {
        "algorithm": "stable-sort",
        "inputScale": 100000,
        "metrics": { "p50Ms": 18.2, "p95Ms": 20.4, "peakMemoryBytes": 8388608 }
      }
    }
  ]
}
```

Required fields by kind:

- `sdk`: `ecosystem`, `package`, `version`
- `fault`: `language`, `failureMode`, `reproduction`
- `benchmark`: `algorithm`, `inputScale`, `metrics`
- `hardware`: `component`, `datasheet`, `safeBounds`
- `repair`: `ruleId`, `beforeHash`, `afterHash`, `validation`

Import is offline. A package may be downloaded manually, exported by an internal laboratory, or produced by a future source adapter after the network switch is enabled. Unknown license, non-HTTPS provenance, missing reproduction/metric fields, or a hash mismatch causes rejection.
