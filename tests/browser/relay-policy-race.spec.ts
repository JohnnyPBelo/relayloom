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

for (const mode of ["request", "serve", "unrelated-error"] as const)
  test(`relay policy race during ${mode} distinguishes a cancelled local response from an invalid peer frame`, async ({
    browser,
  }, info) => {
    const contexts = [await browser.newContext(), await browser.newContext()];
    const [b, c] = await Promise.all(contexts.map((ctx) => ctx.newPage()));
    const out = `.cache/relay-policy-race/${info.project.name}/${mode}-${info.repeatEachIndex}`;
    mkdirSync(out, { recursive: true });
    try {
      const ownerB = await start(b, "Relay da prova"),
        ownerC = await start(c, "Par da prova");
      for (const p of [b, c])
        await p.evaluate(() => (window as any).mesh.setRelay(true));
      const resourceOwner = mode === "request" ? c : b;
      const resourceID = await resourceOwner.evaluate(async () => {
        const w = window as any;
        const bundle = await w.profile.signContent(
          "site-resource",
          {
            type: "site-resource",
            domain: "relayloom/site-resource/1",
            kind: "file",
            name: "Pedido explícito.txt",
            mime: "text/plain",
            data: btoa("EXPLICIT_REQUEST_ONLY"),
          },
          "public",
          60000,
        );
        await w.profile.putBundle(bundle);
        return bundle.manifest.id;
      });
      await pair(b, c, "bc");
      await b.evaluate(
        ({ mode, resourceID }) => {
          const w = window as any,
            raw = w.mesh.router.broadcast.bind(w.mesh.router);
          let release: () => void = () => {},
            hit = false;
          const held = new Promise<void>((done) => (release = done));
          w.releasePolicyResponse = release;
          w.policyResponseEntered = false;
          w.policyFailure = "";
          w.mesh.router.broadcast = async (
            payload: any,
            priority: any,
            ttl: any,
            relayOnly: any,
          ) => {
            const target =
              mode === "request"
                ? payload.type === "request" && payload.ids.includes(resourceID)
                : payload.type === "bundle" &&
                  payload.bundle.manifest.id === resourceID;
            if (!hit && relayOnly && target) {
              hit = true;
              w.policyResponseEntered = true;
              await held;
              try {
                if (mode === "unrelated-error")
                  throw new Error("Relay desactivado");
                return await raw(payload, priority, ttl, relayOnly);
              } catch (error) {
                w.policyFailure = (error as Error).message;
                throw error;
              }
            }
            return raw(payload, priority, ttl, relayOnly);
          };
        },
        { mode, resourceID },
      );
      await c.evaluate(
        ({ mode, resourceID }) =>
          (window as any).mesh.router.broadcast({
            type: mode === "request" ? "inventory" : "request",
            ids: [resourceID],
          }),
        { mode, resourceID },
      );
      await expect
        .poll(() => b.evaluate(() => (window as any).policyResponseEntered))
        .toBe(true);
      await b.evaluate(() => (window as any).mesh.setRelay(false));
      await b.evaluate(() => (window as any).releasePolicyResponse());
      await expect
        .poll(() => b.evaluate(() => (window as any).policyFailure))
        .toBe("Relay desactivado");
      await expect
        .poll(() =>
          b.evaluate(() => {
            const v = (window as any).links.bc.peer.link.counters;
            return v.accepted + v.rejected;
          }),
        )
        .toBeGreaterThan(0);
      const observed = await b.evaluate(() => {
        const w = window as any,
          l = w.links.bc.peer.link;
        return {
          error: w.policyFailure,
          closed: l.closed,
          reason: l.closeReason ?? null,
          counters: l.counters,
          relay: w.mesh.router.relay,
        };
      });
      writeFileSync(out + "/control.json", JSON.stringify(observed, null, 2));
      if (mode === "unrelated-error") {
        expect(observed.closed).toBe(true);
        expect(observed.counters.rejected).toBeGreaterThan(0);
        expect(observed.counters.accepted).toBe(0);
        return;
      }
      expect(observed.closed).toBe(false);
      expect(observed.counters.rejected).toBe(0);
      expect(observed.relay).toBe(false);
      const own = await b.evaluate(async (card) => {
        const w = window as any,
          bundle = await w.profile.signContent(
            "message",
            { text: "SOS próprio depois da pausa" },
            [card],
            60000,
          );
        await w.mesh.announce(bundle, "sos");
        return bundle.manifest.id;
      }, ownerC);
      await expect
        .poll(() => c.evaluate(() => (window as any).profile.ids()))
        .toContain(own);
      const text = await c.evaluate(
        async (id) => (await (window as any).profile.view(id)).text,
        own,
      );
      expect(text).toBe("SOS próprio depois da pausa");
      expect(
        await (mode === "request" ? b : c).evaluate(() =>
          (window as any).profile.ids(),
        ),
      ).not.toContain(resourceID);
      expect(
        await b.evaluate(() => (window as any).links.bc.peer.link.closed),
      ).toBe(false);
      expect(
        await c.evaluate(() => (window as any).links.bc.peer.link.closed),
      ).toBe(false);
    } finally {
      for (const p of [b, c])
        if (!p.isClosed())
          await p
            .evaluate(async () => {
              const w = window as any;
              w.releasePolicyResponse?.();
              await w.mesh?.close();
              await w.profile?.close();
            })
            .catch(() => {});
      for (const ctx of contexts) await ctx.close();
    }
  });
