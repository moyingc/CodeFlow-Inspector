import type {
  CreateDebugSessionRequest,
  DebugAvailability,
  DebugBackendKind,
  DebugCommandResult,
  DebugLanguageAdapter,
  DebugSession,
  DebugThreadRequest,
  DisconnectDebugSessionRequest,
  LaunchDebugSessionRequest,
  SetDebugBreakpointsRequest,
} from "@/src/lib/debug/types";

type NativeDebugSessionRecord = {
  id: string;
  projectId: string;
  adapter: DebugLanguageAdapter;
  state: DebugSession["state"];
  breakpoints: Array<{
    path: string;
    line: number;
    condition?: string;
    hitCondition?: string;
    verified: boolean;
  }>;
  lastStop?: {
    reason: string;
    threadId: number;
    frameId: number;
    functionName: string;
    path: string;
    line: number;
    variables: Array<{
      name: string;
      typeName: string;
      valuePreview: string;
      variablesReference: number;
    }>;
  };
  eventLog: Array<{ kind: string; atMs: number; detail: string }>;
  failure?: string;
};

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type DebugWindow = Window & {
  __TAURI__?: {
    invoke?: TauriInvoke;
    core?: { invoke?: TauriInvoke };
  };
  __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
};

export class DebugClientUnavailableError extends Error {
  readonly code = "DEBUG_CLIENT_UNAVAILABLE";

  constructor() {
    super("调试客户端不可用：必须在包含 DAP 调试后端的 Tauri 桌面程序中运行。");
    this.name = "DebugClientUnavailableError";
  }
}

export function buildUnavailableDebugAvailability(): DebugAvailability {
  return {
    status: "unavailable",
    availableCount: 0,
    totalCount: 6,
    adapters: [],
    evidence: ["当前环境没有 Tauri IPC 通道。浏览器预览不会连接 localhost，也不会创建或模拟调试会话。"],
  };
}

export async function inspectDebugAvailability(): Promise<DebugAvailability> {
  const invoke = nativeInvoke();
  if (!invoke) return buildUnavailableDebugAvailability();
  return invoke("codeflow_debug_availability");
}

export async function createDebugSession(
  request: CreateDebugSessionRequest,
): Promise<DebugSession> {
  return normalizeSession(await invokeRequired<NativeDebugSessionRecord>("codeflow_debug_create_session", { request }));
}

export async function setDebugBreakpoints(
  request: SetDebugBreakpointsRequest,
): Promise<DebugCommandResult> {
  return commandResult("codeflow_debug_set_breakpoints", request);
}

export async function launchDebugSession(
  request: LaunchDebugSessionRequest,
): Promise<DebugCommandResult> {
  return commandResult("codeflow_debug_launch", request);
}

export async function continueDebugSession(
  request: DebugThreadRequest,
): Promise<DebugCommandResult> {
  return commandResult("codeflow_debug_continue", request);
}

export async function nextDebugSession(
  request: DebugThreadRequest,
): Promise<DebugCommandResult> {
  return commandResult("codeflow_debug_next", request);
}

export async function stepInDebugSession(
  request: DebugThreadRequest,
): Promise<DebugCommandResult> {
  return commandResult("codeflow_debug_step_in", request);
}

export async function stepOutDebugSession(
  request: DebugThreadRequest,
): Promise<DebugCommandResult> {
  return commandResult("codeflow_debug_step_out", request);
}

export async function pauseDebugSession(
  request: DebugThreadRequest,
): Promise<DebugCommandResult> {
  return commandResult("codeflow_debug_pause", request);
}

export async function disconnectDebugSession(
  request: DisconnectDebugSessionRequest,
): Promise<DebugCommandResult> {
  return commandResult("codeflow_debug_disconnect", request);
}

async function commandResult(
  command: string,
  request: object,
): Promise<DebugCommandResult> {
  const session = normalizeSession(
    await invokeRequired<NativeDebugSessionRecord>(command, { request }),
  );
  return {
    session,
    evidence: [`Tauri accepted ${command} and returned session state ${session.state}.`],
  };
}

function normalizeSession(record: NativeDebugSessionRecord): DebugSession {
  const stop = record.lastStop;
  return {
    id: record.id,
    projectId: record.projectId,
    adapter: record.adapter,
    backend: backendForAdapter(record.adapter),
    state: record.state,
    breakpoints: record.breakpoints.map((breakpoint) => ({
      line: breakpoint.line,
      condition: breakpoint.condition,
      hitCondition: breakpoint.hitCondition,
      verified: breakpoint.verified,
      source: { path: breakpoint.path },
    })),
    threads: stop ? [{ id: stop.threadId, name: `Thread ${stop.threadId}` }] : [],
    stackFrames: stop ? [{ id: stop.frameId, name: stop.functionName, source: { path: stop.path }, line: stop.line, column: 1 }] : [],
    scopes: stop ? [{ name: "Locals", variablesReference: stop.frameId, expensive: false }] : [],
    variables: stop?.variables.map((variable) => ({
      name: variable.name,
      value: variable.valuePreview,
      type: variable.typeName,
      variablesReference: variable.variablesReference,
    })) ?? [],
    lastStop: stop ? {
      reason: stop.reason,
      threadId: stop.threadId,
      allThreadsStopped: true,
      hitBreakpointIds: [],
    } : undefined,
    eventLog: record.eventLog,
    failure: record.failure,
  };
}

function backendForAdapter(adapter: DebugLanguageAdapter): DebugBackendKind {
  if (adapter === "node") return "vscode-js-debug";
  if (adapter === "python") return "debugpy";
  if (adapter === "java") return "java-debug-server";
  if (adapter === "embedded") return "embedded-system-toolchain";
  return "lldb-dap";
}

async function invokeRequired<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const invoke = nativeInvoke();
  if (!invoke) throw new DebugClientUnavailableError();
  return invoke<T>(command, args);
}

function nativeInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const nativeWindow = window as DebugWindow;
  return (
    nativeWindow.__TAURI__?.core?.invoke ??
    nativeWindow.__TAURI__?.invoke ??
    nativeWindow.__TAURI_INTERNALS__?.invoke ??
    null
  );
}
