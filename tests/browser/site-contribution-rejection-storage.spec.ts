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
  "missing-source",
  "before-commit",
  "lost-reply",
  "lock",
  "expiry-held",
  "blocked",
  "corrupt",
] as const)
  test(`browser private owner refusal ${mode} preserves decision authority and atomic proposal disposal`, async ({
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

          if (mode !== "missing-source")
            await inbox.attachSource(certificate.id, source, allow);
          const reason = "MOTIVO_PRIVADO_94321",
            before = await inbox.state(),
            revision = before.revision;
          const attempt = async (fn: () => Promise<unknown>) => {
            try {
              await fn();
              return false;
            } catch {
              return true;
            }
          };
          if (
            !(await attempt(() =>
              inbox.reject(certificate.id, revision - 1, reason, allow),
            ))
          )
            throw Error("stale review accepted");
          if (mode === "lock" || mode === "expiry-held") {
            let entered: () => void = () => {};
            const reached = new Promise<void>((resolve) => {
                entered = resolve;
              }),
              held = new Promise<void>((resolve) => {
                release = resolve;
              });
            const pending = attempt(() =>
              inbox.reject(certificate.id, revision, reason, async () => {
                entered();
                await held;
              }),
            );
            await reached;
            if (mode === "lock") owner.lock();
            else now = certificate.body.expires;
            release();
            if (!(await pending))
              throw Error("held mutation committed after revocation");
            owner.close();
            owner = await r.BrowserProfile.connect(name);
            await owner.unlock(password);
            now = before.entries[0].observedAt;
            inbox = new r.BrowserContributionInbox(owner, () => now);
            if (r.canonical(await inbox.state()) !== r.canonical(before))
              throw Error("held mutation changed persisted state");
          }
          if (mode === "blocked") {
            if (
              !(await attempt(() =>
                inbox.reject(certificate.id, revision, reason, async () => {
                  throw Error("blocked");
                }),
              ))
            )
              throw Error("block ignored");
            if (r.canonical(await inbox.state()) !== r.canonical(before))
              throw Error("blocked mutation persisted");
          }
          if (mode === "before-commit" || mode === "lost-reply") {
            const transact = owner.transactValues.bind(owner);
            owner.transactValues = async (fn: any) => {
              const result = await transact(async (tx: any) => {
                const out = await fn(tx);
                if (mode === "before-commit")
                  throw Error("injected before commit");
                return out;
              });
              throw Error("injected reply loss after commit");
            };
            const refused = await attempt(() =>
              inbox.reject(certificate.id, revision, reason, allow),
            );
            owner.transactValues = transact;
            if (!refused) throw Error("injection did not run");
            if (
              mode === "before-commit" &&
              r.canonical(await inbox.state()) !== r.canonical(before)
            )
              throw Error("atomic rollback failed");
          }
          const decided = await inbox.reject(
            certificate.id,
            revision,
            reason,
            allow,
          );
          if (
            decided.entry.phase !== "rejected" ||
            decided.entry.proof !== null ||
            decided.entry.rejection.phase !== "prepared"
          )
            throw Error("decision not persisted");
          if (
            r.canonical(decided.entry.receipt ?? null) !==
            r.canonical(before.entries[0].receipt ?? null)
          )
            throw Error("reception intent rewritten");
          if (
            r
              .canonical(decided)
              .includes("PRIVATE_BROWSER_INBOX_SENTINEL_78540")
          )
            throw Error("original private values retained in decision");
          if (
            !(await attempt(() =>
              inbox.reject(certificate.id, decided.revision, "changed", allow),
            ))
          )
            throw Error("reason replaced");
          if ((await inbox.admit(envelope, allow)).outcome !== "duplicate")
            throw Error("proposal replay reopened decision");
          owner.close();
          owner = await r.BrowserProfile.connect(name);
          await owner.unlock(password);
          inbox = new r.BrowserContributionInbox(owner, () => now);
          const refusalSigned = await inbox.signRejection(
            certificate.id,
            allow,
          );
          if (mode === "corrupt") {
            const key = "contribution-rejection:" + certificate.id + ":stage";
            const original = await owner.transactValues(
                async (tx: any) => await tx.get(key),
              ),
              changed = structuredClone(original);
            changed.rejection.body.reason += "forged";
            await owner.transactValues(async (tx: any) => tx.set(key, changed));
            if (
              !(await attempt(() => inbox.sealRejection(certificate.id, allow)))
            )
              throw Error("corrupt signature accepted");
            now = refusalSigned.rejection.request.expires;
            if (!(await attempt(() => inbox.state())))
              throw Error("expiry concealed corruption");
            await owner.transactValues(async (tx: any) =>
              tx.set(key, original),
            );
            now = before.entries[0].observedAt;
          }
          await inbox.sealRejection(certificate.id, allow);
          const bundle = await inbox.rejectionBundle(certificate.id, allow),
            plaintext = await visitor.decryptStaging(bundle);
          if (
            plaintext.rejection.body.reason !== reason ||
            plaintext.rejection.body.certificateId !== certificate.id
          )
            throw Error("wrong private refusal");
          const outsider = await r.createIdentity("Relay without decryption");
          if (!(await attempt(() => r.decryptStoredBundle(bundle, outsider))))
            throw Error("outsider read private reason");
          owner.close();
          owner = await r.BrowserProfile.connect(name);
          await owner.unlock(password);
          inbox = new r.BrowserContributionInbox(owner, () => now);
          await inbox.sealRejection(certificate.id, allow);
          if (
            r.canonical(await inbox.rejectionBundle(certificate.id, allow)) !==
            r.canonical(bundle)
          )
            throw Error("sealed refusal changed on retry");
          const copied = await inbox.copyRejection(
            certificate.id,
            bundle,
            allow,
          );
          if (!copied.rejection.transport.copied) throw Error("copy fact lost");
          now = certificate.body.expires;
          if ((await inbox.state()).entries[0].phase !== "rejected")
            throw Error("expiry erased decision");
          now = refusalSigned.rejection.request.expires;
          const final = await inbox.state(),
            keys = await owner.transactValues(async (tx: any) =>
              tx.keys("contribution-rejection:"),
            );
          if (
            final.entries[0].rejection.phase !== "expired" ||
            final.entries[0].rejection.stage !== null ||
            keys.length
          )
            throw Error("expiry left orphan private data");
          return {
            mode,
            terminal: final.entries[0].phase,
            reason: final.entries[0].rejection.request.reason,
            sourceVerified: final.entries[0].verifiedAt !== null,
            sameEnvelope: true,
            boundedCleanup: true,
          };
        } finally {
          release();
          owner.close();
          visitor.close();
        }
      },
      { payload: formPayload(), mode },
    );
    expect(result).toEqual({
      mode,
      terminal: "rejected",
      reason: "MOTIVO_PRIVADO_94321",
      sourceVerified: mode !== "missing-source",
      sameEnvelope: true,
      boundedCleanup: true,
    });
  });

test("expiry of 129 actual signed refusals stays below the private transaction key cap and survives interruption between cleanup batches", async ({
  page,
}) => {
  await page.goto(host.url);
  const result = await page.evaluate(async () => {
    const r = (window as any).rl,
      password = "bounded rejection expiry passphrase",
      name = "rejection-sweep-" + crypto.randomUUID(),
      owner = await r.BrowserProfile.connect(name),
      visitor = await r.createIdentity("Sweep visitor");
    let now = 1700000000000;
    try {
      const a = await owner.setup("Sweep owner", password),
        registry = r.inboxProtocol,
        ops = r.rejectionOperations;
      let record = registry.initial(a.id);
      const proof = {
          bundleId: "a".repeat(64),
          envelopeHash: "b".repeat(64),
          digest: "c".repeat(64),
          bytes: 100,
        },
        stages: { id: string; value: any }[] = [],
        created = now;
      // Seed genuine signed rejection preparations through test-only journal helpers.
      // No fake crypto/clock service or network pass is inferred from this fixture.
      for (let i = 0; i < 129; i++) {
        const proposal = r.proposalProtocol.create(visitor, {
          target: {
            site: "relayloom:site:" + a.id + "/profile",
            snapshotId: "d".repeat(64),
            revisionId: "e".repeat(64),
            pageId: "entry",
            formId: "form",
          },
          schemaHash: "f".repeat(64),
          operationId: crypto.randomUUID(),
          created,
          expires: created + 60000,
          values: { name: "bulk" },
          publicationScope: "public",
        });
        record = registry.observe(record, a.id, proposal, proof, now).record;
        const prepared = registry.reject(
          record,
          a,
          proposal.id,
          record.revision,
          "No",
          proposal,
          now,
        );
        record = prepared.record;
        const signed = await owner.signContributionRejection(
            prepared.entry.rejection.request,
            a,
          ),
          stage = { rejection: signed, envelope: null },
          text = r.canonical(stage),
          op = ops.signed(
            prepared.entry.rejection,
            a.id,
            prepared.entry,
            signed,
            {
              hash: r.certificateCrypto.hash(text),
              bytes: new TextEncoder().encode(text).length,
            },
            now,
          );
        record = registry.updateRejection(record, a.id, proposal.id, op).record;
        stages.push({ id: proposal.id, value: stage });
      }
      const key =
        "contribution-inbox:" +
        r.certificateCrypto.hash(
          r.canonical({
            domain: "relayloom/contribution-inbox-key/1",
            owner: a.id,
          }),
        ) +
        ":record";
      await owner.transactValues(async (tx: any) => {
        tx.set(key, record);
        for (const s of stages)
          tx.set("contribution-rejection:" + s.id + ":stage", s.value);
      });
      now = created + 30 * 86400000;
      const inbox = new r.BrowserContributionInbox(owner, () => now),
        transact = owner.transactValues.bind(owner),
        counts: number[] = [];
      let once = true;
      owner.transactValues = async (fn: any) => {
        const result = await transact(async (tx: any) => {
          let removes = 0;
          const original = tx.remove.bind(tx);
          tx.remove = async (k: string) => {
            removes++;
            return original(k);
          };
          const result = await fn(tx);
          counts.push(removes);
          return result;
        });
        if (once) {
          once = false;
          throw Error("fixture reply lost after first cleanup batch");
        }
        return result;
      };
      let interrupted = false;
      try {
        await inbox.state();
      } catch {
        interrupted = true;
      }
      const remaining = (await owner.valueKeys("contribution-rejection:"))
        .length;
      const recovered = await inbox.state();
      return {
        interrupted,
        remaining,
        counts,
        entries: recovered.entries.length,
        expired: recovered.entries.filter(
          (e: any) => e.rejection.phase === "expired",
        ).length,
        stages: (await owner.valueKeys("contribution-rejection:")).length,
      };
    } finally {
      owner.close();
    }
  });
  expect(result.interrupted).toBe(true);
  expect(result.remaining).toBe(1);
  expect(result.counts).toEqual([128, 1]);
  expect(result.entries).toBe(129);
  expect(result.expired).toBe(129);
  expect(result.stages).toBe(0);
});
