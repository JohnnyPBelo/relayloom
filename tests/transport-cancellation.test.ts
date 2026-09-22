import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Router } from "../packages/transport/src/index.js";
import { canonical, hash } from "../packages/core/src/index.js";
import { until } from "./helpers.js";

test("packet-ID cancellation preserves an independent equal payload and a foreign-origin packet", async (t) => {
  const origin = new Router(),
    middle = new Router(),
    receiver = new Router({ relay: false });
  t.after(async () => {
    await origin.stop();
    await middle.stop();
    await receiver.stop();
  });
  const received: string[] = [],
    atMiddle: string[] = [],
    payload = { kind: "same-source-bytes" };
  middle.lowPower = true;
  middle.on("payload", (_p, route) => atMiddle.push(route.packetId));
  receiver.on("payload", (_p, route) => received.push(route.packetId));
  origin.connectTcp("127.0.0.1", await middle.listen());
  await until(
    async () => origin.peers,
    (p) => p.some((x) => x.connected),
  );
  const foreign = origin.broadcast(payload, "bulk");
  await until(
    async () => atMiddle,
    (p) => p.includes(foreign),
  );
  middle.connectTcp("127.0.0.1", await receiver.listen());
  await until(
    async () => middle.peers,
    (p) => p.filter((x) => x.connected).length === 2,
  );
  const removed = middle.broadcast(payload, "bulk");
  await delay(3);
  const kept = middle.broadcast(payload, "bulk");
  assert.notEqual(removed, kept);
  assert.equal(middle.cancelLocalIds(new Set([removed, foreign])), 1);
  assert.equal(middle.cancelLocalIds(new Set([removed, foreign])), 0);
  middle.lowPower = false;
  await until(
    async () => received,
    (p) => p.includes(foreign) && p.includes(kept),
  );
  await delay(200);
  assert.equal(received.includes(removed), false);
});

test("absolute local authorization deadline is bound into the Node packet ID", async (t) => {
  const router = new Router({ id: "deadline-router" }),
    now = 1700000000000,
    payload = { source: "fixture" };
  t.after(() => router.stop());
  t.mock.method(Date, "now", () => now);
  const deadline = now + 1000;
  assert.equal(
    router.broadcast(payload, "bulk", 120000, false, deadline),
    hash(
      canonical({
        source: router.id,
        created: now,
        expires: deadline,
        maxHops: 12,
        priority: "bulk",
        payload,
      }),
    ),
  );
  assert.throws(
    () => router.broadcast(payload, "bulk", 120000, false, now),
    /expirado/,
  );
});

for (const cancel of [true, false])
  test(`local cancellation ${cancel ? "removes" : "negative control delivers"} an actual queued TCP transfer and its reconnect copy`, async (t) => {
    const sender = new Router(),
      receiver = new Router({ relay: false });
    const replacement = new Router({ relay: false });
    t.after(async () => {
      await sender.stop();
      await receiver.stop();
      await replacement.stop();
    });
    sender.lowPower = true;
    sender.connectTcp("127.0.0.1", await receiver.listen());
    await until(
      async () => sender.peers,
      (peers) => peers.some((p) => p.connected),
    );
    const received: any[] = [],
      replayed: any[] = [];
    receiver.on("payload", (p) => received.push(p));
    replacement.on("payload", (p) => replayed.push(p));
    sender.broadcast({ kind: "cancelled", body: "q".repeat(60_000) }, "bulk");
    assert.ok(
      sender.peers.some((p) => p.queued > 0),
      "positive proof that the link really retained a transfer",
    );
    if (cancel) {
      assert.equal(
        sender.cancelLocal((p: any) => p.kind === "cancelled"),
        1,
      );
      assert.equal(
        sender.cancelLocal((p: any) => p.kind === "cancelled"),
        0,
      );
      assert.ok(sender.peers.every((p) => p.queued === 0));
    }
    sender.broadcast({ kind: "witness" }, "normal");
    sender.lowPower = false;
    await until(
      async () => received,
      (list) => list.some((p) => p.kind === "witness"),
    );
    if (!cancel)
      await until(
        async () => received,
        (list) => list.some((p) => p.kind === "cancelled"),
      );
    await receiver.stop();
    sender.connectTcp("127.0.0.1", await replacement.listen());
    await until(
      async () => replayed,
      (list) => list.some((p) => p.kind === "witness"),
    );
    if (!cancel)
      await until(
        async () => replayed,
        (list) => list.some((p) => p.kind === "cancelled"),
      );
    await delay(300);
    assert.equal(
      received.some((p) => p.kind === "cancelled"),
      !cancel,
    );
    assert.equal(
      replayed.some((p) => p.kind === "cancelled"),
      !cancel,
    );
  });

test("local cancellation leaves another origin's retained relay packet intact", async (t) => {
  const a = new Router(),
    b = new Router(),
    c = new Router({ relay: false });
  t.after(async () => {
    await a.stop();
    await b.stop();
    await c.stop();
  });
  b.lowPower = true;
  const received: any[] = [],
    relayed: any[] = [];
  b.on("payload", (p) => received.push(p));
  c.on("payload", (p) => relayed.push(p));
  a.connectTcp("127.0.0.1", await b.listen());
  await until(
    async () => a.peers,
    (peers) => peers.some((p) => p.connected),
  );
  a.broadcast({ kind: "another origin" }, "bulk");
  await until(
    async () => received,
    (list) => list.length === 1,
  );
  b.connectTcp("127.0.0.1", await c.listen());
  await until(
    async () => b.peers,
    (peers) => peers.filter((p) => p.connected).length === 2,
  );
  assert.equal(
    b.cancelLocal(() => true),
    0,
  );
  b.lowPower = false;
  await until(
    async () => relayed,
    (list) => list.length === 1,
  );
  assert.equal(relayed[0].kind, "another origin");
});
