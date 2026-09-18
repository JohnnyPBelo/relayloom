import { test, expect } from "@playwright/test";
import { staticHarness } from "./static-harness";
let host: Awaited<ReturnType<typeof staticHarness>>;
test.beforeAll(async () => {
  host = await staticHarness();
});
test.afterAll(async () => {
  await host.close();
  expect(host.requests.some((p) => p.startsWith("/api/"))).toBe(false);
});
test("browser resource creation keeps its signature private until durable preparation, reopens and recovers one exact result", async ({
  page,
}) => {
  await page.goto(host.url);
  const result = await page.evaluate(async () => {
    const r = (window as any).rl,
      name = "resource-catalog-" + crypto.randomUUID(),
      password = "resource browser fixture passphrase";
    let profile = await r.BrowserProfile.connect(name);
    await profile.setup("Autora", password);
    let catalog = new r.BrowserResourceCatalog(profile);
    const content = {
      type: "site-resource",
      domain: "relayloom/site-resource/1",
      kind: "file",
      name: "Guia.txt",
      mime: "text/plain",
      data: btoa("UNPUBLISHED_RESOURCE_CANARY_72619"),
    };
    const q = {
      sequence: 1,
      operationId: crypto.randomUUID(),
      content,
      recipients: "public",
      ttlMs: 3600000,
    };
    try {
      const pending = await catalog.prepare(q, () => "public"),
        bundle = await catalog.authorizedBundle(pending),
        before = await profile.ids();
      const db = await new Promise<IDBDatabase>((done, fail) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => done(req.result);
        req.onerror = () => fail(req.error);
      });
      let clearCanary = false;
      try {
        const tx = db.transaction(["profile", "bundles"], "readonly");
        for (const store of ["profile", "bundles"]) {
          const all = await new Promise<any[]>((done, fail) => {
            const req = tx.objectStore(store).getAll();
            req.onsuccess = () => done(req.result);
            req.onerror = () => fail(req.error);
          });
          const raw = JSON.stringify(all);
          clearCanary ||=
            raw.includes("UNPUBLISHED_RESOURCE_CANARY_72619") ||
            raw.includes(content.data);
        }
      } finally {
        db.close();
      }
      profile.close();
      profile = await r.BrowserProfile.connect(name);
      await profile.unlock(password);
      catalog = new r.BrowserResourceCatalog(profile);
      const recovered = await catalog.prepare(q, () => {
          throw Error("must not create another signature");
        }),
        again = await catalog.authorizedBundle(recovered);
      await profile.putBundle(again);
      const ready = await catalog.ready(
        recovered,
        await profile.getBundle(again.manifest.id),
      );
      const saved = await catalog.prepare(q, () => {
        throw Error("retained outcome only");
      });
      const state = await catalog.state(),
        keys = await profile.valueKeys("resource:");
      return {
        before,
        clearCanary,
        sameBundle: r.canonical(bundle) === r.canonical(again),
        sameId: pending.reference.bundleId === saved.reference.bundleId,
        phase: ready.phase,
        next: state.nextSequence,
        one: (await profile.ids()).length,
        stageRemoved: !keys.some((k: string) => k.endsWith(":stage")),
        content: await profile.view(again.manifest.id),
      };
    } finally {
      profile.close();
      indexedDB.deleteDatabase(name);
    }
  });
  expect(result).toEqual({
    before: [],
    clearCanary: false,
    sameBundle: true,
    sameId: true,
    phase: "ready",
    next: 2,
    one: 1,
    stageRemoved: true,
    content: {
      type: "site-resource",
      domain: "relayloom/site-resource/1",
      kind: "file",
      name: "Guia.txt",
      mime: "text/plain",
      data: Buffer.from("UNPUBLISHED_RESOURCE_CANARY_72619").toString("base64"),
    },
  });
});
test("locking during resource signing aborts the private transaction and invalidates its old catalogue", async ({
  page,
}) => {
  await page.goto(host.url);
  const result = await page.evaluate(async () => {
    const r = (window as any).rl,
      name = "resource-lock-" + crypto.randomUUID(),
      password = "resource locking test passphrase",
      profile = await r.BrowserProfile.connect(name);
    await profile.setup("Autora", password);
    const catalog = new r.BrowserResourceCatalog(profile);
    let entered!: () => void, release!: () => void;
    const atSign = new Promise<void>((done) => (entered = done)),
      held = new Promise<void>((done) => (release = done)),
      original = profile.signContent.bind(profile);
    profile.signContent = async (...args: any[]) => {
      const bundle = await original(...args);
      entered();
      await held;
      return bundle;
    };
    try {
      const q = {
        sequence: 1,
        operationId: crypto.randomUUID(),
        content: {
          type: "site-resource",
          domain: "relayloom/site-resource/1",
          kind: "file",
          name: "Guia.txt",
          mime: "text/plain",
          data: "Zg==",
        },
        recipients: "public",
        ttlMs: 3600000,
      };
      let rejected = false;
      const pending = catalog
        .prepare(q, () => "public")
        .catch(() => {
          rejected = true;
        });
      await atSign;
      profile.lock();
      release();
      await pending;
      await profile.unlock(password);
      let stale = false;
      try {
        await catalog.state();
      } catch {
        stale = true;
      }
      const state = await new r.BrowserResourceCatalog(profile).state();
      return {
        rejected,
        stale,
        next: state.nextSequence,
        operations: state.operations.length,
        ids: await profile.ids(),
        keys: await profile.valueKeys("resource:"),
      };
    } finally {
      release?.();
      profile.close();
      indexedDB.deleteDatabase(name);
    }
  });
  expect(result).toEqual({
    rejected: true,
    stale: true,
    next: 1,
    operations: 0,
    ids: [],
    keys: [],
  });
});
