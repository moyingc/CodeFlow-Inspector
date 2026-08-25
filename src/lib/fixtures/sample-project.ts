import type { CodeFile } from "@/src/lib/analysis/types";

export const sampleFiles: CodeFile[] = [
  {
    id: "sample-controller",
    name: "src/pipeline/controller.ts",
    language: "TypeScript",
    imports: ["zod", "node:fs/promises", "next/server"],
    environmentRefs: ["NODE_ENV", "PROJECT_ROOT"],
    deviceRefs: [],
    content: `type SourceFile = { path: string; content: string };

export function analyzeProject(files: SourceFile[], options: RunOptions): AnalysisReport {
  const parsed = parseFiles(files);
  const graph = buildFunctionGraph(parsed);
  const flow = runFlowIntegrityTest(graph, options.inputSamples);
  const warnings = validateDamSafety(flow);
  return renderReport(graph, flow, warnings);
}

function parseFiles(files: SourceFile[]): ParsedFunction[] {
  return files.flatMap((file) => parseOneFile(file));
}

function buildFunctionGraph(functions: ParsedFunction[]): FunctionGraph {
  const edges = functions.flatMap((fn) => connectCalls(fn, functions));
  return { nodes: functions, edges };
}

function runFlowIntegrityTest(graph: FunctionGraph, inputSamples: unknown[]): FlowResult {
  const queue = inputSamples.map((sample) => normalizeInput(sample));
  while (queue.length) {
    const item = queue.shift();
    validateInput(item);
    routeToOutput(graph, item);
  }
  return { status: "closed", paths: graph.edges };
}

function validateDamSafety(flow: FlowResult): Warning[] {
  return flow.paths.filter((edge) => edge.outputType === "unknown");
}

function renderReport(graph: FunctionGraph, flow: FlowResult, warnings: Warning[]): AnalysisReport {
  return { graph, flow, warnings, generatedAt: Date.now() };
}`,
  },
  {
    id: "sample-runtime",
    name: "src/runtime/sandbox.py",
    language: "Python",
    imports: ["subprocess", "json", "typing"],
    environmentRefs: ["PYTHONPATH", "RUNTIME_TIMEOUT_MS"],
    deviceRefs: [],
    content: `def run_test_case(project, payload) -> RuntimeResult:
    validated = validate_payload(payload)
    process = start_child_process(project.entrypoint)
    output = collect_process_output(process, validated)
    return build_runtime_result(output)

def validate_payload(payload) -> dict:
    if payload is None:
        raise ValueError("payload is required")
    return {"input": payload}

def collect_process_output(process, payload) -> list[str]:
    results = []
    for item in payload["input"]:
        results.append(process.send(item))
    return results

def build_runtime_result(output) -> RuntimeResult:
    return RuntimeResult(output=output, status="ok")`,
  },
];
