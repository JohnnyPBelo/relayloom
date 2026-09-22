import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  canonical,
  decryptBundle,
  importVault,
  verifyBundle,
} from "../../packages/core/src/index";
import { launch, password, until, type Client } from "../helpers";
import { formPayload } from "../fixtures/site-form";
import { assertOffline } from "../fixtures/offline-process";
import { startPTY } from "./mixed-helper";

for (const backend of ["node", "native"] as const)
  test(
    `${backend} private proposals cross TCP/serial and an opaque seeder takes over after sender exit`,
    { timeout: 75000, skip: process.platform === "win32" },
    async () => {
      const link = await startPTY(),
        peers: Client[] = [];
      const path = (p: Client, id: string) =>
        join(p.dir, "store/objects", id + ".json");
      const stored = (p: Client, id: string) =>
        JSON.parse(readFileSync(path(p, id), "utf8"));
      try {
        const sender = await launch(undefined, 0, 0, backend);
        peers.push(sender);
        // Direct serial belongs to the Node adapter; Go reaches serial through
        // an actual heterogeneous route. This is PTY execution, not radio proof.
        const relay = await launch(undefined, 0, 0, "node");
        peers.push(relay);
        const owner = await launch(undefined, 0, -1, "node");
        peers.push(owner);
        const b = await sender.call("setup", {
            name: "Contribuidor TCP",
            password,
          }),
          r = await relay.call("setup", { name: "Relay sem chave", password }),
          a = await owner.call("setup", {
            name: "Dona apenas serial",
            password,
          });
        for (const peer of peers) await peer.call("settings", { relay: true });
        await sender.call("connect", {
          host: "127.0.0.1",
          port: relay.tcpPort,
        });
        await relay.call("serial", { path: link.left });
        await owner.call("serial", { path: link.right });
        await until(
          () => relay.call("state"),
          (s) => s.peers.filter((p: any) => p.connected).length === 2,
        );
        const topology = await owner.call("state"),
          senderTopology = await sender.call("state");
        assert.equal(topology.tcpPort, -1);
        assert.deepEqual(
          topology.peers.map((p: any) => p.medium),
          ["serial"],
        );
        assert.equal(senderTopology.peers.length, 1);
        assert.equal(senderTopology.peers[0].medium, "tcp");
        assert.equal(
          senderTopology.peers[0].address,
          `127.0.0.1:${relay.tcpPort}`,
        );
        const address = "relayloom:site:" + a.id + "/profile",
          state = await owner.call("site-command", {
            action: "state",
            address,
          }),
          publication = (
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
        await until(
          () => sender.call("state"),
          (s) => s.objects.some((o: any) => o.id === publication.bundleId),
        );
        await sender.call("settings", { relay: false });
        const submit = async (sequence: number, name: string) => {
          const result = await sender.call("contribution-command", {
            action: "submit",
            sequence,
            operationId: randomUUID(),
            snapshotId: publication.bundleId,
            pageId: "entry",
            formId: "form",
            values: { name, count: 0, open: false },
            publicationScope: [a.id, b.id].sort(),
            ttlMs: 180000,
          });
          assert.equal(result.error, undefined);
          assert.equal(result.operation.phase, "queued");
          assert.equal(result.operation.transport.copied, true);
          return result.operation;
        };
        const first = await submit(1, "POSITIVE_MULTI_ADAPTER_PROPOSAL");
        await until(
          () => owner.call("contribution-command", { action: "inbox" }),
          (v) => v.items.some((i: any) => i.id === first.certificateId),
        );
        const received = await owner.call("view", {
          id: first.transport.bundleId,
        });
        assert.equal(received.route.medium, "serial");
        assert.equal(received.route.hops.length, 2);
        assert.ok((await relay.call("state")).counters.forwarded > 0);
        link.partition();
        await delay(75);
        const second = await submit(2, "PRIVATE_SEEDED_AFTER_SENDER_EXIT"),
          id = second.transport.bundleId;
        await until(async () => existsSync(path(relay, id)), Boolean);
        const original = stored(sender, id),
          retained = stored(relay, id);
        verifyBundle(retained);
        assert.equal(canonical(retained), canonical(original));
        assert.equal(retained.manifest.author.id, b.id);
        assert.equal(
          retained.manifest.keys.some((k: any) => k.reader === r.id),
          false,
        );
        assert.equal(
          JSON.stringify(retained).includes("PRIVATE_SEEDED_AFTER_SENDER_EXIT"),
          false,
        );
        await assert.rejects(relay.call("view", { id }));
        const relayIdentity = importVault(
          (await relay.call("export", { password })).vault,
          password,
        );
        assert.throws(() => decryptBundle(retained, relayIdentity));
        assert.deepEqual(
          (await relay.call("contribution-command", { action: "inbox" })).items,
          [],
        );
        const assertAbsent = async (duration: number) => {
          const end = Date.now() + duration;
          do {
            assert.equal(
              existsSync(path(owner, id)),
              false,
              "proposal crossed a blocked path",
            );
            await delay(100);
          } while (Date.now() < end);
        };
        await assertAbsent(1300);
        await relay.call("settings", { relay: false });
        await sender.stop();
        await assertOffline(sender);
        link.partition();
        // Positive link control while forwarding is disabled: own traffic works.
        const probe = await relay.call("publish", {
          content: { type: "post", text: "SERIAL_HEALED_WITH_RELAY_PAUSED" },
          recipients: "public",
        });
        await until(
          () => owner.call("state"),
          (s) => s.objects.some((o: any) => o.id === probe.id),
        );
        await assertAbsent(1300);
        await relay.call("settings", { relay: true });
        const inbox = await until(
          () => owner.call("contribution-command", { action: "inbox" }),
          (v) => v.items.some((i: any) => i.id === second.certificateId),
        );
        const candidate = inbox.items.find(
          (i: any) => i.id === second.certificateId,
        );
        assert.equal(candidate.status, "verified-candidate");
        assert.equal(candidate.values.name, "PRIVATE_SEEDED_AFTER_SENDER_EXIT");
        assert.equal(candidate.contributor.id, b.id);
        assert.equal(canonical(stored(owner, id)), canonical(original));
        assert.equal((await owner.call("view", { id })).route.medium, "serial");
        await assertOffline(sender);
      } finally {
        for (const p of peers) await p.stop();
        await link.stop();
        for (const p of peers) rmSync(p.dir, { recursive: true, force: true });
      }
    },
  );
