import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { launch, password, until, type Client } from "../helpers";
import { siteAddress } from "../../packages/sites/src/protocol";
const payload = (title: string) => ({
  type: "site",
  blocks: [],
  theme: "sand",
  site: {
    version: 1,
    title,
    description: "Application runtime parity",
    home: "home",
    design: {
      font: "sans",
      width: "standard",
      radius: "soft",
      accent: "#207a70",
    },
    pages: [
      {
        id: "home",
        slug: "inicio",
        title: "Início",
        blocks: [{ id: "copy", type: "text", title: "Body", body: title }],
      },
    ],
  },
});
async function publication(
  client: Client,
  id: string,
  name: string,
  title: string,
  recipients: unknown = "public",
) {
  const state = await client.call("site-command", {
    action: "state",
    address: siteAddress(id, name),
  });
  const request = {
    action: "publish",
    name,
    sequence: state.nextSequence,
    operationId: randomUUID(),
    expectedBase: state.base,
    payload: payload(title),
    recipients,
    ttlMs: 3600000,
  };
  return { request, result: await client.call("site-command", request) };
}
async function cleanup(clients: Client[]) {
  for (const client of clients) {
    await client.stop();
    rmSync(client.dir, { recursive: true, force: true });
  }
}
for (const origin of ["node", "native"] as const)
  test(
    `${origin} site author interoperates with the other runtime and an author-offline reader`,
    { timeout: 45000 },
    async () => {
      const clients: Client[] = [];
      try {
        const a = await launch(undefined, 0, 0, origin);
        clients.push(a);
        const b = await launch(
          undefined,
          0,
          0,
          origin === "node" ? "native" : "node",
        );
        clients.push(b);
        const author = await a.call("setup", {
            name: "Mixed site owner 😀",
            password,
          }),
          reader = await b.call("setup", {
            name: "Mixed reader and seeder",
            password,
          });
        assert.equal(
          (await (origin === "native" ? a : b).call("state")).nativeRuntime,
          "Go",
        );
        await a.call("contact", { contact: reader });
        await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
        const address = siteAddress(author.id, "profile"),
          resolve = (c: Client) =>
            c.call("site-command", { action: "resolve", address });
        const first = await publication(
          a,
          author.id,
          "profile",
          "Mixed revision one",
        );
        assert.equal(first.result.operation.phase, "ready");
        await until(
          () => resolve(b),
          (s) => s.status === "available",
        );
        const original = await resolve(b);
        assert.equal(original.object.author.id, author.id);
        const second = await publication(
          a,
          author.id,
          "profile",
          "Mixed revision two",
        );
        await until(
          () => resolve(b),
          (s) => s.status === "available" && s.state.number === 2,
        );
        assert.equal(
          (await resolve(b)).object.id,
          second.result.operation.bundleId,
        );
        const historical = await b.call("site-command", {
          action: "resolve",
          address,
          revisionId: original.revisionId,
        });
        assert.equal(historical.object.id, first.result.operation.bundleId);
        const privateSite = await publication(
          a,
          author.id,
          "private",
          "Private site across runtimes",
          [reader.id],
        );
        const privateAddress = siteAddress(author.id, "private");
        await until(
          () =>
            b.call("site-command", {
              action: "resolve",
              address: privateAddress,
            }),
          (s) => s.status === "available",
        );
        const privateRead = await b.call("site-command", {
          action: "resolve",
          address: privateAddress,
        });
        assert.equal(privateRead.object.public, false);
        assert.equal(
          privateRead.object.id,
          privateSite.result.operation.bundleId,
        );
        await assert.rejects(() =>
          b.call("publish", {
            content: privateRead.object.content,
            recipients: "public",
          }),
        );
        await a.stop();
        assert.ok(a.process.exitCode !== null || a.process.signalCode !== null);
        const c = await launch(undefined, 0, -1, origin);
        clients.push(c);
        await c.call("setup", { name: "New offline-author reader", password });
        assert.equal((await resolve(c)).status, "pending");
        await c.call("connect", { host: "127.0.0.1", port: b.tcpPort });
        await until(
          () => resolve(c),
          (s) => s.status === "available" && s.state.number === 2,
        );
        const seeded = await resolve(c);
        assert.equal(seeded.object.id, second.result.operation.bundleId);
        assert.equal(seeded.object.author.id, author.id);
        assert.equal((await c.call("state")).tcpPort, -1);
        assert.equal(
          (
            await c.call("site-command", {
              action: "resolve",
              address: privateAddress,
            })
          ).status,
          "pending",
        );
      } finally {
        await cleanup(clients);
      }
    },
  );

test(
  "Node and Go installations of the same identity require explicit cross-runtime conflict resolution",
  { timeout: 45000 },
  async () => {
    const clients: Client[] = [];
    try {
      const a = await launch(undefined, 0, 0, "node");
      clients.push(a);
      const b = await launch(undefined, 0, 0, "native");
      clients.push(b);
      const owner = await a.call("setup", {
          name: "Shared owner 🧶",
          password,
        }),
        backup = await a.call("export", { password });
      const restored = await b.call("setup", {
        name: "ignored",
        password,
        recovery: backup.vault,
      });
      assert.equal(restored.id, owner.id);
      await publication(a, owner.id, "profile", "Node branch");
      await publication(b, owner.id, "profile", "Go branch");
      await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
      const address = siteAddress(owner.id, "profile");
      await until(
        () => b.call("site-command", { action: "state", address }),
        (s) => s.status === "conflict",
      );
      const state = await b.call("site-command", { action: "state", address });
      const request = {
        action: "publish",
        name: "profile",
        sequence: state.nextSequence,
        operationId: randomUUID(),
        expectedBase: state.base,
        payload: payload("Chosen by the owner"),
        recipients: "public",
        ttlMs: 3600000,
      };
      await assert.rejects(
        () => b.call("site-command", request),
        /concorrentes/,
      );
      const result = await b.call("site-command", {
        ...request,
        confirmedHeads: state.heads.map((h: any) => h.id).sort(),
      });
      assert.equal(result.operation.phase, "ready");
      await until(
        () => a.call("site-command", { action: "resolve", address }),
        (s) => s.status === "available" && s.state.number === 2,
      );
      assert.equal(
        (await a.call("site-command", { action: "resolve", address })).object
          .id,
        result.operation.bundleId,
      );
    } finally {
      await cleanup(clients);
    }
  },
);
