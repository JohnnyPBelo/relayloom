import { createContributionReceiptProtocol } from "../../sites/src/contribution-receipt";
import { createReceiptOperations } from "../../sites/src/contribution-receipt-operations";
import {
  canonical,
  exactShape,
  type Bundle,
  type PublicIdentity,
} from "../../core/src/protocol";
import { browserCertificateCrypto as crypto } from "./certificate-crypto";
import { verifiedStoredBundle } from "./crypto";
import { BrowserProfile, type ProfileValueTransaction } from "./profile";
import {
  createContributionInboxProtocol,
  type ContributionInboxEntry,
  type ContributionInboxRecord,
} from "../../sites/src/contribution-inbox";
import { createContributionEnvelopeProtocol } from "../../sites/src/contribution-envelope";
import { createContributionContextResolver } from "../../sites/src/contribution-context";
import {
  createSiteContributionProtocol,
  SITE_CONTRIBUTION_LIMITS,
  type SiteContribution,
} from "../../sites/src/contribution-protocol";
interface ReceiptStage {
  receipt: unknown;
  envelope: Bundle | null;
}
interface Proof {
  envelope: Bundle;
  source: Bundle | null;
}
type Policy = (
  values: ProfileValueTransaction,
  snapshotId: string,
  authorId: string,
) => Promise<void>;
const registry = createContributionInboxProtocol(crypto),
  envelopes = createContributionEnvelopeProtocol(crypto),
  resolver = createContributionContextResolver(crypto),
  certificates = createSiteContributionProtocol(crypto),
  receiptProtocol = createContributionReceiptProtocol(crypto),
  receiptOperations = createReceiptOperations(crypto);
function insist(ok: unknown, reason: string): asserts ok {
  if (!ok) throw Error(reason);
}
export class ContributionInboxIntegrityError extends Error {}

/** Internal signing-owned IndexedDB evidence; never an approval or receipt. */
export class BrowserContributionInbox {
  private readonly owner: PublicIdentity;
  private readonly generation: number;
  private readonly key: string;
  constructor(
    private readonly profile: BrowserProfile,
    private readonly now: () => number = Date.now,
  ) {
    insist(profile.identity, "Desbloqueia a identidade");
    this.owner = structuredClone(profile.identity);
    this.generation = profile.sessionGeneration;
    this.key =
      "contribution-inbox:" +
      crypto.hash(
        canonical({
          domain: "relayloom/contribution-inbox-key/1",
          owner: this.owner.id,
        }),
      );
  }
  private ensure() {
    insist(
      this.profile.sessionGeneration === this.generation &&
        this.profile.identity?.id === this.owner.id,
      "Sessão de inbox bloqueada",
    );
  }
  private proofKey(id: string) {
    insist(/^[a-f0-9]{64}$/.test(id), "Certificado inválido");
    return "contribution-inbox:" + id + ":stage";
  }
  private describe(proof: Proof) {
    const bytes = canonical(proof);
    return {
      bundleId: proof.envelope.manifest.id,
      envelopeHash: crypto.hash(canonical(proof.envelope)),
      digest: crypto.hash(bytes),
      bytes: new TextEncoder().encode(bytes).length,
    };
  }
  private async certificate(bundle: Bundle) {
    this.ensure();
    const verified = await verifiedStoredBundle(bundle);
    this.ensure();
    const plaintext = await this.profile.decryptStaging(verified);
    this.ensure();
    return envelopes.match(verified, plaintext).proposal;
  }
  private async source(
    proposal: SiteContribution,
    source: Bundle,
    now: number,
  ) {
    const bundle = await verifiedStoredBundle(source);
    this.ensure();
    if (
      bundle.manifest.created - now > SITE_CONTRIBUTION_LIMITS.clockSkewMs ||
      bundle.manifest.expires <= now
    )
      throw Error("Fonte da proposta fora do prazo");
    const plaintext = await this.profile.decryptStaging(bundle);
    this.ensure();
    const b = proposal.body,
      found = resolver.resolve(
        {
          action: "form",
          snapshotId: b.target.snapshotId,
          pageId: b.target.pageId,
          formId: b.target.formId,
        },
        bundle,
        plaintext,
        b.contributor.id,
        now,
      );
    certificates.verifyForSubmission(proposal, found.context, now);
    return found;
  }
  private async readProof(
    values: ProfileValueTransaction,
    entry: ContributionInboxEntry,
  ) {
    try {
      return await this.readProofChecked(values, entry);
    } catch {
      this.ensure();
      throw new ContributionInboxIntegrityError(
        "Prova privada de inbox inválida",
      );
    }
  }
  private async readProofChecked(
    values: ProfileValueTransaction,
    entry: ContributionInboxEntry,
  ) {
    this.ensure();
    insist(entry.proof, "Prova activa em falta");
    const raw = await values.get(this.proofKey(entry.id));
    this.ensure();
    insist(exactShape(raw, ["envelope", "source"]), "Prova privada em falta");
    const proof = raw as Proof;
    insist(
      canonical(this.describe(proof)) === canonical(entry.proof),
      "Prova privada diferente do índice",
    );
    const proposal = registry.checkCertificate(
      entry,
      await this.certificate(proof.envelope),
      this.owner.id,
    );
    this.ensure();
    if (entry.verifiedAt === null)
      insist(proof.source === null, "Fonte não verificada persistida");
    else {
      insist(proof.source !== null, "Fonte histórica em falta");
      await this.source(proposal, proof.source, entry.verifiedAt);
      this.ensure();
    }
    return { proof, proposal };
  }
  private receiptKey(id: string) {
    return "contribution-receipt:" + id + ":stage";
  }
  private describeReceipt(value: ReceiptStage) {
    const text = canonical(value);
    return {
      hash: crypto.hash(text),
      bytes: new TextEncoder().encode(text).length,
    };
  }
  private async readReceipt(
    values: ProfileValueTransaction,
    entry: ContributionInboxEntry,
  ): Promise<ReceiptStage> {
    try {
      const op = entry.receipt;
      insist(op?.stage, "Preparação de recibo em falta");
      const raw = await values.get(this.receiptKey(entry.id));
      this.ensure();
      insist(
        exactShape(raw, ["receipt", "envelope"]),
        "Preparação de recibo inválida",
      );
      const stage = raw as ReceiptStage;
      insist(
        canonical(this.describeReceipt(stage)) === canonical(op.stage),
        "Recibo diferente do índice",
      );
      const receipt = receiptOperations.checkCertificate(
        op,
        this.owner.id,
        entry,
        stage.receipt,
      );
      if (op.phase === "signed")
        insist(stage.envelope === null, "Envelope antes do commit");
      else {
        insist(
          op.phase === "queued" && stage.envelope && op.transport,
          "Envelope de recibo em falta",
        );
        const bundle = await verifiedStoredBundle(stage.envelope);
        this.ensure();
        const plain = await this.profile.decryptStaging(bundle);
        this.ensure();
        const actual = receiptProtocol.matchEnvelope(bundle, plain).receipt;
        insist(
          canonical(actual) === canonical(receipt) &&
            bundle.manifest.id === op.transport.bundleId &&
            crypto.hash(canonical(bundle)) === op.transport.bundleHash,
          "Envelope de recibo substituído",
        );
      }
      return { receipt, envelope: stage.envelope };
    } catch (error) {
      this.ensure();
      if (error instanceof ContributionInboxIntegrityError) throw error;
      throw new ContributionInboxIntegrityError(
        "Preparação privada de recibo inválida",
      );
    }
  }
  private async receiptEntry(
    values: ProfileValueTransaction,
    record: ContributionInboxRecord,
    id: string,
    allow: Policy,
  ) {
    const entry = record.entries.find((e) => e.id === id);
    insist(
      entry?.receipt && entry.receipt.phase !== "expired",
      "Intenção de recibo indisponível",
    );
    await allow(values, entry.target.snapshotId, entry.contributorId);
    this.ensure();
    await allow(values, entry.target.snapshotId, this.owner.id);
    this.ensure();
    insist(entry.receipt.request.expires > this.now(), "Recibo expirado");
    return entry;
  }
  async signReceipt(id: string, allow: Policy) {
    return this.run(async (values, record) => {
      const entry = await this.receiptEntry(values, record, id, allow);
      this.ensure();
      const op = entry.receipt!;
      if (op.phase !== "prepared") {
        await this.readReceipt(values, entry);
        this.ensure();
        return entry;
      }
      const prior = await values.get(this.receiptKey(id));
      this.ensure();
      insist(prior === null, "Assinatura sem intenção de recibo");
      const receipt = await this.profile.signContributionReceipt(
        op.request,
        op.owner,
      );
      this.ensure();
      const stage: ReceiptStage = { receipt, envelope: null },
        next = receiptOperations.signed(
          op,
          this.owner.id,
          entry,
          receipt,
          this.describeReceipt(stage),
          this.now(),
        ),
        result = registry.updateReceipt(record, this.owner.id, id, next);
      values.set(this.receiptKey(id), stage);
      values.set(this.key + ":record", result.record);
      return result.entry;
    });
  }
  async sealReceipt(id: string, allow: Policy) {
    return this.run(async (values, record) => {
      const entry = await this.receiptEntry(values, record, id, allow);
      this.ensure();
      const op = entry.receipt!;
      insist(op.phase !== "prepared", "Assinatura de recibo em falta");
      const stage = await this.readReceipt(values, entry);
      this.ensure();
      if (op.phase === "queued") return entry;
      const bundle = await this.profile.sealContributionReceipt(
        stage.receipt,
        op.recipient,
      );
      this.ensure();
      const sealed = { ...stage, envelope: bundle },
        next = receiptOperations.queued(
          op,
          this.owner.id,
          entry,
          { id: bundle.manifest.id, hash: crypto.hash(canonical(bundle)) },
          this.describeReceipt(sealed),
          this.now(),
        ),
        result = registry.updateReceipt(record, this.owner.id, id, next);
      values.set(this.receiptKey(id), sealed);
      values.set(this.key + ":record", result.record);
      return result.entry;
    });
  }
  async receiptBundle(id: string, allow: Policy) {
    const bundle = await this.run(async (values, record) => {
      const entry = await this.receiptEntry(values, record, id, allow);
      this.ensure();
      if (entry.receipt!.phase !== "queued") return null;
      return (await this.readReceipt(values, entry)).envelope;
    });
    this.ensure();
    if (bundle && bundle.manifest.expires <= this.now())
      throw Error("Recibo expirado durante a consulta");
    return bundle;
  }
  async copyReceipt(id: string, actual: Bundle, allow: Policy) {
    const bundle = await verifiedStoredBundle(
      JSON.parse(canonical(actual)) as Bundle,
    );
    this.ensure();
    return this.run(async (values, record) => {
      const entry = await this.receiptEntry(values, record, id, allow);
      this.ensure();
      const saved = await this.readReceipt(values, entry);
      this.ensure();
      if (canonical(saved.envelope) !== canonical(bundle))
        throw new ContributionInboxIntegrityError("Cópia do recibo diferente");
      const next = receiptOperations.copied(
          entry.receipt,
          this.owner.id,
          entry,
          bundle.manifest.id,
          crypto.hash(canonical(bundle)),
          this.now(),
        ),
        result = registry.updateReceipt(record, this.owner.id, id, next);
      if (result.record.revision !== record.revision)
        values.set(this.key + ":record", result.record);
      return result.entry;
    });
  }
  private async run<T>(
    fn: (
      values: ProfileValueTransaction,
      record: ContributionInboxRecord,
    ) => Promise<T>,
  ): Promise<T> {
    this.ensure();
    // A full inbox can retain 256 receipt stages plus 64 proposal proofs.
    // Keep each cleanup below the profile's unchanged 192-key transaction cap.
    for (let pass = 0; pass < 6; pass++) {
      const result = await this.profile.transactValues(async (values) => {
        this.ensure();
        let saved: unknown;
        try {
          saved = await values.get(this.key + ":record");
        } catch {
          this.ensure();
          throw new ContributionInboxIntegrityError(
            "Índice privado de inbox ilegível",
          );
        }
        this.ensure();
        const keys = values.keys("contribution-inbox:"),
          receiptKeys = values.keys("contribution-receipt:");
        let record: ContributionInboxRecord;
        if (saved === null) {
          if (keys.length !== 0 || receiptKeys.length !== 0)
            throw new ContributionInboxIntegrityError(
              "Inbox ausente com provas existentes",
            );
          record = registry.initial(this.owner.id);
        } else {
          try {
            record = registry.validate(saved, this.owner.id);
          } catch {
            throw new ContributionInboxIntegrityError(
              "Índice privado de inbox inválido",
            );
          }
          const expected = new Set([
            this.key + ":record",
            ...record.entries
              .filter((e) => e.proof !== null)
              .map((e) => this.proofKey(e.id)),
          ]);
          if (
            keys.length !== expected.size ||
            !keys.every((k) => expected.has(k))
          )
            throw new ContributionInboxIntegrityError(
              "Conjunto de provas privadas incompleto",
            );
        }
        const expectedReceipts = new Set(
          record.entries
            .filter((e) => e.receipt?.stage)
            .map((e) => this.receiptKey(e.id)),
        );
        if (
          receiptKeys.length !== expectedReceipts.size ||
          !receiptKeys.every((k) => expectedReceipts.has(k))
        )
          throw new ContributionInboxIntegrityError(
            "Conjunto de recibos incompleto",
          );
        const at = this.now(),
          next = registry.expire(record, this.owner.id, at, 128);
        if (next.revision !== record.revision) {
          for (const entry of record.entries) {
            if (
              entry.receipt?.stage &&
              !next.entries.find((e) => e.id === entry.id)?.receipt?.stage
            ) {
              await this.readReceipt(values, entry);
              this.ensure();
              await values.remove(this.receiptKey(entry.id));
              this.ensure();
            }
            if (
              entry.proof &&
              !next.entries.find((e) => e.id === entry.id)?.proof
            ) {
              await this.readProof(values, entry);
              this.ensure();
              await values.remove(this.proofKey(entry.id));
              this.ensure();
            }
          }
          values.set(this.key + ":record", next);
          record = next;
        }
        if (
          registry.expire(record, this.owner.id, at, 128).revision !==
          record.revision
        )
          return { retry: true as const };
        const result = await fn(values, record);
        this.ensure();
        return { retry: false as const, value: result };
      });
      this.ensure();
      if (!result.retry) return result.value;
    }
    throw Error("Limpeza da inbox em curso; volta a tentar");
  }
  state() {
    return this.run(async (_values, record) => structuredClone(record));
  }
  async checkSource(input: Bundle, inputSource: Bundle) {
    const envelope = JSON.parse(canonical(input)) as Bundle,
      source = JSON.parse(canonical(inputSource)) as Bundle,
      proposal = await this.certificate(envelope);
    this.ensure();
    const resolved = await this.source(proposal, source, this.now());
    this.ensure();
    certificates.verifyForSubmission(proposal, resolved.context, this.now());
  }
  async admit(input: Bundle, allow: Policy) {
    const envelope = JSON.parse(canonical(input)) as Bundle,
      proposal = await this.certificate(envelope),
      proof: Proof = { envelope, source: null };
    this.ensure();
    return this.run(async (values, record) => {
      await allow(
        values,
        proposal.body.target.snapshotId,
        proposal.body.contributor.id,
      );
      this.ensure();
      await allow(values, proposal.body.target.snapshotId, this.owner.id);
      this.ensure();
      const result = registry.observe(
        record,
        this.owner.id,
        proposal,
        this.describe(proof),
        this.now(),
      );
      if (result.outcome === "new") {
        const prior = await values.get(this.proofKey(proposal.id));
        this.ensure();
        insist(prior === null, "Slot de prova já ocupado");
        values.set(this.proofKey(proposal.id), proof);
      } else if (result.entry.proof) {
        await this.readProof(values, result.entry);
        this.ensure();
      }
      if (result.record.revision !== record.revision)
        values.set(this.key + ":record", result.record);
      return result;
    });
  }
  async attachSource(id: string, input: Bundle, allow: Policy) {
    const source = JSON.parse(canonical(input)) as Bundle;
    await verifiedStoredBundle(source);
    this.ensure();
    const result = await this.run(async (values, record) => {
      const entry = record.entries.find((e) => e.id === id);
      insist(entry?.proof, "Candidato ausente ou expirado");
      const original = await this.readProof(values, entry);
      this.ensure();
      const resolved = await this.source(original.proposal, source, this.now());
      this.ensure();
      await allow(values, entry.target.snapshotId, entry.contributorId);
      this.ensure();
      await allow(values, entry.target.snapshotId, this.owner.id);
      this.ensure();
      certificates.verifyForSubmission(
        original.proposal,
        resolved.context,
        this.now(),
      );
      const proof = { envelope: original.proof.envelope, source },
        verified = registry.verified(
          record,
          this.owner.id,
          id,
          this.describe(proof),
          this.now(),
        ),
        result = registry.prepareReceipt(
          verified.record,
          this.owner,
          original.proposal,
        );
      if (result.record.revision !== record.revision) {
        values.set(this.proofKey(id), proof);
        values.set(this.key + ":record", result.record);
      }
      return result.entry;
    });
    if (result.expires <= this.now())
      throw Error("Proposta expirou durante a persistência");
    return result;
  }
  async dismiss(id: string, revision: number) {
    return this.run(async (values, record) => {
      let result = registry.dismiss(
        record,
        this.owner.id,
        id,
        revision,
        this.now(),
      );
      if (result.record.revision !== record.revision) {
        await this.readProof(
          values,
          record.entries.find((e) => e.id === id)!,
        );
        this.ensure();
        result = registry.dismiss(
          record,
          this.owner.id,
          id,
          revision,
          this.now(),
        );
        await values.remove(this.proofKey(id));
        this.ensure();
        values.set(this.key + ":record", result.record);
      }
      return { entry: result.entry, revision: result.record.revision };
    });
  }
  async read(id: string, allow: Policy) {
    const result = await this.run(async (values, record) => {
      const entry = record.entries.find((e) => e.id === id);
      if (!entry) return null;
      await allow(values, entry.target.snapshotId, entry.contributorId);
      this.ensure();
      await allow(values, entry.target.snapshotId, this.owner.id);
      this.ensure();
      if (!entry.proof) return { entry };
      const { proof, proposal } = await this.readProof(values, entry);
      this.ensure();
      if (proof.source === null) return { entry };
      const resolved = await this.source(proposal, proof.source, this.now());
      this.ensure();
      certificates.verifyForSubmission(proposal, resolved.context, this.now());
      if (!entry.receipt) {
        const migrated = registry.prepareReceipt(record, this.owner, proposal);
        values.set(this.key + ":record", migrated.record);
        return { entry: migrated.entry, proposal, source: proof.source };
      }
      return { entry, proposal, source: proof.source };
    });
    if (result?.entry.proof && result.entry.expires <= this.now())
      throw Error("Proposta expirada durante a consulta");
    return result;
  }
}
