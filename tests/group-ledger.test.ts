import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonical, createBundle, hash } from "../packages/core/src/index.js";
import {
  GroupLedger,
  GROUP_LEDGER_LIMITS,
} from "../packages/groups/src/ledger.js";
import { AUTHORITY_LIMITS } from "../packages/groups/src/registry.js";
import { RegistryIntegrityError } from "../packages/groups/src/storage.js";
import {
  fixture,
  enroll,
  sync,
  message,
  candidate,
  type Actor,
} from "./fixtures/group-access.js";

const run = <T>(a: Actor, callback: Parameters<typeof GroupLedger.run<T>>[2]) =>
  a.store.transaction((tx) => GroupLedger.run(tx, a.identity, callback)).value;
const bytes = (bundle: ReturnType<typeof createBundle>) =>
  Buffer.byteLength(canonical(bundle));

test("accepted history is authenticated and unknown old content stays separately held after removal", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    b = f.actor("Bruno"),
    id = a.registry.create(randomUUID(), "Group").groupId;
  enroll(a, b, id);
  const old = message(a, id),
    delayed = message(a, id);
  const first = run(b, (l) =>
    l.consider(
      candidate(old, b.identity),
      old.manifest.expires,
      bytes(old),
      new Set(),
    ),
  );
  assert.equal(first.decision.status, "accepted");
  const before = run(b, (l) => l.accepted(old.manifest.id));
  assert.ok(before);
  a.registry.commit(randomUUID(), id, a.registry.state(id).head!.id, {
    title: "Removed",
    members: [a.identity.public],
    joins: [],
  });
  sync(a, b, id);
  const retained = run(b, (l) =>
    l.consider(
      candidate(old, b.identity),
      old.manifest.expires,
      bytes(old),
      new Set([old.manifest.id]),
    ),
  );
  assert.equal(retained.decision.status, "accepted");
  assert.deepEqual(
    run(b, (l) => l.accepted(old.manifest.id)),
    before,
  );
  const held = run(b, (l) =>
    l.consider(
      candidate(delayed, b.identity),
      delayed.manifest.expires,
      bytes(delayed),
      new Set(),
    ),
  );
  assert.equal(held.decision.status, "quarantine");
  assert.equal(held.held, true);
  assert.equal(
    run(b, (l) => l.accepted(delayed.manifest.id)),
    null,
  );
  const initialHold = run(b, (l) => l.held());
  run(b, (l) =>
    l.consider(
      candidate(delayed, b.identity),
      delayed.manifest.expires,
      bytes(delayed),
      new Set(),
    ),
  );
  assert.deepEqual(
    run(b, (l) => l.held()),
    initialHold,
  );
  assert.equal(
    readFileSync(b.path).includes(
      Buffer.from("Exact epoch-bound private message"),
    ),
    false,
  );
});

test("group closure and immutable outbox stop commit together and callback failure rolls both back", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    id = a.registry.create(randomUUID(), "Group").groupId,
    epoch = a.registry.state(id).head!.id;
  const entry = {
      operationId: randomUUID(),
      id: hash("synthetic retained payload"),
      groupId: id,
      epochId: epoch,
    },
    closeOperation = randomUUID();
  assert.equal(run(a, (l) => l.reconcileRetry(entry, true)).allowed, true);
  assert.throws(
    () =>
      run(a, (l, g) => {
        g.close(closeOperation, id, epoch);
        assert.equal(
          l.reconcileRetry(entry, true).stop?.reason,
          "group-closed",
        );
        throw new Error("before commit");
      }),
    /before commit/,
  );
  assert.equal(a.registry.state(id).status, "active");
  assert.equal(
    run(a, (l) => l.stop(entry.operationId)),
    null,
  );
  const committed = run(a, (l, g) => {
    g.close(closeOperation, id, epoch);
    return l.reconcileRetry(entry, true);
  });
  assert.equal(a.registry.state(id).status, "closed");
  assert.equal(committed.stop?.reason, "group-closed");
  assert.deepEqual(
    run(a, (l) => l.reconcileRetry(entry, false)).stop,
    committed.stop,
    "late completion cannot erase supersession context",
  );
  assert.throws(
    () =>
      run(a, (l) =>
        l.reconcileRetry({ ...entry, id: hash("different payload") }, true),
      ),
    RegistryIntegrityError,
  );
});

test("historical receipt uses only a locally persisted accepted target, never an ID supplied by its sender", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    b = f.actor("Bruno"),
    id = a.registry.create(randomUUID(), "Group").groupId;
  enroll(a, b, id);
  const original = message(a, id),
    epoch = a.registry.state(id).head!.id,
    cards = a.registry.privateState(id, epoch)!.members;
  const receipt = createBundle(
    b.identity,
    "receipt",
    {
      type: "receipt",
      conversation: id,
      groupAudience: "historical",
      target: original.manifest.id,
      targetEpoch: epoch,
    },
    cards,
  );
  const before = run(a, (l) =>
    l.consider(
      candidate(receipt, a.identity),
      receipt.manifest.expires,
      bytes(receipt),
      new Set(),
    ),
  );
  assert.equal(before.decision.status, "invalid");
  run(a, (l) =>
    l.consider(
      candidate(original, a.identity),
      original.manifest.expires,
      bytes(original),
      new Set(),
    ),
  );
  const after = run(a, (l) =>
    l.consider(
      candidate(receipt, a.identity),
      receipt.manifest.expires,
      bytes(receipt),
      new Set(),
    ),
  );
  assert.equal(after.decision.status, "accepted");
});

test("missing observation clock or malformed authenticated context cannot grant historical access", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    id = a.registry.create(randomUUID(), "Group").groupId,
    bundle = message(a, id);
  run(a, (l) =>
    l.consider(
      candidate(bundle, a.identity),
      bundle.manifest.expires,
      bytes(bundle),
      new Set(),
    ),
  );
  a.store.transaction((tx) => tx.delete("group-access:clock"));
  assert.throws(
    () => run(a, (l) => l.accepted(bundle.manifest.id)),
    RegistryIntegrityError,
  );
});

test("quarantine byte quota uses actual signed ciphertext sizes and refuses overflow", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    payload = {
      type: "message",
      conversation: hash("unknown group"),
      groupEpoch: hash("unknown epoch"),
      groupAudience: "epoch",
      members: [a.identity.public],
      attachments: [
        {
          name: "payload.bin",
          mime: "application/octet-stream",
          data: Buffer.alloc(2 * 1024 ** 2, 7).toString("base64"),
        },
      ],
    };
  let heldBytes = 0,
    refused = false;
  for (let i = 0; i < 8; i++) {
    const bundle = createBundle(a.identity, "message", payload, [
      a.identity.public,
    ]);
    const result = run(a, (l) =>
      l.consider(
        candidate(bundle, a.identity),
        bundle.manifest.expires,
        bytes(bundle),
        new Set(),
      ),
    );
    assert.equal(result.decision.status, "awaiting-proof");
    if (!result.held) {
      refused = true;
      assert.ok(heldBytes + bytes(bundle) > 16 * 1024 ** 2);
      break;
    }
    heldBytes += bytes(bundle);
  }
  assert.equal(refused, true);
  assert.equal(run(a, (l) => l.accounting()).heldBytes, heldBytes);
});

test("minimal outbox stop survives exhausted ordinary space without rewriting private content", (t) => {
  const f = fixture(t),
    a = f.actor("Alice", {
      totalBytes: 4 * 1024 ** 2 + 65536,
      reserveBytes: 4 * 1024 ** 2,
    }),
    id = a.registry.create(randomUUID(), "Group").groupId;
  const epoch = a.registry.state(id).head!.id,
    entry = {
      operationId: randomUUID(),
      id: hash("retained pending bytes"),
      groupId: id,
      epochId: epoch,
    };
  a.store.transaction((tx) =>
    tx.put(
      "ordinary-fill",
      Buffer.alloc(65536 - tx.accounting().ordinaryBytes - 400),
    ),
  );
  const result = run(a, (l, g) => {
    g.close(randomUUID(), id, epoch);
    return l.reconcileRetry(entry, true);
  });
  assert.equal(result.stop?.reason, "group-closed");
  assert.deepEqual(
    run(a, (l) => l.stop(entry.operationId)),
    result.stop,
  );
  assert.equal(a.registry.state(id).status, "closed");
});

test("ledger readers cannot escape the borrowed scope, even when every collection is empty", (t) => {
  const f = fixture(t),
    a = f.actor("Alice");
  let escaped!: GroupLedger;
  run(a, (l) => {
    escaped = l;
    assert.equal(l.accounting().held, 0);
  });
  assert.throws(() => escaped.held(), /encerrado/);
  assert.throws(() => escaped.accounting(), /encerrado/);
  assert.throws(() => escaped.retireStops(new Set()), /encerrado/);
});

test("the authority reserve also accommodates every retained outbox stop", (t) => {
  const f = fixture(t),
    a = f.actor("Reserve", {
      totalBytes: 4 * 1024 ** 2 + 65536,
      reserveBytes: 4 * 1024 ** 2,
    });
  a.store.transaction((tx) => {
    tx.put("ordinary-fill", Buffer.alloc(65536 - 420));
    for (let i = 0; i < AUTHORITY_LIMITS.groups; i++)
      tx.put(
        "group:" + hash(String(i)),
        Buffer.alloc(AUTHORITY_LIMITS.checkpointBytes),
        "checkpoint",
      );
    for (let i = 0; i < AUTHORITY_LIMITS.operations; i++)
      tx.put(
        "operation:" + randomUUID(),
        Buffer.alloc(AUTHORITY_LIMITS.operationBytes),
        "checkpoint",
      );
    tx.put(
      "group-access:stops",
      Buffer.alloc(GROUP_LEDGER_LIMITS.stopBytes),
      "checkpoint",
    );
    tx.put("group-access:clock", Buffer.alloc(256), "checkpoint");
    tx.put(
      "group-access:losses",
      Buffer.alloc(GROUP_LEDGER_LIMITS.lossBytes),
      "checkpoint",
    );
  });
});

test("quarantine count remains bounded and replay does not consume another slot", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    payload = {
      type: "message",
      text: "Unknown authority",
      conversation: hash("unknown group"),
      groupEpoch: hash("unknown epoch"),
      groupAudience: "epoch",
      members: [a.identity.public],
    };
  let first: ReturnType<typeof createBundle> | undefined;
  for (let i = 0; i < 129; i++) {
    const bundle = createBundle(a.identity, "message", payload, [
      a.identity.public,
    ]);
    first ??= bundle;
    const result = run(a, (l) =>
      l.consider(
        candidate(bundle, a.identity),
        bundle.manifest.expires,
        bytes(bundle),
        new Set(),
      ),
    );
    assert.equal(result.held, i < 128);
  }
  assert.equal(run(a, (l) => l.accounting()).held, 128);
  assert.equal(run(a, (l) => l.losses()).holdRefused, 1);
  assert.equal(
    run(a, (l) =>
      l.consider(
        candidate(first!, a.identity),
        first!.manifest.expires,
        bytes(first!),
        new Set(),
      ),
    ).held,
    true,
  );
  assert.equal(run(a, (l) => l.accounting()).held, 128);
  assert.equal(
    run(a, (l) => l.losses()).holdRefused,
    1,
    "retained replay is not another refusal",
  );
});

test(
  "full4096 history respects protected records and retains the exact accepted count on retirement",
  { timeout: 120000 },
  (t) => {
    const f = fixture(t),
      a = f.actor("History limit"),
      id = a.registry.create(randomUUID(), "Group").groupId,
      epoch = a.registry.state(id).head!.id;
    const ids = Array.from({ length: 4096 }, (_, i) =>
        hash("authenticated synthetic history " + i),
      ),
      expires = Date.now() + 3600000;
    // These are authenticated synthetic metadata records for a storage-limit
    // fixture, not fabricated claims that4096 network messages were delivered.
    a.store.transaction((tx) => {
      tx.put(
        "group-access:clock",
        Buffer.from(canonical({ version: 1, sequence: 4096 })),
        "checkpoint",
      );
      ids.forEach((key, i) =>
        tx.put(
          "group-history:" + key,
          Buffer.from(
            canonical({
              version: 1,
              context: {
                id: key,
                groupId: id,
                epochId: epoch,
                author: a.identity.public.id,
                kind: "message",
                readers: [a.identity.public.id],
              },
              observed: i + 1,
              expires,
            }),
          ),
        ),
      );
    });
    const bundle = message(a, id),
      value = candidate(bundle, a.identity),
      protectedIds = new Set(ids);
    const refused = run(a, (l) =>
      l.consider(value, bundle.manifest.expires, bytes(bundle), protectedIds),
    );
    assert.equal(refused.decision.status, "quarantine");
    assert.equal(run(a, (l) => l.accounting()).accepted, 4096);
    assert.equal(run(a, (l) => l.losses()).historyRefused, 1);
    protectedIds.delete(ids[0]);
    const admitted = run(a, (l) =>
      l.consider(value, bundle.manifest.expires, bytes(bundle), protectedIds),
    );
    assert.equal(admitted.decision.status, "accepted");
    assert.equal(
      run(a, (l) => l.accepted(ids[0])),
      null,
    );
    assert.ok(run(a, (l) => l.accepted(ids[1])));
    assert.equal(run(a, (l) => l.accounting()).accepted, 4096);
    assert.equal(run(a, (l) => l.losses()).historyRetired, 1);
    assert.equal(run(a, (l) => l.held()).length, 0);
  },
);
