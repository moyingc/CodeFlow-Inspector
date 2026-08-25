# GitHub Release Checklist

Chinese version: [GitHub发布清单.md](GitHub发布清单.md)

## Public Positioning

Publish the current version as an Alpha / Research Preview for sanitized projects, reproducible defects, and community feedback. Do not claim production-grade security proof.

## Required Checks

```bash
npm ci
npm run lint
npm test
cd src-tauri && cargo test --locked --lib
```

macOS local packages:

```bash
npm run desktop:build:zh
npm run desktop:build:en
npm run desktop:checksums
```

Windows and Linux must be built by `.github/workflows/cross-platform-controlled-runtime.yml` on their matching GitHub runners. macOS static checks do not replace installation acceptance on those systems.

## Upload Only Required Content

- Keep `app`, `src`, `src-tauri/src`, `db`, `drizzle`, `tests`, `scripts`, public documentation, build configuration, and workflows.
- Exclude `node_modules`, `target`, `dist`, installers, local sidecar binaries, temporary PDFs, caches, generated configuration, and private development journals.
- Sidecar directories retain only manifests, checksum formats, and license notices, not locally installed tools.

## Manual Release Gates

1. Select and add the root `LICENSE`.
2. Confirm whether the project is OSI open source or noncommercial source-available.
3. Review `THIRD_PARTY_NOTICES.md` and every sidecar license included in the actual installer.
4. Validate PDF, twin experiments, repair A/B, and rollback with a sanitized sample.
5. Enable GitHub Private Vulnerability Reporting, branch protection, and required checks.
