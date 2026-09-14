// Frozen-source sequential host gate for the browser/native transport integration.
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  statfsSync,
} from "node:fs";
const remaining = process.argv.includes("--remaining");
if (process.argv.slice(2).some((arg) => arg !== "--remaining"))
  throw new Error("Unknown gate argument");
const output = remaining
  ? ".cache/browser-native/remaining"
  : ".cache/browser-native/final";
mkdirSync(output, { recursive: true });
function sources() {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter((p) =>
      /^(apps\/|packages\/|tests\/|scripts\/|native\/|\.github\/|docs\/licenses\/websocket\/)|^(package.*\.json|.*config\.ts|LICENSE)$/.test(
        p,
      ),
    );
  return Object.fromEntries(
    [...new Set(files)]
      .sort()
      .map((p) => [
        p,
        createHash("sha256").update(readFileSync(p)).digest("hex"),
      ]),
  );
}
const before = sources();
const report = {
  at: new Date().toISOString(),
  baseCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  scope:
    "Host browser/native adapter integration. Full Node suite; Go transport/webpeer/application race suite; autonomous kernel/transport browser tests; existing Node/Go UI and Linux desktop. Not full C2/C3 acceptance, platform parity, real radio, WSS in a production browser, or independent review.",
  checks: [],
  sources: before,
  status: "RUNNING",
};
if (remaining) {
  const sourceReport =
    ".cache/browser-native/gate-before-browser-fixes/report.json";
  const prior = JSON.parse(readFileSync(sourceReport, "utf8"));
  if (
    !prior.sourcesUnchanged ||
    prior.baseCommit !== report.baseCommit ||
    prior.platform !== report.platform ||
    prior.arch !== report.arch ||
    prior.node !== report.node
  )
    throw new Error("Native evidence cannot be reused in this environment");
  const allowed = new Set([
    "packages/browser/src/rtc.ts",
    "packages/browser/src/packet.ts",
    "tests/browser/native-transport.spec.ts",
    "scripts/verify-browser-native.mjs",
  ]);
  const changed = [
    ...new Set([...Object.keys(prior.sources), ...Object.keys(before)]),
  ].filter((p) => prior.sources[p] !== before[p]);
  if (changed.some((p) => !allowed.has(p)))
    throw new Error(
      "Native/test sources changed: run the complete gate instead",
    );
  const reused = ["node-all", "go-race"].map((name) =>
    prior.checks.find((c) => c.name === name),
  );
  if (reused.some((c) => !c || c.exit !== 0))
    throw new Error("Required native checks did not pass");
  report.reusedNativeEvidence = {
    sourceReport,
    at: prior.at,
    changedBrowserAndRunnerSources: changed,
    checks: reused,
    nativeSourcesUnchanged: true,
  };
}
const checks = [
  ["typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"]],
  ["web-build", ["node_modules/vite/bin/vite.js", "build"]],
  ["native-build", ["scripts/native-build.mjs"]],
  [
    "node-all",
    [
      "node_modules/tsx/dist/cli.mjs",
      "--test",
      "--test-concurrency=1",
      ...execFileSync(
        "git",
        ["ls-files", "--cached", "--others", "--exclude-standard", "tests"],
        { encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .filter((p) => /^tests\/[^/]+\.test\.ts$/.test(p))
        .sort(),
    ],
  ],
  [
    "go-race",
    [
      "scripts/go.mjs",
      "test",
      "-json",
      "-race",
      "-count=1",
      "-p=1",
      "./transport",
      "./webpeer",
      "./app",
    ],
  ],
  [
    "browser-native",
    ["scripts/e2e.mjs", "--config", "tests/browser/browser.config.ts"],
  ],
  ["ui-node", ["scripts/e2e.mjs"], { RELAYLOOM_TEST_BACKEND: "node" }],
  ["ui-go", ["scripts/e2e.mjs"], { RELAYLOOM_TEST_BACKEND: "native" }],
  ...(process.platform === "linux"
    ? [
        ["desktop-build", ["scripts/desktop-build.mjs"]],
        ["desktop-run", ["scripts/desktop-run.mjs", "--smoke", "--x11"]],
        ["desktop-package", ["scripts/desktop-package.mjs"]],
        ["desktop-packaged-run", ["scripts/desktop-packaged-smoke.mjs"]],
      ]
    : []),
];
const save = () =>
  writeFileSync(
    `${output}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
save();
for (const [name, args, env = {}] of checks.filter(
  ([name]) => !remaining || !["node-all", "go-race"].includes(name),
)) {
  const disk = statfsSync(process.cwd());
  if (disk.bavail * disk.bsize < 15 * 1024 ** 3)
    throw new Error("15 GiB disk reserve required");
  if (JSON.stringify(sources()) !== JSON.stringify(before))
    throw new Error("Sources changed during gate");
  const started = Date.now();
  writeFileSync(`${output}/${name}.log`, "");
  const child = spawn(process.execPath, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  report.current = {
    name,
    args,
    env,
    pid: child.pid,
    startedAt: new Date().toISOString(),
  };
  save();
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => appendFileSync(`${output}/${name}.log`, data));
  const exit = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  delete report.current;
  report.checks.push({
    name,
    command: ["node", ...args].join(" "),
    env,
    exit,
    elapsedMs: Date.now() - started,
  });
  report.sourcesUnchanged =
    JSON.stringify(sources()) === JSON.stringify(before);
  console.log(
    `${name}: ${exit === 0 ? "PASS" : "FAIL"} (${Date.now() - started} ms)`,
  );
  if (exit !== 0 || !report.sourcesUnchanged) {
    report.status = "FAILED";
    process.exitCode = 1;
    save();
    break;
  }
  save();
}
if (report.status === "RUNNING") {
  report.status = "PASSED";
  save();
}
console.log(`Report: ${output}/report.json`);
