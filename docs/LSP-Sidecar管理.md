# LSP Sidecar 管理

## 目标

桌面程序不再只依赖终端的 `PATH`。LSP 工具按以下优先级解析：

1. 单工具环境变量覆盖，供开发和故障恢复使用。
2. 应用数据目录中的 managed package。
3. 安装包资源目录中的 bundled sidecar。
4. 系统已安装工具，仅作为开发回退。

状态页会区分 `bundled`、`managed`、`system`、`missing` 和 `disabled`。系统工具可以生成真实语义证据，但只有 sidecar 文件的 SHA-256 与构建锁完全一致时才显示“已校验”。

## 工具形态

| 工具 | 形态 | 完整安装包要求 |
| --- | --- | --- |
| Pyright | Node runtime package | 独立 Node runtime、Pyright 文件和相对路径 launcher |
| JDT LS | JVM runtime package | JDT LS 插件目录、受控 JRE 和相对路径 launcher |
| clangd | native binary | 对应平台 clangd 和许可证 |
| gopls | native binary | 对应平台 gopls、Go SDK 或明确的 SDK 依赖 |
| rust-analyzer | native binary | 对应平台 rust-analyzer、Rust sysroot/toolchain |

只复制 Homebrew 的 Pyright/JDT LS 启动脚本是不完整的，因为脚本仍引用 Homebrew 的 Node、Java 或 Cellar 路径。构建脚本会拒绝缺少 `VERSION` 或 launcher 的包，避免生成只能在开发机运行的假 sidecar。

## 包目录

```text
src-tauri/lsp-sidecars/<target>/
  checksums.json
  pyright/
    VERSION
    bin/pyright-langserver
  jdtls/
    VERSION
    bin/jdtls
  clangd/
    VERSION
    bin/clangd
  gopls/
    VERSION
    bin/gopls
  rust-analyzer/
    VERSION
    bin/rust-analyzer
```

`npm run desktop:lock-sidecars` 会检查五个包，生成目标三元组文件名、SHA-256 构建锁和 `tauri.sidecars.generated.json`。`npm run desktop:build:sidecars` 只在锁定成功后构建带 sidecar 的安装包。

## 当前开发机证据

当前 macOS ARM64 开发机已安装并真实启动：

- Pyright 1.1.411
- Eclipse JDT LS 1.60.0
- clangd 17
- gopls 0.23.0
- rust-analyzer 2026-07-27

测试不是简单执行 `--version`，而是启动 JSON-RPC/LSP 会话，完成 initialize、打开文件、documentSymbol、hover、definition、references 和 diagnostics 请求。clangd 另有宏语义 AST 测试。

这表示当前开发机达到 `system-ready`，不等于跨机器安装包达到 `verified`。跨平台发布仍需要 CI 为 macOS ARM64/x64、Windows x64/ARM64、Linux x64/ARM64 准备完整可迁移工具包，并完成签名和许可证归档。
