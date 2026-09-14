import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { launch, password, until, type Client } from "../helpers.js";

const python = resolve(".cache/reticulum/venv/bin/python");
async function line(child: ChildProcess, send?: string): Promise<any> {
  return new Promise((accept, reject) => {
    let out = "";
    const timer = setTimeout(
      () => finish(new Error("fixture startup/status deadline")),
      15_000,
    );
    const ended = () => finish(new Error("fixture exited"));
    const data = (b: Buffer) => {
      out += b;
      if (out.includes("\n")) {
        try {
          finish(undefined, JSON.parse(out.split("\n")[0]));
        } catch (e) {
          finish(e as Error);
        }
      }
    };
    function finish(error?: Error, value?: any) {
      clearTimeout(timer);
      child.off("exit", ended);
      child.stdout!.off("data", data);
      if (error) reject(error);
      else accept(value);
    }
    child.stdout!.on("data", data);
    child.once("exit", ended);
    if (send) child.stdin!.write(send + "\n");
  });
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => child.once("close", () => resolve()));
}
async function port() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const p = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return p;
}
function config(dir: string, transport: boolean, interfaces: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(dir, "config"),
    `[reticulum]\nshare_instance = No\nenable_transport = ${transport ? "Yes" : "No"}\n[interfaces]\n${interfaces}`,
    { mode: 0o600 },
  );
  return dir;
}
const serial = (path: string) =>
  ` [[Serial]]\n type = SerialInterface\n enabled = Yes\n port = ${path}\n speed = 115200\n`;

for (const origin of ["node", "native"] as const)
  test(
    `${origin} origin: reference Reticulum routes RelayLoom through TCP and serial PTY with partition/heal and offline seeding`,
    { timeout: 150_000 },
    async () => {
      const work = mkdtempSync(resolve(".cache/rns-network-"));
      const started = new Date().toISOString(),
        controls: string[] = [];
      const children: ChildProcess[] = [],
        clients: Client[] = [];
      function child(command: string, args: string[]) {
        const p = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
        children.push(p);
        p.stderr!.on("data", (b) =>
          writeFileSync(join(work, `process-${p.pid}.stderr`), b, {
            flag: "a",
          }),
        );
        return p;
      }
      try {
        const bridge = child("python3", ["scripts/pty-bridge.py"]);
        const paths = await line(bridge),
          rnsPort = await port();
        const transitDir = config(
          join(work, "transit"),
          true,
          ` [[TCP]]\n type = TCPServerInterface\n enabled = Yes\n listen_ip = 127.0.0.1\n listen_port = ${rnsPort}\n` +
            serial(paths.left),
        );
        const transit = child(python, [
          "tests/reticulum/reference-router.py",
          transitDir,
        ]);
        assert.equal((await line(transit)).version, "1.5.4");
        const bConf = config(
          join(work, "b-rns"),
          false,
          ` [[TCP]]\n type = TCPClientInterface\n enabled = Yes\n target_host = 127.0.0.1\n target_port = ${rnsPort}\n`,
        );
        const cConf = config(join(work, "c-rns"), false, serial(paths.right));
        const a = await launch(join(work, "a"), 0, 0, origin);
        clients.push(a);
        let b = await launch(join(work, "b"), 0, 0, "node", [
          "--rns-config",
          bConf,
        ]);
        clients.push(b);
        const c = await launch(join(work, "c"), 0, -1, "node", [
          "--rns-config",
          cConf,
        ]);
        clients.push(c);
        const alice = await a.call("setup", { name: "Autora", password });
        const bob = await b.call("setup", { name: "Relay e leitor", password });
        const carol = await c.call("setup", { name: "Destinatária", password });
        await a.call("contact", { contact: carol });
        await a.call("contact", { contact: bob });
        await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
        const destination = (await c.call("state")).reticulum.destination;
        const bDestination = (await b.call("state")).reticulum.destination;
        await b.call("reticulum-connect", { destination });
        const connected = await until(
          () => c.call("state"),
          (s) => s.peers.length > 0,
          30_000,
        );
        assert.equal(connected.tcpPort, -1);
        assert.deepEqual(
          connected.peers.map((p: any) => p.medium),
          ["reticulum"],
        );
        assert.equal((await a.call("state")).peers.length, 1);
        assert.equal(
          (await a.call("state")).peers[0].address,
          `127.0.0.1:${b.tcpPort}`,
        );
        const path = await until(
          () => b.call("state"),
          (s) =>
            s.reticulum.paths.some((p: any) => p.destination === destination),
          15_000,
        );
        assert.equal(
          path.reticulum.paths.find((p: any) => p.destination === destination)
            .hops,
          2,
        );
        controls.push(
          "A has only TCP to B; C has no TCP listener and only RNS. RNS path B-C has two hops through reference transit.",
        );
        const privateMsg = await a.call("publish", {
          content: { type: "message", text: "Caminho agnóstico e privado" },
          recipients: [carol.id],
        });
        await until(
          () => c.call("state"),
          (s) => s.objects.some((o: any) => o.id === privateMsg.id),
          30_000,
        );
        assert.equal(
          (await c.call("view", { id: privateMsg.id })).content.text,
          "Caminho agnóstico e privado",
        );
        await assert.rejects(() => b.call("view", { id: privateMsg.id }));
        controls.push(
          "Positive encrypted private delivery; B forwarded the object but its identity cannot decrypt it.",
        );
        bridge.kill("SIGUSR1");
        await delay(100);
        const payload = Buffer.from("reticulum-byte-integrity-".repeat(1200));
        const item = await a.call("publish", {
          content: {
            type: "post",
            text: "Atravessa a partição",
            attachments: [
              {
                name: "payload.txt",
                mime: "text/plain",
                data: payload.toString("base64"),
              },
            ],
          },
          recipients: "public",
        });
        await until(
          () => b.call("state"),
          (s) => s.objects.some((o: any) => o.id === item.id),
        );
        await delay(3000);
        assert.ok(
          !(await c.call("state")).objects.some((o: any) => o.id === item.id),
        );
        controls.push(
          "Serial partition negative control: B stores the publication; C cannot receive it across disconnected PTYs.",
        );
        bridge.kill("SIGUSR1");
        await until(
          () => c.call("state"),
          (s) => s.objects.some((o: any) => o.id === item.id),
          45_000,
        );
        assert.deepEqual(
          Buffer.from(
            (await c.call("attachment", { id: item.id, index: 0 })).data,
            "base64",
          ),
          payload,
        );
        assert.equal(
          (await c.call("view", { id: item.id })).author.id,
          alice.id,
        );
        controls.push(
          `Heal positive control: exact ${payload.length}-byte attachment and original author signature reach C over the RNS path.`,
        );
        await b.call("settings", { relay: false });
        const unseen = await a.call("publish", {
          content: { type: "post", text: "Sobrevive à autora" },
          recipients: "public",
        });
        await until(
          () => b.call("state"),
          (s) => s.objects.some((o: any) => o.id === unseen.id),
        );
        await b.call("view", { id: unseen.id });
        await delay(3000);
        assert.ok(
          !(await c.call("state")).objects.some((o: any) => o.id === unseen.id),
        );
        controls.push(
          "Relay-off negative control: B reads a new publication but does not forward or advertise it to C.",
        );
        await a.stop();
        await b.stop();
        b = await launch(join(work, "b"), 0, -1, "node", [
          "--rns-config",
          bConf,
        ]);
        clients.push(b);
        await b.call("unlock", { password });
        assert.equal(
          (await b.call("state")).reticulum.destination,
          bDestination,
        );
        await b.call("reticulum-connect", { destination });
        await b.call("settings", { relay: true });
        await until(
          () => c.call("state"),
          (s) => s.objects.some((o: any) => o.id === unseen.id),
          35_000,
        );
        assert.equal(
          (await c.call("view", { id: unseen.id })).author.id,
          alice.id,
        );
        controls.push(
          "Publisher process stopped; restarted B retains transport identity and seeds previously unseen content without acquiring authorship.",
        );
        const stats = await line(transit, "stats");
        assert.ok(
          stats.interfaces.some(
            (i: any) =>
              i.type === "SerialInterface" && i.tx > payload.length && i.rx > 0,
          ),
        );
        assert.ok(
          stats.interfaces.some(
            (i: any) => i.type === "TCPClientInterface" && i.tx > 0 && i.rx > 0,
          ),
        );
        mkdirSync("docs/evidence/reticulum", { recursive: true });
        writeFileSync(
          `docs/evidence/reticulum/heterogeneous-${origin}.json`,
          JSON.stringify(
            {
              started,
              finished: new Date().toISOString(),
              status: "passed",
              origin,
              version: "1.5.4",
              platform: process.platform,
              controls,
              transit: stats,
              work,
              limitations: [
                "PTY is not a radio",
                "Linux only",
                "RNS/native packaging and complete browser integration pending",
              ],
            },
            null,
            2,
          ) + "\n",
        );
      } catch (error) {
        console.error("Preserved fixture:", work);
        for (const client of clients) {
          if (client.process.exitCode !== null) continue;
          const state = await client.call("state").catch(() => null);
          if (state)
            console.error(
              JSON.stringify({
                runtime: client.dir,
                counters: state.counters,
                peers: state.peers,
                rns: state.reticulum,
                objects: state.objects.map((o: any) => ({
                  id: o.id,
                  kind: o.kind,
                })),
                storage: state.storage,
              }),
            );
        }
        throw error;
      } finally {
        for (const c of clients) await c.stop();
        for (const p of children.reverse()) await stop(p);
      }
    },
  );
