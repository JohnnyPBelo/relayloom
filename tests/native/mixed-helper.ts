import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const mixedPassword =
  "relayloom mixed application integration passphrase";
export const repository = resolve(import.meta.dirname, "../..");
export const goExecutable = join(
  repository,
  ".cache/native-app",
  process.platform === "win32" ? "relayloom.exe" : "relayloom",
);
export type Runtime = "go" | "node";
export interface MixedClient {
  runtime: Runtime;
  role: string;
  process: ChildProcess;
  dir: string;
  origin: string;
  token: string;
  tcpPort: number;
  call: (operation: string, body?: unknown) => Promise<any>;
  request: (
    operation: string,
    body?: unknown,
    token?: string,
  ) => Promise<{ status: number; data: any }>;
  stop: () => Promise<void>;
  errors: () => string;
}
export class APIError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const redact = (text: string) => text.replace(/[a-f0-9]{64}/gi, "[redacted]");
export function createRun(name: string): string {
  const root = join(repository, ".cache/native-mixed");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return mkdtempSync(join(root, name + "-"));
}
export function writeReport(name: string, report: unknown) {
  const dir = join(repository, ".cache/native-mixed");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, name + ".json"), JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
}
export async function startClient(
  runtime: Runtime,
  role: string,
  dir: string,
  tcpPort = 0,
): Promise<MixedClient> {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (runtime === "go" && !existsSync(goExecutable))
    throw new Error(
      "Native application binary missing at .cache/native-app/relayloom; build it with the project Go wrapper before this test.",
    );
  const args = [
    "--data",
    dir,
    "--http-port",
    "0",
    "--tcp-port",
    String(tcpPort),
    "--tcp-host",
    "127.0.0.1",
  ];
  const child = spawn(
    runtime === "go" ? goExecutable : process.execPath,
    runtime === "go"
      ? [...args, "--assets", join(repository, "dist/web")]
      : ["--import", "tsx", "apps/node/src/cli.ts", ...args],
    { cwd: repository, stdio: ["ignore", "pipe", "pipe"] },
  );
  let errors = "",
    stopped = false;
  child.stderr!.on("data", (data) => {
    errors = (errors + data.toString()).slice(-8192);
  });
  const finished = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolveExit) =>
    child.once("exit", (code, signal) => resolveExit({ code, signal })),
  );
  const stop = async () => {
    if (
      stopped ||
      child.pid === undefined ||
      child.exitCode !== null ||
      child.signalCode !== null
    )
      return;
    stopped = true;
    child.kill("SIGTERM");
    let forced = false;
    const force = setTimeout(() => {
      forced = true;
      child.kill("SIGKILL");
    }, 8000);
    try {
      const exit = await finished;
      if (forced || (process.platform !== "win32" && exit.code !== 0))
        throw new Error(
          `${role} did not stop gracefully (${exit.code ?? exit.signal}): ${redact(errors)}`,
        );
    } finally {
      clearTimeout(force);
    }
  };
  try {
    const info: {
      ready: boolean;
      url: string;
      origin?: string;
      token?: string;
      tcpPort: number;
    } = await new Promise((resolveReady, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(new Error(`${role} startup timed out: ${redact(errors)}`)),
        15000,
      );
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(
          new Error(`${role} exited before ready (${code}): ${redact(errors)}`),
        );
      });
      child.stdout!.on("data", (data) => {
        output += data.toString();
        if (output.length > 8192) {
          clearTimeout(timer);
          reject(new Error(`${role} bootstrap exceeded limit`));
          return;
        }
        if (!output.includes("\n")) return;
        try {
          const ready = JSON.parse(output.split("\n")[0]);
          clearTimeout(timer);
          resolveReady(ready);
        } catch (error) {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
    const url = new URL(info.origin ?? info.url),
      token =
        info.token ??
        new URLSearchParams(new URL(info.url).hash.slice(1)).get("token");
    if (
      !info.ready ||
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      !token ||
      !/^[a-f0-9]{64}$/.test(token) ||
      !Number.isInteger(info.tcpPort)
    )
      throw new Error(`${role} bootstrap is invalid`);
    const request = async (
      operation: string,
      body?: unknown,
      requestToken = token,
    ) => {
      const response = await fetch(url.origin + "/api/" + operation, {
        method: body === undefined ? "GET" : "POST",
        signal: AbortSignal.timeout(12000),
        headers: {
          ...(requestToken ? { Authorization: "Bearer " + requestToken } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json();
      return { status: response.status, data };
    };
    return {
      runtime,
      role,
      process: child,
      dir,
      origin: url.origin,
      token,
      tcpPort: info.tcpPort,
      request,
      async call(operation, body) {
        const result = await request(operation, body);
        if (result.status < 200 || result.status >= 300)
          throw new APIError(
            result.status,
            `${role} ${operation}: ${result.data.error ?? "request failed"}`,
          );
        return result.data;
      },
      stop,
      errors: () => redact(errors),
    };
  } catch (error) {
    await stop().catch(() => {});
    throw error;
  }
}
export async function waitFor<T>(
  label: string,
  sample: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeout = 15000,
): Promise<T> {
  const end = Date.now() + timeout;
  let value: T | undefined;
  do {
    value = await sample();
    if (predicate(value)) return value;
    await delay(150);
  } while (Date.now() < end);
  throw new Error(
    `${label} timed out; last state: ${JSON.stringify(summarize(value))}`,
  );
}
export function summarize(value: any): any {
  if (value && Array.isArray(value.objects))
    return {
      initialized: value.initialized,
      locked: value.locked,
      tcpPort: value.tcpPort,
      peers: value.peers,
      counters: value.counters,
      objects: value.objects.map((item: any) => ({
        id: item.id,
        kind: item.kind,
        author: item.author?.id,
      })),
      transportError: value.transportError,
    };
  return value;
}
export async function objectAt(
  client: MixedClient,
  id: string,
  timeout = 15000,
) {
  const state = await waitFor(
    `${client.role} object ${id}`,
    () => client.call("state"),
    (value) =>
      value.objects.some((item: any) => item.id === id) ||
      value.history?.availableIds.includes(id),
    timeout,
  );
  const present = state.objects.find((item: any) => item.id === id);
  if (present) return present;
  let history = state.history;
  while (history?.hasMore && history.nextBefore) {
    const page = await client.call("history", { before: history.nextBefore });
    const found = page.objects.find((item: any) => item.id === id);
    if (found) return found;
    history = page.history;
  }
  throw new Error(
    `${client.role} advertised an object absent from its history`,
  );
}
export async function absentFor(
  client: MixedClient,
  id: string,
  duration = 2500,
) {
  const end = Date.now() + duration;
  do {
    const state = await client.call("state");
    if (state.locked)
      throw new Error(`${client.role} absence control is invalid while locked`);
    if (
      state.objects.some((item: any) => item.id === id) ||
      state.history?.availableIds.includes(id)
    )
      throw new Error(`${client.role} received blocked object ${id}`);
    await delay(150);
  } while (Date.now() < end);
}
export function storedBundle(client: MixedClient, id: string): any {
  if (!/^[a-f0-9]{64}$/.test(id))
    throw new Error("Invalid fixture content address");
  return JSON.parse(
    readFileSync(join(client.dir, "store/objects", id + ".json"), "utf8"),
  );
}
export async function cleanup(
  clients: MixedClient[],
  run: string,
  successful: boolean,
): Promise<string[]> {
  const results = await Promise.allSettled(
    clients.map((client) => client.stop()),
  );
  const errors = results.flatMap((result) =>
    result.status === "rejected" ? [String(result.reason)] : [],
  );
  if (successful && !errors.length)
    rmSync(run, { recursive: true, force: true });
  return errors;
}
export async function startPTY(): Promise<{
  left: string;
  right: string;
  partition: () => void;
  stop: () => Promise<void>;
}> {
  const child = spawn("python3", ["scripts/pty-bridge.py"], {
    cwd: repository,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (data) => {
    stderr = (stderr + data.toString()).slice(-4096);
  });
  const exited = new Promise<void>((resolveExit) =>
    child.once("exit", () => resolveExit()),
  );
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const force = setTimeout(() => child.kill("SIGKILL"), 1000);
    child.kill("SIGTERM");
    try {
      await exited;
    } finally {
      clearTimeout(force);
    }
  };
  try {
    const paths: { left: string; right: string } = await new Promise(
      (resolveReady, reject) => {
        let output = "";
        const timer = setTimeout(
          () => reject(new Error("PTY startup timed out: " + stderr)),
          5000,
        );
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error("PTY exited " + code));
        });
        child.stdout.on("data", (data) => {
          output += data.toString();
          if (output.includes("\n")) {
            clearTimeout(timer);
            try {
              resolveReady(JSON.parse(output.split("\n")[0]));
            } catch (error) {
              reject(error);
            }
          }
        });
      },
    );
    return {
      ...paths,
      partition: () => {
        if (!child.kill("SIGUSR1"))
          throw new Error("PTY partition signal failed");
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
