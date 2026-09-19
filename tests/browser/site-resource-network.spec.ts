import { test, expect, type Page } from "@playwright/test";
import { staticHarness } from "./static-harness";
import { launch, password, until, type Client } from "../helpers";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
let host: Awaited<ReturnType<typeof staticHarness>>;
test.beforeAll(async () => {
  host = await staticHarness();
});
test.afterAll(async () => {
  await host.close();
  expect(host.requests.some((p) => p.startsWith("/api/"))).toBe(false);
});
async function start(page: Page, name: string, reopen = false) {
  await page.goto(host.url);
  return page.evaluate(
    async ({ name, password, reopen }) => {
      const w = window as any,
        r = w.rl,
        p = await r.BrowserProfile.connect("optional-resources");
      let mesh: any;
      const jobs = new Set<Promise<unknown>>(),
        errors: string[] = [];
      const app = new r.BrowserApplication(p, {
        publish: (bundle: any, priority: any) => {
          const task = mesh
            .announce(bundle, priority)
            .catch((e: Error) => errors.push(e.message))
            .finally(() => jobs.delete(task));
          jobs.add(task);
        },
        command: async (op: string, body: any) => {
          if (op === "request") return mesh.request(body.id);
          if (op === "block") return mesh.setBlocked(body.id, body.value);
          throw Error("Unexpected network command");
        },
        state: () => ({
          peers: mesh?.router.peers ?? [],
          counters: mesh?.router.counters ?? {},
          error: mesh?.lastError ?? "",
        }),
        context: () => {},
      });
      const owner = await app.call(reopen ? "unlock" : "setup", {
        name,
        password,
      });
      mesh = await r.BrowserMesh.start({
        name: p.name,
        get locked() {
          return p.locked;
        },
        get identity() {
          return p.identity;
        },
        getValue: (key: string) => p.getValue(key),
        setValue: (key: string, value: unknown) => p.setValue(key, value),
        ids: () => p.ids(),
        getBundle: (id: string) => p.getBundle(id),
        putBundle: (bundle: any) => app.ingest(bundle),
      });
      await mesh.setRelay(true);
      Object.assign(w, {
        app,
        profile: p,
        mesh,
        errors,
        shutdown: async () => {
          await mesh.close();
          await Promise.allSettled([...jobs]);
          app.close();
        },
      });
      return owner;
    },
    { name, password, reopen },
  );
}
async function pair(a: Page, b: Page) {
  const offer = await a.evaluate(async () => {
    const w = window as any;
    w.rtc = w.mesh.router.newPeer();
    return w.rtc.peer.offer();
  });
  const answer = await b.evaluate(async (offer) => {
    const w = window as any;
    w.rtc = w.mesh.router.newPeer();
    return w.rtc.peer.answer(offer);
  }, offer);
  await a.evaluate((answer) => (window as any).rtc.peer.accept(answer), answer);
  await expect
    .poll(() =>
      b.evaluate(() => (window as any).rtc.peer.link?.channel.readyState),
    )
    .toBe("open");
}
const ids = (page: Page) => page.evaluate(() => (window as any).profile.ids());
test("browser resource admission rejects readable malformed bodies, preserves opaque seeding and keeps summaries distinct from full data", async ({
  browser,
}) => {
  const contexts = [],
    pages: Page[] = [];
  try {
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext();
      contexts.push(context);
      pages.push(await context.newPage());
    }
    const [a, b, c] = pages;
    const author = await start(a, "Autora"),
      reader = await start(b, "Leitor");
    await start(c, "Relay opaco");
    const bundles = await a.evaluate(async (reader) => {
      const w = window as any;
      const value = {
        type: "site-resource",
        domain: "relayloom/site-resource/1",
        kind: "file",
        name: "Privado.txt",
        mime: "text/plain",
        data: btoa("Private optional bytes"),
      };
      const readers = [w.profile.identity, reader];
      return {
        invalidPublic: await w.profile.signContent(
          "site-resource",
          { ...value, script: "run()" },
          "public",
          3600000,
        ),
        invalidPrivate: await w.profile.signContent(
          "site-resource",
          { ...value, script: "run()" },
          readers,
          3600000,
        ),
        valid: await w.profile.signContent(
          "site-resource",
          value,
          readers,
          3600000,
        ),
        value,
      };
    }, reader);
    const refused = await b.evaluate(async (bundles) => {
      const w = window as any,
        denied = [];
      for (const bundle of [bundles.invalidPublic, bundles.invalidPrivate]) {
        try {
          await w.app.ingest(bundle);
          denied.push(false);
        } catch {
          denied.push(true);
        }
      }
      return { denied, ids: await w.profile.ids() };
    }, bundles);
    expect(refused).toEqual({ denied: [true, true], ids: [] });
    await c.evaluate(
      (bundle) => (window as any).app.ingest(bundle),
      bundles.invalidPrivate,
    );
    expect(await ids(c)).toContain(bundles.invalidPrivate.manifest.id);
    const opaque = await c.evaluate(async (id) => {
      const w = window as any;
      let denied = false;
      try {
        await w.app.call("view", { id });
      } catch {
        denied = true;
      }
      return { denied, objects: (await w.app.call("state")).objects };
    }, bundles.invalidPrivate.manifest.id);
    expect(opaque).toEqual({ denied: true, objects: [] });
    await b.evaluate(
      (bundle) => (window as any).app.ingest(bundle),
      bundles.valid,
    );
    const view = await b.evaluate(async (id) => {
      const w = window as any;
      return {
        full: await w.app.call("view", { id }),
        summary: (await w.app.call("state")).objects.find(
          (o: any) => o.id === id,
        ),
      };
    }, bundles.valid.manifest.id);
    expect(view.full.content).toEqual(bundles.value);
    expect(view.summary.content).not.toHaveProperty("data");
    expect(view.summary.content).not.toHaveProperty("table");
    expect(view.summary.content.domain).toBe(
      "relayloom/site-resource-summary/1",
    );
    await b.evaluate(
      (id) =>
        (window as any).app.call("action", {
          action: "block",
          target: id,
          value: true,
        }),
      author.id,
    );
    expect(
      await b.evaluate(async (id) => {
        try {
          await (window as any).app.call("view", { id });
          return false;
        } catch {
          return true;
        }
      }, bundles.valid.manifest.id),
    ).toBe(true);
  } finally {
    for (const page of pages)
      if (!page.isClosed())
        await page.evaluate(() => (window as any).shutdown?.()).catch(() => {});
    for (const context of contexts) await context.close();
  }
});
for (const backend of ["node", "native"] as const)
  test(`optional data crosses RTC and WS through ${backend} only on request and a restarted browser seeds it after author shutdown`, async ({
    browser,
  }, info) => {
    const contexts = [],
      pages: Page[] = [];
    let native: Client | undefined;
    try {
      native = await launch(undefined, 0, 0, backend);
      await native.call("setup", { name: "Leitor nativo", password });
      await native.call("settings", { relay: true });
      for (let i = 0; i < 3; i++) {
        const context = await browser.newContext();
        contexts.push(context);
        pages.push(await context.newPage());
      }
      const [a, b, c] = pages;
      const author = await start(a, "Autora"),
        seeder = await start(b, "Seeder");
      const resource = await a.evaluate(async () => {
        const w = window as any;
        const payload = {
          type: "site-resource",
          domain: "relayloom/site-resource/1",
          kind: "file",
          name: "Arquivo.txt",
          mime: "text/plain",
          data: btoa("optional payload\n".repeat(4096)),
        };
        const state = await w.app.call("resource-command", { action: "state" });
        const result = await w.app.call("resource-command", {
          action: "create",
          sequence: state.nextSequence,
          operationId: crypto.randomUUID(),
          content: payload,
          recipients: "public",
          ttlMs: 3600000,
        });
        if (result.operation.phase !== "ready")
          throw Error(result.error ?? "resource not ready");
        const reference = result.operation.reference,
          bundle = await w.profile.getBundle(reference.bundleId);
        let announceRejected = false,
          publishRejected = false;
        try {
          await w.mesh.announce(bundle);
        } catch {
          announceRejected = true;
        }
        try {
          await w.app.call("publish", {
            content: payload,
            recipients: "public",
          });
        } catch {
          publishRejected = true;
        }
        const invalid = await w.profile.signContent(
          "site-resource",
          { ...payload, script: "run()" },
          "public",
          3600000,
        );
        let invalidRejected = false;
        try {
          await w.mesh.router.broadcast({ type: "bundle", bundle: invalid });
        } catch {
          invalidRejected = true;
        }
        const address = "relayloom:site:" + w.profile.identity.id + "/profile";
        const catalog = await w.app.call("site-command", {
          action: "state",
          address,
        });
        const publication = await w.app.call("site-command", {
          action: "publish",
          name: "profile",
          sequence: catalog.nextSequence,
          operationId: crypto.randomUUID(),
          expectedBase: catalog.base,
          recipients: "public",
          ttlMs: 3600000,
          payload: {
            type: "site",
            blocks: [],
            theme: "sand",
            site: {
              version: 3,
              title: "Recursos distribuídos",
              description: "Obtidos por escolha",
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
                      id: "optional",
                      type: "resource",
                      title: "Arquivo",
                      body: "",
                      reference,
                    },
                  ],
                },
              ],
            },
          },
        });
        if (publication.operation.phase !== "ready")
          throw Error(publication.error ?? "site not ready");
        const query = {
          snapshotId: publication.operation.bundleId,
          pageId: "home",
          blockId: "optional",
        };
        const witness = await w.app.call("publish", {
          content: { type: "post", text: "Ordinary automatic discovery" },
          recipients: "public",
        });
        return {
          reference,
          query,
          hash: await w.rl.hash(w.rl.canonical(bundle)),
          witness: witness.id,
          payload,
          announceRejected,
          publishRejected,
          invalidRejected,
        };
      });
      expect(
        resource.announceRejected &&
          resource.publishRejected &&
          resource.invalidRejected,
      ).toBe(true);
      await pair(a, b);
      const invitation = await native.call("web-peer", { origin: host.url });
      await b.evaluate(async (invitation) => {
        const w = window as any;
        w.ws = w.mesh.router.connectWebSocket(invitation);
        await w.ws.peer.link.ready();
      }, invitation);
      await until(
        () => native!.call("state"),
        (s) =>
          s.objects.some((o: any) => o.id === resource.witness) &&
          s.objects.some((o: any) => o.id === resource.query.snapshotId),
      );
      await new Promise((r) => setTimeout(r, 4600));
      expect(await ids(b)).not.toContain(resource.reference.bundleId);
      expect(
        (await native.call("state")).objects.some(
          (o: any) => o.id === resource.reference.bundleId,
        ),
      ).toBe(false);
      expect(
        (
          await native.call("resource-command", {
            action: "inspect",
            ...resource.query,
          })
        ).status,
      ).toBe("missing");
      await native.call("resource-command", {
        action: "obtain",
        ...resource.query,
      });
      const arrived = await until(
        () => native!.call("state"),
        (s) => s.objects.some((o: any) => o.id === resource.reference.bundleId),
      );
      const summary = arrived.objects.find(
        (o: any) => o.id === resource.reference.bundleId,
      );
      expect(summary.content).not.toHaveProperty("data");
      expect(summary.content).not.toHaveProperty("table");
      expect(
        (await native.call("view", { id: resource.reference.bundleId }))
          .content,
      ).toEqual(resource.payload);
      expect(summary.route.hops).toHaveLength(2);
      expect(summary.route.medium).toBe("websocket");
      await expect.poll(() => ids(b)).toContain(resource.reference.bundleId);
      await a.evaluate(() => (window as any).shutdown());
      await contexts[0].close();
      await native.stop();
      expect(
        native.process.exitCode !== null || native.process.signalCode !== null,
      ).toBe(true);
      await b.evaluate(() => (window as any).shutdown());
      expect((await start(b, "Seeder", true)).id).toBe(seeder.id);
      await start(c, "Novo leitor");
      await pair(b, c);
      await expect.poll(() => ids(c)).toContain(resource.witness);
      await expect.poll(() => ids(c)).toContain(resource.query.snapshotId);
      await new Promise((r) => setTimeout(r, 4600));
      expect(await ids(c)).not.toContain(resource.reference.bundleId);
      await b.evaluate(() => (window as any).mesh.setRelay(false));
      await c.evaluate(
        (query) =>
          (window as any).app.call("resource-command", {
            action: "obtain",
            ...query,
          }),
        resource.query,
      );
      await new Promise((r) => setTimeout(r, 2300));
      expect(await ids(c)).not.toContain(resource.reference.bundleId);
      await b.evaluate(() => (window as any).mesh.setRelay(true));
      await c.evaluate(
        (query) =>
          (window as any).app.call("resource-command", {
            action: "obtain",
            ...query,
          }),
        resource.query,
      );
      await expect.poll(() => ids(c)).toContain(resource.reference.bundleId);
      const seeded = await c.evaluate(
        async ({ reference, query }) => {
          const w = window as any,
            bundle = await w.profile.getBundle(reference.bundleId),
            full = await w.app.call("resource-command", {
              action: "obtain",
              ...query,
            });
          if (full.status !== "available")
            throw Error("resource reference did not resolve");
          w.rl.resources.matchSiteResource(reference, full.content, {
            id: bundle.manifest.id,
            authorId: bundle.manifest.author.id,
            kind: bundle.manifest.kind,
          });
          return {
            hash: await w.rl.hash(w.rl.canonical(bundle)),
            author: bundle.manifest.author.id,
            content: full.content,
          };
        },
        { reference: resource.reference, query: resource.query },
      );
      expect(seeded.hash).toBe(resource.hash);
      expect(seeded.author).toBe(author.id);
      expect(seeded.content).toEqual(resource.payload);
      expect(await b.evaluate(() => (window as any).errors)).toEqual([]);
      const out = `.cache/site-resource-browser/${info.project.name || "chromium"}`;
      mkdirSync(out, { recursive: true });
      writeFileSync(
        out + `/${backend}.json`,
        JSON.stringify(
          {
            status: "PASS",
            media: ["webrtc", "websocket"],
            nativePID: native.process.pid,
            ordinaryInventoryControl: true,
            optionalBeforeRequestAbsent: true,
            requestPositive: true,
            originAndNativeClosed: true,
            restartedBrowserSoleSeeder: true,
            pausedSeederNegative: true,
            exactCiphertext: true,
            authorPreserved: true,
            scope:
              "Actual browser creation and signed-snapshot reference APIs, RTC/WS and native process. Editor UI and physical radios not tested.",
          },
          null,
          2,
        ),
      );
    } finally {
      for (const page of pages)
        if (!page.isClosed())
          await page
            .evaluate(() => (window as any).shutdown?.())
            .catch(() => {});
      for (const context of contexts) await context.close();
      if (native) {
        await native.stop();
        rmSync(native.dir, { recursive: true, force: true });
      }
    }
  });
