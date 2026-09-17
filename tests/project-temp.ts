import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";

/** Each fixture owns its directory even when no earlier test/build created a
 * cache. Never erase the shared cache to manufacture a clean test environment. */
export function projectTemp(prefix: string): string {
  if (!/^[a-z][a-z0-9-]{0,70}-$/.test(prefix))
    throw new Error("Invalid project fixture prefix");
  const root = resolve(".cache/tmp");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return mkdtempSync(join(root, prefix));
}
