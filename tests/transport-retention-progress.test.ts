import test from "node:test";
import assert from "node:assert/strict";
import { Router, TRANSPORT_LIMITS } from "../packages/transport/src/index.js";
import { until } from "./helpers.js";

test(
  "acknowledged normal traffic cannot fill retention forever and prevent a later requested bulk transfer",
  { timeout: 8000 },
  async (t) => {
    const sender = new Router(),
      receiver = new Router({ relay: false }),
      received: string[] = [];
    t.after(async () => {
      await sender.stop();
      await receiver.stop();
    });
    receiver.on("payload", (_payload, route) => received.push(route.packetId));
    for (let i = 0; i < TRANSPORT_LIMITS.maxTransfers; i++)
      sender.broadcast({ inventory: i }, "normal");
    sender.connectTcp("127.0.0.1", await receiver.listen());
    await until(
      async () => sender.peers,
      (peers) =>
        peers.length === 1 && peers[0].connected && peers[0].queued === 0,
    );
    const sos = sender.broadcast({ urgent: "positive path control" }, "sos");
    await until(
      async () => received,
      (ids) => ids.includes(sos),
    );
    const bulk = sender.broadcast({ requested: "x".repeat(80_000) }, "bulk");
    const retained = [...(sender as any).retained.values()] as {
      packet: { id: string; priority: string };
    }[];
    t.diagnostic(
      JSON.stringify({
        priorities: retained.reduce(
          (counts, value) => ({
            ...counts,
            [value.packet.priority]: (counts[value.packet.priority] ?? 0) + 1,
          }),
          {} as Record<string, number>,
        ),
        bulkAdmitted: retained.some((value) => value.packet.id === bulk),
        drops: sender.counters.dropped,
      }),
    );
    await until(
      async () => received,
      (ids) => ids.includes(bulk),
      1500,
    );
    assert.ok(
      retained.some((value) => value.packet.id === sos),
      "bulk must preserve the cached SOS",
    );
  },
);

test("bulk cannot evict SOS, and a byte admission that cannot fit is atomic", (t) => {
  const router = new Router();
  t.after(() => router.stop());
  for (let i = 0; i < 3; i++)
    router.broadcast({ urgent: i, body: "s".repeat(5 * 1024 * 1024) }, "sos");
  const normal = router.broadcast({ cached: "n".repeat(512 * 1024) }, "normal");
  const before = new Map((router as any).retained as Map<string, unknown>),
    bytes = (router as any).retainedBytes;
  router.broadcast({ bulk: "b".repeat(2 * 1024 * 1024) }, "bulk");
  assert.equal((router as any).retainedBytes, bytes);
  assert.deepEqual((router as any).retained, before);
  assert.ok((router as any).retained.has(normal));
});

test("an existing retained packet preserves its snapshot, consent and exact byte accounting on readmission", (t) => {
  const router = new Router();
  t.after(() => router.stop());
  const id = router.broadcast({ cached: "immutable" }, "sos", 120000, true),
    original = (router as any).retained.get(id),
    bytes = (router as any).retainedBytes;
  // Simulates reaching retention again after bounded seen history has retired
  // this ID; does not change any retained entry or forge a network identity.
  const replay = (router as any).retain(
    structuredClone(original.packet),
    false,
  );
  assert.equal(replay, original);
  assert.equal(replay.relayOnly, true);
  assert.equal((router as any).retainedBytes, bytes);
  assert.equal((router as any).retained.size, 1);
});
