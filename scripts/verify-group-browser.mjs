// Frozen-source sequential regression for shared group certificates and signing-key admission.
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  statfsSync,
} from "node:fs";
const output = ".cache/browser-groups/final";
mkdirSync(output, { recursive: true });
function sources() {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter((p) =>
      /^(apps\/|packages\/|tests\/|scripts\/|native\/|\.github\/|adapters\/|docs\/licenses\/)|^(package.*\.json|.*config\.ts|LICENSE)$/.test(
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
    "Shared Node/browser group certificate protocol and Node/Go/browser signing-key admission. Full Node, Go race, C SQLite storage, interoperability, reference RNS, browser, native UI and Linux desktop. Browser dynamic group authority/storage/UI remains pending. No physical-device/radio or independent-review claim.",
  checks: [],
  sources: before,
  status: "RUNNING",
};
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
        [
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "-z",
          "tests",
        ],
        { encoding: "utf8" },
      )
        .split("\0")
        .filter((p) => /^tests\/[^/]+\.test\.ts$/.test(p))
        .sort(),
    ],
  ],
  [
    "native-race",
    [
      "scripts/go.mjs",
      "test",
      "-count=1",
      ...JSON.parse(readFileSync("package.json", "utf8"))
        .scripts["test:native"].split(" ")
        .slice(3),
    ],
  ],
  [
    "native-cgo-storage",
    [
      "scripts/go.mjs",
      "test",
      "-count=1",
      ...JSON.parse(readFileSync("package.json", "utf8"))
        .scripts["test:native:cgo-storage"].split(" ")
        .slice(3),
    ],
  ],
  [
    "interop-all",
    [
      "node_modules/tsx/dist/cli.mjs",
      "--test",
      "--test-concurrency=1",
      ...execFileSync(
        "git",
        [
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "-z",
          "tests/native",
        ],
        { encoding: "utf8" },
      )
        .split("\0")
        .filter((p) => /^tests\/native\/[^/]+\.test\.ts$/.test(p))
        .sort(),
    ],
  ],
  ["reference-rns", ["scripts/verify-reticulum.mjs"]],
  [
    "browser-all",
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
for (const [name, args, env = {}] of checks) {
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
