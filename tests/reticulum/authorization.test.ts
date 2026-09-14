import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { createIdentity, createBundle } from "../../packages/core/src/index.js";
import { Router } from "../../packages/transport/src/index.js";
import { ReticulumAdapter } from "../../packages/transport/src/reticulum.js";
import { launch, password, until } from "../helpers.js";

test(
  "real RNS delivery rejects forged authorship and corrupted ciphertext, accepts the control and deduplicates replay",
  { timeout: 60_000 },
  async () => {
    const work = mkdtempSync(resolve(".cache/rns-authorization-"));
    const listener = createServer();
    await new Promise<void>((r) => listener.listen(0, "127.0.0.1", r));
    const port = (listener.address() as { port: number }).port;
    await new Promise<void>((r) => listener.close(() => r()));
    function config(name: string, peer: string) {
      const path = join(work, name);
      mkdirSync(path, { mode: 0o700 });
      writeFileSync(
        join(path, "config"),
        `[reticulum]\nshare_instance = No\nenable_transport = No\n[interfaces]\n [[TCP]]\n enabled = Yes\n ${peer}\n`,
        { mode: 0o600 },
      );
      return path;
    }
    const receiver = await launch(join(work, "receiver"), 0, -1, "node", [
      "--rns-config",
      config(
        "receiver-rns",
        `type = TCPServerInterface\n listen_ip = 127.0.0.1\n listen_port = ${port}`,
      ),
    ]);
    const sender = new Router({ relay: false });
    let rns: ReticulumAdapter | undefined;
    try {
      await receiver.call("setup", { name: "Leitora", password });
      rns = await ReticulumAdapter.start(sender, {
        python: resolve(".cache/reticulum/venv/bin/python"),
        config: config(
          "sender-rns",
          `type = TCPClientInterface\n target_host = 127.0.0.1\n target_port = ${port}`,
        ),
      });
      rns.connect((await receiver.call("state")).reticulum.destination);
      await until(
        () => receiver.call("state"),
        (s) => s.peers.some((p: any) => p.medium === "reticulum"),
        20_000,
      );
      const author = createIdentity("Autora do controlo"),
        impostor = createIdentity("Sem propriedade");
      const valid = createBundle(
        author,
        "post",
        { type: "post", text: "O conteúdo continua a ter dona" },
        "public",
      );
      const forged = structuredClone(valid);
      forged.manifest.author = impostor.public;
      const corrupt = structuredClone(valid),
        chunk = corrupt.manifest.chunks[0].hash;
      const bytes = Buffer.from(corrupt.chunks[chunk], "base64");
      bytes[0] ^= 1;
      corrupt.chunks[chunk] = bytes.toString("base64");
      for (const bundle of [forged, corrupt]) {
        const before = (await receiver.call("state")).counters.rejected;
        sender.broadcast({ type: "bundle", bundle });
        const refused = await until(
          () => receiver.call("state"),
          (s) => s.counters.rejected > before,
          12_000,
        );
        assert.equal(
          refused.storage.count,
          0,
          "invalid object never reaches content storage",
        );
      }
      sender.broadcast({ type: "bundle", bundle: valid });
      await until(
        () => receiver.call("state"),
        (s) => s.objects.some((o: any) => o.id === valid.manifest.id),
        12_000,
      );
      assert.equal(
        (await receiver.call("view", { id: valid.manifest.id })).author.id,
        author.public.id,
      );
      await assert.rejects(
        () =>
          receiver.call("publish", {
            content: {
              type: "edit",
              target: valid.manifest.id,
              text: "Roubar autoria",
            },
            recipients: "public",
          }),
        /autor/i,
      );
      await delay(25);
      const before = (await receiver.call("state")).counters.received;
      sender.broadcast({ type: "bundle", bundle: valid });
      const replayed = await until(
        () => receiver.call("state"),
        (s) => s.counters.received > before,
        12_000,
      );
      assert.equal(replayed.storage.count, 1);
      assert.equal(
        (await receiver.call("view", { id: valid.manifest.id })).author.id,
        author.public.id,
      );
      mkdirSync("docs/evidence/reticulum", { recursive: true });
      writeFileSync(
        "docs/evidence/reticulum/authorization.json",
        JSON.stringify(
          {
            finished: new Date().toISOString(),
            status: "passed",
            version: "1.5.4",
            medium: "real RNS Link/Channel over loopback TCP",
            controls: [
              "forged author rejected before storage",
              "ciphertext corruption rejected before storage",
              "valid control delivered and verified",
              "reader cannot edit another author",
              "fresh transport replay has one stored object and unchanged author",
            ],
            limits:
              "Linux host; does not prove physical radio or UI accessibility",
            work,
          },
          null,
          2,
        ) + "\n",
      );
    } finally {
      await rns?.close();
      await sender.stop();
      await receiver.stop();
    }
  },
);
