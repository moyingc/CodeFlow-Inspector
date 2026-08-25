# CodeFlow 测试软件接口文档

[English](CodeFlow-Test-Software-API.md)

## 1. 文档范围

本文档描述 CodeFlow 本地桌面软件自身的测试接口。它不是公网 HTTP API 文档，也不是要求被测项目提供接口文档。

测试接口用于把静态解析、真实受控运行、调试、性能样本、修复 A/B 和人工可用性验收统一成可追踪、可导出、可复验的结果。

## 2. 测试编排接口

入口：`src/lib/testing/software-test-plan.ts`

```ts
buildSoftwareTestReport({
  files,
  functions,
  issues,
  experiments,
  runtimeExecutions,
  usabilityPassedIds,
  projectUpdatedAt,
  repair,
}): SoftwareTestReport
```

支持的测试类型：

- `functional`：功能测试
- `smoke`：冒烟测试
- `regression`：回归测试
- `integration`：集成测试
- `performance`：性能测试
- `load`：负载测试
- `usability`：可用性测试
- `repair-verification`：修复结果验证

统一状态：

- `passed`：有与当前版本匹配的通过证据。
- `failed`：真实样本或验证门禁失败。
- `blocked`：缺少执行该测试的必要条件。
- `not-run`：条件可能存在，但当前版本尚未执行或需要复验。

`SoftwareTestResult` 必须包含摘要、证据、缺失条件；失败结果应包含预期、实际、复现步骤、严重度和修复建议。静态扫描不得直接替代真实测试通过结论。

## 3. 版本复验接口

测试报告根据项目文件名和内容哈希生成 `versionFingerprint`。当项目修改时间晚于最后一次真实运行时，历史通过结果会降为 `not-run`，并标记需要重新验证。

版本迭代后的标准流程：

```text
导入新版本 -> 计算指纹 -> 识别旧证据 -> 执行冒烟/回归/集成 ->
执行性能与负载 -> 验证修复 -> 人工可用性确认 -> 导出报告
```

## 3.1 集成执行与进度接口

测试页可勾选功能、冒烟、回归、集成、性能、负载、可用性和修复验证。自动项目按选择顺序进入受控运行器；人工项目与缺少候选的项目只记录条件，不伪造执行结果。

孪生页可勾选静态分析、动态仿真、压力测试、容错传播、算法替换、安全攻击和环境迁移。每次执行或刷新维护统一进度状态：

```ts
type SuiteProgress = {
  running: boolean;
  completed: number;
  total: number;
  current: string;
  message: string;
  updatedAt: number | null;
};
```

页面必须同时显示完成数量、百分比、当前步骤、最近更新时间和进度条。HTTP 预览可以检查选择与进度界面，但不能获得本机代码执行权限。

## 4. 本机受控运行接口

Tauri 命令 `codeflow_run_controlled` 接收固定语言适配器和项目临时副本，不接受任意 shell 字符串。返回 `ControlledRuntimeExecutionReport`，其中包括：

- 编译与退出状态
- stdout、stderr 和截断状态
- 耗时、CPU 时间和峰值内存
- 子进程树
- 文件改动
- trace 与 sanitizer 结果
- 沙箱类型、执行状态和隔离证据

语言扩展必须注册固定命令、入口文件规则、构建步骤、资源上限和健康检查。新增嵌入式或前端语言适配器时仍返回同一结果结构。

## 5. 调试接口

桌面调试会话由以下 Tauri 命令组成：

- `codeflow_debug_availability`
- `codeflow_debug_create_session`
- `codeflow_debug_set_breakpoints`
- `codeflow_debug_launch`
- `codeflow_debug_session`
- `codeflow_debug_continue`
- `codeflow_debug_next`
- `codeflow_debug_step_in`
- `codeflow_debug_step_out`
- `codeflow_debug_pause`
- `codeflow_debug_disconnect`

调试修复验证必须记录断点是否被验证、暂停位置、调用栈、作用域、变量和退出后的进程树清理状态。

## 6. 解析与环境接口

解析链由以下本机命令提供：

- `codeflow_parse_workspace_ast`
- `codeflow_parse_typescript_compiler`
- `codeflow_parse_workspace_lsp`
- `codeflow_lsp_availability`
- `codeflow_lsp_sidecar_status`

解析结果属于测试前置证据。Compiler/LSP 成功只能证明语法、类型、definition 或 references 等语义信息可用，不能单独证明功能测试通过。

## 7. 形式化与安全接口

- `codeflow_run_formal_policy_suite`：运行本地策略证明。
- `codeflow_run_project_smt_batch`：运行项目契约的 SMT 批处理。
- `codeflow_sync_security_assertions`：保存权限、身份和污染攻击断言结果。

形式化证明和安全断言应作为测试证据进入报告，但其适用范围和未证明边界必须保留。

## 8. PDF 报告接口

页面调用 `exportElementAsLocalPdf(element, fileName)`。桌面环境通过 `codeflow_save_report_pdf` 打开系统保存对话框；Web 预览使用浏览器下载。

导出内容必须包括：

- 全部通过结果
- 全部失败结果和缺陷记录
- 阻塞与未执行结果
- 缺失配置提醒
- 当前版本指纹与复验状态
- 运行、性能、修复和安全证据

折叠内容在导出快照中自动展开。报告只在本机生成，不上传项目代码或结果。

## 9. 适配器契约

统一适配器定义位于 `src/lib/extensions/adapter-contract.ts`。每个扩展必须声明：

- `id`
- `kind`
- `contractVersion`
- `input`
- `output`
- `healthCheck`
- `isolation`

测试适配器 ID 为 `testing.project`，输入是项目代码和已有证据，输出是 `SoftwareTestReport`。

## 10. 兼容性与安全约束

- 桌面命令只接受结构化参数，不接受任意 shell。
- 默认禁止被测项目访问公网。
- 测试在临时项目副本中执行。
- 缺失工具、环境或证据必须返回明确状态，不得伪造成功。
- 测试结果写入本地存储或 native SQLite 时必须带项目 ID、版本指纹和时间戳。
- 新接口应保持向后兼容；破坏性变更必须升级 `contractVersion`。
