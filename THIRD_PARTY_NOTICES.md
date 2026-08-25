# Third-party notices

CodeFlow Inspector uses open-source libraries and can integrate with optional
language and debug sidecars. This repository does not commit locally installed
sidecar binaries. Release packaging must fetch or prepare them from their
declared upstream source, verify their locked checksum, and retain the relevant
license notice.

The authoritative tool inventory is stored in:

- `src-tauri/lsp-sidecars/manifest.json`
- `src-tauri/debug-sidecars/manifest.json`
- `src-tauri/licenses/`
- `package-lock.json`
- `src-tauri/Cargo.lock`

Notable optional integrations include Pyright, Eclipse JDT LS, gopls,
rust-analyzer, clangd, Kotlin Language Server, C# Language Server, PHPantom,
Ruby LSP, SourceKit-LSP, Bash Language Server, SQL Language Server, debugpy,
VS Code JavaScript Debugger, Debugger for Java, and LLDB DAP. Their licenses
remain governed by their respective upstream projects.

Before publishing an installer, run the sidecar audit and inspect the generated
bundle notices. A successful source build does not by itself grant permission to
redistribute every optional binary.
