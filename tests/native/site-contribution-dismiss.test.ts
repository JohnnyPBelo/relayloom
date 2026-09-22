import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { createIdentity, createBundleAt } from "../../packages/core/src/index";
import { nodeCertificateCrypto } from "../../packages/core/src/certificate-crypto";
import { createSiteContributionProtocol } from "../../packages/sites/src/contribution-protocol";
import { siteFormBlocks } from "../../packages/content/src/site";
import { Router } from "../../packages/transport/src/index";
import { formPayload } from "../fixtures/site-form";
import { launch, password, until, type Client } from "../helpers";
import { assertOffline } from "../fixtures/offline-process";

for (const backend of ["node", "native"] as const)
  for (const missing of [false, true])
    test(
      `${backend} owner discards a blocked ${missing ? "missing-source" : "verified"} proposal across TCP/restart/replay with a positive channel control`,
      { timeout: 60000 },
      async () => {
        const peers: Client[] = [],
          wire = new Router(),
          visitor = createIdentity("Visitor for local disposal");
        let owner = await launch(undefined, 0, 0, backend);
        peers.push(owner);
        try {
          const card = await owner.call("setup", {
              name: "Inbox owner",
              password,
            }),
            payload = formPayload([visitor.public.id]),
            address = "relayloom:site:" + card.id + "/profile",
            state = await owner.call("site-command", {
              action: "state",
              address,
            }),
            op = (
              await owner.call("site-command", {
                action: "publish",
                name: "profile",
                sequence: state.nextSequence,
                expectedBase: state.base,
                operationId: randomUUID(),
                payload,
                recipients: "public",
                ttlMs: 3600000,
              })
            ).operation,
            viewed = await owner.call("view", { id: op.bundleId }),
            binding = siteFormBlocks(payload.site)[0],
            protocol = createSiteContributionProtocol(nodeCertificateCrypto),
            now = Date.now(),
            request = {
              target: {
                site: address,
                snapshotId: op.bundleId,
                revisionId: viewed.content.siteRevision.id,
                pageId: "entry",
                formId: "form",
              },
              schemaHash: protocol.schemaHash(binding.form, binding.table),
              operationId: randomUUID(),
              created: now,
              expires: now + 180000,
              values: {
                name: "PRIVATE_DISCARD_VALUES_39841",
                count: 0,
                open: false,
              },
              publicationScope: "public" as const,
            },
            cert = protocol.create(visitor, request),
            envelope = () =>
              createBundleAt(
                visitor,
                "site-contribution",
                { type: "site-contribution", proposal: cert },
                [card],
                180000,
                now,
              );
          const directory = owner.dir;
          if (missing) {
            await owner.stop();
            await assertOffline(owner);
            rmSync(join(directory, "store/objects", op.bundleId + ".json"));
            owner = await launch(directory, 0, 0, backend);
            peers.push(owner);
            await owner.call("unlock", { password });
          }
          await owner.call("settings", { relay: false });
          wire.connectTcp("127.0.0.1", owner.tcpPort);
          await until(
            async () => wire.peers,
            (p) => p.some((v) => v.connected),
          );
          wire.broadcast({ type: "bundle", bundle: envelope() });
          const before = await until(
            () => owner.call("contribution-command", { action: "inbox" }),
            (v) => v.items.some((i: any) => i.id === cert.id),
          );
          assert.equal(
            before.items[0].status,
            missing ? "missing-source" : "verified-candidate",
          );
          for (const bad of [
            {
              action: "dismiss",
              id: cert.id,
              revision: before.management.revision,
              approved: true,
            },
            {
              action: "dismiss",
              id: cert.id,
              revision: before.management.revision + 1,
            },
            { action: "dismiss", id: cert.id, revision: -1 },
            {
              action: "dismiss",
              id: "f".repeat(64),
              revision: before.management.revision,
            },
          ])
            await assert.rejects(owner.call("contribution-command", bad));
          await owner.call("action", {
            action: "block",
            target: visitor.public.id,
            value: true,
          });
          const blocked = await owner.call("contribution-command", {
            action: "inbox",
          });
          assert.deepEqual(blocked.items, []);
          assert.equal(blocked.management.entries[0].id, cert.id);
          assert(!JSON.stringify(blocked).includes(request.values.name));
          assert.equal(blocked.management.entries[0].proof, undefined);
          const discard = {
              action: "dismiss",
              id: cert.id,
              revision: blocked.management.revision,
            },
            result = await owner.call("contribution-command", discard);
          assert.equal(result.entry.phase, "dismissed");
          assert.equal(result.entry.proof, null);
          assert.equal(result.entry.verifiedAt === null, missing);
          assert.deepEqual(
            await owner.call("contribution-command", discard),
            result,
          );
          await owner.stop();
          await assertOffline(owner);
          owner = await launch(directory, 0, 0, backend);
          peers.push(owner);
          await assert.rejects(owner.call("contribution-command", discard));
          await owner.call("unlock", { password });
          await owner.call("action", {
            action: "block",
            target: visitor.public.id,
            value: false,
          });
          wire.connectTcp("127.0.0.1", owner.tcpPort);
          await until(
            () => owner.call("state"),
            (s) => s.peers.some((p: any) => p.connected),
          );
          const replay = envelope();
          wire.broadcast({ type: "bundle", bundle: replay });
          const positive = createBundleAt(
            visitor,
            "post",
            { type: "post", text: "CHANNEL_AFTER_DISCARD_REPLAY" },
            "public",
            180000,
            Date.now(),
          );
          wire.broadcast({ type: "bundle", bundle: positive });
          await until(
            () => owner.call("state"),
            (s) =>
              s.objects.some((o: any) => o.id === positive.manifest.id) &&
              s.objects.some((o: any) => o.id === replay.manifest.id),
          );
          const after = await owner.call("contribution-command", {
            action: "inbox",
          });
          assert.deepEqual(after.items, []);
          assert.equal(after.management.entries[0].phase, "dismissed");
          assert.deepEqual(
            await owner.call("contribution-command", discard),
            result,
          );
          await assert.rejects(
            owner.call("contribution-command", {
              action: "obtain-source",
              id: cert.id,
            }),
          );
          // The same contributor can submit a new operation after unblocking.
          const another = protocol.create(visitor, {
            ...request,
            operationId: randomUUID(),
            values: { ...request.values, name: "NEW_OPERATION_AFTER_DISCARD" },
          });
          wire.broadcast({
            type: "bundle",
            bundle: createBundleAt(
              visitor,
              "site-contribution",
              { type: "site-contribution", proposal: another },
              [card],
              180000,
              now,
            ),
          });
          const live = await until(
            () => owner.call("contribution-command", { action: "inbox" }),
            (v) => v.items.some((i: any) => i.id === another.id),
          );
          assert.equal(
            live.items.some((i: any) => i.id === cert.id),
            false,
          );
          assert.equal((await owner.call("state")).settings.relay, false);
        } finally {
          await wire.stop();
          for (const p of peers) await p.stop();
        }
      },
    );
