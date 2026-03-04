import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";
import { getDb } from "./index";

let migrated = false;

export function runMigrations() {
  if (migrated) return;
  migrate(getDb(), { migrationsFolder: resolve(__dirname, "migrations") });
  migrated = true;
}
