export type NetworkPolicyReport = {
  enabled: boolean;
  publicEgressEnabled: boolean;
  privateNetworkAllowed: boolean;
  bridgingAllowed: boolean;
  privateScopes: string[];
  mode: "public-network-locked" | "official-sources-only" | "web-preview";
  scope: string;
  allowedHosts: string[];
  inboundListener: boolean;
  sessionOnly: boolean;
  evidence: string[];
};

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export function buildNetworkPolicyWebPreview(): NetworkPolicyReport {
  return {
    enabled: false,
    publicEgressEnabled: false,
    privateNetworkAllowed: true,
    bridgingAllowed: false,
    privateScopes: ["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "::1/128", "fc00::/7", "fe80::/10"],
    mode: "web-preview",
    scope: "浏览器预览不拥有桌面网络权限；生产桌面程序允许隔离的本机/内网 IPC，但默认拒绝公网出口和内外网桥接。",
    allowedHosts: [
      "storage.googleapis.com",
      "api.osv.dev",
      "services.nvd.nist.gov",
      "cwe.mitre.org",
      "www.cisa.gov",
    ],
    inboundListener: false,
    sessionOnly: true,
    evidence: ["桌面程序启动后网络开关默认为关闭。"],
  };
}

export async function inspectNetworkPolicy(): Promise<NetworkPolicyReport> {
  const invoke = nativeInvoke();
  return invoke ? invoke("codeflow_network_policy_status") : buildNetworkPolicyWebPreview();
}

export async function setNetworkPolicy(enabled: boolean): Promise<NetworkPolicyReport> {
  const invoke = nativeInvoke();
  if (!invoke) return buildNetworkPolicyWebPreview();
  return invoke("codeflow_set_network_policy", { enabled });
}

function nativeInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const current = window as Window & {
    __TAURI__?: { invoke?: TauriInvoke; core?: { invoke?: TauriInvoke } };
    __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
  };
  return current.__TAURI_INTERNALS__?.invoke ?? current.__TAURI__?.core?.invoke ?? current.__TAURI__?.invoke ?? null;
}
