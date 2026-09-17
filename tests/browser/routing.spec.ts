import { test, expect, type Page } from "@playwright/test";
import { staticHarness } from "./static-harness";
import { writeFileSync, mkdirSync } from "node:fs";
let harness: Awaited<ReturnType<typeof staticHarness>>;
test.beforeAll(async () => {
  harness = await staticHarness();
});
test.afterAll(async () => {
  await harness.close();
  expect(harness.requests.some((p) => p.startsWith("/api/"))).toBe(false);
});
const password = "frase passe longa de teste";
async function start(page: Page, name: string) {
  await page.goto(harness.url);
  return page.evaluate(
    async ({ name, password }) => {
      const r = (window as any).rl,
        p = await r.BrowserProfile.connect("mesh-profile");
      (window as any).profile = p;
      const card = await p.setup(name, password);
      (window as any).mesh = await r.BrowserMesh.start(p);
      (window as any).links = {};
      return card;
    },
    { name, password },
  );
}
async function pair(a: Page, b: Page, name: string) {
  const offer = await a.evaluate(async (name) => {
    const entry = (window as any).mesh.router.newPeer();
    (window as any).links[name] = entry;
    return entry.peer.offer();
  }, name);
  const answer = await b.evaluate(
    async ({ name, offer }) => {
      const entry = (window as any).mesh.router.newPeer();
      (window as any).links[name] = entry;
      return entry.peer.answer(offer);
    },
    { name, offer },
  );
  await a.evaluate(
    async ({ name, answer }) => (window as any).links[name].peer.accept(answer),
    { name, answer },
  );
  await expect
    .poll(() =>
      a.evaluate(
        (name) => (window as any).links[name].peer.connection.connectionState,
        name,
      ),
    )
    .toBe("connected");
  await expect
    .poll(() =>
      b.evaluate(
        (name) => (window as any).links[name].peer.link?.channel.readyState,
        name,
      ),
    )
    .toBe("open");
}
async function publish(page: Page, readers: any[], text: string) {
  return page.evaluate(
    async ({ readers, text, password }) => {
      const r = (window as any).rl,
        p = (window as any).profile;
      const identity = await r.importVault(await p.exportIdentity(), password);
      const bundle = await r.createBundle(
        identity,
        "message",
        { text, attachment: "0123456789".repeat(15_000) },
        readers,
      );
      await (window as any).mesh.announce(bundle);
      return bundle.manifest.id;
    },
    { readers, text, password },
  );
}
const ids = (page: Page) => page.evaluate(() => (window as any).profile.ids());

test("automatic A-B-C mesh: consent controls, own sends while paused, partition/heal and restarted reader takeover with author offline", async ({
  browser,
}) => {
  const contexts = await Promise.all(
    [0, 1, 2, 3].map(() => browser.newContext({ locale: "pt-PT" })),
  );
  const [a, b, c, d] = await Promise.all(contexts.map((ctx) => ctx.newPage()));
  try {
    const cards = [];
    for (const [i, page] of [a, b, c, d].entries())
      cards.push(await start(page, "Par " + i));
    for (const p of [a, c, d])
      await p.evaluate(() => (window as any).mesh.setRelay(true));
    expect(await b.evaluate(() => (window as any).mesh.settings.relay)).toBe(
      false,
    );
    await pair(a, b, "ab");
    await pair(b, c, "bc");
    const one = await publish(a, cards.slice(1), "A ponte está livre");
    await expect.poll(() => ids(b)).toContain(one);
    // Positive control for the live B-C path while B's third-party relay is disabled.
    const own = await publish(
      b,
      [cards[2]],
      "Mensagem própria com relay pausado",
    );
    await expect.poll(() => ids(c)).toContain(own);
    expect(await ids(c)).not.toContain(one);
    expect(await ids(d)).toEqual([]);
    expect(
      await b.evaluate(
        async (id) => ((await (window as any).profile.view(id)) as any).text,
        one,
      ),
    ).toBe("A ponte está livre");
    await b.evaluate(() => (window as any).mesh.setRelay(true));
    await expect.poll(() => ids(c)).toContain(one);
    for (const p of [b, c])
      await p.evaluate(() =>
        (window as any).mesh.router.disconnect((window as any).links.bc.id),
      );
    expect(
      await c.evaluate(
        () =>
          (window as any).mesh.router.peers.filter((p: any) => p.connected)
            .length,
      ),
    ).toBe(0);
    const two = await publish(
      a,
      cards.slice(1),
      "Biblioteca como ponto de encontro",
    );
    await expect.poll(() => ids(b)).toContain(two);
    expect(await ids(c)).not.toContain(two);
    await pair(b, c, "healed");
    await expect.poll(() => ids(c)).toContain(two);
    const route = await c.evaluate(
      (id) => (window as any).mesh.routes[id],
      two,
    );
    const sourceID = await a.evaluate(() => (window as any).mesh.router.id),
      bridgeID = await b.evaluate(() => (window as any).mesh.router.id);
    expect(route.hops).toEqual([sourceID, bridgeID]);
    expect(route.medium).toBe("webrtc");
    await contexts[0].close();
    await contexts[2].close();
    expect(a.isClosed() && c.isClosed()).toBe(true);
    await b.reload();
    await b.evaluate(async (password) => {
      const r = (window as any).rl,
        p = await r.BrowserProfile.connect("mesh-profile");
      await p.unlock(password);
      (window as any).profile = p;
      (window as any).mesh = await r.BrowserMesh.start(p);
      (window as any).links = {};
    }, password);
    expect(await b.evaluate(() => (window as any).mesh.settings.relay)).toBe(
      true,
    );
    expect(await ids(d)).toEqual([]);
    await pair(b, d, "seeder");
    await expect.poll(() => ids(d)).toContain(two);
    const seeded = await d.evaluate(
      async (id) => ({
        bundle: await (window as any).profile.getBundle(id),
        content: await (window as any).profile.view(id),
      }),
      two,
    );
    expect(seeded.bundle.manifest.author.id).toBe(cards[0].id);
    expect(seeded.bundle.manifest.id).toBe(two);
    expect(seeded.content).toEqual({
      text: "Biblioteca como ponto de encontro",
      attachment: "0123456789".repeat(15_000),
    });
    expect(
      await b.evaluate(
        () => (window as any).mesh.router.resources.retainedBytes,
      ),
    ).toBeLessThanOrEqual(16 * 1024 * 1024);
    mkdirSync(".cache/browser-routing", { recursive: true });
    writeFileSync(
      ".cache/browser-routing/mesh.json",
      JSON.stringify(
        {
          realBrowserContexts: 4,
          automaticRelay: true,
          livePathWithRelayDisabled: true,
          ownTrafficWhileRelayPaused: true,
          partitionHeal: true,
          routeHops: route.hops.length,
          publisherClosed: a.isClosed(),
          readerReloadedBeforeNewPeer: true,
          storedCiphertextServedAutomatically: true,
          originalAuthorPreserved: true,
          nativeAdapter: false,
          allBrowsers: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.close()));
  }
});

test("one network owner per profile and concurrent consent/preferences do not resurrect revoked relay", async ({
  page,
  context,
}) => {
  await start(page, "Consentimento");
  const other = await context.newPage();
  await other.goto(harness.url);
  try {
    expect(
      await other.evaluate(async (password) => {
        const r = (window as any).rl,
          p = await r.BrowserProfile.connect("mesh-profile");
        await p.unlock(password);
        (window as any).profile = p;
        try {
          await r.BrowserMesh.start(p);
          return false;
        } catch {
          return true;
        }
      }, password),
    ).toBe(true);
    const state = await page.evaluate(async () => {
      const m = (window as any).mesh;
      const operations = [
        m.setRelay(true),
        m.setRelay(false),
        m.setLowPower(true),
      ];
      const immediate = m.router.relay;
      await Promise.all(operations);
      const settings = m.settings,
        persisted = await (window as any).profile.getValue("mesh-settings");
      await m.close();
      return { immediate, settings, persisted };
    });
    expect(state.immediate).toBe(false);
    expect(state.settings).toEqual({
      relay: false,
      lowPower: true,
      blocked: [],
    });
    expect(state.persisted).toEqual(state.settings);
    expect(
      await other.evaluate(async () => {
        const m = await (window as any).rl.BrowserMesh.start(
          (window as any).profile,
        );
        const relay = m.router.relay;
        await m.close();
        return relay;
      }),
    ).toBe(false);
  } finally {
    await other.close();
  }
});

test("fragment scheduling preempts bulk with SOS, gives bulk a fair turn, and cancels relayed bytes without closing own traffic", async ({
  browser,
}) => {
  const ca = await browser.newContext({ locale: "pt-PT" }),
    cb = await browser.newContext({ locale: "pt-PT" }),
    a = await ca.newPage(),
    b = await cb.newPage();
  try {
    await a.goto(harness.url);
    await b.goto(harness.url);
    await a.evaluate(() => {
      (window as any).peer = new (window as any).rl.RtcPeer(async () => {});
    });
    await b.evaluate(async () => {
      const r = (window as any).rl,
        p = await r.BrowserProfile.connect("scheduler");
      await p.setup("Leitor", "frase passe longa de teste");
      (window as any).profile = p;
      (window as any).peer = new r.RtcPeer(async (bundle: any) => {
        await p.putBundle(bundle);
      });
    });
    const offer = await a.evaluate(() => (window as any).peer.offer()),
      answer = await b.evaluate(
        (offer) => (window as any).peer.answer(offer),
        offer,
      );
    await a.evaluate((answer) => (window as any).peer.accept(answer), answer);
    const result = await a.evaluate(async () => {
      const r = (window as any).rl,
        peer = (window as any).peer,
        link = peer.link;
      await link.ready();
      const who = await r.createIdentity("Origem");
      const bulk = await r.createBundle(
          who,
          "post",
          { text: "b".repeat(2_400_000) },
          "public",
        ),
        sos = await r.createBundle(
          who,
          "post",
          { text: "s".repeat(1_200_000) },
          "public",
        );
      const trace: { id: string; index: number; count: number }[] = [],
        raw = link.channel.send.bind(link.channel);
      let priorityJob: Promise<void> | undefined;
      link.channel.send = (text: string) => {
        const frame = JSON.parse(text);
        if (frame.t === "part") {
          trace.push({ id: frame.id, index: frame.index, count: frame.count });
          if (frame.id === bulk.manifest.id && frame.index === 0) {
            priorityJob = link.send(sos, () => true, "sos");
            void priorityJob!.catch(() => {});
          }
        }
        raw(text);
      };
      await link.send(bulk, () => true, "bulk");
      await priorityJob;
      link.channel.send = raw;
      const cancelled = await r.createBundle(
          who,
          "post",
          { text: "Cancelado ".repeat(90_000) },
          "public",
        ),
        own = await r.createBundle(
          who,
          "post",
          { text: "Envio próprio preservado" },
          "public",
        );
      let relayAllowed = true,
        ownJob: Promise<void> | undefined;
      link.channel.send = (text: string) => {
        const frame = JSON.parse(text);
        raw(text);
        if (
          frame.t === "part" &&
          frame.id === cancelled.manifest.id &&
          frame.index === 2
        ) {
          relayAllowed = false;
          ownJob = link.send(own, () => true, "normal");
          void ownJob!.catch(() => {});
        }
      };
      let refused = false;
      try {
        await link.send(cancelled, () => relayAllowed, "bulk");
      } catch {
        refused = true;
      }
      await ownJob;
      link.channel.send = raw;
      return {
        trace,
        bulk: bulk.manifest.id,
        sos: sos.manifest.id,
        cancelled: cancelled.manifest.id,
        own: own.manifest.id,
        refused,
        closed: link.closed,
      };
    });
    const firstSOS = result.trace.findIndex((f) => f.id === result.sos),
      lastSOS = result.trace.map((f) => f.id).lastIndexOf(result.sos),
      lastBulk = result.trace.map((f) => f.id).lastIndexOf(result.bulk);
    expect(firstSOS).toBeGreaterThan(0);
    expect(firstSOS).toBeLessThan(lastBulk);
    const competition = result.trace.slice(
      firstSOS,
      Math.min(lastSOS, lastBulk) + 1,
    );
    expect(competition.some((f) => f.id === result.bulk)).toBe(true);
    let run = 0,
      longest = 0;
    for (const frame of competition) {
      run = frame.id === result.sos ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThanOrEqual(7);
    expect(result.refused).toBe(true);
    expect(result.closed).toBe(false);
    const stored = await ids(b);
    expect(stored).toContain(result.bulk);
    expect(stored).toContain(result.sos);
    expect(stored).toContain(result.own);
    expect(stored).not.toContain(result.cancelled);
    await expect
      .poll(() =>
        b.evaluate(() => (window as any).peer.link.resources.incoming),
      )
      .toBe(0);
    mkdirSync(".cache/browser-routing", { recursive: true });
    writeFileSync(
      ".cache/browser-routing/scheduling.json",
      JSON.stringify(
        {
          frames: result.trace.length,
          firstSOS,
          lastBulk,
          bulkProgressUnderSOS: true,
          longestPriorityRun: longest,
          relayedTransferCancelled: result.refused,
          ownTrafficContinuedOnSameOpenChannel: !result.closed,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const diagnostics = await Promise.allSettled(
      [a, b].map((p) =>
        p.evaluate(async () => {
          const peer = (window as any).peer,
            pc = peer?.connection;
          const report = pc
            ? [...(await pc.getStats()).values()]
                .filter((row: any) =>
                  ["candidate-pair", "transport", "data-channel"].includes(
                    row.type,
                  ),
                )
                .map((row: any) => ({
                  type: row.type,
                  state: row.state,
                  nominated: row.nominated,
                  bytesSent: row.bytesSent,
                  bytesReceived: row.bytesReceived,
                  dtlsState: row.dtlsState,
                  messagesSent: row.messagesSent,
                  messagesReceived: row.messagesReceived,
                }))
            : [];
          return {
            connection: pc?.connectionState,
            ice: pc?.iceConnectionState,
            gathering: pc?.iceGatheringState,
            signalling: pc?.signalingState,
            localDescription: pc?.localDescription?.type,
            remoteDescription: pc?.remoteDescription?.type,
            channel: peer?.link?.channel.readyState,
            closed: peer?.link?.closed,
            counters: peer?.link?.counters,
            resources: peer?.link?.resources,
            report,
          };
        }),
      ),
    );
    mkdirSync(".cache/browser-routing", { recursive: true });
    writeFileSync(
      ".cache/browser-routing/scheduling-failure.json",
      JSON.stringify(diagnostics, null, 2),
    );
    throw error;
  } finally {
    await ca.close();
    await cb.close();
  }
});

test("packet bounds reject expiry, hop loops and tampering; retained flood is bounded", async ({
  page,
}) => {
  await page.goto(harness.url);
  const result = await page.evaluate(async () => {
    const r = (window as any).rl,
      valid = await r.createPacket("source", { type: "inventory", ids: [] });
    const bads: any[] = [];
    for (const patch of [
      { expires: Date.now() - 1 },
      { created: Date.now() + 600_000, expires: Date.now() + 700_000 },
      { maxHops: 13 },
      { hops: ["source", "source"] },
      { hops: ["different"] },
      { priority: "urgent" },
      { expires: valid.created + 3600_001 },
    ]) {
      const value = { ...valid, ...patch };
      const { id, hops, ...body } = value;
      value.id = await r.hash(r.canonical(body));
      bads.push(value);
    }
    bads.push({ ...valid, unexpected: true });
    bads.push({ ...valid, id: "a".repeat(64) });
    const rejected = [];
    for (const bad of bads) {
      try {
        await r.verifiedPacket(bad);
        rejected.push(false);
      } catch {
        rejected.push(true);
      }
    }
    const router = new r.BrowserRouter({
      relay: true,
      validate: async () => {},
      receive: async () => {},
    });
    for (let i = 0; i < 80; i++) await router.broadcast({ i }, "normal");
    const bounded = router.resources;
    router.relay = false;
    const own = router.resources;
    let relayRejected = false;
    try {
      await router.broadcast({ thirdParty: true }, "normal", 1000, true);
    } catch {
      relayRejected = true;
    }
    router.close();
    return {
      valid: (await r.verifiedPacket(valid)).id === valid.id,
      rejected,
      bounded,
      own,
      relayRejected,
    };
  });
  expect(result.valid && result.relayRejected).toBe(true);
  expect(result.rejected).toEqual(Array(9).fill(true));
  expect(result.bounded.retained).toBe(64);
  expect(result.bounded.retainedBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
  expect(result.own.retained).toBe(64);
});

test("low-power defers bulk on a live link, keeps SOS moving and never revives an expired queued packet", async ({
  page,
  context,
}) => {
  const other = await context.newPage();
  try {
    for (const p of [page, other]) {
      await p.goto(harness.url);
      await p.evaluate(() => {
        (window as any).received = [];
        (window as any).links = {};
        (window as any).mesh = {
          router: new (window as any).rl.BrowserRouter({
            relay: false,
            validate: async () => {},
            receive: async (value: any) => {
              (window as any).received.push(value.label);
            },
          }),
        };
      });
    }
    await page.evaluate(async () => {
      const router = (window as any).mesh.router;
      router.lowPower = true;
      await router.broadcast({ label: "bulk" }, "bulk");
      await router.broadcast({ label: "sos" }, "sos");
    });
    await pair(page, other, "power");
    await expect
      .poll(() => other.evaluate(() => (window as any).received))
      .toContain("sos");
    expect(await other.evaluate(() => (window as any).received)).not.toContain(
      "bulk",
    );
    await page.evaluate(() =>
      (window as any).mesh.router.broadcast({ label: "expired" }, "bulk", 300),
    );
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).mesh.router.resources.retained),
      )
      .toBe(2);
    await page.evaluate(() => {
      (window as any).mesh.router.lowPower = false;
    });
    await expect
      .poll(() => other.evaluate(() => (window as any).received))
      .toContain("bulk");
    expect(await other.evaluate(() => (window as any).received)).not.toContain(
      "expired",
    );
  } finally {
    await page.evaluate(() => (window as any).mesh?.router.close());
    await other.close();
  }
});

test("browser routing packets cross real native TCP routers; native packet bytes verify in the browser and corruption never forwards", async ({
  page,
}) => {
  const { Router, TRANSPORT_LIMITS } =
    await import("../../packages/transport/src/index");
  const { createConnection } = await import("node:net");
  const { canonical, hash, verifyBundle } =
    await import("../../packages/core/src/index");
  await page.goto(harness.url);
  const packet = await page.evaluate(async () => {
    const r = (window as any).rl,
      who = await r.createIdentity("Browser TCP vector");
    return r.createPacket("browser-vector", {
      type: "bundle",
      bundle: await r.createBundle(
        who,
        "post",
        { type: "post", text: "Formato de pacote comum" },
        "public",
      ),
    });
  });
  const a = new Router({
      relay: true,
      validate: (v: any) => verifyBundle(v.bundle),
    }),
    b = new Router({
      relay: false,
      validate: (v: any) => verifyBundle(v.bundle),
    });
  const received: { payload: any; route: any }[] = [];
  b.on("payload", (payload, route) => received.push({ payload, route }));
  let socket: ReturnType<typeof createConnection> | undefined;
  try {
    const port = await a.listen();
    b.connectTcp("127.0.0.1", port);
    await expect.poll(() => b.peers.some((p) => p.connected)).toBe(true);
    socket = createConnection({ host: "127.0.0.1", port });
    await new Promise<void>((resolve, reject) => {
      socket!.once("connect", resolve);
      socket!.once("error", reject);
    });
    const parts = new Map<string, { data: Buffer[]; count: number }>();
    let buffer = "";
    const nativePackets: any[] = [];
    socket.on("data", (bytes) => {
      buffer += bytes.toString();
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const raw = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!raw) continue;
        const frame = JSON.parse(raw);
        if (frame.t !== "part") continue;
        let assembly = parts.get(frame.id);
        if (!assembly) {
          assembly = { data: [], count: frame.count };
          parts.set(frame.id, assembly);
        }
        assembly.data[frame.index] = Buffer.from(frame.data, "base64");
        if (assembly.data.filter(Boolean).length === assembly.count) {
          nativePackets.push(
            JSON.parse(Buffer.concat(assembly.data).toString()),
          );
          parts.delete(frame.id);
          socket!.write(JSON.stringify({ t: "ack", id: frame.id }) + "\n");
        }
      }
    });
    const send = (p: any) => {
      const bytes = Buffer.from(canonical(p)),
        count = Math.ceil(bytes.length / TRANSPORT_LIMITS.fragmentBytes);
      for (let index = 0; index < count; index++)
        socket!.write(
          JSON.stringify({
            t: "part",
            id: p.id,
            index,
            count,
            data: bytes
              .subarray(
                index * TRANSPORT_LIMITS.fragmentBytes,
                (index + 1) * TRANSPORT_LIMITS.fragmentBytes,
              )
              .toString("base64"),
          }) + "\n",
        );
    };
    send(packet);
    await expect.poll(() => received.length).toBe(1);
    expect(received[0].payload).toEqual(packet.payload);
    expect(received[0].route.hops).toEqual(["browser-vector", a.id]);
    const replyID = a.broadcast(packet.payload);
    await expect
      .poll(() => nativePackets.some((p) => p.id === replyID))
      .toBe(true);
    await expect.poll(() => received.length).toBe(2);
    const nativePacket = nativePackets.find((p) => p.id === replyID);
    expect(
      await page.evaluate(
        async (p) => (await (window as any).rl.verifiedPacket(p)).id,
        nativePacket,
      ),
    ).toBe(replyID);
    const forged = structuredClone(packet);
    forged.payload.bundle.manifest.signature = "A".repeat(88);
    const { id: discarded, hops: path, ...body } = forged;
    forged.id = hash(canonical(body));
    send(forged);
    await expect.poll(() => a.counters.rejected).toBeGreaterThan(0);
    expect(received.length).toBe(2);
    send(packet);
    await expect.poll(() => a.counters.duplicates).toBeGreaterThan(0);
    expect(received.length).toBe(2);
    const fresh = await page.evaluate(
      async (payload) =>
        (window as any).rl.createPacket("browser-vector", payload),
      packet.payload,
    );
    send(fresh);
    await expect.poll(() => received.length).toBe(3);
    expect(received[2].payload).toEqual(packet.payload);
    mkdirSync(".cache/browser-routing", { recursive: true });
    writeFileSync(
      ".cache/browser-routing/native-packet.json",
      JSON.stringify(
        {
          nativeRouters: 2,
          realTcpSockets: true,
          browserProducedPacketAcceptedAndForwarded: true,
          nativeProducedPacketVerifiedInBrowser: true,
          corruptionBeforeForward: true,
          duplicatesSuppressed: true,
          validAfterInvalid: true,
          scope:
            "Wire interoperability fixture; not an implemented browser-to-native transport adapter",
        },
        null,
        2,
      ),
    );
  } finally {
    socket?.destroy();
    await b.stop();
    await a.stop();
  }
});

test("opaque packet corruption is rejected by the browser mesh before storage or forwarding, with valid controls on both sides", async ({
  browser,
}) => {
  const contexts = await Promise.all(
    [0, 1, 2].map(() => browser.newContext({ locale: "pt-PT" })),
  );
  const [a, b, c] = await Promise.all(contexts.map((ctx) => ctx.newPage()));
  try {
    await a.goto(harness.url);
    await start(b, "Retransmissor");
    await start(c, "Destino");
    for (const p of [b, c])
      await p.evaluate(() => (window as any).mesh.setRelay(true));
    await pair(b, c, "bc");
    const offer = await a.evaluate(async () => {
      const r = (window as any).rl;
      (window as any).attacker = new r.RtcTransportPeer(
        async () => {},
        r.packetCodec,
      );
      return (window as any).attacker.offer();
    });
    const answer = await b.evaluate(async (offer) => {
      const link = (window as any).mesh.router.newPeer();
      (window as any).attackLink = link;
      return link.peer.answer(offer);
    }, offer);
    await a.evaluate(
      (answer) => (window as any).attacker.accept(answer),
      answer,
    );
    const validID = await a.evaluate(async () => {
      const r = (window as any).rl,
        who = await r.createIdentity("Par externo");
      (window as any).attackerIdentity = who;
      const bundle = await r.createBundle(
        who,
        "post",
        { text: "Controlo válido antes" },
        "public",
      );
      await (window as any).attacker.link.send(
        await r.createPacket("external", { type: "bundle", bundle }),
      );
      return bundle.manifest.id;
    });
    await expect.poll(() => ids(c)).toContain(validID);
    const attack = await a.evaluate(async () => {
      const r = (window as any).rl,
        bundle = await r.createBundle(
          (window as any).attackerIdentity,
          "post",
          { text: "Não encaminhar" },
          "public",
        );
      const chunk = bundle.manifest.chunks[0].hash;
      bundle.chunks[chunk] = "A".repeat(bundle.chunks[chunk].length);
      const packet = await r.createPacket("external", {
        type: "bundle",
        bundle,
      });
      let rejected = false;
      try {
        await (window as any).attacker.link.send(packet);
      } catch {
        rejected = true;
      }
      return { id: bundle.manifest.id, rejected };
    });
    expect(attack.rejected).toBe(true);
    await expect
      .poll(() =>
        b.evaluate(() => (window as any).mesh.router.counters.rejected),
      )
      .toBeGreaterThan(0);
    expect(await ids(b)).not.toContain(attack.id);
    expect(await ids(c)).not.toContain(attack.id);
    const card = await c.evaluate(() => (window as any).profile.identity),
      after = await publish(b, [card], "Controlo válido depois");
    await expect.poll(() => ids(c)).toContain(after);
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.close()));
  }
});

test("managed relay revocation cancels an in-flight forwarded packet and keeps an authored SOS on that same open link", async ({
  browser,
}, info) => {
  const contexts = await Promise.all(
    [0, 1, 2].map(() => browser.newContext({ locale: "pt-PT" })),
  );
  const [a, b, c] = await Promise.all(contexts.map((ctx) => ctx.newPage()));
  try {
    const cards = [];
    for (const [i, p] of [a, b, c].entries()) {
      cards.push(await start(p, "Consentimento " + i));
      await p.evaluate(() => (window as any).mesh.setRelay(true));
    }
    await pair(a, b, "ab");
    await pair(b, c, "bc");
    for (const p of [b, c])
      await p.evaluate(() => {
        const w = window as any,
          link = w.links.bc.peer.link,
          channel = link.channel;
        w.revocationFrames = [];
        const record = (direction: string, text: string) => {
          if (w.revocationFrames.length >= 256) return;
          try {
            const f = JSON.parse(text);
            w.revocationFrames.push({
              direction,
              t: f.t,
              id: f.id?.slice(0, 12),
              index: f.index,
              count: f.count,
              nonce: f.nonce,
              at: performance.now(),
            });
          } catch {}
        };
        const raw = channel.send.bind(channel);
        channel.send = (text: string) => {
          record("send", text);
          return raw(text);
        };
        channel.addEventListener("message", (e: MessageEvent) =>
          record("receive", e.data),
        );
        const close = link.close.bind(link);
        link.close = (reason?: string) => {
          w.revocationClose ??= {
            reason: reason ?? "local",
            at: performance.now(),
            counters: { ...link.counters },
            resources: { ...link.resources },
          };
          return close(reason);
        };
      });
    const prepared = await a.evaluate(
      async ({ cards, password }) => {
        const r = (window as any).rl,
          profile = (window as any).profile,
          who = await r.importVault(await profile.exportIdentity(), password);
        const bundle = await r.createBundle(
          who,
          "message",
          { text: "Tráfego a interromper", attachment: "x".repeat(900_000) },
          cards,
        );
        (window as any).preparedBundle = bundle;
        return bundle.manifest.id;
      },
      { cards: cards.slice(1), password },
    );
    await b.evaluate(
      async ({ card, password }) => {
        const r = (window as any).rl,
          profile = (window as any).profile,
          who = await r.importVault(await profile.exportIdentity(), password);
        (window as any).ownBundle = await r.createBundle(
          who,
          "message",
          { text: "SOS próprio preservado" },
          [card],
        );
        const channel = (window as any).links.bc.peer.link.channel,
          raw = channel.send.bind(channel);
        let fired = false;
        channel.send = (text: string) => {
          const frame = JSON.parse(text);
          raw(text);
          // All earlier inventory/request packets fit in one fragment; the large forwarded packet is the first to reach index2.
          if (!fired && frame.t === "part" && frame.index === 2) {
            fired = true;
            (window as any).revokedPacketID = frame.id;
            (window as any).revocation = (window as any).mesh.setRelay(false);
            void (window as any).revocation.catch(() => {});
            (window as any).ownSend = (window as any).mesh.announce(
              (window as any).ownBundle,
              "sos",
            );
            void (window as any).ownSend.catch(() => {});
          }
        };
      },
      { card: cards[2], password },
    );
    const packetID = await a.evaluate(() =>
      (window as any).mesh.announce((window as any).preparedBundle),
    );
    await expect
      .poll(() => b.evaluate(() => (window as any).revokedPacketID))
      .toBe(packetID);
    const ownID = await b.evaluate(async () => {
      await (window as any).revocation;
      await (window as any).ownSend;
      return (window as any).ownBundle.manifest.id;
    });
    await expect.poll(() => ids(c)).toContain(ownID);
    expect(await ids(b)).toContain(prepared);
    expect(await ids(c)).not.toContain(prepared);
    expect(await b.evaluate(() => (window as any).mesh.router.relay)).toBe(
      false,
    );
    expect(
      await b.evaluate(() => (window as any).links.bc.peer.link.closed),
    ).toBe(false);
    await expect
      .poll(() =>
        c.evaluate(() => (window as any).links.bc.peer.link.resources.incoming),
      )
      .toBe(0);
  } finally {
    const diagnostics = [];
    for (const p of [b, c])
      if (!p.isClosed())
        diagnostics.push(
          await p
            .evaluate(() => {
              const w = window as any,
                link = w.links?.bc?.peer?.link;
              return {
                close: w.revocationClose,
                closeReason: link?.closeReason,
                closed: link?.closed,
                counters: link?.counters,
                resources: link?.resources,
                frames: w.revocationFrames,
              };
            })
            .catch(() => ({ diagnosticUnavailable: true })),
        );
    const directory = `.cache/relay-revocation/${info.project.name || "chromium"}-${info.repeatEachIndex}`;
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      directory + "/result.json",
      JSON.stringify(diagnostics, null, 2),
    );
    await Promise.all(contexts.map((ctx) => ctx.close()));
  }
});
