import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { canonical, createBundle, hash } from "../packages/core/src/index.js";
import { GroupLedger } from "../packages/groups/src/ledger.js";
import {
  RegistryCapacityError,
  RegistryIntegrityError,
} from "../packages/groups/src/storage.js";
import { fixture, candidate, type Actor } from "./fixtures/group-access.js";
const run = <T>(a: Actor, callback: Parameters<typeof GroupLedger.run<T>>[2]) =>
  a.store.transaction((tx) => GroupLedger.run(tx, a.identity, callback)).value;
const bytes = (b: ReturnType<typeof createBundle>) =>
  Buffer.byteLength(canonical(b));

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
