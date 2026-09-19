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

test("browser signed-page resource API separates inspection from obtaining bytes and preserves third-party authorship", async ({
  page,
}) => {
  await page.goto(host.url);
  const result = await page.evaluate(async () => {
    const r = (window as any).rl,
      opened: any[] = [];
    const make = async (name: string) => {
      const p = await r.BrowserProfile.connect(
          "ref-api-" + crypto.randomUUID(),
        ),
        requests: any[] = [],
        published: any[] = [];
      const app = new r.BrowserApplication(p, {
        publish: (b: any) => published.push(b),
        command: async (op: string, body: any) => requests.push({ op, body }),
        state: () => ({ peers: [], counters: {}, error: "" }),
        context: () => {},
      });
      await app.call("setup", {
        name,
        password: "reference API browser fixture passphrase",
      });
      const f = { p, app, owner: p.identity, requests, published };
      opened.push(f);
      return f;
    };
    const denied = async (fn: () => Promise<any>) => {
      try {
        await fn();
        return false;
      } catch {
        return true;
      }
    };
    const doc = (reference: any) => ({
      type: "site",
      blocks: [],
      theme: "sand",
      site: {
        version: 3,
        title: "Dados entre pessoas",
        description: "À escolha",
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
                id: "data",
                type: "resource",
                title: "Dados",
                body: "",
                reference,
              },
            ],
          },
          { id: "notes", slug: "notas", title: "Notas", blocks: [] },
        ],
      },
    });
    const publication = async (
      f: any,
      content: any,
      recipients: any = "public",
    ) => {
      const s = await f.app.call("site-command", {
        action: "state",
        address: "relayloom:site:" + f.owner.id + "/profile",
      });
      return {
        action: "publish",
        name: "profile",
        sequence: s.nextSequence,
        operationId: crypto.randomUUID(),
        expectedBase: s.base,
        payload: content,
        recipients,
        ttlMs: 3600000,
      };
    };
    const resource = async (f: any, content: any, recipients: any) => {
      const s = await f.app.call("resource-command", { action: "state" });
      return (
        await f.app.call("resource-command", {
          action: "create",
          sequence: s.nextSequence,
          operationId: crypto.randomUUID(),
          content,
          recipients,
          ttlMs: 3600000,
        })
      ).operation;
    };
    try {
      const a = await make("Autora dos dados"),
        b = await make("Autora da página");
      await a.app.call("contact", { contact: b.owner });
      const content = {
        type: "site-resource",
        domain: "relayloom/site-resource/1",
        kind: "table",
        name: "Locais",
        table: {
          domain: "relayloom/site-table/1",
          columns: [
            { id: "name", label: "Nome", type: "text" },
            { id: "places", label: "Lugares", type: "number" },
          ],
          rows: [{ id: "one", values: { name: "Ponto 🌿", places: 12 } }],
        },
      };
      const made = await resource(a, content, "public");
      await b.app.ingest(await a.p.getBundle(made.reference.bundleId));
      const q = await publication(b, doc(made.reference)),
        published = await b.app.call("site-command", q);
      const snapshotId = published.operation.bundleId,
        query = {
          action: "inspect",
          snapshotId,
          pageId: "home",
          blockId: "data",
        };
      const inspected = await b.app.call("resource-command", query),
        obtained = await b.app.call("resource-command", {
          ...query,
          action: "obtain",
        });
      const invalidInputs = [];
      for (const input of [
        { ...query, reference: made.reference },
        { ...query, pageId: "notes" },
        { ...query, blockId: "unknown" },
        { ...query, snapshotId: [snapshotId] },
        { ...query, snapshotId: made.reference.bundleId },
      ])
        invalidInputs.push(
          await denied(() => b.app.call("resource-command", input)),
        );
      const get = b.p.getBundle.bind(b.p);
      b.p.getBundle = async (id: string) => {
        if (id === made.reference.bundleId)
          throw Error("resource no longer available");
        return get(id);
      };
      const replay = await b.app.call("site-command", q);
      b.p.getBundle = get;
      const stored = await b.p.getBundle(made.reference.bundleId);
      const c = await make("Leitor posterior");
      await c.app.ingest(await b.p.getBundle(snapshotId));
      const missing = await c.app.call("resource-command", query),
        requestsBefore = c.requests.length;
      const requested = await c.app.call("resource-command", {
        ...query,
        action: "obtain",
      });
      await c.app.ingest(stored);
      const fromCopy = await c.app.call("resource-command", {
        ...query,
        action: "obtain",
      });
      // Both private access failure and a forged public-page reference are
      // checked after authenticating the actual resource envelope.
      const privatePayload = {
        type: "site-resource",
        domain: "relayloom/site-resource/1",
        kind: "file",
        name: "Privado.txt",
        mime: "text/plain",
        data: btoa("PRIVATE_REFERENCE_CANARY_710964"),
      };
      const privateOp = await resource(
        a,
        privatePayload,
        [a.owner.id, b.owner.id].sort(),
      );
      await b.app.ingest(await a.p.getBundle(privateOp.reference.bundleId));
      const illegal = await publication(b, doc(privateOp.reference));
      const publicRejected = await denied(() =>
        b.app.call("site-command", illegal),
      );
      const genericRejected = await denied(() =>
        b.app.call("publish", {
          content: illegal.payload,
          recipients: "public",
        }),
      );
      const privateAllowed = await b.app.call("site-command", {
        ...illegal,
        recipients: [],
      });
      const forged = await b.p.signSiteBundle(
        "invalid-audience",
        1,
        [],
        doc(privateOp.reference),
        "public",
        3600000,
      );
      await b.app.ingest(forged);
      const incompatible = await b.app.call("resource-command", {
        action: "obtain",
        snapshotId: forged.manifest.id,
        pageId: "home",
        blockId: "data",
      });
      await c.app.ingest(await a.p.getBundle(privateOp.reference.bundleId));
      await c.app.ingest(forged);
      const unreadable = await c.app.call("resource-command", {
        action: "obtain",
        snapshotId: forged.manifest.id,
        pageId: "home",
        blockId: "data",
      });
      const stillCreator = (await b.p.getBundle(made.reference.bundleId))
        .manifest.author.id;
      // A policy change during asynchronous verification must fence the reply.
      const originalStored = b.p.getStoredBundle.bind(b.p);
      b.p.getStoredBundle = async (id: string) => {
        const bundle = await originalStored(id);
        await b.p.setValue("mesh-settings", {
          relay: false,
          lowPower: false,
          blocked: [a.owner.id],
        });
        return bundle;
      };
      const blocked = await b.app.call("resource-command", {
        ...query,
        action: "obtain",
      });
      b.p.getStoredBundle = originalStored;
      await b.p.setValue("mesh-settings", {
        relay: false,
        lowPower: false,
        blocked: [],
      });
      const deletion = await a.app.call("publish", {
        content: { type: "delete", target: made.reference.bundleId },
        recipients: "public",
      });
      await b.app.ingest(await a.p.getBundle(deletion.id));
      const withdrawn = await b.app.call("resource-command", {
        ...query,
        action: "obtain",
      });
      const afterRemoval = await publication(b, doc(made.reference));
      const withdrawnPublicationRejected = await denied(() =>
        b.app.call("site-command", afterRemoval),
      );

      return {
        available: inspected.status,
        inspectionHasBytes: Object.hasOwn(inspected, "content"),
        exactTable: r.canonical(obtained.content) === r.canonical(content),
        invalidInputs,
        sameReplay: replay.operation.bundleId === snapshotId,
        authorPreserved:
          stillCreator === a.owner.id &&
          inspected.reference.authorId === a.owner.id &&
          (await b.p.getBundle(snapshotId)).manifest.author.id === b.owner.id,
        noCreationByReader:
          (await b.app.call("resource-command", { action: "state" }))
            .nextSequence === 1,
        missing: missing.status,
        requestsBefore,
        requested: requested.status,
        requestedOnlyReference:
          r.canonical(c.requests) ===
          r.canonical([
            { op: "request", body: { id: made.reference.bundleId } },
          ]),
        exactCopy: r.canonical(fromCopy.content) === r.canonical(content),
        publicRejected,
        genericRejected,
        privateAllowed: privateAllowed.operation.phase,
        incompatible: incompatible.status,
        unreadable: unreadable.status,
        noPrivateLeak: !JSON.stringify([incompatible, unreadable]).includes(
          privatePayload.data,
        ),
        blocked: blocked.status,
        blockedHasBytes: Object.hasOwn(blocked, "content"),
        withdrawnPublicationRejected,
        withdrawn: withdrawn.status,
        withdrawnHasBytes: Object.hasOwn(withdrawn, "content"),
      };
    } finally {
      for (const f of opened) {
        f.app.close();
        indexedDB.deleteDatabase(f.p.name);
      }
    }
  });
  expect(result).toEqual({
    available: "available",
    inspectionHasBytes: false,
    exactTable: true,
    invalidInputs: [true, true, true, true, true],
    sameReplay: true,
    authorPreserved: true,
    noCreationByReader: true,
    missing: "missing",
    requestsBefore: 0,
    requested: "requested",
    requestedOnlyReference: true,
    exactCopy: true,
    publicRejected: true,
    genericRejected: true,
    privateAllowed: "ready",
    incompatible: "invalid",
    unreadable: "unreadable",
    noPrivateLeak: true,
    blocked: "blocked",
    blockedHasBytes: false,
    withdrawnPublicationRejected: true,
    withdrawn: "withdrawn",
    withdrawnHasBytes: false,
  });
});

test("browser resource inspection rejects corrupted IndexedDB bytes and never returns an expired file", async ({
  page,
}) => {
  await page.goto(host.url);
  const result = await page.evaluate(async () => {
    const r = (window as any).rl,
      name = "resource-read-integrity-" + crypto.randomUUID(),
      p = await r.BrowserProfile.connect(name),
      app = new r.BrowserApplication(p, {
        publish: () => {},
        command: async () => {},
        state: () => ({ peers: [], counters: {}, error: "" }),
        context: () => {},
      });
    let db: IDBDatabase | undefined;
    try {
      await app.call("setup", {
        name: "Autora",
        password: "resource integrity fixture passphrase",
      });
      const content = {
        type: "site-resource",
        domain: "relayloom/site-resource/1",
        kind: "file",
        name: "Expira.txt",
        mime: "text/plain",
        data: "Zg==",
      };
      const made = (
        await app.call("resource-command", {
          action: "create",
          sequence: 1,
          operationId: crypto.randomUUID(),
          recipients: "public",
          ttlMs: 8000,
          content,
        })
      ).operation;
      const address = "relayloom:site:" + p.identity.id + "/profile",
        s = await app.call("site-command", { action: "state", address });
      const site = {
        version: 3,
        title: "Prazo",
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
                id: "file",
                type: "resource",
                title: "Recurso",
                body: "",
                reference: made.reference,
              },
            ],
          },
        ],
      };
      const published = await app.call("site-command", {
        action: "publish",
        name: "profile",
        sequence: 1,
        operationId: crypto.randomUUID(),
        expectedBase: s.base,
        payload: { type: "site", theme: "sand", blocks: [], site },
        recipients: "public",
        ttlMs: 3600000,
      });
      const query = {
        action: "obtain",
        snapshotId: published.operation.bundleId,
        pageId: "home",
        blockId: "file",
      };
      const before = await app.call("resource-command", query);
      db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const saved = await new Promise<any>((resolve, reject) => {
        const req = db!
          .transaction("bundles", "readonly")
          .objectStore("bundles")
          .get(made.reference.bundleId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const put = (row: any) =>
        new Promise<void>((resolve, reject) => {
          const tx = db!.transaction("bundles", "readwrite");
          tx.objectStore("bundles").put(row, made.reference.bundleId);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      await put({
        ...saved,
        data: (saved.data[0] === "A" ? "B" : "A") + saved.data.slice(1),
      });
      const corrupted = await app.call("resource-command", query);
      await put(saved);
      const recovered = await app.call("resource-command", query);
      await new Promise((done) =>
        setTimeout(done, Math.max(0, made.expires - Date.now()) + 25),
      );
      const expired = await app.call("resource-command", query);
      let ordinaryRejected = false;
      try {
        await p.getBundle(made.reference.bundleId);
      } catch {
        ordinaryRejected = true;
      }
      return {
        before: before.status,
        corrupted: corrupted.status,
        corruptedHasBytes: Object.hasOwn(corrupted, "content"),
        recovered: recovered.status,
        expired: expired.status,
        expiredHasBytes: Object.hasOwn(expired, "content"),
        ordinaryRejected,
      };
    } finally {
      db?.close();
      app.close();
      indexedDB.deleteDatabase(name);
    }
  });
  expect(result).toEqual({
    before: "available",
    corrupted: "invalid",
    corruptedHasBytes: false,
    recovered: "available",
    expired: "expired",
    expiredHasBytes: false,
    ordinaryRejected: true,
  });
});
