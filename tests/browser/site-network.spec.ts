import { test, expect, type Page } from "@playwright/test";
import { staticHarness } from "./static-harness";
import { launch, password, until, type Client } from "../helpers";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { siteAddress } from "../../packages/sites/src/protocol";
const payload = (title: string) => ({
  type: "site",
  blocks: [],
  theme: "sand",
  site: {
    version: 1,
    title,
    description: "Three real transports",
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
        blocks: [{ id: "body", type: "text", title: "Conteúdo", body: title }],
      },
    ],
  },
});
let host: Awaited<ReturnType<typeof staticHarness>>;
test.beforeAll(async () => {
  host = await staticHarness();
});
test.afterAll(async () => {
  await host.close();
  expect(host.requests.some((p) => p.startsWith("/api/"))).toBe(false);
});
async function peer(page: Page, name: string, reopen = false) {
  await page.goto(host.url);
  return page.evaluate(
    async ({ name, reopen, password }) => {
      const w = window as any,
        r = w.rl,
        p = await r.BrowserProfile.connect("site-network");
      let mesh: any;
      const jobs = new Set<Promise<unknown>>(),
        errors: string[] = [];
      const app = new r.BrowserApplication(p, {
        publish: (bundle: any, priority: any) => {
          const job = mesh
            .announce(bundle, priority)
            .catch((e: Error) => {
              errors.push(e.message);
            })
            .finally(() => jobs.delete(job));
          jobs.add(job);
        },
        command: async (op: string, body: any) => {
          if (op !== "request") throw Error("unexpected network command");
          await mesh.request(body.id);
        },
        state: () => ({
          peers: mesh?.router.peers ?? [],
          counters: mesh?.router.counters ?? {},
          error: mesh?.lastError ?? "",
        }),
        context: () => {},
      });
      const owner = await app.call(reopen ? "unlock" : "setup", {
        name,
        password,
      });
      // Production worker has the same narrow profile RPC: received envelopes enter the application.
      mesh = await r.BrowserMesh.start({
        name: p.name,
        get locked() {
          return p.locked;
        },
        get identity() {
          return p.identity;
        },
        getValue: (key: string) => p.getValue(key),
        setValue: (key: string, value: unknown) => p.setValue(key, value),
        ids: () => p.ids(),
        getBundle: (id: string) => p.getBundle(id),
        putBundle: (bundle: any) => app.ingest(bundle),
      });
      await mesh.setRelay(true);
      Object.assign(w, {
        app,
        profile: p,
        mesh,
        networkErrors: errors,
        shutdown: async () => {
          await mesh.close();
          await Promise.allSettled([...jobs]);
          app.close();
        },
      });
      return owner;
    },
    { name, reopen, password },
  );
}
async function rtc(a: Page, b: Page) {
  const offer = await a.evaluate(async () => {
    const w = window as any;
    w.rtc = w.mesh.router.newPeer();
    return w.rtc.peer.offer();
  });
  const answer = await b.evaluate(async (offer) => {
    const w = window as any;
    w.rtc = w.mesh.router.newPeer();
    return w.rtc.peer.answer(offer);
  }, offer);
  await a.evaluate((answer) => (window as any).rtc.peer.accept(answer), answer);
  await expect
    .poll(() =>
      b.evaluate(() => (window as any).rtc.peer.link?.channel.readyState),
    )
    .toBe("open");
}
const resolve = (page: Page, address: string) =>
  page.evaluate(
    (address) =>
      (window as any).app.call("site-command", { action: "resolve", address }),
    address,
  );
async function publish(
  page: Page,
  address: string,
  title: string,
  recipients: string[] | "public" = "public",
) {
  return page.evaluate(
    async ({ address, payload, recipients }) => {
      const app = (window as any).app,
        state = await app.call("site-command", { action: "state", address });
      return app.call("site-command", {
        action: "publish",
        name: address.split("/")[1],
        sequence: state.nextSequence,
        operationId: crypto.randomUUID(),
        expectedBase: state.base,
        payload,
        recipients,
        ttlMs: 3600000,
      });
    },
    { address, payload: payload(title), recipients },
  );
}
for (const bridge of ["node", "native"] as const)
  test(`versioned sites cross RTC, WebSocket and TCP through ${bridge}, heal a partition and survive with only a restarted reader`, async ({
    browser,
  }, info) => {
    const clients: Client[] = [],
      contexts = [];
    let a: Page | undefined, b: Page | undefined, e: Page | undefined;
    try {
      const c = await launch(undefined, 0, 0, bridge);
      clients.push(c);
      const d = await launch(
        undefined,
        0,
        -1,
        bridge === "node" ? "native" : "node",
      );
      clients.push(d);
      await c.call("setup", { name: "Socket bridge", password });
      const nativeReader = await d.call("setup", {
        name: "Native reader",
        password,
      });
      await d.call("connect", { host: "127.0.0.1", port: c.tcpPort });
      const ca = await browser.newContext(),
        cb = await browser.newContext();
      contexts.push(ca, cb);
      a = await ca.newPage();
      b = await cb.newPage();
      const author = await peer(a, "Browser author"),
        relay = await peer(b, "Browser reader");
      const address = siteAddress(author.id, "profile"),
        privateAddress = siteAddress(author.id, "private");
      expect((await resolve(b, address)).status).toBe("pending");
      await rtc(a, b);
      const invitation = await c.call("web-peer", { origin: host.url });
      await b.evaluate(async (invitation) => {
        const w = window as any;
        w.ws = w.mesh.router.connectWebSocket(invitation);
        await w.ws.peer.link.ready();
      }, invitation);
      const bridgePeers = await b.evaluate(() =>
        (window as any).mesh.router.peers.map((p: any) => p.medium).sort(),
      );
      expect(bridgePeers).toEqual(["webrtc", "websocket"]);
      expect((await d.call("state")).tcpPort).toBe(-1);
      await b.evaluate(() => (window as any).mesh.setRelay(false));
      const first = await publish(a, address, "Edição um entre três meios");
      expect(first.operation.phase).toBe("ready");
      await expect
        .poll(() => resolve(b!, address).then((r) => r.status))
        .toBe("available");
      await new Promise((r) => setTimeout(r, 800));
      expect(
        (await d.call("site-command", { action: "resolve", address })).status,
      ).toBe("pending");
      expect(
        (await c.call("site-command", { action: "resolve", address })).status,
      ).toBe("pending");
      await b.evaluate(() => (window as any).mesh.setRelay(true));
      const delivered = await until(
        () => d.call("site-command", { action: "resolve", address }),
        (s) => s.status === "available",
      );
      expect(delivered.object.id).toBe(first.operation.bundleId);
      expect(delivered.object.author.id).toBe(author.id);
      const second = await publish(
        a,
        address,
        "Edição dois preserva o endereço",
      );
      await until(
        () => d.call("site-command", { action: "resolve", address }),
        (s) => s.status === "available" && s.state.number === 2,
      );
      const transportState = await d.call("state"),
        routed = transportState.objects.find(
          (o: any) => o.id === second.operation.bundleId,
        );
      expect(routed.route.medium).toBe("tcp");
      expect(routed.route.hops).toHaveLength(3);
      expect(
        (
          await d.call("site-command", {
            action: "resolve",
            address,
            revisionId: delivered.revisionId,
          })
        ).object.id,
      ).toBe(first.operation.bundleId);
      await a.evaluate(
        async (card) => (window as any).app.call("contact", { contact: card }),
        nativeReader,
      );
      const privateSite = await publish(
        a,
        privateAddress,
        "Privado através de retransmissor sem chave",
        [nativeReader.id],
      );
      const privateRead = await until(
        () =>
          d.call("site-command", {
            action: "resolve",
            address: privateAddress,
          }),
        (s) => s.status === "available",
      );
      expect(privateRead.object.id).toBe(privateSite.operation.bundleId);
      expect(privateRead.object.public).toBe(false);
      expect((await resolve(b, privateAddress)).status).toBe("pending");
      await expect(
        d.call("publish", {
          content: privateRead.object.content,
          recipients: "public",
        }),
      ).rejects.toThrow();
      const replyAddress = siteAddress(nativeReader.id, "reply"),
        replyState = await d.call("site-command", {
          action: "state",
          address: replyAddress,
        });
      const reply = await d.call("site-command", {
        action: "publish",
        name: "reply",
        sequence: replyState.nextSequence,
        operationId: randomUUID(),
        expectedBase: replyState.base,
        payload: payload("Resposta nativa assinada"),
        recipients: "public",
        ttlMs: 3600000,
      });
      await expect
        .poll(() => resolve(a!, replyAddress).then((r) => r.status))
        .toBe("available");
      expect((await resolve(a, replyAddress)).object.id).toBe(
        reply.operation.bundleId,
      );
      await a.evaluate(() => (window as any).shutdown());
      await ca.close();
      a = undefined;
      await b.evaluate(() => (window as any).shutdown());
      await c.stop();
      await d.stop();
      expect(c.process.exitCode !== null || c.process.signalCode !== null).toBe(
        true,
      );
      expect(d.process.exitCode !== null || d.process.signalCode !== null).toBe(
        true,
      );
      const reopened = await peer(b, "Browser reader", true);
      expect(reopened.id).toBe(relay.id);
      const ce = await browser.newContext();
      contexts.push(ce);
      e = await ce.newPage();
      await peer(e, "New reader after all authors exited");
      expect((await resolve(e, address)).status).toBe("pending");
      await b.evaluate(() => (window as any).mesh.setRelay(false));
      await rtc(e, b);
      await e.evaluate(
        (id) => (window as any).mesh.request(id),
        second.operation.bundleId,
      );
      await new Promise((r) => setTimeout(r, 800));
      expect((await resolve(e, address)).status).toBe("pending");
      await b.evaluate(() => (window as any).mesh.setRelay(true));
      await expect
        .poll(() => resolve(e!, address).then((r) => r.state.number))
        .toBe(2);
      const seeded = await resolve(e, address);
      expect(seeded.status).toBe("available");
      expect(seeded.object.id).toBe(second.operation.bundleId);
      expect(seeded.object.author.id).toBe(author.id);
      expect((await resolve(e, privateAddress)).status).toBe("pending");
      const errors = await b.evaluate(() => (window as any).networkErrors);
      expect(errors).toEqual([]);
      const directory = `.cache/site-browser-network/${info.project.name || "chromium"}`;
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        `${directory}/${bridge}.json`,
        JSON.stringify(
          {
            status: "PASS",
            nativePids: clients.map((c) => c.process.pid),
            runtimes: ["Browser", "Node", "Go"],
            media: ["webrtc", "websocket", "tcp"],
            actualRouteHops: routed.route.hops.length,
            partitionNegativeControl: true,
            heal: true,
            exactHistory: true,
            privateOpaqueTransit: true,
            signingAuthorityRejected: true,
            reverseTransfer: true,
            restartedSoleSeeder: true,
            pausedSoleSeederNegativeControl: true,
            authorPreserved: true,
            physicalRadio: false,
            uiTest: false,
          },
          null,
          2,
        ),
      );
    } finally {
      for (const p of [a, b, e])
        if (p && !p.isClosed())
          await p.evaluate(() => (window as any).shutdown?.()).catch(() => {});
      for (const context of contexts) await context.close();
      for (const client of clients) {
        await client.stop();
        rmSync(client.dir, { recursive: true, force: true });
      }
    }
  });
