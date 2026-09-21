import { test, expect } from "@playwright/test";
import { staticHarness } from "./static-harness";
let host: Awaited<ReturnType<typeof staticHarness>>;
test.beforeAll(async () => {
  host = await staticHarness();
});
test.afterAll(async () => {
  await host.close();
});

test("read-only resource checks can progress together while every reply still checks blocking and session ownership", async ({
  page,
}) => {
  await page.goto(host.url);
  await page.evaluate(async () => {
    const r = (window as any).rl,
      w = window as any;
    const p = await r.BrowserProfile.connect(
      "parallel-resource-" + crypto.randomUUID(),
    );
    const app = new r.BrowserApplication(p, {
      publish: () => {},
      command: async () => {},
      state: () => ({ peers: [], counters: {}, error: "" }),
      context: () => {},
    });
    await app.call("setup", {
      name: "Autora das leituras",
      password: "parallel checks test passphrase",
    });
    const state = await app.call("resource-command", { action: "state" });
    const resource = await app.call("resource-command", {
      action: "create",
      sequence: state.nextSequence,
      operationId: crypto.randomUUID(),
      content: {
        domain: "relayloom/site-resource/1",
        type: "site-resource",
        kind: "file",
        name: "Local.txt",
        mime: "text/plain",
        data: btoa("LOCAL_VERIFIED_FILE"),
      },
      recipients: "public",
      ttlMs: 60000,
    });
    const id = resource.operation.reference.bundleId,
      full = await app.call("view", { id });
    const ref = r.resources.describeSiteResource(full.content, {
      id,
      authorId: p.identity.id,
      kind: "site-resource",
    });
    const address = "relayloom:site:" + p.identity.id + "/profile",
      s = await app.call("site-command", { action: "state", address });
    const published = await app.call("site-command", {
      action: "publish",
      name: "profile",
      sequence: s.nextSequence,
      operationId: crypto.randomUUID(),
      expectedBase: s.base,
      recipients: "public",
      ttlMs: 60000,
      payload: {
        type: "site",
        blocks: [],
        theme: "sand",
        attachments: [],
        site: {
          version: 3,
          title: "Leituras",
          description: "",
          home: "home",
          design: {
            font: "sans",
            width: "standard",
            radius: "soft",
            accent: "#207a70",
          },
          pages: [
            {
              id: "home",
              slug: "inicio",
              title: "Início",
              blocks: [
                {
                  id: "resource",
                  type: "resource",
                  title: "Local",
                  body: "",
                  reference: ref,
                },
              ],
            },
          ],
        },
      },
    });
    const snapshotId = published.operation.bundleId;
    await app.state(); // Warm the existing metadata projection, not the read verifier.
    const original = p.getBundle.bind(p);
    let release: () => void = () => {},
      gate = Promise.resolve(),
      held = false;
    w.inspectParallel = { entered: 0 };
    p.getBundle = async (id: string) => {
      if (held && id === snapshotId) {
        w.inspectParallel.entered++;
        await gate;
      }
      return original(id);
    };
    w.startReads = (mutateFirst = false) => {
      w.inspectParallel.entered = 0;
      held = true;
      gate = new Promise<void>((done) => (release = done));
      w.readResults = Promise.all(
        Array.from({ length: 4 }, (_, index) => {
          const input = {
            action: "inspect",
            snapshotId,
            pageId: "home",
            blockId: "resource",
          };
          const result = app.call("resource-command", input);
          if (mutateFirst && index === 0) input.action = "obtain";
          return result.then(
            (value: any) => ({
              status: value.status,
              hasPayload: Object.hasOwn(value, "content"),
            }),
            (error: Error) => ({ error: error.message }),
          );
        }),
      );
    };
    w.releaseReads = () => {
      held = false;
      release();
    };
    w.blockOwner = async () => {
      const settings = await p.getValue("mesh-settings");
      await p.setValue("mesh-settings", {
        ...(settings ?? {}),
        blocked: [p.identity.id],
      });
    };
    w.closeProfile = () => p.lock();
    w.dispose = async () => {
      held = false;
      release();
      app.close();
      await p.close();
    };
    w.startReads(true);
  });
  try {
    try {
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).inspectParallel.entered),
        )
        .toBe(4);
    } finally {
      await page.evaluate(() => (window as any).releaseReads());
    }
    const first = await page.evaluate(() => (window as any).readResults);
    expect(first).toEqual(
      Array(4).fill({ status: "available", hasPayload: false }),
    );
    await page.evaluate(() => (window as any).startReads());
    await expect
      .poll(() => page.evaluate(() => (window as any).inspectParallel.entered))
      .toBe(4);
    await page.evaluate(async () => {
      await (window as any).blockOwner();
      (window as any).releaseReads();
    });
    const blocked = await page.evaluate(() => (window as any).readResults);
    expect(blocked.every((r: any) => r.error && !r.status)).toBe(true);
    // Session guard also prevents a result from surviving lock during storage read.
    await page.evaluate(() => (window as any).startReads());
    await expect
      .poll(() => page.evaluate(() => (window as any).inspectParallel.entered))
      .toBe(4);
    await page.evaluate(async () => {
      await (window as any).closeProfile();
      (window as any).releaseReads();
    });
    const locked = await page.evaluate(() => (window as any).readResults);
    expect(locked.every((r: any) => r.error && !r.status)).toBe(true);
  } finally {
    await page.evaluate(() => (window as any).dispose());
  }
});
