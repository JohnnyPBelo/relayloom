import { test, expect } from "@playwright/test";
import { staticHarness } from "./static-harness";
import { formPayload } from "../fixtures/site-form";
let host: Awaited<ReturnType<typeof staticHarness>>;
test.beforeAll(async () => {
  host = await staticHarness();
});
test.afterAll(async () => {
  await host.close();
});
for (const mode of [
  "cached",
  "cancelled",
  "expired",
  "blocked",
  "lock-receive",
  "wrong-reference",
  "not-copied",
  "same-error-text",
] as const)
  test(`browser receipt admission ${mode} preserves authority and original private queue facts`, async ({
    page,
  }) => {
    await page.goto(host.url);
    const result = await page.evaluate(
      async ({ payload, mode }) => {
        const r = (window as any).rl,
          password = "receipt runtime browser passphrase",
          name = "receipt-runtime-" + crypto.randomUUID(),
          owner = await r.BrowserProfile.connect(
            "receipt-runtime-owner-" + crypto.randomUUID(),
          );
        let visitor = await r.BrowserProfile.connect(name),
          runtime: any,
          release = () => {},
          blocked = false;
        const originalNow = Date.now,
          cancelled: string[] = [],
          published: any[] = [];
        // Catalogues capture the clock function at construction; change the
        // value behind that function, not only Date.now after construction.
        let clockValue: number | undefined;
        Date.now = () => clockValue ?? originalNow();
        const policy = async () => {
          if (blocked) throw Error("fixture owner blocked");
        };
        const makeRuntime = () =>
          new r.BrowserContributionRuntime({
            profile: visitor,
            policy,
            copyPolicy: () => [],
            publish: (b: any) => published.push(b),
            cancel: async (id: string) => {
              cancelled.push(id);
            },
          });
        try {
          const a = await owner.setup("Owner", password),
            b = await visitor.setup("Visitor", password);
          payload.site.pages[0].blocks[0].children![0].form!.contributors = [
            b.id,
          ];
          const source = await owner.signSiteBundle(
            "profile",
            1,
            [],
            payload,
            "public",
            3600000,
          );
          await visitor.putBundle(source);
          const request = {
            action: "submit",
            sequence: 1,
            operationId: crypto.randomUUID(),
            snapshotId: source.manifest.id,
            pageId: "entry",
            formId: "form",
            values: { name: "RUNTIME_RECEIPT_SENTINEL", count: 0, open: false },
            publicationScope: "public",
            ttlMs: 60000,
          };
          runtime = makeRuntime();
          let op: any;
          if (mode === "not-copied") {
            const catalog = new r.BrowserContributionCatalog(visitor),
              { action: _a, ...q } = request,
              prepared = await catalog.prepare(
                q,
                async () => source,
                async () => {},
              ),
              signed = await catalog.sign(prepared, async () => {});
            await catalog.seal(signed, async () => {});
            op = await catalog.queue(signed, async () => {});
          } else {
            const sent = await runtime.command(request);
            if (sent.error) throw Error(sent.error);
            op = sent.operation;
          }
          const intent = {
              contributorId: b.id,
              certificateId:
                mode === "wrong-reference" ? "f".repeat(64) : op.certificateId,
              operationId: op.operationId,
              target: op.target,
              proposalCreated: op.created,
              proposalExpires: op.expires,
              verifiedAt: op.created,
              created: op.created,
              expires: op.created + 3600000,
            },
            receipt = await owner.signContributionReceipt(intent, a),
            bundle = await owner.sealContributionReceipt(receipt, b);
          let refused = false;
          if (mode === "same-error-text")
            runtime.catalog.receiveReceipt = async () => {
              throw Error("Recibo sem operação enviada correspondente");
            };
          if (
            mode === "wrong-reference" ||
            mode === "not-copied" ||
            mode === "same-error-text"
          ) {
            let propagated = false;
            try {
              refused = (await runtime.receiveReceipt(bundle)) === false;
            } catch {
              refused = true;
              propagated = true;
            }
            const actual = (
              await runtime.command({
                action: "operation",
                sequence: 1,
                operationId: op.operationId,
              })
            ).operation;
            return {
              mode,
              refused,
              propagated,
              phase: actual.phase,
              receipt: actual.receipt ?? null,
              privateStage: (await visitor.valueKeys("contribution:")).some(
                (k: string) => k.includes(op.certificateId),
              ),
            };
          }
          if (mode === "lock-receive") {
            const original = visitor.decryptStaging.bind(visitor);
            let entered = () => {},
              once = true;
            const reached = new Promise<void>((resolve) => {
                entered = resolve;
              }),
              held = new Promise<void>((resolve) => {
                release = resolve;
              });
            visitor.decryptStaging = async (...args: any[]) => {
              const decoded = await original(...args);
              if (once && args[0].manifest.kind === "site-contribution") {
                once = false;
                entered();
                await held;
              }
              return decoded;
            };
            const pending = runtime.receiveReceipt(bundle).then(
              () => false,
              () => true,
            );
            await reached;
            visitor.lock();
            release();
            refused = await pending;
            runtime.close();
            visitor.close();
            visitor = await r.BrowserProfile.connect(name);
            await visitor.unlock(password);
            runtime = makeRuntime();
            const before = (
              await runtime.command({
                action: "operation",
                sequence: 1,
                operationId: op.operationId,
              })
            ).operation;
            if (before.phase !== "queued" || before.receipt)
              throw Error("lock committed a receipt");
          }
          if (mode === "cancelled")
            await runtime.command({
              action: "cancel",
              sequence: 1,
              operationId: op.operationId,
            });
          if (mode === "expired") clockValue = op.expires + 1;
          if (mode === "blocked") blocked = true;
          // A previous client or interrupted application can have cached the exact
          // encrypted receipt without yet consuming it into the operation journal.
          await visitor.putBundle(bundle);
          await runtime.tick();
          if (mode === "blocked") {
            const before = (
              await runtime.command({
                action: "operation",
                sequence: 1,
                operationId: op.operationId,
              })
            ).operation;
            if (before.receipt) throw Error("blocked receipt admitted");
            blocked = false;
            runtime.nextRetry = 0;
            await runtime.tick();
          }
          const result = (
            await runtime.command({
              action: "operation",
              sequence: 1,
              operationId: op.operationId,
            })
          ).operation;
          const proofs = await visitor.valueKeys("contribution:"),
            retried = published.length;
          runtime.nextRetry = 0;
          await runtime.tick();
          return {
            mode,
            refused,
            phase: result.phase,
            receiptMatches:
              r.canonical(result.receipt) === r.canonical(receipt),
            expires: result.expires,
            originalExpires: op.expires,
            proofGone: !proofs.some((k: string) =>
              k.includes(op.certificateId),
            ),
            cancelled: cancelled.includes(op.transport.bundleId),
            noRetry: published.length === retried,
          };
        } finally {
          Date.now = originalNow;
          release();
          runtime?.close();
          visitor.close();
          owner.close();
        }
      },
      { payload: formPayload(), mode },
    );
    if (
      mode === "wrong-reference" ||
      mode === "not-copied" ||
      mode === "same-error-text"
    ) {
      expect(result).toEqual({
        mode,
        refused: true,
        propagated: mode === "same-error-text",
        phase: "queued",
        receipt: null,
        privateStage: true,
      });
      return;
    }
    expect(result.refused).toBe(mode === "lock-receive");
    expect(result.phase).toBe(
      mode === "cancelled" || mode === "expired" ? mode : "received",
    );
    for (const k of [
      "receiptMatches",
      "proofGone",
      "cancelled",
      "noRetry",
    ] as const)
      expect(result[k]).toBe(true);
    expect(result.expires).toBe(result.originalExpires);
  });

test("owner receipt retries rotate a bounded batch without re-signing or dropping a pending ninth proposal", async ({
  page,
}) => {
  await page.goto(host.url);
  const result = await page.evaluate(async (payload) => {
    const r = (window as any).rl,
      owner = await r.BrowserProfile.connect(
        "receipt-batch-owner-" + crypto.randomUUID(),
      ),
      visitor = await r.BrowserProfile.connect(
        "receipt-batch-visitor-" + crypto.randomUUID(),
      ),
      sent: any[] = [];
    let runtime: any;
    try {
      const a = await owner.setup("Owner", "receipt batch passphrase"),
        b = await visitor.setup("Visitor", "receipt batch passphrase");
      payload.site.pages[0].blocks[0].children![0].form!.contributors = [b.id];
      const source = await owner.signSiteBundle(
        "profile",
        1,
        [],
        payload,
        "public",
        3600000,
      );
      await owner.putBundle(source);
      const catalog = new r.BrowserContributionCatalog(visitor),
        allow = async () => {};
      runtime = new r.BrowserContributionRuntime({
        profile: owner,
        policy: allow,
        copyPolicy: () => [],
        publish: (bundle: any) => sent.push(bundle),
        cancel: async () => {},
      });
      let signatures = 0;
      const sign = owner.signContributionReceipt.bind(owner);
      owner.signContributionReceipt = async (...args: any[]) => {
        signatures++;
        return sign(...args);
      };
      for (let i = 0; i < 9; i++) {
        const q = {
            sequence: i + 1,
            operationId: crypto.randomUUID(),
            snapshotId: source.manifest.id,
            pageId: "entry",
            formId: "form",
            values: { name: "batch-" + i, count: 0, open: false },
            publicationScope: "public",
            ttlMs: 180000,
          },
          prepared = await catalog.prepare(q, async () => source, allow),
          signed = await catalog.sign(prepared, allow);
        await catalog.seal(signed, allow);
        const queued = await catalog.queue(signed, allow);
        const bundle = await catalog.authorizedBundle(queued, allow);
        await runtime.receive(bundle);
      }
      await runtime.tick();
      const first = { signatures, sent: sent.length };
      runtime.nextRetry = 0;
      await runtime.tick();
      const second = {
        signatures,
        sent: sent.length,
        unique: new Set(sent.map((b) => b.manifest.id)).size,
      };
      return { first, second };
    } finally {
      runtime?.close();
      visitor.close();
      owner.close();
    }
  }, formPayload());
  expect(result).toEqual({
    first: { signatures: 8, sent: 8 },
    second: { signatures: 9, sent: 9, unique: 9 },
  });
});

for (const mode of ["unchanged-retry", "block-and-reallow", "close"] as const)
  test(`owner receipt authority ${mode} handles a retained policy reply without reviving revocation`, async ({
    page,
  }) => {
    await page.goto(host.url);
    const result = await page.evaluate(
      async ({ payload, mode }) => {
        const r = (window as any).rl,
          owner = await r.BrowserProfile.connect(
            "receipt-guard-owner-" + crypto.randomUUID(),
          ),
          visitor = await r.BrowserProfile.connect(
            "receipt-guard-visitor-" + crypto.randomUUID(),
          ),
          sent: any[] = [],
          cancelled: string[] = [];
        let runtime: any,
          release = () => {},
          blocked = false;
        const allow = async () => {};
        try {
          const a = await owner.setup("Owner", "receipt guard passphrase"),
            b = await visitor.setup("Visitor", "receipt guard passphrase");
          payload.site.pages[0].blocks[0].children![0].form!.contributors = [
            b.id,
          ];
          const source = await owner.signSiteBundle(
            "profile",
            1,
            [],
            payload,
            "public",
            3600000,
          );
          await owner.putBundle(source);
          const catalog = new r.BrowserContributionCatalog(visitor),
            q = {
              sequence: 1,
              operationId: crypto.randomUUID(),
              snapshotId: source.manifest.id,
              pageId: "entry",
              formId: "form",
              values: { name: "RECEIPT_GUARD", count: 0, open: false },
              publicationScope: "public",
              ttlMs: 180000,
            },
            prepared = await catalog.prepare(q, async () => source, allow),
            signed = await catalog.sign(prepared, allow);
          await catalog.seal(signed, allow);
          const queued = await catalog.queue(signed, allow),
            proposal = await catalog.authorizedBundle(queued, allow);
          runtime = new r.BrowserContributionRuntime({
            profile: owner,
            policy: async () => {
              if (blocked) throw Error("fixture policy blocked");
            },
            copyPolicy: () => [],
            publish: (bundle: any) => sent.push(bundle),
            cancel: async (id: string) => {
              cancelled.push(id);
            },
          });
          await runtime.receive(proposal);
          await runtime.tick();
          const bundle = sent[0],
            positive = await runtime.canServe(bundle),
            transaction = owner.transactValues.bind(owner);
          let entered = () => {},
            holdNext = true;
          const reached = new Promise<void>((resolve) => {
              entered = resolve;
            }),
            held = new Promise<void>((resolve) => {
              release = resolve;
            });
          owner.transactValues = async (...args: any[]) => {
            const value = await transaction(...args);
            if (holdNext) {
              holdNext = false;
              entered();
              await held;
            }
            return value;
          };
          const pending = runtime.canServe(bundle);
          await reached;
          if (mode === "close") runtime.close();
          else {
            if (mode === "block-and-reallow") {
              blocked = true;
              await runtime.revokeInvalid();
              blocked = false;
            }
            runtime.nextRetry = 0;
            await runtime.tick();
          }
          release();
          const retained = await pending,
            fresh = await runtime.canServe(bundle);
          return {
            positive,
            retained,
            fresh,
            cancelled: cancelled.includes(bundle.manifest.id),
            sameBytes: sent.every(
              (item) => r.canonical(item) === r.canonical(bundle),
            ),
          };
        } finally {
          release();
          runtime?.close();
          owner.close();
          visitor.close();
        }
      },
      { payload: formPayload(), mode },
    );
    expect(result.positive).toBe(true);
    expect(result.retained).toBe(mode === "unchanged-retry");
    expect(result.fresh).toBe(mode !== "close");
    expect(result.cancelled).toBe(mode !== "unchanged-retry");
    expect(result.sameBytes).toBe(true);
  });
