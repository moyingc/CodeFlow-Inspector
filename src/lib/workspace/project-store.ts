import type { CodeFile } from "@/src/lib/analysis/types";

export const WORKSPACE_PROJECT_STORE_KEY = "codeflow.workspace.projects.v1";
export const WORKSPACE_PROJECT_DB_NAME = "codeflow-local-program";
export const WORKSPACE_PROJECT_DB_VERSION = 2;
export const WORKSPACE_PROJECT_METADATA_STORE = "workspace_projects";
export const WORKSPACE_PROJECT_FILE_STORE = "workspace_project_files";
export const WORKSPACE_PROJECT_STATE_STORE = "workspace_project_state";
export const WORKSPACE_PROJECT_EVENT_STORE = "workspace_project_events";
export const WORKSPACE_PROJECT_ENGINE_STORE = "workspace_project_storage_engines";
export const WORKSPACE_PROJECT_STATE_ID = "active-workspace";
export const WORKSPACE_PROJECT_ENGINE_ID = "indexeddb-workspace-projects";
export const WORKSPACE_PROJECT_MAX_SYNC_EVENTS = 100;

export type WorkspaceProjectSource = "sample" | "folder" | "files" | "draft";

export type WorkspaceProjectRecord = {
  id: string;
  name: string;
  files: CodeFile[];
  source: WorkspaceProjectSource;
  createdAt: number;
  updatedAt: number;
};

export type WorkspaceProjectStorePayload = {
  version: typeof WORKSPACE_PROJECT_DB_VERSION;
  projects: WorkspaceProjectRecord[];
  activeProjectId: string | null;
  savedAt: number;
};

export type WorkspaceProjectBackup = {
  format: "codeflow-workspace-backup";
  version: typeof WORKSPACE_PROJECT_DB_VERSION;
  exportedAt: number;
  activeProjectId: string | null;
  projects: WorkspaceProjectRecord[];
  checksum: string;
};

export type WorkspaceProjectStoreReport = {
  status: "synced" | "warming" | "unavailable";
  engineKind: "indexeddb";
  storageMode: "Local program project database";
  projectCount: number;
  fileCount: number;
  tableCount: number;
  lastSyncedAt: number;
  evidence: string;
  next: string;
};

type WorkspaceProjectMetadataRow = Omit<WorkspaceProjectRecord, "files"> & {
  fileCount: number;
  languageSummary: Record<string, number>;
  rootHint: string;
};

type WorkspaceProjectFileRow = CodeFile & {
  projectId: string;
};

type WorkspaceProjectStateRow = {
  id: typeof WORKSPACE_PROJECT_STATE_ID;
  activeProjectId: string | null;
  updatedAt: number;
};

type WorkspaceProjectEventRow = {
  id: string;
  eventKind: "sync";
  activeProjectId: string | null;
  projectCount: number;
  fileCount: number;
  evidence: string;
  createdAt: number;
};

type WorkspaceProjectEngineRow = {
  id: typeof WORKSPACE_PROJECT_ENGINE_ID;
  engineKind: "indexeddb";
  storageMode: "Local program project database";
  status: WorkspaceProjectStoreReport["status"];
  projectCount: number;
  fileCount: number;
  tableCount: number;
  lastSyncedAt: number;
  evidence: string;
  updatedAt: number;
};

export type WorkspaceProjectSqliteRow = {
  tableName: "workspace_projects" | "workspace_project_files" | "workspace_project_state";
  primaryKey: string;
  payload: Record<string, unknown>;
  sqlText: string;
};

export function buildWorkspaceProjectStoreUnavailableReport(
  reason = "本地程序项目数据库等待 WebView 挂载。",
): WorkspaceProjectStoreReport {
  return {
    status: "warming",
    engineKind: "indexeddb",
    storageMode: "Local program project database",
    projectCount: 0,
    fileCount: 0,
    tableCount: 0,
    lastSyncedAt: 0,
    evidence: reason,
    next: "当前开发壳使用 IndexedDB；桌面程序阶段会把同一项目表接入 native SQLite/OPFS SQLite。",
  };
}

export async function loadWorkspaceProjectStore(): Promise<WorkspaceProjectStorePayload | null> {
  if (!hasIndexedDb()) return loadLegacyWorkspaceProjectStore();

  const db = await openWorkspaceProjectDatabase();
  try {
    const metadataRows = await getAllRows<WorkspaceProjectMetadataRow>(db, WORKSPACE_PROJECT_METADATA_STORE);
    const fileRows = await getAllRows<WorkspaceProjectFileRow>(db, WORKSPACE_PROJECT_FILE_STORE);
    const stateRows = await getAllRows<WorkspaceProjectStateRow>(db, WORKSPACE_PROJECT_STATE_STORE);
    const filesByProject = new Map<string, CodeFile[]>();

    fileRows.forEach((row) => {
      const file = sanitizeFile(row);
      if (!file) return;
      filesByProject.set(row.projectId, [...(filesByProject.get(row.projectId) ?? []), file]);
    });

    const projects = metadataRows
      .map((row) => sanitizeProject({ ...row, files: filesByProject.get(row.id) ?? [] }))
      .filter((project): project is WorkspaceProjectRecord => Boolean(project));

    if (!projects.length) return loadLegacyWorkspaceProjectStore();
    const activeCandidate = stateRows.find((row) => row.id === WORKSPACE_PROJECT_STATE_ID)?.activeProjectId ?? projects[0].id;
    return {
      version: WORKSPACE_PROJECT_DB_VERSION,
      projects,
      activeProjectId: projects.some((project) => project.id === activeCandidate) ? activeCandidate : projects[0].id,
      savedAt: Math.max(...projects.map((project) => project.updatedAt), 0),
    };
  } finally {
    db.close();
  }
}

export async function saveWorkspaceProjectStore(
  projects: WorkspaceProjectRecord[],
  activeProjectId: string | null,
): Promise<WorkspaceProjectStoreReport> {
  const sanitized = projects.map(sanitizeProject).filter((project): project is WorkspaceProjectRecord => Boolean(project));
  if (!sanitized.length) return buildWorkspaceProjectStoreUnavailableReport("没有有效项目可以写入本地程序数据库。");
  if (!hasIndexedDb()) return buildWorkspaceProjectStoreUnavailableReport("当前运行环境没有 IndexedDB，本地程序数据库暂不可用。");

  const db = await openWorkspaceProjectDatabase();
  const activeId = activeProjectId && sanitized.some((project) => project.id === activeProjectId) ? activeProjectId : sanitized[0].id;

  try {
    await replaceWorkspaceProjectRows(db, sanitized, activeId);
    return summarizeWorkspaceProjectStore(sanitized);
  } finally {
    db.close();
  }
}

export function exportWorkspaceProjectBackup(
  projects: WorkspaceProjectRecord[],
  activeProjectId: string | null,
): WorkspaceProjectBackup {
  const sanitized = projects.map(sanitizeProject).filter((project): project is WorkspaceProjectRecord => Boolean(project));
  if (!sanitized.length) throw new Error("没有有效项目可以备份。");
  const core = {
    format: "codeflow-workspace-backup" as const,
    version: WORKSPACE_PROJECT_DB_VERSION,
    exportedAt: Date.now(),
    activeProjectId: activeProjectId && sanitized.some((project) => project.id === activeProjectId) ? activeProjectId : sanitized[0].id,
    projects: sanitized,
  };
  return { ...core, checksum: backupChecksum(JSON.stringify(core)) };
}

export function parseWorkspaceProjectBackup(payload: string): WorkspaceProjectBackup {
  if (payload.length > 100_000_000) throw new Error("备份文件超过 100 MB 安全上限。");
  const parsed = JSON.parse(payload) as Partial<WorkspaceProjectBackup>;
  if (parsed.format !== "codeflow-workspace-backup" || parsed.version !== WORKSPACE_PROJECT_DB_VERSION) {
    throw new Error("不是受支持的 CodeFlow 项目备份。");
  }
  const projects = (parsed.projects ?? [])
    .slice(0, 200)
    .map(sanitizeProject)
    .filter((project): project is WorkspaceProjectRecord => Boolean(project));
  const totalFiles = projects.reduce((sum, project) => sum + project.files.length, 0);
  const totalBytes = projects.reduce(
    (sum, project) => sum + project.files.reduce((fileSum, file) => fileSum + file.content.length, 0),
    0,
  );
  if (!projects.length || totalFiles > 50_000 || totalBytes > 100_000_000) {
    throw new Error("备份项目为空或超过项目/文件安全上限。");
  }
  const core = {
    format: "codeflow-workspace-backup" as const,
    version: WORKSPACE_PROJECT_DB_VERSION,
    exportedAt: safeNumber(parsed.exportedAt, 0),
    activeProjectId: typeof parsed.activeProjectId === "string" ? parsed.activeProjectId : null,
    projects,
  };
  if (!parsed.checksum || backupChecksum(JSON.stringify(core)) !== parsed.checksum) {
    throw new Error("备份完整性校验失败，文件可能损坏或被修改。");
  }
  return { ...core, checksum: parsed.checksum };
}

export function buildWorkspaceProjectSqliteRows(
  projects: WorkspaceProjectRecord[],
  activeProjectId: string | null,
): WorkspaceProjectSqliteRow[] {
  const sanitized = projects.map(sanitizeProject).filter((project): project is WorkspaceProjectRecord => Boolean(project));
  const rows: WorkspaceProjectSqliteRow[] = [];
  sanitized.forEach((project) => {
    const metadata = metadataRowFromProject(project);
    rows.push(
      sqliteRow("workspace_projects", project.id, {
        id: metadata.id,
        name: metadata.name,
        source: metadata.source,
        root_hint: metadata.rootHint,
        file_count: metadata.fileCount,
        language_summary: metadata.languageSummary,
        created_at: metadata.createdAt,
        updated_at: metadata.updatedAt,
      }),
    );
    project.files.forEach((file) => {
      const row = fileRowFromProject(project.id, file);
      rows.push(
        sqliteRow("workspace_project_files", file.id, {
          id: row.id,
          project_id: row.projectId,
          path: row.name,
          language: row.language,
          content: row.content,
          hash: row.hash ?? "",
          size: row.size ?? row.content.length,
          last_modified: row.lastModified ?? null,
          imports: row.imports ?? [],
          environment_refs: row.environmentRefs ?? [],
          device_refs: row.deviceRefs ?? [],
        }),
      );
    });
  });
  rows.push(
    sqliteRow("workspace_project_state", WORKSPACE_PROJECT_STATE_ID, {
      id: WORKSPACE_PROJECT_STATE_ID,
      active_project_id: activeProjectId,
      updated_at: Date.now(),
    }),
  );
  return rows;
}

function summarizeWorkspaceProjectStore(projects: WorkspaceProjectRecord[]): WorkspaceProjectStoreReport {
  const fileCount = projects.reduce((sum, project) => sum + project.files.length, 0);
  return {
    status: "synced",
    engineKind: "indexeddb",
    storageMode: "Local program project database",
    projectCount: projects.length,
    fileCount,
    tableCount: 5,
    lastSyncedAt: Math.max(...projects.map((project) => project.updatedAt), Date.now()),
    evidence: `IndexedDB local program DB synced · projects ${projects.length} · files ${fileCount}`,
    next: "项目表已经按 native SQLite 结构组织；下一步接 Tauri sidecar 或 OPFS SQLite writer。",
  };
}

function metadataRowFromProject(project: WorkspaceProjectRecord): WorkspaceProjectMetadataRow {
  return {
    id: project.id,
    name: project.name,
    source: project.source,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    fileCount: project.files.length,
    languageSummary: languageSummary(project.files),
    rootHint: inferRootHint(project.files),
  };
}

function fileRowFromProject(projectId: string, file: CodeFile): WorkspaceProjectFileRow {
  return {
    ...file,
    projectId,
    size: file.size ?? file.content.length,
    imports: file.imports ?? [],
    environmentRefs: file.environmentRefs ?? [],
    deviceRefs: file.deviceRefs ?? [],
  };
}

async function replaceWorkspaceProjectRows(
  db: IDBDatabase,
  projects: WorkspaceProjectRecord[],
  activeProjectId: string | null,
) {
  const tx = db.transaction(
    [
      WORKSPACE_PROJECT_METADATA_STORE,
      WORKSPACE_PROJECT_FILE_STORE,
      WORKSPACE_PROJECT_STATE_STORE,
      WORKSPACE_PROJECT_EVENT_STORE,
      WORKSPACE_PROJECT_ENGINE_STORE,
    ],
    "readwrite",
  );
  const projectStore = tx.objectStore(WORKSPACE_PROJECT_METADATA_STORE);
  const fileStore = tx.objectStore(WORKSPACE_PROJECT_FILE_STORE);
  const stateStore = tx.objectStore(WORKSPACE_PROJECT_STATE_STORE);
  const eventStore = tx.objectStore(WORKSPACE_PROJECT_EVENT_STORE);
  const engineStore = tx.objectStore(WORKSPACE_PROJECT_ENGINE_STORE);
  const createdAt = Date.now();
  const fileCount = projects.reduce((sum, project) => sum + project.files.length, 0);

  projectStore.clear();
  fileStore.clear();
  stateStore.clear();
  engineStore.clear();
  projects.forEach((project) => {
    projectStore.put(metadataRowFromProject(project));
    project.files.forEach((file) => fileStore.put(fileRowFromProject(project.id, file)));
  });
  stateStore.put({
    id: WORKSPACE_PROJECT_STATE_ID,
    activeProjectId,
    updatedAt: createdAt,
  } satisfies WorkspaceProjectStateRow);
  eventStore.put({
    id: `workspace-project-sync-${createdAt}`,
    eventKind: "sync",
    activeProjectId,
    projectCount: projects.length,
    fileCount,
    evidence: `Workspace project database sync · projects ${projects.length} · files ${fileCount}`,
    createdAt,
  } satisfies WorkspaceProjectEventRow);
  engineStore.put({
    id: WORKSPACE_PROJECT_ENGINE_ID,
    engineKind: "indexeddb",
    storageMode: "Local program project database",
    status: "synced",
    projectCount: projects.length,
    fileCount,
    tableCount: 5,
    lastSyncedAt: createdAt,
    evidence: `IndexedDB local program DB synced · projects ${projects.length} · files ${fileCount}`,
    updatedAt: createdAt,
  } satisfies WorkspaceProjectEngineRow);

  const eventCount = await requestResult(eventStore.count());
  let eventsToRemove = Math.max(0, eventCount - WORKSPACE_PROJECT_MAX_SYNC_EVENTS);
  if (eventsToRemove > 0) {
    await new Promise<void>((resolve, reject) => {
      const request = eventStore.index("created_idx").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || eventsToRemove <= 0) {
          resolve();
          return;
        }
        cursor.delete();
        eventsToRemove -= 1;
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error("Workspace event retention failed"));
    });
  }

  await transactionDone(tx);
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function openWorkspaceProjectDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(WORKSPACE_PROJECT_DB_NAME, WORKSPACE_PROJECT_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction;
      if (!tx) return;
      const projectStore = ensureStore(db, tx, WORKSPACE_PROJECT_METADATA_STORE, { keyPath: "id" });
      ensureIndex(projectStore, "source_idx", "source");
      ensureIndex(projectStore, "updated_idx", "updatedAt");

      const fileStore = ensureStore(db, tx, WORKSPACE_PROJECT_FILE_STORE, { keyPath: "id" });
      ensureIndex(fileStore, "project_idx", "projectId");
      ensureIndex(fileStore, "language_idx", "language");
      ensureIndex(fileStore, "path_idx", "name");

      ensureStore(db, tx, WORKSPACE_PROJECT_STATE_STORE, { keyPath: "id" });

      const eventStore = ensureStore(db, tx, WORKSPACE_PROJECT_EVENT_STORE, { keyPath: "id" });
      ensureIndex(eventStore, "event_kind_idx", "eventKind");
      ensureIndex(eventStore, "created_idx", "createdAt");

      const engineStore = ensureStore(db, tx, WORKSPACE_PROJECT_ENGINE_STORE, { keyPath: "id" });
      ensureIndex(engineStore, "engine_kind_idx", "engineKind");
      ensureIndex(engineStore, "status_idx", "status");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Workspace project database open failed"));
  });
}

function ensureStore(db: IDBDatabase, tx: IDBTransaction, name: string, options: IDBObjectStoreParameters) {
  if (db.objectStoreNames.contains(name)) {
    return tx.objectStore(name);
  }
  return db.createObjectStore(name, options);
}

function ensureIndex(store: IDBObjectStore, name: string, keyPath: string) {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath);
}

function getAllRows<T>(db: IDBDatabase, storeName: string) {
  return new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve((request.result ?? []) as T[]);
    request.onerror = () => reject(request.error ?? new Error(`Workspace project database read failed: ${storeName}`));
  });
}

function transactionDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Workspace project database write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("Workspace project database write aborted"));
  });
}

function sqliteRow(
  tableName: WorkspaceProjectSqliteRow["tableName"],
  primaryKey: string,
  payload: Record<string, unknown>,
): WorkspaceProjectSqliteRow {
  return {
    tableName,
    primaryKey,
    payload,
    sqlText: `INSERT OR REPLACE INTO ${tableName} (${Object.keys(payload).join(", ")}) VALUES (${Object.values(payload)
      .map(sqlValue)
      .join(", ")});`,
  };
}

function loadLegacyWorkspaceProjectStore(): WorkspaceProjectStorePayload | null {
  const storage = legacyBrowserStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(WORKSPACE_PROJECT_STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkspaceProjectStorePayload>;
    const projects = (parsed.projects ?? []).map(sanitizeProject).filter((project): project is WorkspaceProjectRecord => Boolean(project));
    if (!projects.length) return null;
    const activeProjectId =
      typeof parsed.activeProjectId === "string" && projects.some((project) => project.id === parsed.activeProjectId)
        ? parsed.activeProjectId
        : projects[0].id;

    return {
      version: WORKSPACE_PROJECT_DB_VERSION,
      projects,
      activeProjectId,
      savedAt: safeNumber(parsed.savedAt, 0),
    };
  } catch {
    return null;
  }
}

function sanitizeProject(input: unknown): WorkspaceProjectRecord | null {
  if (!input || typeof input !== "object") return null;
  const project = input as Partial<WorkspaceProjectRecord>;
  const id = safeString(project.id);
  const name = safeString(project.name);
  const files = Array.isArray(project.files)
    ? project.files.map(sanitizeFile).filter((file): file is CodeFile => Boolean(file))
    : [];
  if (!id || !name || !files.length) return null;

  return {
    id,
    name,
    files: files.map((file) => ({
      ...file,
      id: file.id.startsWith(`${id}:`) ? file.id : `${id}:${file.id}`,
    })),
    source: sanitizeProjectSource(project.source),
    createdAt: safeNumber(project.createdAt, Date.now()),
    updatedAt: safeNumber(project.updatedAt, Date.now()),
  };
}

function sanitizeFile(input: unknown): CodeFile | null {
  if (!input || typeof input !== "object") return null;
  const file = input as Partial<CodeFile>;
  const id = safeString(file.id);
  const name = safeString(file.name);
  const language = safeString(file.language);
  const content = safeString(file.content);
  if (!id || !name || !language) return null;

  return {
    id,
    name,
    language,
    content,
    size: safeOptionalNumber(file.size),
    hash: safeString(file.hash) || undefined,
    lastModified: safeOptionalNumber(file.lastModified),
    imports: sanitizeStringList(file.imports),
    environmentRefs: sanitizeStringList(file.environmentRefs),
    deviceRefs: sanitizeStringList(file.deviceRefs),
  };
}

function sanitizeProjectSource(source: unknown): WorkspaceProjectSource {
  if (source === "folder" || source === "files" || source === "draft" || source === "sample") return source;
  return "files";
}

function languageSummary(files: CodeFile[]) {
  return files.reduce<Record<string, number>>((acc, file) => {
    acc[file.language] = (acc[file.language] ?? 0) + 1;
    return acc;
  }, {});
}

function inferRootHint(files: CodeFile[]) {
  const firstPath = files.find((file) => file.name.includes("/"))?.name;
  return firstPath?.split("/")[0] ?? files[0]?.name ?? "workspace";
}

function sanitizeStringList(input: unknown) {
  if (!Array.isArray(input)) return undefined;
  const values = input.map(safeString).filter(Boolean).slice(0, 120);
  return values.length ? values : undefined;
}

function safeString(input: unknown) {
  return typeof input === "string" ? input : "";
}

function safeNumber(input: unknown, fallback: number) {
  return typeof input === "number" && Number.isFinite(input) ? input : fallback;
}

function safeOptionalNumber(input: unknown) {
  return typeof input === "number" && Number.isFinite(input) ? input : undefined;
}

function quoteSql(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlValue(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "string") return quoteSql(value);
  return quoteSql(JSON.stringify(value));
}

function backupChecksum(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function hasIndexedDb() {
  return typeof indexedDB !== "undefined";
}

function legacyBrowserStorage() {
  if (typeof window === "undefined") return undefined;
  return window.localStorage;
}
