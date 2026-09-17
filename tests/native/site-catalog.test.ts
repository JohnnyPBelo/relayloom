import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { projectTemp } from "../project-temp";
import {
  createIdentity,
  canonical,
  decryptBundle,
} from "../../packages/core/src/index";
import { ProtectedGroupStore } from "../../packages/groups/src/storage";
import { NodeSiteCatalog } from "../../packages/sites/src/catalog";
const payload = (title: string) => ({
  type: "site" as const,
  blocks: [],
  theme: "sand" as const,
  site: {
    version: 1 as const,
    title,
    description: "Shared catalog across runtimes",
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

test("Node and Go resume each other's logical publication on the same encrypted profile database", () => {
  const directory = projectTemp("catalog-mixed-"),
    owner = createIdentity("Catalog mixed 😀 \ud800"),
    reader = createIdentity("Private reader"),
    path = join(directory, "profile.sqlite");
  let store = new ProtectedGroupStore(path, owner, { create: true });
  let catalog = new NodeSiteCatalog(store, owner);
  const storeId = store.storeId();
  const cache = resolve(".cache/site-catalog-mixed");
  mkdirSync(cache, { recursive: true });
  const executable = join(
    cache,
    process.platform === "win32" ? "catalog.test.exe" : "catalog.test",
  );
  const build = spawnSync(
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
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const run = (commands: unknown[]) => {
    const output = join(directory, "output.json"),
      input = join(directory, "input.json");
    writeFileSync(
      input,
      JSON.stringify({
        database: path,
        storeId,
        identity: owner,
        commands,
        output,
      }),
      { mode: 0o600 },
    );
    const result = spawnSync(
      executable,
      ["-test.run=^TestCatalogInteropWorker$", "-test.v"],
      {
        cwd: resolve("native/sites"),
        env: { ...process.env, RELAYLOOM_SITE_CATALOG_INPUT: input },
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 128 * 1024,
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return JSON.parse(readFileSync(output, "utf8"));
  };
  try {
    const state = catalog.state(owner.public.id, "profile");
    const first = {
      sequence: 1,
      operationId: randomUUID(),
      expectedBase: state.base,
      payload: payload("Node preparation"),
      readers: [reader.public],
      ttlMs: 3600000,
    };
    const prepared = catalog.createPublication("profile", first),
      before = catalog.state(owner.public.id, "profile");
    store.close();
    const received = run([
      { action: "state", name: "profile" },
      { action: "commit", name: "profile", handle: prepared },
      { action: "bundle", name: "profile", handle: prepared },
    ]);
    assert.deepEqual(received[0], before);
    assert.equal(received[1].phase, "committed");
    assert.equal(received[2].manifest.id, prepared.bundleId);
    assert.equal(
      (decryptBundle(received[2], reader) as any).site.title,
      "Node preparation",
    );
    store = new ProtectedGroupStore(path, owner, { expectedStoreId: storeId });
    catalog = new NodeSiteCatalog(store, owner);
    assert.equal(
      catalog.createPublication("profile", first).phase,
      "committed",
    );
    catalog.markReady("profile", prepared);
    const next = catalog.state(owner.public.id, "profile");
    const second = {
      sequence: next.nextSequence!,
      operationId: randomUUID(),
      expectedBase: next.base,
      payload: payload("Go preparation"),
      readers: [reader.public],
      ttlMs: 3600000,
    };
    store.close();
    const [made] = run([
      { action: "create", name: "profile", request: second },
    ]);
    assert.equal(made.phase, "prepared");
    store = new ProtectedGroupStore(path, owner, { expectedStoreId: storeId });
    catalog = new NodeSiteCatalog(store, owner);
    assert.equal(
      catalog.createPublication("profile", second).bundleId,
      made.bundleId,
    );
    catalog.commit("profile", made);
    const bundle = catalog.authorizedBundle("profile", made);
    assert.equal(
      (decryptBundle(bundle, reader) as any).site.title,
      "Go preparation",
    );
    store.close();
    const [ready, latest] = run([
      { action: "ready", name: "profile", handle: made },
      { action: "state", name: "profile" },
    ]);
    assert.equal(ready.phase, "ready");
    assert.equal(latest.number, 2);
    assert.equal(latest.nextSequence, 3);
    writeFileSync(
      join(cache, "report.json"),
      canonical({
        status: "PASS",
        nodeToGo: true,
        goToNode: true,
        privateReaderVerified: true,
        originalRevision: prepared.bundleId,
        secondRevision: made.bundleId,
      }) + "\n",
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
