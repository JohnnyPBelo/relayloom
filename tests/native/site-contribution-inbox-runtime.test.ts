import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { launch, password, until, type Client } from "../helpers";
import { formPayload } from "../fixtures/site-form";
import { assertOffline } from "../fixtures/offline-process";

for (const backend of ["node", "native"] as const)
  test(
    `${backend} journals a received proposal before inbox is opened and retains its source after cache-file loss and sender exit`,
    { timeout: 60000 },
    async () => {
      const peers: Client[] = [];
      try {
        let owner = await launch(undefined, 0, 0, backend);
        peers.push(owner);
        const sender = await launch(
          undefined,
          0,
          0,
          backend === "node" ? "native" : "node",
        );
        peers.push(sender);
        const a = await owner.call("setup", {
            name: "Durable inbox owner",
            password,
          }),
          b = await sender.call("setup", {
            name: "Durable inbox visitor",
            password,
          });
        for (const p of peers) await p.call("settings", { relay: true });
        const address = "relayloom:site:" + a.id + "/profile",
          state = await owner.call("site-command", {
            action: "state",
            address,
          }),
          site = (
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
        const request = {
            action: "submit",
            sequence: 1,
            operationId: randomUUID(),
            snapshotId: site.bundleId,
            pageId: "entry",
            formId: "form",
            values: {
              name: "AUTOMATIC_PRIVATE_INBOX_AFTER_CACHE_LOSS",
              count: 2,
              open: true,
            },
            publicationScope: [a.id, b.id].sort(),
            ttlMs: 180000,
          },
          sent = await sender.call("contribution-command", request);
        assert.equal(sent.error, undefined);
        await until(
          () => owner.call("state"),
          (s) =>
            s.objects.some(
              (o: any) => o.id === sent.operation.transport.bundleId,
            ),
        );
        // Never open inbox before the loss: receive must have committed the proof.
        const path = owner.dir;
        await sender.stop();
        await assertOffline(sender);
        await owner.stop();
        await assertOffline(owner);
        for (const id of [site.bundleId, sent.operation.transport.bundleId]) {
          const file = join(path, "store/objects", id + ".json");
          assert.equal(existsSync(file), true);
          rmSync(file);
          assert.equal(existsSync(file), false);
        }
        owner = await launch(path, 0, 0, backend);
        peers.push(owner);
        await owner.call("unlock", { password });
        const inbox = await owner.call("contribution-command", {
          action: "inbox",
        });
        assert.equal(inbox.durable, true);
        assert.equal(inbox.items.length, 1);
        const item = inbox.items[0];
        assert.equal(item.id, sent.operation.certificateId);
        assert.equal(item.bundleId, sent.operation.transport.bundleId);
        assert.equal(item.contributor.id, b.id);
        assert.equal(item.status, "verified-candidate");
        assert.deepEqual(item.values, request.values);
        assert.deepEqual(item.publicationScope, request.publicationScope);
        for (const id of [site.bundleId, sent.operation.transport.bundleId])
          assert.equal(
            existsSync(join(path, "store/objects", id + ".json")),
            false,
            "private evidence must not be confused with an available ordinary cache copy",
          );
        await owner.call("action", {
          action: "block",
          target: b.id,
          value: true,
        });
        assert.deepEqual(
          (await owner.call("contribution-command", { action: "inbox" })).items,
          [],
        );
        await owner.call("action", {
          action: "block",
          target: b.id,
          value: false,
        });
        assert.deepEqual(
          (await owner.call("contribution-command", { action: "inbox" }))
            .items[0].values,
          request.values,
        );
        await assertOffline(sender);
      } finally {
        for (const p of peers) await p.stop();
        for (const dir of new Set(peers.map((p) => p.dir)))
          rmSync(dir, { recursive: true, force: true });
      }
    },
  );

for (const backend of ["node", "native"] as const)
  test(
    `${backend} keeps an out-of-order proposal unverified until the actual authenticated source reaches the owner`,
    { timeout: 60000 },
    async () => {
      const peers: Client[] = [];
      try {
        let owner = await launch(undefined, 0, 0, backend);
        peers.push(owner);
        const sender = await launch(
          undefined,
          0,
          0,
          backend === "node" ? "native" : "node",
        );
        peers.push(sender);
        const a = await owner.call("setup", {
            name: "Owner missing source",
            password,
          }),
          b = await sender.call("setup", {
            name: "Visitor retaining source",
            password,
          });
        for (const p of peers) await p.call("settings", { relay: true });
        const address = "relayloom:site:" + a.id + "/profile",
          state = await owner.call("site-command", {
            action: "state",
            address,
          }),
          site = (
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
        const dir = owner.dir;
        await owner.stop();
        await assertOffline(owner);
        rmSync(join(dir, "store/objects", site.bundleId + ".json"));
        owner = await launch(dir, 0, 0, backend);
        peers.push(owner);
        await owner.call("unlock", { password });
        await sender.call("connect", {
          host: "127.0.0.1",
          port: owner.tcpPort,
        });
        const request = {
            action: "submit",
            sequence: 1,
            operationId: randomUUID(),
            snapshotId: site.bundleId,
            pageId: "entry",
            formId: "form",
            values: { name: "WAIT_FOR_ORIGINAL_SOURCE", count: 0, open: false },
            publicationScope: "public",
            ttlMs: 180000,
          },
          sent = await sender.call("contribution-command", request);
        assert.equal(sent.error, undefined);
        const deferred = await until(
          () => owner.call("contribution-command", { action: "inbox" }),
          (v) =>
            v.items.some((i: any) => i.id === sent.operation.certificateId),
        );
        assert.equal(deferred.items[0].status, "missing-source");
        assert.equal(deferred.items[0].values, undefined);
        assert.equal(
          existsSync(join(dir, "store/objects", site.bundleId + ".json")),
          false,
        );
        // This proves promotion on a real later source transfer. Retrieval of a
        // source held only in the sender's private queue remains a separate gate.
        await sender.call("settings", { relay: true });
        const verified = await until(
          () => owner.call("contribution-command", { action: "inbox" }),
          (v) =>
            v.items.some(
              (i: any) =>
                i.id === sent.operation.certificateId &&
                i.status === "verified-candidate",
            ),
        );
        assert.deepEqual(verified.items[0].values, request.values);
        assert.equal(
          verified.items[0].bundleId,
          sent.operation.transport.bundleId,
        );
        assert.equal(verified.items[0].target.snapshotId, site.bundleId);
        assert.equal(
          existsSync(join(dir, "store/objects", site.bundleId + ".json")),
          true,
        );
      } finally {
        for (const p of peers) await p.stop();
        for (const dir of new Set(peers.map((p) => p.dir)))
          rmSync(dir, { recursive: true, force: true });
      }
    },
  );
