import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createIdentity,
  createBundle,
  decryptBundle,
  canonical,
  ContentStore,
} from "../packages/core/src/index";
import { ProtectedGroupStore } from "../packages/groups/src/storage";
import { createSiteContentProtocol } from "../packages/sites/src/content";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
import { NodeSiteCatalog } from "../packages/sites/src/catalog";
const snapshots = createSiteContentProtocol(nodeCertificateCrypto);
const payload = (text = "A private preparation") => ({
  type: "site",
  blocks: [],
  theme: "sand",
  site: {
    version: 1,
    title: "A persistent site",
    description: "A real snapshot",
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
        blocks: [{ id: "body", type: "text", title: "Content", body: text }],
      },
    ],
  },
});
function fixture(limits?: { totalBytes: number; reserveBytes: number }) {
  const dir = mkdtempSync(join(resolve(".cache/tmp"), "site-catalog-")),
    owner = createIdentity("Catalog owner"),
    path = join(dir, "private.sqlite");
  let store = new ProtectedGroupStore(path, owner, {
    create: true,
    ...(limits ? { limits } : {}),
  });
  let catalog = new NodeSiteCatalog(store, owner);
  return {
    dir,
    owner,
    get catalog() {
      return catalog;
    },
    get store() {
      return store;
    },
    restart() {
      const id = store.storeId();
      store.close();
      store = new ProtectedGroupStore(path, owner, { expectedStoreId: id });
      catalog = new NodeSiteCatalog(store, owner);
    },
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
function command(
  f: ReturnType<typeof fixture>,
  name = "profile",
  text = "Original",
  ttl = 86400_000,
) {
  const view = f.catalog.state(f.owner.public.id, name);
  const content = snapshots.create(
    f.owner,
    name,
    view.nextSequence!,
    view.heads
      .map((h) => h.id)
      .sort()
      .slice(0, 16),
    payload(text),
  );
  return {
    expectedBase: view.base,
    operationId: randomUUID(),
    bundle: createBundle(f.owner, "site", content, "public", ttl),
  };
}

test("catalog atomically persists preparation, authorization and exact public-copy recovery across database restart", () => {
  const f = fixture();
  try {
    const input = command(f),
      content = new ContentStore(join(f.dir, "content"));
    const prepared = f.catalog.prepare("profile", input);
    assert.equal(prepared.phase, "prepared");
    assert.equal(content.list().length, 0);
    assert.equal(f.catalog.state(f.owner.public.id, "profile").status, "empty");
    assert.equal(canonical(f.catalog.pending()).includes("signature"), false);
    assert.throws(() => f.catalog.authorizedBundle("profile", prepared));
    f.restart();
    assert.deepEqual(f.catalog.prepare("profile", input), prepared);
    const committed = f.catalog.commit("profile", prepared);
    assert.equal(committed.phase, "committed");
    assert.equal(f.catalog.state(f.owner.public.id, "profile").number, 1);
    assert.deepEqual(
      f.catalog.state(f.owner.public.id, "profile").bundleHints[0].bundles,
      [],
    );
    f.restart();
    assert.equal(f.catalog.cancel("profile", prepared).phase, "committed");
    const recovered = f.catalog.authorizedBundle("profile", prepared);
    assert.deepEqual(recovered, input.bundle);
    content.put(recovered, true);
    assert.deepEqual(content.get(prepared.bundleId), recovered);
    assert.equal(f.catalog.markReady("profile", prepared).phase, "ready");
    f.restart();
    assert.deepEqual(f.catalog.pending(), []);
    assert.deepEqual(
      f.catalog.state(f.owner.public.id, "profile").bundleHints[0].bundles,
      [prepared.bundleId],
    );
    assert.equal(f.catalog.prepare("profile", input).phase, "ready");
  } finally {
    f.close();
  }
});

test("another signed head appearing before authorization supersedes a private preparation without publishing it", () => {
  const f = fixture();
  try {
    const first = command(f),
      rival = command(f, "profile", "Other device"),
      prepared = f.catalog.prepare("profile", first);
    f.catalog.observe(rival.bundle, "profile");
    assert.equal(f.catalog.commit("profile", prepared).phase, "superseded");
    assert.throws(() => f.catalog.authorizedBundle("profile", prepared));
    assert.equal(f.catalog.state(f.owner.public.id, "profile").heads.length, 1);
    assert.deepEqual(
      f.catalog.state(f.owner.public.id, "profile").bundleHints[0].bundles,
      [rival.bundle.manifest.id],
    );
    assert.deepEqual(f.catalog.pending(), []);
    const next = command(f, "profile", "Next");
    assert.equal(f.catalog.prepare("profile", next).sequence, 2);
  } finally {
    f.close();
  }
});

test("staging capacity failure cannot leave a catalog entry, partial bundle or changed prior operation", () => {
  const f = fixture({ totalBytes: 64 * 1024, reserveBytes: 8192 });
  try {
    const first = command(f),
      prepared = f.catalog.prepare("profile", first);
    const view = f.catalog.state(f.owner.public.id, "other"),
      large = payload();
    large.site.pages[0].blocks = Array.from({ length: 24 }, (_, i) => ({
      id: "b" + i,
      type: "text",
      title: "Bounded",
      body: "x".repeat(4000),
    }));
    const content = snapshots.create(f.owner, "other", 1, [], large);
    const next = {
      expectedBase: view.base,
      operationId: randomUUID(),
      bundle: createBundle(f.owner, "site", content, "public"),
    };
    assert.throws(() => f.catalog.prepare("other", next));
    assert.equal(f.catalog.state(f.owner.public.id, "other").status, "empty");
    assert.deepEqual(f.catalog.pending(), [{ name: "profile", ...prepared }]);
    assert.equal(f.catalog.cancel("profile", prepared).phase, "cancelled");
    f.restart();
    assert.equal(f.catalog.state(f.owner.public.id, "profile").nextSequence, 2);
  } finally {
    f.close();
  }
});

test("expired preparations remain recoverable as terminal outcomes without treating the profile as corrupt", () => {
  for (const authorize of [false, true]) {
    const originalNow = Date.now,
      start = originalNow();
    let now = start;
    Date.now = () => now;
    const f = fixture();
    try {
      const input = command(f, "profile", "Short lived", 1000),
        prepared = f.catalog.prepare("profile", input);
      const neverPrepared = command(f, "unused", "Also short lived", 1000);
      if (authorize) f.catalog.commit("profile", prepared);
      now = input.bundle.manifest.expires + 1;
      f.restart();
      const view = f.catalog.state(f.owner.public.id, "profile");
      assert.deepEqual(view.pending, []);
      assert.equal(view.nextSequence, 2);
      assert.equal(view.number, authorize ? 1 : 0);
      assert.equal(f.catalog.commit("profile", prepared).phase, "expired");
      assert.equal(f.catalog.prepare("profile", input).phase, "expired");
      assert.throws(() => f.catalog.prepare("unused", neverPrepared));
      assert.equal(
        f.catalog.state(f.owner.public.id, "unused").nextSequence,
        1,
      );
      assert.throws(() => f.catalog.authorizedBundle("profile", prepared));
      assert.equal(
        f.catalog.prepare("other", command(f, "other")).phase,
        "prepared",
      );
    } finally {
      f.close();
      Date.now = originalNow;
    }
  }
});

test("public retries recover the exact first envelope; private retries cannot silently change a reading envelope", () => {
  const f = fixture();
  try {
    const first = command(f),
      prepared = f.catalog.prepare("profile", first);
    const document = snapshots.verify(
      decryptBundle(first.bundle),
      f.owner.public,
    ).content;
    const replacement = {
      ...first,
      bundle: createBundle(f.owner, "site", document, "public"),
    };
    assert.notEqual(replacement.bundle.manifest.id, first.bundle.manifest.id);
    assert.equal(
      f.catalog.prepare("profile", replacement).bundleId,
      prepared.bundleId,
    );
    f.catalog.cancel("profile", prepared);
    const state = f.catalog.state(f.owner.public.id, "private");
    const content = snapshots.create(f.owner, "private", 1, [], payload());
    const request = {
      expectedBase: state.base,
      operationId: randomUUID(),
      bundle: createBundle(f.owner, "site", content, [f.owner.public]),
    };
    const privatePrepared = f.catalog.prepare("private", request);
    assert.deepEqual(f.catalog.prepare("private", request), privatePrepared);
    assert.throws(() =>
      f.catalog.prepare("private", {
        ...request,
        bundle: createBundle(f.owner, "site", content, [f.owner.public]),
      }),
    );
    assert.equal(
      f.catalog.cancel("private", privatePrepared).phase,
      "cancelled",
    );
  } finally {
    f.close();
  }
});

test("repeated verified observations do not rewrite the encrypted catalog", () => {
  const f = fixture();
  try {
    const input = command(f);
    f.catalog.observe(input.bundle, "profile");
    const before = f.store.accounting().revision;
    for (let i = 0; i < 8; i++) f.catalog.observe(input.bundle, "profile");
    assert.equal(f.store.accounting().revision, before);
  } finally {
    f.close();
  }
});
