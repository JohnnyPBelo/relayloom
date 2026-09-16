import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createRun,
  startClient,
  cleanup,
  writeReport,
  mixedPassword,
  type MixedClient,
  type Runtime,
} from "./mixed-helper";
for (const runtime of ["node", "go"] as Runtime[])
  test(
    `${runtime} UI preferences are authenticated, survive cross-runtime restart, and do not alter identity or relay`,
    { timeout: 60000 },
    async () => {
      const run = createRun("ui-preferences-" + runtime),
        clients: MixedClient[] = [];
      let success = false;
      try {
        const dir = join(run, "profile");
        let a = await startClient(runtime, "first", dir);
        clients.push(a);
        assert.equal(
          (await a.request("ui-preferences", undefined, "")).status,
          401,
        );
        assert.equal(
          (await a.request("ui-preferences", { language: "es-ES" }, "")).status,
          401,
        );
        assert.deepEqual(await a.call("ui-preferences"), {});
        const settings = (await a.call("state")).settings;
        await a.call("ui-preferences", { language: "es-ES", theme: "dark" });
        await Promise.all([
          a.call("ui-preferences", { largeText: true }),
          a.call("ui-preferences", { glass: false }),
        ]);
        const expected = {
          language: "es-ES",
          theme: "dark",
          largeText: true,
          glass: false,
        };
        assert.deepEqual(await a.call("ui-preferences"), expected);
        assert.equal((await a.call("state")).initialized, false);
        for (const patch of [
          { relay: false },
          { language: "fr-FR" },
          { privateKey: "x" },
          { theme: 3 },
          { highContrast: null },
        ])
          await assert.rejects(() => a.call("ui-preferences", patch));
        assert.deepEqual((await a.call("state")).settings, settings);
        const identity = await a.call("setup", {
          name: "Preference owner",
          password: mixedPassword,
        });
        const vault = readFileSync(join(dir, "identity.vault"));
        await a.call("lock", {});
        assert.deepEqual(await a.call("ui-preferences"), expected);
        await a.stop();
        a = await startClient(
          runtime === "node" ? "go" : "node",
          "restarted",
          dir,
        );
        clients.push(a);
        assert.deepEqual(await a.call("ui-preferences"), expected);
        assert.equal((await a.call("state")).locked, true);
        await a.call("ui-preferences", { highContrast: true });
        assert.deepEqual(readFileSync(join(dir, "identity.vault")), vault);
        await a.call("unlock", { password: mixedPassword });
        assert.deepEqual((await a.call("state")).identity, identity);
        const file = join(dir, "ui-preferences.json");
        writeFileSync(file, "corrupt preferences");
        await assert.rejects(() => a.call("ui-preferences"));
        await assert.rejects(() =>
          a.call("ui-preferences", { language: "en-GB" }),
        );
        assert.equal(readFileSync(file, "utf8"), "corrupt preferences");
        assert.equal((await a.call("state")).identity.id, identity.id);
        success = true;
      } finally {
        const errors = await cleanup(clients, run, success);
        writeReport("ui-preferences-" + runtime, {
          status: success && !errors.length ? "PASS" : "FAIL",
          runtime,
          ...(success
            ? {
                crossRuntimeRestart: true,
                unauthenticatedRejected: true,
                unrelatedFieldsRejected: true,
                identityUnchanged: true,
                corruptFilePreserved: true,
              }
            : {}),
          cleanupErrors: errors,
          scope: "Owned Linux Node/Go processes. No physical device claim.",
        });
        assert.deepEqual(errors, []);
      }
    },
  );
