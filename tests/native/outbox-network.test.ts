import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  createBundle,
  createIdentity,
  importVault,
  verifyBundle,
  type Bundle,
} from "../../packages/core/src/index.js";
import { Router } from "../../packages/transport/src/index.js";
import {
  cleanup,
  createRun,
  goExecutable,
  mixedPassword as password,
  objectAt,
  startClient,
  storedBundle,
  waitFor,
  writeReport,
  type MixedClient,
  type Runtime,
} from "./mixed-helper.js";

const outboxPolicy = {
  maxRecords: 256,
  maxPending: 128,
  maxPendingBytes: 33554432,
  idempotency: "retained-records",
};

function productionDigest() {
  const paths: string[] = [];
  const collect = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) collect(path);
      else if (/\.(ts|go)$/.test(path) && !path.endsWith("_test.go"))
        paths.push(path);
    }
  };
  for (const directory of [
    "apps/node/src",
    "packages/core/src",
    "packages/transport/src",
    "packages/profile/src",
    "packages/groups/src",
    "native/app",
    "native/core",
    "native/transport",
    "native/profilelock",
    "native/profilebinding",
    "native/profiledb",
    "native/profilestate",
    "native/groupstore",
    "native/groups",
    "native/groupauthority",
    "native/groupaccess",
    "native/groupledger",
    "native/sqlitedriver",
    "native/cmd/relayloom",
  ])
    collect(directory);
  paths.push("package-lock.json", "native/go.mod", "native/go.sum");
  const hash = createHash("sha256");
  for (const path of paths.sort())
    hash.update(path).update("\0").update(readFileSync(path));
  return hash.digest("hex");
}

// This transparent fixture forwards the exact TCP bytes. It observes complete
// bundle packets and their ACKs, without decrypting payloads or issuing ACKs.
async function observeRelay(port: number) {
  const sockets = new Set<Socket>();
  const packetBundles = new Map<string, string>();
  const acknowledged = new Set<string>();
  const assemblies = new Map<string, Map<number, string>>();
  let closed = false;
  const server = createServer((sender) => {
    const relay = createConnection({ host: "127.0.0.1", port });
    for (const socket of [sender, relay]) {
      sockets.add(socket);
      socket.on("error", () => {
        sender.destroy();
        relay.destroy();
      });
      socket.on("close", () => {
        sockets.delete(socket);
        sender.destroy();
        relay.destroy();
      });
    }
    const observe = (socket: Socket, outbound: boolean) => {
      let buffer = "";
      socket.on("data", (bytes: Buffer) => {
        buffer += bytes.toString("utf8");
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          if (!line) continue;
          const frame = JSON.parse(line);
          if (!outbound && frame.t === "ack") {
            const id = packetBundles.get(frame.id);
            if (id) acknowledged.add(id);
          } else if (outbound && frame.t === "part") {
            const parts = assemblies.get(frame.id) ?? new Map();
            assemblies.set(frame.id, parts);
            parts.set(frame.index, frame.data);
            if (parts.size !== frame.count) continue;
            const packet = JSON.parse(
              Buffer.concat(
                Array.from({ length: frame.count }, (_, index) =>
                  Buffer.from(parts.get(index)!, "base64"),
                ),
              ).toString("utf8"),
            );
            assemblies.delete(frame.id);
            if (packet.payload?.type === "bundle")
              packetBundles.set(frame.id, packet.payload.bundle.manifest.id);
          }
        }
      });
    };
    observe(sender, true);
    observe(relay, false);
    sender.pipe(relay);
    relay.pipe(sender);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    port: (server.address() as { port: number }).port,
    acknowledged,
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function item(client: MixedClient, operationId: string) {
  const state = await client.call("state");
  assert.ok(Array.isArray(state.outbox), "unlocked state exposes an outbox");
  const result = state.outbox.find(
    (entry: any) => entry.operationId === operationId,
  );
  assert.ok(result, "the durable operation remains in outbox metadata");
  assert.equal("fingerprint" in result, false);
  assert.equal("phase" in result, false);
  return result;
}

async function waitItem(
  client: MixedClient,
  operationId: string,
  predicate: (entry: any) => boolean,
  label: string,
  timeout = 15000,
) {
  return waitFor(label, () => item(client, operationId), predicate, timeout);
}

async function remainsPending(
  client: MixedClient,
  operationId: string,
  duration = 1200,
) {
  const until = Date.now() + duration;
  do {
    const current = await item(client, operationId);
    assert.equal(current.status, "pending");
    assert.equal(current.receivedCount, 0);
    assert.equal(current.readCount, 0);
    await delay(150);
  } while (Date.now() < until);
}

function pinned(client: MixedClient, id: string): boolean {
  return (
    JSON.parse(readFileSync(join(client.dir, "store/index.json"), "utf8"))[id]
      ?.pinned === true
  );
}

function confirmations(entry: any) {
  return {
    status: entry.status,
    receivedCount: entry.receivedCount,
    readCount: entry.readCount,
    recipients: entry.recipients,
  };
}

for (const senderRuntime of ["node", "go"] as const) {
  const otherRuntime: Runtime = senderRuntime === "node" ? "go" : "node";
  test(
    `${senderRuntime} outbox → ${otherRuntime} relay → ${otherRuntime} recipient: durable restart, real ACK control, signed group confirmations and expiry`,
    { timeout: 180000 },
    async () => {
      assert.ok(
        existsSync(goExecutable),
        "Build the current native application before this gate",
      );
      const run = createRun("outbox-" + senderRuntime);
      const clients: MixedClient[] = [];
      const controls: string[] = [];
      const started = new Date().toISOString();
      const engineSources = productionDigest();
      const nativeBinary = createHash("sha256")
        .update(readFileSync(goExecutable))
        .digest("hex");
      let tap: Awaited<ReturnType<typeof observeRelay>> | undefined;
      let injector: Router | undefined;
      let successful = false;
      let failure: string | undefined;
      try {
        let a = await startClient(
          senderRuntime,
          "A durable sender",
          join(run, "a"),
        );
        clients.push(a);
        const b = await startClient(
          otherRuntime,
          "B intermediary",
          join(run, "b"),
        );
        clients.push(b);
        const c = await startClient(
          otherRuntime,
          "C recipient",
          join(run, "c"),
          -1,
        );
        clients.push(c);
        const alice = await a.call("setup", { name: "Outbox Alice", password });
        const bob = await b.call("setup", { name: "Outbox Bob", password });
        const carol = await c.call("setup", { name: "Outbox Carol", password });
        for (const [client, own] of [
          [a, alice],
          [b, bob],
          [c, carol],
        ] as const)
          for (const card of [alice, bob, carol])
            if (card.id !== own.id)
              await client.call("contact", { contact: card });
        await a.call("settings", { relay: false });
        assert.equal((await a.call("state")).peers.length, 0);
        assert.deepEqual((await a.call("state")).outboxPolicy, outboxPolicy);

        const operationId = randomUUID();
        const request = {
          operationId,
          content: {
            type: "message",
            text: "Durable private intent " + randomUUID(),
          },
          recipients: [carol.id],
        };
        const accepted = await a.call("send", request);
        assert.equal(accepted.accepted, true);
        assert.equal(accepted.outbox.status, "pending");
        assert.equal(accepted.outbox.id, accepted.id);
        assert.equal(accepted.outbox.recipientCount, 1);
        assert.equal(accepted.outbox.retained, true);
        assert.equal(pinned(a, accepted.id), true);
        const originalBytes = readFileSync(
          join(a.dir, "store/objects", accepted.id + ".json"),
        );
        verifyBundle(storedBundle(a, accepted.id));
        assert.equal((await a.call("send", request)).id, accepted.id);
        const changed = await a.request("send", {
          ...request,
          content: { type: "message", text: "Different intent must conflict" },
        });
        assert.ok(changed.status >= 400 && changed.status < 500);
        assert.equal(
          (
            await a.request("action", {
              action: "pin",
              target: accepted.id,
              value: false,
            })
          ).status,
          400,
        );
        const encrypted = readFileSync(
          join(a.dir, "profile-state.sqlite"),
          "utf8",
        );
        assert.equal(encrypted.includes(operationId), false);
        assert.equal(encrypted.includes(request.content.text), false);
        await a.call("lock", {});
        assert.deepEqual((await a.call("state")).outbox, []);
        await a.stop();
        a = await startClient(
          senderRuntime,
          "A restarted pending sender",
          join(run, "a"),
        );
        clients.push(a);
        assert.deepEqual((await a.call("state")).outbox, []);
        await a.call("unlock", { password });
        assert.equal((await a.call("state")).settings.relay, false);
        assert.equal((await item(a, operationId)).status, "pending");
        assert.equal((await a.call("send", request)).id, accepted.id);
        assert.ok(
          originalBytes.equals(
            readFileSync(join(a.dir, "store/objects", accepted.id + ".json")),
          ),
        );
        assert.equal(pinned(a, accepted.id), true);
        controls.push(
          "Offline acceptance, encrypted metadata, exact idempotency/conflict rejection, automatic pin protection and pending bytes survived sender lock/restart with relay-for-others disabled.",
        );

        tap = await observeRelay(b.tcpPort);
        await a.call("connect", { host: "127.0.0.1", port: tap.port });
        await waitFor(
          "relay ACK for the original bundle",
          async () => tap!.acknowledged.has(accepted.id),
          Boolean,
        );
        assert.ok(
          existsSync(join(b.dir, "store/objects", accepted.id + ".json")),
        );
        assert.equal(
          (await b.request("view", { id: accepted.id })).status,
          400,
        );
        assert.equal((await c.call("state")).peers.length, 0);
        assert.equal((await c.call("state")).tcpPort, -1);
        assert.equal((await a.call("state")).peers.length, 1);
        assert.equal((await b.call("state")).peers.length, 1);
        await remainsPending(a, operationId);
        controls.push(
          "Transparent TCP observation saw an actual ACK for the exact original bundle from B. B stored ciphertext but could not read it; isolated C had no path and A remained pending with zero confirmations.",
        );

        const aliceKeys = importVault(
          (await a.call("export", { password })).vault,
          password,
        );
        const carolKeys = importVault(
          (await c.call("export", { password })).vault,
          password,
        );
        const stranger = createIdentity("Outbox adversarial fixture");
        const invalid: Bundle[] = [
          createBundle(
            aliceKeys,
            "delivery",
            { type: "delivery", target: accepted.id },
            [carol],
          ),
          createBundle(
            carolKeys,
            "delivery",
            { type: "delivery", target: accepted.id },
            "public",
          ),
          createBundle(
            carolKeys,
            "delivery",
            { type: "delivery", target: accepted.id },
            [alice, bob],
          ),
          createBundle(
            stranger,
            "delivery",
            { type: "delivery", target: accepted.id },
            [alice, carol],
          ),
          createBundle(
            carolKeys,
            "receipt",
            { type: "receipt", target: accepted.id },
            "public",
          ),
          createBundle(
            carolKeys,
            "delivery",
            { type: "delivery", target: "f".repeat(64) },
            [alice],
          ),
        ];
        const damaged = createBundle(
          carolKeys,
          "delivery",
          { type: "delivery", target: accepted.id },
          [alice],
        );
        damaged.manifest.signature = "A".repeat(
          damaged.manifest.signature.length,
        );
        invalid.push(damaged);
        injector = new Router({ relay: false });
        injector.connectTcp("127.0.0.1", a.tcpPort);
        await waitFor(
          "adversarial transport fixture connected",
          async () => injector!.peers,
          (peers) => peers.some((peer) => peer.connected),
        );
        const canary = createBundle(
          stranger,
          "post",
          {
            type: "post",
            text: "Adversarial TCP fixture reachability control",
          },
          "public",
        );
        injector.broadcast({ type: "bundle", bundle: canary });
        await objectAt(a, canary.manifest.id);
        for (const bundle of invalid) {
          injector.broadcast({ type: "bundle", bundle });
          await delay(40);
        }
        await remainsPending(a, operationId, 1600);
        const afterInvalid = await a.call("state");
        for (const bundle of invalid)
          assert.equal(
            afterInvalid.objects.some(
              (object: any) => object.id === bundle.manifest.id,
            ),
            false,
          );
        controls.push(
          "A real TCP fixture first delivered a valid signed canary, then injected owner-authored, public, widened-reader, foreign-author, wrong-target and damaged-signature confirmations. None became authorized objects or advanced outbox state.",
        );

        await c.call("connect", { host: "127.0.0.1", port: b.tcpPort });
        assert.equal(
          (await objectAt(c, accepted.id)).content.text,
          request.content.text,
        );
        const received = await waitItem(
          a,
          operationId,
          (entry) => entry.status === "received",
          "signed recipient acceptance",
        );
        assert.equal(received.receivedCount, 1);
        assert.equal(received.readCount, 0);
        assert.equal(received.retained, true);
        assert.equal(received.accepted, true);
        assert.equal(pinned(a, accepted.id), false);
        const deliveryState = await c.call("state");
        const delivery = deliveryState.objects.find(
          (object: any) =>
            object.kind === "delivery" &&
            object.content.target === accepted.id &&
            object.author.id === carol.id,
        );
        assert.ok(delivery, "recipient stores a signed delivery event");
        const deliveryBundle = storedBundle(c, delivery.id);
        verifyBundle(deliveryBundle);
        assert.equal(deliveryBundle.manifest.publicKey, null);
        assert.deepEqual(
          deliveryBundle.manifest.keys.map((key: any) => key.reader).sort(),
          [alice.id, carol.id].sort(),
        );
        const beforeReplay = confirmations(received);
        for (let repeat = 0; repeat < 3; repeat++) {
          injector.broadcast({ type: "bundle", bundle: deliveryBundle });
          await delay(80);
        }
        // Also inject a freshly signed reissue: deduplicating a wire packet alone is insufficient.
        const reissue = createBundle(
          carolKeys,
          "delivery",
          { type: "delivery", target: accepted.id },
          [alice],
        );
        injector.broadcast({ type: "bundle", bundle: reissue });
        await objectAt(a, reissue.manifest.id);
        assert.deepEqual(
          confirmations(await item(a, operationId)),
          beforeReplay,
        );
        await c.call("view", { id: accepted.id });
        const read = await waitItem(
          a,
          operationId,
          (entry) => entry.status === "read",
          "signed recipient read receipt",
        );
        assert.equal(read.readCount, 1);
        assert.equal(
          read.recipients[0].receivedAt,
          received.recipients[0].receivedAt,
        );
        controls.push(
          "C later received the exact message through B and signed a private delivery event with the original reader set. Replayed bundles and a freshly signed reissue left counters/timestamps unchanged; an explicit view advanced read separately.",
        );
        await injector.stop();
        injector = undefined;

        const readBeforeRestart = confirmations(read);
        await a.stop();
        a = await startClient(
          senderRuntime,
          "A restarted confirmed sender",
          join(run, "a"),
        );
        clients.push(a);
        assert.deepEqual((await a.call("state")).outbox, []);
        await a.call("unlock", { password });
        assert.deepEqual(
          confirmations(await item(a, operationId)),
          readBeforeRestart,
        );
        await waitFor(
          "sender reconnects only to the relay fixture",
          () => a.call("state"),
          (state) => state.peers.length === 1 && state.peers[0].connected,
        );
        assert.equal(
          (await a.call("state")).peers[0].address,
          "127.0.0.1:" + tap.port,
        );

        const group = await b.call("publish", {
          content: { type: "group", title: "Fixed outbox group" },
          recipients: [alice.id, carol.id],
        });
        await objectAt(a, group.id);
        await objectAt(c, group.id);
        await c.call("action", {
          action: "block",
          target: bob.id,
          value: true,
        });
        assert.equal(
          (await c.call("state")).objects.some(
            (object: any) => object.id === group.id,
          ),
          false,
          "the blocked creator's group object stays hidden while its signed ACL remains usable",
        );
        const groupOperation = randomUUID();
        const attachment = Buffer.from(
          "Blocked group attachment remains readable",
        );
        const groupMessage = await a.call("send", {
          operationId: groupOperation,
          content: {
            type: "message",
            conversation: group.id,
            text: "Two-member confirmation control",
            attachments: [
              {
                name: "group.txt",
                mime: "text/plain",
                data: attachment.toString("base64"),
              },
            ],
          },
          recipients: [carol.id, bob.id],
        });
        await objectAt(c, groupMessage.id);
        await waitItem(
          a,
          groupOperation,
          (entry) => entry.receivedCount === 1,
          "only unblocked group reader confirms",
        );
        assert.deepEqual(
          Buffer.from(
            (await c.call("attachment", { id: groupMessage.id, index: 0 }))
              .data,
            "base64",
          ),
          attachment,
        );
        await c.call("view", { id: groupMessage.id });
        await b.call("view", { id: groupMessage.id });
        const partial = await waitItem(
          a,
          groupOperation,
          (entry) => entry.readCount === 1,
          "partial group read remains pending",
        );
        assert.equal(partial.status, "pending");
        assert.equal(partial.recipientCount, 2);
        assert.equal(partial.receivedCount, 1);
        const cEvents = (await c.call("state")).objects.filter(
          (object: any) =>
            ["delivery", "receipt"].includes(object.kind) &&
            object.content.target === groupMessage.id &&
            object.author.id === carol.id,
        );
        assert.equal(cEvents.length, 0);
        await a.call("action", {
          action: "block",
          target: carol.id,
          value: true,
        });
        const blocked = await waitItem(
          a,
          groupOperation,
          (entry) => entry.status === "blocked",
          "sender block suppresses retry",
        );
        const retry = await a.request("outbox-retry", {
          operationId: groupOperation,
        });
        assert.ok(retry.status === 200 || retry.status === 400);
        await delay(2500);
        assert.equal(
          (await item(a, groupOperation)).attempts,
          blocked.attempts,
        );
        assert.equal(pinned(a, groupMessage.id), true);
        assert.equal(
          (
            await a.request("action", {
              action: "pin",
              target: groupMessage.id,
              value: false,
            })
          ).status,
          400,
        );
        await a.call("action", {
          action: "block",
          target: carol.id,
          value: false,
        });
        await c.call("action", {
          action: "block",
          target: bob.id,
          value: false,
        });
        await waitItem(
          a,
          groupOperation,
          (entry) => entry.receivedCount === 2,
          "unblocked group reader delivers",
        );
        await c.call("view", { id: groupMessage.id });
        const allRead = await waitItem(
          a,
          groupOperation,
          (entry) => entry.status === "read",
          "every fixed-group reader confirms read",
        );
        assert.equal(allRead.readCount, 2);
        assert.equal(allRead.receivedCount, 2);
        assert.equal(pinned(a, groupMessage.id), false);
        controls.push(
          "A fixed group required both original readers. C hid the blocked group creator B but still authorized A's message against the signed group ACL; automatic delivery/read stayed suppressed while attachment/view worked. Sender block suppressed retries without releasing its pin; unblocking allowed both members to reach received/read.",
        );

        // Keep enough newer objects to move all original content/events out of
        // the default 100-object page; durable outbox confirmations must remain.
        for (let index = 0; index < 103; index++) {
          await a.call("publish", {
            content: {
              type: "post",
              text: "Outbox history pagination " + index,
            },
            recipients: "public",
          });
          await delay(25);
        }
        const paged = await a.call("state");
        assert.equal(
          paged.objects.some((object: any) => object.id === accepted.id),
          false,
        );
        assert.deepEqual(
          confirmations(await item(a, operationId)),
          readBeforeRestart,
        );
        assert.deepEqual(
          confirmations(await item(a, groupOperation)),
          confirmations(allRead),
        );
        controls.push(
          "Confirmed metadata survived a sender restart and remained unchanged after 103 newer objects moved the original messages/events outside the default page.",
        );

        await tap.close();
        await waitFor(
          "sender is physically partitioned",
          () => a.call("state"),
          (state) => !state.peers.some((peer: any) => peer.connected),
        );
        const expiringRequest = {
          operationId: randomUUID(),
          content: {
            type: "message",
            text: "Short TTL during actual socket partition",
          },
          recipients: [carol.id],
          ttlMs: 1500,
        };
        const expiring = await a.call("send", expiringRequest);
        assert.equal(expiring.accepted, true);
        const expired = await waitItem(
          a,
          expiringRequest.operationId,
          (entry) => entry.status === "expired",
          "partitioned intent expires",
          8000,
        );
        assert.equal(expired.contentExpired, true);
        assert.equal(expired.receivedCount, 0);
        assert.equal(expired.readCount, 0);
        assert.equal(pinned(a, expiring.id), false);
        const missingRequest = {
          operationId: randomUUID(),
          content: { type: "message", text: "Missing reserved bytes control" },
          recipients: [carol.id],
        };
        const missing = await a.call("send", missingRequest);
        assert.equal(missing.accepted, true);
        await a.stop();
        // These are deliberately removed fixture files, with their owning
        // process stopped. This is disk-failure injection, not a power cut.
        unlinkSync(join(a.dir, "store/objects", accepted.id + ".json"));
        unlinkSync(join(a.dir, "store/objects", missing.id + ".json"));
        a = await startClient(
          senderRuntime,
          "A restarted expired sender",
          join(run, "a"),
        );
        clients.push(a);
        await a.call("unlock", { password });
        assert.equal(
          (await item(a, expiringRequest.operationId)).status,
          "expired",
        );
        const repeatedExpiry = await a.call("send", expiringRequest);
        assert.equal(repeatedExpiry.id, expiring.id);
        assert.equal(repeatedExpiry.accepted, false);
        const missingResult = await a.call("send", missingRequest);
        assert.equal(missingResult.id, missing.id);
        assert.equal(missingResult.accepted, false);
        assert.equal(missingResult.outbox.status, "unavailable");
        assert.equal(missingResult.outbox.retained, false);
        const historical = await a.call("send", request);
        assert.equal(historical.id, accepted.id);
        assert.equal(historical.accepted, false);
        assert.equal(historical.outbox.retained, false);
        assert.deepEqual(confirmations(historical.outbox), readBeforeRestart);
        const reservedRequest = {
          operationId: randomUUID(),
          content: {
            type: "message",
            text: "Pending intent survives terminal metadata pruning",
          },
          recipients: [carol.id],
          ttlMs: 300000,
        };
        const reserved = await a.call("send", reservedRequest);
        for (let index = 0; index < 256; index++) {
          await a.call("send", {
            operationId: randomUUID(),
            content: {
              type: "message",
              text: "Terminal retention bound " + index,
            },
            recipients: [carol.id],
            ttlMs: 1000,
          });
          // Keep actual unexpired intents well below the independent 128 limit
          // and stay below the local API request-rate bound.
          await delay(25);
        }
        const bounded = await a.call("state");
        assert.deepEqual(bounded.outboxPolicy, outboxPolicy);
        assert.equal(bounded.outbox.length, 256);
        assert.equal(
          bounded.outbox.some(
            (entry: any) => entry.operationId === operationId,
          ),
          false,
        );
        assert.equal(
          (await item(a, reservedRequest.operationId)).status,
          "pending",
        );
        assert.equal(pinned(a, reserved.id), true);
        assert.equal((await a.call("send", reservedRequest)).id, reserved.id);
        // The API cannot distinguish a never-seen UUIDv4 from a forgotten one.
        // Make that finite-idempotency limitation explicit, rather than claiming
        // the bounded journal guarantees deduplication forever.
        const forgottenReplay = await a.call("send", request);
        assert.equal(forgottenReplay.accepted, true);
        assert.notEqual(forgottenReplay.id, accepted.id);
        await a.call("lock", {});
        const locked = await a.call("state");
        assert.deepEqual(locked.outbox, []);
        assert.deepEqual(locked.objects, []);
        assert.deepEqual(locked.outboxPolicy, outboxPolicy);
        assert.equal(
          JSON.stringify(locked).includes(request.content.text),
          false,
        );
        controls.push(
          "Closing the real TCP path left A disconnected. A short-lived accepted intent expired with zero confirmations, released its automatic pin and remained expired/idempotent after restart. Locked snapshots hid all outbox metadata and message previews.",
        );
        controls.push(
          "Deleting two owned fixture bundles while the sender was stopped made an incomplete intent unavailable and a historical read intent unretained. Both operation IDs stayed idempotent with accepted=false; previously observed confirmations did not regress.",
        );
        controls.push(
          "After 256 additional short-lived sends, metadata stayed capped at 256 and an older incomplete intent remained pending and pinned. A raw API replay of an already-pruned UUID created a different bundle, demonstrating the documented finite idempotency scope; composer safeguards require a separate browser gate.",
        );
        assert.equal(
          productionDigest(),
          engineSources,
          "engine sources changed during the gate; rerun against a stable implementation",
        );
        successful = true;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        if (injector) await injector.stop();
        if (tap) await tap.close();
        const cleanupErrors = await cleanup(clients, run, successful);
        writeReport("outbox-" + senderRuntime + "-sender", {
          result: successful && !cleanupErrors.length ? "pass" : "failed",
          started,
          finished: new Date().toISOString(),
          host: process.platform,
          nodeVersion: process.versions.node,
          productionSourceSha256: engineSources,
          nativeBinarySha256: nativeBinary,
          runtimes: [senderRuntime, otherRuntime, otherRuntime],
          applicationProcessCount: 3,
          transport:
            "actual TCP sockets; transparent ACK observer and adversarial peer run in the test driver",
          controls,
          failure,
          cleanupErrors,
          powerLoss: "not tested; process restart is a distinct evidence class",
          mobileOS: "not tested",
          physicalRadio: "not tested",
        });
        if (successful && cleanupErrors.length)
          throw new Error(cleanupErrors.join("; "));
      }
    },
  );
}
