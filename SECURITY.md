# Security Policy

## Reporting a vulnerability

Do not open a public issue for vulnerabilities that could expose source code, local files, credentials, sandbox escapes, adapter signature bypasses, or network-policy bypasses. After the repository is published, use GitHub Private Vulnerability Reporting under **Security > Advisories > New draft advisory**.

Until the final repository URL is configured, keep the report private and include only a minimal sanitized reproduction.

## Local-first boundary

- Project source and reports remain local unless the user explicitly exports them.
- Public network access is denied by default and knowledge updates require an explicit allow-listed authorization.
- Controlled execution uses a temporary project copy, fixed adapters, resource limits, process-tree cleanup, and OS isolation.
- Declarative extension manifests cannot contain executable commands or scripts. Executable sidecars require a separately verified installation path.

## Supported versions

Security fixes target the latest published desktop release. Pre-release builds are supported on a best-effort basis and should not be used with confidential projects without local validation.
