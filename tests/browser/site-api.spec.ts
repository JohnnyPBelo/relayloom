import { test, expect, type Page } from "@playwright/test";
import { staticHarness } from "./static-harness";
const payload = {
  type: "site",
  blocks: [],
  theme: "sand",
  site: {
    version: 1,
    title: "Página com história",
    description: "Publicada entre pares",
    home: "home",
    design: {
      font: "sans",
      width: "standard",
      radius: "soft",
      accent: "#207a70",
    },
    pages: [{ id: "home", slug: "inicio", title: "Início", blocks: [] }],
  },
};
let host: Awaited<ReturnType<typeof staticHarness>>;
test.beforeAll(async () => {
  host = await staticHarness();
});
test.afterAll(async () => {
  await host.close();
  expect(host.requests.some((p) => p.startsWith("/api/"))).toBe(false);
});
async function fixture(page: Page) {
  await page.goto(host.url);
  await page.evaluate((payload) => {
    const w = window as any,
      r = w.rl;
    w.sitePayload = payload;
    w.openSiteApp = async (name: string, existing?: string) => {
      const dbName = existing ?? "site-api-" + crypto.randomUUID(),
        password = "browser site API fixture passphrase";
      const p = await r.BrowserProfile.connect(dbName),
        published: any[] = [],
        requests: any[] = [];
      const network = {
        publish: (b: any) => published.push(structuredClone(b)),
        command: async (op: string, body: unknown) => {
          requests.push({ op, body });
        },
        state: () => ({ peers: [], counters: {}, error: "" }),
        context: () => {},
      };
      const app = new r.BrowserApplication(p, network);
      await app.call(existing ? "unlock" : "setup", { name, password });
      const owner = p.identity,
        address = "relayloom:site:" + owner.id + "/profile";
      const cmd = (body: any) => app.call("site-command", body);
      const request = async (
        title: string,
        recipients: string[] | "public" = "public",
      ) => {
        const state = await cmd({ action: "state", address });
        return {
          action: "publish",
          name: "profile",
          sequence: state.nextSequence,
          operationId: crypto.randomUUID(),
          expectedBase: state.base,
          payload: { ...payload, site: { ...payload.site, title } },
          recipients,
          ttlMs: 3600000,
        };
      };
      return {
        p,
        app,
        cmd,
        request,
        owner,
        address,
        dbName,
        published,
        requests,
      };
    };
    w.denied = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        return false;
      } catch {
        return true;
      }
    };
  }, payload);
}

test("browser site API retains stable address, exact replay and history across reopen; a missing head never falls back", async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    const w = window as any;
    let f = await w.openSiteApp("Author");
    try {
      const q = await f.request("Primeira edição"),
        first = await f.cmd(q);
      const id1 = first.operation.bundleId;
      const repeat = await f.cmd(q);
      const stale = await w.denied(() =>
        f.cmd({ ...q, operationId: crypto.randomUUID(), sequence: 2 }),
      );
      const second = await f.cmd(await f.request("Segunda edição")),
        id2 = second.operation.bundleId;
      f.app.close();
      f = await w.openSiteApp("Author", f.dbName);
      const replay = await f.cmd(q),
        latest = await f.cmd({ action: "resolve", address: f.address });
      const history = await f.cmd({ action: "history", address: f.address });
      const oldRevision = history.revisions.find((h: any) =>
        h.bundles.includes(id1),
      ).revision.id;
      const older = await f.cmd({
        action: "resolve",
        address: f.address,
        revisionId: oldRevision,
      });
      const db = await new Promise<IDBDatabase>((done, fail) => {
        const q = indexedDB.open(f.dbName);
        q.onsuccess = () => done(q.result);
        q.onerror = () => fail(q.error);
      });
      try {
        await new Promise<void>((done, fail) => {
          const tx = db.transaction("bundles", "readwrite");
          tx.objectStore("bundles").delete(id2);
          tx.oncomplete = () => done();
          tx.onabort = () => fail(tx.error);
        });
      } finally {
        db.close();
      }
      const missing = await f.cmd({ action: "resolve", address: f.address });
      const pinnedOld = await f.cmd({
        action: "resolve",
        address: f.address,
        revisionId: oldRevision,
      });
      const requests = f.requests;
      await f.app.call("lock");
      const locked = await f.app.state(),
        lockDenied = await w.denied(() =>
          f.cmd({ action: "history", address: f.address }),
        );
      return {
        first: first.operation.phase,
        same:
          id1 === repeat.operation.bundleId &&
          id1 === replay.operation.bundleId,
        stale,
        number: latest.state.number,
        latest: latest.object.content.site.title,
        older: older.object.content.site.title,
        history: history.revisions.length,
        missing: missing.status,
        missingNumber: missing.state.number,
        pinnedOld: pinnedOld.status,
        requested: requests.some((q: any) => q.body.id === id2),
        lockDenied,
        lockedPublishing: locked.sitePublishing,
        lockedObjects: locked.objects,
      };
    } finally {
      f.app.close();
      indexedDB.deleteDatabase(f.dbName);
    }
  });
  expect(result).toEqual({
    first: "ready",
    same: true,
    stale: true,
    number: 2,
    latest: "Segunda edição",
    older: "Primeira edição",
    history: 2,
    missing: "pending",
    missingNumber: 2,
    pinnedOld: "available",
    requested: true,
    lockDenied: true,
    lockedPublishing: null,
    lockedObjects: [],
  });
});

test("readable sites reject forged author, signature and payload; opaque private seeding confers no editing authority", async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    const w = window as any,
      r = w.rl,
      a = await w.openSiteApp("Author"),
      b = await w.openSiteApp("Reader"),
      c = await w.openSiteApp("Opaque seeder");
    let mesh: any;
    try {
      await a.app.call("contact", { contact: b.owner });
      const own = await a.cmd(await a.request("Só os leitores", [b.owner.id])),
        bundle = await a.p.getBundle(own.operation.bundleId);
      await b.app.ingest(bundle);
      await c.app.ingest(bundle);
      const visible = await b.cmd({ action: "resolve", address: a.address }),
        opaque = await c.cmd({ action: "resolve", address: a.address });
      const content = visible.object.content,
        attacker = await r.createIdentity("Forgery fixture");
      const originals = [
        await r.createBundle(attacker, "site", content, "public"),
        await a.p.signContent(
          "site",
          {
            ...content,
            site: { ...content.site, title: "Alterado sem certificado" },
          },
          [b.owner],
        ),
        await a.p.signContent(
          "site",
          {
            ...content,
            siteRevision: { ...content.siteRevision, signature: "AAAA" },
          },
          "public",
        ),
      ];
      const refusals = [];
      for (const invalid of originals)
        refusals.push(await w.denied(() => b.app.ingest(invalid)));
      const invalidPublic = await a.p.signContent(
        "site",
        { ...content, site: { ...content.site, title: "Corrompido público" } },
        "public",
      );
      mesh = await r.BrowserMesh.start(c.p);
      const forwarded = await w.denied(() =>
        mesh.router.broadcast({ type: "bundle", bundle: invalidPublic }),
      );
      const validPublic = await a.p.signSiteBundle(
        "public-page",
        1,
        [],
        w.sitePayload,
        "public",
        3600000,
      );
      await mesh.router.broadcast({ type: "bundle", bundle: validPublic });
      const bypass = await w.denied(() =>
        a.app.call("publish", { content, recipients: "public" }),
      );
      const unauthorized = await w.denied(() =>
        b.app.call("publish", { content, recipients: "public" }),
      );
      await b.p.setValue("mesh-settings", {
        relay: true,
        lowPower: false,
        blocked: [a.owner.id],
      });
      const blocked = await w.denied(() =>
        b.cmd({ action: "resolve", address: a.address }),
      );
      return {
        visible: visible.status,
        owner: visible.object.author.id === a.owner.id,
        opaque: opaque.status,
        opaqueObjects: (await c.app.state()).objects.length,
        opaqueStored: (await c.p.ids()).includes(bundle.manifest.id),
        refusals,
        forwarded,
        bypass,
        unauthorized,
        blocked,
        invalidStored: (await b.p.ids()).some((id: string) =>
          originals.some((x) => x.manifest.id === id),
        ),
      };
    } finally {
      await mesh?.close();
      for (const f of [a, b, c]) {
        f.app.close();
        indexedDB.deleteDatabase(f.dbName);
      }
    }
  });
  expect(result).toEqual({
    visible: "available",
    owner: true,
    opaque: "pending",
    opaqueObjects: 0,
    opaqueStored: true,
    refusals: [true, true, true],
    forwarded: true,
    bypass: true,
    unauthorized: true,
    blocked: true,
    invalidStored: false,
  });
});

test("storage exhaustion keeps exact authorized publication private and the offline application resumes after reopening", async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    const w = window as any;
    let f = await w.openSiteApp("Quota owner");
    try {
      await f.app.call("settings", { quota: 1024 });
      const request = await f.request("Publicação recuperável"),
        pending = await f.cmd(request);
      const staged = {
        phase: pending.operation.phase,
        published: f.published.length,
        ids: await f.p.ids(),
        error: !!pending.error,
      };
      f.app.close();
      f = await w.openSiteApp("Quota owner", f.dbName);
      await f.app.call("settings", { quota: 1024 * 1024 });
      await f.app.flush();
      const replay = await f.cmd(request),
        resolved = await f.cmd({ action: "resolve", address: f.address });
      return {
        staged,
        same: replay.operation.bundleId === pending.operation.bundleId,
        final: replay.operation.phase,
        title: resolved.object.content.site.title,
        published: f.published.length,
        pending: (await f.app.state()).sitePublishing.pending,
      };
    } finally {
      f.app.close();
      indexedDB.deleteDatabase(f.dbName);
    }
  });
  expect(result).toEqual({
    staged: { phase: "committed", published: 0, ids: [], error: true },
    same: true,
    final: "ready",
    title: "Publicação recuperável",
    published: 1,
    pending: 0,
  });
});

test("concurrent recovered identities require explicit heads and retain both histories after conflict resolution", async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    const w = window as any,
      r = w.rl,
      a = await w.openSiteApp("Recovered owner"),
      b = await w.openSiteApp("Initial fixture");
    // Replace only this isolated fixture profile with the exported identity, through the actual recovery API.
    b.app.close();
    indexedDB.deleteDatabase(b.dbName);
    const name = "recovered-site-" + crypto.randomUUID(),
      p = await r.BrowserProfile.connect(name),
      app = new r.BrowserApplication(p, {
        publish: () => {},
        command: async () => {},
        state: () => ({ peers: [], counters: {}, error: "" }),
        context: () => {},
      });
    try {
      await app.call("setup", {
        recovery: await a.p.exportIdentity(),
        password: "browser site API fixture passphrase",
      });
      const qa = await a.request("Ramo A"),
        qb = {
          ...qa,
          operationId: crypto.randomUUID(),
          payload: {
            ...qa.payload,
            site: { ...qa.payload.site, title: "Ramo B" },
          },
        };
      const pa = await a.cmd(qa),
        pb = await app.call("site-command", qb);
      await a.app.ingest(await p.getBundle(pb.operation.bundleId));
      const conflict = await a.cmd({ action: "resolve", address: a.address }),
        next = await a.request("Escolha explícita");
      const missing = await w.denied(() => a.cmd(next)),
        incomplete = await w.denied(() =>
          a.cmd({ ...next, confirmedHeads: [conflict.state.heads[0].id] }),
        );
      const fixed = await a.cmd({
        ...next,
        confirmedHeads: conflict.state.heads.map((h: any) => h.id).sort(),
      });
      const state = await a.cmd({ action: "state", address: a.address }),
        history = await a.cmd({ action: "history", address: a.address });
      return {
        different: pa.operation.bundleId !== pb.operation.bundleId,
        conflict: conflict.status,
        heads: conflict.state.heads.length,
        missing,
        incomplete,
        fixed: fixed.operation.phase,
        number: state.number,
        headsAfter: state.heads.length,
        history: history.revisions.length,
      };
    } finally {
      app.close();
      a.app.close();
      indexedDB.deleteDatabase(name);
      indexedDB.deleteDatabase(a.dbName);
    }
  });
  expect(result).toEqual({
    different: true,
    conflict: "conflict",
    heads: 2,
    missing: true,
    incomplete: true,
    fixed: "ready",
    number: 2,
    headsAfter: 1,
    history: 3,
  });
});
