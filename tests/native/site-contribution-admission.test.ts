import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  createIdentity,
  createBundleAt,
  verifyBundle,
} from "../../packages/core/src/index";
import { nodeCertificateCrypto } from "../../packages/core/src/certificate-crypto";
import { createSiteContributionProtocol } from "../../packages/sites/src/contribution-protocol";
import { siteFormBlocks } from "../../packages/content/src/site";
import { Router } from "../../packages/transport/src/index";
import { formPayload } from "../fixtures/site-form";
import { launch, password, until } from "../helpers";
for (const backend of ["node", "native"] as const)
  test(
    `${backend} refuses public or forged proposals before storage and withholds unauthorized candidates`,
    { timeout: 60000 },
    async () => {
      const owner = await launch(undefined, 0, 0, backend),
        visitor = createIdentity("Visitor"),
        other = createIdentity("Uninvited"),
        wire = new Router();
      const path = (id: string) =>
        join(owner.dir, "store/objects", id + ".json");
      try {
        const card = await owner.call("setup", {
            name: "Site owner",
            password,
          }),
          payload = formPayload([visitor.public.id]),
          address = "relayloom:site:" + card.id + "/profile";
        const state = await owner.call("site-command", {
            action: "state",
            address,
          }),
          op = (
            await owner.call("site-command", {
              action: "publish",
              name: "profile",
              sequence: state.nextSequence,
              operationId: randomUUID(),
              expectedBase: state.base,
              payload,
              recipients: "public",
              ttlMs: 3600000,
            })
          ).operation;
        const viewed = await owner.call("view", { id: op.bundleId }),
          binding = siteFormBlocks(payload.site)[0],
          protocol = createSiteContributionProtocol(nodeCertificateCrypto),
          now = Date.now();
        const request = {
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
          expires: now + 60000,
          values: { name: "VALID_PRIVATE_CANDIDATE", count: 0, open: false },
          publicationScope: "public" as const,
        };
        const proposal = protocol.create(visitor, request),
          content = { type: "site-contribution", proposal };
        wire.connectTcp("127.0.0.1", owner.tcpPort);
        await until(
          async () => wire.peers,
          (p) => p.some((v) => v.connected),
        );
        const malformed = structuredClone(content);
        malformed.proposal.body.values.name = "FORGED";
        const bad = [
          createBundleAt(
            visitor,
            "site-contribution",
            content,
            "public",
            60000,
            now,
          ),
          createBundleAt(
            visitor,
            "site-contribution",
            malformed,
            [card],
            60000,
            now,
          ),
          createBundleAt(
            visitor,
            "site-contribution",
            content,
            [card, other.public],
            60000,
            now,
          ),
          createBundleAt(
            other,
            "site-contribution",
            content,
            [card],
            60000,
            now,
          ),
          createBundleAt(
            visitor,
            "site-contribution",
            content,
            [card],
            60001,
            now,
          ),
        ];
        for (const bundle of bad) {
          verifyBundle(bundle);
          const before = (await owner.call("state")).counters.rejected;
          wire.broadcast({ type: "bundle", bundle });
          await until(
            () => owner.call("state"),
            (s) => s.counters.rejected > before,
          );
          assert.equal(existsSync(path(bundle.manifest.id)), false);
        }
        const denied = protocol.create(other, {
            ...request,
            operationId: randomUUID(),
          }),
          unauthorized = createBundleAt(
            other,
            "site-contribution",
            { type: "site-contribution", proposal: denied },
            [card],
            60000,
            now,
          );
        wire.broadcast({ type: "bundle", bundle: unauthorized });
        await until(
          async () => existsSync(path(unauthorized.manifest.id)),
          Boolean,
        );
        assert.equal(
          (
            await owner.call("contribution-command", { action: "inbox" })
          ).items.some((v: any) => v.id === denied.id),
          false,
        );
        const valid = createBundleAt(
          visitor,
          "site-contribution",
          content,
          [card],
          60000,
          now,
        );
        wire.broadcast({ type: "bundle", bundle: valid });
        await until(
          () => owner.call("contribution-command", { action: "inbox" }),
          (v) => v.items.some((i: any) => i.id === proposal.id),
        );
        const sameCertificate = createBundleAt(
          visitor,
          "site-contribution",
          content,
          [card],
          60000,
          now,
        );
        wire.broadcast({ type: "bundle", bundle: sameCertificate });
        await until(
          async () => existsSync(path(sameCertificate.manifest.id)),
          Boolean,
        );
        assert.equal(
          (
            await owner.call("contribution-command", { action: "inbox" })
          ).items.filter((v: any) => v.id === proposal.id).length,
          1,
        );
        await owner.call("action", {
          action: "block",
          target: visitor.public.id,
          value: true,
        });
        assert.equal(
          (
            await owner.call("contribution-command", { action: "inbox" })
          ).items.some((v: any) => v.id === proposal.id),
          false,
        );
        await owner.call("action", {
          action: "block",
          target: visitor.public.id,
          value: false,
        });
        assert.equal(
          (
            await owner.call("contribution-command", { action: "inbox" })
          ).items.some((v: any) => v.id === proposal.id),
          true,
        );
        await assert.rejects(
          owner.call("publish", { content, recipients: "public" }),
        );
      } finally {
        await wire.stop();
        await owner.stop();
        rmSync(owner.dir, { recursive: true, force: true });
      }
    },
  );
