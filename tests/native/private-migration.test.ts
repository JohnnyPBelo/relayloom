import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import {
  createIdentity,
  exportVault,
  hash,
} from "../../packages/core/src/index.js";
import { writePrivateState } from "../../apps/node/src/local-state.js";
import {
  cleanup,
  createRun,
  startClient,
  writeReport,
  mixedPassword,
  goExecutable,
  type MixedClient,
  type Runtime,
} from "./mixed-helper.js";

for (const runtime of ["node", "go"] as const) {
  test(
    `${runtime} API migrates legacy private data and the other engine recovers after process death without fallback`,
    { timeout: 45000 },
    async () => {
      const run = createRun("private-migration-" + runtime),
        dir = join(run, "profile"),
        clients: MixedClient[] = [],
        other: Runtime = runtime === "node" ? "go" : "node";
      let successful = false;
      mkdirSync(dir);
      const identity = createIdentity("Synthetic legacy profile"),
        legacy = join(dir, "private-state.json"),
        databasePath = join(dir, "profile-state.sqlite"),
        bindingPath = join(dir, "profile-binding.json"),
        collectionID = randomUUID(),
        title = "Abrigo costeiro — privado 🌊",
        blocks = [
          {
            id: "safe-block",
            type: "text",
            title,
            body: "Ponto de encontro privado",
          },
        ];
      writeFileSync(
        join(dir, "identity.vault"),
        exportVault(identity, mixedPassword),
        { mode: 0o600 },
      );
      writePrivateState(
        legacy,
        {
          mutations: {},
          collections: [
            {
              id: collectionID,
              ownerId: identity.public.id,
              title: "Referências privadas",
              objectIds: [],
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          siteDraft: { blocks, theme: "forest", savedAt: 1 },
        },
        identity,
      );
      const original = readFileSync(legacy);
      try {
        const first = await startClient(runtime, "legacy importer", dir);
        clients.push(first);
        await first.call("unlock", { password: mixedPassword });
        const imported = await first.call("state");
        assert.equal(imported.identity.id, identity.public.id);
        assert.deepEqual(imported.siteDraft, {
          blocks,
          theme: "forest",
          savedAt: 1,
        });
        assert.equal(imported.collections[0].id, collectionID);
        assert.deepEqual(readFileSync(legacy), original);
        const binding = JSON.parse(readFileSync(bindingPath, "utf8"));
        assert.equal(binding.body.phase, "committed");
        assert.equal(binding.body.sourceDigest, hash(original));
        assert.equal(
          readFileSync(databasePath).includes(Buffer.from(title)),
          false,
        );
        await first.call("site-draft", {
          blocks: [{ ...blocks[0], title: "Guardado depois da migração" }],
          theme: "ink",
        });
        await first.call("collection", {
          action: "rename",
          id: collectionID,
          title: "Colecção actualizada",
        });
        const current = await first.call("state");
        const exited = once(first.process, "exit");
        assert.equal(first.process.kill("SIGKILL"), true);
        await exited;
        assert.deepEqual(readFileSync(legacy), original);
        // A stale or unreadable legacy file cannot replace the committed document.
        writeFileSync(legacy, "deliberately unreadable old state");
        const recovered = await startClient(
          other,
          "cross-engine recovery",
          dir,
        );
        clients.push(recovered);
        await recovered.call("unlock", { password: mixedPassword });
        const state = await recovered.call("state");
        assert.deepEqual(state.siteDraft, current.siteDraft);
        assert.deepEqual(state.collections, current.collections);
        assert.equal(
          JSON.parse(readFileSync(bindingPath, "utf8")).body.storeId,
          binding.body.storeId,
        );
        await recovered.stop();
        renameSync(databasePath, databasePath + ".preserved");
        const refused = await startClient(
          runtime,
          "missing initialized database",
          dir,
        );
        clients.push(refused);
        await assert.rejects(
          refused.call("unlock", { password: mixedPassword }),
          /ausente/,
        );
        assert.equal((await refused.call("state")).locked, true);
        assert.equal(existsSync(databasePath), false);
        await refused.stop();
        renameSync(databasePath + ".preserved", databasePath);
        const restored = await startClient(
          runtime,
          "restored exact database",
          dir,
        );
        clients.push(restored);
        await restored.call("unlock", { password: mixedPassword });
        assert.deepEqual(
          (await restored.call("state")).siteDraft,
          current.siteDraft,
        );
        await restored.stop();
        const db = new DatabaseSync(databasePath);
        try {
          const row = db
            .prepare("SELECT slot,payload FROM records LIMIT 1")
            .get()!;
          const payload = Buffer.from(row.payload as Uint8Array);
          payload[payload.length - 1] ^= 1;
          db.prepare("UPDATE records SET payload=? WHERE slot=?").run(
            payload,
            row.slot as string,
          );
        } finally {
          db.close();
        }
        const corrupt = readFileSync(databasePath),
          bindingBefore = readFileSync(bindingPath);
        const rejected = await startClient(
          other,
          "corrupt protected database",
          dir,
        );
        clients.push(rejected);
        await assert.rejects(
          rejected.call("unlock", { password: mixedPassword }),
        );
        assert.equal((await rejected.call("state")).locked, true);
        await rejected.stop();
        assert.deepEqual(readFileSync(databasePath), corrupt);
        assert.deepEqual(readFileSync(bindingPath), bindingBefore);
        writeReport("private-migration-" + runtime, {
          runtime,
          recoveredBy: other,
          binarySHA256: hash(readFileSync(goExecutable)),
          checks: [
            "actual API migration preserves identity/draft/collections and legacy ciphertext",
            "binding hashes ciphertext and database contains no draft plaintext",
            "durable acknowledged updates survive killed process and cross-engine recovery",
            "committed database ignores unreadable legacy",
            "missing database refused while locked; exact restoration works",
            "tampered encrypted row refused without reset or fallback",
          ],
          limitations: [
            "synthetic local profiles and real host processes; no physical power loss or mobile execution",
            "complete valid older backup replay still has no trusted monotonic witness",
            "dynamic group authority is not yet integrated",
          ],
        });
        successful = true;
      } finally {
        assert.deepEqual(await cleanup(clients, run, successful), []);
      }
    },
  );
}
