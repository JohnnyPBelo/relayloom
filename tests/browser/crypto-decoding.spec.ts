import { test, expect } from "@playwright/test";
import { staticHarness } from "./rtc-control-host";
let host: Awaited<ReturnType<typeof staticHarness>>;
test.beforeAll(async () => { host = await staticHarness(); });
test.afterAll(async () => { await host.close(); });
test("canonical base64 preserves bounds and exact bytes for protected pages", async ({
  page,
}) => {
  await page.goto(host.url);
  const result = await page.evaluate(() => {
    const { b64, un64 } = (window as any).rl;
    const source = new Uint8Array(4 * 1024 * 1024);
    for (let n = 0; n < source.length; n++) source[n] = n % 251;
    const encoded = b64(source);
    const start = performance.now();
    const reference = Uint8Array.from(atob(encoded), (c: string) =>
      c.charCodeAt(0),
    );
    if (b64(reference) !== encoded) throw Error("Reference roundtrip failed");
    const referenceMs = performance.now() - start;
    const next = performance.now();
    const decoded = un64(encoded, encoded.length);
    const currentMs = performance.now() - next;
    const rejects = ["YQ", "YQ=", "YR==", "YQ===", "Y Q==", "\u00ff", "A"].map(
      (s) => {
        try {
          un64(s);
          return false;
        } catch {
          return true;
        }
      },
    );
    let bounded = false;
    try {
      un64(encoded, encoded.length - 1);
    } catch {
      bounded = true;
    }
    return {
      referenceMs,
      currentMs,
      bounded,
      rejects,
      exact: decoded.every((v: number, i: number) => v === source[i]),
      empty: un64("").length,
      single: [...un64("YQ==")],
    };
  });
  await test.info().attach("base64-cost", {
    body: JSON.stringify(result),
    contentType: "application/json",
  });
  expect(result.exact && result.bounded).toBe(true);
  expect(result.rejects.every(Boolean)).toBe(true);
  expect(result.empty).toBe(0);
  expect(result.single).toEqual([97]);
});
