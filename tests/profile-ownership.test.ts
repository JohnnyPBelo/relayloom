import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ProfileOwnership } from "../packages/profile/src/ownership.js";

function fixture(t: any) {
  const root = resolve(".cache/profile-ownership");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "case-"));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  return dir;
}
test("one running owner per profile, another profile remains independent, close permits restart", (t) => {
  const first = fixture(t),
    second = fixture(t),
    a = new ProfileOwnership(first),
    b = new ProfileOwnership(second);
  try {
    assert.throws(() => new ProfileOwnership(first), /já está aberto/);
  } finally {
    a.close();
    b.close();
  }
  a.close();
  const restarted = new ProfileOwnership(first);
  restarted.close();
});
test("empty initialization can recover but foreign or malformed metadata is refused", (t) => {
  const empty = fixture(t);
  writeFileSync(join(empty, "profile-owner.sqlite"), "", { mode: 0o600 });
  const recovered = new ProfileOwnership(empty);
  recovered.close();
  const db = new DatabaseSync(join(empty, "profile-owner.sqlite"));
  db.exec("CREATE TABLE sqliteXconcealed (value TEXT)");
  db.close();
  assert.throws(() => new ProfileOwnership(empty), /Formato/);
  const foreign = fixture(t),
    other = new DatabaseSync(join(foreign, "profile-owner.sqlite"));
  other.exec("CREATE TABLE unrelated (value TEXT)");
  other.close();
  assert.throws(() => new ProfileOwnership(foreign), /Formato/);
});
