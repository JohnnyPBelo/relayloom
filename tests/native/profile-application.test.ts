import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createIdentity, hash } from "../../packages/core/src/index.js";
import {
  cleanup,
  createRun,
  goExecutable,
  mixedPassword,
  startClient,
  writeReport,
  type MixedClient,
  type Runtime,
} from "./mixed-helper.js";

for (const runtime of ["node", "go"] as const) {
  test(
    `${runtime} application owns its profile until close; another engine recovers its pending outbox`,
    { timeout: 45000 },
    async () => {
      const run = createRun("profile-application-" + runtime),
        clients: MixedClient[] = [],
        other: Runtime = runtime === "node" ? "go" : "node";
      let successful = false;
      try {
        const first = await startClient(
          runtime,
          "profile owner",
          join(run, "owner"),
        );
        clients.push(first);
        const identity = await first.call("setup", {
          name: "Synthetic profile owner",
          password: mixedPassword,
        });
        const reader = createIdentity("Synthetic absent reader");
        await first.call("contact", { contact: reader.public });
        await first.call("settings", { relay: false });
        const request = {
          operationId: randomUUID(),
          content: {
            type: "message",
            text: "Exact pending outbox across ownership",
          },
          recipients: [reader.public.id],
        };
        const accepted = await first.call("send", request),
          before = readFileSync(join(first.dir, "private-state.json"));
        await assert.rejects(
          startClient(other, "competing same-profile engine", first.dir),
          /perfil.*aberto/,
        );
        assert.deepEqual(
          readFileSync(join(first.dir, "private-state.json")),
          before,
        );
        const independent = await startClient(
          other,
          "independent profile",
          join(run, "independent"),
        );
        clients.push(independent);
        assert.equal((await independent.call("state")).initialized, false);
        await first.stop();
        const recovered = await startClient(
          other,
          "recovered profile",
          first.dir,
        );
        clients.push(recovered);
        assert.equal((await recovered.call("state")).locked, true);
        await recovered.call("unlock", { password: mixedPassword });
        assert.equal((await recovered.call("state")).identity.id, identity.id);
        assert.equal((await recovered.call("send", request)).id, accepted.id);
        assert.equal(
          (await recovered.call("state")).outbox.find(
            (item: any) => item.operationId === request.operationId,
          ).status,
          "pending",
        );
        await assert.rejects(
          startClient(runtime, "stale competing engine", first.dir),
          /perfil.*aberto/,
        );
        writeReport("profile-application-" + runtime, {
          runtime,
          recoveredBy: other,
          binarySHA256: hash(readFileSync(goExecutable)),
          checks: [
            "same-profile second engine refused before mutable state changes",
            "independent profile remains available",
            "graceful owner close permits another engine",
            "same identity and pending operation/content ID recover",
            "new owner excludes stale competing engine",
          ],
          limitations: [
            "local processes; no mobile lifecycle execution or dynamic-group app integration",
          ],
        });
        successful = true;
      } finally {
        assert.deepEqual(await cleanup(clients, run, successful), []);
      }
    },
  );
}
