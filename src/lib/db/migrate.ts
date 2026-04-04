import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "./index";
import { resolveMigrationsFolder } from "./migrations-path";

let migrated = false;

export function runMigrations() {
  if (migrated) return;
  migrate(getDb(), { migrationsFolder: resolveMigrationsFolder() });
  migrated = true;
}
