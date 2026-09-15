import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createSocket } from "node:dgram";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { launch, password, until, type Client } from "../helpers.js";

async function freePort(udp: boolean) {
  if (udp) {
    const s = createSocket("udp4");
    await new Promise<void>((r) => s.bind(0, "127.0.0.1", r));
    const p = s.address().port;
    await new Promise<void>((r) => s.close(r));
    return p;
  }
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const p = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}
function config(dir: string, section: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(dir, "config"),
    `[reticulum]\nshare_instance = No\nenable_transport = No\n[interfaces]\n [[Medium]]\n enabled = Yes\n ${section}\n`,
    { mode: 0o600 },
  );
  return dir;
}
async function pty(p: ChildProcess): Promise<{ left: string; right: string }> {
  return new Promise((resolve, reject) => {
    let value = "";
    const timer = setTimeout(
      () => reject(new Error("PTY startup deadline")),
      5000,
    );
    p.stdout!.on("data", (b) => {
      value += b;
      if (value.includes("\n")) {
        clearTimeout(timer);
        resolve(JSON.parse(value.split("\n")[0]));
      }
    });
    p.once("error", reject);
  });
}
for (const medium of [
  "UDPInterface",
  "BackboneInterface",
  "KISSInterface",
  "AX25KISSInterface",
  "BluetoothNusSimulatedGatt",
]) {
  test(
    `TCP to ${medium}: consent gates private delivery, queued partition recovery and author-offline seeding`,
    { timeout: 150_000 },
    async () => {
      const work = mkdtempSync(resolve(".cache/rns-media-"));
      const clients: Client[] = [];
      let bridge: ChildProcess | undefined;
      const evidence: string[] = [];
      try {
        let bSection: string, cSection: string;
        if (medium === "UDPInterface") {
          const left = await freePort(true),
            right = await freePort(true);
          bSection = `type = UDPInterface\n listen_ip = 127.0.0.1\n listen_port = ${left}\n forward_ip = 127.0.0.1\n forward_port = ${right}`;
          cSection = `type = UDPInterface\n listen_ip = 127.0.0.1\n listen_port = ${right}\n forward_ip = 127.0.0.1\n forward_port = ${left}`;
        } else if (medium === "BackboneInterface") {
          const port = await freePort(false);
          bSection = `type = BackboneInterface\n listen_ip = 127.0.0.1\n listen_port = ${port}`;
          cSection = `type = BackboneClientInterface\n target_host = 127.0.0.1\n target_port = ${port}`;
        } else {
          bridge = spawn(
            "python3",
            [
              medium === "BluetoothNusSimulatedGatt"
                ? "tests/reticulum/bluetooth-nus-fixture.py"
                : "scripts/pty-bridge.py",
            ],
            {
              stdio: ["pipe", "pipe", "pipe"],
            },
          );
          const paths = await pty(bridge);
          const tail =
            medium === "AX25KISSInterface"
              ? "\n callsign = RLTEST\n ssid = 0"
              : "";
          bSection = `type = ${medium === "BluetoothNusSimulatedGatt" ? "SerialInterface" : medium}\n port = ${paths.left}\n speed = 115200\n bitrate = 115200${tail}`;
          cSection = `type = ${medium === "BluetoothNusSimulatedGatt" ? "SerialInterface" : medium}\n port = ${paths.right}\n speed = 115200\n bitrate = 115200${tail}`;
        }
        const a = await launch(join(work, "a"), 0, 0, "node");
        clients.push(a);
        let b = await launch(join(work, "b"), 0, 0, "node", [
          "--rns-config",
          config(join(work, "b-rns"), bSection),
        ]);
        clients.push(b);
        const c = await launch(join(work, "c"), 0, -1, "node", [
          "--rns-config",
          config(join(work, "c-rns"), cSection),
        ]);
        clients.push(c);
        const alice = await a.call("setup", { name: "Autora meios", password });
        await b.call("setup", { name: "Relay meios", password });
        const carol = await c.call("setup", {
          name: "Destino meios",
          password,
        });
        await a.call("contact", { contact: carol });
        await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
        const destination = (await c.call("state")).reticulum.destination;
        await b.call("reticulum-connect", { destination });
        await until(
          () => c.call("state"),
          (s) =>
            s.peers.some((p: any) => p.medium === "reticulum" && p.connected),
          30_000,
        );
        assert.equal((await c.call("state")).tcpPort, -1);
        assert.equal((await a.call("state")).peers.length, 1);
        await b.call("settings", { relay: false });
        const storedBefore = (await b.call("state")).storage.count;
        const message = await a.call("publish", {
          content: { type: "message", text: `Privada por ${medium}` },
          recipients: [carol.id],
        });
        await until(
          () => b.call("state"),
          (s) => s.storage.count > storedBefore,
        );
        await delay(3000);
        assert.ok(
          !(await c.call("state")).objects.some(
            (o: any) => o.id === message.id,
          ),
        );
        await b.call("settings", { relay: true });
        await until(
          () => c.call("state"),
          (s) => s.objects.some((o: any) => o.id === message.id),
          30_000,
        );
        assert.equal(
          (await c.call("view", { id: message.id })).content.text,
          `Privada por ${medium}`,
        );
        await assert.rejects(() => b.call("view", { id: message.id }));
        evidence.push(
          "Only A-B TCP and B-C RNS; C TCP disabled. Consent false blocks, true delivers. B cannot decrypt.",
        );
        if (bridge) {
          bridge.kill("SIGUSR1");
          await delay(200);
        } else {
          await b.stop();
        }
        const payload = Buffer.from("Meios com integridade.\n".repeat(800));
        const post = await a.call("publish", {
          content: {
            type: "post",
            text: "Partição",
            attachments: [
              {
                name: "media.txt",
                mime: "text/plain",
                data: payload.toString("base64"),
              },
            ],
          },
          recipients: "public",
        });
        await delay(3000);
        assert.ok(
          !(await c.call("state")).objects.some((o: any) => o.id === post.id),
        );
        if (bridge) bridge.kill("SIGUSR1");
        else {
          b = await launch(join(work, "b"), 0, 0, "node", [
            "--rns-config",
            join(work, "b-rns"),
          ]);
          clients.push(b);
          await b.call("unlock", { password });
          await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
          await b.call("reticulum-connect", { destination });
        }
        await until(
          () => c.call("state"),
          (s) => s.objects.some((o: any) => o.id === post.id),
          45_000,
        );
        assert.deepEqual(
          Buffer.from(
            (await c.call("attachment", { id: post.id, index: 0 })).data,
            "base64",
          ),
          payload,
        );
        evidence.push(
          "Partition prevents receipt; healed path delivers exact attachment bytes.",
        );
        await b.call("settings", { relay: false });
        const seed = await a.call("publish", {
          content: { type: "post", text: "Autora offline" },
          recipients: "public",
        });
        await until(
          () => b.call("state"),
          (s) => s.objects.some((o: any) => o.id === seed.id),
        );
        await b.call("view", { id: seed.id });
        await delay(3000);
        assert.ok(
          !(await c.call("state")).objects.some((o: any) => o.id === seed.id),
        );
        await a.stop();
        await b.call("settings", { relay: true });
        await c.call("retrieve", { id: seed.id });
        await until(
          () => c.call("state"),
          (s) => s.objects.some((o: any) => o.id === seed.id),
          30_000,
        );
        assert.equal(
          (await c.call("view", { id: seed.id })).author.id,
          alice.id,
        );
        const state = await until(
          () => b.call("state"),
          (s) =>
            s.reticulum.diagnostics?.interfaces?.some(
              (i: any) => i.sent > 0 && i.received > 0,
            ),
          10_000,
        );
        evidence.push(
          "Original author process stopped; reader B seeds to C without changing authorship.",
        );
        const dir = resolve(".cache/connectivity/media");
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, medium + ".json"),
          JSON.stringify(
            {
              medium,
              result: "PASS",
              scope:
                medium === "BluetoothNusSimulatedGatt"
                  ? "Real RNS and BluetoothSerial PTYs; simulated GATT, NO physical Bluetooth test"
                  : bridge
                    ? "Real RNS and OS PTY, no physical TNC/radio"
                    : "Real RNS processes and loopback IP, no physical-device claim",
              evidence,
              interfaces: state.reticulum.diagnostics.interfaces,
            },
            null,
            2,
          ),
        );
      } catch (error) {
        const dir = resolve(".cache/connectivity/media");
        mkdirSync(dir, { recursive: true });
        const snapshots = [];
        for (const client of clients) {
          if (client.process.exitCode !== null) continue;
          try {
            const state = await client.call("state");
            snapshots.push({
              storage: state.storage,
              counters: state.counters,
              reticulum: state.reticulum,
              error: state.transportError,
              objects: state.objects.map((o: any) => ({
                id: o.id,
                kind: o.kind,
              })),
            });
          } catch {}
        }
        writeFileSync(
          join(dir, medium + "-failure.json"),
          JSON.stringify({ error: String(error), snapshots }, null, 2),
        );
        throw error;
      } finally {
        for (const c of clients.reverse()) await c.stop();
        if (bridge && bridge.exitCode === null) {
          bridge.kill("SIGTERM");
          await new Promise<void>((r) => bridge!.once("close", () => r()));
        }
      }
    },
  );
}
