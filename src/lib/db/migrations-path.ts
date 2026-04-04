import { existsSync } from "node:fs";
import { resolve } from "node:path";

const bundledMigrationsFolder = resolve(process.cwd(), "migrations");
const sourceMigrationsFolder = resolve(process.cwd(), "src", "lib", "db", "migrations");

export function resolveMigrationsFolder() {
  return existsSync(bundledMigrationsFolder) ? bundledMigrationsFolder : sourceMigrationsFolder;
}
