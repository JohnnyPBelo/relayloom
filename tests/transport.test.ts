import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../packages/transport/src/index.js";
import { setTimeout as delay } from "node:timers/promises";

test("real TCP transfer, two-hop forwarding and relay-off negative control", async () => {
  const a = new Router(),
    b = new Router({ relay: false }),
    c = new Router();
  try {
    const bp = await b.listen(),
      cp = await c.listen();
    a.connectTcp("127.0.0.1", bp);
    b.connectTcp("127.0.0.1", cp);
    await delay(100);
    const got: unknown[] = [];
    c.on("payload", (p, route) => got.push({ p, route }));
    a.broadcast({ message: "blocked control" });
    await delay(300);
    assert.equal(got.length, 0);
    b.relay = true;
    a.broadcast({ message: "x".repeat(18000) });
    await delay(500);
    assert.equal(got.length, 1);
    assert.equal((got[0] as any).p.message.length, 18000);
    assert.equal((got[0] as any).route.hops.length, 2);
    assert.ok(b.counters.forwarded > 0);
    assert.equal(a.peers.length, 1);
    assert.equal(a.peers[0].address, `127.0.0.1:${bp}`);
  } finally {
    await Promise.all([a.stop(), b.stop(), c.stop()]);
  }
});
test("validation rejection prevents display and relay; positive valid control", async () => {
  const a = new Router(),
    b = new Router({
      validate: (p: any) => {
        if (p.valid !== true) throw new Error("invalid");
      },
    });
  try {
    a.connectTcp("127.0.0.1", await b.listen());
    await delay(80);
    const got: unknown[] = [];
    b.on("payload", (p) => got.push(p));
    a.broadcast({ valid: false });
    await delay(200);
    assert.equal(got.length, 0);
    assert.ok(b.counters.rejected > 0);
    a.broadcast({ valid: true });
    await delay(250);
    assert.equal(got.length, 1);
  } finally {
    await a.stop();
    await b.stop();
  }
});
