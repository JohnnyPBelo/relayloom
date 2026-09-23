import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { selectNodeTests } from "../scripts/test-node-partition.mjs";

test("CI partitions cover exactly the complete current root suite once, while automatically including new tests", () => {
  const inventory = readdirSync("tests").filter((name) =>
      name.endsWith(".test.ts"),
    ),
    all = selectNodeTests(inventory),
    foundation = selectNodeTests(inventory, "foundation"),
    sites = selectNodeTests(inventory, "sites");
  assert.deepEqual([...foundation, ...sites].sort(), all);
  assert.equal(new Set([...foundation, ...sites]).size, all.length);
  assert(foundation.length > 0 && sites.length > 0);
  assert.deepEqual(
    selectNodeTests(
      ["future-feature.test.ts", "site-future-feature.test.ts"],
      "sites",
    ),
    ["tests/site-future-feature.test.ts"],
  );
  assert.deepEqual(
    selectNodeTests(
      ["future-feature.test.ts", "site-future-feature.test.ts"],
      "foundation",
    ),
    ["tests/future-feature.test.ts"],
  );
  assert.throws(() => selectNodeTests(inventory, "site"));
  assert.throws(() => selectNodeTests(["../other.test.ts"]));
  assert.throws(() =>
    selectNodeTests(["repeated.test.ts", "repeated.test.ts"]),
  );
  const listed = spawnSync(
    process.execPath,
    ["scripts/test-node-partition.mjs", "all", "--list"],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout), all);
  const unknown = spawnSync(
    process.execPath,
    ["scripts/test-node-partition.mjs", "missing", "--list"],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.notEqual(unknown.status, 0);
});
