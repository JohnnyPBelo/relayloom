import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Router } from "../packages/transport/src/index.js";
import { until } from "./helpers.js";

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
