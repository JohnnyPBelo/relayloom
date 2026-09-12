import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createIdentity, canonical, hash } from "../packages/core/src/index.js";
import {
  ProtectedGroupStore,
  RegistryIntegrityError,
} from "../packages/groups/src/storage.js";
import {
  readProfileState,
  writeProfileState,
  PROFILE_STATE_LIMITS,
} from "../packages/profile/src/state.js";
function fixture(t: any) {
  const root = resolve(".cache/profile-state");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "case-")),
    path = join(dir, "state.sqlite"),
    identity = createIdentity("Synthetic private-state owner");
  let store = new ProtectedGroupStore(path, identity, { create: true });
  const id = store.storeId();
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    path,
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = new ProtectedGroupStore(path, identity, { expectedStoreId: id });
    },
  };
}
test("chunked private state is encrypted, persists exactly and shrinks atomically", (t) => {
  const f = fixture(t),
    bytes = Buffer.from(
      canonical({
        private: "Confidential household document ".repeat(40000),
        unicode: "🌊\ud800",
      }),
    );
  const digest = f.store.transaction((tx) =>
    writeProfileState(tx, bytes, null),
  );
  assert.equal(digest, hash(bytes));
  assert.ok(f.store.view((tx) => tx.keys("application:state:").length) > 1);
  assert.equal(
    readFileSync(f.path).includes(
      Buffer.from("Confidential household document"),
    ),
    false,
  );
  f.reopen();
  assert.deepEqual(f.store.view(readProfileState), { bytes, digest });
  const revision = f.store.accounting().revision;
  assert.equal(
    f.store.transaction((tx) => writeProfileState(tx, bytes, digest)),
    digest,
  );
  assert.equal(f.store.accounting().revision, revision);
  const shorter = Buffer.from(canonical({ private: "Short" }));
  f.store.transaction((tx) => writeProfileState(tx, shorter, digest));
  assert.equal(
    f.store.view((tx) => tx.keys("application:state:").length),
    1,
  );
  assert.deepEqual(f.store.view(readProfileState)!.bytes, shorter);
});
test("private state and an authority fence commit together or both roll back, with digest CAS", (t) => {
  const f = fixture(t),
    initial = Buffer.from(canonical({ value: 1 })),
    next = Buffer.from(canonical({ value: 2 }));
  const digest = f.store.transaction((tx) =>
    writeProfileState(tx, initial, null),
  );
  assert.throws(
    () =>
      f.store.transaction((tx) => writeProfileState(tx, next, "f".repeat(64))),
    /mudou/,
  );
  assert.throws(
    () =>
      f.store.transaction((tx) => {
        writeProfileState(tx, next, digest);
        tx.put("fence:group", Buffer.from("left"), "checkpoint");
        throw new Error("before commit");
      }),
    /before commit/,
  );
  f.reopen();
  assert.deepEqual(f.store.view(readProfileState)!.bytes, initial);
  assert.equal(
    f.store.view((tx) => tx.get("fence:group")),
    undefined,
  );
  f.store.transaction((tx) => {
    writeProfileState(tx, next, digest);
    tx.put("fence:group", Buffer.from("left"), "checkpoint");
  });
  f.reopen();
  assert.deepEqual(f.store.view(readProfileState)!.bytes, next);
  assert.equal(f.store.view((tx) => tx.get("fence:group"))!.toString(), "left");
});
test("missing, orphan and hash-mismatched chunks fail closed rather than yielding partial state", (t) => {
  for (const mode of ["missing", "orphan", "hash"]) {
    const f = fixture(t),
      bytes = Buffer.from(canonical({ private: "Original" }));
    f.store.transaction((tx) => writeProfileState(tx, bytes, null));
    f.store.transaction((tx) => {
      if (mode === "missing") tx.delete("application:state:0000");
      else if (mode === "orphan") tx.delete("application:state");
      else
        tx.put(
          "application:state:0000",
          Buffer.from(canonical({ private: "Modified" })),
        );
    });
    assert.throws(() => f.store.view(readProfileState), RegistryIntegrityError);
    assert.throws(() => f.store.view(readProfileState), /incerto/);
  }
});
test("the full declared private-state byte bound fits while oversize input makes no writes", (t) => {
  const f = fixture(t),
    bytes = Buffer.from(canonical("x".repeat(PROFILE_STATE_LIMITS.bytes - 2)));
  assert.equal(bytes.length, PROFILE_STATE_LIMITS.bytes);
  const digest = f.store.transaction((tx) =>
    writeProfileState(tx, bytes, null),
  );
  assert.equal(
    f.store.view((tx) => tx.keys("application:state:").length),
    PROFILE_STATE_LIMITS.chunks,
  );
  const revision = f.store.accounting().revision;
  assert.throws(
    () =>
      f.store.transaction((tx) =>
        writeProfileState(
          tx,
          Buffer.alloc(PROFILE_STATE_LIMITS.bytes + 1),
          digest,
        ),
      ),
    /limites/,
  );
  assert.equal(f.store.accounting().revision, revision);
  assert.equal(f.store.view(readProfileState)!.digest, digest);
});
