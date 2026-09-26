import { test, expect } from "@playwright/test";
import { staticHarness } from "./rtc-control-host";
let host: Awaited<ReturnType<typeof staticHarness>>;
test.beforeAll(async () => {
  host = await staticHarness("tests/browser/rtc-control-harness.ts");
});
test.afterAll(async () => {
  await host.close();
});

test("RTC presence and reverse ACK progress while durable application acceptance is pending", async ({
  page,
}) => {
  await page.goto(host.url);
  const result = await page.evaluate(async () => {
    const r = (window as any).rl;
    const a = await r.createIdentity("Slow-store sender"),
      b = await r.createIdentity("Reverse sender");
    const first = await r.createBundle(
      a,
      "post",
      { type: "post", text: "Wait for durable acceptance" },
      "public",
    );
    const reverse = await r.createBundle(
      b,
      "post",
      { type: "post", text: "Independent reverse transfer" },
      "public",
    );
    let release!: () => void, announce!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
      }),
      started = new Promise<void>((resolve) => {
        announce = resolve;
      });
    let acceptedLeft = 0,
      acceptedRight = 0;
    const left = new r.RtcPeer(async () => {
      acceptedLeft++;
    });
    const right = new r.RtcPeer(async () => {
      announce();
      await held;
      acceptedRight++;
    });
    try {
      const incoming = new Promise<void>((resolve) =>
        right.connection.addEventListener("datachannel", () => resolve(), {
          once: true,
        }),
      );
      await left.accept(await right.answer(await left.offer()));
      await incoming;
      await left.link.ready();
      await right.link.ready();
      let firstDone = false,
        reverseDone = false;
      const sendFirst = left.link.send(first).then(
        () => {
          firstDone = true;
        },
        () => {},
      );
      await started;
      const sendReverse = right.link.send(reverse).then(
        () => {
          reverseDone = true;
        },
        () => {},
      );
      await new Promise((resolve) => setTimeout(resolve, 8500));
      const before = {
        firstDone,
        reverseDone,
        closed: left.link.closed || right.link.closed,
        acceptedLeft,
        acceptedRight,
        reasonLeft: left.link.closeReason ?? null,
        reasonRight: right.link.closeReason ?? null,
      };
      release();
      await Promise.all([sendFirst, sendReverse]);
      return { before, firstDone, reverseDone, acceptedLeft, acceptedRight };
    } finally {
      release();
      left.close();
      right.close();
    }
  });
  expect(result.before).toMatchObject({
    firstDone: false,
    reverseDone: true,
    closed: false,
    acceptedLeft: 1,
    acceptedRight: 0,
  });
  expect(result.firstDone && result.reverseDone).toBe(true);
  expect(result.acceptedLeft).toBe(1);
  expect(result.acceptedRight).toBe(1);
});

for (const attack of ["malformed-ack", "unsolicited-ack-flood", "ping-flood"]) {
  test(`RTC rejects ${attack} while durable acceptance is pending`, async ({
    page,
  }) => {
    await page.goto(host.url);
    const result = await page.evaluate(async (attack) => {
      const r = (window as any).rl;
      const a = await r.createIdentity("Control sender");
      const bundle = await r.createBundle(
        a,
        "post",
        { type: "post", text: "Must not acknowledge" },
        "public",
      );
      let release!: () => void, announce!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        announce = resolve;
      });
      const left = new r.RtcPeer(async () => {});
      const right = new r.RtcPeer(async () => {
        announce();
        await held;
      });
      let acknowledged = false;
      try {
        const incoming = new Promise<void>((resolve) =>
          right.connection.addEventListener("datachannel", () => resolve(), {
            once: true,
          }),
        );
        await left.accept(await right.answer(await left.offer()));
        await incoming;
        await left.link.ready();
        await right.link.ready();
        const sent = left.link.send(bundle).then(
          () => {
            acknowledged = true;
          },
          () => {},
        );
        await started;
        const frames =
          attack === "malformed-ack"
            ? [{ t: "ack", id: "a".repeat(64), extra: true }]
            : Array.from({ length: 65 }, () =>
                attack === "ping-flood"
                  ? { t: "ping", nonce: crypto.randomUUID() }
                  : { t: "ack", id: "b".repeat(64) },
              );
        for (const frame of frames)
          left.link.channel.send(JSON.stringify(frame));
        const deadline = Date.now() + 3000;
        while (!right.link.closed && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 10));
        const before = {
          closed: right.link.closed,
          reason: right.link.closeReason,
          accepted: right.link.counters.accepted,
          acknowledged,
        };
        release();
        await sent;
        return { before, acknowledged };
      } finally {
        release();
        left.close();
        right.close();
      }
    }, attack);
    expect(result.before).toEqual({
      closed: true,
      reason: "invalid-frame",
      accepted: 0,
      acknowledged: false,
    });
    expect(result.acknowledged).toBe(false);
  });
}

test("RTC control backpressure has a finite pending limit and releases it on close (stream model)", async ({
  page,
}) => {
  await page.goto(host.url);
  const result = await page.evaluate(async () => {
    const r = (window as any).rl;
    class Stream extends EventTarget {
      ordered = true;
      maxPacketLifeTime = null;
      maxRetransmits = null;
      readyState = "open";
      bufferedAmount = 256 * 1024;
      bufferedAmountLowThreshold = 0;
      send() {
        throw Error("Congested stream cannot write");
      }
      close() {
        if (this.readyState === "closed") return;
        this.readyState = "closed";
        this.dispatchEvent(new Event("close"));
      }
    }
    const stream = new Stream();
    const link = new r.RtcBundleChannel(stream, async () => {});
    for (let i = 0; i < r.RTC_LIMITS.controlPending; i++)
      stream.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ t: "ping", nonce: crypto.randomUUID() }),
        }),
      );
    const atLimit = link.resources.controlPending;
    stream.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ t: "ping", nonce: crypto.randomUUID() }),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = {
      atLimit,
      closed: link.closed,
      reason: link.closeReason,
      pending: link.resources.controlPending,
    };
    link.close();
    return result;
  });
  expect(result).toEqual({
    atLimit: 64,
    closed: true,
    reason: "invalid-frame",
    pending: 0,
  });
});
