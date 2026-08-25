import {
  retainJournalRows,
  type DeepWebSqliteJournalRow,
} from "@/src/lib/persistence/deepweb-sqlite-journal";

export const DEEPWEB_INDEXEDDB_NAME = "codeflow-deepweb";
export const DEEPWEB_INDEXEDDB_VERSION = 3;
export const DEEPWEB_INDEXEDDB_JOURNAL_STORE = "sqlite_journal_rows";
export const DEEPWEB_INDEXEDDB_ENGINE_STORE = "local_storage_engines";
export const DEEPWEB_INDEXEDDB_SNAPSHOT_STORE = "snapshot_exports";
export const DEEPWEB_INDEXEDDB_ENGINE_ID = "indexeddb-main";
export const DEEPWEB_INDEXEDDB_MAX_JOURNAL_ROWS = 1024;
export const DEEPWEB_INDEXEDDB_MAX_SNAPSHOT_EVENTS = 80;

export type DeepWebIndexedDbSyncReport = {
  status: "synced" | "warming" | "unavailable";
  engineKind: "indexeddb";
  storageMode: "IndexedDB durable journal";
  rowCount: number;
  writtenRows: number;
  tableCount: number;
  lastSyncedAt: number;
  evidence: string;
  next: string;
};

export type DeepWebIndexedDbEngineRecord = {
  id: string;
  engineKind: "indexeddb";
  storageMode: "IndexedDB durable journal";
  status: DeepWebIndexedDbSyncReport["status"];
  rowCount: number;
  tableCount: number;
  lastSyncedAt: number;
  evidence: string;
  updatedAt: number;
};

export type DeepWebIndexedDbSnapshot = {
  id: string;
  exportedAt: number;
  databaseName: typeof DEEPWEB_INDEXEDDB_NAME;
  databaseVersion: typeof DEEPWEB_INDEXEDDB_VERSION;
  engine: DeepWebIndexedDbEngineRecord;
  rows: DeepWebSqliteJournalRow[];
};

export type DeepWebIndexedDbSnapshotEvent = {
  id: string;
  engineId: string;
  exportKind: "export" | "import";
  rowCount: number;
  tableCount: number;
  payloadBytes: number;
  status: DeepWebIndexedDbSnapshotExportReport["status"] | "imported";
  evidence: string;
  createdAt: number;
};

export type DeepWebIndexedDbSnapshotExportReport = {
  status: "ready" | "empty" | "unavailable";
  rowCount: number;
  tableCount: number;
  payloadBytes: number;
  exportedAt: number;
  evidence: string;
  next: string;
  payload: string;
};

export function buildDeepWebIndexedDbUnavailableReport(reason = "IndexedDB 等待浏览器挂载。"): DeepWebIndexedDbSyncReport {
  return {
    status: "warming",
    engineKind: "indexeddb",
    storageMode: "IndexedDB durable journal",
    rowCount: 0,
    writtenRows: 0,
    tableCount: 0,
    lastSyncedAt: 0,
    evidence: reason,
    next: "浏览器挂载后会把 SQLite-ready journal 写入 IndexedDB durable store。",
  };
}

export function buildDeepWebIndexedDbSnapshotExportUnavailableReport(
  reason = "IndexedDB 快照等待浏览器挂载。",
): DeepWebIndexedDbSnapshotExportReport {
  return {
    status: "unavailable",
    rowCount: 0,
    tableCount: 0,
    payloadBytes: 0,
    exportedAt: 0,
    evidence: reason,
    next: "浏览器挂载后可以导出 DeepWeb 本地快照。",
    payload: "",
  };
}

export async function syncDeepWebIndexedDbJournal(rows: DeepWebSqliteJournalRow[]): Promise<DeepWebIndexedDbSyncReport> {
  if (!rows.length) return buildDeepWebIndexedDbUnavailableReport("没有 journal 行需要同步。");
  if (!hasIndexedDb()) return buildDeepWebIndexedDbUnavailableReport("当前运行环境没有 IndexedDB。");

  const db = await openDeepWebIndexedDb();
  try {
    const boundedRows = retainJournalRows(rows);
    const writtenRows = await putJournalRows(db, boundedRows);
    await pruneOldestRows(db, DEEPWEB_INDEXEDDB_JOURNAL_STORE, DEEPWEB_INDEXEDDB_MAX_JOURNAL_ROWS);
    const storedRows = await getAllJournalRows(db);
    const report = summarizeIndexedDbRows(storedRows, writtenRows);
    await putEngineRecord(db, engineRecordFromReport(report));
    return report;
  } finally {
    db.close();
  }
}

export async function loadDeepWebIndexedDbJournalRows() {
  if (!hasIndexedDb()) return [];
  const db = await openDeepWebIndexedDb();
  try {
    return await getAllJournalRows(db);
  } finally {
    db.close();
  }
}

export async function loadDeepWebIndexedDbEngineRecord() {
  if (!hasIndexedDb()) return null;
  const db = await openDeepWebIndexedDb();
  try {
    return await getEngineRecord(db);
  } finally {
    db.close();
  }
}

export async function clearDeepWebIndexedDbJournal(): Promise<DeepWebIndexedDbSyncReport> {
  if (!hasIndexedDb()) return buildDeepWebIndexedDbUnavailableReport("当前运行环境没有 IndexedDB。");
  const db = await openDeepWebIndexedDb();
  try {
    await clearJournalRows(db);
    const report = buildDeepWebIndexedDbUnavailableReport("IndexedDB journal 已清空。");
    await putEngineRecord(db, engineRecordFromReport(report));
    return report;
  } finally {
    db.close();
  }
}

export async function exportDeepWebIndexedDbSnapshot(): Promise<DeepWebIndexedDbSnapshotExportReport> {
  if (!hasIndexedDb()) return buildDeepWebIndexedDbSnapshotExportUnavailableReport("当前运行环境没有 IndexedDB。");

  const db = await openDeepWebIndexedDb();
  try {
    const rows = await getAllJournalRows(db);
    const fallbackReport = summarizeIndexedDbRows(rows, 0);
    const engine = (await getEngineRecord(db)) ?? engineRecordFromReport(fallbackReport);
    const exportedAt = Date.now();
    const tableCount = new Set(rows.map((row) => row.tableName)).size;
    const snapshot: DeepWebIndexedDbSnapshot = {
      id: `deepweb-snapshot-${exportedAt}`,
      exportedAt,
      databaseName: DEEPWEB_INDEXEDDB_NAME,
      databaseVersion: DEEPWEB_INDEXEDDB_VERSION,
      engine,
      rows,
    };
    const payload = JSON.stringify(snapshot, null, 2);
    const status: DeepWebIndexedDbSnapshotExportReport["status"] = rows.length ? "ready" : "empty";
    const evidence = `IndexedDB snapshot ${status} · rows ${rows.length} · tables ${tableCount}`;
    await putSnapshotEvent(db, {
      id: snapshot.id,
      engineId: engine.id,
      exportKind: "export",
      rowCount: rows.length,
      tableCount,
      payloadBytes: byteLength(payload),
      status,
      evidence,
      createdAt: exportedAt,
    });
    await pruneOldestRows(db, DEEPWEB_INDEXEDDB_SNAPSHOT_STORE, DEEPWEB_INDEXEDDB_MAX_SNAPSHOT_EVENTS);

    return {
      status,
      rowCount: rows.length,
      tableCount,
      payloadBytes: byteLength(payload),
      exportedAt,
      evidence,
      next:
        status === "ready"
          ? "快照可用于迁移、回放和后续 SQLite/OPFS 导入。"
          : "先完成一次 DeepWeb journal 同步，再导出可回放快照。",
      payload,
    };
  } finally {
    db.close();
  }
}

export async function importDeepWebIndexedDbSnapshot(input: DeepWebIndexedDbSnapshot | string): Promise<DeepWebIndexedDbSyncReport> {
  if (!hasIndexedDb()) return buildDeepWebIndexedDbUnavailableReport("当前运行环境没有 IndexedDB。");
  const snapshot = typeof input === "string" ? parseIndexedDbSnapshot(input) : input;
  const rows = retainJournalRows(snapshot.rows.filter(isJournalRow));
  if (!rows.length) return buildDeepWebIndexedDbUnavailableReport("导入快照里没有有效 journal 行。");

  const db = await openDeepWebIndexedDb();
  try {
    const writtenRows = await putJournalRows(db, rows);
    await pruneOldestRows(db, DEEPWEB_INDEXEDDB_JOURNAL_STORE, DEEPWEB_INDEXEDDB_MAX_JOURNAL_ROWS);
    const storedRows = await getAllJournalRows(db);
    const report = summarizeIndexedDbRows(storedRows, writtenRows);
    await putEngineRecord(db, engineRecordFromReport(report));
    await putSnapshotEvent(db, {
      id: `deepweb-import-${Date.now()}`,
      engineId: DEEPWEB_INDEXEDDB_ENGINE_ID,
      exportKind: "import",
      rowCount: rows.length,
      tableCount: new Set(rows.map((row) => row.tableName)).size,
      payloadBytes: typeof input === "string" ? byteLength(input) : byteLength(JSON.stringify(input)),
      status: "imported",
      evidence: `IndexedDB snapshot imported · rows ${rows.length}`,
      createdAt: Date.now(),
    });
    await pruneOldestRows(db, DEEPWEB_INDEXEDDB_SNAPSHOT_STORE, DEEPWEB_INDEXEDDB_MAX_SNAPSHOT_EVENTS);
    return report;
  } finally {
    db.close();
  }
}

export async function loadDeepWebIndexedDbSnapshotEvents() {
  if (!hasIndexedDb()) return [];
  const db = await openDeepWebIndexedDb();
  try {
    return await getAllSnapshotEvents(db);
  } finally {
    db.close();
  }
}

function summarizeIndexedDbRows(rows: DeepWebSqliteJournalRow[], writtenRows: number): DeepWebIndexedDbSyncReport {
  const tableCount = new Set(rows.map((row) => row.tableName)).size;
  const lastSyncedAt = rows.reduce((max, row) => Math.max(max, row.createdAt), 0);
  const status: DeepWebIndexedDbSyncReport["status"] = rows.length >= 3 && tableCount >= 3 ? "synced" : "warming";

  return {
    status,
    engineKind: "indexeddb",
    storageMode: "IndexedDB durable journal",
    rowCount: rows.length,
    writtenRows,
    tableCount,
    lastSyncedAt,
    evidence: `IndexedDB ${status} · rows ${rows.length} · tables ${tableCount} · written ${writtenRows}`,
    next:
      status === "synced"
        ? "IndexedDB 已经保存 journal；下一步把同一 writer 接到 sql.js/OPFS SQLite。"
        : "继续写入 snapshot、comparison 和 promotion 三类 journal 行。",
  };
}

function engineRecordFromReport(report: DeepWebIndexedDbSyncReport): DeepWebIndexedDbEngineRecord {
  return {
    id: DEEPWEB_INDEXEDDB_ENGINE_ID,
    engineKind: report.engineKind,
    storageMode: report.storageMode,
    status: report.status,
    rowCount: report.rowCount,
    tableCount: report.tableCount,
    lastSyncedAt: report.lastSyncedAt,
    evidence: report.evidence,
    updatedAt: Date.now(),
  };
}

function openDeepWebIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DEEPWEB_INDEXEDDB_NAME, DEEPWEB_INDEXEDDB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DEEPWEB_INDEXEDDB_JOURNAL_STORE)) {
        const store = db.createObjectStore(DEEPWEB_INDEXEDDB_JOURNAL_STORE, { keyPath: "id" });
        store.createIndex("tableName", "tableName", { unique: false });
        store.createIndex("projectHash", "projectHash", { unique: false });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(DEEPWEB_INDEXEDDB_ENGINE_STORE)) {
        const store = db.createObjectStore(DEEPWEB_INDEXEDDB_ENGINE_STORE, { keyPath: "id" });
        store.createIndex("engineKind", "engineKind", { unique: false });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(DEEPWEB_INDEXEDDB_SNAPSHOT_STORE)) {
        const store = db.createObjectStore(DEEPWEB_INDEXEDDB_SNAPSHOT_STORE, { keyPath: "id" });
        store.createIndex("engineId", "engineId", { unique: false });
        store.createIndex("exportKind", "exportKind", { unique: false });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function putJournalRows(db: IDBDatabase, rows: DeepWebSqliteJournalRow[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DEEPWEB_INDEXEDDB_JOURNAL_STORE, "readwrite");
    const store = tx.objectStore(DEEPWEB_INDEXEDDB_JOURNAL_STORE);
    rows.forEach((row) => store.put(row));
    tx.oncomplete = () => resolve(rows.length);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
  });
}

function getAllJournalRows(db: IDBDatabase): Promise<DeepWebSqliteJournalRow[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DEEPWEB_INDEXEDDB_JOURNAL_STORE, "readonly");
    const request = tx.objectStore(DEEPWEB_INDEXEDDB_JOURNAL_STORE).getAll();
    request.onsuccess = () => {
      const rows = (request.result as DeepWebSqliteJournalRow[]).filter(isJournalRow).sort((a, b) => b.createdAt - a.createdAt);
      resolve(rows);
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
  });
}

function clearJournalRows(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DEEPWEB_INDEXEDDB_JOURNAL_STORE, "readwrite");
    tx.objectStore(DEEPWEB_INDEXEDDB_JOURNAL_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB clear failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB clear aborted"));
  });
}

function putEngineRecord(db: IDBDatabase, record: DeepWebIndexedDbEngineRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DEEPWEB_INDEXEDDB_ENGINE_STORE, "readwrite");
    tx.objectStore(DEEPWEB_INDEXEDDB_ENGINE_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB engine write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB engine write aborted"));
  });
}

function getEngineRecord(db: IDBDatabase): Promise<DeepWebIndexedDbEngineRecord | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DEEPWEB_INDEXEDDB_ENGINE_STORE, "readonly");
    const request = tx.objectStore(DEEPWEB_INDEXEDDB_ENGINE_STORE).get(DEEPWEB_INDEXEDDB_ENGINE_ID);
    request.onsuccess = () => resolve(isEngineRecord(request.result) ? request.result : null);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB engine read failed"));
  });
}

function putSnapshotEvent(db: IDBDatabase, event: DeepWebIndexedDbSnapshotEvent): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DEEPWEB_INDEXEDDB_SNAPSHOT_STORE, "readwrite");
    tx.objectStore(DEEPWEB_INDEXEDDB_SNAPSHOT_STORE).put(event);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB snapshot event write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB snapshot event write aborted"));
  });
}

function getAllSnapshotEvents(db: IDBDatabase): Promise<DeepWebIndexedDbSnapshotEvent[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DEEPWEB_INDEXEDDB_SNAPSHOT_STORE, "readonly");
    const request = tx.objectStore(DEEPWEB_INDEXEDDB_SNAPSHOT_STORE).getAll();
    request.onsuccess = () => {
      const rows = (request.result as DeepWebIndexedDbSnapshotEvent[])
        .filter(isSnapshotEvent)
        .sort((a, b) => b.createdAt - a.createdAt);
      resolve(rows);
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB snapshot event read failed"));
  });
}

function pruneOldestRows(db: IDBDatabase, storeName: string, maxRows: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const countRequest = store.count();
    let removed = 0;
    countRequest.onsuccess = () => {
      let remaining = Math.max(0, countRequest.result - maxRows);
      if (!remaining) return;
      const index = store.index("createdAt");
      const cursorRequest = index.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || remaining <= 0) return;
        cursor.delete();
        removed += 1;
        remaining -= 1;
        cursor.continue();
      };
    };
    tx.oncomplete = () => resolve(removed);
    tx.onerror = () => reject(tx.error ?? new Error(`IndexedDB retention failed: ${storeName}`));
    tx.onabort = () => reject(tx.error ?? new Error(`IndexedDB retention aborted: ${storeName}`));
  });
}

function parseIndexedDbSnapshot(payload: string): DeepWebIndexedDbSnapshot {
  try {
    const parsed = JSON.parse(payload) as DeepWebIndexedDbSnapshot;
    if (Array.isArray(parsed.rows)) return parsed;
  } catch {
    // fall through to the explicit error below
  }
  throw new Error("Invalid DeepWeb IndexedDB snapshot");
}

function isJournalRow(value: unknown): value is DeepWebSqliteJournalRow {
  if (!value || typeof value !== "object") return false;
  const row = value as DeepWebSqliteJournalRow;
  return (
    typeof row.id === "string" &&
    typeof row.tableName === "string" &&
    typeof row.primaryKey === "string" &&
    typeof row.projectHash === "string" &&
    typeof row.sql === "string" &&
    typeof row.status === "string" &&
    typeof row.createdAt === "number"
  );
}

function isSnapshotEvent(value: unknown): value is DeepWebIndexedDbSnapshotEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as DeepWebIndexedDbSnapshotEvent;
  return (
    typeof event.id === "string" &&
    typeof event.engineId === "string" &&
    typeof event.exportKind === "string" &&
    typeof event.rowCount === "number" &&
    typeof event.createdAt === "number"
  );
}

function isEngineRecord(value: unknown): value is DeepWebIndexedDbEngineRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as DeepWebIndexedDbEngineRecord;
  return record.engineKind === "indexeddb" && typeof record.rowCount === "number" && typeof record.updatedAt === "number";
}

function byteLength(value: string) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).length;
  return value.length;
}

function hasIndexedDb() {
  return typeof indexedDB !== "undefined";
}
