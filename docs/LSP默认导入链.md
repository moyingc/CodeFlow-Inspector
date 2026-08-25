# LSP 默认导入链

桌面程序导入项目时使用以下固定顺序：

1. Tree-sitter 按语言 grammar 确认文件结构、函数边界、参数、调用和宏候选位置。
2. 按文件语言选择固定 LSP，不接受项目传入任意命令。
3. 请求 `documentSymbol`、`hover`、`definition`、`references`，并收集编译诊断。
4. Rust 宏站点请求 `rust-analyzer/expandMacro`；C/C++ 宏候选请求 clangd `textDocument/ast`。
5. 用 references 的真实文件和行号补全跨文件调用边，再把证据绑定回函数和水系节点。
6. LSP 缺失、失败或超时只会降级为 Tree-sitter AST，不会伪装成已执行。

## 语言映射

| 语言 | 默认语义服务 | 固定启动方式 |
| --- | --- | --- |
| Python | Pyright | `pyright-langserver --stdio` |
| Java | Eclipse JDT LS | `jdtls -data <temporary-workspace>` |
| C/C++ | clangd | `clangd --background-index=0 --clang-tidy=0 --log=error` |
| Go | gopls | `gopls serve` |
| Rust | rust-analyzer | `rust-analyzer` |

## 本地发现

程序依次检查专用环境变量、当前 `PATH`、Homebrew、`/usr/local/bin`、`~/.cargo/bin`、`~/go/bin` 和 `~/.local/bin`。

桌面版现在还会优先检查应用数据目录中的 managed package 和安装包内的 bundled sidecar；具体目录、校验和发布边界见《LSP-Sidecar管理》。

- `CODEFLOW_PYRIGHT_PATH`
- `CODEFLOW_JDTLS_PATH`
- `CODEFLOW_CLANGD_PATH`
- `CODEFLOW_GOPLS_PATH`
- `CODEFLOW_RUST_ANALYZER_PATH`

环境变量必须指向真实文件。工具状态分为 `missing`、`skipped`、`executed`、`partial` 和 `failed`，页面只把 `executed` 或 `partial` 计为真实语义执行。

## 安全边界

- 只运行五种固定 language server，不使用 shell。
- 待分析代码复制到临时工作区；网络代理指向不可达本地端口。
- Rust 默认关闭 build script、proc macro 和 cache priming，避免导入时执行目标项目构建逻辑。
- Java 默认关闭 autobuild 和 Gradle 自动导入。
- 每个服务有导入超时；超时返回已有事实并标记 `partial`。
- 语义服务是本地可信工具，但编译诊断不等于运行验证，不能直接推进 DeepWeb 成熟训练。

## 当前验证

协议帧、工具缺失诚实检测、Tree-sitter 宏站点抽取均有 Rust 单元测试。本机五个默认 LSP 都已完成真实协议测试；工具包状态仍会区分 system-ready 与 checksum-verified，不把开发机安装状态冒充为可迁移安装包。
