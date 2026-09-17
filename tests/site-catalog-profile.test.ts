import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  canonical,
  hash,
  createIdentity,
  createBundle,
} from "../packages/core/src/index";
import { ProfileDatabase } from "../packages/profile/src/database";
import { ProfileOwnership } from "../packages/profile/src/ownership";
import {
  readPrivateState,
  writePrivateState,
} from "../apps/node/src/local-state";
import { NodeSiteCatalog } from "../packages/sites/src/catalog";
import { createSiteContentProtocol } from "../packages/sites/src/content";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";

test("site transactions share the real bound application profile without changing its existing private state", () => {
  const dir = mkdtempSync(join(resolve(".cache/tmp"), "site-bound-profile-")),
    owner = createIdentity("Bound profile owner"),
    legacyPath = join(dir, "private-state.json");
  const lease = new ProfileOwnership(dir);
  let db: ProfileDatabase | undefined;
  try {
    writePrivateState(
      legacyPath,
      {
        mutations: {},
        siteDraft: {
          blocks: [
            {
              id: "old",
              type: "text",
              title: "Existing draft",
              body: "Preserve this draft",
            },
          ],
          theme: "sand",
          savedAt: Date.now(),
        },
      },
      owner,
    );
    const load = () => ({
      bytes: Buffer.from(canonical(readPrivateState(legacyPath, owner))),
      sourceDigest: hash(readFileSync(legacyPath)),
    });
    db = ProfileDatabase.open(dir, owner, load);
    const before = db.read();
    const catalog = new NodeSiteCatalog(db, owner);
    const view = catalog.state(owner.public.id, "profile");
    const content = createSiteContentProtocol(nodeCertificateCrypto).create(
      owner,
      "profile",
      1,
      [],
      {
        type: "site",
        blocks: [],
        theme: "sand",
        site: {
          version: 1,
          title: "Profile integration",
          description: "Unchanged existing draft",
          home: "home",
          design: {
            font: "sans",
            width: "standard",
            radius: "soft",
            accent: "#207a70",
          },
          pages: [{ id: "home", slug: "inicio", title: "Início", blocks: [] }],
        },
      },
    );
    const request = {
      expectedBase: view.base,
      operationId: randomUUID(),
      bundle: createBundle(owner, "site", content, "public"),
    };
    const prepared = catalog.prepare("profile", request);
    catalog.commit("profile", prepared);
    assert.deepEqual(db.read(), before);
    db.close();
    db = ProfileDatabase.open(dir, owner, () => {
      throw Error("Committed profile must never reload the legacy state");
    });
    const resumed = new NodeSiteCatalog(db, owner);
    assert.deepEqual(
      resumed.authorizedBundle("profile", prepared),
      request.bundle,
    );
    assert.deepEqual(db.read(), before);
  } finally {
    db?.close();
    lease.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
