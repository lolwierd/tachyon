import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";
import { db } from "./index";

let migrated = false;

export function runMigrations() {
  if (migrated) return;
  migrate(db, { migrationsFolder: resolve(__dirname, "migrations") });
  migrated = true;
}
