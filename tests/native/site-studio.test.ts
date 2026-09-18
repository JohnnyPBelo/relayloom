import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { templateSite } from "../../apps/web/src/site/model";
import { siteFallback } from "../../packages/content/src/site";
import { decryptBundle, verifyBundle } from "../../packages/core/src/index";
import { assertOffline } from "../fixtures/offline-process";
import { authoredTable, largeTable } from "../fixtures/site-table";
import {
  absentFor,
  cleanup,
  createRun,
  mixedPassword as password,
  objectAt,
  startClient,
  storedBundle,
  waitFor,
  writeReport,
  type MixedClient,
  type Runtime,
} from "./mixed-helper";

function containsOnDisk(directory: string, needle: string): boolean {
  return readdirSync(directory, { withFileTypes: true }).some((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? containsOnDisk(path, needle)
      : readFileSync(path).includes(Buffer.from(needle));
  });
}
for (const documentVersion of [1, 2] as const)
  for (const authorRuntime of ["node", "go"] as Runtime[]) {
    const seedRuntime: Runtime = authorRuntime === "node" ? "go" : "node";
    test(
      `v${documentVersion} ${authorRuntime} site → ${seedRuntime} restarted seeder → ${authorRuntime} new reader: encrypted multipage draft, authority, corruption and author-offline transfer`,
      { timeout: 90000 },
      async () => {
        const suffix = documentVersion === 2 ? "-tables" : "";
        const run = createRun("site-" + authorRuntime + suffix),
          clients: MixedClient[] = [],
          controls: string[] = [];
        let success = false;
        const start = async (runtime: Runtime, role: string) => {
          const c = await startClient(runtime, role, join(run, role));
          clients.push(c);
          return c;
        };
        try {
          let a = await start(authorRuntime, "author"),
            b = await start(seedRuntime, "seed");
          const c = await start(authorRuntime, "new-reader");
          const alice = await a.call("setup", {
              name: "Site author",
              password,
            }),
            bob = await b.call("setup", { name: "Site seeder", password });
          await c.call("setup", { name: "New reader", password });
          await b.call("contact", { contact: alice });
          await a.call("contact", { contact: bob });
          const value = templateSite("portfolio", "Ensaio");
          if (documentVersion === 2) {
            value.site.version = 2;
            value.site.pages[0].blocks.push({
              id: "data",
              type: "table",
              title: "Lugares",
              body: "",
              data: authoredTable(),
            });
          }
          value.site.title = "Rascunho privado multipágina 483710";
          value.attachments.push({
            name: "pixel.png",
            mime: "image/png",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQqCr4DwAD0gIKZKEF0gAAAABJRU5ErkJggg==",
          });
          value.site.pages[0].blocks[2].media = [
            { attachment: 0, alt: "Imagem assinada no site" },
          ];
          const draft = { ...value, blocks: siteFallback(value.site) };
          await a.call("site-draft", draft);
          const full = await a.call("site-draft-load", {});
          assert.deepEqual(full.site, value.site);
          assert.deepEqual(full.attachments, value.attachments);
          const summary = (await a.call("state")).siteDraft;
          assert.equal(summary.attachments[0].data, "");
          assert.deepEqual(summary.site, value.site);
          assert.equal(
            containsOnDisk(a.dir, value.site.title),
            false,
            "draft text appears in plaintext storage",
          );
          assert.equal(
            containsOnDisk(a.dir, value.attachments[0].data),
            false,
            "draft image appears in plaintext storage",
          );
          const invalid = structuredClone(draft) as any;
          invalid.site.script = "alert(1)";
          await assert.rejects(() => a.call("site-draft", invalid));
          if (documentVersion === 2) {
            const oversized = structuredClone(draft);
            oversized.site.pages[0].blocks = [0, 1, 2].map((i) => ({
              id: "table-" + i,
              type: "table",
              title: "Dados",
              body: "",
              data: largeTable(),
            }));
            await assert.rejects(() => a.call("site-draft", oversized));
          }
          assert.deepEqual(
            await a.call("site-draft-load", {}),
            full,
            "invalid draft replaced the saved draft",
          );
          await a.stop();
          await assertOffline(a);
          a = await start(authorRuntime, "author");
          assert.equal((await a.call("state")).siteDraft, null);
          await assert.rejects(() => a.call("site-draft-load", {}));
          await a.call("unlock", { password });
          assert.deepEqual(await a.call("site-draft-load", {}), full);
          assert.equal(
            (await a.request("site-draft-load", {}, "")).status,
            401,
          );
          controls.push(
            "Draft and image absent from plaintext disk; invalid save is atomic; restart and locked/unauthenticated reads tested.",
          );
          await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
          await waitFor(
            "connected author and seed",
            () => a.call("state"),
            (s) => s.peers.some((p: any) => p.connected),
          );
          const pub = await a.call("publish", {
            content: { type: "site", ...draft },
            recipients: "public",
          });
          const atB = await objectAt(b, pub.id);
          assert.deepEqual(atB.content.site, value.site);
          assert.equal(atB.content.attachments[0].data, "");
          const read = await b.call("view", { id: pub.id });
          assert.deepEqual(read.content.site, value.site);
          assert.deepEqual(
            (await b.call("attachment", { id: pub.id, index: 0 })).data,
            value.attachments[0].data,
          );
          await assert.rejects(() =>
            b.call("publish", {
              content: { type: "edit", target: pub.id, text: "Forged site" },
              recipients: "public",
            }),
          );
          await assert.rejects(() =>
            b.call("publish", {
              content: { type: "delete", target: pub.id },
              recipients: "public",
            }),
          );
          const original = storedBundle(b, pub.id);
          verifyBundle(original);
          const forged = structuredClone(original);
          forged.manifest.author = bob;
          assert.throws(() => verifyBundle(forged));
          await a.stop();
          await assertOffline(a);
          assert.equal((await c.call("state")).peers.length, 0);
          await c.call("retrieve", { id: pub.id });
          await absentFor(c, pub.id, 600);
          controls.push(
            "Original author terminated with TCP refusal; new reader never connected to author and cannot retrieve without a path. Reader edit/delete and manifest substitution rejected.",
          );
          await b.stop();
          const file = join(b.dir, "store/objects", pub.id + ".json");
          const damaged = structuredClone(original),
            hash = damaged.manifest.chunks[0].hash;
          damaged.chunks[hash] =
            (damaged.chunks[hash][0] === "A" ? "B" : "A") +
            damaged.chunks[hash].slice(1);
          writeFileSync(file, JSON.stringify(damaged));
          b = await start(seedRuntime, "seed");
          await b.call("unlock", { password });
          await assert.rejects(() => b.call("view", { id: pub.id }));
          await b.stop();
          writeFileSync(file, JSON.stringify(original));
          b = await start(seedRuntime, "seed");
          await b.call("unlock", { password });
          assert.deepEqual(
            (await b.call("view", { id: pub.id })).content.site,
            value.site,
          );
          await b.call("settings", { relay: false });
          await c.call("connect", { host: "127.0.0.1", port: b.tcpPort });
          await waitFor(
            "reader connected only to seed",
            () => c.call("state"),
            (s) => s.peers.length === 1 && s.peers[0].connected,
          );
          await c.call("retrieve", { id: pub.id });
          await absentFor(c, pub.id, 900);
          await b.call("settings", { relay: true });
          await c.call("retrieve", { id: pub.id });
          const atC = await objectAt(c, pub.id);
          assert.deepEqual(atC.content.site, value.site);
          assert.equal(atC.author.id, alice.id);
          assert.equal(atC.id, pub.id);
          assert.deepEqual(
            (await c.call("attachment", { id: pub.id, index: 0 })).data,
            value.attachments[0].data,
          );
          const seeded = storedBundle(c, pub.id);
          verifyBundle(seeded);
          assert.deepEqual(decryptBundle(seeded), { type: "site", ...draft });
          await assertOffline(a);
          controls.push(
            "Corrupted stored site refused after restart; exact bytes restore reading. Paused seed does not serve, consenting restarted seed serves full pages/images with original author and address.",
          );
          success = true;
        } finally {
          const cleanupErrors = await cleanup(clients, run, success);
          writeReport("site-" + authorRuntime + suffix, {
            status: success && !cleanupErrors.length ? "PASS" : "FAIL",
            authorRuntime,
            documentVersion,
            seedRuntime,
            controls,
            cleanupErrors,
            scope:
              "Real Linux Node/Go processes over TCP; no radio or physical mobile claim.",
          });
          assert.deepEqual(cleanupErrors, []);
        }
      },
    );
  }
