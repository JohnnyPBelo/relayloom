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

for (const mode of ["cancel", "expire", "close"] as const)
  test(`in-flight proposal authorization cannot survive ${mode} while its policy read is retained`, async ({
    page,
  }) => {
    await page.goto(host.url);
    const result = await page.evaluate(
      async ({ mode, payload }) => {
        const r = (window as any).rl,
          owner = await r.BrowserProfile.connect(
            "serve-owner-" + crypto.randomUUID(),
          ),
          visitor = await r.BrowserProfile.connect(
            "serve-visitor-" + crypto.randomUUID(),
          ),
          now = Date.now,
          cancelled: string[] = [];
        let runtime: any,
          release: () => void = () => {};
        try {
          const a = await owner.setup(
              "Owner",
              "guarded policy read passphrase",
            ),
            b = await visitor.setup(
              "Visitor",
              "guarded policy read passphrase",
            );
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
          runtime = new r.BrowserContributionRuntime({
            profile: visitor,
            policy: async () => {},
            copyPolicy: () => [],
            publish: () => {},
            cancel: async (id: string) => {
              cancelled.push(id);
            },
          });
          const request = {
            action: "submit",
            sequence: 1,
            operationId: crypto.randomUUID(),
            snapshotId: source.manifest.id,
            pageId: "entry",
            formId: "form",
            values: { name: "HELD_POLICY_READ", count: 0, open: false },
            publicationScope: [a.id, b.id].sort(),
            ttlMs: 60000,
          };
          const sent = await runtime.command(request);
          if (sent.error) throw Error(sent.error);
          const bundle = await visitor.getBundle(
              sent.operation.transport.bundleId,
            ),
            positive = await runtime.canServe(bundle),
            transact = visitor.transactValues.bind(visitor);
          let entered: () => void = () => {},
            holdNext = true,
            settled = false;
          const reached = new Promise<void>((resolve) => {
              entered = resolve;
            }),
            held = new Promise<void>((resolve) => {
              release = resolve;
            });
          visitor.transactValues = async (...args: any[]) => {
            // Retain an actual completed policy read, after releasing its IndexedDB
            // transaction, so the cancellation can genuinely commit concurrently.
            const value = await transact(...args);
            if (holdNext) {
              holdNext = false;
              entered();
              await held;
            }
            return value;
          };
          const pending = runtime.canServe(bundle).then((value: boolean) => {
            settled = true;
            return value;
          });
          await reached;
          const wasPending = !settled;
          let phase: string | undefined;
          if (mode === "cancel")
            phase = (
              await runtime.command({
                action: "cancel",
                sequence: 1,
                operationId: request.operationId,
              })
            ).operation.phase;
          else if (mode === "expire") Date.now = () => sent.operation.expires;
          else runtime.close();
          const stillPending = !settled;
          release();
          const authorizedAfter = await pending;
          return {
            positive,
            wasPending,
            stillPending,
            authorizedAfter,
            phase,
            packetCancelled: cancelled.includes(bundle.manifest.id),
          };
        } finally {
          Date.now = now;
          release();
          runtime?.close();
          visitor.close();
          owner.close();
        }
      },
      { mode, payload: formPayload() },
    );
    expect(result.positive).toBe(true);
    expect(result.wasPending).toBe(true);
    expect(result.stillPending).toBe(true);
    if (mode === "cancel") {
      expect(result.phase).toBe("cancelled");
      expect(result.packetCancelled).toBe(true);
    }
    expect(result.authorizedAfter).toBe(false);
  });
