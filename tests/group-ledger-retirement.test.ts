import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { canonical, createBundle, hash } from "../packages/core/src/index.js";
import { GroupLedger } from "../packages/groups/src/ledger.js";
import {
  ProtectedGroupStore,
  RegistryCapacityError,
  RegistryIntegrityError,
} from "../packages/groups/src/storage.js";
import { fixture, candidate, type Actor } from "./fixtures/group-access.js";
const run = <T>(a: Actor, callback: Parameters<typeof GroupLedger.run<T>>[2]) =>
  a.store.transaction((tx) => GroupLedger.run(tx, a.identity, callback)).value;
const bytes = (b: ReturnType<typeof createBundle>) =>
  Buffer.byteLength(canonical(b));

test("stop reads share one validated snapshot but invalidate on mutation and scope exit", (t) => {
  const f = fixture(t),
    a = f.actor("Stop snapshot"),
    group = a.registry.create(randomUUID(), "Group");
  a.registry.close(randomUUID(), group.groupId, group.epochId!);
  const entry = {
    operationId: randomUUID(),
    id: hash("intent"),
    groupId: group.groupId,
    epochId: group.epochId!,
  };
  const original = run(a, (l) => l.reconcileRetry(entry, true).stop!);
  let reads = 0,
    escaped: GroupLedger | undefined;
  a.store.transaction((tx) => {
    const get = tx.get.bind(tx);
    tx.get = (key: string) => {
      if (key === "group-access:stops") reads++;
      return get(key);
    };
    GroupLedger.run(tx, a.identity, (l) => {
      escaped = l;
      for (let i = 0; i < 256; i++) {
        const result = l.stop(entry.operationId)!;
        assert.deepEqual(result, original);
        result.reason = "caller mutation";
      }
    });
  });
  assert.equal(reads, 1, "stable stop list was decoded repeatedly");
  assert.throws(() => escaped!.stop(entry.operationId), /encerrado/);
  assert.throws(
    () =>
      a.store.transaction((tx) =>
        GroupLedger.run(tx, a.identity, (l) => {
          assert.deepEqual(l.stop(entry.operationId), original);
          tx.put(
            "group-access:stops",
            Buffer.from(
              canonical({
                version: 1,
                entries: [{ ...original, reason: "forged" }],
              }),
            ),
            "checkpoint",
          );
          l.stop(entry.operationId);
        }),
      ),
    RegistryIntegrityError,
  );
  a.store.close();
  const reopened = new ProtectedGroupStore(a.path, a.identity, {
    expectedStoreId: a.storeId,
  });
  a.store = reopened;
  try {
    assert.deepEqual(
      run(a, (l) => l.stop(entry.operationId)),
      original,
      "rollback or scope cache lost the authentic stop",
    );
    run(a, (l) => {
      const fresh = l.reconcileRetry(
        { ...entry, operationId: randomUUID(), id: hash("second") },
        true,
      ).stop!;
      const saved = structuredClone(fresh);
      fresh.reason = "caller mutation";
      assert.deepEqual(
        l.stop(saved.operationId),
        saved,
        "newly written cache aliases the returned stop",
      );
    });
  } finally {
    reopened.close();
  }
});

test("all256 immutable stops fit; retirement preserves retained facts and counts only removed records", (t) => {
  const f = fixture(t),
    a = f.actor("Stops"),
    created = a.registry.create(randomUUID(), "Group"),
    epoch = created.epochId!;
  a.registry.close(randomUUID(), created.groupId, epoch);
  const entries = Array.from({ length: 257 }, (_, i) => ({
    operationId: randomUUID(),
    id: hash("retained intent " + i),
    groupId: created.groupId,
    epochId: epoch,
  }));
  run(a, (l) => {
    for (const entry of entries.slice(0, 256))
      assert.equal(l.reconcileRetry(entry, true).stop?.reason, "group-closed");
  });
  const original = run(a, (l) => l.stop(entries[0].operationId));
  assert.ok(original);
  assert.throws(
    () => run(a, (l) => l.reconcileRetry(entries[256], true)),
    RegistryCapacityError,
  );
  assert.equal(run(a, (l) => l.accounting()).stops, 256);
  run(a, (l) => l.retireStops(new Set([entries[0].operationId])));
  assert.deepEqual(
    run(a, (l) => l.stop(entries[0].operationId)),
    original,
  );
  assert.equal(
    run(a, (l) => l.stop(entries[1].operationId)),
    null,
  );
  assert.equal(run(a, (l) => l.losses()).stopRetired, 255);
  run(a, (l) => l.retireStops(new Set([entries[0].operationId])));
  assert.equal(run(a, (l) => l.losses()).stopRetired, 255);
});

test("expired holds have counted removal and malformed counters cannot be used as valid state", (t) => {
  const f = fixture(t),
    a = f.actor("Expiry"),
    payload = {
      type: "message",
      text: "Awaiting proof",
      conversation: hash("unknown"),
      groupEpoch: hash("epoch"),
      groupAudience: "epoch",
      members: [a.identity.public],
    };
  const old = createBundle(
      a.identity,
      "message",
      payload,
      [a.identity.public],
      1000,
    ),
    next = createBundle(a.identity, "message", payload, [a.identity.public]);
  run(a, (l) =>
    l.consider(
      candidate(old, a.identity),
      old.manifest.expires,
      bytes(old),
      new Set(),
      old.manifest.created,
    ),
  );
  run(a, (l) =>
    l.consider(
      candidate(next, a.identity),
      next.manifest.expires,
      bytes(next),
      new Set(),
      old.manifest.expires + 1,
    ),
  );
  assert.equal(run(a, (l) => l.losses()).holdExpired, 1);
  assert.equal(run(a, (l) => l.held()).length, 1);
  a.store.transaction((tx) =>
    tx.put(
      "group-access:losses",
      Buffer.from(
        canonical({
          version: 1,
          historyRetired: 0,
          historyRefused: 0,
          holdRefused: -1,
          holdExpired: 1,
          stopRetired: 0,
        }),
      ),
      "checkpoint",
    ),
  );
  assert.throws(() => run(a, (l) => l.accounting()), RegistryIntegrityError);
});
