import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { canonical } from "../../packages/core/src/index";
import { launch, password, until, type Client } from "../helpers";
import { formPayload } from "../fixtures/site-form";
import { assertOffline } from "../fixtures/offline-process";

for (const backend of ["node", "native"] as const)
  for (const mode of ["recover", "cancel", "block"] as const)
    test(
      `${backend} proposal source held only in its private queue ${mode}s across real TCP with both relays paused`,
      { timeout: 60000 },
      async () => {
        const peers: Client[] = [];
        try {
          let owner = await launch(
            undefined,
            0,
            0,
            backend === "node" ? "native" : "node",
          );
          peers.push(owner);
          let sender = await launch(undefined, 0, 0, backend);
          peers.push(sender);
          const a = await owner.call("setup", {
              name: "Owner needs historical source",
              password,
            }),
            b = await sender.call("setup", {
              name: "Visitor retains private source",
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
          const source = JSON.parse(
              readFileSync(
                join(sender.dir, "store/objects", site.bundleId + ".json"),
                "utf8",
              ),
            ),
            ownerDir = owner.dir,
            senderDir = sender.dir;
          await owner.stop();
          await assertOffline(owner);
          await sender.call("settings", { relay: false });
          const request = {
              action: "submit",
              sequence: 1,
              operationId: randomUUID(),
              snapshotId: site.bundleId,
              pageId: "entry",
              formId: "form",
              values: {
                name: "PRIVATE_SOURCE_RECOVERY",
                count: 0,
                open: false,
              },
              publicationScope: [a.id, b.id].sort(),
              ttlMs: 180000,
            },
            sent = await sender.call("contribution-command", request);
          assert.equal(sent.error, undefined);
          await sender.stop();
          await assertOffline(sender);
          for (const dir of [ownerDir, senderDir])
            rmSync(join(dir, "store/objects", site.bundleId + ".json"));
          owner = await launch(
            ownerDir,
            0,
            0,
            backend === "node" ? "native" : "node",
          );
          peers.push(owner);
          sender = await launch(senderDir, 0, 0, backend);
          peers.push(sender);
          for (const p of [owner, sender]) {
            await p.call("unlock", { password });
            await p.call("settings", { relay: false });
          }
          const resumed = await sender.call("contribution-command", {
            action: "resume",
            sequence: 1,
            operationId: request.operationId,
          });
          assert.equal(resumed.error, undefined);
          assert.equal(
            resumed.operation.transport.bundleId,
            sent.operation.transport.bundleId,
          );
          await sender.call("connect", {
            host: "127.0.0.1",
            port: owner.tcpPort,
          });
          const missing = await until(
            () => owner.call("contribution-command", { action: "inbox" }),
            (v) =>
              v.items.some((i: any) => i.id === sent.operation.certificateId),
          );
          assert.equal(missing.items[0].status, "missing-source");
          for (const dir of [ownerDir, senderDir])
            assert.equal(
              existsSync(join(dir, "store/objects", site.bundleId + ".json")),
              false,
            );
          await assert.rejects(
            owner.call("contribution-command", {
              action: "obtain-source",
              id: "f".repeat(64),
            }),
          );
          await assert.rejects(
            owner.call("contribution-command", {
              action: "obtain-source",
              id: sent.operation.certificateId,
              snapshotId: site.bundleId,
            }),
          );
          if (mode === "cancel")
            await sender.call("contribution-command", {
              action: "cancel",
              sequence: 1,
              operationId: request.operationId,
            });
          if (mode === "block")
            await sender.call("action", {
              action: "block",
              target: a.id,
              value: true,
            });
          const queried = await owner.call("contribution-command", {
            action: "obtain-source",
            id: sent.operation.certificateId,
          });
          assert.equal(queried.snapshotId, site.bundleId);
          assert.equal(queried.status, "waiting");
          if (mode !== "recover") {
            const marker = await sender.call("publish", {
              content: {
                type: "post",
                text: "POSITIVE_CHANNEL_WHILE_SOURCE_DENIED",
              },
              recipients: "public",
            });
            await until(
              () => owner.call("state"),
              (s) => s.objects.some((o: any) => o.id === marker.id),
            );
            const deadline = Date.now() + 1600;
            while (Date.now() < deadline) {
              assert.equal(
                existsSync(
                  join(ownerDir, "store/objects", site.bundleId + ".json"),
                ),
                false,
              );
              await delay(100);
            }
            assert.equal(
              (await owner.call("contribution-command", { action: "inbox" }))
                .items[0].status,
              "missing-source",
            );
            if (mode === "cancel") return;
            await sender.call("action", {
              action: "block",
              target: a.id,
              value: false,
            });
            await sender.call("contribution-command", {
              action: "resume",
              sequence: 1,
              operationId: request.operationId,
            });
          }
          const recovered = await until(
            async () => {
              await owner.call("contribution-command", {
                action: "obtain-source",
                id: sent.operation.certificateId,
              });
              return owner.call("contribution-command", { action: "inbox" });
            },
            (v) =>
              v.items.some(
                (i: any) =>
                  i.id === sent.operation.certificateId &&
                  i.status === "verified-candidate",
              ),
          );
          assert.deepEqual(recovered.items[0].values, request.values);
          const actual = JSON.parse(
            readFileSync(
              join(ownerDir, "store/objects", site.bundleId + ".json"),
              "utf8",
            ),
          );
          assert.equal(canonical(actual), canonical(source));
          assert.equal(actual.manifest.author.id, a.id);
          assert.equal(
            existsSync(
              join(senderDir, "store/objects", site.bundleId + ".json"),
            ),
            false,
            "source was served from private evidence, not recreated in ordinary cache",
          );
          assert.equal(
            (
              await owner.call("contribution-command", {
                action: "obtain-source",
                id: sent.operation.certificateId,
              })
            ).status,
            "available",
          );
        } finally {
          for (const p of peers) await p.stop();
          for (const dir of new Set(peers.map((p) => p.dir)))
            rmSync(dir, { recursive: true, force: true });
        }
      },
    );
