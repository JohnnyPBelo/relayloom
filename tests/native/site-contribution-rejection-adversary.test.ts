import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  createIdentity,
  createBundleAt,
  verifyBundle,
  type Bundle,
} from "../../packages/core/src/index";
import { nodeCertificateCrypto } from "../../packages/core/src/certificate-crypto";
import { createSiteContentProtocol } from "../../packages/sites/src/content";
import { createContributionRejectionProtocol } from "../../packages/sites/src/contribution-rejection";
import { Router } from "../../packages/transport/src/index";
import { launch, password, until } from "../helpers";
import { formPayload } from "../fixtures/site-form";

for (const backend of ["node", "native"] as const)
  test(
    `${backend} refuses forged, public and cross-reference rejection traffic with positive packets on the same live channel`,
    { timeout: 60000 },
    async () => {
      const visitor = await launch(undefined, 0, 0, backend),
        owner = createIdentity("Rejection authority"),
        other = createIdentity("Wrong rejection authority"),
        wire = new Router();
      try {
        const card = await visitor.call("setup", {
          name: "Rejection visitor",
          password,
        });
        await visitor.call("contact", { contact: owner.public });
        await visitor.call("settings", { relay: false });
        const sourceContent = createSiteContentProtocol(
            nodeCertificateCrypto,
          ).create(owner, "profile", 1, [], formPayload([card.id])),
          source = createBundleAt(
            owner,
            "site",
            sourceContent,
            "public",
            3600000,
            Date.now(),
          );
        wire.connectTcp("127.0.0.1", visitor.tcpPort);
        await until(
          async () => wire.peers,
          (p) => p.some((x) => x.connected),
        );
        wire.broadcast({ type: "bundle", bundle: source });
        await until(
          () => visitor.call("state"),
          (s) => s.objects.some((o: any) => o.id === source.manifest.id),
        );
        const request = {
            action: "submit",
            sequence: 1,
            operationId: randomUUID(),
            snapshotId: source.manifest.id,
            pageId: "entry",
            formId: "form",
            values: {
              name: "REJECTION_ADVERSARY_PRIVATE",
              count: 0,
              open: false,
            },
            publicationScope: "public",
            ttlMs: 180000,
          },
          sent = await visitor.call("contribution-command", request),
          op = sent.operation;
        assert.equal(sent.error, undefined);
        assert.equal(op.transport.copied, true);
        const protocol = createContributionRejectionProtocol(
            nodeCertificateCrypto,
          ),
          intent = {
            contributorId: card.id,
            certificateId: op.certificateId,
            operationId: op.operationId,
            target: op.target,
            proposalCreated: op.created,
            proposalExpires: op.expires,
            decidedAt: op.created,
            reason: "PRIVATE_REFUSAL_REASON",
            expires: op.created + 3600000,
          },
          rejection = protocol.create(owner, intent),
          content = { type: "site-contribution-rejection", rejection },
          seal = (
            value: unknown = content,
            actor = owner,
            readers: any = [card],
            created = intent.decidedAt,
            ttl = intent.expires - intent.decidedAt,
          ) =>
            createBundleAt(
              actor,
              "site-contribution-rejection",
              value,
              readers,
              ttl,
              created,
            );
        await assert.rejects(
          visitor.call("publish", { content, recipients: [owner.public.id] }),
          /contribui/i,
        );
        const forged = structuredClone(content);
        forged.rejection.signature = "A".repeat(88);
        const wrongReference = {
          type: "site-contribution-rejection",
          rejection: protocol.create(owner, {
            ...intent,
            certificateId: "f".repeat(64),
          }),
        };
        const wrongUUID = {
          type: "site-contribution-rejection",
          rejection: protocol.create(owner, {
            ...intent,
            operationId: randomUUID(),
          }),
        };
        const wrongOwner = {
          type: "site-contribution-rejection",
          rejection: protocol.create(other, {
            ...intent,
            target: {
              ...intent.target,
              site: "relayloom:site:" + other.public.id + "/profile",
            },
          }),
        };
        const bad: [string, Bundle][] = [
          ["public", seal(content, owner, "public")],
          ["extra-reader", seal(content, owner, [card, other.public])],
          ["outer-author", seal(content, other, [card, owner.public])],
          ["owner-signature", seal(forged)],
          ["other-certificate", seal(wrongReference)],
          ["other-operation", seal(wrongUUID)],
          ["other-owner", seal(wrongOwner, other, [card])],
          [
            "renewed-envelope",
            seal(content, owner, [card], intent.decidedAt + 1),
          ],
          ["extra-authority", seal({ ...content, approved: true })],
          [
            "oversized-control",
            seal({ ...content, padding: "x".repeat(9000) }),
          ],
        ];
        const corrupted = seal(),
          chunk = Object.keys(corrupted.chunks)[0],
          bytes = Buffer.from(corrupted.chunks[chunk], "base64");
        bytes[0] ^= 1;
        corrupted.chunks[chunk] = bytes.toString("base64");
        const signature = seal();
        signature.manifest.signature = "A".repeat(88);
        bad.push(
          ["cipher-corruption", corrupted],
          ["envelope-signature", signature],
        );
        for (const [name, bundle] of bad) {
          if (["cipher-corruption", "envelope-signature"].includes(name))
            assert.throws(() => verifyBundle(bundle));
          else verifyBundle(bundle);
          const before = (await visitor.call("state")).counters.rejected;
          wire.broadcast({ type: "bundle", bundle });
          await until(
            () => visitor.call("state"),
            (s) => s.counters.rejected > before,
          );
          const positive = createBundleAt(
            other,
            "post",
            { type: "post", text: "CHANNEL_AFTER_" + name },
            "public",
            60000,
            Date.now(),
          );
          wire.broadcast({ type: "bundle", bundle: positive });
          await until(
            () => visitor.call("state"),
            (s) => s.objects.some((o: any) => o.id === positive.manifest.id),
          );
          const current = (
            await visitor.call("contribution-command", {
              action: "operation",
              sequence: 1,
              operationId: op.operationId,
            })
          ).operation;
          assert.equal(current.phase, "queued", name);
          assert.equal(current.rejection, undefined, name);
          assert.equal(
            existsSync(
              join(visitor.dir, "store/objects", bundle.manifest.id + ".json"),
            ),
            false,
            name,
          );
          assert(
            wire.peers.some((p) => p.connected),
            name,
          );
        }
        const noKey = seal(content, owner, []);
        wire.broadcast({ type: "bundle", bundle: noKey });
        await until(
          async () =>
            existsSync(
              join(visitor.dir, "store/objects", noKey.manifest.id + ".json"),
            ),
          Boolean,
        );
        await assert.rejects(visitor.call("view", { id: noKey.manifest.id }));
        assert.equal(
          (
            await visitor.call("contribution-command", {
              action: "operation",
              sequence: 1,
              operationId: op.operationId,
            })
          ).operation.phase,
          "queued",
        );
        const valid = seal();
        wire.broadcast({ type: "bundle", bundle: valid });
        const confirmed = await until(
          () =>
            visitor.call("contribution-command", {
              action: "operation",
              sequence: 1,
              operationId: op.operationId,
            }),
          (v) => v.operation?.phase === "rejected",
        );
        assert.deepEqual(confirmed.operation.rejection, rejection);
        assert.equal(confirmed.operation.expires, op.expires);
        const repacked = seal();
        assert.notEqual(repacked.manifest.id, valid.manifest.id);
        wire.broadcast({ type: "bundle", bundle: repacked });
        await until(
          async () =>
            existsSync(
              join(
                visitor.dir,
                "store/objects",
                repacked.manifest.id + ".json",
              ),
            ),
          Boolean,
        );
        assert.deepEqual(
          (
            await visitor.call("contribution-command", {
              action: "operation",
              sequence: 1,
              operationId: op.operationId,
            })
          ).operation,
          confirmed.operation,
        );
      } finally {
        await wire.stop();
        await visitor.stop();
        rmSync(visitor.dir, { recursive: true, force: true });
      }
    },
  );
