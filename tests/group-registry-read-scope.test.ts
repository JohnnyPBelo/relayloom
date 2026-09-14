import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GroupRegistry } from "../packages/groups/src/registry.js";
import { ProtectedGroupStore } from "../packages/groups/src/storage.js";
import { canonical } from "../packages/core/src/index.js";
import { fixture } from "./fixtures/group-access.js";

test("repeated authority reads share verified checkpoint work only inside an unchanged transaction", (t) => {
  const f = fixture(t),
    a = f.actor("Scoped authority owner");
  const id = a.registry.create(randomUUID(), "Scoped verified reads").groupId;
  const counts: number[] = [];
  let escaped: GroupRegistry;
  for (let attempt = 0; attempt < 2; attempt++) {
    a.store.transaction((tx) => {
      let reads = 0;
      const get = tx.get.bind(tx);
      tx.get = (key) => {
        if (key === "group:" + id) reads++;
        return get(key);
      };
      GroupRegistry.inTransaction(tx, a.identity, (g) => {
        escaped = g;
        for (let n = 0; n < 5; n++) {
          const state = g.state(id);
          assert.equal(state.status, "active");
          assert.equal(state.creator.name, "Scoped authority owner");
          // Returned views cannot mutate a retained verification result.
          state.creator.name = "Caller mutation";
        }
      });
      counts.push(reads);
    });
    assert.throws(() => escaped!.state(id), /encerrado|terminado/);
  }
  assert.deepEqual(
    counts,
    [1, 1],
    "unchanged reads repeated checkpoint verification or reused it across transactions",
  );
});

test("a write after a cached read revalidates corruption and aborts the outer transaction", (t) => {
  const f = fixture(t),
    a = f.actor("Invalidated authority owner");
  const id = a.registry.create(randomUUID(), "Corruption fence").groupId;
  const storeId = a.store.storeId();
  assert.throws(
    () =>
      a.store.transaction((tx) => {
        GroupRegistry.inTransaction(tx, a.identity, (g) => {
          assert.equal(g.state(id).status, "active");
          const stored = JSON.parse(tx.get("group:" + id)!.toString());
          stored.anchor.signature = "A".repeat(88);
          tx.put("group:" + id, Buffer.from(canonical(stored)), "checkpoint");
          g.state(id);
        });
      }),
    /Checkpoint de autoridade inválido/,
  );
  assert.throws(() => a.registry.state(id), /Registo fechado/);
  a.store.close();
  const reopened = new ProtectedGroupStore(a.path, a.identity, {
    expectedStoreId: storeId,
  });
  try {
    assert.equal(
      new GroupRegistry(reopened, a.identity).state(id).status,
      "active",
      "corruption transaction did not roll back",
    );
  } finally {
    reopened.close();
  }
});

test("a closure in the same authority scope invalidates an earlier active view", (t) => {
  const f = fixture(t),
    a = f.actor("Closing scoped owner");
  const id = a.registry.create(randomUUID(), "Closure fence").groupId;
  a.store.transaction((tx) =>
    GroupRegistry.inTransaction(tx, a.identity, (g) => {
      const before = g.state(id);
      assert.equal(before.status, "active");
      g.close(randomUUID(), id, before.head!.id);
      assert.equal(g.state(id).status, "closed");
      assert.equal(g.state(id).head!.body.state, "closed");
    }),
  );
  assert.equal(a.registry.state(id).status, "closed");
});

for (const prefix of ["epoch:", "snapshot:"]) {
  test(`a cached checkpoint cannot hide deletion of its referenced ${prefix} proof`, (t) => {
    const f = fixture(t),
      a = f.actor("Referenced proof owner");
    const id = a.registry.create(randomUUID(), "Referenced proof").groupId;
    const storeId = a.store.storeId();
    assert.throws(
      () =>
        a.store.transaction((tx) => {
          GroupRegistry.inTransaction(tx, a.identity, (g) => {
            assert.equal(g.state(id).status, "active");
            const keys = tx.keys(prefix);
            assert.equal(
              keys.length,
              1,
              "positive control: referenced proof must exist",
            );
            tx.delete(keys[0]);
            g.state(id);
          });
        }),
      /Checkpoint de autoridade inválido/,
    );
    a.store.close();
    const reopened = new ProtectedGroupStore(a.path, a.identity, {
      expectedStoreId: storeId,
    });
    try {
      assert.equal(
        new GroupRegistry(reopened, a.identity).state(id).status,
        "active",
      );
    } finally {
      reopened.close();
    }
  });
}

test("the scoped checkpoint work cache evicts old groups instead of retaining every read", (t) => {
  const f = fixture(t),
    a = f.actor("Bounded scope owner");
  const ids = Array.from(
    { length: 9 },
    (_, n) => a.registry.create(randomUUID(), `Bounded group ${n}`).groupId,
  );
  let firstReads = 0;
  a.store.transaction((tx) => {
    const get = tx.get.bind(tx);
    tx.get = (key) => {
      if (key === "group:" + ids[0]) firstReads++;
      return get(key);
    };
    GroupRegistry.inTransaction(tx, a.identity, (g) => {
      for (const id of ids) assert.equal(g.state(id).status, "active");
      assert.equal(g.state(ids[0]).status, "active");
    });
  });
  assert.equal(
    firstReads,
    2,
    "oldest checkpoint was retained beyond the eight-entry budget",
  );
});
