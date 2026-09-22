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
for (const mode of ["block", "withdraw", "lock", "lost-copy"] as const)
  test(`proposal copy rechecks ${mode} and never reports an unavailable envelope as copied`, async ({
    page,
  }) => {
    await page.goto(host.url);
    const result = await page.evaluate(
      async ({ payload, mode }) => {
        const r = (window as any).rl,
          opened: any[] = [];
        const make = async (name: string) => {
          const p = await r.BrowserProfile.connect(
              "contribution-copy-" + crypto.randomUUID(),
            ),
            published: any[] = [];
          const app = new r.BrowserApplication(p, {
            publish: (b: any) => published.push(b),
            command: async () => {},
            state: () => ({ peers: [], counters: {}, error: "" }),
            context: () => {},
          });
          await app.call("setup", {
            name,
            password: "proposal copy guard passphrase",
          });
          const value = { p, app, published };
          opened.push(value);
          return value;
        };
        try {
          const owner = await make("Owner"),
            visitor = await make("Visitor");
          const address = "relayloom:site:" + owner.p.identity.id + "/profile",
            state = await owner.app.call("site-command", {
              action: "state",
              address,
            });
          const op = (
            await owner.app.call("site-command", {
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
          await visitor.app.ingest(await owner.p.getBundle(op.bundleId));
          const request = {
            action: "submit",
            sequence: 1,
            operationId: crypto.randomUUID(),
            snapshotId: op.bundleId,
            pageId: "entry",
            formId: "form",
            values: { name: "GUARDED_COPY", count: 0, open: false },
            publicationScope: "public",
            ttlMs: 60000,
          };
          const original = visitor.p.putBundle.bind(visitor.p);
          let entered: () => void = () => {},
            release: () => void = () => {};
          const reached = new Promise<void>((resolve) => (entered = resolve)),
            held = new Promise<void>((resolve) => (release = resolve));
          visitor.p.putBundle = async (...args: any[]) => {
            if (args[0].manifest.kind === "site-contribution") {
              entered();
              await held;
              if (mode === "lost-copy") return args[0].manifest.id;
            }
            return original(...args);
          };
          const pending = visitor.app
            .call("contribution-command", request)
            .then(
              (value: any) => ({ value }),
              () => ({ rejected: true }),
            );
          await reached;
          if (mode === "block")
            await visitor.p.setValue("mesh-settings", {
              relay: false,
              lowPower: false,
              blocked: [owner.p.identity.id],
            });
          if (mode === "withdraw") {
            const deletion = await owner.app.call("publish", {
              content: { type: "delete", target: op.bundleId },
              recipients: "public",
            });
            await visitor.app.ingest(await owner.p.getBundle(deletion.id));
          }
          if (mode === "lock") await visitor.app.call("lock");
          release();
          const outcome: any = await pending;
          visitor.p.putBundle = original;
          if (mode === "lock")
            await visitor.app.call("unlock", {
              password: "proposal copy guard passphrase",
            });
          const saved = await visitor.app.call("contribution-command", {
            action: "operation",
            sequence: 1,
            operationId: request.operationId,
          });
          const bundleId = saved.operation.transport.bundleId,
            absent = !(await visitor.p.ids()).includes(bundleId);
          const beforeResume = {
            copied: saved.operation.transport.copied,
            published: visitor.published.length,
          };
          let resumed: any;
          if (mode === "block") {
            await visitor.p.setValue("mesh-settings", {
              relay: false,
              lowPower: false,
              blocked: [],
            });
          }
          if (mode !== "withdraw")
            resumed = await visitor.app.call("contribution-command", {
              action: "resume",
              sequence: 1,
              operationId: request.operationId,
            });
          return {
            rejected: !!outcome.rejected,
            error: !!outcome.value?.error,
            absent,
            beforeResume,
            sameId: resumed?.operation.transport.bundleId === bundleId,
            resumed: resumed?.operation.transport.copied ?? false,
          };
        } finally {
          for (const f of opened) f.app.close();
        }
      },
      { payload: formPayload(), mode },
    );
    expect(result.absent).toBe(true);
    expect(result.beforeResume).toEqual({ copied: false, published: 0 });
    expect(result.error || result.rejected).toBe(true);
    if (mode !== "withdraw") {
      expect(result.sameId).toBe(true);
      expect(result.resumed).toBe(true);
    }
  });
