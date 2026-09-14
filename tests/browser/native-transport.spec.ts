import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { staticHarness } from "./static-harness";
import { launch, password, until } from "../helpers";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
let harness: Awaited<ReturnType<typeof staticHarness>>;
test.beforeAll(async () => {
  harness = await staticHarness();
});
test.afterAll(async () => {
  await harness.close();
  expect(harness.requests.some((p) => p.startsWith("/api/"))).toBe(false);
});
async function browserNode(page: Page, name: string) {
  await page.goto(harness.url);
  return page.evaluate(
    async ({ name, password }) => {
      const r = (window as any).rl,
        p = await r.BrowserProfile.connect("native-link");
      const identity = await p.setup(name, password);
      (window as any).profile = p;
      (window as any).mesh = await r.BrowserMesh.start(p);
      await (window as any).mesh.setRelay(true);
      return identity;
    },
    { name, password },
  );
}
async function rtc(a: Page, b: Page) {
  const offer = await a.evaluate(async () => {
    const link = (window as any).mesh.router.newPeer();
    (window as any).rtc = link;
    return link.peer.offer();
  });
  const answer = await b.evaluate(async (offer) => {
    const link = (window as any).mesh.router.newPeer();
    (window as any).rtc = link;
    return link.peer.answer(offer);
  }, offer);
  await a.evaluate((answer) => (window as any).rtc.peer.accept(answer), answer);
  await expect
    .poll(() =>
      b.evaluate(() => (window as any).rtc.peer.link?.channel.readyState),
    )
    .toBe("open");
}
const browserIDs = (page: Page) =>
  page.evaluate(() => (window as any).profile.ids());

for (const backend of ["node", "native"] as const)
  test(`browser WebRTC to browser WebSocket to real ${backend} daemon, reverse transfer and invitation revocation`, async ({
    browser,
  }) => {
    const native = await launch(undefined, 0, 0, backend),
      ca = await browser.newContext(),
      cb = await browser.newContext(),
      a = await ca.newPage(),
      b = await cb.newPage();
    let ui: Page | undefined;
    let uiContext: BrowserContext | undefined;
    try {
      await native.call("setup", { name: "Nó nativo", password });
      const alice = await browserNode(a, "Alice web");
      await browserNode(b, "Par web");
      await rtc(a, b);
      const invitation = await native.call("web-peer", { origin: harness.url });
      await b.evaluate(async (invitation) => {
        const link = (window as any).mesh.router.connectWebSocket(invitation);
        (window as any).wsLink = link;
        await link.peer.link.ready();
      }, invitation);
      const outgoing = await a.evaluate(async (password) => {
        const r = (window as any).rl,
          p = (window as any).profile,
          who = await r.importVault(await p.exportIdentity(), password);
        const bundle = await r.createBundle(
          who,
          "post",
          {
            type: "post",
            text: "WebRTC e WebSocket reais",
            attachments: [
              {
                name: "rota.txt",
                mime: "text/plain",
                data: r.b64(r.utf8("Entre pares. ".repeat(7000))),
              },
            ],
          },
          "public",
        );
        await (window as any).mesh.announce(bundle);
        return bundle.manifest.id;
      }, password);
      const delivered = await until(
        () => native.call("state"),
        (s) => s.objects.some((o: any) => o.id === outgoing),
      );
      const object = delivered.objects.find((o: any) => o.id === outgoing);
      expect(object.author.id).toBe(alice.id);
      expect(object.route.medium).toBe("websocket");
      expect(object.route.hops).toHaveLength(2);
      expect(delivered.peers.map((p: any) => p.medium)).toEqual(["websocket"]);
      expect(JSON.stringify(delivered).includes(invitation.token)).toBe(false);
      await expect(
        native.call("web-peer", { origin: "https://invalid.example/path" }),
      ).rejects.toThrow();
      expect(
        await b.evaluate(() => (window as any).wsLink.peer.link.closed),
      ).toBe(false);
      uiContext = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      ui = await uiContext.newPage();
      await ui.goto(native.url + "/#token=" + native.token);
      await ui.getByRole("button", { name: "A rede", exact: true }).click();
      await expect(ui.getByText("WebSocket", { exact: true })).toBeVisible();
      const accessibility = await new AxeBuilder({ page: ui })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(accessibility.violations).toEqual([]);
      mkdirSync(".cache/browser-native", { recursive: true });
      writeFileSync(
        `.cache/browser-native/${backend}-network-axe.json`,
        JSON.stringify(
          {
            violations: accessibility.violations,
            passed: accessibility.passes.length,
          },
          null,
          2,
        ),
      );
      await ui.screenshot({
        path: `.cache/browser-native/${backend}-network.png`,
        fullPage: true,
      });
      const reply = await native.call("publish", {
        content: { type: "post", text: "Resposta do processo Node" },
        recipients: "public",
      });
      await expect.poll(() => browserIDs(a)).toContain(reply.id);
      expect(
        await a.evaluate(
          async (id) => (await (window as any).profile.view(id)).text,
          reply.id,
        ),
      ).toBe("Resposta do processo Node");
      const forbidden = await fetch(native.url + "/api/state", {
        headers: {
          Authorization: "Bearer " + invitation.token,
          Origin: native.url,
        },
      });
      expect(forbidden.status).toBe(401);
      await native.call("web-peer-stop", {});
      await expect
        .poll(() => b.evaluate(() => (window as any).wsLink.peer.link.closed))
        .toBe(true);
      expect((await native.call("state")).initialized).toBe(true);
      mkdirSync(".cache/browser-native", { recursive: true });
      writeFileSync(
        `.cache/browser-native/${backend}-path.json`,
        JSON.stringify(
          {
            nodeProcess: native.process.pid,
            actualNativeDaemon: true,
            webBrowserContexts: 2,
            media: ["webrtc", "websocket"],
            hops: object.route.hops.length,
            originalAuthorPreserved: true,
            reverseTransfer: true,
            webInvitationNotControlCapability: true,
            revoked: true,
            nativeGo: backend === "native",
            physicalRadio: false,
          },
          null,
          2,
        ),
      );
    } finally {
      await uiContext?.close();
      await ca.close();
      await cb.close();
      await native.stop();
      rmSync(native.dir, { recursive: true, force: true });
    }
  });

test("private four-medium route WebRTC-WebSocket-TCP-serial, partition/heal and restarted browser seeder with author offline", async ({
  browser,
}) => {
  test.skip(
    process.platform === "win32",
    "This fixture requires real POSIX PTYs; no radio or Windows serial claim.",
  );
  const { startPTY } = await import("../native/mixed-helper");
  const { existsSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const pty = await startPTY(),
    clients: Awaited<ReturnType<typeof launch>>[] = [];
  const ca = await browser.newContext(),
    cb = await browser.newContext(),
    a = await ca.newPage(),
    b = await cb.newPage();
  let success = false;
  try {
    const c = await launch(undefined, 0, 0, "native");
    clients.push(c);
    const d = await launch(undefined, 0, 0, "node");
    clients.push(d);
    const e = await launch(undefined, 0, -1, "node");
    clients.push(e);
    await c.call("setup", { name: "Go opaque bridge", password });
    await d.call("setup", { name: "Node serial bridge", password });
    const reader = await e.call("setup", {
      name: "Isolated serial reader",
      password,
    });
    const author = await browserNode(a, "Autora web"),
      seeder = await browserNode(b, "Leitor web");
    await rtc(a, b);
    await c.call("connect", { host: "127.0.0.1", port: d.tcpPort });
    await d.call("serial", { path: pty.left });
    await e.call("serial", { path: pty.right });
    const invitation = await c.call("web-peer", { origin: harness.url });
    await b.evaluate(async (invitation) => {
      const link = (window as any).mesh.router.connectWebSocket(invitation);
      (window as any).wsLink = link;
      await link.peer.link.ready();
    }, invitation);
    await until(
      () => c.call("state"),
      (s) =>
        s.peers.some((p: any) => p.medium === "websocket") &&
        s.peers.some((p: any) => p.medium === "tcp"),
    );
    const isolated = await e.call("state");
    expect(isolated.tcpPort).toBe(-1);
    expect(isolated.webPeer).toBeNull();
    expect(isolated.peers.map((p: any) => p.medium)).toEqual(["serial"]);
    expect(
      await a.evaluate(() =>
        (window as any).mesh.router.peers.map((p: any) => p.medium),
      ),
    ).toEqual(["webrtc"]);
    const publish = async (text: string, attachment = "") =>
      a.evaluate(
        async ({ text, attachment, password, readers }) => {
          const r = (window as any).rl,
            p = (window as any).profile,
            who = await r.importVault(await p.exportIdentity(), password);
          const content = {
            type: "post",
            text,
            ...(attachment
              ? {
                  attachments: [
                    {
                      name: "mapa.txt",
                      mime: "text/plain",
                      data: r.b64(r.utf8(attachment)),
                    },
                  ],
                }
              : {}),
          };
          const bundle = await r.createBundle(who, "post", content, readers);
          await (window as any).mesh.announce(bundle);
          return bundle.manifest.id;
        },
        { text, attachment, password, readers: [seeder, reader] },
      );
    const first = await publish("Controlo positivo da rota privada");
    const live = await until(
        () => e.call("state"),
        (s) => s.objects.some((o: any) => o.id === first),
        20000,
      ),
      object = live.objects.find((o: any) => o.id === first);
    expect(object.author.id).toBe(author.id);
    expect(object.route.hops).toHaveLength(4);
    expect(object.route.medium).toBe("serial");
    await expect(c.call("view", { id: first })).rejects.toThrow();
    await expect(d.call("view", { id: first })).rejects.toThrow();
    expect(
      await b.evaluate(
        async (id) => (await (window as any).profile.view(id)).text,
        first,
      ),
    ).toBe("Controlo positivo da rota privada");
    pty.partition();
    const body = "Mapa privado entre pares. ".repeat(2400),
      second = await publish("Partição real do adaptador série", body);
    await until(
      async () => existsSync(join(d.dir, "store/objects", second + ".json")),
      (exists) => exists,
    );
    const end = Date.now() + 2500;
    while (Date.now() < end) {
      expect(
        (await e.call("state")).objects.some((o: any) => o.id === second),
      ).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    pty.partition();
    await until(
      () => e.call("state"),
      (s) => s.objects.some((o: any) => o.id === second),
      20000,
    );
    const attachment = await e.call("attachment", { id: second, index: 0 });
    expect(Buffer.from(attachment.data, "base64").toString()).toBe(body);
    for (const middle of [c, d])
      expect(
        readFileSync(
          join(middle.dir, "store/objects", second + ".json"),
          "utf8",
        ).includes("Partição real do adaptador série"),
      ).toBe(false);
    await c.call("settings", { relay: false });
    const held = await publish("Guardado pelo leitor antes do autor desligar");
    await until(
      async () => existsSync(join(c.dir, "store/objects", held + ".json")),
      (exists) => exists,
    );
    expect(
      await b.evaluate(
        async (id) => (await (window as any).profile.view(id)).text,
        held,
      ),
    ).toBe("Guardado pelo leitor antes do autor desligar");
    const absentUntil = Date.now() + 1800;
    while (Date.now() < absentUntil) {
      expect(existsSync(join(d.dir, "store/objects", held + ".json"))).toBe(
        false,
      );
      expect(
        (await e.call("state")).objects.some((o: any) => o.id === held),
      ).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await ca.close();
    expect(a.isClosed()).toBe(true);
    await c.stop();
    expect(c.process.exitCode !== null || c.process.signalCode !== null).toBe(
      true,
    );
    await b.reload();
    await b.evaluate(async (password) => {
      const r = (window as any).rl,
        p = await r.BrowserProfile.connect("native-link");
      await p.unlock(password);
      (window as any).profile = p;
      (window as any).mesh = await r.BrowserMesh.start(p);
    }, password);
    const fresh = await launch(undefined, 0, 0, "native");
    clients.push(fresh);
    await fresh.call("setup", { name: "Fresh opaque Go bridge", password });
    expect((await fresh.call("state")).storage.count).toBe(0);
    await fresh.call("connect", { host: "127.0.0.1", port: d.tcpPort });
    const nextInvite = await fresh.call("web-peer", { origin: harness.url });
    await b.evaluate(async (invitation) => {
      const link = (window as any).mesh.router.connectWebSocket(invitation);
      await link.peer.link.ready();
    }, nextInvite);
    const restored = await until(
      () => e.call("state"),
      (s) => s.objects.some((o: any) => o.id === held),
      20000,
    );
    expect(restored.objects.find((o: any) => o.id === held).author.id).toBe(
      author.id,
    );
    expect((await e.call("view", { id: held })).content.text).toBe(
      "Guardado pelo leitor antes do autor desligar",
    );
    mkdirSync(".cache/browser-native", { recursive: true });
    writeFileSync(
      ".cache/browser-native/heterogeneous.json",
      JSON.stringify(
        {
          browserContexts: 2,
          nativeProcesses: clients.map((c) => c.process.pid),
          media: ["webrtc", "websocket", "tcp", "serial-pty"],
          initialHops: object.route.hops.length,
          privateContent: true,
          opaqueMiddleReadersRejected: 2,
          serialTargetTCPDisabled: true,
          partitionNegativeMs: 2500,
          healedBytes: Buffer.byteLength(body),
          relayPauseNegative: true,
          authorContextClosed: true,
          firstNativeBridgeStopped: true,
          browserReaderReloaded: true,
          newEmptyGoBridge: true,
          automaticOfflineSeederTakeover: true,
          authorshipPreserved: true,
          physicalRadio: false,
          allOS: false,
        },
        null,
        2,
      ),
    );
    success = true;
  } finally {
    await ca.close();
    await cb.close();
    for (const client of clients) await client.stop();
    await pty.stop();
    if (success)
      for (const client of clients)
        rmSync(client.dir, { recursive: true, force: true });
  }
});

test("late native ACK cannot leave an orphan retry assembly or close an otherwise healthy WebSocket", async ({
  browser,
}) => {
  const native = await launch(undefined, 0, 0, "node"),
    context = await browser.newContext(),
    page = await context.newPage();
  try {
    await native.call("setup", { name: "Late ACK sender", password });
    await browserNode(page, "Slow durable receiver");
    await page.exposeFunction("pauseNativeRetry", async () => {
      await native.call("settings", { lowPower: true });
      const barrier = await native.call("publish", {
        content: {
          type: "post",
          text: "Ordered pause barrier",
          priority: "sos",
        },
        recipients: "public",
      });
      return barrier.id;
    });
    const invitation = await native.call("web-peer", { origin: harness.url });
    await page.evaluate(async (invitation) => {
      const r = (window as any).rl,
        mesh = (window as any).mesh,
        profile = (window as any).profile;
      const peer = mesh.router.connectWebSocket(invitation).peer;
      (window as any).retryPeer = peer;
      await peer.link.ready();
      const original = profile.putBundle.bind(profile);
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      let delayed = false;
      const starts = new Map<string, number>(),
        markers = new Set<string>(),
        waiters = new Map<string, () => void>();
      const retry = { last: -1, count: 0 };
      (window as any).retryObserved = false;
      profile.putBundle = async (bundle: any, ...args: any[]) => {
        if (!delayed && bundle.manifest.chunks.length > 30) {
          delayed = true;
          await blocked;
        }
        return original(bundle, ...args);
      };
      peer.link.channel.addEventListener("message", (event: MessageEvent) => {
        const frame = JSON.parse(event.data);
        if (frame.t !== "part") return;
        if (frame.count === 1) {
          const value = JSON.parse(
              new TextDecoder().decode(r.un64(frame.data)),
            ),
            id = value.payload?.bundle?.manifest?.id;
          if (id) {
            markers.add(id);
            waiters.get(id)?.();
            waiters.delete(id);
          }
        }
        if (frame.count > 500) {
          if (frame.index === 0)
            starts.set(frame.id, (starts.get(frame.id) ?? 0) + 1);
          if (starts.get(frame.id) === 2) {
            retry.last = Math.max(retry.last, frame.index);
            retry.count = frame.count;
            if (frame.index === 0) {
              (window as any).retryObserved = true;
              void (window as any)
                .pauseNativeRetry()
                .then(async (id: string) => {
                  // The marker is on the same ordered stream, after the sender paused bulk.
                  if (!markers.has(id))
                    await new Promise<void>((resolve) =>
                      waiters.set(id, resolve),
                    );
                  (window as any).retryWasPartial =
                    retry.last + 1 < retry.count;
                  (window as any).retryFragmentCount = retry.last + 1;
                  release();
                })
                .catch((error: Error) => {
                  (window as any).retrySetupError = error.message;
                  release();
                });
            }
          }
        }
      });
    }, invitation);
    const sent = await native.call("publish", {
      content: {
        type: "post",
        text: "Slow acceptance with late ACK",
        priority: "bulk",
        attachments: [
          {
            name: "large.bin",
            mime: "application/octet-stream",
            data: Buffer.alloc(2_400_000, 37).toString("base64"),
          },
        ],
      },
      recipients: "public",
    });
    await expect
      .poll(() => page.evaluate(() => (window as any).retryObserved))
      .toBe(true);
    await expect.poll(() => browserIDs(page)).toContain(sent.id);
    expect(
      await page.evaluate(() => (window as any).retrySetupError),
    ).toBeUndefined();
    expect(await page.evaluate(() => (window as any).retryWasPartial)).toBe(
      true,
    );
    expect((await native.call("state")).counters.retransmits).toBeGreaterThan(
      0,
    );
    await until(
      () => native.call("state"),
      (s) => s.peers.every((p: any) => p.queued === 0),
    );
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as any).retryPeer.link.resources.incoming,
          ),
        { timeout: 3000 },
      )
      .toBe(0);
    await native.call("settings", { lowPower: false });
    const probe = await native.call("publish", {
      content: { type: "post", text: "Valid traffic after late ACK" },
      recipients: "public",
    });
    await expect.poll(() => browserIDs(page)).toContain(probe.id);
    expect(
      await page.evaluate(() => (window as any).retryPeer.link.closed),
    ).toBe(false);
  } finally {
    await context.close();
    await native.stop();
    rmSync(native.dir, { recursive: true, force: true });
  }
});
