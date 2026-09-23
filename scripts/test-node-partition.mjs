import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The CI partitions are exhaustive and disjoint, including future root tests.
 * Each process retains test-concurrency=1 and each CI job retains its deadline. */
export function selectNodeTests(files, group = "all") {
  if (!["all", "foundation", "sites"].includes(group))
    throw Error("Unknown Node test partition");
  if (
    !Array.isArray(files) ||
    files.some(
      (file) =>
        typeof file !== "string" || !/^[a-z0-9-]+\.test\.ts$/.test(file),
    ) ||
    new Set(files).size !== files.length
  )
    throw Error("Invalid root test inventory");
  return files
    .filter(
      (file) =>
        group === "all" ||
        (file.startsWith("site-") ? "sites" : "foundation") === group,
    )
    .sort()
    .map((file) => "tests/" + file);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [group = "all", option, ...extra] = process.argv.slice(2);
  if (extra.length || (option !== undefined && option !== "--list"))
    throw Error(
      "Usage: node scripts/test-node-partition.mjs [all|foundation|sites] [--list]",
    );
  const files = readdirSync(resolve("tests")).filter((file) =>
      file.endsWith(".test.ts"),
    ),
    tests = selectNodeTests(files, group);
  if (!tests.length) throw Error("Empty Node test partition");
  if (option === "--list") process.stdout.write(JSON.stringify(tests) + "\n");
  else {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--test", "--test-concurrency=1", ...tests],
      { stdio: "inherit", env: process.env },
    );
    child.on("error", (error) => {
      console.error(error);
      process.exitCode = 1;
    });
    child.on("exit", (code) => {
      process.exitCode = code ?? 1;
    });
  }
}
