import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createIdentity, canonical, hash } from "../packages/core/src/index.js";
import {
  prepareProfileBinding,
  commitProfileBinding,
  decodeProfileBinding,
} from "../packages/profile/src/binding.js";
import { ProtectedGroupStore } from "../packages/groups/src/storage.js";

test("signed initialization binds owner, random store ID and legacy ciphertext across phases", () => {
  const owner = createIdentity("Owner"),
    other = createIdentity("Other"),
    storeId = hash("synthetic preassigned store ID"),
    source = hash("legacy ciphertext");
  const prepared = prepareProfileBinding(owner, storeId, source),
    committed = commitProfileBinding(owner, prepared);
  assert.equal(prepared.body.phase, "prepared");
  assert.equal(committed.body.phase, "committed");
  assert.equal(committed.body.storeId, storeId);
  assert.equal(committed.body.sourceDigest, source);
  assert.equal(committed.body.nonce, prepared.body.nonce);
  assert.notEqual(committed.id, prepared.id);
  assert.deepEqual(
    decodeProfileBinding(Buffer.from(canonical(committed)), owner.public),
    committed,
  );
  assert.throws(() =>
    decodeProfileBinding(Buffer.from(canonical(committed)), other.public),
  );
  assert.throws(() => commitProfileBinding(owner, committed));
  for (const body of [
    { ...prepared.body, phase: "committed" },
    { ...prepared.body, storeId: hash("swapped") },
    { ...prepared.body, sourceDigest: hash("other ciphertext") },
  ])
    assert.throws(() =>
      decodeProfileBinding(
        Buffer.from(canonical({ ...prepared, body })),
        owner.public,
      ),
    );
  assert.throws(() =>
    prepareProfileBinding(
      { ...owner, signSecret: other.signSecret },
      storeId,
      source,
    ),
  );
  assert.throws(() =>
    decodeProfileBinding(
      Buffer.from(canonical({ ...prepared, extra: true })),
      owner.public,
    ),
  );
});
test("a signed intent can pin the exact new store before creation without allowing resets", (t) => {
  const root = resolve(".cache/profile-binding");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "case-")),
    path = join(dir, "state.sqlite"),
    identity = createIdentity("Owner"),
    id = hash("new synthetic ID");
  const store = new ProtectedGroupStore(path, identity, {
    create: true,
    newStoreId: id,
  });
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  assert.equal(store.storeId(), id);
  assert.throws(
    () =>
      new ProtectedGroupStore(path, identity, { create: true, newStoreId: id }),
  );
  assert.throws(
    () => new ProtectedGroupStore(path, identity, { newStoreId: id }),
  );
  store.close();
  const reopened = new ProtectedGroupStore(path, identity, {
    expectedStoreId: id,
  });
  assert.equal(reopened.storeId(), id);
  reopened.close();
  assert.throws(
    () =>
      new ProtectedGroupStore(path, identity, {
        expectedStoreId: hash("another"),
      }),
  );
});
