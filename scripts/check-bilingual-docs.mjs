import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const pairs = [
  ["README.en-US.md", "README.zh-CN.md"],
  ["CONTRIBUTING.md", "CONTRIBUTING.zh-CN.md"],
  ["LICENSE.md", "LICENSE.zh-CN.md"],
  ["SECURITY.md", "SECURITY.zh-CN.md"],
  ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.zh-CN.md"],
  [".github/PULL_REQUEST_TEMPLATE.md", ".github/PULL_REQUEST_TEMPLATE.zh-CN.md"],
  ["docs/User-Guide.md", "docs/用户使用手册.md"],
  ["docs/Product-Vision-and-Technology.md", "docs/产品理念与技术介绍.md"],
  ["docs/Language-Tool-Installation.md", "docs/语言工具安装指南.md"],
  ["docs/CodeFlow-Test-Software-API.md", "docs/CodeFlow测试软件接口文档.md"],
  ["docs/GitHub-Public-Preview-Audit-2026-08-25.md", "docs/GitHub公开预览审计-2026-08-25.md"],
  ["docs/GitHub-Release-Checklist.md", "docs/GitHub发布清单.md"],
  ["docs/LSP-Sidecar-Management.md", "docs/LSP-Sidecar管理.md"],
  ["docs/LSP-Default-Import-Chain.md", "docs/LSP默认导入链.md"],
  ["docs/macos-dap-replay-validation.md", "docs/macos-dap-replay-validation.zh-CN.md"],
  ["docs/Data-Path-Aggregation-View-Design-2026-08-14.md", "docs/数据路径汇聚视图设计记录-2026-08-14.md"],
  ["docs/Knowledge-Package-Phase-1-Archive.md", "docs/知识包第一阶段封存记录.md"],
  ["docs/Supplemental-Knowledge-Evidence-Package-Format.md", "docs/补充知识证据包格式.md"],
  ["docs/Runtime-Cost-Extension-API-GitHub-Preparation-2026-08-23.md", "docs/运行成本-扩展接口-GitHub准备-2026-08-23.md"],
  ["docs/Non-Hydrology-Core-v1-Engineering-Certification-2026-08-12.md", "docs/非水流Core-v1工程认证-2026-08-12.md"],
  ["docs/Documentation-Index.md", "docs/文档索引.md"],
  [".github/ISSUE_TEMPLATE/bug-report.yml", ".github/ISSUE_TEMPLATE/bug-report-zh-CN.yml"],
  [".github/ISSUE_TEMPLATE/feature-request.yml", ".github/ISSUE_TEMPLATE/feature-request-zh-CN.yml"],
];

const canonicalBilingual = new Set(["README.md"]);
const paired = new Set(pairs.flat());
const errors = [];

for (const [english, chinese] of pairs) {
  for (const file of [english, chinese]) {
    if (!existsSync(file)) {
      errors.push(`missing: ${file}`);
      continue;
    }
    const meaningfulLines = readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("<!--")).length;
    if (meaningfulLines < 4) errors.push(`translation appears empty: ${file}`);
  }
}

const trackedMarkdown = execFileSync("git", ["-c", "core.quotepath=false", "ls-files", "--", "*.md"], {
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean);

const untrackedMarkdown = execFileSync(
  "git",
  ["-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard", "--", "*.md"],
  { encoding: "utf8" },
)
  .split(/\r?\n/)
  .filter(Boolean);

for (const file of [...trackedMarkdown, ...untrackedMarkdown]) {
  if (!paired.has(file) && !canonicalBilingual.has(file)) {
    errors.push(`public Markdown has no declared language pair: ${file}`);
  }
}

if (errors.length) {
  console.error("Bilingual documentation check failed:\n" + errors.map((e) => `- ${e}`).join("\n"));
  process.exit(1);
}

console.log(`Bilingual documentation check passed: ${pairs.length} pairs plus README.md.`);
