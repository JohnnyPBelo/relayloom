import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { launch, password, until, type Client } from "./helpers";
import { Router } from "../packages/transport/src/index";
import { verifyBundle } from "../packages/core/src/index";
import { initialSite } from "../apps/web/src/site/model";
import { siteFallback } from "../packages/content/src/site";
import { assertOffline } from "./fixtures/offline-process";

for (const backend of ["node", "native"] as const)
  test(`${backend}: corruption after a successful store read must not suppress another exact response in the same request`, { timeout: 45000 }, async () => {
    const peers: Client[] = [], observer = new Router({ relay: false }), received: string[] = [];
    const out = resolve(process.env.RELAYLOOM_DISCOVERY_CORRUPTION_OUT ?? ".cache/site-discovery-corruption", backend);
    mkdirSync(out, { recursive: true });
    const report: Record<string, unknown> = { status: "RUNNING", backend, controlReplies: [], damageReplies: [],
      scope: "Actual TCP peer, application process and live disk corruption after verified reads; not a restart-only or simulated-store control." };
    const save = () => writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
    observer.on("payload", (p: any) => { if (p.type === "bundle") { verifyBundle(p.bundle); received.push(p.bundle.manifest.id); } });
    save();
    try {
      const owner = await launch(undefined, 0, 0, "node"); peers.push(owner);
      let seeder = await launch(undefined, 0, 0, backend); peers.push(seeder);
      const a = await owner.call("setup", { name: "Corruption control author", password });
      await seeder.call("setup", { name: "Isolating local damage", password });
      await seeder.call("settings", { relay: true });
      await seeder.call("connect", { host: "127.0.0.1", port: owner.tcpPort });
      const state = await owner.call("site-command", { action: "state", address: `relayloom:site:${a.id}/profile` });
      const value = initialSite("Verified before local damage");
      const publication = await owner.call("site-command", { action: "publish", name: "profile", sequence: state.nextSequence,
        expectedBase: state.base, operationId: randomUUID(), recipients: "public", ttlMs: 3600000,
        payload: { type: "site", site: value.site, blocks: siteFallback(value.site), attachments: [], theme: value.theme } });
      const id = publication.operation.bundleId, path = join(seeder.dir, "store", "objects", id + ".json");
      await until(async () => existsSync(path), Boolean);
      await owner.stop(); await assertOffline(owner);
      await seeder.stop(); await assertOffline(seeder);
      seeder = await launch(seeder.dir, 0, 0, backend); peers.push(seeder);
      await seeder.call("unlock", { password });
      observer.connectTcp("127.0.0.1", seeder.tcpPort);
      await until(async () => observer.peers.some(p => p.connected), Boolean);
      const marker = await seeder.call("publish", { content: { type: "post", text: "HEALTHY_OBJECT_IN_SAME_REQUEST" }, recipients: "public" });
      await until(async () => received.includes(marker.id), Boolean);
      await until(() => seeder.call("state"), s => s.peers.every((p: any) => p.queued === 0));
      received.length = 0;
      observer.broadcast({ type: "request", ids: [id, marker.id] });
      await until(async () => received.includes(id) && received.includes(marker.id), Boolean, 5000);
      await until(() => seeder.call("state"), s => s.peers.every((p: any) => p.queued === 0));
      report.controlReplies = received.slice(); save();
      await delay(1100);
      // Keep the running store and its authenticated presence index. A restart
      // would discard the damaged index entry and miss the exact-read branch.
      writeFileSync(path, "{damaged after positive read");
      received.length = 0;
      const before = (await seeder.call("state")).counters.rejected;
      observer.broadcast({ type: "request", ids: [id, marker.id] });
      let found = false;
      try { await until(async () => received.includes(marker.id), Boolean, 5000); found = true; }
      finally { report.damageReplies = received.slice(); report.rejectedDelta = (await seeder.call("state")).counters.rejected - before; save(); }
      assert.equal(found, true, "one damaged retained copy suppressed the healthy sibling response");
      assert.equal(received.includes(id), false, "damaged copy must never be served from disk or old packet retention");
      report.status = "PASS";
    } catch (error) { report.status = "FAIL"; report.error = String(error); throw error; }
    finally {
      await observer.stop();
      for (const peer of peers) await peer.stop();
      for (const dir of new Set(peers.map(p => p.dir))) rmSync(dir, { recursive: true, force: true });
      save();
    }
  });
