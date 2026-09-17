import { test, expect } from "@playwright/test";
import { staticHarness } from "./static-harness";

test("private values larger than the metadata index survive restart without becoming peer inventory", async ({
  page,
}) => {
  const host = await staticHarness();
  try {
    await page.goto(host.url);
    const result = await page.evaluate(async () => {
      const r = (window as any).rl,
        name = "private-values-" + crypto.randomUUID();
      const password = "private value fixture passphrase";
      let profile = await r.BrowserProfile.connect(name);
      try {
        const owner = await profile.setup("Private value owner", password);
        const value = {
          title: "Private site data",
          body: "PRIVATE_VALUE_CANARY_" + "x".repeat(2 * 1024 * 1024),
        };
        await profile.setValue("large-site", value);
        const first = await profile.getValue("large-site");
        if (r.canonical(first) !== r.canonical(value))
          throw Error("private value changed");
        if ((await profile.ids()).length !== 0)
          throw Error("private data entered peer inventory");
        profile.close();
        profile = await r.BrowserProfile.connect(name);
        const restored = await profile.unlock(password);
        const reopened = await profile.getValue("large-site");
        return {
          ownerPreserved: restored.id === owner.id,
          exactValue: r.canonical(reopened) === r.canonical(value),
          peerInventory: await profile.ids(),
          length: reopened.body.length,
        };
      } finally {
        profile.close();
        indexedDB.deleteDatabase(name);
      }
    });
    expect(result.ownerPreserved).toBe(true);
    expect(result.exactValue).toBe(true);
    expect(result.peerInventory).toEqual([]);
    expect(result.length).toBeGreaterThan(2 * 1024 * 1024);
  } finally {
    await host.close();
  }
});

test("legacy embedded values migrate lazily and encrypted value rows remain outside peer access", async ({
  page,
}) => {
  const host = await staticHarness();
  try {
    await page.goto(host.url);
    const result = await page.evaluate(async () => {
      const r = (window as any).rl,
        name = "legacy-values-" + crypto.randomUUID(),
        password = "private legacy value fixture";
      let profile = await r.BrowserProfile.connect(name);
      const identity = await profile.setup("Legacy value owner", password);
      const secret = await r.importVault(
        await profile.exportIdentity(),
        password,
      );
      const key = await r.hkdf(
        r.un64(secret.signSecret),
        identity.id,
        "relayloom-browser-profile-v1",
      );
      secret.signSecret = "";
      secret.boxSecret = "";
      const db = await new Promise<IDBDatabase>((done, fail) => {
        const q = indexedDB.open(name);
        q.onsuccess = () => done(q.result);
        q.onerror = () => fail(q.error);
      });
      const read = (store: string, id: string) =>
        new Promise<any>((done, fail) => {
          const q = db.transaction(store).objectStore(store).get(id);
          q.onsuccess = () => done(q.result);
          q.onerror = () => fail(q.error);
        });
      const put = (store: string, id: string, value: unknown) =>
        new Promise<void>((done, fail) => {
          const tx = db.transaction(store, "readwrite");
          tx.objectStore(store).put(value, id);
          tx.oncomplete = () => done();
          tx.onabort = tx.onerror = () => fail(tx.error);
        });
      try {
        const legacy = {
          values: {
            draft: { text: "Keep the original" },
            unrelated: { untouched: true },
          },
          bundles: {},
        };
        const bytes = r.utf8(r.canonical(legacy));
        await put("profile", "state", {
          sealed: await r.seal(
            bytes,
            key,
            "relayloom-browser-state-v1:" + identity.id,
          ),
          revision: crypto.randomUUID(),
          size: bytes.length,
        });
        profile.close();
        profile = await r.BrowserProfile.connect(name);
        await profile.unlock(password);
        if ((await profile.getValue("draft")).text !== "Keep the original")
          throw Error("legacy value was reset");
        const decrypt = SubtleCrypto.prototype.decrypt;
        let release: (() => void) | undefined;
        let ready: (() => void) | undefined;
        const paused = new Promise<void>((resolve) => {
          ready = resolve;
        });
        SubtleCrypto.prototype.decrypt = function (...args) {
          return decrypt.apply(this, args).then(
            (value) =>
              new Promise<ArrayBuffer>((resolve) => {
                release = () => resolve(value);
                ready!();
              }),
          );
        };
        try {
          const pending = profile.getValue("draft").then(
            () => false,
            () => true,
          );
          await paused;
          profile.lock();
          release!();
          if (!(await pending))
            throw Error("legacy read returned private data after lock");
        } finally {
          SubtleCrypto.prototype.decrypt = decrypt;
          release?.();
        }
        await profile.unlock(password);
        const marker = "PRIVATE_VALUE_CANARY_",
          large = { text: marker + "x".repeat(2 * 1024 * 1024) };
        await profile.setValue("draft", large);
        if (!(await profile.getValue("unrelated")).untouched)
          throw Error("unrelated legacy value changed");
        const row = await read("profile", "state"),
          index = JSON.parse(
            new TextDecoder().decode(
              await r.open(
                row.sealed,
                key,
                "relayloom-browser-state-v1:" + identity.id,
              ),
            ),
          );
        if (
          Object.hasOwn(index.values, "draft") ||
          !index.values.unrelated.untouched ||
          !index.valueRefs.draft
        )
          throw Error("migration descriptor is wrong");
        const reference = index.valueRefs.draft,
          stored = await read("bundles", "private:" + reference.id);
        const leaks = (value: any) =>
          r.canonical(value).includes(marker) ||
          atob(value.data).includes(marker);
        if (leaks(stored)) throw Error("plaintext value leaked");
        if (!leaks({ data: btoa(r.canonical(large)), nonce: "", tag: "" }))
          throw Error("plaintext detector negative control did not fail");
        for (const id of [reference.id, "private:" + reference.id]) {
          let denied = false;
          try {
            await profile.getBundle(id);
          } catch {
            denied = true;
          }
          if (!denied) throw Error("private value accepted as peer bundle");
        }
        return {
          metadataBytes: row.size,
          exactValue:
            r.canonical(await profile.getValue("draft")) === r.canonical(large),
          inventory: await profile.ids(),
          privateBytes: (await profile.stats()).privateBytes,
        };
      } finally {
        key.fill(0);
        db.close();
        profile.close();
        indexedDB.deleteDatabase(name);
      }
    });
    expect(result.metadataBytes).toBeLessThan(1024 * 1024);
    expect(result.exactValue).toBe(true);
    expect(result.inventory).toEqual([]);
    expect(result.privateBytes).toBeGreaterThan(2 * 1024 * 1024);
  } finally {
    await host.close();
  }
});

test("bundle and private-value mutations commit together, and corruption cannot silently reset a value", async ({
  page,
}) => {
  const host = await staticHarness();
  try {
    await page.goto(host.url);
    const result = await page.evaluate(async () => {
      const r = (window as any).rl,
        name = "atomic-values-" + crypto.randomUUID();
      const profile = await r.BrowserProfile.connect(name),
        owner = await profile.setup(
          "Atomic value owner",
          "private atomic value fixture",
        );
      const identity = await r.importVault(
          await profile.exportIdentity(),
          "private atomic value fixture",
        ),
        key = await r.hkdf(
          r.un64(identity.signSecret),
          owner.id,
          "relayloom-browser-profile-v1",
        );
      const db = await new Promise<IDBDatabase>((done, fail) => {
        const q = indexedDB.open(name);
        q.onsuccess = () => done(q.result);
        q.onerror = () => fail(q.error);
      });
      const read = (store: string, id: string) =>
        new Promise<any>((done, fail) => {
          const q = db.transaction(store).objectStore(store).get(id);
          q.onsuccess = () => done(q.result);
          q.onerror = () => fail(q.error);
        });
      const put = (store: string, id: string, value: unknown) =>
        new Promise<void>((done, fail) => {
          const tx = db.transaction(store, "readwrite");
          tx.objectStore(store).put(value, id);
          tx.oncomplete = () => done();
          tx.onabort = tx.onerror = () => fail(tx.error);
        });
      const rejects = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
          return false;
        } catch {
          return true;
        }
      };
      try {
        await profile.setValue("counter", { n: 1 });
        const bundle = await profile.signContent(
          "post",
          { type: "post", text: "Atomic public control" },
          "public",
        );
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, key) {
          if (this.name === "bundles" && String(key).startsWith("private:")) {
            this.transaction.abort();
            throw new DOMException(
              "fixture private-value failure",
              "QuotaExceededError",
            );
          }
          return original.call(this, value, key);
        };
        let rejected;
        try {
          rejected = await rejects(() =>
            profile.putBundle(bundle, false, {
              key: "counter",
              update: (old: any) => ({ n: old.n + 1 }),
            }),
          );
        } finally {
          IDBObjectStore.prototype.put = original;
        }
        if (
          !rejected ||
          (await profile.getValue("counter")).n !== 1 ||
          (await profile.ids()).length !== 0
        )
          throw Error("partial transaction escaped");
        await profile.putBundle(bundle, false, {
          key: "counter",
          update: (old: any) => ({ n: old.n + 1 }),
        });
        if (
          (await profile.getValue("counter")).n !== 2 ||
          (await profile.ids())[0] !== bundle.manifest.id
        )
          throw Error("positive transaction missing");
        const row = await read("profile", "state"),
          index = JSON.parse(
            new TextDecoder().decode(
              await r.open(
                row.sealed,
                key,
                "relayloom-browser-state-v1:" + owner.id,
              ),
            ),
          );
        const id = "private:" + index.valueRefs.counter.id,
          sealed = await read("bundles", id);
        await put("bundles", id, {
          ...sealed,
          data: (sealed.data[0] === "A" ? "B" : "A") + sealed.data.slice(1),
        });
        if (
          !(await rejects(() => profile.getValue("counter"))) ||
          !(await rejects(() => profile.setValue("counter", { n: 99 })))
        )
          throw Error("corruption silently overwritten");
        if (
          (await profile.getBundle(bundle.manifest.id)).manifest.id !==
          bundle.manifest.id
        )
          throw Error("unrelated bundle was lost");
        await put("bundles", id, sealed);
        // Missing data must not be mistaken for an unused key and overwritten.
        await new Promise<void>((done, fail) => {
          const tx = db.transaction("bundles", "readwrite");
          tx.objectStore("bundles").delete(id);
          tx.oncomplete = () => done();
          tx.onabort = tx.onerror = () => fail(tx.error);
        });
        if (
          !(await rejects(() => profile.getValue("counter"))) ||
          !(await rejects(() => profile.setValue("counter", { n: 99 })))
        )
          throw Error("missing private data silently overwritten");
        await put("bundles", id, sealed);
        await profile.setValue("other-counter", { n: 3 });
        const updated = await read("profile", "state");
        const updatedIndex = JSON.parse(
          new TextDecoder().decode(
            await r.open(
              updated.sealed,
              key,
              "relayloom-browser-state-v1:" + owner.id,
            ),
          ),
        );
        const otherId = "private:" + updatedIndex.valueRefs["other-counter"].id;
        const otherSealed = await read("bundles", otherId);
        if (r.canonical(sealed).length !== r.canonical(otherSealed).length)
          throw Error("swap fixture must have equal lengths");
        await put("bundles", id, otherSealed);
        await put("bundles", otherId, sealed);
        if (
          !(await rejects(() => profile.getValue("counter"))) ||
          !(await rejects(() => profile.getValue("other-counter")))
        )
          throw Error("private ciphertext accepted under another key");
        await put("bundles", id, sealed);
        await put("bundles", otherId, otherSealed);
        if ((await profile.getValue("other-counter")).n !== 3)
          throw Error("positive restore control failed");
        return {
          counter: (await profile.getValue("counter")).n,
          inventory: await profile.ids(),
          ownerPreserved: profile.identity.id === owner.id,
        };
      } finally {
        key.fill(0);
        db.close();
        profile.close();
        indexedDB.deleteDatabase(name);
      }
    });
    expect(result.counter).toBe(2);
    expect(result.inventory).toHaveLength(1);
    expect(result.ownerPreserved).toBe(true);
  } finally {
    await host.close();
  }
});

test("private-value byte and total budgets reject excess without losing committed values", async ({
  page,
}) => {
  const host = await staticHarness();
  try {
    await page.goto(host.url);
    const result = await page.evaluate(async () => {
      const r = (window as any).rl,
        name = "bounded-values-" + crypto.randomUUID();
      const profile = await r.BrowserProfile.connect(name);
      await profile.setup(
        "Bounded value owner",
        "private bounded value fixture",
      );
      const limits = r.PRIVATE_VALUE_LIMITS,
        exact = "x".repeat(limits.valueBytes - 2);
      const rejects = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
          return false;
        } catch {
          return true;
        }
      };
      try {
        await profile.setValue("first", exact);
        if (!(await rejects(() => profile.setValue("first", exact + "x"))))
          throw Error("byte bound missing");
        if ((await profile.getValue("first")).length !== exact.length)
          throw Error("failed write changed old value");
        await profile.setValue("second", exact);
        const before = await profile.stats();
        if (!(await rejects(() => profile.setValue("third", exact))))
          throw Error("total budget missing");
        const after = await profile.stats();
        if (
          before.privateBytes !== after.privateBytes ||
          after.privateBytes > limits.totalBytes
        )
          throw Error("failed budget changed accounting");
        return {
          keys: await profile.valueKeys(),
          inventory: await profile.ids(),
          preserved: (await profile.getValue("second")).length === exact.length,
        };
      } finally {
        profile.close();
        indexedDB.deleteDatabase(name);
      }
    });
    expect(result.keys).toEqual(["first", "second"]);
    expect(result.inventory).toEqual([]);
    expect(result.preserved).toBe(true);
  } finally {
    await host.close();
  }
});

test("multiple private values share one commit and a concurrent writer cannot remove a reader's snapshot", async ({
  page,
}) => {
  const host = await staticHarness();
  try {
    await page.goto(host.url);
    const result = await page.evaluate(async () => {
      const r = (window as any).rl,
        name = "multi-values-" + crypto.randomUUID();
      const profile = await r.BrowserProfile.connect(name);
      await profile.setup("Multiple values", "private multi value fixture");
      const rejects = async (fn: () => Promise<unknown>) => {
        try {
          await fn();
          return false;
        } catch {
          return true;
        }
      };
      const update = (key: string) => ({
        key,
        update: (old: any) => ({ n: old.n + 1 }),
      });
      try {
        await profile.updateValues([
          { key: "one", update: () => ({ n: 1 }) },
          { key: "two", update: () => ({ n: 1 }) },
        ]);
        if (
          !(await rejects(() =>
            profile.updateValues([
              update("one"),
              {
                key: "two",
                update: () => {
                  throw Error("fixture mutation failure");
                },
              },
            ]),
          ))
        )
          throw Error("failed mutation accepted");
        let data = await profile.readValues(["one", "two"]);
        if (data.one.n !== 1 || data.two.n !== 1)
          throw Error("first value committed alone");
        const put = IDBObjectStore.prototype.put;
        let count = 0;
        IDBObjectStore.prototype.put = function (value, key) {
          if (
            this.name === "bundles" &&
            String(key).startsWith("private:") &&
            ++count === 2
          ) {
            this.transaction.abort();
            throw new DOMException(
              "second value fixture failure",
              "QuotaExceededError",
            );
          }
          return put.call(this, value, key);
        };
        try {
          if (
            !(await rejects(() =>
              profile.updateValues([update("one"), update("two")]),
            ))
          )
            throw Error("partial IDB write accepted");
        } finally {
          IDBObjectStore.prototype.put = put;
        }
        data = await profile.readValues(["one", "two"]);
        if (data.one.n !== 1 || data.two.n !== 1)
          throw Error("IDB rollback lost a value");
        await profile.updateValues([update("one"), update("two")]);
        data = await profile.readValues(["one", "two"]);
        if (data.one.n !== 2 || data.two.n !== 2)
          throw Error("positive multi-value commit missing");
        if (
          !(await rejects(() =>
            profile.updateValues([update("one"), update("one")]),
          ))
        )
          throw Error("duplicate-key mutation accepted");
        const decrypt = SubtleCrypto.prototype.decrypt;
        let release: (() => void) | undefined,
          ready: (() => void) | undefined,
          held = false;
        const paused = new Promise<void>((resolve) => {
          ready = resolve;
        });
        SubtleCrypto.prototype.decrypt = function (...args) {
          const result = decrypt.apply(this, args);
          if (held) return result;
          held = true;
          return result.then(
            (value) =>
              new Promise<ArrayBuffer>((resolve) => {
                release = () => resolve(value);
                ready!();
              }),
          );
        };
        let read: any;
        try {
          const pending = profile.getValue("one");
          await paused;
          const available = await navigator.locks.request(
            "relayloom-profile:" + name,
            { ifAvailable: true },
            (lock) => lock !== null,
          );
          if (available)
            throw Error("private read did not retain its snapshot lock");
          const writer = profile.setValue("one", { n: 3 });
          release!();
          read = await pending;
          await writer;
        } finally {
          SubtleCrypto.prototype.decrypt = decrypt;
          release?.();
        }
        return {
          read: read.n,
          now: (await profile.getValue("one")).n,
          other: (await profile.getValue("two")).n,
          inventory: await profile.ids(),
        };
      } finally {
        profile.close();
        indexedDB.deleteDatabase(name);
      }
    });
    expect(result).toEqual({ read: 2, now: 3, other: 2, inventory: [] });
  } finally {
    await host.close();
  }
});
