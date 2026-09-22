import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { assertOffline } from "../fixtures/offline-process";
import { launch, password, until, type Client } from "../helpers";
import { formPayload } from "../fixtures/site-form";
for (const senderBackend of ["node", "native"] as const)
  test(
    `${senderBackend} sends a private site proposal over real TCP and the owner resolves its signed form`,
    { timeout: 60000 },
    async () => {
      const peers: Client[] = [];
      try {
        const owner = await launch(
            undefined,
            0,
            0,
            senderBackend === "node" ? "native" : "node",
          ),
          sender = await launch(undefined, 0, 0, senderBackend);
        peers.push(owner, sender);
        const a = await owner.call("setup", {
            name: "Dona do formulário",
            password,
          }),
          b = await sender.call("setup", { name: "Contribuidor", password });
        await owner.call("settings", { relay: true });
        await sender.call("settings", { relay: true });
        const address = "relayloom:site:" + a.id + "/profile",
          state = await owner.call("site-command", {
            action: "state",
            address,
          });
        const site = (
          await owner.call("site-command", {
            action: "publish",
            name: "profile",
            sequence: state.nextSequence,
            operationId: randomUUID(),
            expectedBase: state.base,
            payload: formPayload([b.id]),
            recipients: "public",
            ttlMs: 3600000,
          })
        ).operation;
        await sender.call("connect", {
          host: "127.0.0.1",
          port: owner.tcpPort,
        });
        await until(
          () => sender.call("state"),
          (s) => s.objects.some((o: any) => o.id === site.bundleId),
        );
        await sender.call("settings", { relay: false });
        const initial = await sender.call("contribution-command", {
          action: "state",
        });
        const q = {
          action: "submit",
          sequence: initial.nextSequence,
          operationId: randomUUID(),
          snapshotId: site.bundleId,
          pageId: "entry",
          formId: "form",
          values: {
            name: "PRIVATE_SUBMISSION_REAL_TCP_60231",
            count: 0,
            open: false,
          },
          publicationScope: [a.id, b.id].sort(),
          ttlMs: 60000,
        };
        const sent = await sender.call("contribution-command", q);
        assert.equal(sent.operation.phase, "queued", JSON.stringify(sent));
        assert.equal(sent.operation.transport.copied, true);
        assert.equal(sent.error, undefined);
        const inbox = await until(
          () => owner.call("contribution-command", { action: "inbox" }),
          (v) =>
            v.items.some(
              (item: any) => item.id === sent.operation.certificateId,
            ),
        );
        const item = inbox.items.find(
          (item: any) => item.id === sent.operation.certificateId,
        );
        assert.equal(item.status, "verified-candidate");
        assert.deepEqual(item.values, q.values);
        assert.deepEqual(item.publicationScope, q.publicationScope);
        assert.equal(item.contributor.id, b.id);
        assert.equal(item.target.site, address);
        assert.equal(item.target.snapshotId, site.bundleId);
        const retained = await sender.call("contribution-command", q);
        assert.equal(
          retained.operation.transport.bundleId,
          sent.operation.transport.bundleId,
        );
        const snapshot = await owner.call("state");
        assert.equal(
          JSON.stringify(snapshot.objects).includes(q.values.name),
          false,
          "periodic state must not include proposal values",
        );
        await sender.call("contribution-command", {
          action: "cancel",
          sequence: q.sequence,
          operationId: q.operationId,
        });
        assert.equal(
          (await sender.call("contribution-command", { action: "state" }))
            .operations[0].phase,
          "cancelled",
        );
      } finally {
        for (const p of peers) await p.stop().catch(() => {});
        for (const dir of new Set(peers.map((p) => p.dir)))
          rmSync(dir, { recursive: true, force: true });
      }
    },
  );

for (const backend of ["node", "native"] as const)
  test(
    `${backend} restarts a private proposal queue and heals a partition without renewing its envelope`,
    { timeout: 70000 },
    async () => {
      const peers: Client[] = [];
      try {
        let owner = await launch(
            undefined,
            0,
            0,
            backend === "node" ? "native" : "node",
          ),
          sender = await launch(undefined, 0, 0, backend);
        peers.push(owner, sender);
        const a = await owner.call("setup", { name: "Dona offline", password }),
          b = await sender.call("setup", {
            name: "Visitante offline",
            password,
          });
        await owner.call("settings", { relay: true });
        await sender.call("settings", { relay: true });
        const address = "relayloom:site:" + a.id + "/profile",
          state = await owner.call("site-command", {
            action: "state",
            address,
          });
        const site = (
          await owner.call("site-command", {
            action: "publish",
            name: "profile",
            sequence: state.nextSequence,
            operationId: randomUUID(),
            expectedBase: state.base,
            payload: formPayload(),
            recipients: "public",
            ttlMs: 3600000,
          })
        ).operation;
        await sender.call("connect", {
          host: "127.0.0.1",
          port: owner.tcpPort,
        });
        await until(
          () => sender.call("state"),
          (s) => s.objects.some((o: any) => o.id === site.bundleId),
        );
        const ownerDir = owner.dir,
          senderDir = sender.dir;
        await owner.stop();
        await assertOffline(owner);
        const request = {
          action: "submit",
          sequence: 1,
          operationId: randomUUID(),
          snapshotId: site.bundleId,
          pageId: "entry",
          formId: "form",
          values: {
            name: "RESTARTED_QUEUE_PARTITION_HEAL",
            count: 1,
            open: false,
          },
          publicationScope: [a.id, b.id].sort(),
          ttlMs: 60000,
        };
        const queued = (await sender.call("contribution-command", request))
          .operation;
        assert.equal(queued.phase, "queued");
        const original = readFileSync(
          join(
            sender.dir,
            "store/objects",
            queued.transport.bundleId + ".json",
          ),
        );
        await sender.stop();
        sender = await launch(senderDir, 0, 0, backend);
        peers.push(sender);
        await sender.call("unlock", { password });
        const recovered = (
          await sender.call("contribution-command", {
            action: "resume",
            sequence: 1,
            operationId: request.operationId,
          })
        ).operation;
        assert.equal(recovered.transport.bundleId, queued.transport.bundleId);
        assert.equal(recovered.created, queued.created);
        assert.equal(recovered.expires, queued.expires);
        assert.deepEqual(
          readFileSync(
            join(
              sender.dir,
              "store/objects",
              queued.transport.bundleId + ".json",
            ),
          ),
          original,
        );
        const cancelled = (
          await sender.call("contribution-command", {
            ...request,
            sequence: 2,
            operationId: randomUUID(),
            values: { ...request.values, name: "CANCELLED_OFFLINE_PROPOSAL" },
          })
        ).operation;
        await sender.call("contribution-command", {
          action: "cancel",
          sequence: 2,
          operationId: cancelled.operationId,
        });
        owner = await launch(
          ownerDir,
          0,
          0,
          backend === "node" ? "native" : "node",
        );
        peers.push(owner);
        await owner.call("unlock", { password });
        assert.equal(
          existsSync(
            join(
              owner.dir,
              "store/objects",
              queued.transport.bundleId + ".json",
            ),
          ),
          false,
        );
        await sender.call("connect", {
          host: "127.0.0.1",
          port: owner.tcpPort,
        });
        await until(
          () => owner.call("contribution-command", { action: "inbox" }),
          (v) => v.items.some((i: any) => i.id === queued.certificateId),
        );
        assert.equal(
          existsSync(
            join(
              owner.dir,
              "store/objects",
              cancelled.transport.bundleId + ".json",
            ),
          ),
          false,
        );
        const next = (await sender.call("contribution-command", request))
          .operation;
        assert.equal(next.transport.bundleId, queued.transport.bundleId);
      } finally {
        for (const p of peers) await p.stop().catch(() => {});
        for (const dir of new Set(peers.map((p) => p.dir)))
          rmSync(dir, { recursive: true, force: true });
      }
    },
  );
