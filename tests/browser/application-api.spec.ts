import { test, expect } from "@playwright/test";
import { staticHarness } from "./static-harness";
let host: Awaited<ReturnType<typeof staticHarness>>;
test.beforeAll(async () => {
  host = await staticHarness();
});
test.afterAll(async () => {
  await host.close();
});

test("application API preserves send identity, rejects corrupt retained acceptance, and validates event author/read scope", async ({
  page,
}) => {
  await page.goto(host.url);
  const result = await page.evaluate(async () => {
    const r = (window as any).rl,
      p = await r.BrowserProfile.connect("domain-controls"),
      network = {
        publish: () => {},
        command: async () => {},
        state: () => ({ peers: [], counters: {}, error: "" }),
        context: () => {},
      },
      app = new r.BrowserApplication(p, network);
    await app.call("setup", {
      name: "Alice",
      password: "frase passe longa de teste",
    });
    const alice = (await app.state()).identity,
      bob = await r.createIdentity("Bruno"),
      eve = await r.createIdentity("Eva");
    await app.call("contact", { contact: bob.public });
    const op = crypto.randomUUID(),
      input = {
        operationId: op,
        content: { type: "message", text: "Mensagem única" },
        recipients: [bob.public.id],
        ttlMs: 60000,
      };
    const first = await app.call("send", input),
      repeat = await app.call("send", input);
    let reused = false;
    try {
      await app.call("send", {
        ...input,
        content: { type: "message", text: "Outro texto" },
      });
    } catch {
      reused = true;
    }
    const countBefore = (await app.state()).outbox.length;
    const wrong = await r.createBundle(
      eve,
      "receipt",
      { type: "receipt", target: first.outbox.id },
      [alice],
    );
    await app.ingest(wrong);
    const noForgery = (await app.state()).outbox[0].receivedCount === 0;
    const valid = await r.createBundle(
      bob,
      "delivery",
      { type: "delivery", target: first.outbox.id },
      [alice],
    );
    await app.ingest(valid);
    const received = (await app.state()).outbox[0].receivedCount;
    const post = await app.call("publish", {
      content: { type: "post", text: "Texto original" },
      recipients: "public",
    });
    const edit = await r.createBundle(
      bob,
      "edit",
      { type: "edit", target: post.id, text: "Alteração não autorizada" },
      "public",
    );
    await app.ingest(edit);
    const accepted = (await app.state()).objects;
    const wrongAuthor =
      accepted.find((o: any) => o.id === post.id).editedText === undefined &&
      !accepted.some((o: any) => o.id === edit.manifest.id);
    await app.call("publish", {
      content: { type: "delete", target: post.id },
      recipients: "public",
    });
    const deleted = (await app.state()).objects.find(
      (o: any) => o.id === post.id,
    ).deleted;
    const db = await new Promise<IDBDatabase>((resolve) => {
      const q = indexedDB.open("domain-controls");
      q.onsuccess = () => resolve(q.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("bundles", "readwrite"),
        store = tx.objectStore("bundles"),
        q = store.get(first.outbox.id);
      q.onsuccess = () => {
        const value = q.result;
        value.tag = "AAAAAAAAAAAAAAAAAAAAAA==";
        store.put(value, first.outbox.id);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    const corrupt = await app.call("send", input);
    app.close();
    return {
      first: first.outbox.id,
      repeat: repeat.outbox.id,
      reused,
      countBefore,
      noForgery,
      received,
      wrongAuthor,
      deleted,
      corruptAccepted: corrupt.accepted,
    };
  });
  expect(result.first).toBe(result.repeat);
  expect(
    result.reused && result.noForgery && result.wrongAuthor && result.deleted,
  ).toBe(true);
  expect(result.countBefore).toBe(1);
  expect(result.received).toBe(1);
  expect(result.corruptAccepted).toBe(false);
});
