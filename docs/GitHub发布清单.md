# GitHub 发布清单

## 公开定位

当前版本以 Alpha / Research Preview 发布，用于非机密项目试用、可复现问题和社区反馈。不宣称为生产级安全证明器。

## 必须通过

```bash
npm ci
npm run lint
npm test
cd src-tauri && cargo test --locked --lib
```

macOS 本机构建：

```bash
npm run desktop:build:zh
npm run desktop:build:en
npm run desktop:checksums
```

Windows 和 Linux 必须由 `.github/workflows/cross-platform-controlled-runtime.yml`
在对应 GitHub runner 上构建。不得用 macOS 本机的静态检查代替它们的安装验收。

## 只上传必要内容

- 保留：`app`、`src`、`src-tauri/src`、`db`、`drizzle`、`tests`、`scripts`、公开文档、构建配置和工作流。
- 排除：`node_modules`、`target`、`dist`、安装包、本机 sidecar 二进制、临时 PDF、缓存、生成配置和内部开发日志。
- sidecar 仓库只保留 manifest、校验格式和许可证通知，不上传本机已安装工具。

## 发布前人工门禁

1. 选择并添加根目录 `LICENSE`。
2. 确认是 OSI 开源，还是限制商业用途的 source-available。
3. 审查 `THIRD_PARTY_NOTICES.md` 和实际安装包中的 sidecar 许可证。
4. 用脱敏示例项目验证 PDF、孪生实验、修复 A/B 和回滚。
5. 启用 GitHub Private Vulnerability Reporting、branch protection 和 required checks。
