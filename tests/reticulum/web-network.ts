import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve, join } from "node:path";
import { launch, type Client } from "../helpers";

function line(child: ChildProcess, send?: string): Promise<any> {
  return new Promise((accept, reject) => {
    let out = "";
    const timer = setTimeout(
      () => finish(new Error("RNS fixture readiness deadline")),
      15_000,
    );
    const ended = () =>
      finish(new Error("RNS fixture exited before readiness"));
    function finish(error?: Error, value?: any) {
      clearTimeout(timer);
      child.off("exit", ended);
      child.off("error", finish);
      child.stdout!.off("data", data);
      if (error) reject(error);
      else accept(value);
    }
    function data(bytes: Buffer) {
      out += bytes.toString();
      if (!out.includes("\n")) return;
      try {
        finish(undefined, JSON.parse(out.split("\n")[0]));
      } catch (e) {
        finish(e as Error);
      }
    }
    child.once("exit", ended);
    child.once("error", finish);
    child.stdout!.on("data", data);
    if (send) child.stdin!.write(send + "\n");
  });
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const done = new Promise<void>((r) => child.once("close", () => r()));
  child.kill("SIGTERM");
  await done;
}
async function unusedPort() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}
/** Actual unmodified RNS reference router: TCP ingress and serial PTY egress. */
export async function webRnsNetwork() {
  const work = mkdtempSync(resolve(".cache/web-rns-")),
    children: ChildProcess[] = [],
    clients: Client[] = [];
  function child(command: string, args: string[]) {
    const p = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    children.push(p);
    p.stderr!.on("data", (b) =>
      writeFileSync(join(work, `process-${p.pid}.stderr`), b, { flag: "a" }),
    );
    return p;
  }
  function config(name: string, transport: boolean, interfaces: string) {
    const dir = join(work, name);
    mkdirSync(dir, { mode: 0o700 });
    writeFileSync(
      join(dir, "config"),
      `[reticulum]\nshare_instance = No\nenable_transport = ${transport ? "Yes" : "No"}\n[interfaces]\n${interfaces}`,
      { mode: 0o600 },
    );
    return dir;
  }
  const serial = (device: string) =>
    ` [[Serial]]\n type = SerialInterface\n enabled = Yes\n port = ${device}\n speed = 115200\n`;
  const close = async () => {
    for (const client of clients) await client.stop();
    for (const p of children.reverse()) await stop(p);
  };
  try {
    const bridge = child("python3", ["scripts/pty-bridge.py"]),
      paths = await line(bridge),
      port = await unusedPort();
    const transitConfig = config(
      "transit",
      true,
      ` [[TCP]]\n type = TCPServerInterface\n enabled = Yes\n listen_ip = 127.0.0.1\n listen_port = ${port}\n` +
        serial(paths.left),
    );
    const transit = child(resolve(".cache/reticulum/venv/bin/python"), [
      "tests/reticulum/reference-router.py",
      transitConfig,
    ]);
    const ready = await line(transit);
    if (!ready.ready || ready.version !== "1.5.4")
      throw new Error("Expected reference RNS 1.5.4");
    const bConfig = config(
      "b-rns",
      false,
      ` [[TCP]]\n type = TCPClientInterface\n enabled = Yes\n target_host = 127.0.0.1\n target_port = ${port}\n`,
    );
    const cConfig = config("c-rns", false, serial(paths.right));
    async function startB() {
      const client = await launch(join(work, "b"), 0, -1, "node", [
        "--rns-config",
        bConfig,
      ]);
      clients.push(client);
      return client;
    }
    const b = await startB(),
      c = await launch(join(work, "c"), 0, -1, "node", [
        "--rns-config",
        cConfig,
      ]);
    clients.push(c);
    return {
      b,
      c,
      startB,
      partition: () => bridge.kill("SIGUSR1"),
      stats: () => line(transit, "stats"),
      close,
      work,
    };
  } catch (e) {
    await close();
    throw e;
  }
}
