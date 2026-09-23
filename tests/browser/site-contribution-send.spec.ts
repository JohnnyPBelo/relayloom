import { test, expect, type Page } from "@playwright/test";
import { staticHarness } from "./static-harness";
import { formPayload } from "../fixtures/site-form";
import { launch, password, until } from "../helpers";
import { rmSync } from "node:fs";
let host: Awaited<ReturnType<typeof staticHarness>>;
test.beforeAll(async () => {
  host = await staticHarness();
});

test.afterAll(async () => {
  await host.close();
  expect(host.requests.some((p) => p.startsWith("/api/"))).toBe(false);
});

for (const mode of [
  "recover",
  "cancel-retained-reply",
  "cancel-before-admission",
  "cancel-queued",
] as const)
  test(`browser source held only in a private proposal queue ${mode} with both relays paused`, async ({
    browser,
  }) => {
    const contexts = [await browser.newContext(), await browser.newContext()],
      pages = [await contexts[0].newPage(), await contexts[1].newPage()],
      [owner, sender] = pages;
    try {
      const a = await start(owner, "Source owner"),
        b = await start(sender, "Source holder");
      await link(owner, sender);
      const site = await owner.evaluate(
        async ({ payload, visitor }) => {
          const f = (window as any).proposalFixture;
          payload.site.pages[0].blocks[0].children![0].form!.contributors = [
            visitor.id,
          ];
          const state = await f.app.call("site-command", {
            action: "state",
            address: "relayloom:site:" + f.p.identity.id + "/profile",
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
        .toContain(site.bundleId);
      const original = await sender.evaluate(
        async (id) =>
          (window as any).rl.canonical(
            await (window as any).proposalFixture.p.getBundle(id),
          ),
        site.bundleId,
      );
      for (const page of pages)
        await page.evaluate(() =>
          (window as any).proposalFixture.app.call("settings", {
            relay: false,
          }),
        );
      await owner.evaluate(async (id) => {
        const f = (window as any).proposalFixture;
        await f.p.pin(id, false);
        await f.p.changeQuota(1024);
        await f.p.changeQuota(128 * 1024 * 1024);
      }, site.bundleId);
      expect(
        await owner.evaluate(() => (window as any).proposalFixture.p.ids()),
      ).not.toContain(site.bundleId);
      const sent = await sender.evaluate(
        async ({ source, owner }) => {
          const f = (window as any).proposalFixture,
            q = {
              action: "submit",
              sequence: 1,
              operationId: crypto.randomUUID(),
              snapshotId: source,
              pageId: "entry",
              formId: "form",
              values: {
                name: "PRIVATE_QUEUE_SOURCE_BROWSER",
                count: 0,
                open: false,
              },
              publicationScope: [owner.id, f.p.identity.id].sort(),
              ttlMs: 180000,
            };
          f.request = q;
          return f.app.call("contribution-command", q);
        },
        { source: site.bundleId, owner: a },
      );
      expect(sent.error).toBeUndefined();
      await expect
        .poll(
          async () =>
            (
              await owner.evaluate(() =>
                (window as any).proposalFixture.app.call(
                  "contribution-command",
                  { action: "inbox" },
                ),
              )
            ).items[0]?.status,
        )
        .toBe("missing-source");
      await sender.evaluate(async (id) => {
        const f = (window as any).proposalFixture;
        await f.p.pin(id, false);
        await f.p.changeQuota(1024);
        await f.p.changeQuota(128 * 1024 * 1024);
        const value = await f.app.call("contribution-command", {
          action: "resume",
          sequence: 1,
          operationId: f.request.operationId,
        });
        if (value.error) throw Error(value.error);
      }, sent.operation.transport.bundleId);
      expect(
        await sender.evaluate(() => (window as any).proposalFixture.p.ids()),
      ).not.toContain(site.bundleId);
      if (mode === "cancel-retained-reply")
        await sender.evaluate(() => {
          const f = (window as any).proposalFixture,
            original = f.mesh.profile.getOwnedSource.bind(f.mesh.profile);
          let hold = true;
          f.mesh.profile.getOwnedSource = async (id: string) => {
            const value = await original(id);
            if (hold && value) {
              hold = false;
              f.sourceLookupWaiting = true;
              await new Promise<void>((resolve) => {
                f.releaseSourceLookup = resolve;
              });
            }
            return value;
          };
        });
      if (mode === "cancel-before-admission")
        await sender.evaluate((sourceId) => {
          const f = (window as any).proposalFixture,
            original = f.mesh.router.options.validate;
          let hold = true;
          f.mesh.router.options.validate = async (value: any) => {
            await original(value);
            if (
              hold &&
              value?.type === "bundle" &&
              value.bundle.manifest.id === sourceId
            ) {
              hold = false;
              f.sourceLookupWaiting = true;
              await new Promise<void>((resolve) => {
                f.releaseSourceLookup = resolve;
              });
            }
          };
        }, site.bundleId);
      if (mode === "cancel-queued")
        await sender.evaluate(() =>
          (window as any).proposalFixture.app.call("settings", {
            lowPower: true,
          }),
        );
      const request = await owner.evaluate(
        (id) =>
          (window as any).proposalFixture.app.call("contribution-command", {
            action: "obtain-source",
            id,
          }),
        sent.operation.certificateId,
      );
      expect(request.snapshotId).toBe(site.bundleId);
      expect(request.requested).toBe(true);
      if (mode !== "recover") {
        if (mode === "cancel-queued")
          await expect
            .poll(() =>
              sender.evaluate(() =>
                (window as any).proposalFixture.mesh.router.peers.some(
                  (p: any) => p.queued > 0,
                ),
              ),
            )
            .toBe(true);
        else
          await expect
            .poll(() =>
              sender.evaluate(
                () => (window as any).proposalFixture.sourceLookupWaiting,
              ),
            )
            .toBe(true);
        await sender.evaluate(async () => {
          const f = (window as any).proposalFixture;
          await f.app.call("contribution-command", {
            action: "cancel",
            sequence: 1,
            operationId: f.request.operationId,
          });
          f.releaseSourceLookup?.();
          await f.app.call("settings", { lowPower: false });
        });
        const marker = await sender.evaluate(() =>
          (window as any).proposalFixture.app.call("publish", {
            content: { type: "post", text: "LINK_LIVE_AFTER_SOURCE_CANCEL" },
            recipients: "public",
          }),
        );
        await expect
          .poll(() =>
            owner.evaluate(() => (window as any).proposalFixture.p.ids()),
          )
          .toContain(marker.id);
        expect(
          await owner.evaluate(() => (window as any).proposalFixture.p.ids()),
        ).not.toContain(site.bundleId);
        expect(
          (
            await owner.evaluate(() =>
              (window as any).proposalFixture.app.call("contribution-command", {
                action: "inbox",
              }),
            )
          ).items[0].status,
        ).toBe("missing-source");
      } else {
        await expect
          .poll(
            async () =>
              (
                await owner.evaluate(() =>
                  (window as any).proposalFixture.app.call(
                    "contribution-command",
                    { action: "inbox" },
                  ),
                )
              ).items[0]?.status,
          )
          .toBe("verified-candidate");
        expect(
          await owner.evaluate(
            async (id) =>
              (window as any).rl.canonical(
                await (window as any).proposalFixture.p.getBundle(id),
              ),
            site.bundleId,
          ),
        ).toBe(original);
        expect(
          await sender.evaluate(() => (window as any).proposalFixture.p.ids()),
        ).not.toContain(site.bundleId);
      }
    } finally {
      for (const page of pages)
        if (!page.isClosed())
          await page
            .evaluate(async () => {
              const f = (window as any).proposalFixture;
              if (f) {
                f.releaseSourceLookup?.();
                await f.mesh.close();
                f.app.close();
              }
            })
            .catch(() => {});
      for (const c of contexts) await c.close();
    }
  });
async function start(page: Page, name: string, profileName?: string) {
  await page.goto(host.url);
  return page.evaluate(
    async ({ name, profileName }) => {
      const r = (window as any).rl,
        p = await r.BrowserProfile.connect(
          profileName ?? "proposal-send-" + crypto.randomUUID(),
        );
      if (profileName) await p.unlock("real RTC proposal fixture passphrase");
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
              return mesh.router.broadcast(
                { type: "bundle", bundle },
                "normal",
              );
            })();
          } else
            void mesh.router.broadcast({ type: "bundle", bundle }, "normal");
        },
        command: async (op: string, body: any) => {
          if (op === "relay") return mesh.setRelay(body.value);
          if (op === "low-power") return mesh.setLowPower(body.value);
          if (op === "block") return mesh.setBlocked(body.id, body.value);
          if (op === "request") return mesh.request(body.id);
          if (op === "contribution-source-request")
            return { requested: await mesh.requestSource(body.id) };
          if (op === "cancel-contribution-source")
            return mesh.cancelOwnedSource(body.id, body.operationId);
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
      if (!profileName)
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
        getOwnedSource: (id: string) => app.sourceForTransport(id),
        putBundle: (bundle: any) => app.ingest(bundle),
      };
      mesh = await r.BrowserMesh.start(profile);
      if (profileName) await app.open();
      await mesh.setRelay(true);
      Object.assign(window, { proposalFixture: { app, p, mesh } });
      return p.identity;
    },
    { name, profileName },
  );
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

for (const backend of ["node", "native"] as const)
  for (const direction of ["web-to-native", "native-to-web"] as const)
    test(`private form proposals ${direction} cross RTC and WebSocket with ${backend} and an intermediary without a reading key`, async ({
      browser,
    }) => {
      const native = await launch(undefined, 0, -1, backend),
        contexts = [await browser.newContext(), await browser.newContext()],
        pages = [await contexts[0].newPage(), await contexts[1].newPage()],
        [web, relay] = pages;
      const callWeb = (
        page: Page,
        operation: string,
        body?: unknown,
      ): Promise<any> =>
        page.evaluate(
          ({ operation, body }) =>
            (window as any).proposalFixture.app.call(operation, body),
          { operation, body },
        );
      try {
        const n = await native.call("setup", {
            name: "Native participant",
            password,
          }),
          a = await start(web, "Web participant"),
          r = await start(relay, "Relay without a reading key");
        await native.call("settings", { relay: true });
        await link(web, relay);
        const invitation = await native.call("web-peer", { origin: host.url });
        await relay.evaluate(async (invitation) => {
          const f = (window as any).proposalFixture;
          f.ws = f.mesh.router.connectWebSocket(invitation);
          await f.ws.peer.link.ready();
        }, invitation);
        const topology = await until(
          () => native.call("state"),
          (s) =>
            s.peers.some((p: any) => p.medium === "websocket" && p.connected),
        );
        expect(topology.tcpPort).toBe(-1);
        expect(topology.peers.map((p: any) => p.medium)).toEqual(["websocket"]);
        expect(
          await web.evaluate(() =>
            (window as any).proposalFixture.mesh.router.peers.map(
              (p: any) => p.medium,
            ),
          ),
        ).toEqual(["webrtc"]);
        const owner = direction === "web-to-native" ? n : a,
          visitor = direction === "web-to-native" ? a : n,
          ownerCall = (op: string, body?: unknown) =>
            direction === "web-to-native"
              ? native.call(op, body)
              : callWeb(web, op, body),
          visitorCall = (op: string, body?: unknown) =>
            direction === "web-to-native"
              ? callWeb(web, op, body)
              : native.call(op, body),
          address = "relayloom:site:" + owner.id + "/profile",
          state = await ownerCall("site-command", { action: "state", address }),
          site = (
            await ownerCall("site-command", {
              action: "publish",
              name: "profile",
              sequence: state.nextSequence,
              operationId: crypto.randomUUID(),
              expectedBase: state.base,
              payload: formPayload([visitor.id]),
              recipients: "public",
              ttlMs: 3600000,
            })
          ).operation;
        await expect
          .poll(async () =>
            (await visitorCall("state")).objects.some(
              (o: any) => o.id === site.bundleId,
            ),
          )
          .toBe(true);
        await visitorCall("settings", { relay: false });
        const request = {
            action: "submit",
            sequence: 1,
            operationId: crypto.randomUUID(),
            snapshotId: site.bundleId,
            pageId: "entry",
            formId: "form",
            values: {
              name: "PRIVATE_WEB_NATIVE_PROPOSAL_68421",
              count: 0,
              open: false,
            },
            publicationScope: [owner.id, visitor.id].sort(),
            ttlMs: 180000,
          },
          sent = await visitorCall("contribution-command", request);
        expect(sent.error).toBeUndefined();
        expect(sent.operation.transport.copied).toBe(true);
        await expect
          .poll(
            async () =>
              (
                await ownerCall("contribution-command", { action: "inbox" })
              ).items.find((i: any) => i.id === sent.operation.certificateId)
                ?.values,
          )
          .toEqual(request.values);
        const received = await ownerCall("contribution-command", {
          action: "inbox",
        });
        expect(received.durable).toBe(true);
        expect(received.items[0].contributor.id).toBe(visitor.id);
        expect(received.items[0].publicationScope).toEqual(
          request.publicationScope,
        );
        const opaque = await relay.evaluate(async (id) => {
          const f = (window as any).proposalFixture,
            bundle = await f.p.getBundle(id);
          let refused = false;
          try {
            await f.app.call("view", { id });
          } catch {
            refused = true;
          }
          return {
            refused,
            readers: bundle.manifest.keys.map((k: any) => k.reader),
            author: bundle.manifest.author.id,
            inbox: await f.app.call("contribution-command", {
              action: "inbox",
            }),
          };
        }, sent.operation.transport.bundleId);
        expect(opaque.refused).toBe(true);
        expect(opaque.readers).not.toContain(r.id);
        expect(opaque.author).toBe(visitor.id);
        expect(opaque.inbox.items).toEqual([]);
        await expect
          .poll(
            async () =>
              (
                await visitorCall("contribution-command", {
                  action: "operation",
                  sequence: 1,
                  operationId: request.operationId,
                })
              ).operation?.phase,
          )
          .toBe("received");
        const confirmed = (
          await visitorCall("contribution-command", {
            action: "operation",
            sequence: 1,
            operationId: request.operationId,
          })
        ).operation;
        expect(confirmed.receipt.body.owner.id).toBe(owner.id);
        expect(confirmed.receipt.body.contributorId).toBe(visitor.id);
        expect(confirmed.receipt.body.certificateId).toBe(
          sent.operation.certificateId,
        );
        expect(JSON.stringify(confirmed.receipt)).not.toContain(
          request.values.name,
        );
        const receiptObject = (await ownerCall("state")).objects.find(
          (o: any) =>
            o.kind === "site-contribution-receipt" &&
            o.content.receiptId === confirmed.receipt.id,
        );
        expect(receiptObject).toBeTruthy();
        await expect
          .poll(() =>
            relay.evaluate(() => (window as any).proposalFixture.p.ids()),
          )
          .toContain(receiptObject.id);
        const receiptRelay = await relay.evaluate(async (id) => {
          const f = (window as any).proposalFixture,
            bundle = await f.p.getBundle(id);
          let refused = false;
          try {
            await f.app.call("view", { id });
          } catch {
            refused = true;
          }
          return {
            refused,
            readers: bundle.manifest.keys.map((k: any) => k.reader).sort(),
            author: bundle.manifest.author.id,
          };
        }, receiptObject.id);
        expect(receiptRelay).toEqual({
          refused: true,
          readers: [owner.id, visitor.id].sort(),
          author: owner.id,
        });
        expect(
          (
            await visitorCall("contribution-command", {
              action: "resume",
              sequence: 1,
              operationId: request.operationId,
            })
          ).operation,
        ).toEqual(confirmed);
        if (direction === "web-to-native") {
          const view = await native.call("view", {
            id: sent.operation.transport.bundleId,
          });
          expect(view.route.medium).toBe("websocket");
          expect(view.route.hops).toHaveLength(2);
        }
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
        for (const context of contexts) await context.close();
        await native.stop();
        rmSync(native.dir, { recursive: true, force: true });
      }
    });

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
    await expect
      .poll(
        async () =>
          (
            await sender.evaluate(() => {
              const f = (window as any).proposalFixture,
                q = f.request;
              return f.app.call("contribution-command", {
                action: "operation",
                sequence: q.sequence,
                operationId: q.operationId,
              });
            })
          ).operation?.phase,
      )
      .toBe("received");
    const confirmed = await sender.evaluate(async () => {
      const f = (window as any).proposalFixture,
        q = f.request;
      const before = await f.app.call("contribution-command", {
        action: "operation",
        sequence: q.sequence,
        operationId: q.operationId,
      });
      let cancelRefused = false,
        servingRefused = false;
      try {
        await f.app.call("contribution-command", {
          action: "cancel",
          sequence: q.sequence,
          operationId: q.operationId,
        });
      } catch {
        cancelRefused = true;
      }
      try {
        await f.app.bundleForTransport(before.operation.transport.bundleId);
      } catch {
        servingRefused = true;
      }
      const resumed = await f.app.call("contribution-command", {
        action: "resume",
        sequence: q.sequence,
        operationId: q.operationId,
      });
      return {
        cancelRefused,
        servingRefused,
        operation: before.operation,
        resumed: resumed.operation,
      };
    });
    expect(confirmed.cancelRefused).toBe(true);
    expect(confirmed.servingRefused).toBe(true);
    expect(confirmed.operation.receipt.body.owner.id).toBe(a.id);
    expect(confirmed.operation.receipt.body.certificateId).toBe(
      sent.operation.certificateId,
    );
    expect(confirmed.resumed).toEqual(confirmed.operation);
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

test("browser reception journals the original source before review and survives actual cache eviction with the RTC sender closed", async ({
  browser,
}) => {
  const contexts = [await browser.newContext(), await browser.newContext()],
    pages = [await contexts[0].newPage(), await contexts[1].newPage()],
    [owner, sender] = pages;
  try {
    const a = await start(owner, "Dona com inbox"),
      b = await start(sender, "Visitante offline");
    await link(owner, sender);
    const site = await owner.evaluate(
      async ({ payload, visitor }) => {
        const f = (window as any).proposalFixture;
        payload.site.pages[0].blocks[0].children![0].form!.contributors = [
          visitor.id,
        ];
        const state = await f.app.call("site-command", {
          action: "state",
          address: "relayloom:site:" + f.p.identity.id + "/profile",
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
      .toContain(site.bundleId);
    const sent = await sender.evaluate(
      async ({ id, owner }) => {
        const f = (window as any).proposalFixture;
        return f.app.call("contribution-command", {
          action: "submit",
          sequence: 1,
          operationId: crypto.randomUUID(),
          snapshotId: id,
          pageId: "entry",
          formId: "form",
          values: {
            name: "PRIVATE_INBOX_SURVIVES_BROWSER_EVICTION",
            count: 0,
            open: false,
          },
          publicationScope: [owner.id, f.p.identity.id].sort(),
          ttlMs: 180000,
        });
      },
      { id: site.bundleId, owner: a },
    );
    expect(sent.error).toBeUndefined();
    await expect
      .poll(() => owner.evaluate(() => (window as any).proposalFixture.p.ids()))
      .toContain(sent.operation.transport.bundleId);
    await sender.evaluate(async () => {
      const f = (window as any).proposalFixture;
      await f.mesh.close();
      f.app.close();
    });
    await contexts[1].close();
    expect(sender.isClosed()).toBe(true);
    const profileName = await owner.evaluate(
      async ({ source, proposal }) => {
        const f = (window as any).proposalFixture;
        await f.mesh.close();
        // Close the application/its retries before applying cache pressure.
        // A newly queued owner receipt may now be pinned alongside these copies.
        // Preserve all other pins and vary only the ordinary cache under test.
        const name = f.p.name;
        f.app.close();
        const raw = await (window as any).rl.BrowserProfile.connect(name);
        try {
          await raw.unlock("real RTC proposal fixture passphrase");
          await raw.pin(source, false);
          await raw.pin(proposal, false);
          const records = await raw.records();
          const pinnedBytes = Object.values(records).reduce(
            (n: number, value: any) =>
              n + (value.pinned || value.reserved ? value.size : 0),
            0,
          );
          await raw.changeQuota(Math.max(1024, pinnedBytes));
          const ids = await raw.ids();
          if (ids.includes(source) || ids.includes(proposal))
            throw Error("cache pressure failed to remove both ordinary copies");
          for (const [id, value] of Object.entries(records) as [
            string,
            any,
          ][]) {
            if ((value.pinned || value.reserved) && !ids.includes(id))
              throw Error("unrelated pinned copy was evicted");
          }
        } finally {
          raw.close();
        }
        return name;
      },
      { source: site.bundleId, proposal: sent.operation.transport.bundleId },
    );
    expect(await start(owner, "Dona com inbox", profileName)).toEqual(a);
    const recovered = await owner.evaluate(async (visitor) => {
      const f = (window as any).proposalFixture,
        inbox = await f.app.call("contribution-command", { action: "inbox" }),
        ids = await f.p.ids();
      await f.app.call("action", {
        action: "block",
        target: visitor.id,
        value: true,
      });
      const blocked = await f.app.call("contribution-command", {
        action: "inbox",
      });
      await f.app.call("action", {
        action: "block",
        target: visitor.id,
        value: false,
      });
      const unblocked = await f.app.call("contribution-command", {
        action: "inbox",
      });
      const cached = [];
      for (const id of ids) {
        const bundle = await f.p.getBundle(id);
        cached.push({
          id,
          kind: bundle.manifest.kind,
          author: bundle.manifest.author.id,
        });
      }
      return {
        inbox,
        ids,
        cached,
        blocked,
        unblocked,
        peers: f.mesh.router.peers,
      };
    }, b);
    expect(recovered.ids).not.toContain(site.bundleId);
    expect(recovered.ids).not.toContain(sent.operation.transport.bundleId);
    for (const item of recovered.cached)
      expect(item).toMatchObject({
        kind: "site-contribution-receipt",
        author: a.id,
      });
    expect(recovered.peers).toEqual([]);
    expect(recovered.inbox.durable).toBe(true);
    expect(recovered.inbox.items).toHaveLength(1);
    expect(recovered.inbox.items[0]).toMatchObject({
      id: sent.operation.certificateId,
      bundleId: sent.operation.transport.bundleId,
      status: "verified-candidate",
      contributor: { id: b.id },
      values: {
        name: "PRIVATE_INBOX_SURVIVES_BROWSER_EVICTION",
        count: 0,
        open: false,
      },
    });
    expect(recovered.blocked.items).toEqual([]);
    expect(recovered.unblocked.items).toEqual(recovered.inbox.items);
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
    for (const context of contexts) await context.close();
  }
});

test("an authenticated receipt for retired or absent local history is ignored without closing the real RTC channel", async ({
  browser,
}) => {
  const contexts = [await browser.newContext(), await browser.newContext()],
    pages = [await contexts[0].newPage(), await contexts[1].newPage()],
    [owner, visitor] = pages;
  try {
    const a = await start(owner, "Old receipt owner"),
      b = await start(visitor, "Visitor without old history");
    await link(owner, visitor);
    const receiptID = await owner.evaluate(
      async ({ recipient, owner }) => {
        const r = (window as any).rl,
          f = (window as any).proposalFixture,
          now = Date.now(),
          receipt = await f.p.signContributionReceipt(
            {
              contributorId: recipient.id,
              certificateId: "c".repeat(64),
              operationId: crypto.randomUUID(),
              target: {
                site: "relayloom:site:" + owner.id + "/profile",
                snapshotId: "a".repeat(64),
                revisionId: "b".repeat(64),
                pageId: "entry",
                formId: "form",
              },
              proposalCreated: now,
              proposalExpires: now + 60000,
              verifiedAt: now,
              created: now,
              expires: now + 180000,
            },
            owner,
          ),
          bundle = await f.p.sealContributionReceipt(receipt, recipient);
        // Lower-level framing models a peer replaying an old authentic receipt; the
        // ordinary publisher correctly disallows arbitrary control-message creation.
        const packet = await r.createPacket(
          f.mesh.router.id,
          { type: "bundle", bundle },
          "normal",
          120000,
        );
        await f.link.peer.link.send(packet);
        return bundle.manifest.id;
      },
      { recipient: b, owner: a },
    );
    expect(
      (
        await visitor.evaluate(() =>
          (window as any).proposalFixture.app.call("contribution-command", {
            action: "state",
          }),
        )
      ).operations,
    ).toEqual([]);
    expect(
      await visitor.evaluate(() => (window as any).proposalFixture.p.ids()),
    ).not.toContain(receiptID);
    const marker = await owner.evaluate(() =>
      (window as any).proposalFixture.app.call("publish", {
        content: { type: "post", text: "LIVE_AFTER_UNMATCHED_RECEIPT" },
        recipients: "public",
      }),
    );
    await expect
      .poll(() =>
        visitor.evaluate(() => (window as any).proposalFixture.p.ids()),
      )
      .toContain(marker.id);
    expect(
      await owner.evaluate(
        () =>
          (window as any).proposalFixture.link.peer.connection.connectionState,
      ),
    ).toBe("connected");
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
