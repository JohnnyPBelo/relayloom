import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { validateUIPreferences } from "../packages/preferences/src/index";
import {
  readUIPreferences,
  saveUIPreferences,
} from "../apps/node/src/ui-preferences";
test("interface preference schema rejects unrelated authority fields and does not invoke getters", () => {
  for (const value of [
    {},
    {
      language: "en-GB",
      theme: "dark",
      glass: false,
      largeText: true,
      highContrast: false,
    },
  ])
    assert.doesNotThrow(() => validateUIPreferences(value));
  for (const value of [
    null,
    [],
    { language: "fr" },
    { language: undefined },
    { theme: null },
    { glass: "true" },
    { relay: true },
    { privateKey: "x" },
    { language: "en-GB", constructor: 1 },
  ])
    assert.throws(() => validateUIPreferences(value));
  let called = false;
  assert.throws(() =>
    validateUIPreferences({
      get language() {
        called = true;
        return "en-GB";
      },
    }),
  );
  assert.equal(called, false);
});
test("bounded preference file preserves prior values on invalid patches or corrupted storage", () => {
  const dir = mkdtempSync(join(process.cwd(), ".cache/ui-preferences-"));
  try {
    assert.deepEqual(readUIPreferences(dir), {});
    saveUIPreferences(dir, { language: "es-ES" });
    assert.deepEqual(saveUIPreferences(dir, { theme: "dark" }), {
      language: "es-ES",
      theme: "dark",
    });
    const file = join(dir, "ui-preferences.json"),
      before = readFileSync(file);
    assert.throws(() => saveUIPreferences(dir, { relay: true }));
    assert.deepEqual(readFileSync(file), before);
    writeFileSync(file, "broken");
    assert.throws(() => readUIPreferences(dir));
    assert.throws(() => saveUIPreferences(dir, { language: "pt-PT" }));
    assert.equal(readFileSync(file, "utf8"), "broken");
    writeFileSync(file, "x".repeat(4097));
    assert.throws(() => readUIPreferences(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test(
  "preferences do not read through a symbolic link",
  { skip: process.platform === "win32" },
  () => {
    const dir = mkdtempSync(join(process.cwd(), ".cache/ui-preferences-link-"));
    try {
      writeFileSync(
        join(dir, "owned-target"),
        JSON.stringify({ version: 1, values: { language: "en-GB" } }),
      );
      symlinkSync("owned-target", join(dir, "ui-preferences.json"));
      assert.throws(() => readUIPreferences(dir));
      assert.throws(() => saveUIPreferences(dir, { theme: "dark" }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
