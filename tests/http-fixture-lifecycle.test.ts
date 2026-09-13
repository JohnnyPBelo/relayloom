import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { launch, password } from "./helpers.js";

test(
  "a delayed fixture client submits a non-idempotent operation once after the server closes idle HTTP sockets",
  { timeout: 30000 },
  async () => {
    const client = await launch();
    try {
      await client.call("setup", { name: "HTTP lifecycle fixture", password });
      await client.call("state");
      // Only this test client's event loop is delayed. The actual application
      // process remains running with its unchanged HTTP idle timeout. Pending
      // FIN notifications must not turn a later mutation into a stale-socket use.
      const end = Date.now() + 6500;
      while (Date.now() < end) {
        /* bounded fault injection, one owned test worker */
      }
      const text = "Single application after fixture event-loop delay";
      const published = await client.call("publish", {
        content: { type: "post", text },
        recipients: "public",
      });
      assert.ok(published.id);
      const state = await client.call("state");
      assert.equal(
        state.objects.filter((o: any) => o.content.text === text).length,
        1,
        "operation was replayed instead of submitted once",
      );
      assert.equal(client.process.exitCode, null);
      assert.equal(client.process.signalCode, null);
    } finally {
      await client.stop();
      rmSync(client.dir, { recursive: true, force: true });
    }
  },
);
