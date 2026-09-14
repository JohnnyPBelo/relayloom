// Sequential, reproducible kernel gate. This does not claim autonomous product UI parity.
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  statfsSync,
} from "node:fs";
if (process.argv.slice(2).some((arg) => arg !== "--routing"))
  throw new Error("Unknown browser gate argument");
const routing = process.argv.includes("--routing");
const output = routing
  ? ".cache/browser-routing/final"
  : ".cache/browser-foundation/final";
mkdirSync(output, { recursive: true });
function sources() {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter((f) =>
      /^(apps\/|packages\/|tests\/|scripts\/|native\/|\.github\/)|^(package.*\.json|.*config\.ts)$/.test(
        f,
      ),
    );
  return Object.fromEntries(
    [...new Set(files)]
      .sort()
      .map((f) => [
        f,
        createHash("sha256").update(readFileSync(f)).digest("hex"),
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
    "Autonomous browser kernel and routing: Chromium Web Crypto/IndexedDB/WebRTC, consent, partition/heal and actual Node/Go data interoperability; no product UI, native browser transport adapter, group authority, mobile or physical radio claim.",
  checks: [],
  sources: before,
  status: "RUNNING",
};
const save = () =>
  writeFileSync(
    `${output}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
const checks = [
  ["typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"]],
  ["existing-web-build", ["node_modules/vite/bin/vite.js", "build"]],
  ["native-build", ["scripts/native-build.mjs"]],
  ...(routing
    ? [
        [
          "existing-transport",
          [
            "--import",
            "tsx",
            "--test",
            "--test-concurrency=1",
            "tests/transport.test.ts",
            "tests/transport-hardening.test.ts",
            "tests/transport-cancellation.test.ts",
            "tests/transport-serial.test.ts",
          ],
        ],
      ]
    : []),
  [
    "existing-core-security",
    [
      "--import",
      "tsx",
      "--test",
      "--test-concurrency=1",
      "tests/core.test.ts",
      "tests/security.test.ts",
    ],
  ],
  [
    "browser",
    ["scripts/e2e.mjs", "--config", "tests/browser/browser.config.ts"],
  ],
];
save();
for (const [name, args] of checks) {
  const disk = statfsSync(process.cwd());
  if (disk.bavail * disk.bsize < 15 * 1024 ** 3)
    throw new Error("15 GiB disk reserve required");
  if (JSON.stringify(sources()) !== JSON.stringify(before))
    throw new Error("Sources changed during gate");
  const start = Date.now();
  report.current = { name, args, at: new Date().toISOString() };
  save();
  writeFileSync(`${output}/${name}.log`, "");
  const child = spawn(process.execPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
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
    exit,
    elapsedMs: Date.now() - start,
  });
  console.log(
    `${name}: ${exit === 0 ? "PASS" : "FAIL"} (${Date.now() - start} ms)`,
  );
  report.sourcesUnchanged =
    JSON.stringify(sources()) === JSON.stringify(before);
  if (exit !== 0 || !report.sourcesUnchanged) {
    report.status = "FAILED";
    save();
    process.exitCode = 1;
    break;
  }
  save();
}
if (report.status === "RUNNING") {
  report.status = "PASSED";
  save();
}
console.log(`Report: ${output}/report.json`);
