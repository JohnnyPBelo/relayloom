import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { LoomNode } from "../apps/node/src/node.js";
import { Router } from "../packages/transport/src/index.js";
import { GroupLedger } from "../packages/groups/src/ledger.js";
import { messagingPair } from "./fixtures/group-send.js";
import { password, until } from "./helpers.js";

async function fixture(t: TestContext) {
  const f = await messagingPair();
  let activeNode: LoomNode | undefined, activeSink: Router | undefined;
  t.after(async () => {
    await activeSink?.stop();
    await activeNode?.stop();
    await f.close();
  });
  const sent = await f.a.call("send", {
    operationId: randomUUID(),
    content: {
      type: "message",
      text: "Receipt failure boundary",
      conversation: f.groupId,
      groupEpoch: f.epoch,
      groupAudience: "epoch",
    },
    recipients: [f.bob.id],
    ttlMs: 600000,
  });
  await f.a.call("connect", { host: "127.0.0.1", port: f.b.tcpPort });
  await until(
    () => f.b.call("state"),
    (s) => s.objects.some((o: any) => o.id === sent.id),
  );
  await f.b.stop();
  const node = new LoomNode(f.b.dir),
    internals = node as any;
  activeNode = node;
  node.unlock(password);
  clearInterval(internals.syncTimer);
  const target = node.objects().find((o) => o.id === sent.id)!;
  assert.ok(target);
  const sink = new Router({ relay: false }),
    packets: any[] = [];
  activeSink = sink;
  sink.on("payload", (p) => packets.push(p));
  node.router.connectTcp("127.0.0.1", await sink.listen());
  await until(
    async () => node.router.peers,
    (peers) => peers.some((p) => p.connected),
  );
  node.router.broadcast({ witness: "confirmation-reachable" });
  await until(
    async () => packets,
    (items) => items.some((p) => p.witness === "confirmation-reachable"),
  );
  const receipts = () =>
    packets.filter((p) => p.bundle?.manifest.kind === "receipt");
  return {
    ...f,
    node,
    internals,
    target,
    packets,
    receipts,
    publish: () => internals.publishConfirmation(target, "receipt"),
  };
}

for (const committed of [false, true])
  test(`group confirmation ${committed ? "lost commit response" : "rollback"} cannot transmit before successful admission`, async (t) => {
    const f = await fixture(t),
      database = f.internals.privateDatabase,
      transaction = database.transaction.bind(database);
    let captured = "";
    database.transaction = (callback: any) => {
      if (committed) {
        const result = transaction(callback);
        if (result?.manifest?.kind === "receipt") {
          captured = result.manifest.id;
          throw new Error("fixture receipt after commit");
        }
        return result;
      }
      return transaction((tx: any) => {
        const result = callback(tx);
        if (result?.manifest?.kind === "receipt") {
          captured = result.manifest.id;
          throw new Error("fixture receipt before commit");
        }
        return result;
      });
    };
    assert.throws(f.publish, /fixture receipt/);
    assert.ok(captured);
    assert.equal(f.node.store.has(captured), false);
    const admitted = f.internals.privateDatabase.transaction(
      (tx: any) =>
        GroupLedger.run(tx, f.node.identity!, (ledger) =>
          ledger.accepted(captured),
        ).value,
    );
    assert.equal(!!admitted, committed);
    await delay(200);
    assert.equal(f.receipts().length, 0);
    f.node.view(f.target.id);
    await until(
      async () => f.receipts(),
      (items) => items.length === 1,
    );
    const receipt = f.receipts()[0].bundle;
    assert.equal(receipt.manifest.author.id, f.bob.id);
    assert.notEqual(receipt.manifest.id, captured);
    f.node.view(f.target.id);
    await delay(150);
    assert.equal(f.receipts().length, 1);
  });

test("blocked readers and missing original bytes cannot mint a group read fact", async (t) => {
  const f = await fixture(t),
    original = f.node.store.get(f.target.id, false);
  f.node.localAction("block", f.alice.id, true);
  assert.throws(f.publish, /confirmada/);
  f.node.localAction("block", f.alice.id, false);
  f.node.store.remove(f.target.id);
  assert.throws(f.publish);
  await delay(200);
  assert.equal(f.receipts().length, 0);
  f.node.store.put(original);
  f.node.view(f.target.id);
  await until(
    async () => f.receipts(),
    (items) => items.length === 1,
  );
});

test("missing historical group proof pauses confirmation until verified proof is restored", async (t) => {
  const f = await fixture(t);
  const head = (await f.command(f.a, { action: "state", groupId: f.groupId }))
    .group.head;
  // Closure retains the last verified private cursor. Advance it with a real
  // snapshot first, so removing the original proof is absence, not corruption.
  const advanced = await f.command(f.a, {
    action: "commit",
    operationId: randomUUID(),
    groupId: f.groupId,
    expected: f.epoch,
    title: "New verified cursor",
    members: f.snapshot.members,
    joins: [],
  });
  const current = await f.command(f.a, {
    action: "private-state",
    groupId: f.groupId,
    epochId: advanced.group.head.id,
  });
  f.node.groupCommand({
    action: "headers",
    groupId: f.groupId,
    headers: [advanced.group.head],
  });
  f.node.groupCommand({
    action: "snapshot",
    groupId: f.groupId,
    epochId: advanced.group.head.id,
    snapshot: current.snapshot,
  });
  const closed = await f.command(f.a, {
    action: "close",
    operationId: randomUUID(),
    groupId: f.groupId,
    expected: advanced.group.head.id,
  });
  f.node.groupCommand({
    action: "headers",
    groupId: f.groupId,
    headers: [closed.group.head],
  });
  f.internals.privateDatabase.transaction((tx: any) =>
    tx.delete(`snapshot:${f.groupId}:${head.body.snapshotHash}`),
  );
  assert.throws(f.publish, /autoridade histórica/);
  await delay(200);
  assert.equal(f.receipts().length, 0);
  f.node.groupCommand({
    action: "snapshot",
    groupId: f.groupId,
    epochId: f.epoch,
    snapshot: f.snapshot,
  });
  f.node.view(f.target.id);
  await until(
    async () => f.receipts(),
    (items) => items.length === 1,
  );
});
