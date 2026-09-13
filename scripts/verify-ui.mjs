// Sequential UI integration gate, with real Node/Go clients and native Linux shell.
// Reports are local and may include synthetic test content. Review before publishing.
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  statfsSync,
  cpSync,
  appendFileSync,
  existsSync,
} from "node:fs";
import { resolve } from "node:path";

const output = resolve(".cache/ui-verification");
mkdirSync(output, { recursive: true });
function sources() {
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter((path) =>
      /^(apps\/|packages\/|tests\/|scripts\/|native\/)|^(package.*\.json|.*config\.ts)$/.test(
        path,
      ),
    );
  return Object.fromEntries(
    [...new Set(paths)]
      .sort()
      .map((path) => [
        path,
        createHash("sha256").update(readFileSync(path)).digest("hex"),
      ]),
  );
}
const before = sources();
const report = {
  at: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  baseCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  scope:
    "All browser E2E on real local Node and Go processes; Linux desktop build/run/package. Chromium mobile viewports are not physical devices or native mobile webviews.",
  checks: [],
  sources: before,
  status: "RUNNING",
};
const checks = [
  ["typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"]],
  ["web-build", ["node_modules/vite/bin/vite.js", "build"]],
  ["native-build", ["scripts/native-build.mjs"]],
  ["ui-node", ["scripts/e2e.mjs"], { RELAYLOOM_TEST_BACKEND: "node" }],
  ["ui-go", ["scripts/e2e.mjs"], { RELAYLOOM_TEST_BACKEND: "native" }],
  ...(process.platform === "linux"
    ? [
        ["desktop-build", ["scripts/desktop-build.mjs"]],
        ["desktop-run", ["scripts/desktop-run.mjs", "--smoke", "--x11"]],
        ["desktop-package", ["scripts/desktop-package.mjs"]],
        ["desktop-package-run", ["scripts/desktop-packaged-smoke.mjs"]],
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
  const executable = process.execPath;
  const disk = statfsSync(process.cwd());
  if (disk.bavail * disk.bsize < 15 * 1024 ** 3)
    throw new Error("15 GiB disk reserve required");
  if (JSON.stringify(sources()) !== JSON.stringify(before))
    throw new Error("Sources changed during UI gate");
  const start = Date.now();
  let log = "";
  writeFileSync(`${output}/${name}.log`, "");
  report.current = { name, args, env, startedAt: new Date().toISOString() };
  save();
  const child = spawn(executable, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    log += chunk;
    appendFileSync(`${output}/${name}.log`, chunk);
  });
  child.stderr.on("data", (chunk) => {
    log += chunk;
    appendFileSync(`${output}/${name}.log`, chunk);
  });
  const exit = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  writeFileSync(`${output}/${name}.log`, log);
  delete report.current;
  report.checks.push({
    name,
    executable,
    args,
    env,
    exit,
    elapsedMs: Date.now() - start,
  });
  console.log(
    `${name}: ${exit === 0 ? "PASS" : "FAIL"} (${Date.now() - start}ms)`,
  );
  if (name.startsWith("ui-")) {
    for (const path of [
      "test-results/e2e.json",
      "docs/evidence/ui",
      "docs/evidence/outbox",
      "docs/evidence/group-outbox/ui-node",
      "docs/evidence/group-outbox/ui-go",
    ])
      if (existsSync(path))
        cpSync(path, `${output}/${name}/${path}`, { recursive: true });
  }
  save();
  if (exit !== 0) {
    report.status = "FAILED";
    save();
    console.log(log.slice(-9000));
    process.exitCode = 1;
    break;
  }
}
report.sourcesUnchanged = JSON.stringify(sources()) === JSON.stringify(before);
if (!report.sourcesUnchanged) throw new Error("Sources changed during UI gate");
if (report.status === "RUNNING") report.status = "PASSED";
save();
console.log(`Report: ${output}/report.json`);
