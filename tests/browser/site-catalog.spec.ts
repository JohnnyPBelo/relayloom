import { test, expect } from "@playwright/test";
import { staticHarness } from "./static-harness";
const payload = {
  type: "site",
  blocks: [],
  theme: "sand",
  site: {
    version: 1,
    title: "Browser catalog page",
    description: "Persisted and signed",
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

test("private profile transactions commit deletion and values together and close their handles", async ({
  page,
}) => {
  const host = await staticHarness();
  try {
    await page.goto(host.url);
    const result = await page.evaluate(async () => {
      const r = (window as any).rl,
        name = "site-tx-" + crypto.randomUUID(),
        p = await r.BrowserProfile.connect(name);
      await p.setup("Transaction owner", "fixture transaction password");
      try {
        await p.setValue("old", { n: 1 });
        let handle: any;
        const response = await p.transactValues(async (tx: any) => {
          handle = tx;
          tx.set("first", { n: 2 });
          tx.set("second", { n: 3 });
          await tx.remove("old");
          return { committed: true };
        });
        let denied = false;
        try {
          await handle.get("first");
        } catch {
          denied = true;
        }
        return {
          response,
          denied,
          keys: await p.valueKeys(),
          values: await p.readValues(["old", "first", "second"]),
          inventory: await p.ids(),
        };
      } finally {
        p.close();
        indexedDB.deleteDatabase(name);
      }
    });
    expect(result).toEqual({
      response: { committed: true },
      denied: true,
      keys: ["first", "second"],
      values: { old: null, first: { n: 2 }, second: { n: 3 } },
      inventory: [],
    });
  } finally {
    await host.close();
  }
});

test("caught failures, abandoned async calls and profile lock cannot partially commit a transaction", async ({
  page,
}) => {
  const host = await staticHarness();
  try {
    await page.goto(host.url);
    const result = await page.evaluate(async () => {
      const r = (window as any).rl,
        name = "site-tx-fail-" + crypto.randomUUID(),
        password = "fixture locked transaction",
        p = await r.BrowserProfile.connect(name);
      await p.setup("Transaction failure owner", password);
      await p.setValue("existing", { n: 1 });
      const rejects = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
          return false;
        } catch {
          return true;
        }
      };
      try {
        const latched = await rejects(() =>
          p.transactValues(async (tx: any) => {
            try {
              tx.set("invalid", undefined);
            } catch {}
            try {
              tx.set("existing", { n: 9 });
            } catch {}
            return true;
          }),
        );
        let forgotten: Promise<unknown> | undefined;
        const pending = await rejects(() =>
          p.transactValues(async (tx: any) => {
            forgotten = tx.get("existing");
            void forgotten!.catch(() => {});
            tx.set("later", { n: 5 });
            return true;
          }),
        );
        if (forgotten) await forgotten.catch(() => {});
        let release!: () => void, started!: () => void;
        const ready = new Promise<void>((resolve) => (started = resolve));
        const work = p.transactValues(async (tx: any) => {
          tx.set("existing", { n: 10 });
          started();
          await new Promise<void>((resolve) => (release = resolve));
          return true;
        });
        await ready;
        p.lock();
        release();
        const locked = await rejects(() => work);
        await p.unlock(password);
        return {
          latched,
          pending,
          locked,
          values: await p.readValues(["existing", "invalid", "later"]),
        };
      } finally {
        p.close();
        indexedDB.deleteDatabase(name);
      }
    });
    expect(result).toEqual({
      latched: true,
      pending: true,
      locked: true,
      values: { existing: { n: 1 }, invalid: null, later: null },
    });
  } finally {
    await host.close();
  }
});

test("browser catalog keeps preparation private and resumes the exact signed snapshot after reopening", async ({
  page,
}) => {
  const host = await staticHarness();
  try {
    await page.goto(host.url);
    const result = await page.evaluate(async (payload) => {
      const r = (window as any).rl,
        name = "browser-catalog-" + crypto.randomUUID(),
        password = "fixture browser catalog passphrase";
      let p = await r.BrowserProfile.connect(name);
      const owner = await p.setup("Browser catalog owner", password);
      let c = new r.BrowserSiteCatalog(p);
      try {
        const state = await c.state(owner.id, "profile"),
          request = {
            sequence: state.nextSequence,
            operationId: crypto.randomUUID(),
            expectedBase: state.base,
            payload,
            readers: "public",
            ttlMs: 3600000,
          };
        const prepared = await c.createPublication("profile", request);
        if ((await p.ids()).length)
          throw Error("prepared signature became peer inventory");
        let denied = false;
        try {
          await c.authorizedBundle("profile", prepared);
        } catch {
          denied = true;
        }
        await c.commit("profile", prepared);
        p.close();
        p = await r.BrowserProfile.connect(name);
        await p.unlock(password);
        c = new r.BrowserSiteCatalog(p);
        const restored = await c.createPublication("profile", request),
          bundle = await c.authorizedBundle("profile", restored);
        await p.putBundle(bundle, true);
        await c.markReady("profile", restored);
        const ready = await c.createPublication("profile", request);
        return {
          denied,
          phase: prepared.phase,
          id: prepared.bundleId,
          recovered: restored.bundleId,
          ready: ready.phase,
          content: await p.decrypt(bundle),
          inventory: await p.ids(),
          state: await c.state(owner.id, "profile"),
        };
      } finally {
        p.close();
        indexedDB.deleteDatabase(name);
      }
    }, payload);
    expect(result.denied).toBe(true);
    expect(result.phase).toBe("prepared");
    expect(result.recovered).toBe(result.id);
    expect(result.ready).toBe("ready");
    expect(result.content.site).toEqual(payload.site);
    expect(result.inventory).toEqual([result.id]);
    expect(result.state.number).toBe(1);
    expect(result.state.nextSequence).toBe(2);
  } finally {
    await host.close();
  }
});

test("two browser profiles sharing a base can reserve only one publication", async ({
  page,
}) => {
  const host = await staticHarness();
  try {
    await page.goto(host.url);
    const result = await page.evaluate(async (payload) => {
      const r = (window as any).rl,
        name = "catalog-cas-" + crypto.randomUUID(),
        password = "fixture browser CAS passphrase",
        a = await r.BrowserProfile.connect(name);
      const owner = await a.setup("Competing owner", password),
        b = await r.BrowserProfile.connect(name);
      await b.unlock(password);
      try {
        const ca = new r.BrowserSiteCatalog(a),
          cb = new r.BrowserSiteCatalog(b),
          state = await ca.state(owner.id, "profile");
        const q = (title: string) => ({
          sequence: 1,
          operationId: crypto.randomUUID(),
          expectedBase: state.base,
          payload: { ...payload, site: { ...payload.site, title } },
          readers: "public",
          ttlMs: 3600000,
        });
        const attempts = await Promise.allSettled([
          ca.createPublication("profile", q("One")),
          cb.createPublication("profile", q("Two")),
        ]);
        const stored = await ca.state(owner.id, "profile");
        return {
          passed: attempts.filter((a) => a.status === "fulfilled").length,
          failed: attempts.filter((a) => a.status === "rejected").length,
          pending: stored.pending.length,
          next: stored.nextSequence,
          ids: await a.ids(),
        };
      } finally {
        a.close();
        b.close();
        indexedDB.deleteDatabase(name);
      }
    }, payload);
    expect(result).toEqual({
      passed: 1,
      failed: 1,
      pending: 1,
      next: 2,
      ids: [],
    });
  } finally {
    await host.close();
  }
});

test("expired browser preparations remain terminal, preserve counters and reject a stale session", async ({
  page,
}) => {
  const host = await staticHarness();
  try {
    await page.goto(host.url);
    const result = await page.evaluate(async (payload) => {
      const r = (window as any).rl,
        password = "expiry catalog fixture passphrase",
        originalNow = Date.now;
      let now = originalNow();
      Date.now = () => now;
      const results = [];
      try {
        for (const authorize of [false, true]) {
          const name = "catalog-expiry-" + crypto.randomUUID(),
            p = await r.BrowserProfile.connect(name),
            owner = await p.setup("Expiry owner", password);
          let c = new r.BrowserSiteCatalog(p);
          try {
            const state = await c.state(owner.id, "profile"),
              q = {
                sequence: 1,
                operationId: crypto.randomUUID(),
                expectedBase: state.base,
                payload,
                readers: "public",
                ttlMs: 1000,
              };
            const op = await c.createPublication("profile", q);
            if (authorize) await c.commit("profile", op);
            now += 1001;
            p.lock();
            await p.unlock(password);
            let stale = false;
            try {
              await c.state(owner.id, "profile");
            } catch {
              stale = true;
            }
            c = new r.BrowserSiteCatalog(p);
            const after = await c.state(owner.id, "profile"),
              replay = await c.createPublication("profile", q);
            let newDenied = false;
            try {
              await c.createPublication("profile", {
                ...q,
                operationId: crypto.randomUUID(),
              });
            } catch {
              newDenied = true;
            }
            results.push({
              authorize,
              stale,
              newDenied,
              number: after.number,
              next: after.nextSequence,
              pending: after.pending.length,
              phase: replay.phase,
              ids: await p.ids(),
              stageKeys: (await p.valueKeys()).filter((k: string) =>
                k.endsWith(":stage"),
              ),
            });
          } finally {
            p.close();
            indexedDB.deleteDatabase(name);
          }
        }
      } finally {
        Date.now = originalNow;
      }
      return results;
    }, payload);
    expect(result).toEqual(
      [false, true].map((authorize) => ({
        authorize,
        stale: true,
        newDenied: true,
        number: authorize ? 1 : 0,
        next: 2,
        pending: 0,
        phase: "expired",
        ids: [],
        stageKeys: [],
      })),
    );
  } finally {
    await host.close();
  }
});

test("IndexedDB abort and corrupted private staging cannot leave partial site state or silently replace signed bytes", async ({
  page,
}) => {
  const host = await staticHarness();
  try {
    await page.goto(host.url);
    const result = await page.evaluate(async (payload) => {
      const r = (window as any).rl,
        name = "catalog-corruption-" + crypto.randomUUID(),
        password = "catalog corruption passphrase",
        p = await r.BrowserProfile.connect(name),
        owner = await p.setup("Corruption owner", password),
        c = new r.BrowserSiteCatalog(p);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const q = indexedDB.open(name);
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
      const read = (store: string, id: string) =>
        new Promise<any>((resolve, reject) => {
          const q = db.transaction(store).objectStore(store).get(id);
          q.onsuccess = () => resolve(q.result);
          q.onerror = () => reject(q.error);
        });
      const put = (store: string, id: string, value: any) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(store, "readwrite");
          tx.objectStore(store).put(value, id);
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
      const rejects = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
          return false;
        } catch {
          return true;
        }
      };
      let secret: Uint8Array | undefined;
      try {
        await p.setValue("retained", { n: 1 });
        const state = await c.state(owner.id, "profile"),
          q = {
            sequence: 1,
            operationId: crypto.randomUUID(),
            expectedBase: state.base,
            payload,
            readers: "public",
            ttlMs: 3600000,
          };
        const original = IDBObjectStore.prototype.put;
        let aborted = false;
        IDBObjectStore.prototype.put = function (value, key) {
          if (this.name === "bundles" && String(key).startsWith("private:")) {
            this.transaction.abort();
            throw new DOMException(
              "fixture durable commit failure",
              "QuotaExceededError",
            );
          }
          return original.call(this, value, key);
        };
        try {
          aborted = await rejects(() => c.createPublication("profile", q));
        } finally {
          IDBObjectStore.prototype.put = original;
        }
        const noPartial =
          (await p.valueKeys()).join(",") === "retained" &&
          (await c.state(owner.id, "profile")).nextSequence === 1;
        const op = await c.createPublication("profile", q),
          identity = await r.importVault(await p.exportIdentity(), password);
        secret = await r.hkdf(
          r.un64(identity.signSecret),
          owner.id,
          "relayloom-browser-profile-v1",
        );
        const row = await read("profile", "state"),
          index = JSON.parse(
            new TextDecoder().decode(
              await r.open(
                row.sealed,
                secret,
                "relayloom-browser-state-v1:" + owner.id,
              ),
            ),
          ),
          stageKey = Object.keys(index.valueRefs).find((k) =>
            k.endsWith(":stage"),
          )!,
          blobKey = "private:" + index.valueRefs[stageKey].id,
          valid = await read("bundles", blobKey);
        const corrupt = {
          ...valid,
          data: (valid.data[0] === "A" ? "B" : "A") + valid.data.slice(1),
        };
        await put("bundles", blobKey, corrupt);
        const readDenied = await rejects(() => c.state(owner.id, "profile")),
          replaceDenied = await rejects(() =>
            p.transactValues(async (tx: any) => {
              tx.set(stageKey, { replaced: true });
              tx.set("retained", { n: 9 });
            }),
          ),
          removeDenied = await rejects(() =>
            p.transactValues(async (tx: any) => {
              await tx.remove(stageKey);
              tx.set("retained", { n: 8 });
            }),
          );
        const retained = await p.getValue("retained"),
          unchanged =
            r.canonical(await read("bundles", blobKey)) ===
            r.canonical(corrupt);
        await put("bundles", blobKey, valid);
        const committed = await c.commit("profile", op),
          bundle = await c.authorizedBundle("profile", committed);
        return {
          aborted,
          noPartial,
          readDenied,
          replaceDenied,
          removeDenied,
          retained,
          unchanged,
          phase: committed.phase,
          exact: bundle.manifest.id === op.bundleId,
          ids: await p.ids(),
        };
      } finally {
        secret?.fill(0);
        db.close();
        p.close();
        indexedDB.deleteDatabase(name);
      }
    }, payload);
    expect(result).toEqual({
      aborted: true,
      noPartial: true,
      readDenied: true,
      replaceDenied: true,
      removeDenied: true,
      retained: { n: 1 },
      unchanged: true,
      phase: "committed",
      exact: true,
      ids: [],
    });
  } finally {
    await host.close();
  }
});

test("private transactions enforce final quota while an atomic replacement fits at the storage boundary", async ({
  page,
}) => {
  const host = await staticHarness();
  try {
    await page.goto(host.url);
    const result = await page.evaluate(async () => {
      const r = (window as any).rl,
        name = "site-tx-quota-" + crypto.randomUUID(),
        p = await r.BrowserProfile.connect(name);
      await p.setup(
        "Quota boundary owner",
        "private quota boundary passphrase",
      );
      // Quota counts sealed JSON, including base64, rather than plaintext.
      const overhead = r.canonical(
        await r.seal(new Uint8Array(), r.random(32), "quota-fixture"),
      ).length;
      const size =
          3 *
            Math.floor((r.PRIVATE_VALUE_LIMITS.totalBytes / 4 - overhead) / 4) -
          2,
        large = "x".repeat(size);
      try {
        for (const key of ["one", "two", "three", "four"])
          await p.setValue(key, large);
        const before = (await p.stats()).privateBytes;
        let denied = false;
        try {
          await p.transactValues(async (tx: any) => {
            tx.set("overflow", "x");
          });
        } catch {
          denied = true;
        }
        await p.transactValues(async (tx: any) => {
          tx.set("replacement", large);
          await tx.remove("one");
        });
        const keys = await p.valueKeys(),
          after = (await p.stats()).privateBytes;
        return {
          denied,
          keys,
          sameBytes: before === after,
          exact: (await p.getValue("replacement")).length === size,
          old: await p.getValue("one"),
          overflow: await p.getValue("overflow"),
        };
      } finally {
        p.close();
        indexedDB.deleteDatabase(name);
      }
    });
    expect(result).toEqual({
      denied: true,
      keys: ["four", "replacement", "three", "two"],
      sameBytes: true,
      exact: true,
      old: null,
      overflow: null,
    });
  } finally {
    await host.close();
  }
});
