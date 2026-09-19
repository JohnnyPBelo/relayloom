import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { siteAddress } from "../../packages/sites/src/protocol";
import { canonical } from "../../packages/core/src/index";
import { launch, until, password, type Client } from "../helpers";

function payload(reference: any) {
  return {
    type: "site",
    theme: "sand",
    blocks: [],
    site: {
      version: 3,
      title: "Arquivo da comunidade",
      description: "Recursos à escolha",
      home: "home",
      design: {
        font: "sans",
        width: "standard",
        radius: "soft",
        accent: "#207a70",
      },
      pages: [
        {
          id: "home",
          slug: "inicio",
          title: "Início",
          blocks: [
            {
              id: "guide",
              type: "resource",
              title: "Guia",
              body: "Obter apenas quando necessário.",
              reference,
            },
          ],
        },
        { id: "notes", slug: "notas", title: "Notas", blocks: [] },
      ],
    },
  };
}
const objectPath = (peer: Client, id: string) =>
  join(peer.dir, "store/objects", id + ".json");
for (const backend of ["node", "native"] as const)
  test(
    `${backend} publishes only checked resource audiences and retrieves the exact reference of a signed page across runtimes`,
    { timeout: 45000 },
    async () => {
      const peers: Client[] = [];
      try {
        const a = await launch(undefined, 0, 0, backend),
          b = await launch(
            undefined,
            0,
            -1,
            backend === "node" ? "native" : "node",
          );
        peers.push(a, b);
        const author = await a.call("setup", {
            name: "Autora de páginas",
            password,
          }),
          reader = await b.call("setup", { name: "Leitor", password });
        assert.equal(
          (await (backend === "native" ? a : b).call("state")).nativeRuntime,
          "Go",
        );
        await a.call("contact", { contact: reader });
        await a.call("settings", { relay: true });
        await b.call("settings", { relay: true });
        await b.call("connect", { host: "127.0.0.1", port: a.tcpPort });
        const resource = {
          type: "site-resource",
          domain: "relayloom/site-resource/1",
          kind: "file",
          name: "Guia.txt",
          mime: "text/plain",
          data: Buffer.from("EXPLICIT_RESOURCE_CONTENT_914063").toString(
            "base64",
          ),
        };
        const created = await a.call("resource-command", {
          action: "create",
          sequence: 1,
          operationId: randomUUID(),
          content: resource,
          recipients: [author.id, reader.id].sort(),
          ttlMs: 3600000,
        });
        assert.equal(created.operation.phase, "ready");
        const reference = created.operation.reference,
          document = payload(reference),
          address = siteAddress(author.id, "profile"),
          state = await a.call("site-command", { action: "state", address });
        const q = {
          action: "publish",
          name: "profile",
          sequence: state.nextSequence,
          operationId: randomUUID(),
          expectedBase: state.base,
          payload: document,
          recipients: [reader.id],
          ttlMs: 3600000,
        };
        await assert.rejects(
          a.call("publish", { content: document, recipients: [reader.id] }),
        );
        await assert.rejects(
          a.call("site-command", { ...q, recipients: "public" }),
          /recurso/i,
        );
        for (const edited of [
          { ...reference, mime: "application/json" },
          { ...reference, authorId: "d".repeat(64) },
          { ...reference, bundleId: "0".repeat(64) },
          { ...reference, payloadHash: "c".repeat(64) },
        ])
          await assert.rejects(
            a.call("site-command", { ...q, payload: payload(edited) }),
          );
        assert.equal(
          (await a.call("site-command", { action: "state", address }))
            .nextSequence,
          1,
        );
        const published = await a.call("site-command", q);
        assert.equal(published.operation.phase, "ready");
        const snapshotId = published.operation.bundleId,
          query = {
            action: "inspect",
            snapshotId,
            pageId: "home",
            blockId: "guide",
          };
        const available = await a.call("resource-command", query);
        assert.equal(available.status, "available");
        assert.equal(available.content, undefined);
        assert.deepEqual(
          (await a.call("resource-command", { ...query, action: "obtain" }))
            .content,
          resource,
        );
        for (const invalid of [
          { ...query, reference },
          { ...query, pageId: "notes" },
          { ...query, blockId: "other" },
          { ...query, snapshotId: [snapshotId] },
          { ...query, snapshotId: reference.bundleId },
        ])
          await assert.rejects(a.call("resource-command", invalid));
        await until(
          () => b.call("state"),
          (s) => s.objects.some((o: any) => o.id === snapshotId),
        );
        assert.equal(
          (await b.call("resource-command", query)).status,
          "missing",
        );
        await delay(2300);
        assert.equal(
          existsSync(objectPath(b, reference.bundleId)),
          false,
          "inspecting the signed page must not request its optional bytes",
        );
        assert.equal(
          (await b.call("resource-command", { ...query, action: "obtain" }))
            .status,
          "requested",
        );
        const downloaded = await until(
          () => b.call("resource-command", query),
          (result) => result.status === "available",
        );
        assert.deepEqual(downloaded.reference, reference);
        assert.equal(downloaded.content, undefined);
        assert.deepEqual(
          (await b.call("resource-command", { ...query, action: "obtain" }))
            .content,
          resource,
        );
        const saved = JSON.parse(
          readFileSync(objectPath(b, reference.bundleId), "utf8"),
        );
        assert.equal(saved.manifest.author.id, author.id);
        const damaged = structuredClone(saved);
        damaged.chunks[damaged.manifest.chunks[0].hash] = "Y29ycnVwdA==";
        writeFileSync(objectPath(b, reference.bundleId), canonical(damaged));
        const rejected = await b.call("resource-command", {
          ...query,
          action: "obtain",
        });
        assert.equal(rejected.status, "invalid");
        assert.equal(rejected.content, undefined);
        writeFileSync(objectPath(b, reference.bundleId), canonical(saved));
        assert.equal(
          (await b.call("resource-command", query)).status,
          "available",
        );
        // A retained publication remains the same result even if its original
        // resource is now missing. A new publication must validate availability.
        rmSync(objectPath(a, reference.bundleId));
        const repeated = await a.call("site-command", q);
        assert.equal(repeated.operation.bundleId, snapshotId);
        const next = await a.call("site-command", { action: "state", address });
        await assert.rejects(
          a.call("site-command", {
            ...q,
            sequence: next.nextSequence,
            operationId: randomUUID(),
            expectedBase: next.base,
          }),
        );
        writeFileSync(objectPath(a, reference.bundleId), canonical(saved));
        await assert.rejects(
          b.call("publish", {
            content: { type: "delete", target: reference.bundleId },
            recipients: [author.id],
          }),
        );
        await a.call("publish", {
          content: { type: "delete", target: reference.bundleId },
          recipients: [reader.id],
        });
        await until(
          () => b.call("state"),
          (s) =>
            s.objects.some(
              (o: any) => o.id === reference.bundleId && o.deleted,
            ),
        );
        const withdrawn = await b.call("resource-command", {
          ...query,
          action: "obtain",
        });
        assert.equal(withdrawn.status, "withdrawn");
        assert.equal(withdrawn.content, undefined);
        const afterRemoval = await a.call("site-command", {
          action: "state",
          address,
        });
        await assert.rejects(
          a.call("site-command", {
            ...q,
            sequence: afterRemoval.nextSequence,
            operationId: randomUUID(),
            expectedBase: afterRemoval.base,
          }),
          /retir/i,
        );
        assert.equal(
          (await a.call("site-command", { action: "state", address }))
            .nextSequence,
          afterRemoval.nextSequence,
        );

        await b.call("action", {
          action: "block",
          target: author.id,
          value: true,
        });
        await assert.rejects(
          b.call("resource-command", { ...query, action: "obtain" }),
        );
      } finally {
        for (const p of peers) await p.stop();
        for (const p of peers) rmSync(p.dir, { recursive: true, force: true });
      }
    },
  );

for (const backend of ["node", "native"] as const)
  test(
    `${backend} reports expiry from authenticated resource bytes without returning expired data`,
    { timeout: 15000 },
    async () => {
      const a = await launch(undefined, 0, -1, backend);
      try {
        const author = await a.call("setup", {
          name: "Prazo do recurso",
          password,
        });
        const content = {
          type: "site-resource",
          domain: "relayloom/site-resource/1",
          kind: "file",
          name: "Temporário.txt",
          mime: "text/plain",
          data: "Zg==",
        };
        const created = await a.call("resource-command", {
          action: "create",
          sequence: 1,
          operationId: randomUUID(),
          recipients: "public",
          ttlMs: 4000,
          content,
        });
        assert.equal(created.operation.phase, "ready");
        const address = siteAddress(author.id, "profile"),
          state = await a.call("site-command", { action: "state", address });
        const result = await a.call("site-command", {
          action: "publish",
          name: "profile",
          sequence: 1,
          operationId: randomUUID(),
          expectedBase: state.base,
          payload: payload(created.operation.reference),
          recipients: "public",
          ttlMs: 3600000,
        });
        assert.equal(result.operation.phase, "ready");
        const query = {
          action: "obtain",
          snapshotId: result.operation.bundleId,
          pageId: "home",
          blockId: "guide",
        };
        assert.equal(
          (await a.call("resource-command", query)).status,
          "available",
        );
        await delay(Math.max(0, created.operation.expires - Date.now()) + 25);
        const expired = await a.call("resource-command", query);
        assert.equal(expired.status, "expired");
        assert.equal(expired.expires, created.operation.expires);
        assert.equal(expired.content, undefined);
      } finally {
        await a.stop();
        rmSync(a.dir, { recursive: true, force: true });
      }
    },
  );
