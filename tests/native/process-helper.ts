import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { stopOwnedProcessGroup } from "../../scripts/ios-simulator.mjs";

/** Test-owned, bounded process tree; does not touch other services/workspaces. */
export function launchOwned(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    ipc?: boolean;
    timeout?: number;
  } = {},
) {
  const child: ChildProcess = spawn(command, args, {
    cwd: process.cwd(),
    env: options.env ?? process.env,
    detached: process.platform !== "win32",
    stdio: options.ipc
      ? ["pipe", "pipe", "pipe", "ipc"]
      : ["pipe", "pipe", "pipe"],
  });
  let output = "",
    timedOut = false,
    stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= (async () => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null)
        return;
      if (process.platform === "win32")
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          timeout: 6000,
          stdio: "ignore",
        });
      else await stopOwnedProcessGroup(child.pid);
    })());
  let accept!: () => void, reject!: (err: Error) => void;
  const ready = new Promise<void>((resolve, fail) => {
    accept = resolve;
    reject = fail;
  });
  void ready.catch(() => {});
  let message: any;
  child.on("message", (value) => {
    if ((value as any).ready) accept();
    else message = value;
  });
  const collect = (bytes: Buffer) => {
    output += bytes.toString();
    if (output.includes("AUTHORITY_WORKER_READY")) accept();
    if (Buffer.byteLength(output) > 65536) {
      output = output.slice(-8192);
      timedOut = true;
      void stop();
    }
  };
  child.stdout!.on("data", collect);
  child.stderr!.on("data", collect);
  const timer = setTimeout(() => {
    timedOut = true;
    void stop();
  }, options.timeout ?? 20000);
  const done = new Promise<{
    code: number | null;
    output: string;
    timedOut: boolean;
    message: any;
  }>((resolve, fail) => {
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
      fail(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      reject(new Error("process ended before readiness"));
      resolve({ code, output, timedOut, message });
    });
  });
  return { child, done, ready, stop };
}
