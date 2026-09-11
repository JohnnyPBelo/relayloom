import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { getCurrentFuseWire, FuseV1Options } from "@electron/fuses";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "linux")
  throw new Error("This native packaged smoke currently supports Linux only.");
const executable = join(
  repository,
  "dist/desktop-installers/linux-unpacked/relayloom",
);
if (!existsSync(executable))
  throw new Error("Build the Linux unpacked package first.");
mkdirSync(join(repository, ".runtime/desktop"), { recursive: true });
const profile = mkdtempSync(
  join(repository, ".runtime/desktop/packaged-smoke-"),
);
const temporary = join(repository, ".cache/desktop/tmp");
mkdirSync(temporary, { recursive: true });
const environment = {
  ...process.env,
  XDG_CONFIG_HOME: join(profile, "config"),
  XDG_DATA_HOME: join(profile, "data"),
  XDG_CACHE_HOME: join(profile, "cache"),
  TMPDIR: temporary,
  TMP: temporary,
  TEMP: temporary,
};
for (const key of [
  "NODE_OPTIONS",
  "NODE_PATH",
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_ENABLE_LOGGING",
])
  delete environment[key];
if (environment.ELECTRON_DISABLE_SANDBOX)
  throw new Error("Sandbox must remain enabled.");
for (const path of [
  environment.XDG_CONFIG_HOME,
  environment.XDG_DATA_HOME,
  environment.XDG_CACHE_HOME,
])
  mkdirSync(path, { recursive: true });
const child = spawn(executable, ["--ozone-platform=x11"], {
  cwd: repository,
  env: environment,
  stdio: ["ignore", "pipe", "pipe"],
});
let exited = false,
  stderr = "";
const completion = new Promise((resolveExit) =>
  child.once("exit", (code, signal) => {
    exited = true;
    resolveExit({ code, signal });
  }),
);
child.stderr.on("data", (chunk) => {
  stderr = (stderr + chunk.toString()).slice(-4096);
});
child.stdout.resume();
let daemonPid, report;
try {
  const deadline = Date.now() + 20_000,
    runtime = join(
      environment.XDG_CONFIG_HOME,
      "RelayLoom",
      "data/runtime.json",
    );
  while (!existsSync(runtime)) {
    if (exited || Date.now() >= deadline)
      throw new Error(
        "Packaged daemon did not start: " +
          stderr.replace(/[a-f0-9]{64}/gi, "[redacted]"),
      );
    await delay(100);
  }
  const ready = JSON.parse(readFileSync(runtime, "utf8"));
  daemonPid = ready.pid;
  const unauthorized = await fetch(ready.url + "/api/state");
  const authenticated = await fetch(ready.url + "/api/state", {
    headers: { Authorization: "Bearer " + ready.token },
  });
  const state = await authenticated.json();
  if (
    unauthorized.status !== 401 ||
    authenticated.status !== 200 ||
    state.initialized !== false ||
    daemonPid === child.pid
  )
    throw new Error("Packaged daemon/authentication control failed.");
  const wire = await getCurrentFuseWire(executable);
  const disabled = [
    FuseV1Options.RunAsNode,
    FuseV1Options.EnableNodeOptionsEnvironmentVariable,
    FuseV1Options.EnableNodeCliInspectArguments,
    FuseV1Options.GrantFileProtocolExtraPrivileges,
  ];
  if (
    disabled.some((key) => wire[key] !== 48) ||
    wire[FuseV1Options.OnlyLoadAppFromAsar] !== 49
  )
    throw new Error("Packaged executable fuse verification failed.");
  report = {
    result: "pass",
    at: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    packagedExecutable: "dist/desktop-installers/linux-unpacked/relayloom",
    realBundledDaemon: true,
    separateDaemonProcess: true,
    apiWithoutToken: 401,
    apiWithToken: 200,
    fuses: {
      runAsNode: false,
      nodeOptions: false,
      nodeInspect: false,
      extraFilePrivileges: false,
      onlyAsar: true,
    },
    sandboxRequested: true,
    displayBackend: "x11",
  };
} finally {
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 8000);
  const outcome = await completion;
  clearTimeout(force);
  let daemonStopped = true;
  if (daemonPid) {
    try {
      process.kill(daemonPid, 0);
      daemonStopped = false;
    } catch {
      /* Expected: the owned daemon exited. */
    }
  }
  if (report) {
    report.daemonStopped = daemonStopped;
    if (!daemonStopped || outcome.code !== 0) report.result = "failed";
    writeFileSync(
      join(repository, ".cache/desktop/packaged-smoke.json"),
      JSON.stringify(report, null, 2),
    );
    if (report.result !== "pass")
      throw new Error("Packaged application failed graceful shutdown.");
    console.log(
      "Packaged Linux smoke passed; .cache/desktop/packaged-smoke.json",
    );
  }
}
