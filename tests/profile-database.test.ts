import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  canonical,
  createIdentity,
  hash,
  atomic,
} from "../packages/core/src/index.js";
import {
  readPrivateState,
  writePrivateState,
} from "../apps/node/src/local-state.js";
import { ProtectedGroupStore } from "../packages/groups/src/storage.js";
import { ProfileOwnership } from "../packages/profile/src/ownership.js";
import { ProfileDatabase } from "../packages/profile/src/database.js";
import {
  prepareProfileBinding,
  decodeProfileBinding,
} from "../packages/profile/src/binding.js";
import { launchOwned } from "./native/process-helper.js";

function fixture(t: any) {
  const root = resolve(".cache/profile-database");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "case-")),
    identity = createIdentity("Synthetic profile owner"),
    legacyPath = join(dir, "private-state.json");
  writePrivateState(legacyPath, { mutations: {} }, identity);
  const databases: ProfileDatabase[] = [];
  let ownership: ProfileOwnership | undefined;
  const load = () => ({
    bytes: Buffer.from(canonical(readPrivateState(legacyPath, identity))),
    sourceDigest: hash(readFileSync(legacyPath)),
  });
  const acquire = () => {
    ownership = new ProfileOwnership(dir);
  };
  const open = () => {
    const db = ProfileDatabase.open(dir, identity, load);
    databases.push(db);
    return db;
  };
  t.after(() => {
    for (const db of databases) db.close();
    ownership?.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, identity, legacyPath, load, acquire, open };
}
test("staged import binds the actual legacy ciphertext and committed reopen never falls back", (t) => {
  const f = fixture(t);
  f.acquire();
  const before = readFileSync(f.legacyPath),
    legacy = f.load(),
    db = f.open();
  assert.equal(db.binding.body.phase, "committed");
  assert.equal(db.binding.body.sourceDigest, hash(before));
  assert.deepEqual(db.read().bytes, legacy.bytes);
  assert.deepEqual(readFileSync(f.legacyPath), before);
  const next = Buffer.from(
    canonical({ mutations: {}, private: "Only in protected state" }),
  );
  db.write(next, db.read().digest);
  db.close();
  const reopened = ProfileDatabase.open(f.dir, f.identity, () => {
    throw new Error("legacy fallback must not run");
  });
  try {
    assert.deepEqual(reopened.read().bytes, next);
  } finally {
    reopened.close();
  }
});
test("existing unbound, missing initialized and wrong-store databases fail without reset", (t) => {
  for (const kind of ["unbound", "missing", "swapped"]) {
    const f = fixture(t);
    f.acquire();
    const path = join(f.dir, "profile-state.sqlite");
    if (kind === "unbound") {
      const raw = new ProtectedGroupStore(path, f.identity, { create: true });
      raw.close();
      assert.throws(() => f.open(), /sem ligação/);
      assert.equal(existsSync(join(f.dir, "profile-binding.json")), false);
      continue;
    }
    const db = f.open();
    db.close();
    renameSync(path, path + ".preserved");
    if (kind === "swapped") {
      const other = new ProtectedGroupStore(path, f.identity, { create: true });
      other.close();
    }
    assert.throws(() => f.open());
    assert.ok(existsSync(path + ".preserved"));
    if (kind === "missing") assert.equal(existsSync(path), false);
  }
});
test("changed legacy source cannot complete a signed preparation", (t) => {
  const f = fixture(t);
  f.acquire();
  const original = f.load(),
    prepared = prepareProfileBinding(
      f.identity,
      hash("prepared store"),
      original.sourceDigest,
    );
  atomic(join(f.dir, "profile-binding.json"), canonical(prepared));
  writePrivateState(
    f.legacyPath,
    {
      mutations: {},
      siteDraft: { blocks: [], theme: "forest", savedAt: Date.now() },
    },
    f.identity,
  );
  assert.throws(() => f.open(), /legado mudou/);
  assert.equal(existsSync(join(f.dir, "profile-state.sqlite")), false);
  assert.deepEqual(
    decodeProfileBinding(
      readFileSync(join(f.dir, "profile-binding.json")),
      f.identity.public,
    ),
    prepared,
  );
});
test("transaction wrapper cannot erase initialization or the current private document", (t) => {
  const f = fixture(t);
  f.acquire();
  const db = f.open(),
    before = db.read();
  assert.throws(
    () => db.transaction((tx) => tx.delete("application:initialization")),
    /inicialização/,
  );
  db.close();
  const recovered = f.open();
  assert.deepEqual(recovered.read(), before);
});
for (const mode of ["prepared", "imported", "committed"] as const) {
  test(
    `real process death after ${mode} initialization boundary preserves resumable private bytes`,
    { timeout: 30000 },
    async (t) => {
      const f = fixture(t),
        identityFile = join(f.dir, "synthetic-identity.json"),
        marker = join(f.dir, "crash-marker.txt"),
        original = f.load();
      writeFileSync(identityFile, JSON.stringify(f.identity), { mode: 0o600 });
      const process = launchOwned(globalThis.process.execPath, [
        "--import",
        "tsx",
        "tests/fixtures/profile-database-worker.ts",
        f.dir,
        identityFile,
        mode,
        marker,
      ]);
      const result = await process.done;
      assert.equal(result.timedOut, false, result.output);
      assert.equal(
        result.code,
        { prepared: 73, imported: 74, committed: 75 }[mode],
        result.output,
      );
      assert.ok(existsSync(marker));
      f.acquire();
      const recovered = f.open();
      assert.deepEqual(recovered.read().bytes, original.bytes);
      assert.equal(recovered.binding.body.phase, "committed");
      assert.equal(hash(readFileSync(f.legacyPath)), original.sourceDigest);
    },
  );
}
test("replay of the complete earlier initialization state is an explicit rollback limitation", (t) => {
  const f = fixture(t);
  f.acquire();
  const legacy = f.load(),
    prepared = prepareProfileBinding(
      f.identity,
      hash("replay test store"),
      legacy.sourceDigest,
    );
  atomic(join(f.dir, "profile-binding.json"), canonical(prepared));
  const db = f.open();
  db.write(
    Buffer.from(canonical({ mutations: {}, private: "Later state" })),
    db.read().digest,
  );
  db.close();
  // Restoring the whole earlier initialization state includes its signed intent,
  // absent database and unchanged legacy ciphertext. No monotonic witness exists.
  rmSync(join(f.dir, "profile-state.sqlite"));
  atomic(join(f.dir, "profile-binding.json"), canonical(prepared));
  assert.deepEqual(f.open().read().bytes, legacy.bytes);
});
