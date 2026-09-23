import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function testIds(report) {
  const ids = [];
  function visit(suite) {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? []) {
        if (
          typeof spec.id !== "string" ||
          !spec.id ||
          typeof test.projectName !== "string"
        )
          throw Error("Invalid listed browser test");
        ids.push(test.projectName + ":" + spec.id);
      }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report.suites ?? []) visit(suite);
  if (!ids.length || new Set(ids).size !== ids.length)
    throw Error("Empty or duplicate browser test listing");
  return ids.sort();
}
export function assertPartition(full, shards) {
  if (!Array.isArray(shards) || shards.length !== 2)
    throw Error("Two sequential shards required");
  const wanted = testIds(full),
    parts = shards.map(testIds),
    actual = parts.flat().sort();
  if (
    new Set(actual).size !== actual.length ||
    JSON.stringify(actual) !== JSON.stringify(wanted)
  )
    throw Error("Browser shards omit or repeat tests");
  return {
    full: wanted.length,
    shards: parts.map((p) => p.length),
    disjoint: true,
    complete: true,
  };
}
export function verify() {
  const out = resolve(".cache/browser-shards");
  mkdirSync(out, { recursive: true });
  const reports = [null, "1/2", "2/2"].map((shard) => {
    const args = [
      "scripts/e2e.mjs",
      "--config",
      "tests/browser/browser.config.ts",
      "--list",
      "--reporter=json",
      ...(shard ? ["--shard=" + shard] : []),
    ];
    const bytes = execFileSync(process.execPath, args, {
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
    });
    writeFileSync(
      resolve(out, (shard ? shard.replace("/", "-") : "full") + ".json"),
      bytes,
    );
    return JSON.parse(bytes);
  });
  const partition = assertPartition(reports[0], reports.slice(1));
  const result = {
    status: "PASS",
    scope: "Playwright discovery partition only; no browser execution inferred",
    ...partition,
  };
  writeFileSync(
    resolve(out, "partition.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
  return result;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  verify();
