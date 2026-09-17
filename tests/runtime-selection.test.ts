import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { launch } from "./helpers";
test("UI runtime selection rejects an ambiguous alias and launches the actual requested engine", async () => {
  const previous = process.env.RELAYLOOM_TEST_BACKEND;
  try {
    process.env.RELAYLOOM_TEST_BACKEND = "go";
    await assert.rejects(() => launch(), /node\|native/);
    const negative = spawnSync(
      process.execPath,
      ["scripts/e2e.mjs", "--list"],
      { env: { ...process.env }, encoding: "utf8" },
    );
    assert.notEqual(negative.status, 0);
    assert.match(negative.stderr, /native selects the Go runtime/);
    for (const backend of ["node", "native"] as const) {
      process.env.RELAYLOOM_TEST_BACKEND = backend;
      const client = await launch();
      try {
        const state = await client.call("state");
        assert.equal(
          state.nativeRuntime,
          backend === "native" ? "Go" : undefined,
        );
        assert.equal(state.locked, true);
      } finally {
        await client.stop();
        rmSync(client.dir, { recursive: true, force: true });
      }
    }
  } finally {
    if (previous === undefined) delete process.env.RELAYLOOM_TEST_BACKEND;
    else process.env.RELAYLOOM_TEST_BACKEND = previous;
  }
});
