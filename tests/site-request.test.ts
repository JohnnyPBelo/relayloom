import { projectTemp } from "./project-temp";
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createIdentity,
  decryptBundle,
  canonical,
} from "../packages/core/src/index";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
import { browserCertificateCrypto } from "../packages/browser/src/certificate-crypto";
import { createSiteRequestProtocol } from "../packages/sites/src/request";
import { NodeSiteCatalog } from "../packages/sites/src/catalog";
import { ProtectedGroupStore } from "../packages/groups/src/storage";
const payload = () => ({
  type: "site" as const,
  blocks: [],
  theme: "sand" as const,
  site: {
    version: 1 as const,
    title: "Requested page",
    description: "An exact logical request",
    home: "home",
    design: {
      font: "sans" as const,
      width: "standard" as const,
      radius: "soft" as const,
      accent: "#207a70",
    },
    pages: [{ id: "home", slug: "inicio", title: "Início", blocks: [] }],
  },
});

test("logical site publication replays the same public or private result before and after staging retirement", () => {
  for (const privacy of ["public", "private"]) {
    const directory = projectTemp("site-request-"),
      owner = createIdentity("Logical owner"),
      reader = createIdentity("Logical reader");
    let store = new ProtectedGroupStore(
      join(directory, "private.sqlite"),
      owner,
      { create: true },
    );
    let catalog = new NodeSiteCatalog(store, owner);
    try {
      const state = catalog.state(owner.public.id, "profile");
      const request = {
        sequence: state.nextSequence!,
        operationId: randomUUID(),
        expectedBase: state.base,
        payload: payload(),
        readers: privacy === "public" ? ("public" as const) : [reader.public],
        ttlMs: 3600000,
      };
      const prepared = catalog.createPublication("profile", request);
      assert.equal(prepared.requested, true);
      assert.deepEqual(catalog.createPublication("profile", request), prepared);
      assert.throws(() =>
        catalog.createPublication("profile", { ...request, ttlMs: 7200000 }),
      );
      catalog.commit("profile", prepared);
      const bundle = catalog.authorizedBundle("profile", prepared);
      const content = decryptBundle(bundle, reader) as any;
      assert.equal(content.site.title, "Requested page");
      assert.equal(content.siteRevision.body.number, request.sequence);
      const id = store.storeId();
      store.close();
      store = new ProtectedGroupStore(
        join(directory, "private.sqlite"),
        owner,
        { expectedStoreId: id },
      );
      catalog = new NodeSiteCatalog(store, owner);
      assert.equal(
        catalog.createPublication("profile", request).bundleId,
        bundle.manifest.id,
      );
      catalog.markReady("profile", prepared);
      assert.equal(
        catalog.createPublication("profile", request).phase,
        "ready",
      );
      assert.equal(
        catalog.operation("profile", request.sequence, request.operationId)
          ?.bundleId,
        bundle.manifest.id,
      );
      assert.equal(catalog.state(owner.public.id, "profile").nextSequence, 2);
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("request fingerprints bind exact reading cards, base, lifetime and document consistently across crypto runtimes", () => {
  const owner = createIdentity("Request author"),
    reader = createIdentity("Reader"),
    newBox = createIdentity("New box");
  const raw = {
    sequence: 1,
    operationId: randomUUID(),
    expectedBase: "1".repeat(64),
    payload: payload(),
    readers: [reader.public],
    ttlMs: 60000,
  };
  const node = createSiteRequestProtocol(nodeCertificateCrypto),
    browser = createSiteRequestProtocol(browserCertificateCrypto);
  const expected = node.normalize(owner.public, "profile", raw);
  assert.deepEqual(browser.normalize(owner.public, "profile", raw), expected);
  assert.equal(
    node.normalize(owner.public, "profile", {
      ...raw,
      readers: [owner.public, reader.public, reader.public],
    }).fingerprint,
    expected.fingerprint,
  );
  const card = {
    id: reader.public.id,
    name: reader.public.name,
    signKey: reader.public.signKey,
    boxKey: newBox.public.boxKey,
  };
  const rotated = {
    ...card,
    proof: nodeCertificateCrypto.sign(reader, canonical(card)),
  };
  assert.notEqual(
    node.normalize(owner.public, "profile", { ...raw, readers: [rotated] })
      .fingerprint,
    expected.fingerprint,
  );
  assert.throws(() =>
    node.normalize(owner.public, "profile", {
      ...raw,
      readers: [reader.public, rotated],
    }),
  );
  for (const change of [
    { expectedBase: "2".repeat(64) },
    { ttlMs: 61000 },
    {
      payload: { ...payload(), site: { ...payload().site, title: "Changed" } },
    },
  ])
    assert.notEqual(
      node.normalize(owner.public, "profile", { ...raw, ...change })
        .fingerprint,
      expected.fingerprint,
    );
  for (const bad of [
    { ...raw, ttlMs: 999 },
    { ...raw, sequence: 0 },
    { ...raw, operationId: "invalid" },
    { ...raw, extra: true },
  ])
    assert.throws(() => node.normalize(owner.public, "profile", bad));
});
