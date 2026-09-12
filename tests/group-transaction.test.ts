import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { canonical, createIdentity, hash } from "../packages/core/src/index.js";
import { ProfileDatabase } from "../packages/profile/src/database.js";
import { ProfileOwnership } from "../packages/profile/src/ownership.js";
import {
  readProfileState,
  writeProfileState,
} from "../packages/profile/src/state.js";
import {
  ProtectedGroupStore,
  RegistryCapacityError,
} from "../packages/groups/src/storage.js";
import { GroupRegistry } from "../packages/groups/src/registry.js";
import { closeAnchoredGroup } from "../packages/groups/src/certificates.js";

function fixture(t: any) {
  const root = resolve(".cache/group-transaction");
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "case-")),
    identity = createIdentity("Synthetic scope owner"),
    lease = new ProfileOwnership(directory),
    database = ProfileDatabase.open(directory, identity, () => ({
      bytes: Buffer.from(canonical({ mutations: {} })),
      sourceDigest: hash("synthetic empty state"),
    }));
  t.after(() => {
    database.close();
    lease.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    identity,
    database,
    registry: new GroupRegistry(database.store, identity),
  };
}
const next = Buffer.from(
  canonical({
    mutations: {},
    siteDraft: { blocks: [], theme: "forest", savedAt: 1 },
  }),
);

test("group and private document share one commit; callback rollback and expired scopes cannot leak writes", (t) => {
  const f = fixture(t),
    before = f.database.read(),
    revision = f.database.store.accounting().revision,
    operation = randomUUID();
  assert.throws(
    () =>
      f.database.transaction((tx) =>
        GroupRegistry.inTransaction(tx, f.identity, (g) => {
          g.create(operation, "Rolled back");
          writeProfileState(tx, next, before.digest);
          throw new Error("pre-commit failure");
        }),
      ),
    /pre-commit/,
  );
  assert.equal(f.registry.list().length, 0);
  assert.deepEqual(f.database.read(), before);
  let escaped!: GroupRegistry;
  const committed = f.database.transaction((tx) =>
    GroupRegistry.inTransaction(tx, f.identity, (g) => {
      escaped = g;
      const result = g.create(operation, "Committed");
      writeProfileState(tx, next, before.digest);
      return result;
    }),
  );
  assert.deepEqual(committed.rejections, []);
  assert.equal(f.registry.state(committed.value.groupId).status, "active");
  assert.deepEqual(f.database.read().bytes, next);
  assert.equal(f.database.store.accounting().revision, revision + 1);
  assert.throws(() => escaped.list(), /encerrado/);
  assert.throws(
    () =>
      f.database.transaction((tx) =>
        GroupRegistry.inTransaction(tx, createIdentity("Other"), (g) =>
          g.list(),
        ),
      ),
    /identidade/,
  );
  assert.throws(
    () =>
      f.database.transaction((tx) =>
        GroupRegistry.inTransaction(tx, f.identity, async (g) =>
          g.create(randomUUID(), "Async must rollback"),
        ),
      ),
    /síncrona/,
  );
  assert.equal(f.registry.list().length, 1);
});

test("swallowing a scoped operation failure cannot commit earlier group or private writes", (t) => {
  const f = fixture(t),
    before = f.database.read();
  assert.throws(() =>
    f.database.transaction((tx) =>
      GroupRegistry.inTransaction(tx, f.identity, (g) => {
        const created = g.create(randomUUID(), "Must rollback");
        try {
          g.close(randomUUID(), created.groupId, hash("wrong expected parent"));
        } catch {
          /* Deliberately hostile coordinator. */
        }
        writeProfileState(tx, next, before.digest);
      }),
    ),
  );
  assert.deepEqual(f.database.read(), before);
  assert.equal(f.registry.list().length, 0);
});

test("a verified closure and private decision commit despite a rejected proof tail", (t) => {
  const f = fixture(t),
    group = f.registry.create(randomUUID(), "Close atomically"),
    before = f.database.read();
  const closed = closeAnchoredGroup(
      f.identity,
      f.registry.anchor(group.groupId),
      f.registry.state(group.groupId).head!,
    ),
    invalid = { ...closed, signature: Buffer.alloc(64).toString("base64") };
  const receipt = f.database.transaction((tx) =>
    GroupRegistry.inTransaction(tx, f.identity, (g) => {
      const observed = g.observeHeaders(group.groupId, [closed, invalid]);
      assert.equal(observed.status.status, "closed");
      assert.equal(observed.accepted, 1);
      assert.ok(observed.rejected);
      writeProfileState(tx, next, before.digest);
      return observed;
    }),
  );
  assert.equal(receipt.rejections.length, 1);
  assert.equal(receipt.rejections[0].accepted, 1);
  assert.equal(f.registry.state(group.groupId).status, "closed");
  assert.deepEqual(f.database.read().bytes, next);
});

test("even swallowing the entire authority scope error cannot commit the outer transaction", (t) => {
  const f = fixture(t),
    before = f.database.read();
  assert.throws(
    () =>
      f.database.transaction((tx) => {
        try {
          GroupRegistry.inTransaction(tx, f.identity, (g) => {
            g.create(randomUUID(), "Must rollback");
            writeProfileState(tx, next, before.digest);
            throw new Error("cancel scope");
          });
        } catch {
          /* Deliberately hostile outer coordinator. */
        }
      }),
    /cancel scope/,
  );
  assert.equal(f.registry.list().length, 0);
  assert.deepEqual(f.database.read(), before);
});

test("minimal authority fence commits at full ordinary quota without growing the private document", (t) => {
  const root = resolve(".cache/group-transaction");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "quota-")),
    identity = createIdentity("Quota owner"),
    store = new ProtectedGroupStore(join(dir, "state.sqlite"), identity, {
      create: true,
      limits: {
        totalBytes: 4 * 1024 ** 2 + 65536,
        reserveBytes: 4 * 1024 ** 2,
      },
    });
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const registry = new GroupRegistry(store, identity),
    group = registry.create(randomUUID(), "Quota"),
    initial = Buffer.from(canonical({ mutations: {} })),
    operation = randomUUID();
  const digest = store.transaction((tx) =>
    writeProfileState(tx, initial, null),
  );
  store.transaction((tx) =>
    tx.put(
      "capacity-fill",
      Buffer.alloc(65536 - tx.accounting().ordinaryBytes - 400),
    ),
  );
  const growth = Buffer.from(
    canonical({ mutations: {}, private: "X".repeat(4096) }),
  );
  assert.throws(
    () =>
      store.transaction((tx) =>
        GroupRegistry.inTransaction(tx, identity, (g) => {
          g.close(operation, group.groupId, group.epochId!);
          writeProfileState(tx, growth, digest);
        }),
      ),
    RegistryCapacityError,
  );
  assert.equal(registry.state(group.groupId).status, "active");
  store.transaction((tx) =>
    GroupRegistry.inTransaction(tx, identity, (g) => {
      g.close(operation, group.groupId, group.epochId!);
      assert.equal(readProfileState(tx)!.digest, digest);
    }),
  );
  assert.equal(registry.state(group.groupId).status, "closed");
  assert.deepEqual(store.view(readProfileState)!.bytes, initial);
});
