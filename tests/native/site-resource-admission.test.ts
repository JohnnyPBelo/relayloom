import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createBundle,
  createIdentity,
  verifyBundle,
} from "../../packages/core/src/index";
import { Router } from "../../packages/transport/src/index";
import { launch, password, until } from "../helpers";
const file = {
  type: "site-resource",
  domain: "relayloom/site-resource/1",
  kind: "file",
  name: "Guia.txt",
  mime: "text/plain",
  data: "Zg==",
};
for (const backend of ["node", "native"] as const)
  test(
    `${backend} rejects readable invalid resources before storage, keeps opaque data unreadable and detects stored corruption`,
    { timeout: 45000 },
    async () => {
      let client = await launch(undefined, 0, 0, backend);
      const author = createIdentity("Autora da fixture"),
        other = createIdentity("Outro leitor"),
        wire = new Router();
      const path = (id: string) =>
        join(client.dir, "store/objects", id + ".json");
      try {
        const card = await client.call("setup", { name: "Leitor", password });
        wire.connectTcp("127.0.0.1", client.tcpPort);
        await until(
          async () => wire.peers,
          (peers) => peers.some((p) => p.connected),
        );
        for (const readers of ["public", [author.public, card]] as const) {
          const bundle = createBundle(
            author,
            "site-resource",
            { ...file, script: "run()" },
            readers === "public" ? readers : [...readers],
          );
          verifyBundle(bundle); // Valid signature/chunks, deliberately invalid resource grammar.
          const rejected = (await client.call("state")).counters.rejected;
          wire.broadcast({ type: "bundle", bundle });
          await until(
            () => client.call("state"),
            (s) => s.counters.rejected > rejected,
          );
          assert.equal(existsSync(path(bundle.manifest.id)), false);
        }
        const opaque = createBundle(author, "site-resource", file, [
          author.public,
          other.public,
        ]);
        wire.broadcast({ type: "bundle", bundle: opaque });
        await until(async () => existsSync(path(opaque.manifest.id)), Boolean);
        assert.equal(
          (await client.call("retrieve", { id: opaque.manifest.id })).status,
          "unreadable",
        );
        await assert.rejects(() =>
          client.call("view", { id: opaque.manifest.id }),
        );
        const valid = createBundle(author, "site-resource", file, "public");
        wire.broadcast({ type: "bundle", bundle: valid });
        await until(
          () => client.call("state"),
          (s) => s.objects.some((o: any) => o.id === valid.manifest.id),
        );
        assert.deepEqual(
          (await client.call("view", { id: valid.manifest.id })).content,
          file,
        );
        const summary = (await client.call("state")).objects.find(
          (o: any) => o.id === valid.manifest.id,
        ).content;
        assert.equal(summary.domain, "relayloom/site-resource-summary/1");
        assert.equal(summary.bytes, 1);
        assert.equal(summary.data, undefined);
        assert.equal(summary.table, undefined);
        await assert.rejects(() =>
          client.call("publish", { content: file, recipients: "public" }),
        );
        await client.call("action", {
          action: "block",
          target: author.public.id,
          value: true,
        });
        await assert.rejects(() =>
          client.call("view", { id: valid.manifest.id }),
        );
        await client.call("action", {
          action: "block",
          target: author.public.id,
          value: false,
        });
        await wire.stop();
        await client.stop();
        const stored = JSON.parse(
            readFileSync(path(valid.manifest.id), "utf8"),
          ),
          chunk = stored.manifest.chunks[0].hash;
        stored.chunks[chunk] =
          (stored.chunks[chunk][0] === "A" ? "B" : "A") +
          stored.chunks[chunk].slice(1);
        writeFileSync(path(valid.manifest.id), JSON.stringify(stored));
        client = await launch(client.dir, 0, 0, backend);
        await client.call("unlock", { password });
        await assert.rejects(() =>
          client.call("view", { id: valid.manifest.id }),
        );
        assert.equal(
          (await client.call("state")).objects.some(
            (o: any) => o.id === valid.manifest.id,
          ),
          false,
        );
      } finally {
        await wire.stop();
        await client.stop();
        rmSync(client.dir, { recursive: true, force: true });
      }
    },
  );
