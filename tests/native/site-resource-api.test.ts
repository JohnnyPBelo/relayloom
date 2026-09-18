import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { canonical, hash, verifyBundle } from "../../packages/core/src/index";
import { launch, password, until, type Client } from "../helpers";
import { assertOffline } from "../fixtures/offline-process";
const disk = (c: Client, id: string) =>
  join(c.dir, "store/objects", id + ".json");

for (const backend of ["node", "native"] as const)
  test(
    `${backend} resource API persists quota failures, respects blocking, recovers the same signature across engines and seeds only on request`,
    { timeout: 80000 },
    async () => {
      const clients: Client[] = [];
      const other = backend === "node" ? "native" : "node";
      try {
        let author = await launch(undefined, 0, 0, backend);
        clients.push(author);
        let seeder = await launch(undefined, 0, 0, other);
        const reader = await launch(undefined, 0, -1, backend);
        clients.push(seeder, reader);
        const a = await author.call("setup", { name: "Autora API", password }),
          b = await seeder.call("setup", {
            name: "Leitor que conserva",
            password,
          }),
          c = await reader.call("setup", {
            name: "Leitora posterior",
            password,
          });
        for (const card of [b, c])
          await author.call("contact", { contact: card });
        for (const peer of clients)
          await peer.call("settings", { relay: true });
        await seeder.call("connect", {
          host: "127.0.0.1",
          port: author.tcpPort,
        });
        const witness = await author.call("publish", {
          content: {
            type: "post",
            text: "Controlo da ligação e sincronização automática",
          },
          recipients: "public",
        });
        await until(
          () => seeder.call("state"),
          (s) => s.objects.some((o: any) => o.id === witness.id),
        );
        const state = await author.call("resource-command", {
          action: "state",
        });
        assert.equal(state.nextSequence, 1);
        const request = {
          action: "create",
          sequence: 1,
          operationId: randomUUID(),
          ttlMs: 3600000,
          recipients: [a.id, b.id, c.id].sort(),
          content: {
            type: "site-resource",
            domain: "relayloom/site-resource/1",
            kind: "file",
            name: "Guia distribuído.txt",
            mime: "text/plain",
            data: Buffer.alloc(900000, 65).toString("base64"),
          },
        };
        for (const invalid of [
          { ...request, unexpected: true },
          { ...request, sequence: 2 },
          { ...request, recipients: [] },
          { ...request, recipients: [a.id, "0".repeat(64)].sort() },
        ])
          await assert.rejects(author.call("resource-command", invalid));
        await assert.rejects(
          author.call("publish", {
            content: request.content,
            recipients: request.recipients,
          }),
        );
        assert.equal(
          (await author.call("resource-command", { action: "state" }))
            .nextSequence,
          1,
        );
        await author.call("settings", { quota: 1024 * 1024 });
        const first = await author.call("resource-command", request),
          op = first.operation,
          id = op.reference.bundleId;
        assert.equal(op.phase, "copy-pending");
        assert.ok(first.error);
        assert.equal(existsSync(disk(author, id)), false);
        assert.equal(existsSync(disk(seeder, id)), false);
        await author.call("action", {
          action: "block",
          target: b.id,
          value: true,
        });
        await author.call("settings", { quota: 8 * 1024 * 1024 });
        const repeat = await author.call("resource-command", request);
        assert.deepEqual(repeat.operation, op);
        assert.match(repeat.error, /bloqueado/i);
        await assert.rejects(
          author.call("resource-command", { ...request, ttlMs: 7200000 }),
        );
        const directory = author.dir;
        await author.stop();
        author = await launch(directory, 0, 0, other);
        clients.push(author);
        await author.call("unlock", { password });
        const handle = { sequence: 1, operationId: request.operationId };
        assert.deepEqual(
          (
            await author.call("resource-command", {
              action: "operation",
              ...handle,
            })
          ).operation,
          op,
        );
        assert.match(
          (
            await author.call("resource-command", {
              action: "resume",
              ...handle,
            })
          ).error,
          /bloqueado/i,
        );
        assert.equal(existsSync(disk(author, id)), false);
        await author.call("action", {
          action: "block",
          target: b.id,
          value: false,
        });
        // Automatic bounded recovery, with no second creation call after unblock.
        const ready = await until(
          () =>
            author.call("resource-command", { action: "operation", ...handle }),
          (r) => r.operation?.phase === "ready",
        );
        assert.equal(ready.operation.bundleHash, op.bundleHash);
        assert.equal(ready.operation.reference.bundleId, id);
        assert.equal(
          (await author.call("resource-command", request)).operation.reference
            .bundleId,
          id,
        );
        const original = JSON.parse(readFileSync(disk(author, id), "utf8"));
        verifyBundle(original);
        assert.equal(hash(canonical(original)), op.bundleHash);
        assert.equal(
          (await author.call("state")).objects.find((o: any) => o.id === id)
            .content.data,
          undefined,
        );
        await seeder.call("connect", {
          host: "127.0.0.1",
          port: author.tcpPort,
        });
        const second = await author.call("publish", {
          content: {
            type: "post",
            text: "Controlo após retomada noutro motor",
          },
          recipients: "public",
        });
        await until(
          () => seeder.call("state"),
          (s) => s.objects.some((o: any) => o.id === second.id),
        );
        await delay(4600);
        assert.equal(
          existsSync(disk(seeder, id)),
          false,
          "resource must not sync with ordinary content",
        );
        await seeder.call("retrieve", { id });
        await until(async () => existsSync(disk(seeder, id)), Boolean);
        assert.deepEqual(
          (await seeder.call("view", { id })).content,
          request.content,
        );
        await author.stop();
        await assertOffline({
          process: author.process,
          tcpPort: author.tcpPort,
        });
        const seedDir = seeder.dir;
        await seeder.stop();
        seeder = await launch(seedDir, 0, 0, backend);
        clients.push(seeder);
        await seeder.call("unlock", { password });
        await reader.call("connect", {
          host: "127.0.0.1",
          port: seeder.tcpPort,
        });
        await until(
          () => reader.call("state"),
          (s) => s.objects.some((o: any) => o.id === second.id),
        );
        assert.equal(existsSync(disk(reader, id)), false);
        await seeder.call("settings", { relay: false });
        await reader.call("retrieve", { id });
        await delay(2300);
        assert.equal(
          existsSync(disk(reader, id)),
          false,
          "paused sole seeder must not serve",
        );
        await seeder.call("settings", { relay: true });
        await delay(2800); // Respect the request cooldown, without weakening the negative control.
        await reader.call("retrieve", { id });
        await until(async () => existsSync(disk(reader, id)), Boolean);
        const copy = JSON.parse(readFileSync(disk(reader, id), "utf8"));
        assert.equal(hash(canonical(copy)), op.bundleHash);
        const viewed = await reader.call("view", { id });
        assert.equal(viewed.author.id, a.id);
        assert.deepEqual(viewed.content, request.content);
        assert.equal(
          (await reader.call("resource-command", { action: "state" }))
            .nextSequence,
          1,
          "reading/seeding must not take signing ownership",
        );
      } finally {
        for (const c of clients) await c.stop();
        for (const dir of new Set(clients.map((c) => c.dir)))
          rmSync(dir, { recursive: true, force: true });
      }
    },
  );

for (const backend of ["node", "native"] as const)
  test(
    `${backend} expired resource creation retains its ID and never recreates on resume`,
    { timeout: 20000 },
    async () => {
      const client = await launch(undefined, 0, -1, backend);
      try {
        await client.call("setup", { name: "Expiração", password });
        await client.call("settings", { quota: 1024 * 1024 });
        const q = {
          action: "create",
          sequence: 1,
          operationId: randomUUID(),
          recipients: "public",
          ttlMs: 4000,
          content: {
            type: "site-resource",
            domain: "relayloom/site-resource/1",
            kind: "file",
            name: "Temporário.txt",
            mime: "text/plain",
            data: Buffer.alloc(900000, 66).toString("base64"),
          },
        };
        const pending = await client.call("resource-command", q);
        assert.equal(pending.operation.phase, "copy-pending");
        await delay(Math.max(0, pending.operation.expires - Date.now()) + 50);
        await client.call("settings", { quota: 8 * 1024 * 1024 });
        const expired = await client.call("resource-command", {
          action: "resume",
          sequence: 1,
          operationId: q.operationId,
        });
        assert.equal(expired.operation.phase, "expired");
        assert.equal(
          expired.operation.reference.bundleId,
          pending.operation.reference.bundleId,
        );
        assert.deepEqual(
          (await client.call("resource-command", q)).operation,
          expired.operation,
        );
        assert.equal(
          existsSync(disk(client, expired.operation.reference.bundleId)),
          false,
        );
        assert.equal(
          (await client.call("resource-command", { action: "state" }))
            .nextSequence,
          2,
        );
        await client.call("lock", {});
        await assert.rejects(
          client.call("resource-command", { action: "state" }),
        );
        await client.call("unlock", { password });
        assert.deepEqual(
          (await client.call("resource-command", q)).operation,
          expired.operation,
        );
        const next = await client.call("resource-command", {
          ...q,
          sequence: 2,
          operationId: randomUUID(),
          content: { ...q.content, data: "Zg==" },
        });
        assert.equal(next.operation.phase, "ready");
        assert.notEqual(
          next.operation.reference.bundleId,
          expired.operation.reference.bundleId,
        );
      } finally {
        await client.stop();
        rmSync(client.dir, { recursive: true, force: true });
      }
    },
  );
