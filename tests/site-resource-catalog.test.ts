import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import {
  createIdentity,
  canonical,
  ContentStore,
  hash,
} from "../packages/core/src/index";
import { ProtectedGroupStore } from "../packages/groups/src/storage";
import { NodeResourceCatalog } from "../packages/sites/src/resource-catalog";
import { SitePrivateRecords } from "../packages/sites/src/private-storage";
import { projectTemp } from "./project-temp";
const content = {
  type: "site-resource",
  domain: "relayloom/site-resource/1",
  kind: "file",
  name: "Guia.txt",
  mime: "text/plain",
  data: Buffer.from("LOCAL_UNPUBLISHED_RESOURCE_603921").toString("base64"),
};
const request = (sequence = 1, ttlMs = 3600000) => ({
  sequence,
  operationId: randomUUID(),
  content,
  recipients: "public" as const,
  ttlMs,
});
function fixture() {
  const directory = projectTemp("resource-catalog-"),
    identity = createIdentity("Resource creator"),
    path = join(directory, "profile.sqlite");
  const database = new ProtectedGroupStore(path, identity, { create: true }),
    storeId = database.storeId();
  return { directory, identity, path, database, storeId };
}
test("resource preparation is encrypted, survives reopen and returns the same reference after a lost response", () => {
  const f = fixture();
  let database = f.database;
  try {
    let catalog = new NodeResourceCatalog(database, f.identity);
    const q = request(),
      first = catalog.prepare(q, () => "public"),
      bundle = catalog.authorizedBundle(first)!;
    assert.equal(first.phase, "copy-pending");
    assert.equal(new ContentStore(join(f.directory, "store")).list().length, 0);
    assert.equal(
      readFileSync(f.path).includes(Buffer.from(content.data)),
      false,
    );
    assert.equal(
      readFileSync(f.path).includes(
        Buffer.from("LOCAL_UNPUBLISHED_RESOURCE_603921"),
      ),
      false,
    );
    database.close();
    database = new ProtectedGroupStore(f.path, f.identity, {
      expectedStoreId: f.storeId,
    });
    catalog = new NodeResourceCatalog(database, f.identity);
    const retry = catalog.prepare(q, () => {
      throw Error("must not resolve readers or sign again");
    });
    assert.deepEqual(retry, first);
    assert.deepEqual(catalog.authorizedBundle(retry), bundle);
    const cache = new ContentStore(join(f.directory, "store"));
    cache.put(bundle);
    const ready = catalog.ready(retry, cache.get(bundle.manifest.id, false));
    assert.equal(ready.phase, "ready");
    assert.equal(catalog.authorizedBundle(ready), null);
    assert.deepEqual(
      catalog.prepare(q, () => {
        throw Error("not a new creation");
      }),
      ready,
    );
    assert.deepEqual(catalog.operation(q.sequence, q.operationId), {
      operation: ready,
      retired: false,
    });
    assert.equal(
      database.view((tx) =>
        tx.keys("resource:").some((k) => k.includes(":stage")),
      ),
      false,
    );
  } finally {
    database.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
test("resource quota failure rolls back counter and signatures, even when caught by an outer caller", () => {
  const directory = projectTemp("resource-quota-"),
    owner = createIdentity("Quota owner"),
    database = new ProtectedGroupStore(
      join(directory, "profile.sqlite"),
      owner,
      { create: true, limits: { totalBytes: 128 * 1024, reserveBytes: 8192 } },
    );
  try {
    const catalog = new NodeResourceCatalog(database, owner),
      q = request(),
      before = catalog.state();
    assert.throws(() =>
      catalog.prepare(
        {
          ...q,
          content: {
            ...content,
            data: Buffer.alloc(256 * 1024, 3).toString("base64"),
          },
        },
        () => "public",
      ),
    );
    assert.deepEqual(catalog.state(), before);
    assert.equal(
      database.view((tx) => tx.keys("resource:").length),
      0,
    );
    assert.equal(catalog.prepare(q, () => "public").sequence, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("a different copy cannot finish an operation or consume its pending signature", () => {
  const f = fixture();
  let database = f.database;
  try {
    let catalog = new NodeResourceCatalog(database, f.identity);
    const op = catalog.prepare(request(), () => "public"),
      bundle = catalog.authorizedBundle(op)!;
    const damaged = structuredClone(bundle);
    damaged.manifest.signature = "A".repeat(88);
    assert.throws(() => catalog.ready(op, damaged));
    database.close();
    database = new ProtectedGroupStore(f.path, f.identity, {
      expectedStoreId: f.storeId,
    });
    catalog = new NodeResourceCatalog(database, f.identity);
    assert.deepEqual(catalog.authorizedBundle(op), bundle);
    assert.equal(catalog.state().operations[0].phase, "copy-pending");
  } finally {
    database.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
test("expired preparation authenticates before disposal and never silently recreates the requested resource", async () => {
  const f = fixture();
  try {
    const catalog = new NodeResourceCatalog(f.database, f.identity),
      q = request(1, 1000),
      op = catalog.prepare(q, () => "public");
    await delay(1100);
    const recovered = catalog.prepare(q, () => {
      throw Error("expired request must not sign again");
    });
    assert.equal(recovered.phase, "expired");
    assert.equal(recovered.reference.bundleId, op.reference.bundleId);
    assert.equal(catalog.authorizedBundle(recovered), null);
    assert.equal(
      f.database.view((tx) =>
        tx.keys("resource:").some((k) => k.includes(":stage")),
      ),
      false,
    );
  } finally {
    f.database.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
test("a missing stage is corruption and is never interpreted as a fresh catalogue", () => {
  const f = fixture();
  let database = f.database;
  try {
    const catalog = new NodeResourceCatalog(database, f.identity);
    catalog.prepare(request(), () => "public");
    database.transaction((tx) =>
      SitePrivateRecords.runResource(tx, f.identity, (values) => {
        const key = tx.keys("resource:").find((k) => k.endsWith(":stage"))!;
        values.remove(key);
      }),
    );
    assert.throws(() => catalog.state(), /Preparação/);
  } finally {
    database.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
for (const mode of [
  "before-commit",
  "after-commit",
  "after-copy",
  "after-ready",
] as const)
  test(`real process exit ${mode} cannot duplicate or lose the resource creation identity`, () => {
    const f = fixture(),
      q = request(),
      control = join(f.directory, "control.json");
    let database = f.database;
    try {
      database.close();
      writeFileSync(
        control,
        JSON.stringify({
          directory: f.directory,
          identity: f.identity,
          storeId: f.storeId,
          request: q,
          mode,
        }),
        { mode: 0o600 },
      );
      const child = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "tests/fixtures/resource-catalog-worker.ts",
          control,
        ],
        { encoding: "utf8", timeout: 20000 },
      );
      assert.equal(
        child.status,
        {
          "before-commit": 71,
          "after-commit": 72,
          "after-copy": 73,
          "after-ready": 74,
        }[mode],
        child.stdout + child.stderr,
      );
      database = new ProtectedGroupStore(f.path, f.identity, {
        expectedStoreId: f.storeId,
      });
      const catalog = new NodeResourceCatalog(database, f.identity),
        cache = new ContentStore(join(f.directory, "store"));
      if (mode === "before-commit") {
        assert.equal(catalog.state().nextSequence, 1);
        assert.equal(cache.list().length, 0);
      } else {
        assert.equal(catalog.state().nextSequence, 2);
        assert.equal(catalog.state().operations.length, 1);
      }
      const saved = catalog.operation(1, q.operationId).operation;
      const op = catalog.prepare(q, () => {
        assert.equal(mode, "before-commit");
        return "public";
      });
      if (saved) assert.equal(op.reference.bundleId, saved.reference.bundleId);
      if (mode === "after-ready") assert.equal(op.phase, "ready");
      else {
        const bundle = catalog.authorizedBundle(op)!;
        cache.put(bundle);
        catalog.ready(op, cache.get(bundle.manifest.id, false));
      }
      assert.equal(cache.list().length, 1);
      assert.equal(catalog.state().operations[0].phase, "ready");
      assert.equal(
        hash(canonical(cache.get(op.reference.bundleId, false))),
        op.bundleHash,
      );
    } finally {
      database.close();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
