import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { canonical, createBundle, hash } from "../packages/core/src/index.js";
import {
  closeAnchoredGroup,
  createGroupSuccessor,
} from "../packages/groups/src/certificates.js";
import {
  validateOutbox,
  admitOutbox,
  outboxItem,
  type OutboxEntry,
} from "../apps/node/src/outbox.js";
import { password } from "./helpers.js";
import { until } from "./helpers.js";
import { Router } from "../packages/transport/src/index.js";
import { setTimeout as delay } from "node:timers/promises";

import { groupOutboxFixture as fixture } from "./fixtures/group-outbox.js";

test("missing private proof pauses a valid reserved send without losing availability, then releases its obsolete hold", (t) => {
  const f = fixture(t),
    key = `snapshot:${f.group.id}:${f.group.head.body.snapshotHash}`;
  const snapshot = f.command({
    action: "private-state",
    groupId: f.group.id,
    epochId: f.group.head.id,
  }).snapshot;
  const anchor = f.command({
    action: "proofs",
    groupId: f.group.id,
    from: 0,
  }).anchor;
  const successor = createGroupSuccessor(
    f.identity,
    anchor,
    f.group.head,
    snapshot,
    { title: "Awaiting proof", members: snapshot.members, joins: [] },
  );
  f.command({
    action: "headers",
    groupId: f.group.id,
    headers: [successor.epoch],
  });
  const state = f.node.state(),
    item = state.outbox[0];
  assert.equal(item.status, "pending");
  assert.equal(item.retained, true);
  assert.equal(item.groupAuthority?.allowed, false);
  assert.equal(item.groupAuthority?.stop, null);
  assert.equal(
    f.internals.privateState.outbox[f.entry.operationId].phase,
    "ready",
  );
  assert.equal(state.storage.reserved, 1);
  f.command({
    action: "snapshot",
    groupId: f.group.id,
    epochId: successor.epoch.id,
    snapshot: successor.snapshot,
  });
  assert.equal(f.item().groupAuthority?.allowed, true);
  // The verified cursor now points to the successor. Loss of an older private
  // snapshot is missing historical proof, not corruption of that cursor.
  f.internals.privateDatabase.transaction((tx: any) => tx.delete(key));
  const held = f.node.state();
  assert.equal(held.groupContent.held.length, 1);
  assert.equal(
    f.internals.privateState.outbox[f.entry.operationId].phase,
    "ready",
  );
  f.command({
    action: "snapshot",
    groupId: f.group.id,
    epochId: f.group.head.id,
    snapshot,
  });
  const recovered = f.node.state();
  assert.equal(recovered.outbox[0].groupAuthority?.allowed, true);
  assert.equal(recovered.groupContent.held.length, 0);
  assert.equal(
    recovered.storage.reserved,
    1,
    "pending outbox reserve survives quarantine release",
  );
});

test("runtime closure persists the minimal stop without rewriting the private document and releases only automatic protection", async (t) => {
  const f = fixture(t);
  assert.equal(f.item().status, "pending");
  assert.deepEqual(f.node.store.reservations(), [f.entry.id]);
  f.node.localAction("pin", f.entry.id, true);
  const before = f.internals.privateDatabase.read();
  f.close();
  const after = f.internals.privateDatabase.read();
  assert.deepEqual(
    after,
    before,
    "the stop must not depend on private document growth",
  );
  assert.equal(
    JSON.parse(after.bytes).outbox[f.entry.operationId].groupStopped,
    false,
  );
  assert.equal(f.item().status, "superseded");
  assert.equal(f.item().groupAuthority?.stop?.reason, "group-closed");
  assert.equal(f.node.store.isPinned(f.entry.id), true);
  assert.deepEqual(f.node.store.reservations(), []);
  const beforeStop = f.stopped();
  f.node.lock();
  f.node.unlock(password);
  assert.equal(f.item().status, "superseded");
  assert.deepEqual(f.stopped(), beforeStop);
  assert.equal(f.node.retryOutbox(f.entry.operationId).outbox.attempts, 0);
  f.node.localAction("pin", f.entry.id, false);
  assert.equal(f.node.store.isPinned(f.entry.id), false);
});

for (const committed of [false, true])
  test(`runtime group stop and closure recover together after ${committed ? "lost commit response" : "rollback"}`, (t) => {
    const f = fixture(t),
      db = f.internals.privateDatabase,
      transaction = db.transaction.bind(db);
    db.transaction = (callback: any) => {
      if (committed) {
        transaction(callback);
        throw new Error("fixture lost response");
      }
      return transaction((tx: any) => {
        callback(tx);
        throw new Error("fixture rollback");
      });
    };
    assert.throws(f.close, /fixture/);
    assert.equal(
      f.command({ action: "state", groupId: f.group.id }).group.status,
      committed ? "closed" : "active",
    );
    assert.equal(!!f.stopped(), committed);
    assert.equal(f.item().status, committed ? "superseded" : "pending");
    assert.equal(f.node.store.reservations().includes(f.entry.id), !committed);
  });

test("full normal database quota still commits a group stop while the ordinary growth control fails", (t) => {
  const f = fixture(t),
    db = f.internals.privateDatabase;
  db.transaction((tx: any) => {
    let index = 0;
    while (true) {
      const accounting = tx.accounting();
      const remaining =
        accounting.totalBytes -
        accounting.reserveBytes -
        accounting.ordinaryBytes;
      if (remaining <= 400) break;
      tx.put(
        "test-fill:" + index++,
        Buffer.alloc(Math.min(500_000, remaining - 400)),
      );
    }
  });
  const before = db.read();
  assert.throws(
    () =>
      db.transaction((tx: any) => tx.put("test-overflow", Buffer.alloc(4096))),
    /limite|espaço|capacidade/i,
  );
  f.close();
  assert.deepEqual(db.read(), before);
  assert.equal(f.item().status, "superseded");
  f.node.lock();
  f.node.unlock(password);
  assert.equal(f.item().status, "superseded");
});

test("forged stop mirror, mismatched binding and orphan stop all fail authenticated reopening", async (t) => {
  for (const mode of ["mirror", "binding", "orphan"] as const)
    await t.test(mode, (t) => {
      const f = fixture(t);
      if (mode !== "mirror") f.close();
      const document = f.internals.privateDatabase.read();
      const value = JSON.parse(document.bytes);
      const entry = value.outbox[f.entry.operationId];
      if (mode === "mirror") entry.groupStopped = true;
      if (mode === "binding") entry.groupEpoch = "a".repeat(64);
      if (mode === "orphan") delete value.outbox[f.entry.operationId];
      f.internals.privateDatabase.write(
        Buffer.from(canonical(value)),
        document.digest,
      );
      f.node.lock();
      assert.throws(
        () => f.node.unlock(password),
        /Paragem|paragem|intenção|Admissão/,
      );
      assert.equal(f.node.identity, undefined);
    });
});

test("bounded stopped entries coexist with 128 new pending operations; half bindings and extra fields fail", (t) => {
  const f = fixture(t),
    old: Record<string, OutboxEntry> = {};
  for (let n = 0; n < 128; n++) {
    const operationId = randomUUID();
    old[operationId] = {
      ...structuredClone(f.entry),
      operationId,
      id: hash("old" + n),
      groupStopped: true,
    };
  }
  let next = old;
  for (let n = 0; n < 128; n++) {
    const operationId = randomUUID();
    next = admitOutbox(
      next,
      {
        ...structuredClone(f.entry),
        operationId,
        id: hash("new" + n),
        groupStopped: false,
      },
      Date.now(),
    );
  }
  assert.equal(
    Object.keys(validateOutbox(next, f.identity.public.id)).length,
    256,
  );
  assert.throws(
    () =>
      admitOutbox(next, { ...f.entry, operationId: randomUUID() }, Date.now()),
    /cheia/,
  );
  for (const patch of [
    { groupEpoch: undefined },
    { groupStopped: undefined },
    { conversation: "dm:" + hash("x") },
    { extra: true },
  ]) {
    const entry = JSON.parse(JSON.stringify({ ...f.entry, ...patch }));
    assert.throws(() =>
      validateOutbox({ [entry.operationId]: entry }, f.identity.public.id),
    );
  }
  const completed = {
    ...f.entry,
    groupStopped: true,
    confirmations: { [f.reader.public.id]: { receivedAt: 10, readAt: 20 } },
  };
  assert.equal(outboxItem(completed, completed.expires + 1, []).status, "read");
  assert.equal(
    outboxItem(completed, completed.expires + 1, []).contentExpired,
    true,
  );
});

test("a restrictive prefix with an invalid tail stops the runtime intent in its accepted transaction", (t) => {
  const f = fixture(t);
  const anchor = f.command({
    action: "proofs",
    groupId: f.group.id,
    from: 0,
  }).anchor;
  const closed = closeAnchoredGroup(f.identity, anchor, f.group.head);
  const response = f.command({
    action: "headers",
    groupId: f.group.id,
    headers: [
      closed,
      { ...closed, signature: Buffer.alloc(64).toString("base64") },
    ],
  });
  assert.ok(response.observation.rejected);
  assert.equal(f.item().status, "superseded");
  assert.equal(f.stopped().epochId, f.entry.groupEpoch);
  assert.deepEqual(f.node.store.reservations(), []);
});

test("stop retirement and removal of the corresponding intent share a private commit", (t) => {
  const f = fixture(t);
  f.close();
  const db = f.internals.privateDatabase,
    transaction = db.transaction.bind(db);
  const next = structuredClone(f.internals.privateState);
  delete next.outbox[f.entry.operationId];
  db.transaction = (callback: any) =>
    transaction((tx: any) => {
      callback(tx);
      throw new Error("fixture retirement rollback");
    });
  assert.throws(() => f.internals.persistPrivate(next), /fixture retirement/);
  assert.equal(f.item().status, "superseded");
  assert.ok(f.stopped());
  f.internals.persistPrivate(next);
  assert.equal(f.stopped(), null);
  f.node.lock();
  f.node.unlock(password);
  assert.equal(f.node.state().outbox.length, 0);
});

for (const stop of [true, false])
  test(`runtime ${stop ? "stop cancels" : "negative control delivers"} its existing transport queue`, async (t) => {
    const f = fixture(t),
      sink = new Router({ relay: false });
    t.after(() => sink.stop());
    const received: any[] = [];
    sink.on("payload", (p) => received.push(p));
    f.node.router.broadcast({ type: "bundle", bundle: f.bundle }, "bulk");
    if (stop) f.close();
    f.node.router.connectTcp("127.0.0.1", await sink.listen());
    f.node.router.broadcast({ witness: "reachable" });
    await until(
      async () => received,
      (list) => list.some((p) => p.witness === "reachable"),
    );
    if (!stop)
      await until(
        async () => received,
        (list) => list.some((p) => p.bundle?.manifest.id === f.entry.id),
      );
    await delay(300);
    assert.equal(
      received.some((p) => p.bundle?.manifest.id === f.entry.id),
      !stop,
    );
    assert.equal(
      f.item().attempts,
      0,
      "fixture did not invent an outbox transmission attempt",
    );
  });

for (const mode of ["active", "closed", "locked"] as const)
  test(`real TCP cache request checks ${mode} author authority even after delivery completed`, async (t) => {
    const f = fixture(t),
      sink = new Router({ relay: false });
    t.after(() => sink.stop());
    const next = structuredClone(f.internals.privateState);
    next.outbox[f.entry.operationId].confirmations[f.reader.public.id] = {
      receivedAt: Date.now(),
    };
    f.internals.persistPrivate(next);
    assert.equal(f.item().status, "received");
    if (mode === "closed") f.close();
    // Stored witness has no initial outgoing packet. Its later receipt proves
    // the request reached the real application serving branch on this socket.
    const witness = createBundle(
      f.identity,
      "post",
      { type: "post", text: "request witness" },
      "public",
      60000,
    );
    f.node.store.put(witness);
    if (mode === "locked") f.node.lock();
    const received: any[] = [];
    sink.on("payload", (p) => received.push(p));
    f.node.router.connectTcp("127.0.0.1", await sink.listen());
    await until(
      async () => sink.peers,
      (peers) => peers.some((p) => p.connected),
    );
    sink.broadcast({ type: "request", ids: [f.entry.id, witness.manifest.id] });
    await until(
      async () => received,
      (list) => list.some((p) => p.bundle?.manifest.id === witness.manifest.id),
    );
    if (mode === "active")
      await until(
        async () => received,
        (list) => list.some((p) => p.bundle?.manifest.id === f.entry.id),
      );
    f.node.sync();
    await delay(350);
    assert.equal(
      received.some((p) => p.bundle?.manifest.id === f.entry.id),
      mode === "active",
    );
    assert.equal(
      received.some(
        (p) => p.type === "inventory" && p.ids.includes(f.entry.id),
      ),
      mode === "active",
    );
    if (mode !== "locked")
      assert.equal(
        f.item().status,
        "received",
        "closure must preserve the prior delivery fact",
      );
  });
