import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  createBundle,
  createIdentity,
  ContentStore,
  canonical,
} from "../packages/core/src/index";
import { projectTemp } from "./project-temp";

test("historical storage reads authenticate expired bytes without priming the live manifest cache", () => {
  const directory = projectTemp("historical-storage-"),
    owner = createIdentity("Autora"),
    store = new ContentStore(directory),
    bundle = createBundle(
      owner,
      "post",
      { type: "post", text: "Historical content" },
      "public",
      1000,
    ),
    clock = Date.now;
  try {
    store.put(bundle);
    Date.now = () => bundle.manifest.expires + 1;
    assert.equal(store.has(bundle.manifest.id), false);
    assert.equal(store.hasRecord(bundle.manifest.id), true);
    // Corrupt only the untrusted expiry hint and clear the old live cache.
    (store as any).index[bundle.manifest.id].expires = Date.now() + 60000;
    (store as any).manifests.clear();
    assert.deepEqual(store.getStored(bundle.manifest.id), bundle);
    assert.throws(() => store.get(bundle.manifest.id));
    assert.deepEqual(
      store.list(),
      [],
      "historical verification must never make expired data live",
    );
    const bad = structuredClone(bundle),
      key = bundle.manifest.chunks[0].hash;
    bad.chunks[key] = Buffer.from("corrupt ciphertext").toString("base64");
    writeFileSync(
      join(directory, "objects", bundle.manifest.id + ".json"),
      canonical(bad),
    );
    assert.throws(() => store.getStored(bundle.manifest.id));
    Date.now = clock;
    const live = createBundle(
      owner,
      "post",
      { type: "post", text: "Live control" },
      "public",
      60000,
    );
    store.put(live);
    assert.deepEqual(store.get(live.manifest.id), live);
    assert.deepEqual(
      store.list().map((m) => m.id),
      [live.manifest.id],
    );
  } finally {
    Date.now = clock;
    rmSync(directory, { recursive: true, force: true });
  }
});
