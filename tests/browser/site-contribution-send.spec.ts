import { test, expect, type Page } from "@playwright/test";
import { staticHarness } from "./static-harness";
import { formPayload } from "../fixtures/site-form";
let host: Awaited<ReturnType<typeof staticHarness>>;
test.beforeAll(async () => {
  host = await staticHarness();
});
test.afterAll(async () => {
  await host.close();
  expect(host.requests.some((p) => p.startsWith("/api/"))).toBe(false);
});
async function start(page: Page, name: string) {
  await page.goto(host.url);
  return page.evaluate(async (name) => {
    const r = (window as any).rl,
      p = await r.BrowserProfile.connect(
        "proposal-send-" + crypto.randomUUID(),
      );
    let mesh: any;
    const app = new r.BrowserApplication(p, {
      publish: (bundle: any) => {
        if (!mesh) throw Error("fixture mesh missing");
        const f = (window as any).proposalFixture;
        if (
          f?.holdPublications &&
          bundle.manifest.kind === "site-contribution"
        ) {
          f.publicationWaiting = true;
          f.delayedPublication = (async () => {
            await new Promise<void>(
              (resolve) => (f.releasePublication = resolve),
            );
            return mesh.router.broadcast({ type: "bundle", bundle }, "normal");
          })();
        } else void mesh.router.broadcast({ type: "bundle", bundle }, "normal");
      },
      command: async (op: string, body: any) => {
        if (op === "relay") return mesh.setRelay(body.value);
        if (op === "low-power") return mesh.setLowPower(body.value);
        if (op === "block") return mesh.setBlocked(body.id, body.value);
        if (op === "request") return mesh.request(body.id);
        if (op === "cancel-owned-bundle")
          return mesh.router.cancelLocal(
            (v: any) =>
              v?.type === "bundle" && v.bundle.manifest.id === body.id,
          );
        throw Error("unexpected network command");
      },
      state: () => ({
        peers: mesh?.router.peers ?? [],
        counters: {},
        error: "",
      }),
      context: () => {},
    });
    await app.call("setup", {
      name,
      password: "real RTC proposal fixture passphrase",
    });
    const profile = {
      get name() {
        return p.name;
      },
      get locked() {
        return p.locked;
      },
      get identity() {
        return p.identity;
      },
      getValue: (key: string) => p.getValue(key),
      setValue: (key: string, value: any) => p.setValue(key, value),
      ids: () => p.ids(),
      getBundle: (id: string) => app.bundleForTransport(id),
      putBundle: (bundle: any) => app.ingest(bundle),
    };
    mesh = await r.BrowserMesh.start(profile);
    await mesh.setRelay(true);
    Object.assign(window, { proposalFixture: { app, p, mesh } });
    return p.identity;
  }, name);
}
async function link(a: Page, b: Page) {
  const offer = await a.evaluate(async () => {
    const f = (window as any).proposalFixture;
    f.link = f.mesh.router.newPeer();
    return f.link.peer.offer();
  });
  const answer = await b.evaluate(async (offer) => {
    const f = (window as any).proposalFixture;
    f.link = f.mesh.router.newPeer();
    return f.link.peer.answer(offer);
  }, offer);
  await a.evaluate(
    async (answer) => (window as any).proposalFixture.link.peer.accept(answer),
    answer,
  );
  await expect
    .poll(() =>
      a.evaluate(
        () =>
          (window as any).proposalFixture.link.peer.connection.connectionState,
      ),
    )
    .toBe("connected");
}

test("two autonomous browser accounts send a private form proposal through real RTC while the sender relay is paused", async ({
  browser,
}) => {
  const contexts = [await browser.newContext(), await browser.newContext()],
    pages = await Promise.all(contexts.map((c) => c.newPage()));
  const [owner, sender] = pages;
  try {
    const a = await start(owner, "Dona"),
      b = await start(sender, "Visitante");
    await link(owner, sender);
    const publication = await owner.evaluate(
      async ({ payload, visitor }) => {
        const f = (window as any).proposalFixture;
        payload.site.pages[0].blocks[0].children![0].form!.contributors = [
          visitor.id,
        ];
        const address = "relayloom:site:" + f.p.identity.id + "/profile",
          state = await f.app.call("site-command", {
            action: "state",
            address,
          });
        return (
          await f.app.call("site-command", {
            action: "publish",
            name: "profile",
            sequence: state.nextSequence,
            operationId: crypto.randomUUID(),
            expectedBase: state.base,
            payload,
            recipients: "public",
            ttlMs: 3600000,
          })
        ).operation;
      },
      { payload: formPayload(), visitor: b },
    );
    await expect
      .poll(() =>
        sender.evaluate(() => (window as any).proposalFixture.p.ids()),
      )
      .toContain(publication.bundleId);
    const sent = await sender.evaluate(
      async ({ snapshotId, owner }) => {
        const f = (window as any).proposalFixture;
        await f.app.call("settings", { relay: false });
        const state = await f.app.call("contribution-command", {
          action: "state",
        });
        const request = {
          action: "submit",
          sequence: state.nextSequence,
          operationId: crypto.randomUUID(),
          snapshotId,
          pageId: "entry",
          formId: "form",
          values: { name: "PRIVATE_RTC_PROPOSAL_78210", count: 0, open: false },
          publicationScope: [owner.id, f.p.identity.id].sort(),
          ttlMs: 60000,
        };
        f.request = request;
        return f.app.call("contribution-command", request);
      },
      { snapshotId: publication.bundleId, owner: a },
    );
    expect(sent.error).toBeUndefined();
    expect(sent.operation.phase).toBe("queued");
    expect(sent.operation.transport.copied).toBe(true);
    await expect
      .poll(() =>
        owner.evaluate(async (id) => {
          const inbox = await (window as any).proposalFixture.app.call(
            "contribution-command",
            { action: "inbox" },
          );
          return inbox.items.find((i: any) => i.id === id)?.values;
        }, sent.operation.certificateId),
      )
      .toEqual({ name: "PRIVATE_RTC_PROPOSAL_78210", count: 0, open: false });
    const observed = await owner.evaluate(async () => {
      const f = (window as any).proposalFixture,
        state = await f.app.call("state"),
        inbox = await f.app.call("contribution-command", { action: "inbox" });
      return { state: JSON.stringify(state), proposal: inbox.items[0] };
    });
    expect(observed.state).not.toContain("PRIVATE_RTC_PROPOSAL_78210");
    expect(observed.proposal.contributor.id).toBe(b.id);
    expect(observed.proposal.status).toBe("verified-candidate");
    const cancelled = await sender.evaluate(async () => {
      const f = (window as any).proposalFixture,
        q = f.request;
      const value = await f.app.call("contribution-command", {
        action: "cancel",
        sequence: q.sequence,
        operationId: q.operationId,
      });
      let refused = false;
      try {
        await f.app.bundleForTransport(value.operation.transport.bundleId);
      } catch {
        refused = true;
      }
      return { phase: value.operation.phase, refused };
    });
    expect(cancelled).toEqual({ phase: "cancelled", refused: true });
    const late = await sender.evaluate(async () => {
      const f = (window as any).proposalFixture;
      f.holdPublications = true;
      const state = await f.app.call("contribution-command", {
        action: "state",
      });
      const request = {
        ...f.request,
        sequence: state.nextSequence,
        operationId: crypto.randomUUID(),
        values: { ...f.request.values, name: "CANCEL_BEFORE_LATE_BROADCAST" },
      };
      const result = await f.app.call("contribution-command", request);
      return { request, result };
    });
    await expect
      .poll(() =>
        sender.evaluate(
          () => (window as any).proposalFixture.publicationWaiting,
        ),
      )
      .toBe(true);
    const positive = await sender.evaluate(
      async ({ sequence, operationId }) => {
        const f = (window as any).proposalFixture;
        await f.app.call("contribution-command", {
          action: "cancel",
          sequence,
          operationId,
        });
        f.holdPublications = false;
        f.releasePublication();
        await f.delayedPublication;
        return f.app.call("publish", {
          content: {
            type: "post",
            text: "LIVE_LINK_AFTER_PROPOSAL_CANCELLATION",
          },
          recipients: "public",
        });
      },
      late.request,
    );
    await expect
      .poll(() => owner.evaluate(() => (window as any).proposalFixture.p.ids()))
      .toContain(positive.id);
    expect(
      await owner.evaluate(() => (window as any).proposalFixture.p.ids()),
    ).not.toContain(late.result.operation.transport.bundleId);
  } finally {
    for (const page of pages)
      if (!page.isClosed())
        await page
          .evaluate(async () => {
            const f = (window as any).proposalFixture;
            if (f) {
              await f.mesh.close();
              f.app.close();
            }
          })
          .catch(() => {});
    for (const c of contexts) await c.close();
  }
});
