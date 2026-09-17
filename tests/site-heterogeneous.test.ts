import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { launch, password, until, type Client } from "./helpers";
import { startPTY } from "./native/mixed-helper";
import { siteAddress } from "../packages/sites/src/protocol";
const payload = (title: string) => ({
  type: "site",
  blocks: [],
  theme: "sand",
  site: {
    version: 1,
    title,
    description: "Actual adapter transfer",
    home: "home",
    design: {
      font: "sans",
      width: "standard",
      radius: "soft",
      accent: "#207a70",
    },
    pages: [{ id: "home", slug: "inicio", title: "Início", blocks: [] }],
  },
});

test(
  "versioned sites cross TCP and serial PTY, survive partition/heal and reach a new reader from a consenting offline-author seeder",
  { timeout: 60000, skip: process.platform === "win32" },
  async () => {
    const link = await startPTY(),
      nodes: Client[] = [];
    try {
      const a = await launch(undefined, 0, 0, "node");
      nodes.push(a);
      const b = await launch(undefined, 0, 0, "node");
      nodes.push(b);
      const c = await launch(undefined, 0, -1, "node");
      nodes.push(c);
      const owner = await a.call("setup", {
        name: "Multi-adapter site owner",
        password,
      });
      await b.call("setup", {
        name: "Multi-adapter reader and relay",
        password,
      });
      await c.call("setup", { name: "Serial-only site reader", password });
      const address = siteAddress(owner.id, "profile");
      await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
      await b.call("serial", { path: link.left });
      await c.call("serial", { path: link.right });
      await until(
        () => b.call("state"),
        (s) =>
          s.peers.some((p: any) => p.medium === "tcp") &&
          s.peers.some((p: any) => p.medium === "serial"),
      );
      const topologyC = await c.call("state");
      assert.equal(topologyC.tcpPort, -1);
      assert.deepEqual(
        topologyC.peers.map((p: any) => p.medium),
        ["serial"],
      );
      const topologyA = await a.call("state");
      assert.equal(topologyA.peers.length, 1);
      assert.equal(topologyA.peers[0].address, `127.0.0.1:${b.tcpPort}`);
      const publish = async (title: string) => {
        const state = await a.call("site-command", {
          action: "state",
          address,
        });
        return a.call("site-command", {
          action: "publish",
          name: "profile",
          sequence: state.nextSequence,
          operationId: randomUUID(),
          expectedBase: state.base,
          payload: payload(title),
          recipients: "public",
          ttlMs: 3600000,
        });
      };
      const resolve = (node: Client) =>
        node.call("site-command", { action: "resolve", address });
      const first = await publish("Connected positive control");
      await until(
        () => resolve(c),
        (s) => s.status === "available",
      );
      const arrived = await c.call("view", { id: first.operation.bundleId });
      assert.equal(arrived.route.medium, "serial");
      assert.equal(arrived.route.hops.length, 2);
      assert.ok((await b.call("state")).counters.forwarded > 0);
      link.partition();
      await delay(75);
      const second = await publish("Delivered after healing");
      await until(
        () => resolve(b),
        (s) => s.status === "available" && s.state.number === 2,
      );
      const end = Date.now() + 1800;
      while (Date.now() < end) {
        assert.equal((await resolve(c)).state.number, 1);
        await delay(150);
      }
      link.partition();
      await until(
        () => resolve(c),
        (s) => s.status === "available" && s.state.number === 2,
      );
      await b.call("settings", { relay: false });
      await delay(250);
      await a.stop();
      await c.stop();
      assert.notEqual(a.process.exitCode, null);
      const d = await launch(undefined, 0, -1, "node");
      nodes.push(d);
      await d.call("setup", {
        name: "New serial reader after author exit",
        password,
      });
      await d.call("serial", { path: link.right });
      await until(
        () => d.call("state"),
        (s) => s.peers.length === 1 && s.peers[0].medium === "serial",
      );
      const pausedUntil = Date.now() + 1500;
      while (Date.now() < pausedUntil) {
        assert.equal((await resolve(d)).status, "pending");
        await delay(150);
      }
      await b.call("settings", { relay: true });
      await until(
        () => resolve(d),
        (s) => s.status === "available" && s.state.number === 2,
      );
      const seeded = await resolve(d);
      assert.equal(seeded.object.id, second.operation.bundleId);
      assert.equal(seeded.object.author.id, owner.id);
      assert.equal(seeded.object.content.site.title, "Delivered after healing");
    } finally {
      for (const node of nodes) {
        await node.stop();
        rmSync(node.dir, { recursive: true, force: true });
      }
      await link.stop();
    }
  },
);
