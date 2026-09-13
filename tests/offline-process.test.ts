import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { launch } from "./helpers.js";
import { assertOffline, tcpOutcome } from "./fixtures/offline-process.js";

test(
  "offline control rejects a live origin and proves socket refusal after normal and signal termination",
  { timeout: 30000 },
  async () => {
    for (const forced of [false, true]) {
      const client = await launch();
      try {
        assert.equal(await tcpOutcome(client.tcpPort), "CONNECTED");
        await assert.rejects(() => assertOffline(client), /has not terminated/);
        if (forced) {
          const exited = once(client.process, "exit");
          assert.equal(client.process.kill("SIGKILL"), true);
          await exited;
          if (process.platform !== "win32") {
            assert.equal(
              client.process.exitCode,
              null,
              "exercise the signal-only branch on this host",
            );
            assert.equal(client.process.signalCode, "SIGKILL");
          }
        } else await client.stop();
        await assertOffline(client);
      } finally {
        await client.stop();
        rmSync(client.dir, { recursive: true, force: true });
      }
    }
  },
);
