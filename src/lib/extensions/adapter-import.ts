import type { CodeFlowAdapterKind, CodeFlowAdapterManifest } from "@/src/lib/extensions/adapter-contract";

export type ImportedExtensionAdapter = {
  packageId: string;
  name: string;
  version: string;
  adapter: CodeFlowAdapterManifest;
  artifactHash: string;
  importedAt: number;
  status: "registered";
};

type ExtensionPackage = {
  schemaVersion: "1.0";
  packageId: string;
  name: string;
  version: string;
  adapter: CodeFlowAdapterManifest;
};

const storageKey = "codeflow.extension-adapters.v1";
const allowedKinds = new Set<CodeFlowAdapterKind>(["parser", "runtime", "debug", "knowledge", "testing", "report"]);
const allowedIsolation = new Set(["in-process", "sidecar", "sandbox"]);
const forbiddenKeys = new Set(["command", "script", "binary", "executable", "shell", "postinstall", "preinstall"]);

export async function importExtensionAdapterFile(file: File): Promise<ImportedExtensionAdapter> {
  if (file.size <= 0 || file.size > 2 * 1024 * 1024) {
    throw new Error("扩展声明文件必须介于 1 byte 与 2MB 之间。" );
  }
  const text = await file.text();
  const parsed = JSON.parse(text) as unknown;
  assertNoExecutableFields(parsed);
  const extensionPackage = validatePackage(parsed);
  const artifactHash = await sha256Hex(text);
  const imported: ImportedExtensionAdapter = {
    packageId: extensionPackage.packageId,
    name: extensionPackage.name,
    version: extensionPackage.version,
    adapter: extensionPackage.adapter,
    artifactHash,
    importedAt: Date.now(),
    status: "registered",
  };
  const existing = loadImportedExtensionAdapters();
  saveImportedExtensionAdapters([
    ...existing.filter((item) => item.packageId !== imported.packageId),
    imported,
  ]);
  return imported;
}

export function loadImportedExtensionAdapters(): ImportedExtensionAdapter[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(isImportedAdapter);
  } catch {
    return [];
  }
}

export function removeImportedExtensionAdapter(packageId: string) {
  saveImportedExtensionAdapters(loadImportedExtensionAdapters().filter((item) => item.packageId !== packageId));
}

export function downloadExtensionAdapterTemplate() {
  const template: ExtensionPackage = {
    schemaVersion: "1.0",
    packageId: "example.language.adapter",
    name: "Example Language Adapter",
    version: "1.0.0",
    adapter: {
      id: "parser.example-language",
      kind: "parser",
      contractVersion: "1.0",
      input: "CodeFile[]",
      output: "WorkspaceParseResult",
      healthCheck: "AST/diagnostic probe",
      isolation: "sidecar",
    },
  };
  const blob = new Blob([JSON.stringify(template, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "codeflow-extension-template.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

function validatePackage(value: unknown): ExtensionPackage {
  if (!isRecord(value)) throw new Error("扩展声明必须是 JSON object。" );
  if (value.schemaVersion !== "1.0") throw new Error("仅支持 schemaVersion 1.0。" );
  const packageId = requiredId(value.packageId, "packageId");
  const name = requiredText(value.name, "name", 80);
  const version = requiredText(value.version, "version", 40);
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error("version 必须使用语义版本格式。" );
  if (!isRecord(value.adapter)) throw new Error("缺少 adapter contract。" );
  const adapterId = requiredId(value.adapter.id, "adapter.id");
  if (!allowedKinds.has(value.adapter.kind as CodeFlowAdapterKind)) throw new Error("adapter.kind 不受支持。" );
  if (value.adapter.contractVersion !== "1.0") throw new Error("adapter.contractVersion 必须为 1.0。" );
  if (!allowedIsolation.has(String(value.adapter.isolation))) throw new Error("adapter.isolation 不受支持。" );
  const adapter: CodeFlowAdapterManifest = {
    id: adapterId,
    kind: value.adapter.kind as CodeFlowAdapterKind,
    contractVersion: "1.0",
    input: requiredText(value.adapter.input, "adapter.input", 160),
    output: requiredText(value.adapter.output, "adapter.output", 160),
    healthCheck: requiredText(value.adapter.healthCheck, "adapter.healthCheck", 240),
    isolation: value.adapter.isolation as CodeFlowAdapterManifest["isolation"],
  };
  return { schemaVersion: "1.0", packageId, name, version, adapter };
}

function assertNoExecutableFields(value: unknown, path = "package") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoExecutableFields(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  Object.entries(value).forEach(([key, item]) => {
    if (forbiddenKeys.has(key.toLocaleLowerCase())) {
      throw new Error(`${path}.${key} 不允许出现在声明包中；可执行 sidecar 必须走签名安装链。`);
    }
    assertNoExecutableFields(item, `${path}.${key}`);
  });
}

function saveImportedExtensionAdapters(items: ImportedExtensionAdapter[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(items.slice(-100)));
}

function isImportedAdapter(value: unknown): value is ImportedExtensionAdapter {
  return isRecord(value)
    && typeof value.packageId === "string"
    && typeof value.name === "string"
    && typeof value.version === "string"
    && typeof value.artifactHash === "string"
    && typeof value.importedAt === "number"
    && value.status === "registered"
    && isRecord(value.adapter)
    && typeof value.adapter.id === "string";
}

function requiredId(value: unknown, field: string) {
  const text = requiredText(value, field, 120);
  if (!/^[a-z0-9][a-z0-9._-]+$/i.test(text)) throw new Error(`${field} 只能包含字母、数字、点、下划线和横线。`);
  return text;
}

function requiredText(value: unknown, field: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${field} 必须是 1-${max} 字符的文本。` );
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
