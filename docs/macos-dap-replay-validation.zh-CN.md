# macOS DAP Sidecar 回放验证

日期：2026-08-08  
目标平台：aarch64-apple-darwin

## 桌面边界

- 产品是 Tauri 桌面应用，并使用 Tauri IPC。
- 产品不部署或依赖 localhost HTTP 服务。
- 必须使用套接字的 DAP 适配器仅允许使用临时 `127.0.0.1` 进程间通信。
- macOS 沙箱拒绝外部网络访问，仅允许 localhost DAP 流量。

## 锁定的适配器

- vscode-js-debug 1.102.0
- 面向 CPython 3.11 的 debugpy 1.8.16
- vscode-java-debug 0.58.5 / Java Debug plugin 0.53.2
- Apple LLDB DAP 主机适配器，以及锁定的包装器、参考二进制文件和许可证记录

所有受管包文件列在 `src-tauri/debug-sidecars/aarch64-apple-darwin/checksums.json` 中，包级汇总锁定在 `src-tauri/debug-sidecars/manifest.json` 中。

## 已通过的真实回放门禁

- Python：initialize、已验证断点、stopped、threads、stack、scopes、variables、continue、terminated 和进程清理。
- Node：父级/目标 DAP 会话、临时断点经真实断点停止解析、stack、scopes、variables、continue、terminated 和会话清理。
- Java：JDT LS 包安装、`vscode.java.startDebugSession`、DAP initialize、编译类启动、已验证断点、stack、scopes、variables、continue 和 terminated。
- LLDB：带调试符号的真实 C 编译、DAP initialize、已验证断点、stack、scopes、variables、continue 和进程退出。

Rust 与 C++ 现在拥有独立的 LLDB DAP 编译夹具，覆盖已验证断点、停止事件、stack/scopes/variables、continue 和进程退出。完整 Cargo/CMake 工程构建编排仍是不同于语言级 DAP 验证的独立能力。

## 剩余产品集成

适配器包与回放协议已经验证。公开 Tauri 命令仍需活会话协调器，在多次 UI 调用之间持有适配器和被调试进程。在协调器接通前，`codeflow_debug_launch` 会有意拒绝执行导入项目代码。

英文原文：[macos-dap-replay-validation.md](macos-dap-replay-validation.md)
