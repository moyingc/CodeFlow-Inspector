export type CodeFlowAdapterKind = "parser" | "runtime" | "debug" | "knowledge" | "testing" | "report";

export type CodeFlowAdapterManifest = {
  id: string;
  kind: CodeFlowAdapterKind;
  contractVersion: "1.0";
  input: string;
  output: string;
  healthCheck: string;
  isolation: "in-process" | "sidecar" | "sandbox";
};

export const localExtensionAdapters: CodeFlowAdapterManifest[] = [
  { id: "parser.workspace", kind: "parser", contractVersion: "1.0", input: "CodeFile[]", output: "WorkspaceParseResult", healthCheck: "AST/diagnostic probe", isolation: "sidecar" },
  { id: "runtime.controlled", kind: "runtime", contractVersion: "1.0", input: "RuntimeExecutionRequest", output: "ControlledRuntimeExecutionReport", healthCheck: "compile/run/trace probe", isolation: "sandbox" },
  { id: "debug.dap", kind: "debug", contractVersion: "1.0", input: "DebugLaunchRequest", output: "DebugSession", healthCheck: "initialize/breakpoint/stack probe", isolation: "sidecar" },
  { id: "knowledge.signed-pack", kind: "knowledge", contractVersion: "1.0", input: "SignedKnowledgeBundle", output: "KnowledgePackStatusReport", healthCheck: "license/hash/replay probe", isolation: "sandbox" },
  { id: "testing.project", kind: "testing", contractVersion: "1.0", input: "CodeFile[] + runtime/repair evidence", output: "SoftwareTestReport", healthCheck: "status/evidence/version-fingerprint probe", isolation: "in-process" },
  { id: "report.project", kind: "report", contractVersion: "1.0", input: "WorkspaceAnalysis", output: "ProjectAnalysisReport", healthCheck: "section/evidence completeness", isolation: "in-process" },
];
