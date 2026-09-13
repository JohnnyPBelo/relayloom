import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { LoomNode } from "../apps/node/src/node.js";
import { Router } from "../packages/transport/src/index.js";
import { canonical, createBundle } from "../packages/core/src/index.js";
import { GroupLedger } from "../packages/groups/src/ledger.js";
import { messagingPair } from "./fixtures/group-send.js";
import { password, until } from "./helpers.js";

async function fixture(t: TestContext) {
  const f = await messagingPair();
  let local: LoomNode | undefined;
  const sinks: Router[] = [];
  t.after(async () => {
    for (const sink of sinks) await sink.stop();
    await local?.stop();
    await f.close();
  });
  const sent = await f.a.call("send", {
    operationId: randomUUID(),
    content: {
      type: "message",
      text: "Actual original for event failure controls",
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
  local = node;
  node.unlock(password);
  clearInterval(internals.syncTimer);
  node.objects();
  const content = {
    type: "reaction",
    emoji: "heart",
    value: true,
    target: sent.id,
    conversation: f.groupId,
    groupEpoch: f.epoch,
    targetEpoch: f.epoch,
    groupAudience: "target",
  } as const;
  async function witness() {
    const sink = new Router({ relay: false }),
      packets: any[] = [];
    sinks.push(sink);
    sink.on("payload", (p) => packets.push(p));
    node.router.connectTcp("127.0.0.1", await sink.listen());
    const marker = randomUUID();
    node.router.broadcast({ witness: marker });
    await until(
      async () => packets,
      (items) => items.some((p) => p.witness === marker),
    );
    return { sink, packets };
  }
  return {
    ...f,
    node,
    internals,
    content,
    sent,
    witness,
    publish: () => node.publish(content, [f.alice.id]),
  };
}

for (const committed of [false, true])
  test(`group event admission ${committed ? "lost response" : "rollback"} cannot release bytes early`, async (t) => {
    const f = await fixture(t),
      { packets } = await f.witness();
    const database = f.internals.privateDatabase,
      transaction = database.transaction.bind(database);
    let id = "";
    database.transaction = (callback: any) => {
      if (committed) {
        const result = transaction(callback);
        if (result?.manifest?.kind === "reaction") {
          id = result.manifest.id;
          throw new Error("event committed response lost");
        }
        return result;
      }
      return transaction((tx: any) => {
        const result = callback(tx);
        if (result?.manifest?.kind === "reaction") {
          id = result.manifest.id;
          throw new Error("event rollback");
        }
        return result;
      });
    };
    assert.throws(f.publish, /event /);
    assert.ok(id);
    assert.equal(f.node.store.has(id), false);
    const admitted = f.internals.privateDatabase.transaction(
      (tx: any) =>
        GroupLedger.run(tx, f.node.identity!, (l) => l.accepted(id)).value,
    );
    assert.equal(!!admitted, committed);
    f.node.sync();
    await delay(220);
    assert.equal(
      packets.filter((p) => p.bundle?.manifest.kind === "reaction").length,
      0,
    );
    const valid = f.publish();
    await until(
      async () => packets,
      (ps) => ps.some((p) => p.bundle?.manifest.id === valid.id),
    );
    assert.notEqual(valid.id, id); // Generic publication has no eternal operation UUID.
  });

for (const written of [false, true])
  test(`group event content-store failure ${written ? "after" : "before"} payload write preserves honest availability`, async (t) => {
    const f = await fixture(t),
      { sink, packets } = await f.witness();
    const put = f.node.store.put.bind(f.node.store);
    let bundle: any;
    f.node.store.put = ((value: any, pin = false) => {
      if (value.manifest.kind === "reaction") {
        bundle = value;
        const admission = f.internals.privateDatabase.transaction(
          (tx: any) =>
            GroupLedger.run(tx, f.node.identity!, (l) =>
              l.accepted(value.manifest.id),
            ).value,
        );
        assert.ok(admission, "storage must follow admission");
        if (written) put(value, pin);
        throw new Error("fixture content store failure");
      }
      return put(value, pin);
    }) as any;
    assert.throws(f.publish, /content store failure/);
    f.node.store.put = put;
    assert.ok(bundle);
    assert.equal(f.node.store.has(bundle.manifest.id), written);
    await delay(180);
    assert.equal(
      packets.filter((p) => p.bundle?.manifest.kind === "reaction").length,
      0,
    );
    f.node.sync();
    sink.broadcast({ type: "request", ids: [bundle.manifest.id] });
    if (written) {
      await until(
        async () => packets,
        (ps) => ps.some((p) => p.bundle?.manifest.id === bundle.manifest.id),
      );
      assert.equal(
        canonical(
          packets.find((p) => p.bundle?.manifest.id === bundle.manifest.id)
            .bundle,
        ),
        canonical(bundle),
      );
    } else {
      await delay(250);
      assert.equal(
        packets.filter((p) => p.bundle?.manifest.kind === "reaction").length,
        0,
      );
    }
  });

for (const mode of ["close", "block", "lock", "evicted"] as const)
  test(`group event ${mode} retires retained packets and refuses later serving with a reachable control`, async (t) => {
    const f = await fixture(t),
      identity = f.node.identity!;
    const event = f.publish(),
      bytes = f.node.store.get(event.id, false);
    const queued = () =>
      [...(f.node.router as any).retained.values()].filter(
        (v: any) => v.packet.payload?.bundle?.manifest.id === event.id,
      );
    assert.equal(queued().length, 1, "positive retained-packet control");
    if (mode === "evicted") f.node.store.remove(event.id);
    if (mode === "close" || mode === "evicted") {
      const closed = await f.command(f.a, {
        action: "close",
        operationId: randomUUID(),
        groupId: f.groupId,
        expected: f.epoch,
      });
      f.node.groupCommand({
        action: "headers",
        groupId: f.groupId,
        headers: [closed.group.head],
      });
    } else if (mode === "block") f.node.localAction("block", f.alice.id, true);
    else f.node.lock();
    assert.equal(
      queued().length,
      0,
      "local group packet survived its authority fence",
    );
    if (mode !== "evicted")
      assert.equal(
        canonical(f.node.store.get(event.id, false)),
        canonical(bytes),
        "serving control requires retained bytes",
      );
    const marker = createBundle(
      identity,
      "post",
      { type: "post", text: "A real request control" },
      "public",
      60000,
    );
    f.node.store.put(marker);
    const { sink, packets } = await f.witness();
    sink.broadcast({ type: "request", ids: [event.id, marker.manifest.id] });
    f.node.sync();
    await until(
      async () => packets,
      (ps) => ps.some((p) => p.bundle?.manifest.id === marker.manifest.id),
    );
    await delay(250);
    assert.equal(
      packets.filter((p) => p.bundle?.manifest.id === event.id).length,
      0,
    );
    assert.equal(
      packets.some((p) => p.type === "inventory" && p.ids.includes(event.id)),
      false,
    );
  });

test("missing historical target proof pauses new event publication and seeding until exact proof returns", async (t) => {
  const f = await fixture(t);
  const originalHead = (
    f.node.groupCommand({ action: "state", groupId: f.groupId }) as any
  ).group.head;
  const joined = await f.command(f.a, {
    action: "commit",
    operationId: randomUUID(),
    groupId: f.groupId,
    expected: f.epoch,
    title: "New open epoch",
    members: [f.alice, f.bob],
    joins: [],
  });
  const snapshot = (
    await f.command(f.a, {
      action: "private-state",
      groupId: f.groupId,
      epochId: joined.group.head.id,
    })
  ).snapshot;
  f.node.groupCommand({
    action: "headers",
    groupId: f.groupId,
    headers: [joined.group.head],
  });
  f.node.groupCommand({
    action: "snapshot",
    groupId: f.groupId,
    epochId: joined.group.head.id,
    snapshot,
  });
  const content = { ...f.content, groupEpoch: joined.group.head.id };
  const event = f.node.publish(content, [f.alice.id]);
  assert.equal(
    f.internals.maySeed(f.node.store.get(event.id, false).manifest),
    true,
  );
  // Cursor now pins the successor; removing the old target proof is absence,
  // not corruption of the active checkpoint's required private state.
  f.internals.privateDatabase.transaction((tx: any) =>
    tx.delete(`snapshot:${f.groupId}:${originalHead.body.snapshotHash}`),
  );
  assert.throws(() => f.node.publish(content, [f.alice.id]));
  f.node.sync();
  assert.equal(
    f.internals.maySeed(f.node.store.get(event.id, false).manifest),
    false,
  );
  assert.ok(
    f.node.identity,
    "missing historical proof must not corrupt current identity",
  );
  f.node.groupCommand({
    action: "snapshot",
    groupId: f.groupId,
    epochId: f.epoch,
    snapshot: f.snapshot,
  });
  const restored = f.node.publish(content, [f.alice.id]);
  assert.ok(restored.id);
  assert.equal(
    f.internals.maySeed(f.node.store.get(event.id, false).manifest),
    true,
  );
});

test("corrupt stored event cannot authorise a valid retained packet; exact bytes restore serving", async (t) => {
  const f = await fixture(t);
  const event = f.publish(),
    original = f.node.store.get(event.id, false);
  const path = join(f.b.dir, "store", "objects", event.id + ".json");
  const corrupt = JSON.parse(readFileSync(path, "utf8"));
  const key = Object.keys(corrupt.chunks)[0],
    bytes = Buffer.from(corrupt.chunks[key], "base64");
  bytes[0] ^= 1;
  corrupt.chunks[key] = bytes.toString("base64");
  writeFileSync(path, JSON.stringify(corrupt));
  f.node.sync();
  assert.equal(f.internals.groupEventSeeds.has(event.id), false);
  assert.equal(
    [...(f.node.router as any).retained.values()].some(
      (v: any) => v.packet.payload?.bundle?.manifest.id === event.id,
    ),
    false,
  );
  const { sink, packets } = await f.witness();
  sink.broadcast({ type: "request", ids: [event.id] });
  await delay(200);
  assert.equal(
    packets.some((p) => p.bundle?.manifest.id === event.id),
    false,
  );
  f.node.store.remove(event.id);
  f.node.store.put(original);
  f.node.sync();
  assert.equal(f.internals.groupEventSeeds.has(event.id), true);
  // The rejected read still consumes the normal per-ID serving rate limit.
  // Wait for that real boundary rather than bypassing or resetting it.
  await until(
    async () =>
      Date.now() - (f.internals.requests.get("serve:" + event.id) ?? 0),
    (elapsed) => elapsed > 1000,
    2500,
  );
  sink.broadcast({ type: "request", ids: [event.id] });
  await until(
    async () => packets,
    (ps) => ps.some((p) => p.bundle?.manifest.id === event.id),
  );
  assert.equal(
    canonical(packets.find((p) => p.bundle?.manifest.id === event.id).bundle),
    canonical(original),
  );
});
