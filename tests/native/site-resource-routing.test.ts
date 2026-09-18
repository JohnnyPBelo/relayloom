import test from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import {
  readFileSync,
  existsSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  verifyBundle,
  decryptBundle,
  hash,
  canonical,
} from "../../packages/core/src/index";
import {
  describeSiteResource,
  matchSiteResource,
} from "../../packages/content/src/site-resource";
import { launch, until, password, type Client } from "../helpers";
import { assertOffline } from "../fixtures/offline-process";
const objectPath = (client: Client, id: string) =>
  join(client.dir, "store/objects", id + ".json");
async function stopSource(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("owned resource source did not exit")),
      8000,
    );
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  child.kill("SIGTERM");
  await exit;
}
for (const backend of ["node", "native"] as const)
  test(
    `${backend} optional resource stays out of inventory, then a restarted sole seeder serves its exact bytes on demand`,
    { timeout: 45000 },
    async () => {
      const clients: Client[] = [];
      let source: ChildProcess | undefined;
      try {
        let seed = await launch(undefined, 0, 0, backend);
        clients.push(seed);
        await seed.call("setup", { name: "Seeder de recursos", password });
        await seed.call("settings", { relay: true });
        const inventories: string[][] = [],
          errors: string[] = [];
        source = fork(
          "tests/fixtures/site-resource-source.ts",
          [String(seed.tcpPort)],
          {
            execArgv: ["--import", "tsx"],
            stdio: ["ignore", "ignore", "pipe", "ipc"],
          },
        );
        source.stderr!.on("data", (b) => errors.push(String(b).slice(-4000)));
        const ready: any = await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error("source startup: " + errors.join(""))),
            12000,
          );
          source!.on("message", (value: any) => {
            if (value.kind === "inventory") inventories.push(value.ids);
            if (value.kind === "ready") {
              clearTimeout(timer);
              resolve(value);
            }
          });
          source!.once("error", (e) => {
            clearTimeout(timer);
            reject(e);
          });
          source!.once("exit", (code) => {
            clearTimeout(timer);
            reject(Error("source exited early " + code));
          });
        });
        await until(
          async () => existsSync(objectPath(seed, ready.resourceId)),
          Boolean,
        );
        await until(
          async () => inventories.some((ids) => ids.includes(ready.witnessId)),
          Boolean,
        );
        await delay(4600); // Observe more than two actual sync ticks.
        assert.equal(
          inventories.some((ids) => ids.includes(ready.resourceId)),
          false,
          "optional bytes must not be advertised for automatic download",
        );
        const original = JSON.parse(
          readFileSync(objectPath(seed, ready.resourceId), "utf8"),
        );
        verifyBundle(original);
        assert.equal(hash(canonical(original)), ready.resourceHash);
        const ref = describeSiteResource(decryptBundle(original), {
          id: original.manifest.id,
          authorId: original.manifest.author.id,
          kind: original.manifest.kind,
        });
        await stopSource(source);
        await assertOffline({ process: source, tcpPort: ready.port });
        await seed.stop();
        seed = await launch(seed.dir, 0, 0, backend);
        clients.push(seed);
        await seed.call("unlock", { password });
        const reader = await launch(
          undefined,
          0,
          -1,
          backend === "node" ? "native" : "node",
        );
        clients.push(reader);
        await reader.call("setup", { name: "Leitor de recursos", password });
        assert.equal((await reader.call("state")).tcpPort, -1);
        await reader.call("settings", { relay: true });
        await reader.call("connect", { host: "127.0.0.1", port: seed.tcpPort });
        await until(
          () => reader.call("state"),
          (s) => s.objects.some((o: any) => o.id === ready.witnessId),
        );
        await delay(4600);
        assert.equal(existsSync(objectPath(reader, ready.resourceId)), false);
        await seed.call("settings", { relay: false });
        assert.equal(
          (await reader.call("retrieve", { id: ready.resourceId })).status,
          "requested",
        );
        await delay(2300);
        assert.equal(
          existsSync(objectPath(reader, ready.resourceId)),
          false,
          "a paused seeder must not serve a request",
        );
        await seed.call("settings", { relay: true });
        await reader.call("retrieve", { id: ready.resourceId });
        await until(
          async () => existsSync(objectPath(reader, ready.resourceId)),
          Boolean,
        );
        const received = JSON.parse(
          readFileSync(objectPath(reader, ready.resourceId), "utf8"),
        );
        verifyBundle(received);
        assert.equal(hash(canonical(received)), ready.resourceHash);
        assert.deepEqual(
          matchSiteResource(ref, decryptBundle(received), {
            id: received.manifest.id,
            authorId: received.manifest.author.id,
            kind: received.manifest.kind,
          }),
          decryptBundle(original),
        );
        assert.equal(received.manifest.author.id, ready.authorId);
        const viewed = await reader.call("view", { id: ready.resourceId });
        assert.deepEqual(viewed.content, decryptBundle(original));
        const summary = (await reader.call("state")).objects.find(
          (o: any) => o.id === ready.resourceId,
        );
        assert.equal(summary.content.data, undefined);
        assert.equal(summary.content.table, undefined);
        assert.equal(summary.content.name, "Guia.txt");
        await assert.rejects(() =>
          reader.call("publish", {
            content: viewed.content,
            recipients: "public",
          }),
        );
        mkdirSync(".cache/site-resource-network", { recursive: true });
        writeFileSync(
          `.cache/site-resource-network/${backend}.json`,
          JSON.stringify(
            {
              status: "PASS",
              sourcePID: source.pid,
              nodePIDs: clients.map((c) => c.process.pid),
              automaticWitness: true,
              noAutomaticResource: true,
              sourceStoppedAndSocketRefused: true,
              seederRestarted: true,
              pausedSeederNegative: true,
              explicitRequestPositive: true,
              exactCiphertext: true,
              authorPreserved: true,
              scope:
                "Real Linux processes/TCP; fixture signs initial resource, production creation API/UI not exercised. No radio/device claim.",
            },
            null,
            2,
          ),
        );
      } finally {
        if (source) await stopSource(source);
        for (const client of clients) await client.stop();
        for (const dir of new Set(clients.map((c) => c.dir)))
          rmSync(dir, { recursive: true, force: true });
      }
    },
  );
