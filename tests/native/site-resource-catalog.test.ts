import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import {
  createIdentity,
  ContentStore,
  canonical,
  hash,
  decryptBundle,
} from "../../packages/core/src/index";
import { ProtectedGroupStore } from "../../packages/groups/src/storage";
import { NodeResourceCatalog } from "../../packages/sites/src/resource-catalog";
import { projectTemp } from "../project-temp";
let executable: string;
function binary() {
  if (executable) return executable;
  const directory = resolve(".cache/resource-catalog-native");
  mkdirSync(directory, { recursive: true });
  executable = join(
    directory,
    process.platform === "win32" ? "catalog.test.exe" : "catalog.test",
  );
  const result = spawnSync(
    process.execPath,
    [
      "scripts/go.mjs",
      "test",
      "-c",
      "-race",
      "-p=1",
      "-o",
      executable,
      "./sites",
    ],
    { encoding: "utf8", timeout: 120000, maxBuffer: 128 * 1024 },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return executable;
}
const content = {
  type: "site-resource",
  domain: "relayloom/site-resource/1",
  kind: "file",
  name: "Dados 🧶 \ud800.txt",
  mime: "text/plain",
  data: Buffer.from("Persisted resource payload").toString("base64"),
};
const request = (sequence = 1, recipients: any = "public") => ({
  sequence,
  operationId: randomUUID(),
  content,
  recipients,
  ttlMs: 3600000,
});
function worker(
  directory: string,
  identity: any,
  storeId: string,
  commands: unknown[],
  extra: Record<string, unknown> = {},
) {
  const control = join(directory, "control.json"),
    output = join(directory, "output.json");
  writeFileSync(
    control,
    JSON.stringify({
      database: join(directory, "profile.sqlite"),
      identity,
      storeId,
      commands,
      output,
      ...extra,
    }),
    { mode: 0o600 },
  );
  const result = spawnSync(
    binary(),
    ["-test.run=^TestResourceCatalogWorker$", "-test.v"],
    {
      env: { ...process.env, RELAYLOOM_RESOURCE_CATALOG_CONTROL: control },
      encoding: "utf8",
      timeout: 20000,
      maxBuffer: 128 * 1024,
    },
  );
  return { result, output };
}
test("Node and Go resume each other's resource operation on one signing-protected SQLite database", () => {
  const directory = projectTemp("resource-catalog-mixed-"),
    owner = createIdentity("Shared resource owner"),
    reader = createIdentity("Private resource reader"),
    path = join(directory, "profile.sqlite");
  let database = new ProtectedGroupStore(path, owner, { create: true });
  const storeId = database.storeId();
  try {
    let catalog = new NodeResourceCatalog(database, owner);
    const q = request(1, [owner.public.id, reader.public.id].sort()),
      prepared = catalog.prepare(q, () => [owner.public, reader.public]),
      bundle = catalog.authorizedBundle(prepared)!;
    database.close();
    const first = worker(
      directory,
      owner,
      storeId,
      [
        { action: "prepare", request: q },
        { action: "bundle", handle: prepared },
        { action: "ready", handle: prepared, bundle },
      ],
      { denyResolver: true },
    );
    assert.equal(
      first.result.status,
      0,
      first.result.stdout + first.result.stderr,
    );
    const results = JSON.parse(readFileSync(first.output, "utf8"));
    assert.deepEqual(results[0], prepared);
    assert.deepEqual(results[1], bundle);
    assert.equal(results[2].phase, "ready");
    const q2 = request(2),
      second = worker(directory, owner, storeId, [
        { action: "prepare", request: q2 },
        { action: "state" },
      ]);
    assert.equal(
      second.result.status,
      0,
      second.result.stdout + second.result.stderr,
    );
    const [goPrepared] = JSON.parse(readFileSync(second.output, "utf8"));
    database = new ProtectedGroupStore(path, owner, {
      expectedStoreId: storeId,
    });
    catalog = new NodeResourceCatalog(database, owner);
    assert.deepEqual(
      catalog.prepare(q2, () => {
        throw Error("must recover Go signature");
      }),
      goPrepared,
    );
    const fromGo = catalog.authorizedBundle(goPrepared)!;
    assert.deepEqual(decryptBundle(fromGo), content);
    assert.equal(hash(canonical(fromGo)), goPrepared.bundleHash);
    const store = new ContentStore(join(directory, "store"));
    store.put(fromGo);
    assert.equal(
      catalog.ready(goPrepared, store.get(fromGo.manifest.id, false)).phase,
      "ready",
    );
    assert.equal(catalog.state().nextSequence, 3);
    assert.equal(
      catalog.operation(1, q.operationId).operation!.reference.bundleId,
      bundle.manifest.id,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
for (const mode of [
  "before-commit",
  "after-commit",
  "after-copy",
  "after-ready",
] as const)
  test(`Node recovers an exact resource after Go exits ${mode}`, () => {
    const directory = projectTemp("resource-go-exit-"),
      owner = createIdentity("Process resource owner"),
      path = join(directory, "profile.sqlite"),
      q = request();
    let database = new ProtectedGroupStore(path, owner, { create: true });
    const storeId = database.storeId();
    try {
      database.close();
      const attempt = worker(
        directory,
        owner,
        storeId,
        [{ action: "create-copy", request: q }],
        { mode },
      );
      assert.equal(
        attempt.result.status,
        {
          "before-commit": 81,
          "after-commit": 82,
          "after-copy": 83,
          "after-ready": 84,
        }[mode],
        attempt.result.stdout + attempt.result.stderr,
      );
      database = new ProtectedGroupStore(path, owner, {
        expectedStoreId: storeId,
      });
      const catalog = new NodeResourceCatalog(database, owner),
        store = new ContentStore(join(directory, "store"));
      const previous = catalog.operation(1, q.operationId).operation;
      const op = catalog.prepare(q, () => {
        assert.equal(mode, "before-commit");
        return "public";
      });
      if (previous)
        assert.equal(previous.reference.bundleId, op.reference.bundleId);
      if (op.phase === "copy-pending") {
        const bundle = catalog.authorizedBundle(op)!;
        store.put(bundle);
        catalog.ready(op, store.get(bundle.manifest.id, false));
      }
      assert.equal(catalog.state().nextSequence, 2);
      assert.equal(catalog.state().operations[0].phase, "ready");
      assert.equal(store.list().length, 1);
      assert.deepEqual(
        decryptBundle(store.get(op.reference.bundleId, false)),
        content,
      );
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
