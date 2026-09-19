import { createBundle, createIdentity } from "../packages/core/src/index";
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { LoomNode } from "../apps/node/src/node";
import {
  ResourceCreator,
  formatResourceBytes,
  loadResourceLibrary,
} from "../apps/web/src/site/resources";
import { projectTemp } from "./project-temp";
import type { SiteResource } from "../packages/content/src/site-resource";
const content: SiteResource = {
  type: "site-resource",
  domain: "relayloom/site-resource/1",
  kind: "file",
  name: "Nota.txt",
  mime: "text/plain",
  data: "Zg==",
};
async function fixture() {
  const dir = projectTemp("resource-controller-"),
    node = new LoomNode(dir);
  await node.start(-1);
  const owner = node.setup("Autora", "resource UI controller passphrase");
  const api = async (path: string, body?: any) => {
    if (path === "resource-command") return node.resourceCommand(body);
    if (path === "history") return node.history(body?.before);
    throw Error("unexpected API path");
  };
  return {
    node,
    owner,
    api,
    async close() {
      await node.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("resource UI controller recovers a lost committed reply without creating another signature", async () => {
  const f = await fixture();
  const creates: any[] = [];
  try {
    const controller = new ResourceCreator(
      async (path, body: any) => {
        const result = await f.api(path, body);
        if (body?.action === "create") {
          creates.push(structuredClone(body));
          throw Error("lost response after durable copy");
        }
        return result;
      },
      f.owner.id,
      () => true,
    );
    const result = await controller.create(content, "public", 60000);
    assert.equal(result.operation.phase, "ready");
    assert.equal(creates.length, 1);
    assert.equal(controller.uncertain, false);
    const reopened = new ResourceCreator(f.api, f.owner.id, () => true);
    assert.equal((await reopened.state()).operations.length, 1);
    const entries = await loadResourceLibrary(f.api, () => true);
    assert.equal(entries.length, 1);
    assert.equal(
      entries[0].reference.bundleId,
      result.operation.reference.bundleId,
    );
    assert.equal(entries[0].author.id, f.owner.id);
  } finally {
    await f.close();
  }
});
test("resource UI retries an unconfirmed request only on explicit action and with the same UUID and payload", async () => {
  const f = await fixture();
  const creates: any[] = [];
  let lose = true;
  try {
    const controller = new ResourceCreator(
      async (path, body: any) => {
        if (body?.action === "create") {
          creates.push(structuredClone(body));
          if (lose) {
            lose = false;
            throw Error("request never arrived");
          }
        }
        return f.api(path, body);
      },
      f.owner.id,
      () => true,
    );
    await assert.rejects(
      controller.create(content, "public", 60000),
      /never arrived/,
    );
    assert.equal(controller.uncertain, true);
    assert.equal(creates.length, 1);
    await assert.rejects(
      controller.create({ ...content, name: "Another.txt" }, "public", 60000),
    );
    assert.equal(creates.length, 1);
    const retried = await controller.retry();
    assert.equal(retried.operation.phase, "ready");
    assert.deepEqual(creates[1], creates[0]);
    assert.equal(
      f.node.store.list().filter((m) => m.kind === "site-resource").length,
      1,
    );
  } finally {
    await f.close();
  }
});
test("closing a resource UI session fences an in-flight result while the durable library remains recoverable", async () => {
  const f = await fixture();
  let active = true;
  try {
    const controller = new ResourceCreator(
      async (path, body: any) => {
        const value = await f.api(path, body);
        if (body?.action === "create") active = false;
        return value;
      },
      f.owner.id,
      () => active,
    );
    await assert.rejects(
      controller.create(content, "public", 60000),
      /encerrada/,
    );
    const fresh = new ResourceCreator(f.api, f.owner.id, () => true);
    assert.equal((await fresh.state()).operations.length, 1);
    assert.equal((await loadResourceLibrary(f.api, () => true)).length, 1);
  } finally {
    await f.close();
  }
});

test("resource library walks real history beyond the operation journal and retains third-party creators", async () => {
  const f = await fixture(),
    other = createIdentity("Autora externa");
  try {
    const ids = [];
    for (let i = 0; i < 137; i++) {
      const bundle = createBundle(
        other,
        "site-resource",
        { ...content, name: "Arquivo " + i + ".txt" },
        "public",
        60000,
      );
      f.node.store.put(bundle);
      ids.push(bundle.manifest.id);
    }
    assert.equal(
      (await new ResourceCreator(f.api, f.owner.id, () => true).state())
        .operations.length,
      0,
    );
    let calls = 0;
    const entries = await loadResourceLibrary(
      async (path, body) => {
        calls++;
        return f.api(path, body);
      },
      () => true,
    );
    assert.equal(calls, 2);
    assert.equal(entries.length, 137);
    assert.deepEqual(
      new Set(entries.map((e) => e.reference.bundleId)),
      new Set(ids),
    );
    assert.ok(
      entries.every(
        (e) =>
          e.author.id === other.public.id &&
          e.reference.authorId === other.public.id,
      ),
    );
  } finally {
    await f.close();
  }
});

test("resource sizes never round a nonempty small file down to zero", () => {
  assert.equal(formatResourceBytes(0, "en-GB"), "0 B");
  assert.equal(formatResourceBytes(43, "en-GB"), "43 B");
  assert.equal(formatResourceBytes(1024, "en-GB"), "1 KiB");
  assert.equal(formatResourceBytes(1536, "pt-PT"), "1,5 KiB");
  assert.equal(formatResourceBytes(2 * 1024 * 1024, "en-GB"), "2 MiB");
});
