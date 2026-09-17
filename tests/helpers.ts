import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Agent, request as httpRequest, type ClientRequest } from "node:http";
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
function defaultBackend(): "node" | "native" {
  const selected = process.env.RELAYLOOM_TEST_BACKEND ?? "node";
  if (selected !== "node" && selected !== "native")
    throw new Error(
      "Use RELAYLOOM_TEST_BACKEND=node|native; native selects the Go runtime.",
    );
  return selected;
}
export async function launch(
  dir?: string,
  httpPort = 0,
  tcpPort = 0,
  backend: "node" | "native" = defaultBackend(),
  extraArgs: string[] = [],
): Promise<Client> {
  if (backend !== "node" && backend !== "native")
    throw new Error("Unknown test runtime");
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
    ...extraArgs,
  ];
  const child = spawn(
    backend === "native" ? nativeBinary : process.execPath,
    backend === "native"
      ? ["--assets", join(process.cwd(), "dist/web"), ...common]
      : ["--import", "tsx", "apps/node/src/cli.ts", ...common],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderrTail = "";
  child.stderr!.on("data", (data: Buffer) => {
    stderrTail = (stderrTail + data.toString()).slice(-8192);
  });
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
  // A delayed fixture event loop can reuse an idle socket whose remote FIN is
  // still waiting to be processed. Use one connection per RPC, with bounded
  // concurrency and exactly one attempt; never replay a mutation. Browser E2E
  // continues to exercise the application's normal keep-alive connections.
  const agent = new Agent({ keepAlive: false, maxSockets: 4 });
  return {
    process: child,
    dir,
    url: url.origin,
    token,
    tcpPort: info.tcpPort,
    async call(path, body) {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const action =
        body &&
        typeof body === "object" &&
        "action" in body &&
        typeof body.action === "string"
          ? body.action.slice(0, 40)
          : undefined;
      const start = Date.now(),
        origin = new Error("Fixture API call origin");
      return new Promise((resolve, reject) => {
        let req: ClientRequest,
          headersReceived = false,
          finished = false;
        const failed = (error: Error & { code?: string }) => {
          if (finished) return;
          finished = true;
          setTimeout(() => {
            const data = {
              backend,
              path,
              action,
              elapsedMs: Date.now() - start,
              code: error.code ?? error.name,
              reusedSocket: req?.reusedSocket,
              headersReceived,
              exit: child.exitCode,
              signal: child.signalCode,
              stderr: stderrTail
                .replaceAll(token, "[capability]")
                .replaceAll(password, "[fixture-password]"),
              caller: origin.stack,
            };
            const directory = join(
              process.cwd(),
              ".cache",
              "fixture-http-failures",
            );
            mkdirSync(directory, { recursive: true });
            writeFileSync(
              join(directory, `${process.pid}-${start}.json`),
              JSON.stringify(data, null, 2),
              { mode: 0o600 },
            );
            const failure = new Error(
              `Fixture ${backend} API ${path}${data.action ? ":" + data.action : ""} failed: ${data.code}; reused=${data.reusedSocket}, headers=${headersReceived}, elapsed=${data.elapsedMs}ms, process exit=${data.exit}, signal=${data.signal}`,
              { cause: error },
            );
            failure.stack += "\n" + origin.stack;
            reject(failure);
          }, 50);
        };
        req = httpRequest(
          url.origin + "/api/" + path,
          {
            agent,
            method: body === undefined ? "GET" : "POST",
            headers: {
              Authorization: "Bearer " + token,
              Connection: "close",
              ...(payload === undefined
                ? {}
                : {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(payload),
                  }),
            },
          },
          (res) => {
            headersReceived = true;
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("error", failed);
            res.on("end", () => {
              try {
                const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                finished = true;
                if ((res.statusCode ?? 500) >= 400)
                  reject(new Error(data.error));
                else resolve(data);
              } catch (error) {
                failed(error as Error);
              }
            });
          },
        );
        req.on("error", failed);
        req.end(payload);
      });
    },
    async stop() {
      agent.destroy();
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
