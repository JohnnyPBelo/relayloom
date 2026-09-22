import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { staticHarness } from "./static-harness";
import { formPayload } from "../fixtures/site-form";
let host: Awaited<ReturnType<typeof staticHarness>>;
test.beforeAll(async () => {
  host = await staticHarness();
});
test.afterAll(async () => {
  await host.close();
});

test("browser contribution intent and signature commit separately, survive reopening and abort signing on lock without publishing", async ({
  page,
}, info) => {
  await page.goto(host.url);
  const result = await page.evaluate(async (payload: any) => {
    const r = (window as any).rl,
      password = "browser proposal journal passphrase",
      owner = await r.BrowserProfile.connect(
        "journal-owner-" + crypto.randomUUID(),
      );
    let visitor = await r.BrowserProfile.connect(
      "journal-visitor-" + crypto.randomUUID(),
    );
    try {
      const a = await owner.setup("Dona", password),
        b = await visitor.setup("Visitante", password),
        name = visitor.name;
      payload.site.pages[0].blocks[0].children[0].form.contributors = [b.id];
      const source = await owner.signSiteBundle(
        "profile",
        1,
        [],
        payload,
        "public",
        3600000,
      );
      let catalog = new r.BrowserContributionCatalog(visitor),
        calls = 0;
      const wrap = () => {
        const original = visitor.signSiteContribution.bind(visitor);
        visitor.signSiteContribution = async (...args: any[]) => {
          calls++;
          return original(...args);
        };
      };
      wrap();
      const q = {
        sequence: 1,
        operationId: crypto.randomUUID(),
        snapshotId: source.manifest.id,
        pageId: "entry",
        formId: "form",
        values: {
          name: "BROWSER_PRIVATE_PROPOSAL_98482",
          count: 0,
          open: false,
        },
        publicationScope: [a.id, b.id].sort(),
        ttlMs: 60000,
      };
      const allowed = async (values: any, _id: string, author: string) => {
        const blocked = await values.get("fixture-blocked");
        if (blocked === author) throw Error("blocked now");
      };
      const prepared = await catalog.prepare(q, async () => source, allowed),
        noSignatureDuringPrepare = calls === 0;
      const noPublished = () => visitor.ids();
      const emptyStoreAfterPrepare = (await noPublished()).length === 0;
      const privateStage = await visitor.transactValues(async (values: any) =>
        values.get(
          values
            .keys("contribution:")
            .find((k: string) => k.endsWith(":stage")),
        ),
      );
      const noVisitorCertificate = privateStage.certificate === null;
      await visitor.close();
      visitor = await r.BrowserProfile.connect(name);
      await visitor.unlock(password);
      catalog = new r.BrowserContributionCatalog(visitor);
      wrap();
      const repeated = await catalog.prepare(
        q,
        async () => {
          throw Error("source should already be durable");
        },
        allowed,
      );
      const originalSign = visitor.signSiteContribution.bind(visitor);
      let enter: () => void = () => {},
        release: () => void = () => {};
      const reached = new Promise<void>((resolve) => (enter = resolve)),
        held = new Promise<void>((resolve) => (release = resolve));
      visitor.signSiteContribution = async (...args: any[]) => {
        const cert = await originalSign(...args);
        enter();
        await held;
        return cert;
      };
      const pending = catalog.sign(prepared, allowed).then(
        () => false,
        () => true,
      );
      await reached;
      visitor.lock();
      release();
      const lockedSigningRejected = await pending;
      await visitor.unlock(password);
      catalog = new r.BrowserContributionCatalog(visitor);
      visitor.signSiteContribution = originalSign;
      const phaseAfterLock = (await catalog.state()).operations[0].phase;
      const signed = await catalog.sign(prepared, allowed),
        certificate = await catalog.authorizedCertificate(signed, allowed);
      const callsAfterSign = calls;
      await visitor.close();
      visitor = await r.BrowserProfile.connect(name);
      await visitor.unlock(password);
      catalog = new r.BrowserContributionCatalog(visitor);
      const signedAgain = await catalog.sign(prepared, allowed),
        sameCert = await catalog.authorizedCertificate(signedAgain, allowed);
      await visitor.setValue("fixture-blocked", a.id);
      let blocked = false;
      try {
        await catalog.authorizedCertificate(signed, allowed);
      } catch {
        blocked = true;
      }
      await visitor.setValue("fixture-blocked", null);
      const cancelled = await catalog.cancel(signed),
        retained = await catalog.prepare(
          q,
          async () => {
            throw Error("cancelled operation must not sign again");
          },
          allowed,
        );
      let reused = false;
      try {
        await catalog.prepare(
          { ...q, values: { ...q.values, name: "changed" } },
          async () => source,
          allowed,
        );
      } catch {
        reused = true;
      }
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
        noSignatureDuringPrepare,
        noVisitorCertificate,
        emptyStoreAfterPrepare,
        prepared,
        repeated,
        lockedSigningRejected,
        phaseAfterLock,
        signedPhase: signed.phase,
        certificateFixed:
          certificate.body.created === prepared.created &&
          certificate.body.expires === prepared.expires &&
          certificate.body.operationId === q.operationId,
        sameCert: JSON.stringify(sameCert) === JSON.stringify(certificate),
        callsAfterSign,
        blocked,
        cancelled: cancelled.phase,
        retained: retained.phase,
        reused,
        noPublishedAtEnd: (await noPublished()).length === 0,
        noPlaintextAtRest: !JSON.stringify(raw).includes(q.values.name),
      };
    } finally {
      await owner.close();
      await visitor.close();
    }
  }, formPayload());
  const dir = ".cache/contribution-journal-browser";
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    dir + "/" + info.project.name + ".json",
    JSON.stringify(result, null, 2) + "\n",
  );
  for (const key of [
    "noSignatureDuringPrepare",
    "noVisitorCertificate",
    "emptyStoreAfterPrepare",
    "lockedSigningRejected",
    "certificateFixed",
    "sameCert",
    "blocked",
    "reused",
    "noPublishedAtEnd",
    "noPlaintextAtRest",
  ] as const)
    expect(result[key], key).toBe(true);
  expect(result.repeated).toEqual(result.prepared);
  expect(result.phaseAfterLock).toBe("prepared");
  expect(result.signedPhase).toBe("signed");
  expect(result.cancelled).toBe("cancelled");
  expect(result.retained).toBe("cancelled");
  expect(result.callsAfterSign).toBe(2);
});

test("browser catalogue expiry preserves the old result and missing staging is an integrity error", async ({
  page,
}) => {
  await page.goto(host.url);
  const result = await page.evaluate(async (payload: any) => {
    const r = (window as any).rl,
      password = "browser proposal expiry passphrase",
      p = await r.BrowserProfile.connect(
        "journal-expiry-" + crypto.randomUUID(),
      );
    try {
      const owner = await p.setup("Dona visitante", password),
        source = await p.signSiteBundle(
          "profile",
          1,
          [],
          payload,
          "public",
          3600000,
        );
      let now = Date.now();
      const catalog = new r.BrowserContributionCatalog(p, () => now),
        allow = async () => {};
      const q = {
        sequence: 1,
        operationId: crypto.randomUUID(),
        snapshotId: source.manifest.id,
        pageId: "entry",
        formId: "form",
        values: { name: "Expires", count: null, open: false },
        publicationScope: [owner.id],
        ttlMs: 1000,
      };
      const op = await catalog.prepare(q, async () => source, allow);
      await catalog.sign(op, allow);
      now = op.expires;
      const expired = (await catalog.state()).operations[0],
        repeat = await catalog.prepare(
          q,
          async () => {
            throw Error("no fresh source");
          },
          allow,
        ),
        certificate = await catalog.authorizedCertificate(op, allow);
      const next = await catalog.prepare(
        { ...q, sequence: 2, operationId: crypto.randomUUID(), ttlMs: 60000 },
        async () => source,
        allow,
      );
      let savedRecord: any,
        recordKey = "";
      await p.transactValues(async (values: any) => {
        recordKey = values
          .keys("contribution:")
          .find((k: string) => k.endsWith(":record"));
        savedRecord = await values.get(recordKey);
        values.set(recordKey, {
          ...savedRecord,
          operations: savedRecord.operations.slice(1),
        });
      });
      let missingHistoryRejected = false;
      try {
        await catalog.state();
      } catch {
        missingHistoryRejected = true;
      }
      await p.transactValues(async (values: any) =>
        values.set(recordKey, savedRecord),
      );
      await p.transactValues(async (values: any) => {
        await values.remove(
          values
            .keys("contribution:")
            .find((k: string) => k.endsWith(":stage")),
        );
      });
      let corrupt = false;
      try {
        await catalog.state();
      } catch {
        corrupt = true;
      }
      return {
        expired: expired.phase,
        same: repeat.fingerprint === op.fingerprint,
        noCertificate: certificate === null,
        next: next.sequence,
        missingHistoryRejected,
        corrupt,
      };
    } finally {
      await p.close();
    }
  }, formPayload());
  expect(result).toEqual({
    expired: "expired",
    same: true,
    noCertificate: true,
    next: 2,
    missingHistoryRejected: true,
    corrupt: true,
  });
});
