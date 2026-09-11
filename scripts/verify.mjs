import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, statfsSync } from "node:fs";
import { resolve } from "node:path";
const root = process.cwd(),
  disk = statfsSync(root);
if (disk.bavail * disk.bsize < 15 * 1024 ** 3)
  throw new Error("15 GiB disk reserve required");
mkdirSync(".cache/verification", { recursive: true });
mkdirSync("docs/evidence", { recursive: true });
const checks = [
  ["build", ["node_modules/typescript/bin/tsc", "--noEmit"]],
  ["web-build", ["node_modules/vite/bin/vite.js", "build"]],
  [
    "tests",
    [
      "--import",
      "tsx",
      "--test",
      "--test-concurrency=1",
      ...(await import("node:fs"))
        .readdirSync("tests")
        .filter((f) => f.endsWith(".test.ts"))
        .map((f) => "tests/" + f),
    ],
  ],
  ["e2e", ["scripts/e2e.mjs"]],
  ["simulation", ["--import", "tsx", "scripts/simulate.ts"]],
];
const report = {
  testedAt: new Date().toISOString(),
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  freeGiB: Math.floor((disk.bavail * disk.bsize) / 1024 ** 3),
  checks: [],
};
for (const [name, args] of checks) {
  const start = Date.now();
  const child = spawn(process.execPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (b) => {
    output += b;
  });
  child.stderr.on("data", (b) => {
    output += b;
  });
  const exit = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  writeFileSync(`.cache/verification/${name}.log`, output);
  report.checks.push({
    name,
    invocation: "node " + args.join(" "),
    exit,
    durationMs: Date.now() - start,
  });
  if (name === "simulation" && exit === 0)
    writeFileSync("docs/evidence/simulation.json", output);
  writeFileSync(
    "docs/evidence/verification.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    `${name}: ${exit === 0 ? "PASS" : "FAIL"} (${Date.now() - start} ms)`,
  );
  if (exit !== 0) {
    console.log(output.slice(-10000));
    process.exitCode = 1;
    break;
  }
}
