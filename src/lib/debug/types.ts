export type DebugLanguageAdapter = "node" | "python" | "rust" | "java" | "c" | "cpp" | "embedded";

export type DebugBackendKind = "vscode-js-debug" | "debugpy" | "java-debug-server" | "lldb-dap" | "embedded-system-toolchain";

export type DebugAvailabilityStatus = "available" | "partial" | "unavailable";

export type DebugAdapterAvailability = {
  adapter: DebugLanguageAdapter;
  backend: DebugBackendKind;
  available: boolean;
  verified: boolean;
  version: string;
  executablePath: string;
  evidence: string;
  optional?: boolean;
};

export type DebugAvailability = {
  status: DebugAvailabilityStatus;
  availableCount: number;
  totalCount: number;
  adapters: DebugAdapterAvailability[];
  evidence: string[];
};

export type DebugSessionState =
  | "created"
  | "adapter_started"
  | "initialized"
  | "configured"
  | "running"
  | "stopped"
  | "terminated"
  | "failed";

export type DebugSource = {
  name?: string;
  path: string;
  sourceReference?: number;
};

export type DebugBreakpointRequest = {
  line: number;
  column?: number;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
};

export type DebugBreakpoint = DebugBreakpointRequest & {
  id?: number;
  source: DebugSource;
  verified: boolean;
  message?: string;
  endLine?: number;
  endColumn?: number;
};

export type DebugThread = {
  id: number;
  name: string;
};

export type DebugStackFrame = {
  id: number;
  name: string;
  source?: DebugSource;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  presentationHint?: "normal" | "label" | "subtle";
};

export type DebugScope = {
  name: string;
  variablesReference: number;
  expensive: boolean;
  namedVariables?: number;
  indexedVariables?: number;
  source?: DebugSource;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
};

export type DebugVariable = {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
  namedVariables?: number;
  indexedVariables?: number;
  evaluateName?: string;
  memoryReference?: string;
  presentationHint?: {
    kind?: string;
    attributes?: string[];
    visibility?: string;
  };
};

export type DebugStop = {
  reason: string;
  description?: string;
  threadId?: number;
  allThreadsStopped: boolean;
  hitBreakpointIds: number[];
  text?: string;
};

export type DebugSession = {
  id: string;
  projectId: string;
  adapter: DebugLanguageAdapter;
  backend: DebugBackendKind;
  state: DebugSessionState;
  breakpoints: DebugBreakpoint[];
  threads: DebugThread[];
  stackFrames: DebugStackFrame[];
  scopes: DebugScope[];
  variables: DebugVariable[];
  lastStop?: DebugStop;
  eventLog: Array<{ kind: string; atMs: number; detail: string }>;
  failure?: string;
};

export type CreateDebugSessionRequest = {
  projectId: string;
  projectName: string;
  adapter: DebugLanguageAdapter;
};

export type SetDebugBreakpointsRequest = {
  sessionId: string;
  source: DebugSource;
  breakpoints: DebugBreakpointRequest[];
};

export type LaunchDebugSessionRequest = {
  sessionId: string;
  entryPath: string;
  files: Array<{
    path: string;
    content: string;
    language: string;
  }>;
  args?: string[];
  stdin?: string;
  environment?: Record<string, string>;
  stopOnEntry?: boolean;
};

export type DebugThreadRequest = {
  sessionId: string;
  threadId: number;
};

export type DisconnectDebugSessionRequest = {
  sessionId: string;
  terminateDebuggee?: boolean;
};

export type DebugCommandResult = {
  session: DebugSession;
  evidence: string[];
};
