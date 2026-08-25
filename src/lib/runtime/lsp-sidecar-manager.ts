type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type LspSidecarToolStatus = {
  id: "pyright" | "jdtls" | "clangd" | "gopls" | "rust-analyzer";
  label: string;
  command: string;
  languages: string[];
  packageKind: string;
  versionPolicy: string;
  licenseSource: string;
  state: "bundled" | "managed" | "system" | "override" | "missing" | "disabled";
  enabled: boolean;
  available: boolean;
  verified: boolean;
  version: string;
  fingerprint: string;
  executablePath: string;
  evidence: string;
};

export type LspSidecarStatusReport = {
  status: "verified" | "system-ready" | "partial" | "missing" | "web-preview";
  target: string;
  schemaVersion: number;
  managedRoot: string;
  bundledRoots: string[];
  availableCount: number;
  verifiedCount: number;
  toolCount: number;
  tools: LspSidecarToolStatus[];
  evidence: string[];
};

const toolSeeds: Array<Pick<LspSidecarToolStatus, "id" | "label" | "command" | "languages" | "packageKind">> = [
  { id: "pyright", label: "Pyright", command: "pyright-langserver", languages: ["Python"], packageKind: "node-runtime-package" },
  { id: "jdtls", label: "Eclipse JDT LS", command: "jdtls", languages: ["Java"], packageKind: "jvm-runtime-package" },
  { id: "clangd", label: "clangd", command: "clangd", languages: ["C", "C++"], packageKind: "native-binary" },
  { id: "gopls", label: "gopls", command: "gopls", languages: ["Go"], packageKind: "native-binary" },
  { id: "rust-analyzer", label: "rust-analyzer", command: "rust-analyzer", languages: ["Rust"], packageKind: "native-binary" },
];

export function buildLspSidecarWebPreviewReport(): LspSidecarStatusReport {
  return {
    status: "web-preview",
    target: "browser",
    schemaVersion: 1,
    managedRoot: "",
    bundledRoots: [],
    availableCount: 0,
    verifiedCount: 0,
    toolCount: toolSeeds.length,
    tools: toolSeeds.map((tool) => ({
      ...tool,
      versionPolicy: "build-lock",
      licenseSource: "",
      state: "missing",
      enabled: true,
      available: false,
      verified: false,
      version: "",
      fingerprint: "",
      executablePath: "",
      evidence: "需要在 Tauri 桌面程序中检查受控 sidecar。",
    })),
    evidence: ["浏览器预览不管理或启动本地 language server。"],
  };
}

export async function inspectLspSidecars(): Promise<LspSidecarStatusReport> {
  const invoke = nativeInvoke();
  if (!invoke) return buildLspSidecarWebPreviewReport();
  return invoke("codeflow_lsp_sidecar_status");
}

export async function setLspSidecarEnabled(
  toolId: LspSidecarToolStatus["id"],
  enabled: boolean,
): Promise<LspSidecarStatusReport> {
  const invoke = nativeInvoke();
  if (!invoke) return buildLspSidecarWebPreviewReport();
  return invoke("codeflow_set_lsp_sidecar_enabled", { toolId, enabled });
}

function nativeInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const nativeWindow = window as Window & {
    __TAURI__?: { invoke?: TauriInvoke; core?: { invoke?: TauriInvoke } };
    __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
  };
  return (
    nativeWindow.__TAURI__?.core?.invoke ??
    nativeWindow.__TAURI__?.invoke ??
    nativeWindow.__TAURI_INTERNALS__?.invoke ??
    null
  );
}
