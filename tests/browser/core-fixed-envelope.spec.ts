import { test, expect } from "@playwright/test";
import { staticHarness } from "./static-harness";
import {
  createIdentity,
  createBundleAt,
  decryptStoredBundle,
} from "../../packages/core/src/index";
let host: Awaited<ReturnType<typeof staticHarness>>;
test.beforeAll(async () => {
  host = await staticHarness();
});
test.afterAll(async () => {
  await host.close();
});
test("actual browser preserves saved envelope times, verifies Node bytes and refuses expired live admission", async ({
  page,
}) => {
  const author = createIdentity("Node fixed sender"),
    reader = createIdentity("Fixed reader"),
    created = Date.now() - 10000,
    payload = { text: "FIXED_BROWSER_ENVELOPE", count: 0 };
  const bundle = createBundleAt(
    author,
    "site-contribution",
    payload,
    [reader.public],
    1000,
    created,
  );
  await page.goto(host.url);
  const result = await page.evaluate(
    async ({ bundle, reader, created, payload }) => {
      const r = (window as any).rl;
      const opened = await r.decryptStoredBundle(bundle, reader),
        owner = await r.createIdentity("Browser fixed author");
      const local = await r.createBundleAt(
        owner,
        "site-contribution",
        payload,
        [reader.public],
        1000,
        created,
      );
      let liveRejected = false,
        invalid = 0;
      try {
        await r.verifyBundle(local);
      } catch {
        liveRejected = true;
      }
      for (const [ttl, at] of [
        [999, 0],
        [1000, -1],
        [1000, 0.5],
        [1000, Number.MAX_SAFE_INTEGER - 999],
        [1000, NaN],
      ]) {
        try {
          await r.createBundleAt(owner, "post", {}, "public", ttl, at);
        } catch {
          invalid++;
        }
      }
      return { opened, local, liveRejected, invalid };
    },
    { bundle, reader, created, payload },
  );
  expect(result.opened).toEqual(payload);
  expect(result.local.manifest.created).toBe(created);
  expect(result.local.manifest.expires).toBe(created + 1000);
  expect(result.liveRejected).toBe(true);
  expect(result.invalid).toBe(5);
  expect(decryptStoredBundle(result.local, reader)).toEqual(payload);
});
