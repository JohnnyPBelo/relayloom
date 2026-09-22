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

test("browser rechecks the fixed deadline after policy before signing, with a one-millisecond positive control", async ({
  page,
}) => {
  await page.goto(host.url);
  const result = await page.evaluate(async (payload: any) => {
    const r = (window as any).rl,
      p = await r.BrowserProfile.connect(
        "journal-policy-clock-" + crypto.randomUUID(),
      ),
      password = "fixed policy boundary passphrase";
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
      let now = Date.now(),
        signatures = 0;
      const original = p.signSiteContribution.bind(p);
      p.signSiteContribution = async (...args: any[]) => {
        signatures++;
        return original(...args);
      };
      const catalog = new r.BrowserContributionCatalog(p, () => now),
        results: any[] = [];
      for (const delta of [-1, 0]) {
        const sequence = (await catalog.state()).nextSequence,
          q = {
            sequence,
            operationId: crypto.randomUUID(),
            snapshotId: source.manifest.id,
            pageId: "entry",
            formId: "form",
            values: { name: "Prazo", count: 0, open: false },
            publicationScope: [owner.id],
            ttlMs: 1000,
          };
        const op = await catalog.prepare(
            q,
            async () => source,
            async () => {},
          ),
          before = signatures;
        let accepted = false;
        try {
          await catalog.sign(op, async () => {
            now = op.expires + delta;
          });
          accepted = true;
        } catch {}
        results.push({ delta, accepted, signatures: signatures - before });
        now = op.expires;
        await catalog.state();
      }
      return results;
    } finally {
      await p.close();
    }
  }, formPayload());
  expect(result).toEqual([
    { delta: -1, accepted: true, signatures: 1 },
    { delta: 0, accepted: false, signatures: 0 },
  ]);
});

test("browser retains one private encrypted envelope across reopen and cancels a late seal when the identity locks", async ({
  page,
}, info) => {
  await page.goto(host.url);
  const result = await page.evaluate(async (payload: any) => {
    const r = (window as any).rl,
      password = "durable browser envelope passphrase",
      author = await r.BrowserProfile.connect(
        "envelope-owner-" + crypto.randomUUID(),
      );
    let visitor = await r.BrowserProfile.connect(
      "envelope-visitor-" + crypto.randomUUID(),
    );
    try {
      const owner = await author.setup("Dona", password),
        reader = await visitor.setup("Visitante", password),
        profileName = visitor.name;
      const source = await author.signSiteBundle(
          "profile",
          1,
          [],
          payload,
          "public",
          3600000,
        ),
        q = {
          sequence: 1,
          operationId: crypto.randomUUID(),
          snapshotId: source.manifest.id,
          pageId: "entry",
          formId: "form",
          values: { name: "PRIVATE_ENVELOPE_BROWSER", count: 0, open: false },
          publicationScope: "public",
          ttlMs: 60000,
        };
      const allow = async () => {};
      let catalog = new r.BrowserContributionCatalog(visitor),
        seals = 0;
      const prepared = await catalog.prepare(q, async () => source, allow),
        signed = await catalog.sign(prepared, allow);
      const before = await catalog.authorizedBundle(signed, allow);
      const original = visitor.sealSiteContribution.bind(visitor);
      let entered: () => void = () => {},
        release: () => void = () => {};
      const reached = new Promise<void>((r) => (entered = r)),
        held = new Promise<void>((r) => (release = r));
      visitor.sealSiteContribution = async (...args: any[]) => {
        seals++;
        const bundle = await original(...args);
        entered();
        await held;
        return bundle;
      };
      const pending = catalog.seal(signed, allow).then(
        () => false,
        () => true,
      );
      await reached;
      visitor.lock();
      release();
      const locked = await pending;
      await visitor.unlock(password);
      catalog = new r.BrowserContributionCatalog(visitor);
      const afterLock = await catalog.authorizedBundle(signed, allow);
      visitor.sealSiteContribution = async (...args: any[]) => {
        seals++;
        return original(...args);
      };
      const sealed = await catalog.seal(signed, allow),
        envelope = await catalog.authorizedBundle(signed, allow),
        content = await author.decrypt(envelope);
      await visitor.close();
      visitor = await r.BrowserProfile.connect(profileName);
      await visitor.unlock(password);
      catalog = new r.BrowserContributionCatalog(visitor);
      let regenerationAttempts = 0;
      visitor.sealSiteContribution = async () => {
        regenerationAttempts++;
        throw Error("Existing envelope must be reused exactly");
      };
      const repeated = await catalog.seal(signed, allow),
        reopened = await catalog.authorizedBundle(signed, allow);
      const result = {
        locked,
        before,
        afterLock,
        seals,
        sealedId: sealed.bundleId,
        repeatedId: repeated.bundleId,
        exact: JSON.stringify(envelope) === JSON.stringify(reopened),
        created: envelope.manifest.created,
        expectedCreated: signed.created,
        expires: envelope.manifest.expires,
        expectedExpires: signed.expires,
        private: envelope.manifest.publicKey === null,
        readers: envelope.manifest.keys.map((k: any) => k.reader).sort(),
        expectedReaders: [owner.id, reader.id].sort(),
        text: content.proposal.body.values.name,
        grant: content.proposal.body.publicationScope,
        publicInventoryEmpty: (await visitor.ids()).length === 0,
      };
      let originalStage: any,
        stageKey = "";
      await visitor.transactValues(async (values: any) => {
        stageKey = values
          .keys("contribution:")
          .find((k: string) => k.endsWith(":stage"));
        originalStage = await values.get(stageKey);
        const bad = structuredClone(originalStage);
        bad.envelope.manifest.signature = "A".repeat(88);
        values.set(stageKey, bad);
      });
      let corruptEnvelopeRejected = false;
      try {
        await catalog.seal(signed, allow);
      } catch {
        corruptEnvelopeRejected = true;
      }
      await visitor.transactValues(async (values: any) =>
        values.set(stageKey, originalStage),
      );
      const afterRepair = await catalog.authorizedBundle(signed, allow);
      await catalog.cancel(signed);
      return {
        corruptEnvelopeRejected,
        regenerationAttempts,
        repairedExact: JSON.stringify(afterRepair) === JSON.stringify(envelope),
        ...result,
        afterCancel: await catalog.authorizedBundle(signed, allow),
      };
    } finally {
      await author.close();
      await visitor.close();
    }
  }, formPayload());
  const directory = ".cache/contribution-envelope-browser";
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    directory + "/" + info.project.name + ".json",
    JSON.stringify(result, null, 2) + "\n",
  );
  expect(result.locked).toBe(true);
  expect(result.corruptEnvelopeRejected).toBe(true);
  expect(result.regenerationAttempts).toBe(0);
  expect(result.repairedExact).toBe(true);
  expect(result.before).toBeNull();
  expect(result.afterLock).toBeNull();
  expect(result.afterCancel).toBeNull();
  expect(result.seals).toBe(2);
  expect(result.sealedId).toBe(result.repeatedId);
  expect(result.exact).toBe(true);
  expect(result.created).toBe(result.expectedCreated);
  expect(result.expires).toBe(result.expectedExpires);
  expect(result.private).toBe(true);
  expect(result.readers).toEqual(result.expectedReaders);
  expect(result.text).toBe("PRIVATE_ENVELOPE_BROWSER");
  expect(result.grant).toBe("public");
  expect(result.publicInventoryEmpty).toBe(true);
});

test("repeating cancellation of an old proposal preserves a different active preparation", async ({
  page,
}) => {
  await page.goto(host.url);
  const result = await page.evaluate(async (payload: any) => {
    const r = (window as any).rl,
      p = await r.BrowserProfile.connect(
        "proposal-cancel-isolation-" + crypto.randomUUID(),
      );
    try {
      await p.setup("Dona", "separate proposal cancellation passphrase");
      const source = await p.signSiteBundle(
          "profile",
          1,
          [],
          payload,
          "public",
          3600000,
        ),
        catalog = new r.BrowserContributionCatalog(p),
        allow = async () => {};
      const q = {
        sequence: 1,
        operationId: crypto.randomUUID(),
        snapshotId: source.manifest.id,
        pageId: "entry",
        formId: "form",
        values: { name: "First", count: 0, open: false },
        publicationScope: "public",
        ttlMs: 60000,
      };
      const first = await catalog.prepare(q, async () => source, allow);
      await catalog.cancel(first);
      const second = await catalog.prepare(
        {
          ...q,
          sequence: 2,
          operationId: crypto.randomUUID(),
          values: { ...q.values, name: "Second" },
        },
        async () => source,
        allow,
      );
      await catalog.cancel(first);
      const signed = await catalog.sign(second, allow);
      return {
        sequence: signed.sequence,
        phase: signed.phase,
        next: (await catalog.state()).nextSequence,
      };
    } finally {
      await p.close();
    }
  }, formPayload());
  expect(result).toEqual({ sequence: 2, phase: "signed", next: 3 });
});

test("browser queued handoff keeps source and envelope private, supports a second intent and preserves packet identity after expiry", async ({
  page,
}) => {
  await page.goto(host.url);
  const result = await page.evaluate(async (payload: any) => {
    const r = (window as any).rl,
      p = await r.BrowserProfile.connect(
        "queued-handoff-" + crypto.randomUUID(),
      ),
      password = "browser queued transport passphrase";
    try {
      const owner = await p.setup("Dona", password),
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
        values: { name: "PRIVATE_QUEUED_HANDOFF", count: 0, open: false },
        publicationScope: [owner.id],
        ttlMs: 60000,
      };
      const signed = await catalog.sign(
        await catalog.prepare(q, async () => source, allow),
        allow,
      );
      await catalog.seal(signed, allow);
      const before = await catalog.authorizedBundle(signed, allow);
      const queued = await catalog.queue(signed, allow),
        second = await catalog.prepare(
          {
            ...q,
            sequence: 2,
            operationId: crypto.randomUUID(),
            ttlMs: 120000,
          },
          async () => source,
          allow,
        );
      const after = await catalog.authorizedBundle(queued, allow),
        proof = await catalog.queuedSource(queued, allow),
        inventoryBefore = await p.ids();
      await p.putBundle(after, true);
      const copy = await catalog.markCopied(
        queued,
        await p.getBundle(after.manifest.id),
      );
      const record = (await catalog.state()).operations[0];
      now = queued.expires;
      const expired = (await catalog.state()).operations[0],
        stillSecond = await catalog.sign(second, allow);
      return {
        phase: queued.phase,
        copiedInitially: queued.transport.copied,
        sameBytes: JSON.stringify(before) === JSON.stringify(after),
        source: proof.manifest.id,
        expectedSource: source.manifest.id,
        privateInventory: inventoryBefore.length,
        copy: copy.transport.copied,
        recordCopy: record.transport.copied,
        expired: expired.phase,
        keptId: expired.transport.bundleId === before.manifest.id,
        second: stillSecond.phase,
      };
    } finally {
      await p.close();
    }
  }, formPayload());
  expect(result).toEqual({
    phase: "queued",
    copiedInitially: false,
    sameBytes: true,
    source: result.expectedSource,
    expectedSource: result.expectedSource,
    privateInventory: 0,
    copy: true,
    recordCopy: true,
    expired: "expired",
    keptId: true,
    second: "signed",
  });
});
