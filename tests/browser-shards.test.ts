import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Plain Node helper is also executed directly by CI.
import { assertPartition } from "../scripts/verify-browser-shards.mjs";
const report = (ids: string[]) => ({
  suites: [
    {
      suites: [
        {
          specs: ids.map((id) => ({ id, tests: [{ projectName: "browser" }] })),
        },
      ],
    },
  ],
});
test("browser CI partition rejects omitted, duplicated and empty coverage with a complete positive control", () => {
  const full = report(["a", "b", "c"]);
  assert.deepEqual(assertPartition(full, [report(["a"]), report(["b", "c"])]), {
    full: 3,
    shards: [1, 2],
    disjoint: true,
    complete: true,
  });
  assert.throws(
    () => assertPartition(full, [report(["a"]), report(["b"])]),
    /omit/,
  );
  assert.throws(
    () => assertPartition(full, [report(["a", "b"]), report(["b", "c"])]),
    /repeat/,
  );
  assert.throws(
    () => assertPartition(full, [report([]), report(["a", "b", "c"])]),
    /Empty/,
  );
  assert.throws(
    () => assertPartition(report(["a", "a"]), [report(["a"]), report(["a"])]),
    /duplicate/,
  );
});
