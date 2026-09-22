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
  "reopen",
  "rollback",
  "lost-reply",
  "lock",
  "corruption",
  "concurrent-source",
  "concurrent-dismiss",
] as const)
  test(`browser local discard ${mode} preserves atomic private evidence and replay protection`, async ({
    page,
  }) => {
    await page.goto(host.url);
    const result = await page.evaluate(
      async ({ payload, mode }) => {
        const r = (window as any).rl,
          password = "dismissal browser test phrase",
          name = "discard-owner-" + crypto.randomUUID();
        let owner = await r.BrowserProfile.connect(name);
        const visitor = await r.BrowserProfile.connect(
          "discard-visitor-" + crypto.randomUUID(),
        );
        const allow = async () => {};
        let release = () => {},
          now = Date.now();
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
                name: "PRIVATE_DISCARD_BROWSER_58491",
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
            cert = await catalog.authorizedCertificate(signed, allow),
            key = "contribution-inbox:" + cert.id + ":stage";
          let inbox = new r.BrowserContributionInbox(owner, () => now);
          await inbox.admit(envelope, allow);
          if (!["concurrent-source", "concurrent-dismiss"].includes(mode))
            await inbox.attachSource(cert.id, source, allow);
          const before = await inbox.state(),
            revision = before.revision;
          let rejected = false;
          if (mode === "corruption") {
            await owner.transactValues(async (tx: any) => {
              const proof = await tx.get(key);
              proof.envelope.manifest.signature = "A".repeat(88);
              tx.set(key, proof);
            });
            try {
              await inbox.dismiss(cert.id, revision);
            } catch (e) {
              rejected = e instanceof r.ContributionInboxIntegrityError;
            }
            return {
              rejected,
              phase: (await inbox.state()).entries[0].phase,
              proofRemains: (
                await owner.valueKeys("contribution-inbox:")
              ).includes(key),
            };
          }
          if (mode === "rollback" || mode === "lost-reply") {
            const original = owner.transactValues.bind(owner);
            owner.transactValues = async (fn: any) => {
              const value = await original(async (tx: any) => {
                const result = await fn(tx);
                if (mode === "rollback") throw Error("fixture before commit");
                return result;
              });
              if (mode === "lost-reply")
                throw Error("fixture response lost after commit");
              return value;
            };
            try {
              await inbox.dismiss(cert.id, revision);
            } catch {
              rejected = true;
            }
            owner.transactValues = original;
          } else if (mode === "lock") {
            const original = owner.decryptStaging.bind(owner);
            let entered = () => {};
            const held = new Promise<void>((resolve) => {
                release = resolve;
              }),
              reached = new Promise<void>((resolve) => {
                entered = resolve;
              });
            owner.decryptStaging = async (...args: any[]) => {
              entered();
              await held;
              return original(...args);
            };
            const pending = inbox.dismiss(cert.id, revision).then(
              () => false,
              () => true,
            );
            await reached;
            owner.lock();
            release();
            rejected = await pending;
            owner.decryptStaging = original;
          } else if (mode === "concurrent-source") {
            let entered = () => {};
            const held = new Promise<void>((resolve) => {
                release = resolve;
              }),
              reached = new Promise<void>((resolve) => {
                entered = resolve;
              });
            const sourceWork = inbox.attachSource(cert.id, source, async () => {
              entered();
              await held;
            });
            await reached;
            const dismissWork = inbox.dismiss(cert.id, revision).then(
              () => false,
              () => true,
            );
            release();
            await sourceWork;
            rejected = await dismissWork;
          } else if (mode === "concurrent-dismiss") {
            let entered = () => {};
            const held = new Promise<void>((resolve) => {
                release = resolve;
              }),
              reached = new Promise<void>((resolve) => {
                entered = resolve;
              }),
              original = owner.decryptStaging.bind(owner);
            owner.decryptStaging = async (...args: any[]) => {
              entered();
              await held;
              return original(...args);
            };
            const dismissWork = inbox.dismiss(cert.id, revision);
            await reached;
            const sourceWork = inbox.attachSource(cert.id, source, allow).then(
              () => false,
              () => true,
            );
            release();
            await dismissWork;
            rejected = await sourceWork;
            owner.decryptStaging = original;
          } else await inbox.dismiss(cert.id, revision);
          owner.close();
          owner = await r.BrowserProfile.connect(name);
          await owner.unlock(password);
          inbox = new r.BrowserContributionInbox(owner, () => now);
          const restored = await inbox.state(),
            phase = restored.entries[0].phase,
            retainedSource =
              phase === "verified-candidate"
                ? (await inbox.read(cert.id, allow)).source.manifest.id
                : null,
            final = await inbox.dismiss(cert.id, restored.revision);
          const replay = await inbox.admit(envelope, allow),
            repeated = await inbox.dismiss(cert.id, revision);
          let attachRejected = false;
          try {
            await inbox.attachSource(cert.id, source, allow);
          } catch {
            attachRejected = true;
          }
          const after = await inbox.state(),
            keys = await owner.valueKeys("contribution-inbox:"),
            read = await inbox.read(cert.id, allow);
          now = cert.body.expires;
          return {
            rejected,
            phase,
            retainedSource,
            sourceId: source.manifest.id,
            finalPhase: final.entry.phase,
            finalRevision: final.revision,
            repeatedRevision: repeated.revision,
            replay: replay.outcome,
            verifiedAt: after.entries[0].verifiedAt,
            observedAt: after.entries[0].observedAt,
            proofRemoved: !keys.includes(key),
            valuesAbsent: !JSON.stringify(read).includes(request.values.name),
            attachRejected,
            expiryPhase: (await inbox.state()).entries[0].phase,
          };
        } finally {
          release();
          owner.close();
          visitor.close();
        }
      },
      { payload: formPayload(), mode },
    );
    if (mode === "corruption") {
      expect(result).toEqual({
        rejected: true,
        phase: "verified-candidate",
        proofRemains: true,
      });
      return;
    }
    expect(result.rejected).toBe(mode !== "reopen");
    expect(result.phase).toBe(
      ["reopen", "lost-reply", "concurrent-dismiss"].includes(mode)
        ? "dismissed"
        : "verified-candidate",
    );
    if (result.phase === "verified-candidate")
      expect(result.retainedSource).toBe(result.sourceId);
    expect(result.finalPhase).toBe("dismissed");
    expect(result.repeatedRevision).toBe(result.finalRevision);
    expect(result.replay).toBe("duplicate");
    expect(result.verifiedAt).toBe(
      mode === "concurrent-dismiss" ? null : result.observedAt,
    );
    expect(result.proofRemoved).toBe(true);
    expect(result.valuesAbsent).toBe(true);
    expect(result.attachRejected).toBe(true);
    expect(result.expiryPhase).toBe("dismissed");
  });
