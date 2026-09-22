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

test("available form permissions are checked before uninvited browser proposals reserve private inbox capacity", async ({
  page,
}) => {
  await page.goto(host.url);
  const result = await page.evaluate(async (payload) => {
    const r = (window as any).rl,
      profiles: any[] = [],
      apps: any[] = [];
    const make = async (name: string) => {
      const p = await r.BrowserProfile.connect(
          "inbox-admission-" + crypto.randomUUID(),
        ),
        sent: any[] = [];
      profiles.push(p);
      const app = new r.BrowserApplication(p, {
        publish: (b: any) => sent.push(b),
        command: async () => {},
        state: () => ({ peers: [], counters: {}, error: "" }),
        context: () => {},
      });
      apps.push(app);
      await app.call("setup", {
        name,
        password: "browser inbox admission passphrase",
      });
      return { p, app, sent };
    };
    try {
      const owner = await make("Owner"),
        allowed = await make("Allowed visitor"),
        outsider = await make("Uninvited visitor");
      payload.site.pages[0].blocks[0].children![0].form!.contributors = [
        allowed.p.identity.id,
      ];
      const state = await owner.app.call("site-command", {
        action: "state",
        address: "relayloom:site:" + owner.p.identity.id + "/profile",
      });
      const site = (
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
      await allowed.app.ingest(await owner.p.getBundle(site.bundleId));
      const description = await allowed.app.call("contribution-command", {
        action: "form",
        snapshotId: site.bundleId,
        pageId: "entry",
        formId: "form",
      });
      let cached = 0;
      for (let i = 0; i < 8; i++) {
        const now = Date.now(),
          proposal = await outsider.p.signSiteContribution({
            target: description.target,
            schemaHash: description.schemaHash,
            operationId: crypto.randomUUID(),
            created: now,
            expires: now + 180000,
            values: { name: "NOT_INVITED_" + i, count: 0, open: false },
            publicationScope: "public",
          }),
          bundle = await outsider.p.sealSiteContribution(
            proposal,
            owner.p.identity,
          );
        await owner.app.ingest(bundle);
        if ((await owner.p.ids()).includes(bundle.manifest.id)) cached++;
      }
      const privateKeys = await owner.p.valueKeys("contribution-inbox:"),
        before = await owner.app.call("contribution-command", {
          action: "inbox",
        });
      const request = {
        action: "submit",
        sequence: 1,
        operationId: crypto.randomUUID(),
        snapshotId: site.bundleId,
        pageId: "entry",
        formId: "form",
        values: {
          name: "ALLOWED_AFTER_INVALID_PROPOSALS",
          count: 0,
          open: false,
        },
        publicationScope: "public",
        ttlMs: 180000,
      };
      const queued = await allowed.app.call("contribution-command", request);
      if (queued.error) throw Error(queued.error);
      await owner.app.ingest(
        allowed.sent.find(
          (b: any) => b.manifest.id === queued.operation.transport.bundleId,
        ),
      );
      const after = await owner.app.call("contribution-command", {
        action: "inbox",
      });
      return {
        cached,
        privateKeys,
        before: before.items.length,
        after: after.items.map((i: any) => i.values.name),
      };
    } finally {
      for (const app of apps) app.close();
      for (const p of profiles) p.close();
    }
  }, formPayload());
  expect(result).toEqual({
    cached: 8,
    privateKeys: [],
    before: 0,
    after: ["ALLOWED_AFTER_INVALID_PROPOSALS"],
  });
});

for (const mode of [
  "reopen-conflict",
  "lock-source",
  "corruption-expiry",
] as const)
  test(`browser durable proposal inbox ${mode} preserves original authority and never fabricates approval`, async ({
    page,
  }) => {
    await page.goto(host.url);
    const result = await page.evaluate(
      async ({ payload, mode }) => {
        const r = (window as any).rl,
          password = "durable browser inbox passphrase",
          name = "inbox-owner-" + crypto.randomUUID(),
          visitor = await r.BrowserProfile.connect(
            "inbox-visitor-" + crypto.randomUUID(),
          );
        let owner = await r.BrowserProfile.connect(name),
          now = Date.now(),
          release: () => void = () => {};
        const allow = async () => {};
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
            ),
            catalog = new r.BrowserContributionCatalog(visitor, () => now),
            request = {
              sequence: 1,
              operationId: crypto.randomUUID(),
              snapshotId: source.manifest.id,
              pageId: "entry",
              formId: "form",
              values: {
                name: "PRIVATE_BROWSER_INBOX_SENTINEL_78540",
                count: 0,
                open: false,
              },
              publicationScope: "public",
              ttlMs: 60000,
            },
            prepared = await catalog.prepare(
              request,
              async () => source,
              allow,
            ),
            signed = await catalog.sign(prepared, allow);
          await catalog.seal(signed, allow);
          const envelope = await catalog.authorizedBundle(signed, allow),
            certificate = await catalog.authorizedCertificate(signed, allow);
          let inbox = new r.BrowserContributionInbox(owner, () => now);
          const received = await inbox.admit(envelope, allow),
            hidden = await inbox.read(certificate.id, allow);
          if (hidden.proposal || received.entry.phase !== "missing-source")
            throw Error("unverified values escaped");
          if (mode === "lock-source") {
            let entered: () => void = () => {};
            const reached = new Promise<void>((resolve) => {
                entered = resolve;
              }),
              held = new Promise<void>((resolve) => {
                release = resolve;
              });
            const pending = inbox
              .attachSource(certificate.id, source, async () => {
                entered();
                await held;
              })
              .then(
                () => false,
                () => true,
              );
            await reached;
            owner.lock();
            release();
            const rejected = await pending;
            owner.close();
            owner = await r.BrowserProfile.connect(name);
            await owner.unlock(password);
            inbox = new r.BrowserContributionInbox(owner, () => now);
            const unchanged = (await inbox.state()).entries[0].phase;
            const recovered = await inbox.attachSource(
              certificate.id,
              source,
              allow,
            );
            return { rejected, unchanged, recovered: recovered.phase };
          }
          const verified = await inbox.attachSource(
            certificate.id,
            source,
            allow,
          );
          if (mode === "corruption-expiry") {
            const key = "contribution-inbox:" + certificate.id + ":stage",
              original = await owner.getValue(key);
            await owner.transactValues(async (values: any) => {
              const proof = await values.get(key);
              proof.source.manifest.signature = "A".repeat(88);
              values.set(key, proof);
            });
            let rejected = false;
            try {
              await inbox.read(certificate.id, allow);
            } catch {
              rejected = true;
            }
            await owner.setValue(key, original);
            const restored = await inbox.read(certificate.id, allow);
            now = certificate.body.expires;
            const expired = await inbox.state(),
              removed = await owner.getValue(key);
            const noValues = await inbox.read(certificate.id, allow);
            now += 30 * 86400000;
            return {
              rejected,
              originalRestored:
                JSON.stringify(restored.proposal) ===
                JSON.stringify(certificate),
              expired: expired.entries[0].phase,
              removed,
              noValues: !noValues.proposal,
              retired: (await inbox.state()).entries.length,
            };
          }
          const repacked = await visitor.sealSiteContribution(certificate, a),
            prior = await inbox.state(),
            repeated = await inbox.admit(repacked, allow);
          const {
            domain: _domain,
            contributor: _contributor,
            ...q
          } = certificate.body;
          const other = await visitor.signSiteContribution({
              ...q,
              values: { ...q.values, name: "CONFLICTING_BROWSER_VALUE" },
            }),
            conflicting = await visitor.sealSiteContribution(other, a),
            conflict = await inbox.admit(conflicting, allow);
          owner.close();
          owner = await r.BrowserProfile.connect(name);
          await owner.unlock(password);
          inbox = new r.BrowserContributionInbox(owner, () => now);
          const restored = await inbox.read(certificate.id, allow),
            state = await inbox.state();
          const raw = await new Promise<any[]>((resolve, reject) => {
            const db = indexedDB.open(name);
            db.onsuccess = () => {
              const tx = db.result.transaction("bundles", "readonly"),
                req = tx.objectStore("bundles").getAll();
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
              tx.oncomplete = () => db.result.close();
            };
            db.onerror = () => reject(db.error);
          });
          return {
            verified: verified.phase,
            differentEnvelope: repacked.manifest.id !== envelope.manifest.id,
            repeated: repeated.outcome,
            sameRecord: r.canonical(prior) === r.canonical(repeated.record),
            conflict: conflict.outcome,
            count: state.entries.length,
            conflictIds: restored.entry.conflicts.map((c: any) => c.id),
            expectedConflict: other.id,
            original:
              r.canonical(restored.proposal) === r.canonical(certificate),
            sameSource: r.canonical(restored.source) === r.canonical(source),
            noGlobalSource: (await owner.ids()).length === 0,
            encryptedAtRest: !JSON.stringify(raw).includes(request.values.name),
            metadataOnly: !JSON.stringify(state).includes(request.values.name),
          };
        } finally {
          release();
          owner.close();
          visitor.close();
        }
      },
      { payload: formPayload(), mode },
    );
    if (mode === "lock-source")
      expect(result).toEqual({
        rejected: true,
        unchanged: "missing-source",
        recovered: "verified-candidate",
      });
    else if (mode === "corruption-expiry")
      expect(result).toEqual({
        rejected: true,
        originalRestored: true,
        expired: "expired",
        removed: null,
        noValues: true,
        retired: 0,
      });
    else {
      expect(result.verified).toBe("verified-candidate");
      expect(result.differentEnvelope).toBe(true);
      expect(result.repeated).toBe("duplicate");
      expect(result.sameRecord).toBe(true);
      expect(result.conflict).toBe("conflict");
      expect(result.count).toBe(1);
      expect(result.conflictIds).toEqual([result.expectedConflict]);
      for (const name of [
        "original",
        "sameSource",
        "noGlobalSource",
        "encryptedAtRest",
        "metadataOnly",
      ] as const)
        expect(result[name], name).toBe(true);
    }
  });
