export type KnowledgeSourceStatus = {
  id: string;
  name: string;
  licenseId: string;
  commercialAllowed: boolean;
  redistributionAllowed: boolean;
  lastCheckedAt: number;
  lastStatus: string;
  recordCount: number;
  evidence: string;
};

export type KnowledgePackSummary = {
  id: string;
  version: string;
  status: string;
  sourceCount: number;
  recordCount: number;
  quarantinedCount: number;
  validationScore: number;
  contentHash: string;
  signature: string;
  signatureValid: boolean;
  createdAt: number;
  activatedAt: number | null;
  evidence: string;
};

export type KnowledgePackStatusReport = {
  status: "empty" | "staged" | "active" | "web-preview";
  databasePath: string;
  activePackId: string | null;
  previousPackId: string | null;
  sourceCount: number;
  packCount: number;
  activeRecordCount: number;
  quarantinedRecordCount: number;
  eventCount: number;
  knowledgeMaturity: number;
  sources: KnowledgeSourceStatus[];
  packs: KnowledgePackSummary[];
  legalNotices: string[];
  evidence: string[];
};

export type SupplementalKnowledgeReport = {
  bundleId: string;
  status: "staged" | "active";
  recordCount: number;
  contentHash: string;
  signature: string;
  evidence: string[];
};

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export function buildKnowledgePackWebPreviewReport(): KnowledgePackStatusReport {
  return {
    status: "web-preview",
    databasePath: "codeflow.sqlite3",
    activePackId: null,
    previousPackId: null,
    sourceCount: 4,
    packCount: 0,
    activeRecordCount: 0,
    quarantinedRecordCount: 0,
    eventCount: 0,
    knowledgeMaturity: 38,
    sources: [
      source("osv", "OSV.dev", "MIXED-PER-RECORD", false),
      source("nvd", "NIST NVD", "NIST-PUBLIC-DOMAIN", true),
      source("cwe", "MITRE CWE", "MITRE-CWE-TERMS", true),
      source("kev", "CISA KEV", "CISA-USE-NOTICE", false),
    ],
    packs: [],
    legalNotices: ["知识包更新、签名和回滚仅在 Tauri 本地软件中执行。"],
    evidence: ["浏览器预览不会下载或激活安全知识数据。"],
  };
}

export async function inspectKnowledgePacks(): Promise<KnowledgePackStatusReport> {
  const invoke = nativeInvoke();
  return invoke ? invoke("codeflow_knowledge_pack_status") : buildKnowledgePackWebPreviewReport();
}

export async function importPhaseOneKnowledgePack(): Promise<KnowledgePackStatusReport> {
  const invoke = nativeInvoke();
  if (!invoke) return buildKnowledgePackWebPreviewReport();
  return invoke("codeflow_import_knowledge_pack", {
    request: {
      sources: ["osv", "nvd", "cwe", "kev"],
      maxRecordsPerSource: 250,
      nvdLookbackDays: 30,
      autoActivate: false,
    },
  });
}

export async function activateKnowledgePack(packId: string): Promise<KnowledgePackStatusReport> {
  const invoke = nativeInvoke();
  if (!invoke) return buildKnowledgePackWebPreviewReport();
  return invoke("codeflow_activate_knowledge_pack", { packId });
}

export async function rollbackKnowledgePack(): Promise<KnowledgePackStatusReport> {
  const invoke = nativeInvoke();
  if (!invoke) return buildKnowledgePackWebPreviewReport();
  return invoke("codeflow_rollback_knowledge_pack");
}

export async function importSupplementalKnowledgeBundle(bundleJson: string): Promise<SupplementalKnowledgeReport> {
  const invoke = nativeInvoke();
  if (!invoke) throw new Error("补充知识证据包只能导入 Tauri 本地数据库。");
  const artifactHash = await sha256Hex(bundleJson);
  return invoke("codeflow_import_supplemental_knowledge", { request: { bundleJson, artifactHash } });
}

export async function activateSupplementalKnowledgeBundle(bundleId: string): Promise<SupplementalKnowledgeReport> {
  const invoke = nativeInvoke();
  if (!invoke) throw new Error("补充知识证据包只能在 Tauri 本地软件中激活。");
  return invoke("codeflow_activate_supplemental_knowledge", { bundleId });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function source(id: string, name: string, licenseId: string, redistributionAllowed: boolean): KnowledgeSourceStatus {
  return {
    id,
    name,
    licenseId,
    commercialAllowed: true,
    redistributionAllowed,
    lastCheckedAt: 0,
    lastStatus: "等待桌面程序",
    recordCount: 0,
    evidence: "尚未下载官方原始件。",
  };
}

function nativeInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const current = window as Window & {
    __TAURI__?: { invoke?: TauriInvoke; core?: { invoke?: TauriInvoke } };
    __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
  };
  return current.__TAURI_INTERNALS__?.invoke ?? current.__TAURI__?.core?.invoke ?? current.__TAURI__?.invoke ?? null;
}
