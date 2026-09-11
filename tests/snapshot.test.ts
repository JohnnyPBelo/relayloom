import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { LoomNode } from "../apps/node/src/node.js";
import {
  createBundle,
  createIdentity,
  canonical,
} from "../packages/core/src/index.js";
const password = "snapshot regression passphrase";
function local() {
  mkdirSync(".cache", { recursive: true });
  return new LoomNode(mkdtempSync(join(process.cwd(), ".cache/snapshot-")));
}

test(
  "large valid cache produces bounded pages and exact authorized attachments on demand",
  { timeout: 45000 },
  async () => {
    const node = local();
    try {
      const me = node.setup("Reader", password),
        author = createIdentity("Publisher");
      node.addContact(author.public);
      const data = Buffer.alloc(2 * 1024 * 1024, 97).toString("base64");
      let large = "";
      for (let i = 0; i < 12; i++) {
        const b = createBundle(
          author,
          "post",
          {
            type: "post",
            text: `Large ${i}`,
            attachments: [
              { name: "large.bin", mime: "application/octet-stream", data },
            ],
          },
          [me],
        );
        node.store.put(b);
        large = b.manifest.id;
      }
      for (let i = 0; i < 120; i++)
        node.store.put(
          createBundle(
            author,
            "post",
            { type: "post", text: `Post ${i}` },
            "public",
          ),
        );
      assert.ok(node.store.stats().bytes > 24 * 1024 * 1024);
      const state = node.state();
      assert.equal(state.history.total, 132);
      assert.equal(state.objects.length, 100);
      assert.ok(
        Buffer.byteLength(JSON.stringify(state)) < 4 * 1024 * 1024 + 200000,
      );
      const older = node.history(state.history.nextBefore!);
      assert.equal(older.objects.length, 32);
      assert.equal(older.history.hasMore, false);
      const ids = [...state.objects, ...older.objects].map((o) => o.id);
      assert.equal(new Set(ids).size, 132);
      const summary = older.objects.find((o) => o.id === large)!;
      assert.equal(summary.content.attachments![0].data, "");
      assert.equal(summary.content.attachments![0].size, 2 * 1024 * 1024);
      assert.equal(node.attachment(large, 0).data, data);
      assert.throws(() => node.attachment(large, 4));
      assert.throws(() => node.history("f".repeat(64)));
      node.lock();
      assert.throws(() => node.attachment(large, 0));
      assert.deepEqual(node.state().objects, []);
    } finally {
      await node.stop();
      rmSync(node.dir, { recursive: true, force: true });
    }
  },
);

test("received author deletion persists before evicting its original, and denied attachments stay unavailable", async () => {
  const node = local();
  try {
    const me = node.setup("Reader", password),
      author = createIdentity("Author");
    node.addContact(author.public);
    const original = createBundle(
      author,
      "post",
      {
        type: "post",
        text: "x".repeat(5000),
        attachments: [
          {
            name: "file.txt",
            mime: "text/plain",
            data: Buffer.from("private bytes").toString("base64"),
          },
        ],
      },
      [me],
    );
    node.store.put(original);
    node.store.quota = node.store.stats().bytes;
    const deletion = createBundle(
      author,
      "delete",
      { type: "delete", target: original.manifest.id },
      [me],
    );
    (node as any).receive(
      { type: "bundle", bundle: deletion },
      { medium: "tcp" },
    );
    assert.equal(node.store.has(original.manifest.id), false);
    node.store.put(original);
    assert.equal(
      node.objects().find((o) => o.id === original.manifest.id)?.deleted,
      true,
    );
    assert.throws(() => node.attachment(original.manifest.id, 0), /eliminado/);
  } finally {
    await node.stop();
    rmSync(node.dir, { recursive: true, force: true });
  }
});

test("request tracking is bounded even when transport rejects every broadcast", async () => {
  const node = local();
  try {
    node.setup("Bounded", password);
    node.router.broadcast = () => {
      throw new Error("saturated");
    };
    for (let batch = 0; batch < 600; batch++) {
      const ids = Array.from({ length: 8 }, (_, i) =>
        (batch * 8 + i).toString(16).padStart(64, "0"),
      );
      (node as any).receive({ type: "inventory", ids }, {});
      assert.ok((node as any).requests.size <= 2048);
    }
    for (let i = 0; i < 3000; i++) {
      try {
        node.retrieve((10000 + i).toString(16).padStart(64, "0"));
      } catch {}
      assert.ok((node as any).requests.size <= 2048);
    }
  } finally {
    await node.stop();
    rmSync(node.dir, { recursive: true, force: true });
  }
});

test("unknown post extension data does not crash or inflate summaries", async () => {
  const node = local();
  try {
    node.setup("Viewer", password);
    const author = createIdentity("Extensible author");
    const post = createBundle(
      author,
      "post",
      {
        type: "post",
        text: "Supported text",
        blocks: "ignored extension",
        theme: "x".repeat(2 * 1024 * 1024),
      },
      "public",
    );
    node.store.put(post);
    const state = node.state();
    assert.equal(state.objects.length, 1);
    assert.equal(state.objects[0].content.text, "Supported text");
    assert.equal(state.objects[0].content.blocks, undefined);
    assert.equal(state.objects[0].content.theme, undefined);
    assert.ok(JSON.stringify(state).length < 10000);
  } finally {
    await node.stop();
    rmSync(node.dir, { recursive: true, force: true });
  }
});

test("summary reuse remains bound to verified disk bytes and unlocked identity", async () => {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const node = local();
  try {
    node.setup("Reader", password);
    const post = node.publish({ type: "post", text: "Private cache text" }, []);
    assert.equal(node.objects()[0].content.text, "Private cache text");
    const returned = node.objects();
    returned[0].content.text = "mutation";
    assert.equal(node.objects()[0].content.text, "Private cache text");
    assert.ok((node as any).summaryCacheBytes <= 16 * 1024 * 1024);
    const file = join(node.dir, "store", "objects", post.id + ".json");
    const saved = readFileSync(file, "utf8");
    writeFileSync(file, "{}");
    assert.equal(node.objects().length, 0);
    assert.equal((node as any).summaryCacheBytes, 0);
    writeFileSync(file, saved);
    assert.equal(node.objects().length, 1);
    node.lock();
    assert.equal((node as any).summaryCache.size, 0);
    assert.equal(node.objects().length, 0);
  } finally {
    await node.stop();
    rmSync(node.dir, { recursive: true, force: true });
  }
});
