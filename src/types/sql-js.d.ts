declare module "sql.js" {
  export type SqlJsStatic = {
    Database: new (data?: Uint8Array) => Database;
  };

  export type QueryExecResult = {
    columns: string[];
    values: unknown[][];
  };

  export type Database = {
    run(sql: string, params?: unknown[]): Database;
    exec(sql: string): QueryExecResult[];
    export(): Uint8Array;
    close(): void;
  };

  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
}
