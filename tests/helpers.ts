import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
export const password = "relayloom integration passphrase";
export interface Client {
  process: ChildProcess;
  dir: string;
  url: string;
  token: string;
  tcpPort: number;
  call: (path: string, body?: unknown) => Promise<any>;
  stop: () => Promise<void>;
}
export async function launch(
  dir?: string,
  httpPort = 0,
  tcpPort = 0,
  backend: "node" | "native" = process.env.RELAYLOOM_TEST_BACKEND === "native"
    ? "native"
    : "node",
): Promise<Client> {
  mkdirSync(".cache", { recursive: true });
  dir ??= mkdtempSync(join(process.cwd(), ".cache/node-"));
  const nativeBinary = join(
    process.cwd(),
    ".cache/native-app",
    process.platform === "win32" ? "relayloom.exe" : "relayloom",
  );
  const common = [
    "--data",
    dir,
    "--http-port",
    String(httpPort),
    "--tcp-port",
    String(tcpPort),
  ];
  const child = spawn(
    backend === "native" ? nativeBinary : process.execPath,
    backend === "native"
      ? ["--assets", join(process.cwd(), "dist/web"), ...common]
      : ["--import", "tsx", "apps/node/src/cli.ts", ...common],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  const info: { url: string; tcpPort: number; token?: string } =
    await new Promise((resolve, reject) => {
      let out = "",
        errors = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("node startup timed out: " + errors));
      }, 15000);
      child.stderr!.on("data", (b) => {
        errors += b;
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`node exited ${code}: ${errors}`));
      });
      child.stdout!.on("data", (b) => {
        out += b;
        if (out.includes("\n")) {
          try {
            const ready = JSON.parse(out.split("\n")[0]);
            clearTimeout(timer);
            resolve(ready);
          } catch (e) {
            clearTimeout(timer);
            reject(e);
          }
        }
      });
    });
  const url = new URL(info.url),
    token = info.token ?? new URLSearchParams(url.hash.slice(1)).get("token")!;
  return {
    process: child,
    dir,
    url: url.origin,
    token,
    tcpPort: info.tcpPort,
    async call(path, body) {
      const res = await fetch(url.origin + "/api/" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: "Bearer " + token,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return data;
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("node failed graceful stop"));
        }, 8000);
        child.once("exit", () => {
          clearTimeout(t);
          resolve();
        });
      });
    },
  };
}
export async function until<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeout = 12000,
): Promise<T> {
  const end = Date.now() + timeout;
  let last: T;
  do {
    last = await fn();
    if (predicate(last)) return last;
    await delay(120);
  } while (Date.now() < end);
  throw new Error("condition timed out");
}
