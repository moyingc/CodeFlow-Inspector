# Language Tool Installation

[中文](语言工具安装指南.md) | [Back to English documentation](../README.en-US.md)

## Are these tools required?

No. CodeFlow Inspector can be installed, started, and used to import projects without third-party language servers.

When a tool below is absent, the application still uses Tree-sitter, compiler bridges, local rules, and its local knowledge base. Results that need cross-file types, definitions, references, macros, or compiler diagnostics are explicitly marked as lacking LSP evidence.

Install only the tools needed by the projects you analyze:

| Project language | Optional tool | Additional evidence |
| --- | --- | --- |
| Python | Pyright | Types, definitions, references, and diagnostics |
| Java | Eclipse JDT LS | Type graph, annotations, definitions, references, and compiler diagnostics |
| C / C++ | clangd | Types, macros, pointer semantics, references, and compiler diagnostics |
| Go | gopls | Packages, types, definitions, references, and diagnostics |
| Rust | rust-analyzer | Crates, types, ownership-related semantics, definitions, and references |

## Security notice

CodeFlow Inspector does not silently connect to the network or install third-party software. Use the official sources linked below and review each project's license before installation. Your operating system, official installer, or package manager performs the installation; CodeFlow Inspector only detects and invokes the tool.

## Install Pyright

1. Install Node.js from the [official Node.js download page](https://nodejs.org/en/download).
2. Open Terminal, PowerShell, or Windows Terminal and run:

```bash
npm install -g pyright
```

3. Verify the installation:

```bash
pyright --version
pyright-langserver --version
```

Official instructions: [Microsoft Pyright installation](https://github.com/microsoft/pyright/blob/main/docs/installation.md).

## Install Eclipse JDT LS

JDT LS currently requires Java 21 or newer to start.

1. Install Java 21 or newer and verify it:

```bash
java -version
```

2. Download an archive from the [official Eclipse JDT LS milestone page](https://download.eclipse.org/jdtls/milestones/).
3. Extract it and add the extracted `bin` directory to the system `PATH`.
4. On macOS or Linux, grant execute permission if required:

```bash
chmod +x /path/to/jdtls/bin/jdtls
```

5. Verify it:

```bash
jdtls --help
```

Official instructions: [Eclipse JDT LS repository](https://github.com/eclipse-jdtls/eclipse.jdt.ls#installation).

## Install clangd

### macOS

Install Apple Command Line Tools:

```bash
xcode-select --install
clangd --version
```

If clangd is not supplied on the host, follow the [official clangd installation guide](https://clangd.llvm.org/installation) to install LLVM.

### Windows

Download the Windows installer from the [official LLVM releases](https://github.com/llvm/llvm-project/releases). Enable the option that adds LLVM to `PATH`, then open a new PowerShell window and run:

```powershell
clangd --version
```

### Debian / Ubuntu

```bash
sudo apt update
sudo apt install clangd
clangd --version
```

For CMake projects, generate `compile_commands.json` so clangd receives the real compiler flags:

```bash
cmake -S . -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=1
```

## Install gopls

1. Install a supported Go toolchain from the [official Go download page](https://go.dev/dl/).
2. Run:

```bash
go install golang.org/x/tools/gopls@latest
```

3. Verify it:

```bash
gopls version
```

`gopls` is normally installed under `$HOME/go/bin`, which CodeFlow Inspector checks. Official instructions: [gopls installation](https://go.dev/gopls/#installation).

## Install rust-analyzer

1. Install Rust from the [official Rust toolchain page](https://www.rust-lang.org/tools/install).
2. Download the binary matching your operating system and CPU architecture from the [official rust-analyzer releases](https://github.com/rust-lang/rust-analyzer/releases/latest).
3. Follow the [official rust-analyzer binary instructions](https://rust-analyzer.github.io/book/rust_analyzer_binary.html) to extract it, rename it to `rust-analyzer`, and place it in a directory on `PATH`.
4. Add the Rust standard-library source and verify the server:

```bash
rustup component add rust-src
rust-analyzer --version
```

## Make CodeFlow Inspector detect the tools

1. Quit CodeFlow Inspector completely.
2. Install the tools and verify them in a new terminal window.
3. Restart the desktop application.
4. Open **LSP Sidecar Management** on the Hardcore page.
5. The state should change from `missing` to `system` or `managed`.

`system` means CodeFlow Inspector found a real user-installed tool. It can produce semantic evidence, but it is not presented as a bundled sidecar verified by a CodeFlow Inspector build lock.

## The state is still `missing`

- Quit and reopen the application; an existing process does not inherit a newly changed `PATH`.
- Confirm that the commands are named `pyright-langserver`, `jdtls`, `clangd`, `gopls`, and `rust-analyzer`.
- On macOS or Linux, run `command -v tool-name`.
- In Windows PowerShell, run `Get-Command tool-name`.
- On macOS, the application also checks `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `~/.cargo/bin`, `~/go/bin`, and `~/.local/bin`.

If the command works in a terminal but the application still reports `missing`, open a GitHub Issue with the operating system, CPU architecture, tool version, and sanitized output from `command -v` or `Get-Command`.
