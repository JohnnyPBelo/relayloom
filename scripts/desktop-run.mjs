import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.some((arg) => !["--smoke", "--x11"].includes(arg)))
  throw new Error("Supported options: --smoke --x11");
const application = join(repository, "dist", "desktop", "app");
if (!existsSync(join(application, "main.cjs")))
  throw new Error(
    "Stage the desktop app first: node scripts/desktop-build.mjs",
  );
if (process.env.ELECTRON_DISABLE_SANDBOX)
  throw new Error("Electron sandbox must remain enabled.");
const environment = {
  ...process.env,
  XDG_CONFIG_HOME: join(repository, ".runtime", "desktop", "xdg-config"),
  XDG_DATA_HOME: join(repository, ".runtime", "desktop", "xdg-data"),
  XDG_CACHE_HOME: join(repository, ".cache", "desktop", "xdg-cache"),
  ELECTRON_CACHE: join(repository, ".cache", "electron"),
  ELECTRON_BUILDER_CACHE: join(repository, ".cache", "electron-builder"),
  TMPDIR: join(repository, ".cache", "desktop", "tmp"),
  TMP: join(repository, ".cache", "desktop", "tmp"),
  TEMP: join(repository, ".cache", "desktop", "tmp"),
};
for (const name of [
  "NODE_OPTIONS",
  "NODE_PATH",
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_ENABLE_LOGGING",
])
  delete environment[name];
for (const name of [
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "ELECTRON_CACHE",
  "ELECTRON_BUILDER_CACHE",
  "TMPDIR",
])
  mkdirSync(environment[name], { recursive: true, mode: 0o700 });
const electron = createRequire(import.meta.url)("electron");
const child = spawn(
  electron,
  [
    ...(args.includes("--x11") ? ["--ozone-platform=x11"] : []),
    application,
    ...(args.includes("--smoke") ? ["--relayloom-smoke"] : []),
  ],
  { cwd: repository, env: environment, stdio: "inherit" },
);
let timedOut = false,
  forceStop;
const timeout = args.includes("--smoke")
  ? setTimeout(() => {
      timedOut = true;
      console.error(
        "Desktop smoke exceeded 45 seconds; stopping this attempt with sandbox unchanged.",
      );
      child.kill("SIGTERM");
      forceStop = setTimeout(() => child.kill("SIGKILL"), 5000);
    }, 45_000)
  : undefined;
child.on("error", (error) => {
  clearTimeout(timeout);
  clearTimeout(forceStop);
  console.error("Electron could not start: " + error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  clearTimeout(timeout);
  clearTimeout(forceStop);
  if (signal)
    console.error(
      "Electron exited with signal " +
        signal +
        "; no sandbox bypass was attempted.",
    );
  process.exitCode = timedOut ? 1 : (code ?? 1);
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
