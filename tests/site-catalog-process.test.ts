import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  createIdentity,
  createBundle,
  ContentStore,
} from "../packages/core/src/index";
import { ProtectedGroupStore } from "../packages/groups/src/storage";
import { NodeSiteCatalog } from "../packages/sites/src/catalog";
import { createSiteContentProtocol } from "../packages/sites/src/content";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
const payload = {
  type: "site",
  blocks: [],
  theme: "sand",
  site: {
    version: 1,
    title: "Process recovery",
    description: "Owned process fixture",
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
const snapshots = createSiteContentProtocol(nodeCertificateCrypto);

for (const mode of [
  "prepare-before",
  "prepare-after",
  "commit-before",
  "commit-after",
  "copy",
]) {
  test(
    "actual process interruption at site " +
      mode +
      " preserves the publication boundary",
    () => {
      const dir = mkdtempSync(join(resolve(".cache/tmp"), "site-process-")),
        owner = createIdentity("Process author");
      let store: ProtectedGroupStore | undefined = new ProtectedGroupStore(
        join(dir, "private.sqlite"),
        owner,
        { create: true },
      );
      try {
        let catalog = new NodeSiteCatalog(store, owner);
        const state = catalog.state(owner.public.id, "profile"),
          content = snapshots.create(owner, "profile", 1, [], payload);
        const request = {
          expectedBase: state.base,
          operationId: randomUUID(),
          bundle: createBundle(owner, "site", content, "public"),
        };
        let handle = mode.startsWith("prepare")
          ? undefined
          : catalog.prepare("profile", request);
        if (mode === "copy") catalog.commit("profile", handle!);
        const storeId = store.storeId(),
          control = join(dir, "control.json");
        writeFileSync(
          control,
          JSON.stringify({
            directory: dir,
            owner,
            storeId,
            request,
            ...(handle ? { handle } : {}),
          }),
          { mode: 0o600 },
        );
        store.close();
        store = undefined;
        const child = spawnSync(
          process.execPath,
          [
            "--import",
            "tsx",
            resolve("tests/fixtures/site-catalog-worker.ts"),
            control,
            mode,
          ],
          {
            cwd: resolve("."),
            timeout: 15000,
            maxBuffer: 64 * 1024,
            encoding: "utf8",
          },
        );
        assert.equal(child.error, undefined);
        assert.equal(child.signal, null);
        assert.equal(
          child.status,
          mode === "copy" ? 75 : mode.endsWith("-before") ? 73 : 74,
          "owned child must reach the intended exit boundary",
        );
        store = new ProtectedGroupStore(join(dir, "private.sqlite"), owner, {
          expectedStoreId: storeId,
        });
        catalog = new NodeSiteCatalog(store, owner);
        const pending = catalog.pending();
        assert.equal(pending.length, mode === "prepare-before" ? 0 : 1);
        if (pending.length)
          assert.equal(
            pending[0].phase,
            ["commit-after", "copy"].includes(mode) ? "committed" : "prepared",
          );
        const publicStore = new ContentStore(join(dir, "public-copy"));
        assert.equal(publicStore.list().length, mode === "copy" ? 1 : 0);
        handle = catalog.prepare("profile", request);
        assert.equal(handle.sequence, 1);
        assert.equal(handle.bundleId, request.bundle.manifest.id);
        catalog.commit("profile", handle);
        const approved = catalog.authorizedBundle("profile", handle);
        assert.deepEqual(approved, request.bundle);
        publicStore.put(approved, true);
        assert.equal(publicStore.list().length, 1);
        catalog.markReady("profile", handle);
        assert.equal(catalog.state(owner.public.id, "profile").number, 1);
        assert.equal(catalog.state(owner.public.id, "profile").nextSequence, 2);
        assert.deepEqual(catalog.pending(), []);
      } finally {
        store?.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
}
