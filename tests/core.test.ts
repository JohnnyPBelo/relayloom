import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createIdentity,
  validateIdentity,
  exportVault,
  importVault,
  createBundle,
  decryptBundle,
  verifyBundle,
  ContentStore,
  canonical,
  MAX_STORED_OBJECTS,
} from "../packages/core/src/index.js";
const alice = createIdentity("Alice"),
  bob = createIdentity("Bob"),
  eve = createIdentity("Eve");
test("identity proof binds signing address, name and decryption key", () => {
  assert.ok(validateIdentity(alice.public));
  assert.equal(
    validateIdentity({ ...alice.public, boxKey: eve.public.boxKey }),
    false,
  );
  assert.equal(validateIdentity({ ...alice.public, name: "Forgery" }), false);
});
test("vault encrypts private keys; recovery and wrong-password controls", () => {
  const vault = exportVault(alice, "correct horse battery staple");
  assert.equal(vault.includes(alice.signSecret), false);
  assert.deepEqual(importVault(vault, "correct horse battery staple"), alice);
  assert.throws(() => importVault(vault, "wrong password"));
  assert.throws(() => exportVault(alice, "short"));
});
test("reader decrypts and seeds but cannot become author; unauthorized reader fails", () => {
  const bundle = createBundle(
    alice,
    "message",
    { text: "Private evacuation note" },
    [bob.public],
  );
  assert.deepEqual(decryptBundle(bundle, bob), {
    text: "Private evacuation note",
  });
  assert.deepEqual(decryptBundle(bundle, alice), {
    text: "Private evacuation note",
  });
  assert.throws(() => decryptBundle(bundle, eve));
  const modified = structuredClone(bundle);
  modified.manifest.author = bob.public;
  assert.throws(() => verifyBundle(modified));
  assert.equal(bundle.manifest.author.id, alice.public.id);
});
test("ciphertext, manifest, expiry, depth and address negative controls", () => {
  const b = createBundle(alice, "post", { text: "public" }, "public");
  assert.deepEqual(decryptBundle(b), { text: "public" });
  const bad = structuredClone(b);
  const id = bad.manifest.chunks[0].hash;
  bad.chunks[id] = Buffer.from("corrupt").toString("base64");
  assert.throws(() => verifyBundle(bad));
  const forged = structuredClone(b);
  forged.manifest.expires = Date.now() - 100;
  assert.throws(() => verifyBundle(forged));
  let deep: unknown = {};
  for (let i = 0; i < 30; i++) deep = { deep };
  assert.throws(() => canonical(deep));
  assert.throws(() =>
    createBundle(alice, "post", "x".repeat(4 * 1024 * 1024 + 1), "public"),
  );
});
test("encrypted persistent seed takeover, deduplication, pin/quota, disk corruption", () => {
  const dir = mkdtempSync(join(process.cwd(), ".cache/core-"));
  try {
    let store = new ContentStore(dir, 12000);
    const b = createBundle(
      alice,
      "message",
      { secret: "not stored in plaintext" },
      [bob.public],
    );
    assert.equal(store.put(b, true), true);
    assert.equal(store.put(b), false);
    const path = join(dir, "objects", b.manifest.id + ".json");
    assert.ok(!readFileSync(path, "utf8").includes("not stored in plaintext"));
    store = new ContentStore(dir, 12000);
    assert.deepEqual(decryptBundle(store.get(b.manifest.id), bob), {
      secret: "not stored in plaintext",
    });
    assert.equal(store.isPinned(b.manifest.id), true);
    assert.throws(() => store.get("../../secret"));
    assert.throws(() =>
      store.put(
        createBundle(alice, "post", { t: "x".repeat(10000) }, "public"),
      ),
    );
    writeFileSync(path, "{}");
    assert.throws(() => store.get(b.manifest.id));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("object-count cap bounds small-object floods, survives restart and preserves pinned content", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const dir = mkdtempSync(join(process.cwd(), ".cache/core-cap-"));
  try {
    let store = new ContentStore(dir, 1024 * 1024, 3);
    const pinned = createBundle(
      alice,
      "post",
      { text: "Pinned original" },
      "public",
    );
    store.put(pinned, true);
    for (let i = 0; i < 12; i++) {
      t.mock.timers.tick(1);
      store.put(
        createBundle(bob, "post", { text: `Small item ${i}` }, "public"),
      );
      assert.ok(store.stats().count <= 3);
      assert.ok(store.has(pinned.manifest.id));
    }
    assert.equal(store.stats().maxObjects, 3);
    assert.ok(store.stats().bytes < store.quota / 10);
    store = new ContentStore(dir, 1024 * 1024, 3);
    assert.equal(store.list().length, 3);
    for (const manifest of store.list()) store.pin(manifest.id, true);
    const before = readFileSync(join(dir, "index.json"), "utf8");
    assert.throws(
      () =>
        store.put(
          createBundle(
            eve,
            "post",
            { text: "Cannot evict pinned entries" },
            "public",
          ),
        ),
      /fixados/,
    );
    assert.equal(readFileSync(join(dir, "index.json"), "utf8"), before);
    assert.equal(store.list().length, 3);
    assert.throws(() => new ContentStore(dir, 1024 * 1024, 2), /fixados/);
    assert.equal(readFileSync(join(dir, "index.json"), "utf8"), before);
    assert.throws(
      () => new ContentStore(dir, 1024 * 1024, MAX_STORED_OBJECTS + 1),
      /Limites/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("metadata listing does not replace real viewing order in LRU eviction", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const dir = mkdtempSync(join(process.cwd(), ".cache/core-lru-"));
  try {
    const store = new ContentStore(dir, 1024 * 1024, 2);
    const hot = createBundle(
      alice,
      "post",
      { text: "Frequently read" },
      "public",
    );
    store.put(hot);
    t.mock.timers.tick(1);
    const cold = createBundle(
      alice,
      "post",
      { text: "Never viewed" },
      "public",
    );
    store.put(cold);
    t.mock.timers.tick(1);
    store.get(hot.manifest.id);
    t.mock.timers.tick(1);
    assert.equal(store.list().length, 2);
    store.get(cold.manifest.id, false);
    t.mock.timers.tick(1);
    store.put(createBundle(alice, "post", { text: "New arrival" }, "public"));
    assert.ok(store.has(hot.manifest.id));
    assert.equal(store.has(cold.manifest.id), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("cached manifest metadata is isolated, invalidated by disk changes, and never bypasses get verification", () => {
  const dir = mkdtempSync(join(process.cwd(), ".cache/core-cache-"));
  try {
    const store = new ContentStore(dir),
      bundle = createBundle(
        alice,
        "post",
        { text: "Verified content" },
        "public",
      );
    store.put(bundle);
    const path = join(dir, "objects", bundle.manifest.id + ".json"),
      encoded = readFileSync(path, "utf8");
    const listed = store.list();
    listed[0].author.name = "Mutated cached identity";
    assert.equal(store.list()[0].author.name, alice.public.name);
    const corrupt = structuredClone(bundle),
      chunk = corrupt.manifest.chunks[0].hash;
    corrupt.chunks[chunk] =
      (corrupt.chunks[chunk][0] === "A" ? "B" : "A") +
      corrupt.chunks[chunk].slice(1);
    writeFileSync(path, canonical(corrupt));
    assert.deepEqual(
      store.list(),
      [],
      "content changes invalidate metadata even when filesystem timestamps repeat",
    );
    assert.throws(() => store.get(bundle.manifest.id), /corrompido/);
    assert.deepEqual(store.list(), []);
    writeFileSync(path, encoded);
    assert.equal(store.list()[0].id, bundle.manifest.id);
    assert.deepEqual(decryptBundle(store.get(bundle.manifest.id)), {
      text: "Verified content",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("rejected quota decrease preserves existing files and policy; feasible decrease evicts only unpinned content", () => {
  const dir = mkdtempSync(join(process.cwd(), ".cache/core-quota-"));
  try {
    const quota = 4 * 1024 * 1024,
      store = new ContentStore(dir, quota);
    const pinned = createBundle(
      alice,
      "post",
      { text: "p".repeat(1024 * 1024) },
      "public",
    );
    const unpinned = createBundle(
      alice,
      "post",
      { text: "u".repeat(768 * 1024) },
      "public",
    );
    store.put(pinned, true);
    store.put(unpinned);
    const before = readFileSync(join(dir, "index.json"), "utf8"),
      bytes = store.stats().bytes;
    assert.throws(() => store.setQuota(1024 * 1024), /fixados/);
    assert.equal(store.quota, quota);
    assert.equal(store.stats().bytes, bytes);
    assert.equal(readFileSync(join(dir, "index.json"), "utf8"), before);
    assert.equal(store.get(pinned.manifest.id).manifest.id, pinned.manifest.id);
    assert.equal(
      store.get(unpinned.manifest.id).manifest.id,
      unpinned.manifest.id,
    );
    assert.equal(new ContentStore(dir, quota).stats().count, 2);
    store.setQuota(2 * 1024 * 1024);
    assert.ok(store.has(pinned.manifest.id));
    assert.equal(store.has(unpinned.manifest.id), false);
    assert.equal(store.quota, 2 * 1024 * 1024);
    assert.ok(store.stats().bytes <= store.quota);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("invalid persisted index fails safely without deleting verified objects", () => {
  const dir = mkdtempSync(join(process.cwd(), ".cache/core-index-"));
  try {
    const store = new ContentStore(dir),
      bundle = createBundle(
        alice,
        "post",
        { text: "Keep recoverable data" },
        "public",
      );
    store.put(bundle, true);
    const path = join(dir, "objects", bundle.manifest.id + ".json"),
      bytes = readFileSync(path, "utf8");
    for (const malformed of ["null", "[]", "false"]) {
      writeFileSync(join(dir, "index.json"), malformed);
      assert.throws(() => new ContentStore(dir), /Índice/);
      assert.equal(readFileSync(path, "utf8"), bytes);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("strict wire fields and every recipient envelope are validated before accepting signatures", async () => {
  const { sign, createPrivateKey } = await import("node:crypto");
  const { hash } = await import("../packages/core/src/index.js");
  const original = createBundle(alice, "message", { text: "private" }, [
    bob.public,
  ]);
  const resign = (bundle: typeof original) => {
    const { id, signature, ...body } = bundle.manifest;
    const data = canonical(body);
    bundle.manifest.id = hash(data);
    bundle.manifest.signature = sign(
      null,
      Buffer.from(data),
      createPrivateKey({
        key: Buffer.from(alice.signSecret, "base64"),
        format: "der",
        type: "pkcs8",
      }),
    ).toString("base64");
    return bundle;
  };
  const extra = structuredClone(original);
  (extra.manifest as any).unexpected = true;
  assert.throws(() => verifyBundle(resign(extra)), /Manifesto/);
  const badOtherReader = structuredClone(original);
  badOtherReader.manifest.keys.find((k) => k.reader === bob.public.id)!.data =
    Buffer.alloc(31).toString("base64");
  assert.throws(() => decryptBundle(resign(badOtherReader), alice), /Envelope/);
  const wrongKey = structuredClone(original);
  wrongKey.manifest.keys[0].ephemeral = alice.public.signKey;
  assert.throws(() => verifyBundle(resign(wrongKey)), /Envelope/);
  const extraIdentity = { ...alice.public, unused: "not signed" };
  assert.equal(validateIdentity(extraIdentity), false);
  assert.deepEqual(decryptBundle(original, bob), { text: "private" });
});
