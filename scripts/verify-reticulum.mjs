// Focused, sequential reference-RNS gate. The general host/UI gates remain separate.
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statfsSync,
} from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".cache/reticulum-verification");
mkdirSync(output, { recursive: true });
const paths = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" },
)
  .split("\0")
  .filter(
    (p) =>
      /^(apps|packages|native|adapters|scripts|tests)\//.test(p) ||
      /^(package.*\.json|.*config\.ts)$/.test(p),
  );
const digest = (p) =>
  createHash("sha256")
    .update(readFileSync(resolve(root, p)))
    .digest("hex");
const sources = Object.fromEntries(
  [...new Set(paths)].sort().map((p) => [p, digest(p)]),
);
const report = {
  started: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  baseCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  scope:
    "Reference RNS host processes, Node/Go envelopes, real TCP and serial PTY; no physical radio or native mobile execution",
  status: "RUNNING",
  sources,
  checks: [],
};
const save = () =>
  writeFileSync(
    resolve(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
const stable = () =>
  Object.entries(sources).every(([p, hash]) => digest(p) === hash);
const python = resolve(root, ".cache/reticulum/venv/bin/python");
const checks = [
  [
    "typecheck",
    process.execPath,
    ["node_modules/typescript/bin/tsc", "--noEmit"],
  ],
  ["web-build", process.execPath, ["node_modules/vite/bin/vite.js", "build"]],
  ["native-build", process.execPath, ["scripts/native-build.mjs"]],
  ["profile-policy", python, ["tests/reticulum/profile_policy_test.py", "-v"]],
  [
    "node-fairness",
    process.execPath,
    ["--import", "tsx", "--test", "tests/transport-arrival-fairness.test.ts"],
  ],
  [
    "go-transport-race",
    process.execPath,
    [
      "scripts/go.mjs",
      "test",
      "-race",
      "-count=1",
      "-p=1",
      "./transport",
      "./webpeer",
    ],
  ],
  [
    "reference-rns",
    process.execPath,
    [
      "--import",
      "tsx",
      "--test",
      "--test-concurrency=1",
      "tests/reticulum/authorization.test.ts",
      "tests/reticulum/heterogeneous.test.ts",
    ],
  ],
  [
    "shared-native-ui",
    process.execPath,
    ["scripts/e2e.mjs", "--config", "tests/reticulum/ui.config.ts"],
  ],
];
save();
try {
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error(
      "This dependency lock and execution gate currently target Linux x86_64",
    );
  for (const [name, command, args] of checks) {
    if (!stable()) throw new Error("Sources changed during gate");
    const disk = statfsSync(root);
    if (disk.bavail * disk.bsize < 15 * 1024 ** 3)
      throw new Error("Disk reserve below15GiB");
    const check = { name, command, args, started: new Date().toISOString() };
    report.checks.push(check);
    save();
    console.log(`START ${name}`);
    const log = createWriteStream(resolve(output, name + ".log"));
    const start = performance.now();
    const child = spawn(command, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    let exit;
    try {
      exit = await new Promise((accept, reject) => {
        child.once("error", reject);
        child.once("close", accept);
      });
    } finally {
      await new Promise((accept) => log.end(accept));
    }
    Object.assign(check, {
      exit,
      elapsedMs: Math.round(performance.now() - start),
      finished: new Date().toISOString(),
    });
    save();
    console.log(`END ${name}: ${exit}`);
    if (exit !== 0)
      throw new Error(`${name} failed; inspect its log before another run`);
  }
  report.sourcesStable = stable();
  if (!report.sourcesStable) throw new Error("Final source comparison failed");
  report.status = "PASSED";
} catch (error) {
  report.status = "FAILED";
  report.error = String(error);
  process.exitCode = 1;
} finally {
  report.finished = new Date().toISOString();
  save();
}
