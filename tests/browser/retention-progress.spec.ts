import { test, expect } from "@playwright/test";
import { staticHarness } from "./static-harness";
let harness: Awaited<ReturnType<typeof staticHarness>>;
test.beforeAll(async () => {
  harness = await staticHarness();
});
test.afterAll(async () => {
  await harness.close();
});

test("idle normal history makes room for a new body; ordinary arrivals cannot cancel an already sending body", async ({
  page,
}) => {
  await page.goto(harness.url);
  const result = await page.evaluate(async () => {
    const r = (window as any).rl,
      received: string[] = [];
    let release!: () => void,
      entered = false;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sender = new r.BrowserRouter({
        relay: true,
        validate: async () => {},
        receive: async () => {},
        maySend: async (payload: any) => {
          if (payload.held) {
            entered = true;
            await hold;
          }
          return true;
        },
      }),
      receiver = new r.BrowserRouter({
        relay: false,
        validate: async () => {},
        receive: async (_payload: any, route: any) => {
          received.push(route.packetId);
        },
      });
    const wait = async (fn: () => boolean) => {
      const end = Date.now() + 5000;
      while (!fn() && Date.now() < end)
        await new Promise((resolve) => setTimeout(resolve, 10));
      if (!fn()) throw Error("transport progress witness missing");
    };
    try {
      for (let i = 0; i < r.ROUTER_LIMITS.retained; i++)
        await sender.broadcast({ inventory: i }, "normal");
      const x = sender.newPeer(),
        y = receiver.newPeer(),
        offer = await x.peer.offer(),
        answer = await y.peer.answer(offer);
      await x.peer.accept(answer);
      await wait(() => !!x.peer.link && !!y.peer.link);
      await x.peer.link.ready();
      await y.peer.link.ready();
      await wait(
        () => sender.peers.length === 1 && sender.peers[0].queued === 0,
      );
      const sos = await sender.broadcast(
        { urgent: "positive path control" },
        "sos",
      );
      await wait(() => received.includes(sos));
      const bulk = await sender.broadcast(
        { requested: "x".repeat(80000) },
        "bulk",
      );
      await wait(() => received.includes(bulk));
      const held = await sender.broadcast(
        { held: true, requested: "y".repeat(80000) },
        "bulk",
      );
      await wait(() => entered);
      for (let i = 0; i < r.ROUTER_LIMITS.retained + 16; i++)
        await sender.broadcast({ arriving: i }, "normal");
      release();
      try {
        await wait(() => received.includes(held));
      } catch (error) {
        throw Error(
          JSON.stringify({
            message: (error as Error).message,
            sender: sender.resources,
            senderCounters: sender.counters,
            peers: sender.peers,
            left: x.peer.diagnostics,
            leftCounters: x.peer.link?.counters,
            right: y.peer.diagnostics,
            rightCounters: y.peer.link?.counters,
            received: received.length,
          }),
        );
      }
      return {
        sos: received.includes(sos),
        bulk: received.includes(bulk),
        activePreserved: received.includes(held),
        resources: sender.resources,
      };
    } finally {
      release();
      sender.close();
      receiver.close();
    }
  });
  expect(result.sos).toBe(true);
  expect(result.bulk).toBe(true);
  expect(result.activePreserved).toBe(true);
  expect(result.resources.retained).toBeLessThanOrEqual(64);
  expect(result.resources.retainedBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
});

test("protected SOS pressure rejects a body without partially deleting idle normal cache", async ({
  page,
}) => {
  await page.goto(harness.url);
  const result = await page.evaluate(async () => {
    const r = (window as any).rl,
      router = new r.BrowserRouter({
        relay: true,
        validate: async () => {},
        receive: async () => {},
      });
    try {
      for (let i = 0; i < 3; i++)
        await router.broadcast(
          { urgent: i, body: "s".repeat(5 * 1024 * 1024) },
          "sos",
        );
      await router.broadcast({ cached: "n".repeat(512 * 1024) }, "normal");
      const before = router.resources;
      let refused = false;
      try {
        await router.broadcast({ body: "b".repeat(2 * 1024 * 1024) }, "bulk");
      } catch (error) {
        refused =
          (error as Error).message === "Fila reservada a tráfego prioritário";
      }
      return { refused, before, after: router.resources };
    } finally {
      router.close();
    }
  });
  expect(result.refused).toBe(true);
  expect(result.after.retained).toBe(result.before.retained);
  expect(result.after.retainedBytes).toBe(result.before.retainedBytes);
});
