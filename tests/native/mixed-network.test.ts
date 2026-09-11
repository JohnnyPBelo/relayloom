import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import {
  decryptBundle,
  importVault,
  verifyBundle,
} from "../../packages/core/src/index.js";
import {
  APIError,
  absentFor,
  cleanup,
  createRun,
  goExecutable,
  mixedPassword as password,
  objectAt,
  startClient,
  startPTY,
  storedBundle,
  summarize,
  waitFor,
  writeReport,
  type MixedClient,
} from "./mixed-helper.js";

const rejected = (error: unknown) =>
  error instanceof APIError && error.status === 400;
async function contacts(clients: MixedClient[], cards: any[]) {
  for (let i = 0; i < clients.length; i++)
    for (let j = 0; j < cards.length; j++)
      if (i !== j) await clients[i].call("contact", { contact: cards[j] });
}
async function tcpTopology(a: MixedClient, b: MixedClient, c: MixedClient) {
  const states = await Promise.all([
    waitFor(
      "A has only B",
      () => a.call("state"),
      (state) => state.peers.length === 1 && state.peers[0].connected,
    ),
    waitFor(
      "B has two peer sockets",
      () => b.call("state"),
      (state) => state.peers.filter((peer: any) => peer.connected).length === 2,
    ),
    waitFor(
      "C has only B",
      () => c.call("state"),
      (state) => state.peers.length === 1 && state.peers[0].connected,
    ),
  ]);
  assert.equal(states[0].nativeRuntime, "Go");
  assert.equal(states[2].nativeRuntime, "Go");
  assert.equal(states[2].tcpPort, -1);
  for (const state of [states[0], states[2]]) {
    assert.equal(state.peers[0].medium, "tcp");
    assert.equal(state.peers[0].address, `127.0.0.1:${b.tcpPort}`);
  }
  return states.map(summarize);
}

test(
  "Go A → Node B → Go C: isolated real sockets, encrypted messages/receipts, partition, restart and publisher-offline seeding",
  { timeout: 150000 },
  async () => {
    assert.ok(
      existsSync(goExecutable),
      "Build .cache/native-app/relayloom before mixed application tests",
    );
    const run = createRun("tcp"),
      clients: MixedClient[] = [],
      controls: string[] = [],
      started = new Date().toISOString();
    let success = false,
      failure: string | undefined,
      topology: unknown,
      finalCounters: unknown;
    try {
      const a = await startClient("go", "A Go publisher", join(run, "a"));
      clients.push(a);
      let b = await startClient("node", "B Node relay", join(run, "b"));
      clients.push(b);
      let c = await startClient("go", "C Go reader", join(run, "c"), -1);
      clients.push(c);
      assert.equal((await a.request("state", undefined, "")).status, 401);
      assert.equal((await c.request("state", undefined, "")).status, 401);
      const alice = await a.call("setup", { name: "Mixed Alice Go", password }),
        bob = await b.call("setup", { name: "Mixed Bob Node", password }),
        carol = await c.call("setup", { name: "Mixed Carol Go", password });
      await contacts([a, b, c], [alice, bob, carol]);
      await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
      await c.call("connect", { host: "127.0.0.1", port: b.tcpPort });
      topology = await tcpTopology(a, b, c);
      controls.push(
        "A and C each have exactly one TCP peer, B; C has no TCP listener. Three actual processes, no direct A-C connection. Both Go HTTP APIs reject missing capability tokens.",
      );

      const attachment = Buffer.from(
        Array.from({ length: 96 * 1024 }, (_, index) => (index * 31 + 7) % 256),
      );
      const original = await a.call("publish", {
        content: {
          type: "message",
          text: "Mixed native message λ 😀",
          attachments: [
            {
              name: "exact.bin",
              mime: "application/octet-stream",
              data: attachment.toString("base64"),
            },
          ],
        },
        recipients: [bob.id, carol.id],
      });
      const atB = await objectAt(b, original.id),
        atC = await objectAt(c, original.id);
      for (const [client, object] of [
        [b, atB],
        [c, atC],
      ] as const) {
        assert.equal(object.author.id, alice.id);
        assert.equal(object.content.attachments[0].data, "");
        assert.equal(object.content.attachments[0].size, attachment.length);
        const downloaded = await client.call("attachment", {
          id: original.id,
          index: 0,
        });
        assert.deepEqual(Buffer.from(downloaded.data, "base64"), attachment);
      }
      assert.equal(atC.route.medium, "tcp");
      assert.equal(atC.route.hops.length, 2);
      assert.ok((await b.call("state")).counters.forwarded > 0);
      const goBundle = storedBundle(a, original.id),
        nodeBundle = storedBundle(b, original.id),
        receivedBundle = storedBundle(c, original.id);
      for (const bundle of [goBundle, nodeBundle, receivedBundle])
        verifyBundle(bundle);
      assert.deepEqual(nodeBundle, goBundle);
      assert.deepEqual(receivedBundle, goBundle);
      controls.push(
        "Go-authored encrypted message and 98,304 exact attachment bytes traversed Node B; C recorded two hops. All three disk bundles retain identical signed manifests/chunks.",
      );

      await c.call("view", { id: original.id });
      await b.call("view", { id: original.id });
      const withReceipts = await waitFor(
        "Go A receives Node and Go signed receipts",
        () => a.call("state"),
        (state) =>
          [bob.id, carol.id].every((author) =>
            state.objects.some(
              (object: any) =>
                object.kind === "receipt" &&
                object.content.target === original.id &&
                object.author.id === author,
            ),
          ),
      );
      assert.equal(
        withReceipts.objects.filter(
          (object: any) =>
            object.kind === "receipt" && object.content.target === original.id,
        ).length,
        2,
      );
      controls.push(
        "Reading at Go C and Node B generated signed receipts from both runtimes, delivered back to Go A.",
      );
      for (const reader of [b, c])
        await assert.rejects(
          reader.call("publish", {
            content: {
              type: "edit",
              target: original.id,
              text: "reader forgery",
            },
            recipients: original.readers,
          }),
          rejected,
        );
      const edit = await a.call("publish", {
        content: {
          type: "edit",
          target: original.id,
          text: "Author-approved native edit",
        },
        recipients: original.readers,
      });
      await objectAt(b, edit.id);
      await objectAt(c, edit.id);
      assert.equal(
        (await objectAt(b, original.id)).editedText,
        "Author-approved native edit",
      );
      assert.equal(
        (await objectAt(c, original.id)).editedText,
        "Author-approved native edit",
      );
      controls.push(
        "Both reader runtimes rejected unauthorized edit requests; the original Go author’s signed edit propagated and became the effective text.",
      );

      const confidential = await a.call("publish", {
        content: {
          type: "message",
          text: "Only Alice and Carol can decrypt this",
        },
        recipients: [carol.id],
      });
      await objectAt(c, confidential.id);
      await waitFor(
        "Node relay stores inaccessible encrypted bundle",
        async () =>
          existsSync(join(b.dir, "store/objects", confidential.id + ".json")),
        (present) => present,
      );
      await assert.rejects(b.call("view", { id: confidential.id }), rejected);
      const bobIdentity = importVault(
        (await b.call("export", { password })).vault,
        password,
      );
      assert.throws(() =>
        decryptBundle(storedBundle(b, confidential.id), bobIdentity),
      );
      assert.equal(
        (await c.call("view", { id: confidential.id })).content.text,
        "Only Alice and Carol can decrypt this",
      );
      controls.push(
        "Node B retained/relayed a private A-C bundle but both its view API and cryptographic decryption denied B; authorized Go C read it.",
      );

      const oldB = b,
        relayPort = b.tcpPort,
        relayPID = b.process.pid;
      await b.stop();
      await Promise.all([
        waitFor(
          "A observes relay partition",
          () => a.call("state"),
          (state) => !state.peers.some((peer: any) => peer.connected),
        ),
        waitFor(
          "C observes relay partition",
          () => c.call("state"),
          (state) => !state.peers.some((peer: any) => peer.connected),
        ),
      ]);
      const partitioned = await a.call("publish", {
        content: {
          type: "message",
          text: "Queued while the only relay process is absent",
        },
        recipients: [carol.id],
      });
      await absentFor(c, partitioned.id, 700);
      b = await startClient(
        "node",
        "B Node relay restarted",
        oldB.dir,
        relayPort,
      );
      clients.push(b);
      await b.call("unlock", { password });
      assert.ok(b.process.pid !== relayPID);
      assert.ok(
        b.token !== oldB.token,
        "relay restart creates a fresh local API capability",
      );
      assert.equal(
        (await b.request("state", undefined, oldB.token)).status,
        401,
      );
      await tcpTopology(a, b, c);
      const healed = await objectAt(c, partitioned.id, 20000);
      assert.equal(healed.author.id, alice.id);
      assert.equal(
        healed.content.text,
        "Queued while the only relay process is absent",
      );
      controls.push(
        "Stopping B removed every A-C path. A published during the partition; C remained empty for that object. B restarted on its saved peer port and exact pending content arrived; the old HTTP token was rejected.",
      );

      const priorC = c,
        readerPID = c.process.pid;
      await c.stop();
      c = await startClient("go", "C Go reader restarted", priorC.dir, -1);
      clients.push(c);
      const locked = await c.call("state");
      assert.equal(locked.initialized, true);
      assert.equal(locked.locked, true);
      assert.deepEqual(locked.objects, []);
      assert.deepEqual(locked.contacts, []);
      await assert.rejects(
        c.call("unlock", { password: "wrong integration passphrase" }),
        rejected,
      );
      assert.equal((await c.call("unlock", { password })).id, carol.id);
      assert.ok(c.process.pid !== readerPID);
      assert.equal(
        (await objectAt(c, original.id)).editedText,
        "Author-approved native edit",
      );
      assert.deepEqual(
        Buffer.from(
          (await c.call("attachment", { id: original.id, index: 0 })).data,
          "base64",
        ),
        attachment,
      );
      await c.call("view", { id: original.id });
      await delay(500);
      const afterRestart = await a.call("state");
      assert.equal(
        afterRestart.objects.filter(
          (object: any) =>
            object.kind === "receipt" &&
            object.content.target === original.id &&
            object.author.id === carol.id,
        ).length,
        1,
      );
      const reply = await c.call("publish", {
        content: {
          type: "message",
          text: "Go C can sign after persistent recovery",
        },
        recipients: [alice.id, bob.id],
      });
      assert.equal((await objectAt(a, reply.id)).author.id, carol.id);
      assert.equal((await objectAt(b, reply.id)).author.id, carol.id);
      controls.push(
        "Go C restarted locked, rejected a wrong password, recovered its same signing identity, cached attachment and effective edit, avoided a duplicate read receipt, and signed a new reply accepted by Go A and Node B.",
      );

      await b.call("settings", { relay: false });
      assert.equal((await b.call("state")).settings.relay, false);
      const seeded = await a.call("publish", {
        content: {
          type: "post",
          text: "Signed by offline Go A, subsequently served by Node B",
        },
        recipients: "public",
      });
      await objectAt(b, seeded.id);
      await absentFor(c, seeded.id, 2800);
      await a.stop();
      assert.ok(a.process.exitCode !== null || a.process.signalCode !== null);
      await b.call("settings", { relay: true });
      const takeover = await objectAt(c, seeded.id, 20000);
      assert.equal(takeover.author.id, alice.id);
      assert.notEqual(takeover.author.id, bob.id);
      assert.deepEqual(storedBundle(c, seeded.id), storedBundle(b, seeded.id));
      verifyBundle(storedBundle(c, seeded.id));
      controls.push(
        "Paused B stored A’s new public object while C could not obtain it. After Go A exited, resuming Node B served the exact signed object to Go C without changing authorship.",
      );
      finalCounters = {
        b: (await b.call("state")).counters,
        c: (await c.call("state")).counters,
      };
      success = true;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      const cleanupErrors = await cleanup(clients, run, success);
      writeReport("mixed-tcp", {
        result: success && !cleanupErrors.length ? "pass" : "failed",
        started,
        finished: new Date().toISOString(),
        host: process.platform,
        runtimes: [
          "Go native application",
          "Node application",
          "Go native application",
        ],
        activeProcessCount: 3,
        transports: ["real TCP sockets"],
        topology,
        controls,
        finalCounters,
        failure,
        cleanupErrors,
        physicalRadio: "not tested",
        mobileOS: "not tested",
      });
      if (success && cleanupErrors.length)
        throw new Error(cleanupErrors.join("; "));
    }
  },
);

test(
  "Go A → Node B → Node C over TCP and serial PTYs preserves bytes, receipts and partition recovery",
  { timeout: 100000, skip: process.platform === "win32" },
  async () => {
    assert.ok(
      existsSync(goExecutable),
      "Build the native application before this test",
    );
    const run = createRun("serial"),
      clients: MixedClient[] = [],
      controls: string[] = [],
      started = new Date().toISOString();
    const bridge = await startPTY();
    let success = false,
      failure: string | undefined,
      finalCounters: unknown;
    try {
      const a = await startClient(
        "go",
        "A Go serial-route publisher",
        join(run, "a"),
      );
      clients.push(a);
      const b = await startClient(
        "node",
        "B Node medium bridge",
        join(run, "b"),
      );
      clients.push(b);
      const c = await startClient(
        "node",
        "C Node serial-only reader",
        join(run, "c"),
        -1,
      );
      clients.push(c);
      const alice = await a.call("setup", {
          name: "Go serial publisher",
          password,
        }),
        bob = await b.call("setup", { name: "Node bridge", password }),
        carol = await c.call("setup", { name: "Node serial reader", password });
      await contacts([a, b, c], [alice, bob, carol]);
      await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
      await b.call("serial", { path: bridge.left, baud: 115200 });
      await c.call("serial", { path: bridge.right, baud: 115200 });
      const readerState = await waitFor(
        "C has a serial-only link",
        () => c.call("state"),
        (state) =>
          state.peers.length === 1 &&
          state.peers[0].medium === "serial" &&
          state.peers[0].connected,
      );
      assert.equal(readerState.tcpPort, -1);
      const senderState = await waitFor(
        "A has only the TCP bridge",
        () => a.call("state"),
        (state) => state.peers.length === 1 && state.peers[0].connected,
      );
      assert.equal(senderState.peers[0].address, `127.0.0.1:${b.tcpPort}`);
      await waitFor(
        "B spans both media",
        () => b.call("state"),
        (state) =>
          state.peers.length === 2 &&
          state.peers.some((peer: any) => peer.medium === "tcp") &&
          state.peers.some((peer: any) => peer.medium === "serial"),
      );
      controls.push(
        "A Go has one TCP link to B Node; C Node disables TCP listening and has only its real serialport PTY. B alone spans both media.",
      );
      const attachment = Buffer.from(
        Array.from(
          { length: 32 * 1024 },
          (_, index) => (index * 17 + 19) % 256,
        ),
      );
      const message = await a.call("publish", {
        content: {
          type: "message",
          text: "Go TCP origin through Node serial forwarding",
          attachments: [
            {
              name: "serial.bin",
              mime: "application/octet-stream",
              data: attachment.toString("base64"),
            },
          ],
        },
        recipients: [bob.id, carol.id],
      });
      const received = await objectAt(c, message.id, 35000);
      assert.equal(received.author.id, alice.id);
      assert.equal(received.route.medium, "serial");
      assert.equal(received.route.hops.length, 2);
      assert.deepEqual(
        Buffer.from(
          (await c.call("attachment", { id: message.id, index: 0 })).data,
          "base64",
        ),
        attachment,
      );
      assert.deepEqual(
        storedBundle(c, message.id),
        storedBundle(a, message.id),
      );
      verifyBundle(storedBundle(c, message.id));
      await c.call("view", { id: message.id });
      await waitFor(
        "Go author receives serial reader receipt",
        () => a.call("state"),
        (state) =>
          state.objects.some(
            (object: any) =>
              object.kind === "receipt" &&
              object.content.target === message.id &&
              object.author.id === carol.id,
          ),
        20000,
      );
      controls.push(
        "The 32,768-byte attachment arrived byte-for-byte through two media with the Go author’s signature. A signed Node C read receipt traversed serial and TCP back to Go A.",
      );
      bridge.partition();
      await delay(100);
      const blocked = await a.call("publish", {
        content: {
          type: "post",
          text: "Mixed runtime serial partition control",
        },
        recipients: "public",
      });
      await objectAt(b, blocked.id);
      await absentFor(c, blocked.id, 2600);
      bridge.partition();
      const healed = await objectAt(c, blocked.id, 25000);
      assert.equal(healed.author.id, alice.id);
      assert.equal(
        healed.content.text,
        "Mixed runtime serial partition control",
      );
      controls.push(
        "With byte forwarding disabled, B received the new Go-signed object and C did not. Restoring the same PTY bridge delivered it with unchanged authorship.",
      );
      finalCounters = {
        b: (await b.call("state")).counters,
        c: (await c.call("state")).counters,
      };
      success = true;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      await bridge.stop();
      const cleanupErrors = await cleanup(clients, run, success);
      writeReport("mixed-serial", {
        result: success && !cleanupErrors.length ? "pass" : "failed",
        started,
        finished: new Date().toISOString(),
        host: process.platform,
        runtimes: [
          "Go native application",
          "Node application",
          "Node application",
        ],
        activeProcessCount: 3,
        transports: ["real TCP socket", "serialport over OS PTYs"],
        controls,
        finalCounters,
        failure,
        cleanupErrors,
        physicalRadio: "not tested",
        nativeGoSerialDriver: "not implemented",
        mobileOS: "not tested",
      });
      if (success && cleanupErrors.length)
        throw new Error(cleanupErrors.join("; "));
    }
  },
);
