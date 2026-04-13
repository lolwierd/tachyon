import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { resolveMigrationsFolder } from "./migrations-path";
import * as schema from "./schema";

export type ReaderDatabase = BetterSQLite3Database<typeof schema>;

let dbInstance: ReaderDatabase | null = null;
const nodeRequire = createRequire(import.meta.url);

/** Override the DB singleton (used by tests for in-memory isolation). */
export function _setTestDb(db: ReaderDatabase | null) {
  dbInstance = db;
}

export function getDb(): ReaderDatabase {
  if (dbInstance) {
    return dbInstance;
  }

  const Database = nodeRequire("better-sqlite3") as typeof import("better-sqlite3");
  const dbPath = resolve(process.cwd(), "data", "reader.db");
  const dir = resolve(process.cwd(), "data");

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");

  dbInstance = drizzle(sqlite, { schema });

  // Explicitly disable FK enforcement before running migrations — better-sqlite3's
  // bundled SQLite may be compiled with SQLITE_DEFAULT_FOREIGN_KEYS=1 (FK on by
  // default). Drizzle wraps migrations in a transaction where PRAGMA changes are
  // silently ignored, so we must set it OUTSIDE the transaction.
  sqlite.pragma("foreign_keys = OFF");
  migrate(dbInstance, { migrationsFolder: resolveMigrationsFolder() });
  sqlite.pragma("foreign_keys = ON");

  return dbInstance;
}
