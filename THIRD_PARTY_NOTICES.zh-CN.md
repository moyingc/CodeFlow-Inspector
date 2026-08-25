# 第三方声明

CodeFlow Inspector 使用开源库，并可集成可选语言与调试 sidecar。本仓库不提交本地安装的 sidecar 二进制文件。发行打包必须从清单声明的上游来源获取或准备这些文件，核对锁定校验和，并保留相应许可证声明。

权威工具清单位于：

- `src-tauri/lsp-sidecars/manifest.json`
- `src-tauri/debug-sidecars/manifest.json`
- `src-tauri/licenses/`
- `package-lock.json`
- `src-tauri/Cargo.lock`

重要的可选集成包括 Pyright、Eclipse JDT LS、gopls、rust-analyzer、clangd、Kotlin Language Server、C# Language Server、PHPantom、Ruby LSP、SourceKit-LSP、Bash Language Server、SQL Language Server、debugpy、VS Code JavaScript Debugger、Debugger for Java 和 LLDB DAP。它们分别受各自上游项目许可证约束。

发布安装包之前，应运行 sidecar 审计并检查生成的捆绑声明。源代码构建成功本身并不代表可以重新分发所有可选二进制文件。

英文原文：[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
