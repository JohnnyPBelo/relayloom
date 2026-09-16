// Sequential site integration and regression gate. No provider, radio or host configuration changes.
import { spawn, execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  statfsSync,
  cpSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dirname, ".."),
  out = join(root, ".cache/site-studio/final");
mkdirSync(out, { recursive: true });
function sources() {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter((p) =>
      /^(apps\/|packages\/|tests\/|native\/|scripts\/|docs\/licenses\/)|^(package.*\.json|.*config\.ts)$/.test(
        p,
      ),
    );
  return Object.fromEntries(
    [...new Set(files)].sort().map((p) => [
      p,
      createHash("sha256")
        .update(readFileSync(join(root, p)))
        .digest("hex"),
    ]),
  );
}
const report = {
  status: "RUNNING",
  started: new Date().toISOString(),
  baseCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  sources: sources(),
  checks: [],
  scope:
    "Linux Node/Go application and real sockets, browser engines, public subpath, RNS/PTYS and shared desktop UI. No physical radio, mobile device, Safari or disaster readiness claim.",
};
const save = () =>
  writeFileSync(
    join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const checks = [
  ["build", npm, ["run", "build"]],
  ["native-build", npm, ["run", "native:build"]],
  ["node-all", npm, ["test"]],
  ["native-race", npm, ["run", "test:native"]],
  ["native-cgo-storage", npm, ["run", "test:native:cgo-storage"]],
  ["interop-all", npm, ["run", "test:interop"]],
  ...["chromium", "firefox", "webkit"].map((engine) => [
    "browser-" + engine,
    process.execPath,
    ["scripts/e2e.mjs", "--config", "tests/browser/matrix.config.ts"],
    { RELAYLOOM_MATRIX_ENGINE: engine },
  ]),
  ["shared-ui-and-desktop", process.execPath, ["scripts/verify-ui.mjs"]],
  ["public-web", process.execPath, ["scripts/verify-public-web.mjs"]],
  ...["chromium", "firefox", "webkit"].map((engine) => [
    "rns-ui-" + engine,
    process.execPath,
    [
      "scripts/e2e.mjs",
      "--config",
      "tests/reticulum/ui.config.ts",
      "--browser",
      engine,
    ],
  ]),
];
save();
try {
  for (const [name, command, args, env = {}] of checks) {
    const disk = statfsSync(root);
    if (disk.bavail * disk.bsize < 15 * 1024 ** 3)
      throw new Error("15 GiB reserve required");
    if (JSON.stringify(sources()) !== JSON.stringify(report.sources))
      throw new Error("Sources changed during gate");
    const log = join(out, name + ".log");
    writeFileSync(log, "");
    const at = Date.now();
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, RELAYLOOM_LAUNCH_URL: "", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    report.current = {
      name,
      command,
      args,
      pid: child.pid,
      started: new Date().toISOString(),
    };
    save();
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (data) => appendFileSync(log, data));
    const exitCode = await new Promise((done, fail) => {
      child.on("error", fail);
      child.on("close", done);
    });
    report.checks.push({
      name,
      command,
      args,
      env,
      exitCode,
      durationMs: Date.now() - at,
    });
    delete report.current;
    save();
    console.log(name + ": " + exitCode);
    if (
      name.startsWith("browser-") &&
      existsSync(".cache/site-studio/ui-" + name.slice(8))
    )
      cpSync(".cache/site-studio/ui-" + name.slice(8), join(out, name), {
        recursive: true,
      });
    if (exitCode !== 0) throw new Error("Failed check: " + name);
  }
  report.sourcesUnchanged =
    JSON.stringify(sources()) === JSON.stringify(report.sources);
  if (!report.sourcesUnchanged) throw new Error("Sources changed during gate");
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.error = error.message;
  process.exitCode = 1;
} finally {
  report.finished = new Date().toISOString();
  save();
}
