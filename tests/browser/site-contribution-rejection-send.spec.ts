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

test("owner refusal crosses real RTC, preserves reception and remains terminal after both browser profiles reopen", async ({
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
    const refusal = await owner.evaluate(async (id) => {
      const f = (window as any).proposalFixture;
      const inbox = await f.app.call("contribution-command", {
        action: "inbox",
      });
      return f.app.call("contribution-command", {
        action: "reject",
        id,
        revision: inbox.management.revision,
        reason: "Não incorporar nesta página.",
      });
    }, sent.operation.certificateId);
    expect(refusal.entry.phase).toBe("rejected");
    await expect
      .poll(() =>
        sender.evaluate(async () => {
          const f = (window as any).proposalFixture,
            q = f.request;
          return (
            await f.app.call("contribution-command", {
              action: "operation",
              sequence: q.sequence,
              operationId: q.operationId,
            })
          ).operation?.phase;
        }),
      )
      .toBe("rejected");
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
    expect(confirmed.operation.rejection.body.reason).toBe(
      "Não incorporar nesta página.",
    );
    expect(confirmed.operation.rejection.body.owner.id).toBe(a.id);
    const ownerProfile = await owner.evaluate(async () => {
      const f = (window as any).proposalFixture,
        name = f.p.name;
      await f.mesh.close();
      f.app.close();
      return name;
    });
    const senderProfile = await sender.evaluate(async () => {
      const f = (window as any).proposalFixture,
        name = f.p.name;
      await f.mesh.close();
      f.app.close();
      return name;
    });
    await start(owner, "Dona", ownerProfile);
    await start(sender, "Visitante", senderProfile);
    const recovered = await sender.evaluate(async (op) => {
      const f = (window as any).proposalFixture;
      return f.app.call("contribution-command", {
        action: "resume",
        sequence: op.sequence,
        operationId: op.operationId,
      });
    }, sent.operation);
    expect(recovered.operation).toEqual(confirmed.operation);
    await link(owner, sender);
    const marker = await owner.evaluate(() =>
      (window as any).proposalFixture.app.call("publish", {
        content: { type: "post", text: "AFTER_REFUSAL_REOPEN" },
        recipients: "public",
      }),
    );
    await expect
      .poll(() =>
        sender.evaluate(() => (window as any).proposalFixture.p.ids()),
      )
      .toContain(marker.id);
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

test("an authenticated rejection for retired or absent local history is ignored without closing the real RTC channel", async ({
  browser,
}) => {
  const contexts = [await browser.newContext(), await browser.newContext()],
    pages = [await contexts[0].newPage(), await contexts[1].newPage()],
    [owner, visitor] = pages;
  try {
    const a = await start(owner, "Old rejection owner"),
      b = await start(visitor, "Visitor without old history");
    await link(owner, visitor);
    const rejectionID = await owner.evaluate(
      async ({ recipient, owner }) => {
        const r = (window as any).rl,
          f = (window as any).proposalFixture,
          now = Date.now(),
          rejection = await f.p.signContributionRejection(
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
              decidedAt: now,
              reason: "A recusa antiga",
              expires: now + 180000,
            },
            owner,
          ),
          bundle = await f.p.sealContributionRejection(rejection, recipient);
        // Lower-level framing models a peer replaying an old authentic rejection; the
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
    ).not.toContain(rejectionID);
    const marker = await owner.evaluate(() =>
      (window as any).proposalFixture.app.call("publish", {
        content: { type: "post", text: "LIVE_AFTER_UNMATCHED_REJECTION" },
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

for (const backend of ["node", "native"] as const)
  for (const direction of ["web-to-native", "native-to-web"] as const)
    test(`private owner refusal ${direction} cross RTC and WebSocket with ${backend} and an intermediary without a reading key`, async ({
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
        const freshInbox = await ownerCall("contribution-command", {
          action: "inbox",
        });
        const decision = await ownerCall("contribution-command", {
          action: "reject",
          id: sent.operation.certificateId,
          revision: freshInbox.management.revision,
          reason: "PRIVATE_REFUSAL_WEB_NATIVE",
        });
        expect(decision.entry.phase).toBe("rejected");
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
          .toBe("rejected");
        const refused = (
          await visitorCall("contribution-command", {
            action: "operation",
            sequence: 1,
            operationId: request.operationId,
          })
        ).operation;
        expect(refused.receipt).toEqual(confirmed.receipt);
        expect(refused.rejection.body.reason).toBe(
          "PRIVATE_REFUSAL_WEB_NATIVE",
        );
        expect(refused.rejection.body.owner.id).toBe(owner.id);
        expect(refused.rejection.body.contributorId).toBe(visitor.id);
        expect(refused.rejection.body.certificateId).toBe(
          sent.operation.certificateId,
        );
        const rejectionObject = (await ownerCall("state")).objects.find(
          (o: any) =>
            o.kind === "site-contribution-rejection" &&
            o.content.rejectionId === refused.rejection.id,
        );
        expect(rejectionObject).toBeTruthy();
        await expect
          .poll(() =>
            relay.evaluate(() => (window as any).proposalFixture.p.ids()),
          )
          .toContain(rejectionObject.id);
        const opaqueDecision = await relay.evaluate(async (id) => {
          const f = (window as any).proposalFixture,
            bundle = await f.p.getBundle(id);
          let denied = false;
          try {
            await f.app.call("view", { id });
          } catch {
            denied = true;
          }
          return {
            denied,
            readers: bundle.manifest.keys.map((k: any) => k.reader).sort(),
            author: bundle.manifest.author.id,
          };
        }, rejectionObject.id);
        expect(opaqueDecision).toEqual({
          denied: true,
          readers: [owner.id, visitor.id].sort(),
          author: owner.id,
        });
        let genericDenied = false;
        try {
          await ownerCall("publish", {
            content: {
              type: "site-contribution-rejection",
              rejection: refused.rejection,
            },
            recipients: [visitor],
          });
        } catch {
          genericDenied = true;
        }
        expect(genericDenied).toBe(true);
        const positive = await ownerCall("publish", {
          content: { type: "post", text: "POSITIVE_AFTER_REFUSAL_GUARD" },
          recipients: "public",
        });
        await expect
          .poll(async () =>
            (await visitorCall("state")).objects.some(
              (o: any) => o.id === positive.id,
            ),
          )
          .toBe(true);
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
