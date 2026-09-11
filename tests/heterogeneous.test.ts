import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import { launch, password, until } from "./helpers.js";
import { setTimeout as delay } from "node:timers/promises";

test(
  "three processes TCP → serial PTY, partition/heal, relay control and publisher-offline seeder takeover",
  { timeout: 60000, skip: process.platform === "win32" },
  async () => {
    const bridge = spawn("python3", ["scripts/pty-bridge.py"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const paths: { left: string; right: string } = await new Promise(
      (resolve, reject) => {
        let output = "";
        bridge.stdout!.on("data", (b) => {
          output += b;
          if (output.includes("\n")) resolve(JSON.parse(output.split("\n")[0]));
        });
        bridge.on("error", reject);
        bridge.once("exit", (code) =>
          reject(new Error("PTY fixture exited " + code)),
        );
      },
    );
    const a = await launch(),
      b = await launch(),
      c = await launch(undefined, 0, -1);
    const started = new Date().toISOString();
    const controls: string[] = [];
    try {
      const alice = await a.call("setup", { name: "Publisher A", password }),
        bob = await b.call("setup", { name: "Relay B", password }),
        carol = await c.call("setup", { name: "Reader C", password });
      await a.call("contact", { contact: bob });
      await a.call("contact", { contact: carol });
      await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
      await b.call("serial", { path: paths.left });
      await c.call("serial", { path: paths.right });
      await until(
        () => b.call("state"),
        (s) =>
          s.peers.some((p: any) => p.medium === "serial") &&
          s.peers.some((p: any) => p.medium === "tcp"),
      );
      const topology = await c.call("state");
      assert.equal(topology.tcpPort, -1);
      assert.deepEqual(
        topology.peers.map((p: any) => p.medium),
        ["serial"],
      );
      assert.equal((await a.call("state")).peers.length, 1);
      assert.equal(
        (await a.call("state")).peers[0].address,
        `127.0.0.1:${b.tcpPort}`,
      );
      controls.push(
        "C has TCP listener disabled; only serial transport attached. A has exactly one TCP link, terminating at B. No A-C transport exists.",
      );
      const live = await a.call("publish", {
        content: { type: "post", text: "unpartitioned multi-hop control" },
        recipients: "public",
      });
      const directRoute = await until(
        () => c.call("state"),
        (state) => state.objects.some((o: any) => o.id === live.id),
      );
      assert.equal(
        directRoute.objects.find((o: any) => o.id === live.id).route.hops
          .length,
        2,
      );
      assert.equal(
        directRoute.objects.find((o: any) => o.id === live.id).route.medium,
        "serial",
      );
      assert.ok((await b.call("state")).counters.forwarded > 0);
      controls.push(
        "Unpartitioned positive control: C received A-authored object with two-hop trace over serial, and B counted real forwarding.",
      );
      bridge.kill("SIGUSR1");
      await delay(50);
      await assert.rejects(
        () =>
          a.call("publish", {
            content: { type: "message", text: "x".repeat(13000) },
            recipients: [bob.id, carol.id],
          }),
        /Texto/,
      );
      const msg = await a.call("publish", {
        content: {
          type: "message",
          text: "heterogeneous payload",
          attachments: [
            {
              name: "payload.txt",
              mime: "text/plain",
              data: Buffer.from("abc123".repeat(18000)).toString("base64"),
            },
          ],
        },
        recipients: [bob.id, carol.id],
      });
      await until(
        () => b.call("state"),
        (s) => s.objects.some((o: any) => o.id === msg.id),
      );
      await delay(2500);
      assert.ok(
        !(await c.call("state")).objects.some((o: any) => o.id === msg.id),
      );
      controls.push(
        "Partition control: B received object; C had none after 2.5 seconds with serial bridge disconnected.",
      );
      bridge.kill("SIGUSR1");
      const received = await until(
        () => c.call("state"),
        (s) => s.objects.some((o: any) => o.id === msg.id),
        20000,
      );
      const m = received.objects.find((o: any) => o.id === msg.id);
      assert.equal(
        Buffer.from(m.content.attachments[0].data, "base64").toString(),
        "abc123".repeat(18000),
      );
      assert.equal(m.author.id, alice.id);
      assert.equal(m.route.medium, "serial");
      controls.push(
        "Heal positive control: C receives exact 108,000-byte attachment through serial, original A signature retained.",
      );
      await b.call("settings", { relay: false });
      const control = await a.call("publish", {
        content: { type: "post", text: "relay disabled control" },
        recipients: "public",
      });
      await until(
        () => b.call("state"),
        (s) => s.objects.some((o: any) => o.id === control.id),
      );
      await delay(2600);
      assert.ok(
        !(await c.call("state")).objects.some((o: any) => o.id === control.id),
      );
      controls.push(
        "Relay-off negative control: B stores publication but does not forward/advertise it to C.",
      );
      await a.stop();
      await b.call("settings", { relay: true });
      const takeover = await until(
        () => c.call("state"),
        (s) => s.objects.some((o: any) => o.id === control.id),
        15000,
      );
      assert.equal(
        takeover.objects.find((o: any) => o.id === control.id).author.id,
        alice.id,
      );
      assert.notEqual(alice.id, bob.id);
      controls.push(
        "Publisher offline positive control: after A exits, B serves the previously unseen signed publication to C.",
      );
      mkdirSync("docs/evidence", { recursive: true });
      writeFileSync(
        "docs/evidence/heterogeneous.json",
        JSON.stringify(
          {
            started,
            finished: new Date().toISOString(),
            result: "pass",
            environment: process.platform,
            mediumAtoB: "real TCP socket",
            mediumBtoC: "real serialport over two OS PTYs with byte forwarding",
            physicalRadio: "not tested",
            processCount: 3,
            controls,
            routingCounters: {
              b: (await b.call("state")).counters,
              c: takeover.counters,
            },
          },
          null,
          2,
        ),
      );
    } finally {
      await a.stop();
      await b.stop();
      await c.stop();
      bridge.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        if (bridge.exitCode !== null) resolve();
        else bridge.once("exit", () => resolve());
      });
      for (const client of [a, b, c])
        rmSync(client.dir, { recursive: true, force: true });
    }
  },
);
