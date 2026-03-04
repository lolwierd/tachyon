import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import * as schema from "./schema";

type ReaderDatabase = BetterSQLite3Database<typeof schema>;

let dbInstance: ReaderDatabase | null = null;
const nodeRequire = createRequire(import.meta.url);

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

  dbInstance = drizzle(sqlite, { schema });
  return dbInstance;
}
