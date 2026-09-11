import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { launch } from "./helpers.js";
test(
  "fixture stop is idempotent after process termination by signal",
  { timeout: 15000 },
  async () => {
    const client = await launch();
    try {
      const exited = once(client.process, "exit");
      client.process.kill("SIGKILL");
      await exited;
      assert.notEqual(client.process.signalCode, null);
      const start = Date.now();
      await client.stop();
      await client.stop();
      assert.ok(Date.now() - start < 1000);
    } finally {
      if (
        client.process.exitCode === null &&
        client.process.signalCode === null
      )
        client.process.kill("SIGKILL");
      rmSync(client.dir, { recursive: true, force: true });
    }
  },
);
