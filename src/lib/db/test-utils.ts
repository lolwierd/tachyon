import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach } from "vitest";
import { _setTestDb } from "./index";
import * as schema from "./schema";

const nodeRequire = createRequire(import.meta.url);
const dbDir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(dbDir, "migrations");

function createInMemoryDb() {
  const Database = nodeRequire("better-sqlite3") as typeof import("better-sqlite3");
  const sqlite = new Database(":memory:");
  // WAL is pointless for in-memory DBs; skip it

  const db = drizzle(sqlite, { schema });
  sqlite.pragma("foreign_keys = OFF");
  migrate(db, { migrationsFolder });
  sqlite.pragma("foreign_keys = ON");
  return db;
}

/**
 * Call in a `describe` block to isolate each test with a fresh in-memory DB.
 * Sets the DB singleton to an in-memory instance before every test.
 */
export function useTestDb() {
  beforeEach(() => {
    _setTestDb(createInMemoryDb());
  });
}
