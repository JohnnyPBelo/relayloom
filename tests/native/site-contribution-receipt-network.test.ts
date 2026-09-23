import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { launch, password, until, type Client } from "../helpers";
import { assertOffline, tcpOutcome } from "../fixtures/offline-process";
import { formPayload } from "../fixtures/site-form";

for (const backend of ["node", "native"] as const)
  test(
    `${backend} visitor receives an owner-signed private receipt from the other engine and never resumes the confirmed proposal after restart`,
    { timeout: 60000 },
    async () => {
      const peers: Client[] = [];
      let owner = await launch(
          undefined,
          0,
          0,
          backend === "node" ? "native" : "node",
        ),
        visitor = await launch(undefined, 0, 0, backend);
      peers.push(owner, visitor);
      try {
        const a = await owner.call("setup", {
            name: "Receipt owner",
            password,
          }),
          b = await visitor.call("setup", {
            name: "Receipt visitor",
            password,
          }),
          address = "relayloom:site:" + a.id + "/profile",
          initial = await owner.call("site-command", {
            action: "state",
            address,
          }),
          site = (
            await owner.call("site-command", {
              action: "publish",
              name: "profile",
              sequence: initial.nextSequence,
              operationId: randomUUID(),
              expectedBase: initial.base,
              payload: formPayload([b.id]),
              recipients: "public",
              ttlMs: 3600000,
            })
          ).operation;
        for (const p of peers) await p.call("settings", { relay: true });
        await visitor.call("connect", {
          host: "127.0.0.1",
          port: owner.tcpPort,
        });
        await until(
          () => visitor.call("state"),
          (s) => s.objects.some((o: any) => o.id === site.bundleId),
        );
        for (const p of peers) await p.call("settings", { relay: false });
        const request = {
            action: "submit",
            sequence: 1,
            operationId: randomUUID(),
            snapshotId: site.bundleId,
            pageId: "entry",
            formId: "form",
            values: {
              name: "PRIVATE_AUTOMATIC_RECEIPT",
              count: 0,
              open: false,
            },
            publicationScope: "public",
            ttlMs: 180000,
          },
          sent = await visitor.call("contribution-command", request);
        assert.equal(sent.error, undefined);
        assert.equal(sent.operation.transport.copied, true);
        const received = await until(
          () =>
            visitor.call("contribution-command", {
              action: "operation",
              sequence: 1,
              operationId: request.operationId,
            }),
          (v) => v.operation?.phase === "received",
        );
        const receipt = received.operation.receipt;
        assert.equal(receipt.body.owner.id, a.id);
        assert.equal(receipt.body.contributorId, b.id);
        assert.equal(receipt.body.certificateId, sent.operation.certificateId);
        assert.equal(receipt.body.operationId, request.operationId);
        assert.equal(receipt.body.proposalExpires, sent.operation.expires);
        assert(!JSON.stringify(receipt).includes(request.values.name));
        const stored = await until(
          () => visitor.call("state"),
          (s) =>
            s.objects.some((o: any) => o.kind === "site-contribution-receipt"),
        );
        const object = stored.objects.find(
          (o: any) => o.kind === "site-contribution-receipt",
        );
        const envelope = JSON.parse(
          readFileSync(
            join(visitor.dir, "store/objects", object.id + ".json"),
            "utf8",
          ),
        );
        assert.equal(envelope.manifest.publicKey, null);
        assert.deepEqual(
          envelope.manifest.keys.map((k: any) => k.reader).sort(),
          [a.id, b.id].sort(),
        );
        const ownerDir = owner.dir,
          visitorDir = visitor.dir;
        await owner.stop();
        await assertOffline(owner);
        await visitor.stop();
        await assertOffline(visitor);
        visitor = await launch(visitorDir, 0, 0, backend);
        peers.push(visitor);
        await visitor.call("unlock", { password });
        const repeated = await visitor.call("contribution-command", {
          action: "resume",
          sequence: 1,
          operationId: request.operationId,
        });
        assert.equal(repeated.operation.phase, "received");
        assert.deepEqual(repeated.operation.receipt, receipt);
        owner = await launch(
          ownerDir,
          0,
          0,
          backend === "node" ? "native" : "node",
        );
        peers.push(owner);
        await owner.call("unlock", { password });
        await visitor.call("connect", {
          host: "127.0.0.1",
          port: owner.tcpPort,
        });
        const marker = await owner.call("publish", {
          content: { type: "post", text: "PATH_AFTER_RECEIPT_RESTART" },
          recipients: "public",
        });
        await until(
          () => visitor.call("state"),
          (s) => s.objects.some((o: any) => o.id === marker.id),
        );
        const after = await visitor.call("contribution-command", {
          action: "operation",
          sequence: 1,
          operationId: request.operationId,
        });
        assert.deepEqual(after.operation, received.operation);
      } finally {
        for (const p of peers) await p.stop();
      }
    },
  );

for (const mode of ["cancelled", "expired"] as const)
  test(
    `late receipt survives an opaque seeder takeover and records reception without reviving a ${mode} visitor proposal`,
    { timeout: 60000 },
    async () => {
      const peers: Client[] = [];
      let owner = await launch(undefined, 0, 0, "node"),
        relay = await launch(undefined, 0, 0, "native"),
        visitor = await launch(undefined, 0, -1, "node");
      peers.push(owner, relay, visitor);
      try {
        const a = await owner.call("setup", {
            name: "Offline receipt owner",
            password,
          }),
          b = await relay.call("setup", {
            name: "Opaque receipt seeder",
            password,
          }),
          c = await visitor.call("setup", {
            name: "Late receipt visitor",
            password,
          });
        for (const p of peers) await p.call("settings", { relay: true });
        await relay.call("connect", { host: "127.0.0.1", port: owner.tcpPort });
        await visitor.call("connect", {
          host: "127.0.0.1",
          port: relay.tcpPort,
        });
        const address = "relayloom:site:" + a.id + "/profile",
          initial = await owner.call("site-command", {
            action: "state",
            address,
          }),
          site = (
            await owner.call("site-command", {
              action: "publish",
              name: "profile",
              sequence: initial.nextSequence,
              operationId: randomUUID(),
              expectedBase: initial.base,
              payload: formPayload([c.id]),
              recipients: "public",
              ttlMs: 3600000,
            })
          ).operation;
        await until(
          () => visitor.call("state"),
          (s) => s.objects.some((o: any) => o.id === site.bundleId),
        );
        assert.equal(visitor.tcpPort, -1);
        assert.equal(
          (await owner.call("state")).peers.filter((p: any) => p.connected)
            .length,
          1,
        );
        assert.equal(
          (await visitor.call("state")).peers.filter((p: any) => p.connected)
            .length,
          1,
        );
        await relay.call("settings", { relay: false });
        await visitor.call("settings", { relay: false });
        const request = {
            action: "submit",
            sequence: 1,
            operationId: randomUUID(),
            snapshotId: site.bundleId,
            pageId: "entry",
            formId: "form",
            values: { name: "LATE_RECEIPT_SEEDER", count: 0, open: false },
            publicationScope: "public",
            ttlMs: mode === "expired" ? 20000 : 180000,
          },
          sent = await visitor.call("contribution-command", request),
          proposalId = sent.operation.transport.bundleId;
        assert.equal(sent.error, undefined);
        await until(
          async () =>
            existsSync(join(relay.dir, "store/objects", proposalId + ".json")),
          Boolean,
        );
        const control = await relay.call("publish", {
          content: { type: "post", text: "OWNER_PATH_LIVE_WHILE_RELAY_PAUSED" },
          recipients: "public",
        });
        await until(
          () => owner.call("state"),
          (s) => s.objects.some((o: any) => o.id === control.id),
        );
        assert.equal(
          (await owner.call("contribution-command", { action: "inbox" })).items
            .length,
          0,
          "relay pause is a real negative path control",
        );
        if (mode === "cancelled")
          await visitor.call("contribution-command", {
            action: "cancel",
            sequence: 1,
            operationId: request.operationId,
          });
        const visitorDir = visitor.dir,
          apiPort = Number(new URL(visitor.url).port);
        await visitor.stop();
        assert(
          visitor.process.exitCode !== null ||
            visitor.process.signalCode !== null,
        );
        assert.equal(await tcpOutcome(apiPort), "ECONNREFUSED");
        await relay.call("settings", { relay: true });
        const withReceipt = await until(
            () => owner.call("state"),
            (s) =>
              s.objects.some(
                (o: any) => o.kind === "site-contribution-receipt",
              ),
            15000,
          ),
          receiptObject = withReceipt.objects.find(
            (o: any) => o.kind === "site-contribution-receipt",
          );
        await until(
          async () =>
            existsSync(
              join(relay.dir, "store/objects", receiptObject.id + ".json"),
            ),
          Boolean,
        );
        const envelope = JSON.parse(
          readFileSync(
            join(relay.dir, "store/objects", receiptObject.id + ".json"),
            "utf8",
          ),
        );
        assert.equal(envelope.manifest.publicKey, null);
        assert.deepEqual(
          envelope.manifest.keys.map((k: any) => k.reader).sort(),
          [a.id, c.id].sort(),
        );
        assert(!envelope.manifest.keys.some((k: any) => k.reader === b.id));
        await assert.rejects(relay.call("view", { id: receiptObject.id }));
        await owner.stop();
        await assertOffline(owner);
        if (mode === "expired")
          await delay(Math.max(0, sent.operation.expires - Date.now() + 25));
        visitor = await launch(visitorDir, 0, -1, "node");
        peers.push(visitor);
        await visitor.call("unlock", { password });
        const before = (
          await visitor.call("contribution-command", {
            action: "operation",
            sequence: 1,
            operationId: request.operationId,
          })
        ).operation;
        assert.equal(before.phase, mode);
        assert.equal(before.receipt, undefined);
        await visitor.call("connect", {
          host: "127.0.0.1",
          port: relay.tcpPort,
        });
        const received = await until(
          () =>
            visitor.call("contribution-command", {
              action: "operation",
              sequence: 1,
              operationId: request.operationId,
            }),
          (v) => !!v.operation?.receipt,
        );
        assert.equal(received.operation.phase, mode);
        assert.equal(received.operation.expires, sent.operation.expires);
        assert.equal(
          received.operation.receipt.body.certificateId,
          sent.operation.certificateId,
        );
        await until(
          async () =>
            existsSync(
              join(visitor.dir, "store/objects", receiptObject.id + ".json"),
            ),
          Boolean,
        );
        assert.deepEqual(
          JSON.parse(
            readFileSync(
              join(visitor.dir, "store/objects", receiptObject.id + ".json"),
              "utf8",
            ),
          ),
          envelope,
        );
        await assertOffline(owner);
      } finally {
        for (const p of peers) await p.stop();
      }
    },
  );
