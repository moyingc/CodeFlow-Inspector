# CodeFlow Inspector 中文说明

[English](README.en-US.md) | [返回首页](README.md)

CodeFlow Inspector 是一款本地优先的**程序分析与代码可视化桌面软件**。它集合静态分析、控制流与数据流分析、软件安全检查、受控运行实验、程序验证和软件数字孪生，将代码项目转换为结构化语义证据。

- [下载 v0.1.0 Alpha 桌面版本](https://github.com/moyingc/CodeFlow-Inspector/releases/tag/v0.1.0-alpha.1)
- [详细使用手册](docs/用户使用手册.md)
- [产品理念与技术介绍](docs/产品理念与技术介绍.md)
- [语言工具安装指南](docs/语言工具安装指南.md)

适用于代码库理解、source-to-sink 污点追踪、软件架构反推、依赖与环境诊断、性能建模、安全分析和带证据门禁的修复实验；分析过程不要求把代码仓库上传到远程大模型 API。

## 当前状态

当前版本为 **Alpha / Research Preview**，适合使用已脱敏、非机密项目试用并提交可复现反馈。候选结论、统计估计、Compiler/LSP 证据、受控运行证据和形式化证明使用不同证据等级，软件不会把未验证推断写成事实。

## 主要能力

- 多项目与文件夹导入，在本地 SQLite 中隔离保存项目、索引和实验记录。
- 通过 Tree-sitter、Compiler 与 LSP 获取 AST、类型、定义、引用、宏和编译诊断。
- 生成函数图、调用流、代码树、文件层级、FSM 和大型项目聚合视图。
- 从 source 到 sink 追踪输入、参数、状态变化、异常路径和敏感操作。
- 在临时项目副本和 OS 隔离边界中进行受控运行、调试、资源观测和数字孪生实验。
- 检查输入验证、权限、SQL/命令/路径注入、资源上限、环境缺失和依赖风险。
- 对候选修复生成 Diff，并通过项目副本中的 A/B 回放、回归和基准对照进行验证。
- 本地生成 PDF 报告，项目源码和报告不会默认上传。

## 语言工具

软件本体可以直接安装和启动，基础静态解析不需要远程大模型 API。为控制安装包体积并避免代替第三方项目分发大型运行时，当前公开安装包不捆绑 Pyright、JDT LS、clangd、gopls 和 rust-analyzer。

缺少这些可选工具时，Tree-sitter 与本地分析仍可工作；跨文件类型、定义、引用、宏和编译诊断会明确标记为缺少 LSP 证据。安装后重启桌面程序，软件会自动检测工具，不需要修改项目源码。

- [中文语言工具安装指南](docs/语言工具安装指南.md)
- [English language tool installation guide](docs/Language-Tool-Installation.md)

真实编译和执行需要本机存在相应的 Node.js、Python、JDK、Rust 或 C/C++ 工具链。软件会检测版本与能力；在用户明确允许前，不自动联网或安装第三方工具。

## 开发环境

需要 Node.js 22+、Rust stable 和 Tauri 2 对应的系统构建依赖。

```bash
npm ci
npm run lint
npm test
npm run desktop:dev
```

HTTP 预览只用于界面开发与回归检查。完整的本地文件访问、SQLite、LSP sidecar、受控运行、调试和系统资源检测必须在 Tauri 桌面程序中进行。

## 反馈与安全

- 普通问题请使用 Bug Report，并附上最小、已脱敏的复现项目。
- 新语言、算法、视图或工作流建议请使用 Feature Request。
- 安全问题请使用 GitHub Private Vulnerability Reporting，不要公开提交。
- 参与开发前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [SECURITY.md](SECURITY.md)。

## 许可证

本项目使用 [PolyForm Noncommercial License 1.0.0](LICENSE.md) 非商业许可。代码公开可查阅、研究、测试和非商业使用，但这不是 OSI 认证的开源许可证。商业使用需要单独授权。
