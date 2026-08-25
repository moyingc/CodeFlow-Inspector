"use client";

import { type ReactNode, useEffect } from "react";

const productTerms: Array<[string, string]> = [
  ["湖泊/水库", "集合/缓存节点"],
  ["溪流汇聚口", "汇聚节点"],
  ["分岔溪口", "分支节点"],
  ["函数水系", "函数数据流"],
  ["水文模型", "数据流模型"],
  ["水文图", "数据流图"],
  ["水系图", "数据流图"],
  ["主河道", "主路径"],
  ["问题水段", "风险路径"],
  ["风险水段", "风险路径"],
  ["警戒水段", "风险节点"],
  ["函数水段", "处理阶段"],
  ["溪流汇聚/分流点", "汇聚/分支点"],
  ["水系边", "数据流边"],
  ["水路", "数据路径"],
  ["水系", "数据流"],
  ["水文", "数据流"],
  ["堤坝", "安全边界"],
  ["阀门", "验证节点"],
  ["水源", "输入节点"],
  ["排水口", "输出节点"],
  ["湖泊", "大型集合"],
  ["水库", "固定集合"],
  ["水池", "有界缓冲"],
  ["河流", "高通量路径"],
  ["河道", "常规路径"],
  ["小溪", "轻量路径"],
  ["溪流", "支线路径"],
  ["源头", "输入节点"],
  ["出海", "输出"],
  ["溢流", "容量超限"],
  ["回流", "循环路径"],
];

const englishTerms: Array<[string, string]> = [
  ["集合/缓存节点", "Collection/Cache Node"],
  ["汇聚节点", "Merge Node"],
  ["分支节点", "Branch Node"],
  ["函数数据流", "Function Data Flow"],
  ["数据流模型", "Data Flow Model"],
  ["主路径", "Main Path"],
  ["风险路径", "Risk Path"],
  ["风险节点", "Risk Node"],
  ["处理阶段", "Processing Stage"],
  ["汇聚/分支点", "Merge/Branch Point"],
  ["数据流边", "Data Flow Edge"],
  ["数据路径", "Data Path"],
  ["安全边界", "Security Boundary"],
  ["验证节点", "Validation Node"],
  ["输入节点", "Input Node"],
  ["输出节点", "Output Node"],
  ["大型集合", "Large Collection"],
  ["固定集合", "Fixed Collection"],
  ["有界缓冲", "Bounded Buffer"],
  ["高通量路径", "High-throughput Path"],
  ["常规路径", "Standard Path"],
  ["轻量路径", "Lightweight Path"],
  ["支线路径", "Branch Path"],
  ["容量超限", "Capacity Exceeded"],
  ["循环路径", "Loop Path"],
  ["项目与文件解析", "Project and File Analysis"],
  ["总体说明", "Overview"],
  ["软件架构", "Software Architecture"],
  ["设计反推", "Inferred Design"],
  ["文件职责", "File Responsibilities"],
  ["功能模块", "Functional Modules"],
  ["解析证据", "Analysis Evidence"],
  ["函数关系", "Function Relationships"],
  ["函数路径", "Function Path"],
  ["项目数据路径", "Project Data Path"],
  ["项目中心", "Project Center"],
  ["文件解析", "File Analysis"],
  ["模块解析", "Module Analysis"],
  ["问题诊断", "Diagnostics"],
  ["孪生实验", "Twin Experiments"],
  ["分析内核", "Analysis Core"],
  ["本地知识", "Local Knowledge"],
  ["CodeFlow 证据质量", "CodeFlow Evidence Quality"],
  ["DeepWeb 证据质量", "DeepWeb Evidence Quality"],
  ["代码树与数据流图", "Code Tree and Data Flow"],
  ["数据流完整性", "Data Flow Integrity"],
  ["数据流闭合度", "Flow Completeness"],
  ["数据流总览", "Data Flow Overview"],
  ["数据流图", "Data Flow"],
  ["代码树", "Code Tree"],
  ["调用流", "Call Flow"],
  ["文件层级", "File Hierarchy"],
  ["项目总览", "Project Overview"],
  ["项目管理", "Project Management"],
  ["函数解析", "Function Analysis"],
  ["分析报告", "Analysis Report"],
  ["项目完整分析报告", "Complete Project Analysis Report"],
  ["问题报告", "Issue Report"],
  ["安全报告", "Security Report"],
  ["孪生实验报告", "Digital Twin Report"],
  ["修复建议与验证状态", "Repair Recommendations and Validation"],
  ["修复候选详情", "Repair Candidate Details"],
  ["沙箱候选与模拟结果", "Sandbox Candidates and Simulation Results"],
  ["载入沙箱验证", "Load into Sandbox Validation"],
  ["主控代码树与执行轨迹", "Controller Code Tree and Execution Trace"],
  ["功能与函数解读", "Feature and Function Explanation"],
  ["导出 PDF", "Export PDF"],
  ["PDF 将在本机生成，不上传报告内容。", "The PDF is generated locally; report content is never uploaded."],
  ["正在本机排版并生成 PDF", "Formatting and generating the PDF locally"],
  ["适合窗口", "Fit to View"],
  ["适合", "Fit"],
  ["回滚快照", "Rollback Snapshot"],
  ["审批状态", "Approval Status"],
  ["改动文件", "Changed Files"],
  ["验证证据", "Validation Evidence"],
  ["总体结论", "Overall Conclusion"],
  ["直接结论", "Direct Conclusion"],
  ["哪些结论还不能确认", "Conclusions Requiring More Evidence"],
  ["当前导入项目缺少以下证据。这不是软件开发进度，而是这些分析结论暂时不能被可靠确认。", "The imported project lacks the following evidence. This is not product development status; these conclusions cannot yet be verified reliably."],
  ["选择问题、安全、实验或修复条目，可以查看完整证据和后续动作。", "Select an issue, security, experiment, or repair entry to inspect its evidence and next action."],
  ["统一扩展接口", "Unified Extension Interfaces"],
  ["扩展库与适配器导入", "Extension Library and Adapter Import"],
  ["导入扩展声明", "Import Extension Manifest"],
  ["下载声明模板", "Download Manifest Template"],
  ["移除声明", "Remove Manifest"],
  ["运行成本与本机承载", "Runtime Cost and Host Capacity"],
  ["运行成本", "Runtime Cost"],
  ["峰值内存", "Peak Memory"],
  ["本地磁盘", "Local Disk"],
  ["进程与并发", "Processes and Concurrency"],
  ["预计峰值内存", "Projected Peak Memory"],
  ["预计逻辑线程", "Projected Logical Threads"],
  ["预计本地磁盘", "Projected Local Disk"],
  ["本机内存", "Host Memory"],
  ["当前可用内存", "Available Memory"],
  ["当前可用磁盘", "Available Disk"],
  ["评估置信度", "Assessment Confidence"],
  ["计算依据与降低成本建议", "Calculation Evidence and Cost Reduction"],
  ["本机", "Host"],
  ["证据", "Evidence"],
  ["本页目录", "Page Contents"],
  ["函数检查器", "Function Inspector"],
  ["软件解析", "Software Interpretation"],
  ["功能解读", "Functional Explanation"],
  ["技术说明", "Technical Description"],
  ["设计反推报告", "Inferred Design Report"],
  ["完整主流程", "Complete Main Flow"],
  ["功能模块清单", "Functional Modules"],
  ["文件职责清单", "File Responsibilities"],
  ["证据来源", "Evidence Sources"],
  ["函数职责详解", "Function Responsibilities"],
  ["安全检查", "Security Analysis"],
  ["运行环境", "Runtime Environment"],
  ["本地知识库", "Local Knowledge Base"],
  ["数字孪生", "Digital Twin"],
  ["修复中心", "Repair Center"],
  ["本地解析层", "Local Parser"],
  ["主控入口", "Entry Point"],
  ["安全边界", "Security Boundary"],
  ["项目诊断概览", "Project Diagnostics"],
  ["当前项目", "Current Project"],
  ["导入或创建项目", "Import or Create Project"],
  ["导入项目", "Import Project"],
  ["选择代码文件", "Select Code Files"],
  ["选择项目文件夹", "Select Project Folder"],
  ["导入代码文件", "Import Code Files"],
  ["导入整个文件夹", "Import Folder"],
  ["创建草稿项目", "Create Draft Project"],
  ["语言覆盖", "Language Coverage"],
  ["解析技术与证据", "Parser Technology and Evidence"],
  ["本地模型", "Local Models"],
  ["本地解析", "Local Parsing"],
  ["数据流角色", "Data Flow Role"],
  ["传递数据与边界", "Transferred Data and Boundaries"],
  ["检查与推荐", "Checks and Recommendations"],
  ["设置断点", "Set Breakpoint"],
  ["启动调试并暂停", "Start Debugging and Pause"],
  ["断点会让程序运行到指定代码位置时暂停，便于查看当时的调用栈、变量和值。", "A breakpoint pauses execution at a selected code location so you can inspect the call stack, variables, and values."],
  ["取消断点", "Remove Breakpoint"],
  ["建议代码", "Suggested Code"],
  ["代码错误解析", "Error Explanation"],
  ["拖动画布 · 滚动查看", "Drag Canvas · Scroll to Explore"],
  ["图谱缩放", "Graph Zoom"],
  ["缩小", "Zoom Out"],
  ["复位", "Reset"],
  ["导航样式", "Navigation Style"],
  ["当前分析状态", "Current Analysis"],
  ["风险类型", "Risk Types"],
  ["等待导入", "Waiting for Import"],
  ["等待选择", "Waiting for Selection"],
  ["未识别", "Not Detected"],
  ["文件", "Files"],
  ["函数", "Functions"],
  ["模块", "Modules"],
  ["项目", "Projects"],
  ["解析", "Analysis"],
  ["实验", "Experiments"],
  ["系统", "System"],
  ["输入", "Input"],
  ["输出", "Output"],
  ["处理", "Processing"],
  ["算法", "Algorithm"],
  ["数据结构", "Data Structure"],
  ["边界", "Boundary"],
  ["问题", "Issues"],
  ["置信度", "Confidence"],
  ["位置", "Location"],
  ["复杂度", "Complexity"],
  ["解析证据", "Parser Evidence"],
];

// Dynamic analysis text is assembled from project evidence at runtime. These
// fragments keep the English desktop edition English without using a network
// translator or changing imported source code shown in raw-code containers.
const englishDynamicTerms: Array<[string, string]> = [
  ["当前没有足够函数可展开", "There are not enough functions to expand"],
  ["导入完整文件夹后", "After importing the complete project folder"],
  ["这里会按模块列出每个", "this section lists every"],
  ["在软件里的职责、输入、输出、上下游和证据", "with its responsibility, inputs, outputs, upstream and downstream links, and evidence"],
  ["这段代码主要在做", "This code primarily implements"],
  ["这组代码整体在做", "This codebase primarily implements"],
  ["从代码结构反推", "Based on the code structure"],
  ["这个项目不是一组零散工具函数", "this project is not a collection of unrelated utility functions"],
  ["而是围绕", "but is organized around"],
  ["组织起来的软件", "as a software system"],
  ["负责把入口、业务处理、数据保存和输出串起来", "connects entry points, business processing, persistence, and outputs"],
  ["是当前最像起点的函数", "is the most likely current entry function"],
  ["它先接收", "It first receives"],
  ["再把数据交给不同模块处理", "then passes data to different modules"],
  ["最后形成", "and finally produces"],
  ["这些输出或状态变化", "these outputs or state changes"],
  ["这个判断来自", "This conclusion is based on"],
  ["不是只看某一个关键词", "rather than a single keyword"],
  ["当前自动归纳出的核心模块是", "The inferred core modules are"],
  ["中间的函数不是孤立执行的", "The functions in the middle do not run in isolation"],
  ["有的负责", "some are responsible for"],
  ["最后数据会流向", "The data finally flows to"],
  ["当前优先检查项是", "The current priority checks are"],
  ["这些结论仍然是静态代码反推", "These conclusions are still inferred from static code"],
  ["业务正确性还需要", "Business correctness still requires"],
  ["来验证", "for validation"],
  ["主要负责", "is mainly responsible for"],
  ["输入是", "Inputs:"],
  ["输出是", "Outputs:"],
  ["上游来自", "Upstream:"],
  ["会把数据交给", "Passes data to"],
  ["当前没有识别到明确下游函数", "No explicit downstream function was identified"],
  ["可能是入口、事件回调或独立工具函数", "It may be an entry point, event callback, or standalone utility"],
  ["保护动作", "Guards"],
  ["副作用", "Side effects"],
  ["风险提示", "Risk note"],
  ["暂未命中高置信风险", "No high-confidence risk was detected"],
  ["未识别到明显校验", "No explicit validation was identified"],
  ["主要通过返回值或内部结果继续传递", "Primarily propagated through return values or internal results"],
  ["函数名、文件路径、参数/返回、调用边", "function name, file path, parameters/return value, and call edges"],
  ["入口函数", "entry function"],
  ["主控文件", "controller file"],
  ["调用图", "call graph"],
  ["依赖/环境", "dependencies/environment"],
  ["本地规则命中", "local rule matches"],
  ["问题候选", "issue candidates"],
  ["等待真实运行样本", "Waiting for real runtime samples"],
  ["尚无", "None yet"],
  ["暂未", "Not yet"],
  ["未识别", "Not identified"],
  ["当前", "Current"],
  ["函数参数/外部输入", "function parameters/external inputs"],
  ["依赖库", "dependencies"],
  ["环境配置", "environment configuration"],
  ["代码里的隐式上下文和内部变量", "implicit code context and internal variables"],
  ["状态变化", "state changes"],
  ["下游副作用", "downstream side effects"],
  ["固定文本/常量结果", "fixed text/constant result"],
  ["结构化对象", "structured object"],
  ["列表结果", "list result"],
  ["处理阶段", "processing stages"],
  ["调用边", "call edges"],
  ["个函数", "functions"],
  ["个问题", "issues"],
  ["条", ""],
  ["个", ""],
];

function stripUntranslatedHan(value: string) {
  if (!/[\u3400-\u9fff]/u.test(value)) return value;
  const identifiers = value.match(/[A-Za-z_$][\w$./:-]*/g)?.slice(0, 8).join(", ");
  const numbers = value.match(/\d+(?:\.\d+)?%?/g)?.slice(0, 6).join(", ");
  const evidence = [identifiers, numbers].filter(Boolean).join(" · ");
  return evidence ? `Technical analysis detail: ${evidence}.` : "Technical analysis detail.";
}

function replaceTerms(value: string, locale: "zh-CN" | "en-US") {
  let result = value;
  productTerms.forEach(([from, to]) => { result = result.replaceAll(from, to); });
  if (locale === "en-US") {
    englishDynamicTerms.forEach(([from, to]) => { result = result.replaceAll(from, to); });
    englishTerms.forEach(([from, to]) => { result = result.replaceAll(from, to); });
    result = stripUntranslatedHan(result);
  }
  return result;
}

function shouldSkip(node: Node) {
  const parent = node.parentElement;
  return Boolean(parent?.closest("code, pre, textarea, script, style, [data-raw-content='true']"));
}

function translateTree(root: Node, locale: "zh-CN" | "en-US") {
  if (root.nodeType === Node.TEXT_NODE && !shouldSkip(root)) {
    const current = root.nodeValue ?? "";
    const next = replaceTerms(current, locale);
    if (next !== current) root.nodeValue = next;
  }
  if (root instanceof Element) {
    ["aria-label", "title", "placeholder"].forEach((attribute) => {
      const current = root.getAttribute(attribute);
      if (!current) return;
      const next = replaceTerms(current, locale);
      if (next !== current) root.setAttribute(attribute, next);
    });
  }
  root.childNodes.forEach((child) => translateTree(child, locale));
}

export function ProductPresentationBoundary({ children, locale }: { children: ReactNode; locale: "zh-CN" | "en-US" }) {
  useEffect(() => {
    translateTree(document.body, locale);
    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        if (record.type === "characterData") translateTree(record.target, locale);
        record.addedNodes.forEach((node) => translateTree(node, locale));
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [locale]);

  return children;
}
