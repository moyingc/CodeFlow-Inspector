import type { DeepWebSqliteJournalRow } from "@/src/lib/persistence/deepweb-sqlite-journal";
import type { Database, SqlJsStatic } from "sql.js";

export const DEEPWEB_OPFS_SQLITE_DB_FILE = "codeflow-deepweb.sqlite3";
export const DEEPWEB_SQLJS_INDEXEDDB_NAME = "codeflow-deepweb-sqljs";
export const DEEPWEB_SQLJS_INDEXEDDB_VERSION = 1;
export const DEEPWEB_SQLJS_FILE_STORE = "sqlite_files";
export const DEEPWEB_SQLJS_ENGINE_STORE = "sqlite_engines";
export const DEEPWEB_SQLJS_ENGINE_ID = "sqljs-opfs-main";
export const DEEPWEB_SQLITE_TABLE_COUNT = 29;

export type DeepWebOpfsSqliteReport = {
  status: "synced" | "warming" | "unavailable";
  engineKind: "sqljs_opfs" | "sqljs_indexeddb";
  storageMode: "sql.js OPFS SQLite" | "sql.js IndexedDB SQLite file";
  rowCount: number;
  queryableRows: number;
  tableCount: number;
  databaseBytes: number;
  lastSyncedAt: number;
  queryPreview: string;
  sampleRows: Array<Record<string, unknown>>;
  evidence: string;
  next: string;
};

type DeepWebSqlitePersistResult = {
  engineKind: DeepWebOpfsSqliteReport["engineKind"];
  storageMode: DeepWebOpfsSqliteReport["storageMode"];
  evidence: string;
};

type BuiltDeepWebSqliteDatabase = {
  bytes: Uint8Array;
  queryableRows: number;
  sampleRows: Array<Record<string, unknown>>;
  lastSyncedAt: number;
};

type SqlJsFileRecord = {
  id: typeof DEEPWEB_OPFS_SQLITE_DB_FILE;
  bytes: Uint8Array;
  updatedAt: number;
};

type SqlJsEngineRecord = {
  id: typeof DEEPWEB_SQLJS_ENGINE_ID;
  engineKind: DeepWebOpfsSqliteReport["engineKind"];
  storageMode: DeepWebOpfsSqliteReport["storageMode"];
  status: DeepWebOpfsSqliteReport["status"];
  rowCount: number;
  queryableRows: number;
  tableCount: number;
  databaseBytes: number;
  lastSyncedAt: number;
  evidence: string;
  updatedAt: number;
};

type OpfsNavigator = Navigator & {
  storage?: StorageManager & {
    getDirectory?: () => Promise<OpfsDirectoryHandle>;
  };
};

type OpfsDirectoryHandle = {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle>;
  removeEntry?: (name: string, options?: { recursive?: boolean }) => Promise<void>;
};

type OpfsFileHandle = {
  createWritable(): Promise<OpfsWritableFileStream>;
};

type OpfsWritableFileStream = {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
};

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

export function buildDeepWebOpfsSqliteUnavailableReport(
  reason = "sql.js/OPFS SQLite 等待 WebView 挂载。",
): DeepWebOpfsSqliteReport {
  return {
    status: "warming",
    engineKind: "sqljs_opfs",
    storageMode: "sql.js OPFS SQLite",
    rowCount: 0,
    queryableRows: 0,
    tableCount: 0,
    databaseBytes: 0,
    lastSyncedAt: 0,
    queryPreview: "",
    sampleRows: [],
    evidence: reason,
    next: "浏览器 WebView 挂载后会把 DeepWeb journal 写入可查询 SQLite；桌面阶段可直接换 native SQLite writer。",
  };
}

export async function syncDeepWebOpfsSqliteDatabase(rows: DeepWebSqliteJournalRow[]): Promise<DeepWebOpfsSqliteReport> {
  if (!rows.length) return buildDeepWebOpfsSqliteUnavailableReport("没有 DeepWeb journal 行可以写入 SQLite。");
  if (typeof window === "undefined") return buildDeepWebOpfsSqliteUnavailableReport("服务端渲染阶段不初始化 sql.js。");

  const built = await buildDeepWebSqliteDatabase(rows);
  const persisted = await persistSqliteBytes(built.bytes, rows, built.queryableRows);
  return buildSyncedReport(rows, built, persisted);
}

export async function exportDeepWebOpfsSqliteDatabase(rows: DeepWebSqliteJournalRow[]) {
  if (!rows.length) {
    return {
      report: buildDeepWebOpfsSqliteUnavailableReport("没有 DeepWeb journal 行可以导出 SQLite。"),
      bytes: new Uint8Array(),
      filename: DEEPWEB_OPFS_SQLITE_DB_FILE,
    };
  }
  if (typeof window === "undefined") {
    return {
      report: buildDeepWebOpfsSqliteUnavailableReport("服务端渲染阶段不导出 sql.js SQLite。"),
      bytes: new Uint8Array(),
      filename: DEEPWEB_OPFS_SQLITE_DB_FILE,
    };
  }

  const built = await buildDeepWebSqliteDatabase(rows);
  const persisted = await persistSqliteBytes(built.bytes, rows, built.queryableRows);
  return {
    report: buildSyncedReport(rows, built, persisted),
    bytes: built.bytes,
    filename: DEEPWEB_OPFS_SQLITE_DB_FILE,
  };
}

export async function clearDeepWebOpfsSqliteDatabase(): Promise<DeepWebOpfsSqliteReport> {
  const deletedOpfs = await deleteOpfsSqliteFile();
  let clearedIndexedDb = false;

  if (hasIndexedDb()) {
    const db = await openSqlJsIndexedDb();
    try {
      await clearSqlJsIndexedDb(db);
      clearedIndexedDb = true;
    } finally {
      db.close();
    }
  }

  if (!deletedOpfs && !clearedIndexedDb) {
    return buildDeepWebOpfsSqliteUnavailableReport("当前环境没有可清空的 OPFS/IndexedDB SQLite 文件。");
  }

  return buildDeepWebOpfsSqliteUnavailableReport(
    `sql.js SQLite 已清空：${deletedOpfs ? "OPFS 文件已删除" : "OPFS 未开放"}；${
      clearedIndexedDb ? "IndexedDB 回退库已清空" : "IndexedDB 回退库不可用"
    }。`,
  );
}

async function buildDeepWebSqliteDatabase(rows: DeepWebSqliteJournalRow[]): Promise<BuiltDeepWebSqliteDatabase> {
  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  try {
    initializeDeepWebSchema(db);
    initializeJournalTargetSchemas(db, rows);
    db.run("BEGIN TRANSACTION;");
    rows.forEach((row) => {
      insertJournalTargetRow(db, row);
      db.run(
        `INSERT OR REPLACE INTO deepweb_local_sqlite_journal
          (id, target_table, target_primary_key, project_hash, payload, sql_text, sync_status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [row.id, row.tableName, row.primaryKey, row.projectHash, JSON.stringify(row.payload), row.sql, row.status, row.createdAt],
      );
    });
    db.run("COMMIT;");

    const sampleRows = queryRows(db, queryPreviewSql());
    const queryableRows = countQueryableRows(db);
    const bytes = db.export();
    return {
      queryableRows,
      bytes,
      lastSyncedAt: rows.reduce((max, row) => Math.max(max, row.createdAt), 0),
      sampleRows,
    };
  } catch (error) {
    try {
      db.run("ROLLBACK;");
    } catch {
      // ignore rollback failures from a half-open transaction
    }
    throw error;
  } finally {
    db.close();
  }
}

function initializeJournalTargetSchemas(db: Database, rows: DeepWebSqliteJournalRow[]) {
  const tableColumns = new Map<string, Map<string, string>>();
  rows.forEach((row) => {
    assertSqlIdentifier(row.tableName);
    const columns = tableColumns.get(row.tableName) ?? new Map<string, string>();
    Object.entries(row.payload).forEach(([column, value]) => {
      assertSqlIdentifier(column);
      const inferred = sqliteType(value);
      const current = columns.get(column);
      columns.set(column, current && current !== inferred ? "TEXT" : inferred);
    });
    tableColumns.set(row.tableName, columns);
  });

  tableColumns.forEach((columns, tableName) => {
    const definitions = Array.from(columns.entries()).map(
      ([column, type]) => `${quoteIdentifier(column)} ${type}${column === "id" ? " PRIMARY KEY" : ""}`,
    );
    if (!columns.has("id")) definitions.unshift('"id" TEXT PRIMARY KEY');
    db.run(`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(tableName)} (${definitions.join(", ")});`);
  });
}

function insertJournalTargetRow(db: Database, row: DeepWebSqliteJournalRow) {
  assertSqlIdentifier(row.tableName);
  const entries = Object.entries(row.payload);
  entries.forEach(([column]) => assertSqlIdentifier(column));
  const columns = entries.map(([column]) => quoteIdentifier(column)).join(", ");
  const placeholders = entries.map(() => "?").join(", ");
  db.run(
    `INSERT OR REPLACE INTO ${quoteIdentifier(row.tableName)} (${columns}) VALUES (${placeholders});`,
    entries.map(([, value]) => sqliteParameter(value)),
  );
}

function sqliteParameter(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function sqliteType(value: unknown) {
  if (typeof value === "number") return Number.isInteger(value) ? "INTEGER" : "REAL";
  if (typeof value === "boolean") return "INTEGER";
  return "TEXT";
}

function quoteIdentifier(value: string) {
  assertSqlIdentifier(value);
  return `"${value}"`;
}

function assertSqlIdentifier(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`DeepWeb SQLite rejected unsafe identifier: ${value}`);
}

function buildSyncedReport(
  rows: DeepWebSqliteJournalRow[],
  built: BuiltDeepWebSqliteDatabase,
  persisted: DeepWebSqlitePersistResult,
): DeepWebOpfsSqliteReport {
  return {
    status: "synced",
    engineKind: persisted.engineKind,
    storageMode: persisted.storageMode,
    rowCount: rows.length,
    queryableRows: built.queryableRows,
    tableCount: DEEPWEB_SQLITE_TABLE_COUNT,
    databaseBytes: built.bytes.byteLength,
    lastSyncedAt: built.lastSyncedAt,
    queryPreview: queryPreviewSql(),
    sampleRows: built.sampleRows,
    evidence: persisted.evidence,
    next:
      persisted.engineKind === "sqljs_opfs"
        ? "DeepWeb 已进入 OPFS SQLite，可用 SELECT 查询；下一步把项目图索引和规则命中一起写入同一库。"
        : "当前 WebView 没开放 OPFS，已回退为 sql.js SQLite 二进制文件；桌面壳接入后切到 OPFS/native SQLite。",
  };
}

function initializeDeepWebSchema(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS deepweb_replay_memory_snapshots (
      id TEXT PRIMARY KEY,
      project_name TEXT NOT NULL,
      project_hash TEXT NOT NULL,
      file_count INTEGER NOT NULL,
      function_count INTEGER NOT NULL,
      issue_count INTEGER NOT NULL,
      deepweb_coverage REAL NOT NULL,
      irrigation_score REAL NOT NULL,
      optimization_score REAL NOT NULL,
      accepted_evidence_count INTEGER NOT NULL,
      isolated_evidence_count INTEGER NOT NULL,
      vector_count INTEGER NOT NULL,
      inference_run_count INTEGER NOT NULL,
      teacher_trust_score REAL NOT NULL,
      teacher_consensus_rate REAL NOT NULL,
      maturity_score REAL NOT NULL,
      stable_snapshot TEXT NOT NULL,
      status TEXT NOT NULL,
      dimension_scores TEXT NOT NULL,
      label_breakdown TEXT NOT NULL,
      evidence TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deepweb_replay_comparisons (
      id TEXT PRIMARY KEY,
      current_snapshot_id TEXT NOT NULL,
      baseline_snapshot_id TEXT,
      status TEXT NOT NULL,
      drift_score REAL NOT NULL,
      regression_score REAL NOT NULL,
      improvement_score REAL NOT NULL,
      changed_dimensions TEXT NOT NULL,
      evidence TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deepweb_replay_promotion_decisions (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      gate TEXT NOT NULL,
      score REAL NOT NULL,
      evidence TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deepweb_local_sqlite_journal (
      id TEXT PRIMARY KEY,
      target_table TEXT NOT NULL,
      target_primary_key TEXT NOT NULL,
      project_hash TEXT NOT NULL,
      payload TEXT NOT NULL,
      sql_text TEXT NOT NULL,
      sync_status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deepweb_local_storage_engines (
      id TEXT PRIMARY KEY,
      engine_kind TEXT NOT NULL,
      storage_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      last_synced_at INTEGER NOT NULL,
      evidence TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS deepweb_replay_memory_snapshots_project_idx ON deepweb_replay_memory_snapshots (project_hash);
    CREATE INDEX IF NOT EXISTS deepweb_replay_memory_snapshots_created_idx ON deepweb_replay_memory_snapshots (created_at);
    CREATE INDEX IF NOT EXISTS deepweb_replay_comparisons_status_idx ON deepweb_replay_comparisons (status);
    CREATE INDEX IF NOT EXISTS deepweb_replay_promotion_decisions_gate_idx ON deepweb_replay_promotion_decisions (gate);
    CREATE INDEX IF NOT EXISTS deepweb_local_sqlite_journal_table_idx ON deepweb_local_sqlite_journal (target_table);
  `);
}

async function persistSqliteBytes(
  bytes: Uint8Array,
  rows: DeepWebSqliteJournalRow[],
  queryableRows: number,
): Promise<DeepWebSqlitePersistResult> {
  const opfs = await writeOpfsSqliteFile(bytes);
  if (opfs) return opfs;

  await writeIndexedDbSqliteFile(bytes, rows, queryableRows);
  return {
    engineKind: "sqljs_indexeddb",
    storageMode: "sql.js IndexedDB SQLite file",
    evidence: `sql.js SQLite file stored in IndexedDB fallback · rows ${rows.length} · bytes ${bytes.byteLength}`,
  };
}

async function writeOpfsSqliteFile(bytes: Uint8Array): Promise<DeepWebSqlitePersistResult | null> {
  const root = await opfsRoot();
  if (!root) return null;
  try {
    const file = await root.getFileHandle(DEEPWEB_OPFS_SQLITE_DB_FILE, { create: true });
    const writable = await file.createWritable();
    await writable.write(bytes);
    await writable.close();
    return {
      engineKind: "sqljs_opfs",
      storageMode: "sql.js OPFS SQLite",
      evidence: `sql.js SQLite file persisted to OPFS · ${DEEPWEB_OPFS_SQLITE_DB_FILE} · bytes ${bytes.byteLength}`,
    };
  } catch {
    return null;
  }
}

async function writeIndexedDbSqliteFile(bytes: Uint8Array, rows: DeepWebSqliteJournalRow[], queryableRows: number) {
  if (!hasIndexedDb()) throw new Error("OPFS unavailable and IndexedDB fallback unavailable.");
  const db = await openSqlJsIndexedDb();
  const updatedAt = Date.now();
  try {
    await putSqlJsFileRecord(db, {
      id: DEEPWEB_OPFS_SQLITE_DB_FILE,
      bytes,
      updatedAt,
    });
    await putSqlJsEngineRecord(db, {
      id: DEEPWEB_SQLJS_ENGINE_ID,
      engineKind: "sqljs_indexeddb",
      storageMode: "sql.js IndexedDB SQLite file",
      status: "synced",
      rowCount: rows.length,
      queryableRows,
      tableCount: DEEPWEB_SQLITE_TABLE_COUNT,
      databaseBytes: bytes.byteLength,
      lastSyncedAt: rows.reduce((max, row) => Math.max(max, row.createdAt), 0),
      evidence: `sql.js SQLite fallback synced · rows ${rows.length} · bytes ${bytes.byteLength}`,
      updatedAt,
    });
  } finally {
    db.close();
  }
}

function queryRows(db: Database, sql: string) {
  const result = db.exec(sql)[0];
  if (!result) return [];
  return result.values.map((values) =>
    result.columns.reduce<Record<string, unknown>>((acc, column, index) => {
      acc[column] = values[index];
      return acc;
    }, {}),
  );
}

function countQueryableRows(db: Database) {
  return Number(queryRows(db, "SELECT COUNT(*) AS count FROM deepweb_local_sqlite_journal;")[0]?.count ?? 0);
}

function queryPreviewSql() {
  return `SELECT project_name, deepweb_coverage, irrigation_score, status FROM deepweb_replay_memory_snapshots ORDER BY created_at DESC LIMIT 3;`;
}

async function loadSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = import("sql.js").then((module) =>
      module.default({
        locateFile: () => "/sql-wasm.wasm",
      }),
    );
  }
  return sqlJsPromise;
}

function openSqlJsIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DEEPWEB_SQLJS_INDEXEDDB_NAME, DEEPWEB_SQLJS_INDEXEDDB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DEEPWEB_SQLJS_FILE_STORE)) {
        db.createObjectStore(DEEPWEB_SQLJS_FILE_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(DEEPWEB_SQLJS_ENGINE_STORE)) {
        const store = db.createObjectStore(DEEPWEB_SQLJS_ENGINE_STORE, { keyPath: "id" });
        store.createIndex("engineKind", "engineKind");
        store.createIndex("status", "status");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("sql.js IndexedDB open failed"));
  });
}

function putSqlJsFileRecord(db: IDBDatabase, record: SqlJsFileRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DEEPWEB_SQLJS_FILE_STORE, "readwrite");
    tx.objectStore(DEEPWEB_SQLJS_FILE_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("sql.js IndexedDB file write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("sql.js IndexedDB file write aborted"));
  });
}

function putSqlJsEngineRecord(db: IDBDatabase, record: SqlJsEngineRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DEEPWEB_SQLJS_ENGINE_STORE, "readwrite");
    tx.objectStore(DEEPWEB_SQLJS_ENGINE_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("sql.js IndexedDB engine write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("sql.js IndexedDB engine write aborted"));
  });
}

function clearSqlJsIndexedDb(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([DEEPWEB_SQLJS_FILE_STORE, DEEPWEB_SQLJS_ENGINE_STORE], "readwrite");
    tx.objectStore(DEEPWEB_SQLJS_FILE_STORE).clear();
    tx.objectStore(DEEPWEB_SQLJS_ENGINE_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("sql.js IndexedDB clear failed"));
    tx.onabort = () => reject(tx.error ?? new Error("sql.js IndexedDB clear aborted"));
  });
}

async function deleteOpfsSqliteFile() {
  const root = await opfsRoot();
  if (!root?.removeEntry) return false;
  try {
    await root.removeEntry(DEEPWEB_OPFS_SQLITE_DB_FILE);
    return true;
  } catch {
    return false;
  }
}

async function opfsRoot() {
  if (typeof navigator === "undefined") return null;
  const storage = (navigator as OpfsNavigator).storage;
  if (!storage?.getDirectory) return null;
  return storage.getDirectory();
}

function hasIndexedDb() {
  return typeof indexedDB !== "undefined";
}
