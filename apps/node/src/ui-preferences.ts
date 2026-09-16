import { openSync, closeSync, lstatSync, fstatSync, readSync } from "node:fs";
import { join } from "node:path";
import { atomic } from "../../../packages/core/src/index";
import {
  validateUIPreferences,
  type UIPreferences,
} from "../../../packages/preferences/src/index";
const filename = "ui-preferences.json";
/** Cosmetic device preferences, without identity material, safe to read while locked. */
export function readUIPreferences(directory: string): UIPreferences {
  const path = join(directory, filename);
  let before;
  try {
    before = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink() || before.size > 4096)
    throw new Error("Preferências de interface inválidas");
  const fd = openSync(path, "r");
  try {
    const actual = fstatSync(fd);
    if (
      !actual.isFile() ||
      actual.size > 4096 ||
      actual.ino !== before.ino ||
      actual.dev !== before.dev
    )
      throw new Error("Preferências de interface inválidas");
    const buffer = Buffer.alloc(4097);
    let count = 0;
    while (count < buffer.length) {
      const received = readSync(fd, buffer, count, buffer.length - count, null);
      if (!received) break;
      count += received;
    }
    if (count > 4096) throw new Error("Preferências de interface inválidas");
    const record = JSON.parse(buffer.subarray(0, count).toString("utf8"));
    if (
      !record ||
      record.version !== 1 ||
      Object.keys(record).sort().join(",") !== "values,version"
    )
      throw new Error("Preferências de interface inválidas");
    validateUIPreferences(record.values);
    return record.values;
  } finally {
    closeSync(fd);
  }
}
export function saveUIPreferences(
  directory: string,
  patch: unknown,
): UIPreferences {
  validateUIPreferences(patch);
  const next = { ...readUIPreferences(directory), ...patch };
  validateUIPreferences(next);
  atomic(
    join(directory, filename),
    JSON.stringify({ version: 1, values: next }),
  );
  return next;
}
