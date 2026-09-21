import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { staticHarness } from "./static-harness";
import { formPayload, formRowSentinel } from "../fixtures/site-form";
let host: Awaited<ReturnType<typeof staticHarness>>;
test.beforeAll(async () => {
  host = await staticHarness();
});
test.afterAll(async () => {
  await host.close();
  expect(host.requests.some((p) => p.startsWith("/api/"))).toBe(false);
});
test("form inspection uses authenticated browser state and invalidates delayed replies after block, withdrawal, expiry or lock", async ({
  page,
}, info) => {
  await page.goto(host.url);
  const result = await page.evaluate(async (payload: any) => {
    const r = (window as any).rl,
      opened: any[] = [];
    const make = async (name: string) => {
      const profile = await r.BrowserProfile.connect(
          "form-lookup-" + crypto.randomUUID(),
        ),
        sent: any[] = [],
        requests: any[] = [];
      const app = new r.BrowserApplication(profile, {
        publish: (b: any) => sent.push(b),
        command: async (...args: any[]) => requests.push(args),
        state: () => ({ peers: [], counters: {}, error: "" }),
        context: () => {},
      });
      await app.call("setup", {
        name,
        password: "browser context fixture passphrase",
      });
      const peer = { profile, app, sent, requests, owner: profile.identity };
      opened.push(peer);
      return peer;
    };
    const denied = async (fn: () => Promise<any>) => {
      try {
        await fn();
        return false;
      } catch {
        return true;
      }
    };
    try {
      const a = await make("Dona"),
        b = await make("Visitante"),
        c = await make("Outra pessoa");
      await a.app.call("contact", { contact: b.owner });
      const address = "relayloom:site:" + a.owner.id + "/profile";
      const publish = async (
        contributors: any,
        recipients: any = "public",
        ttlMs = 3600000,
      ) => {
        const document = structuredClone(payload);
        document.site.pages[0].blocks[0].children[0].form.contributors =
          contributors;
        const state = await a.app.call("site-command", {
          action: "state",
          address,
        });
        const op = (
          await a.app.call("site-command", {
            action: "publish",
            name: "profile",
            sequence: state.nextSequence,
            operationId: crypto.randomUUID(),
            expectedBase: state.base,
            payload: document,
            recipients,
            ttlMs,
          })
        ).operation;
        const bundle = await a.profile.getBundle(op.bundleId);
        await b.app.ingest(bundle);
        await c.app.ingest(bundle);
        return bundle;
      };
      const restricted = await publish([b.owner.id]);
      const query = (bundle: any) => ({
        action: "form",
        snapshotId: bundle.manifest.id,
        pageId: "entry",
        formId: "form",
      });
      const description = await b.app.call(
        "contribution-command",
        query(restricted),
      );
      const notAllowed = await denied(() =>
        c.app.call("contribution-command", query(restricted)),
      );
      const fakeContext = await denied(() =>
        b.app.call("contribution-command", {
          ...query(restricted),
          context: { contributors: "readers" },
        }),
      );
      const privateSite = await publish(
        "readers",
        [a.owner.id, b.owner.id].sort(),
      );
      const privateView = await b.app.call(
        "contribution-command",
        query(privateSite),
      );
      const noReadKey = await denied(() =>
        c.app.call("contribution-command", query(privateSite)),
      );
      const historical =
        (await b.app.call("contribution-command", query(restricted))).target
          .revisionId === description.target.revisionId;
      const pause = () => {
        const raw = b.profile.decrypt.bind(b.profile);
        let release: () => void = () => {},
          entered: () => void = () => {},
          once = true;
        const reached = new Promise<void>((resolve) => (entered = resolve)),
          held = new Promise<void>((resolve) => (release = resolve));
        b.profile.decrypt = async (bundle: any) => {
          const value = await raw(bundle);
          if (once) {
            once = false;
            entered();
            await held;
          }
          return value;
        };
        return { reached, release, restore: () => (b.profile.decrypt = raw) };
      };
      let signatures = 0;
      const sign = b.profile.signContent.bind(b.profile);
      b.profile.signContent = async (...args: any[]) => {
        signatures++;
        return sign(...args);
      };
      let held = pause();
      const mutable: any = query(restricted),
        pending = b.app.call("contribution-command", mutable);
      await held.reached;
      mutable.action = "submit";
      mutable.snapshotId = privateSite.manifest.id;
      mutable.formId = "changed";
      mutable.context = { contributors: "readers" };
      held.release();
      const captured = await pending;
      held.restore();
      held = pause();
      const blockedResult = denied(() =>
        b.app.call("contribution-command", query(restricted)),
      );
      await held.reached;
      await b.profile.setValue("mesh-settings", {
        relay: false,
        lowPower: false,
        blocked: [a.owner.id],
      });
      held.release();
      const blocked = await blockedResult;
      held.restore();
      await b.profile.setValue("mesh-settings", {
        relay: false,
        lowPower: false,
        blocked: [],
      });
      held = pause();
      const withdrawnResult = denied(() =>
        b.app.call("contribution-command", query(restricted)),
      );
      await held.reached;
      const deletion = await a.app.call("publish", {
        content: { type: "delete", target: restricted.manifest.id },
        recipients: "public",
      });
      await b.app.ingest(await a.profile.getBundle(deletion.id));
      await b.app.call("state");
      held.release();
      const withdrawn = await withdrawnResult;
      held.restore();
      const short = await publish("readers", "public", 1500);
      await b.app.call("contribution-command", query(short));
      held = pause();
      const expiredResult = denied(() =>
        b.app.call("contribution-command", query(short)),
      );
      await held.reached;
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.max(1, short.manifest.expires - Date.now() + 10),
        ),
      );
      held.release();
      const expired = await expiredResult;
      held.restore();
      held = pause();
      const lockedResult = denied(() =>
        b.app.call("contribution-command", query(privateSite)),
      );
      await held.reached;
      await b.app.call("lock");
      held.release();
      const locked = await lockedResult;
      held.restore();
      await b.app.call("unlock", {
        password: "browser context fixture passphrase",
      });
      const recovered = await b.app.call(
        "contribution-command",
        query(privateSite),
      );
      const before = b.requests.length,
        missing = await denied(() =>
          b.app.call("contribution-command", {
            ...query(privateSite),
            snapshotId: "0".repeat(64),
          }),
        );
      return {
        description,
        notAllowed,
        fakeContext,
        noReadKey,
        historical,
        privateReaders: privateView.siteScope,
        expectedReaders: [a.owner.id, b.owner.id].sort(),
        capturedOriginal: captured.target.snapshotId === restricted.manifest.id,
        signatures,
        blocked,
        withdrawn,
        expired,
        locked,
        recoveredSameSchema: recovered.schemaHash === privateView.schemaHash,
        missingWithoutNetwork: missing && b.requests.length === before,
      };
    } finally {
      for (const p of opened) p.app.close();
    }
  }, formPayload());
  const dir = ".cache/contribution-context-browser";
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    dir + "/" + info.project.name + ".json",
    JSON.stringify(result, null, 2) + "\n",
  );
  expect(JSON.stringify(result.description)).not.toContain(formRowSentinel);
  expect(result.privateReaders).toEqual(result.expectedReaders);
  expect(result.signatures).toBe(0);
  for (const field of [
    "notAllowed",
    "fakeContext",
    "noReadKey",
    "historical",
    "capturedOriginal",
    "blocked",
    "withdrawn",
    "expired",
    "locked",
    "recoveredSameSchema",
    "missingWithoutNetwork",
  ] as const)
    expect(result[field], field).toBe(true);
});
