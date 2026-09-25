import { test, expect } from "@playwright/test";
import { staticHarness } from "./static-harness";
let harness: Awaited<ReturnType<typeof staticHarness>>;
test.beforeAll(async () => {
  harness = await staticHarness();
});
test.afterAll(async () => {
  await harness.close();
});

for (const expected of [true, false])
  test(
    expected
      ? "matched storage ACKs make progress within one control window"
      : "unsolicited ACK flood still closes the channel within the bounded control window",
    async ({ page }) => {
      await page.goto(harness.url);
      const result = await page.evaluate(async (expected) => {
        const r = (window as any).rl,
          received: number[] = [],
          realNow = Date.now;
        const sender = new r.RtcTransportPeer(async () => {}, r.packetCodec),
          receiver = new r.RtcTransportPeer(async (packet: any) => {
            received.push(packet.payload.index);
          }, r.packetCodec);
        const wait = async (fn: () => boolean) => {
          const end = realNow() + 5000;
          while (!fn() && realNow() < end)
            await new Promise((resolve) => setTimeout(resolve, 10));
          if (!fn()) throw Error("control witness missing");
        };
        try {
          const offer = await sender.offer(),
            answer = await receiver.answer(offer);
          await sender.accept(answer);
          await wait(() => !!sender.link && !!receiver.link);
          await sender.link.ready();
          await receiver.link.ready();
          // A deterministic logical control window, not a throughput measurement.
          // RTC and storage acknowledgements are real; only Date.now is frozen.
          const fixed = realNow();
          Date.now = () => fixed;
          let failure = "";
          if (expected) {
            try {
              for (let index = 0; index < 96; index++)
                await sender.link.send(
                  await r.createPacket(
                    "ack-source",
                    { index },
                    "normal",
                    120000,
                  ),
                );
            } catch (error) {
              failure = (error as Error).message;
            }
          } else {
            for (let i = 0; i < 65; i++)
              receiver.link.channel.send(
                JSON.stringify({ t: "ack", id: "f".repeat(64) }),
              );
            await wait(() => sender.link.closed);
          }
          return {
            received,
            failure,
            closed: sender.link.closed,
            rejected: sender.link.counters.rejected,
            outgoing: sender.link.resources.outgoing,
          };
        } finally {
          Date.now = realNow;
          sender.close();
          receiver.close();
        }
      }, expected);
      if (expected) {
        expect(result.failure).toBe("");
        expect(result.received).toEqual(
          Array.from({ length: 96 }, (_, index) => index),
        );
        expect(result.closed).toBe(false);
        expect(result.outgoing).toBe(0);
      } else {
        expect(result.closed).toBe(true);
        expect(result.rejected).toBeGreaterThan(0);
        expect(result.received).toEqual([]);
      }
    },
  );
