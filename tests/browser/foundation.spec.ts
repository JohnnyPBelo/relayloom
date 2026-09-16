import { test, expect } from "@playwright/test";
import { staticHarness } from "./static-harness";
import {
  importVault,
  verifyBundle,
  validateIdentity,
  decryptBundle,
  ContentStore,
} from "../../packages/core/src/index";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { runNativeInterop } from "../../scripts/native-interop";
import { mkdirSync, writeFileSync } from "node:fs";
let harness: Awaited<ReturnType<typeof staticHarness>>, url: string;
test.beforeAll(async () => {
  harness = await staticHarness();
  url = harness.url;
});
test.afterAll(async () => {
  await harness.close();
  expect(harness.requests.some((path) => path.startsWith("/api/"))).toBe(false);
});

test("Browser owns compatible identities/vaults/bundles: real Node and Go positive and negative controls", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const { dir, fixture, result: go } = runNativeInterop();
  await page.goto(url);
  const output = await page.evaluate(
    async ({ fixture, go }) => {
      const c = (window as any).rl;
      const rejects = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
          return false;
        } catch {
          return true;
        }
      };
      const who = await c.createIdentity("Web Açores 🚀\ud800"),
        stranger = await c.createIdentity("Sem leitura");
      const payload = {
        text: "Mensagem da web 🌊 <>&\u2028",
        lone: "\ud800",
        attachment: "x".repeat(100_000),
      };
      const privateBundle = await c.createBundle(who, "message", payload, [
        fixture.nodeIdentity.public,
        go.goIdentity.public,
      ]);
      const publicBundle = await c.createBundle(who, "post", payload, "public");
      const browserVault = await c.exportVault(who, fixture.password);
      const nativeIdentity = await c.importVault(
          fixture.nodeVault,
          fixture.password,
        ),
        goIdentity = await c.importVault(go.goVault, fixture.password);
      const negatives: boolean[] = [];
      negatives.push(
        await rejects(() => c.decryptBundle(fixture.nodePrivate, stranger)),
      );
      negatives.push(
        await rejects(() => c.decryptBundle(go.goPrivate, stranger)),
      );
      negatives.push(
        await rejects(() =>
          c.importVault(fixture.nodeVault, "incorrect password"),
        ),
      );
      negatives.push(
        await rejects(() => c.importVault(go.goVault, "incorrect password")),
      );
      const bad = structuredClone(go.goPrivate),
        chunk = bad.manifest.chunks[0].hash;
      bad.chunks[chunk] =
        (bad.chunks[chunk][0] === "A" ? "B" : "A") + bad.chunks[chunk].slice(1);
      negatives.push(await rejects(() => c.verifyBundle(bad)));
      const forgery = structuredClone(privateBundle);
      forgery.manifest.author = fixture.nodeIdentity.public;
      negatives.push(await rejects(() => c.verifyBundle(forgery)));
      const extra = structuredClone(privateBundle);
      extra.manifest.keys[0].injected = true;
      negatives.push(await rejects(() => c.verifyBundle(extra)));
      const mismatched = structuredClone(who);
      mismatched.signSecret = stranger.signSecret;
      negatives.push(
        await rejects(() => c.exportVault(mismatched, fixture.password)),
      );
      const mutate = structuredClone(privateBundle),
        inFlight = c.verifiedBundle(mutate);
      mutate.manifest.author.name = "ALTERADO";
      const owned = await inFlight;
      return {
        who,
        privateBundle,
        publicBundle,
        payload,
        browserVault,
        negatives,
        nodeProof: await c.validateIdentity(fixture.nodeIdentity.public),
        goProof: await c.validateIdentity(go.goIdentity.public),
        nativeIdentity,
        goIdentity,
        nodePayload: await c.decryptBundle(fixture.nodePrivate, nativeIdentity),
        goPayload: await c.decryptBundle(go.goPrivate, fixture.readerIdentity),
        publicPayload: await c.decryptBundle(go.goPublic),
        ownedName: owned.manifest.author.name,
        canonical: fixture.canonicalCases.map((raw: string) =>
          c.canonical(JSON.parse(raw)),
        ),
      };
    },
    { fixture, go },
  );
  expect(
    output.nodeProof && output.goProof && validateIdentity(output.who.public),
  ).toBe(true);
  expect(output.negatives).toEqual(Array(8).fill(true));
  expect(output.nativeIdentity).toEqual(fixture.nodeIdentity);
  expect(output.goIdentity).toEqual(go.goIdentity);
  expect(output.nodePayload).toEqual(fixture.payload);
  expect(output.goPayload).toEqual(fixture.payload);
  expect(output.publicPayload).toEqual(fixture.payload);
  expect(output.canonical).toEqual(go.canonicalCases);
  expect(output.ownedName).toBe(output.who.public.name);
  expect(importVault(output.browserVault, fixture.password)).toEqual(
    output.who,
  );
  verifyBundle(output.privateBundle);
  verifyBundle(output.publicBundle);
  expect(decryptBundle(output.privateBundle, fixture.nodeIdentity)).toEqual(
    output.payload,
  );
  expect(decryptBundle(output.privateBundle, go.goIdentity)).toEqual(
    output.payload,
  );
  expect(decryptBundle(output.publicBundle)).toEqual(output.payload);
  expect(() =>
    decryptBundle(output.privateBundle, fixture.eveIdentity),
  ).toThrow();
  const browserInput = {
    ...fixture,
    nodeIdentity: output.who,
    nodeVault: output.browserVault,
    readerIdentity: fixture.nodeIdentity,
    nodePrivate: output.privateBundle,
    nodePublic: output.publicBundle,
    payload: output.payload,
    nodeStoreDir: join(dir, "browser-input-store"),
    goStoreDir: join(dir, "browser-output-store"),
  };
  new ContentStore(browserInput.nodeStoreDir, 8 * 1024 * 1024).put(
    output.privateBundle,
    true,
  );
  const native = spawnSync(
    join(dir, process.platform === "win32" ? "interop.exe" : "interop"),
    [],
    {
      input: JSON.stringify(browserInput),
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  expect(native.error).toBeUndefined();
  expect(native.status, native.stderr).toBe(0);
  const nativeResult = JSON.parse(native.stdout);
  expect(
    nativeResult.nodeIdentityVerified &&
      nativeResult.nodeVaultRecovered &&
      nativeResult.unauthorizedRejected &&
      nativeResult.readerForgeryRejected &&
      nativeResult.corruptionRejected,
  ).toBe(true);
  expect(nativeResult.nodePrivatePayload).toEqual(output.payload);
  expect(nativeResult.nodePublicPayload).toEqual(output.payload);
  expect(
    await page.evaluate(
      async ({ bundle, who }) => (window as any).rl.decryptBundle(bundle, who),
      { bundle: nativeResult.goPrivate, who: output.who },
    ),
  ).toEqual(output.payload);
  mkdirSync(".cache/browser-foundation", { recursive: true });
  writeFileSync(
    ".cache/browser-foundation/crypto-scope.json",
    JSON.stringify(
      {
        browser: `${page.context().browser()!.browserType().name()} local crypto (Web Crypto symmetric/hash and noble portable curves)`,
        node: "bidirectional identity/vault/bundles",
        go: "Go executable consumed browser identity/vault/bundles and produced a reply decrypted in browser",
        canonicalNumberVectors: 1500,
        negativeControls: output.negatives.length,
        nodeDaemon: false,
        uiProductFlow: false,
        allBrowsers: false,
      },
      null,
      2,
    ),
  );
});

test("encrypted IndexedDB persists, coordinates two pages, rejects corruption and preserves pins on failed admission", async ({
  page,
  context,
}) => {
  await page.goto(url);
  const created = await page.evaluate(async () => {
    const r = (window as any).rl,
      profile = await r.BrowserProfile.connect("persistence", 24_000, 2);
    (window as any).profile = profile;
    const identity = await profile.setup(
      "Identidade privada",
      "frase passe longa de teste",
    );
    await profile.setValue("draft", {
      text: "Texto secreto não persistido em claro",
    });
    const author = await r.createIdentity("Autor externo"),
      b = await r.createBundle(
        author,
        "post",
        { text: "Publicação cifrada na base local" },
        "public",
      );
    const id = await profile.putBundle(b, true);
    return {
      identity,
      id,
      author: author.public.id,
      vault: await profile.exportIdentity(),
    };
  });
  expect(validateIdentity(created.identity)).toBe(true);
  const second = await context.newPage();
  await second.goto(url);
  await second.evaluate(async () => {
    const p = await (window as any).rl.BrowserProfile.connect(
      "persistence",
      24_000,
      2,
    );
    (window as any).profile = p;
    await p.unlock("frase passe longa de teste");
  });
  await Promise.all([
    page.evaluate(() =>
      (window as any).profile.setValue("from-first", "persistir primeiro"),
    ),
    second.evaluate(() =>
      (window as any).profile.setValue("from-second", "persistir segundo"),
    ),
  ]);
  expect(
    await page.evaluate(() => (window as any).profile.getValue("from-second")),
  ).toBe("persistir segundo");
  expect(
    await second.evaluate(() => (window as any).profile.getValue("from-first")),
  ).toBe("persistir primeiro");
  await page.reload();
  const persisted = await page.evaluate(async ({ id, author }) => {
    const r = (window as any).rl,
      p = await r.BrowserProfile.connect("persistence", 24_000, 2);
    (window as any).profile = p;
    const lockedInitially = p.locked;
    let wrong = false;
    try {
      await p.unlock("senha incorrecta");
    } catch {
      wrong = true;
    }
    await p.unlock("frase passe longa de teste");
    const read = await p.view(id),
      b = await p.getBundle(id),
      draft = await p.getValue("draft");
    const synthetic = await r.createIdentity("Outro autor");
    const secondBundle = await r.createBundle(
      synthetic,
      "post",
      { text: "Segunda publicação" },
      "public",
    );
    await p.putBundle(secondBundle, true);
    const before = await p.stats();
    let full = false;
    try {
      await p.putBundle(
        await r.createBundle(
          synthetic,
          "post",
          { text: "Não pode expulsar pins" },
          "public",
        ),
      );
    } catch {
      full = true;
    }
    const after = await p.stats();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("persistence");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const raw = await Promise.all(
      ["profile", "bundles"].map(
        (store) =>
          new Promise<unknown[]>((resolve, reject) => {
            const req = db.transaction(store).objectStore(store).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          }),
      ),
    );
    db.close();
    p.lock();
    let lockRefusal = false;
    try {
      await p.view(id);
    } catch {
      lockRefusal = true;
    }
    return {
      lockedInitially,
      wrong,
      read,
      draft,
      sameAuthor: b.manifest.author.id === author,
      full,
      before,
      after,
      raw: JSON.stringify(raw),
      lockRefusal,
      identity: p.identity,
    };
  }, created);
  expect(
    persisted.lockedInitially &&
      persisted.wrong &&
      persisted.full &&
      persisted.sameAuthor &&
      persisted.lockRefusal,
  ).toBe(true);
  expect(persisted.identity).toBeNull();
  expect(persisted.before).toEqual(persisted.after);
  expect(persisted.read).toEqual({ text: "Publicação cifrada na base local" });
  expect(persisted.draft).toEqual({
    text: "Texto secreto não persistido em claro",
  });
  for (const secret of [
    "Texto secreto",
    "Identidade privada",
    "Publicação cifrada",
    "persistir primeiro",
    "signSecret",
    "boxSecret",
  ])
    expect(persisted.raw).not.toContain(secret);
  // Corrupt actual IndexedDB bytes, then prove refusal after reload/unlock, without replacing the store.
  await second.evaluate(async (id) => {
    const p = (window as any).profile;
    p.close();
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open("persistence");
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("bundles", "readwrite"),
        store = tx.objectStore("bundles"),
        req = store.get(id);
      req.onsuccess = () => {
        const row = req.result;
        row.tag = "AAAAAAAAAAAAAAAAAAAAAA==";
        store.put(row, id);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, created.id);
  expect(
    await page.evaluate(async (id) => {
      const p = (window as any).profile;
      await p.unlock("frase passe longa de teste");
      try {
        await p.view(id);
        return false;
      } catch {
        return true;
      }
    }, created.id),
  ).toBe(true);
  await second.close();
});

test("lock during unlock cannot resurrect keys; missing authenticated state is not replaced with empty success", async ({
  page,
}) => {
  await page.goto(url);
  expect(
    await page.evaluate(async () => {
      const p = await (window as any).rl.BrowserProfile.connect("locked-race");
      await p.setup("Teste", "frase passe longa de teste");
      p.lock();
      const promise = p.unlock("frase passe longa de teste");
      await new Promise((resolve) => setTimeout(resolve, 20));
      p.lock();
      let rejected = false;
      try {
        await promise;
      } catch {
        rejected = true;
      }
      const locked = p.locked && p.identity === null;
      await p.unlock("frase passe longa de teste");
      p.close();
      const db = await new Promise<IDBDatabase>((resolve) => {
        const req = indexedDB.open("locked-race");
        req.onsuccess = () => resolve(req.result);
      });
      await new Promise<void>((resolve) => {
        const tx = db.transaction("profile", "readwrite");
        tx.objectStore("profile").delete("state");
        tx.oncomplete = () => resolve();
      });
      db.close();
      const broken = await (window as any).rl.BrowserProfile.connect(
        "locked-race",
      );
      let missing = false;
      try {
        await broken.unlock("frase passe longa de teste");
      } catch {
        missing = true;
      }
      const brokenLocked = broken.locked;
      broken.close();
      return { rejected, locked, missing, brokenLocked };
    }),
  ).toEqual({
    rejected: true,
    locked: true,
    missing: true,
    brokenLocked: true,
  });
});

test("real WebRTC transfers encrypted chunks and an offline author's reader seeds identical bytes to a new reader", async ({
  browser,
}) => {
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ locale: "pt-PT" })));
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const [a, b, c] = pages;
  const pair = async (
    left: typeof a,
    right: typeof a,
    leftName: string,
    rightName: string,
  ) => {
    const offer = await left.evaluate(
      async (name) => (window as any)[name].offer(),
      leftName,
    );
    const answer = await right.evaluate(
      async ({ name, offer }) => (window as any)[name].answer(offer),
      { name: rightName, offer },
    );
    await left.evaluate(
      async ({ name, answer }) => (window as any)[name].accept(answer),
      { name: leftName, answer },
    );
    await expect
      .poll(() =>
        left.evaluate(
          (name) => (window as any)[name].connection.connectionState,
          leftName,
        ),
      )
      .toBe("connected");
    await expect
      .poll(() =>
        right.evaluate(
          (name) => (window as any)[name].link?.channel.readyState,
          rightName,
        ),
      )
      .toBe("open");
  };
  try {
    await Promise.all(pages.map((p) => p.goto(url)));
    const cards = [];
    for (const [index, p] of pages.entries())
      cards.push(
        await p.evaluate(async (index) => {
          const r = (window as any).rl,
            profile = await r.BrowserProfile.connect("rtc-profile");
          (window as any).profile = profile;
          const identity = await profile.setup(
            "Par " + index,
            "frase passe longa de teste",
          );
          const receive = async (bundle: any) => {
            await profile.putBundle(bundle);
          };
          (window as any).left = new r.RtcPeer(receive);
          (window as any).right = new r.RtcPeer(receive);
          return identity;
        }, index),
      );
    await pair(a, b, "right", "left");
    const bundleID = await a.evaluate(
      async (readers) => {
        const r = (window as any).rl,
          p = (window as any).profile;
        const who = await r.importVault(
          await p.exportIdentity(),
          "frase passe longa de teste",
        );
        const bundle = await r.createBundle(
          who,
          "message",
          { text: "Encontro na escola", attachment: "abcdefgh".repeat(32_000) },
          readers,
        );
        await p.putBundle(bundle);
        await (window as any).right.link.send(bundle);
        return bundle.manifest.id;
      },
      [cards[1], cards[2]],
    );
    expect(
      await b.evaluate(
        async (id) => ((await (window as any).profile.view(id)) as any).text,
        bundleID,
      ),
    ).toBe("Encontro na escola");
    expect(await c.evaluate(() => (window as any).profile.ids())).toEqual([]);
    // No A-C connection exists. Stop the author context, then create the previously absent B-C path.
    await contexts[0].close();
    await expect
      .poll(() => b.evaluate(() => (window as any).left.link?.closed))
      .toBe(true);
    await pair(b, c, "right", "left");
    await b.evaluate(
      async (id) =>
        (window as any).right.link.send(
          await (window as any).profile.getBundle(id),
        ),
      bundleID,
    );
    const received = await c.evaluate(async (id) => {
      const p = (window as any).profile,
        bundle = await p.getBundle(id),
        content = await p.view(id);
      const reports = await (window as any).left.connection.getStats();
      const candidates = [...reports.values()]
        .filter(
          (r: any) => r.type === "candidate-pair" && r.state === "succeeded",
        )
        .map((r: any) => ({
          bytesSent: r.bytesSent,
          bytesReceived: r.bytesReceived,
          nominated: r.nominated,
        }));
      return {
        author: bundle.manifest.author.id,
        id: bundle.manifest.id,
        content,
        candidates,
        resources: (window as any).left.link.resources,
      };
    }, bundleID);
    expect(received.author).toBe(cards[0].id);
    expect(received.id).toBe(bundleID);
    expect(received.content).toEqual({
      text: "Encontro na escola",
      attachment: "abcdefgh".repeat(32_000),
    });
    expect(
      received.candidates.some(
        (p: any) => p.nominated && p.bytesReceived > 256_000,
      ),
    ).toBe(true);
    expect(received.resources.incoming).toBe(0);
    expect(received.resources.incomingBytes).toBe(0);
    await c.reload();
    expect(
      await c.evaluate(async (id) => {
        const p = await (window as any).rl.BrowserProfile.connect(
          "rtc-profile",
        );
        await p.unlock("frase passe longa de teste");
        return ((await p.view(id)) as any).text;
      }, bundleID),
    ).toBe("Encontro na escola");
    writeFileSync(
      ".cache/browser-foundation/rtc-scope.json",
      JSON.stringify(
        {
          browser: `${browser.browserType().name()} on ${process.platform}`,
          peers: 3,
          separateBrowserContexts: true,
          dataChannel: "real ordered reliable SCTP/DTLS/ICE",
          mandatoryServers: [],
          payloadBytes: 256_000,
          originalAuthorContextClosedBeforeSeederTransfer: true,
          exactAuthorPreserved: true,
          persistentReload: true,
          automaticRouting: false,
          nativeTransportAdapter: false,
          physicalRadio: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("WebRTC rejects a correctly framed corrupt bundle before storage and rejects admission failure without ACK", async ({
  browser,
}) => {
  for (const mode of ["corrupt", "quota", "frame"] as const) {
    const ca = await browser.newContext({ locale: "pt-PT" }),
      cb = await browser.newContext({ locale: "pt-PT" }),
      a = await ca.newPage(),
      b = await cb.newPage();
    try {
      await a.goto(url);
      await b.goto(url);
      await a.evaluate(() => {
        (window as any).peer = new (window as any).rl.RtcPeer(async () => {});
      });
      await b.evaluate((mode) => {
        (window as any).deliveries = 0;
        (window as any).deny = false;
        (window as any).peer = new (window as any).rl.RtcPeer(async () => {
          if ((window as any).deny && mode === "quota")
            throw new Error("Quota cheia");
          (window as any).deliveries++;
        });
      }, mode);
      const offer = await a.evaluate(() => (window as any).peer.offer());
      const answer = await b.evaluate(
        (offer) => (window as any).peer.answer(offer),
        offer,
      );
      await a.evaluate((answer) => (window as any).peer.accept(answer), answer);
      await a.evaluate(async () => {
        const r = (window as any).rl;
        (window as any).author = await r.createIdentity("Autor");
        await (window as any).peer.link.send(
          await r.createBundle(
            (window as any).author,
            "post",
            { text: "Controlo positivo" },
            "public",
          ),
        );
      });
      expect(await b.evaluate(() => (window as any).deliveries)).toBe(1);
      await b.evaluate(() => {
        (window as any).deny = true;
      });
      if (mode === "quota")
        expect(
          await a.evaluate(async () => {
            try {
              const r = (window as any).rl;
              await (window as any).peer.link.send(
                await r.createBundle(
                  (window as any).author,
                  "post",
                  { text: "Sem admissão" },
                  "public",
                ),
              );
              return false;
            } catch {
              return true;
            }
          }),
        ).toBe(true);
      else
        await a.evaluate(async (mode) => {
          const r = (window as any).rl,
            bundle = await r.createBundle(
              (window as any).author,
              "post",
              { text: "Recusar" },
              "public",
            );
          const chunk = bundle.manifest.chunks[0].hash;
          bundle.chunks[chunk] = "A".repeat(bundle.chunks[chunk].length);
          const data = r.b64(r.utf8(r.canonical(bundle)));
          (window as any).peer.link.channel.send(
            JSON.stringify({
              t: "part",
              id: bundle.manifest.id,
              index: mode === "frame" ? 1 : 0,
              count: 1,
              data,
            }),
          );
        }, mode);
      await expect
        .poll(() => b.evaluate(() => (window as any).peer.link.closed))
        .toBe(true);
      expect(await b.evaluate(() => (window as any).deliveries)).toBe(1);
      expect(
        await b.evaluate(() => (window as any).peer.link.counters.rejected),
      ).toBe(1);
    } finally {
      await ca.close();
      await cb.close();
    }
  }
});

test("identity recovery is compatible and cannot overwrite an existing profile; quota eviction retains pinned objects", async ({
  page,
}) => {
  await page.goto(url);
  const result = await page.evaluate(async () => {
    const r = (window as any).rl,
      who = await r.createIdentity("Identidade recuperada"),
      vault = await r.exportVault(who, "frase passe longa de teste");
    const p = await r.BrowserProfile.connect("recovery", 32_000, 2);
    const card = await p.restore(vault, "frase passe longa de teste");
    await p.setValue("draft", "Conservar");
    let replaceRejected = false;
    try {
      await p.restore(vault, "frase passe longa de teste");
    } catch {
      replaceRejected = true;
    }
    const a = await r.createBundle(who, "post", { text: "Fixado" }, "public"),
      b = await r.createBundle(who, "post", { text: "Descartável" }, "public"),
      c = await r.createBundle(who, "post", { text: "Mais recente" }, "public");
    await p.putBundle(a, true);
    await p.putBundle(b);
    await p.putBundle(c);
    const ids = await p.ids(),
      stats = await p.stats(),
      draft = await p.getValue("draft");
    let oversized = false;
    try {
      await p.putBundle(
        await r.createBundle(
          who,
          "post",
          { text: "a".repeat(40_000) },
          "public",
        ),
      );
    } catch {
      oversized = true;
    }
    const after = await p.stats();
    p.close();
    return {
      card,
      original: who.public,
      replaceRejected,
      ids,
      expectedIDs: [a.manifest.id, c.manifest.id],
      stats,
      after,
      draft,
      oversized,
    };
  });
  expect(result.card).toEqual(result.original);
  expect(result.replaceRejected && result.oversized).toBe(true);
  expect(result.ids.sort()).toEqual(result.expectedIDs.sort());
  expect(result.stats).toEqual(result.after);
  expect(result.draft).toBe("Conservar");
});

test("browser application bundle/ledger commit is atomic, pending reservations survive eviction pressure and IDB abort preserves prior state", async ({
  page,
}) => {
  await page.goto(url);
  const result = await page.evaluate(async () => {
    const r = (window as any).rl,
      p = await r.BrowserProfile.connect("atomic-app", 32_000, 1);
    await p.setup("Transacção", "frase passe longa de teste");
    const who = await r.createIdentity("Autor"),
      a = await r.createBundle(who, "post", { text: "Primeiro" }, "public"),
      b = await r.createBundle(who, "post", { text: "Segundo" }, "public");
    await p.putBundle(
      a,
      false,
      { key: "ledger", update: () => ({ id: a.manifest.id }) },
      true,
    );
    let reserved = false;
    try {
      await p.putBundle(b);
    } catch {
      reserved = true;
    }
    const protectedIds = await p.ids();
    await p.updateValue("ledger", (old: any) => old, [a.manifest.id]);
    let mutationFailure = false;
    try {
      await p.putBundle(b, false, {
        key: "ledger",
        update: () => {
          throw new Error("abort mutation");
        },
      });
    } catch {
      mutationFailure = true;
    }
    const beforeCommit = {
      ids: await p.ids(),
      ledger: await p.getValue("ledger"),
    };
    await p.putBundle(b, false, {
      key: "ledger",
      update: () => ({ id: b.manifest.id }),
    });
    const committed = {
      ids: await p.ids(),
      ledger: await p.getValue("ledger"),
    };
    const transaction = p.db.transaction.bind(p.db);
    let injected = false;
    p.db.transaction = (...args: any[]) => {
      const tx = transaction(...args);
      if (args[1] === "readwrite" && !injected) {
        injected = true;
        queueMicrotask(() => tx.abort());
      }
      return tx;
    };
    let ioFailure = false;
    try {
      await p.putBundle(a, false, {
        key: "ledger",
        update: () => ({ id: a.manifest.id }),
      });
    } catch {
      ioFailure = true;
    }
    p.db.transaction = transaction;
    const afterAbort = {
      ids: await p.ids(),
      ledger: await p.getValue("ledger"),
    };
    p.close();
    return {
      a: a.manifest.id,
      b: b.manifest.id,
      reserved,
      protectedIds,
      mutationFailure,
      beforeCommit,
      committed,
      ioFailure,
      injected,
      afterAbort,
    };
  });
  expect(
    result.reserved &&
      result.mutationFailure &&
      result.ioFailure &&
      result.injected,
  ).toBe(true);
  expect(result.protectedIds).toEqual([result.a]);
  expect(result.beforeCommit).toEqual({
    ids: [result.a],
    ledger: { id: result.a },
  });
  expect(result.committed).toEqual({
    ids: [result.b],
    ledger: { id: result.b },
  });
  expect(result.afterAbort).toEqual(result.committed);
});
