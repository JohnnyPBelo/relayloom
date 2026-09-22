import { createContributionReceiptProtocol } from "./contribution-receipt";
import { createReceiptOperations } from "./contribution-receipt-operations";
import {
  canonical,
  createBundleAt,
  hash,
  verifyStoredBundle,
  decryptStoredBundle,
  type Bundle,
  type Identity,
} from "../../core/src/index";
import { exactShape } from "../../core/src/protocol";
import { nodeCertificateCrypto } from "../../core/src/certificate-crypto";
import {
  RegistryIntegrityError,
  type RegistryTransaction,
} from "../../groups/src/storage";
import { SitePrivateRecords } from "./private-storage";
import {
  createContributionInboxProtocol,
  type ContributionInboxEntry,
  type ContributionInboxRecord,
} from "./contribution-inbox";
import { createContributionEnvelopeProtocol } from "./contribution-envelope";
import { createContributionContextResolver } from "./contribution-context";
import {
  createSiteContributionProtocol,
  SITE_CONTRIBUTION_LIMITS,
  type SiteContribution,
} from "./contribution-protocol";
interface Database {
  transaction<T>(fn: (tx: RegistryTransaction) => T): T;
}
interface ReceiptStage {
  receipt: unknown;
  envelope: Bundle | null;
}
interface Proof {
  envelope: Bundle;
  source: Bundle | null;
}
type Policy = (snapshotId: string, authorId: string) => void;
const registry = createContributionInboxProtocol(nodeCertificateCrypto),
  envelopes = createContributionEnvelopeProtocol(nodeCertificateCrypto),
  resolver = createContributionContextResolver(nodeCertificateCrypto),
  certificates = createSiteContributionProtocol(nodeCertificateCrypto),
  receiptProtocol = createContributionReceiptProtocol(nodeCertificateCrypto),
  receiptOperations = createReceiptOperations(nodeCertificateCrypto);
function integrity(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new RegistryIntegrityError(reason);
}
/** Owner-private evidence. No admission receipt or approval is emitted here. */
export class NodeContributionInbox {
  private readonly key: string;
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
    private readonly now: () => number = Date.now,
  ) {
    this.key =
      "contribution-inbox:" +
      hash(
        canonical({
          domain: "relayloom/contribution-inbox-key/1",
          owner: identity.public.id,
        }),
      );
  }
  private proofKey(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error("Certificado inválido");
    return "contribution-inbox:" + id + ":stage";
  }
  private describe(proof: Proof) {
    const bytes = canonical(proof);
    return {
      bundleId: proof.envelope.manifest.id,
      envelopeHash: hash(canonical(proof.envelope)),
      digest: hash(bytes),
      bytes: Buffer.byteLength(bytes),
    };
  }
  private certificate(bundle: Bundle) {
    verifyStoredBundle(bundle);
    return envelopes.match(bundle, decryptStoredBundle(bundle, this.identity))
      .proposal;
  }
  private source(proposal: SiteContribution, source: Bundle, now: number) {
    verifyStoredBundle(source);
    if (
      source.manifest.created - now > SITE_CONTRIBUTION_LIMITS.clockSkewMs ||
      source.manifest.expires <= now
    )
      throw Error("Fonte da proposta fora do prazo");
    const b = proposal.body,
      found = resolver.resolve(
        {
          action: "form",
          snapshotId: b.target.snapshotId,
          pageId: b.target.pageId,
          formId: b.target.formId,
        },
        source,
        decryptStoredBundle(source, this.identity),
        b.contributor.id,
        now,
      );
    certificates.verifyForSubmission(proposal, found.context, now);
    return found;
  }
  private readProof(values: SitePrivateRecords, entry: ContributionInboxEntry) {
    try {
      integrity(entry.proof, "Prova activa em falta");
      const raw = values.read(this.proofKey(entry.id));
      integrity(
        exactShape(raw, ["envelope", "source"]),
        "Prova privada em falta",
      );
      const proof = raw as Proof;
      integrity(
        canonical(this.describe(proof)) === canonical(entry.proof),
        "Prova privada diferente do índice",
      );
      const proposal = registry.checkCertificate(
        entry,
        this.certificate(proof.envelope),
        this.identity.public.id,
      );
      if (entry.verifiedAt === null)
        integrity(proof.source === null, "Fonte não verificada persistida");
      else {
        integrity(proof.source !== null, "Fonte histórica em falta");
        this.source(proposal, proof.source, entry.verifiedAt);
      }
      return { proof, proposal };
    } catch (error) {
      if (error instanceof RegistryIntegrityError) throw error;
      throw new RegistryIntegrityError("Prova privada de inbox inválida");
    }
  }
  private receiptKey(id: string) {
    return "contribution-receipt:" + id + ":stage";
  }
  private describeReceipt(stage: ReceiptStage) {
    const bytes = canonical(stage);
    return { hash: hash(bytes), bytes: Buffer.byteLength(bytes) };
  }
  private readReceipt(
    values: SitePrivateRecords,
    entry: ContributionInboxEntry,
  ): ReceiptStage {
    try {
      const op = entry.receipt;
      integrity(op?.stage, "Preparação de recibo em falta");
      const raw = values.read(this.receiptKey(entry.id));
      integrity(
        exactShape(raw, ["receipt", "envelope"]),
        "Preparação de recibo inválida",
      );
      const stage = raw as ReceiptStage;
      integrity(
        canonical(this.describeReceipt(stage)) === canonical(op.stage),
        "Recibo diferente do índice",
      );
      const receipt = receiptOperations.checkCertificate(
        op,
        this.identity.public.id,
        entry,
        stage.receipt,
      );
      if (op.phase === "signed")
        integrity(stage.envelope === null, "Envelope antes do commit");
      else {
        integrity(
          op.phase === "queued" && stage.envelope && op.transport,
          "Envelope de recibo em falta",
        );
        verifyStoredBundle(stage.envelope);
        const actual = receiptProtocol.matchEnvelope(
          stage.envelope,
          decryptStoredBundle(stage.envelope, this.identity),
        ).receipt;
        integrity(
          canonical(actual) === canonical(receipt) &&
            stage.envelope.manifest.id === op.transport.bundleId &&
            hash(canonical(stage.envelope)) === op.transport.bundleHash,
          "Envelope de recibo substituído",
        );
      }
      return { receipt, envelope: stage.envelope };
    } catch (error) {
      if (error instanceof RegistryIntegrityError) throw error;
      throw new RegistryIntegrityError("Preparação privada de recibo inválida");
    }
  }
  private receiptEntry(
    record: ContributionInboxRecord,
    id: string,
    allow: Policy,
  ) {
    const entry = record.entries.find((e) => e.id === id);
    if (!entry?.receipt || entry.receipt.phase === "expired")
      throw Error("Intenção de recibo indisponível");
    allow(entry.target.snapshotId, entry.contributorId);
    allow(entry.target.snapshotId, this.identity.public.id);
    if (entry.receipt.request.expires <= this.now())
      throw Error("Recibo expirado");
    return entry;
  }
  signReceipt(id: string, allow: Policy) {
    return this.run((values, record, receipts) => {
      const entry = this.receiptEntry(record, id, allow),
        op = entry.receipt!;
      if (op.phase !== "prepared") {
        this.readReceipt(receipts, entry);
        return entry;
      }
      integrity(
        receipts.read(this.receiptKey(id)) === null,
        "Assinatura sem intenção de recibo",
      );
      const receipt = receiptProtocol.create(
          { ...this.identity, public: op.owner },
          op.request,
        ),
        stage: ReceiptStage = { receipt, envelope: null },
        next = receiptOperations.signed(
          op,
          this.identity.public.id,
          entry,
          receipt,
          this.describeReceipt(stage),
          this.now(),
        ),
        result = registry.updateReceipt(
          record,
          this.identity.public.id,
          id,
          next,
        );
      receipts.write(this.receiptKey(id), stage);
      values.write(this.key + ":record", result.record);
      return result.entry;
    });
  }
  sealReceipt(id: string, allow: Policy) {
    return this.run((values, record, receipts) => {
      const entry = this.receiptEntry(record, id, allow),
        op = entry.receipt!;
      if (op.phase === "prepared") throw Error("Assinatura de recibo em falta");
      const stage = this.readReceipt(receipts, entry);
      if (op.phase === "queued") return entry;
      if (op.owner.boxKey !== this.identity.public.boxKey)
        throw Error("Chave histórica de leitura do dono indisponível");
      const bundle = createBundleAt(
        { ...this.identity, public: op.owner },
        "site-contribution-receipt",
        { type: "site-contribution-receipt", receipt: stage.receipt },
        [op.recipient],
        op.request.expires - op.request.created,
        op.request.created,
      );
      receiptProtocol.matchEnvelope(
        bundle,
        decryptStoredBundle(bundle, this.identity),
      );
      const sealed = { ...stage, envelope: bundle },
        next = receiptOperations.queued(
          op,
          this.identity.public.id,
          entry,
          { id: bundle.manifest.id, hash: hash(canonical(bundle)) },
          this.describeReceipt(sealed),
          this.now(),
        ),
        result = registry.updateReceipt(
          record,
          this.identity.public.id,
          id,
          next,
        );
      receipts.write(this.receiptKey(id), sealed);
      values.write(this.key + ":record", result.record);
      return result.entry;
    });
  }
  receiptBundle(id: string, allow: Policy) {
    return this.run((_values, record, receipts) => {
      const entry = this.receiptEntry(record, id, allow);
      if (entry.receipt!.phase !== "queued") return null;
      return this.readReceipt(receipts, entry).envelope;
    });
  }
  copyReceipt(id: string, actual: Bundle, allow: Policy) {
    const bundle = JSON.parse(canonical(actual)) as Bundle;
    verifyStoredBundle(bundle);
    return this.run((values, record, receipts) => {
      const entry = this.receiptEntry(record, id, allow),
        saved = this.readReceipt(receipts, entry);
      integrity(
        canonical(saved.envelope) === canonical(bundle),
        "Cópia do recibo diferente",
      );
      const next = receiptOperations.copied(
          entry.receipt,
          this.identity.public.id,
          entry,
          bundle.manifest.id,
          hash(canonical(bundle)),
          this.now(),
        ),
        result = registry.updateReceipt(
          record,
          this.identity.public.id,
          id,
          next,
        );
      if (result.record.revision !== record.revision)
        values.write(this.key + ":record", result.record);
      return result.entry;
    });
  }
  private run<T>(
    fn: (
      values: SitePrivateRecords,
      record: ContributionInboxRecord,
      receipts: SitePrivateRecords,
    ) => T,
  ): T {
    return this.database.transaction((tx) =>
      SitePrivateRecords.runContributionInbox(tx, this.identity, (values) =>
        SitePrivateRecords.runContributionReceipt(
          tx,
          this.identity,
          (receipts) => {
            const saved = values.read(this.key + ":record"),
              keys = tx.keys("contribution-inbox:"),
              receiptKeys = tx.keys("contribution-receipt:");
            let record: ContributionInboxRecord;
            if (saved === null) {
              integrity(
                keys.length === 0 && receiptKeys.length === 0,
                "Inbox ausente com provas existentes",
              );
              record = registry.initial(this.identity.public.id);
            } else {
              try {
                record = registry.validate(saved, this.identity.public.id);
              } catch {
                throw new RegistryIntegrityError(
                  "Índice privado de inbox inválido",
                );
              }
              const expected = new Set([
                this.key + ":record",
                ...record.entries
                  .filter((e) => e.proof !== null)
                  .map((e) => this.proofKey(e.id)),
              ]);
              for (const key of expected)
                integrity(tx.get(key), "Índice de prova ausente");
              for (const key of keys)
                integrity(
                  expected.has(key.replace(/:[0-9]{2}$/, "")),
                  "Prova privada órfã",
                );
            }
            const expectedReceipts = new Set(
              record.entries
                .filter((e) => e.receipt?.stage)
                .map((e) => this.receiptKey(e.id)),
            );
            for (const key of expectedReceipts)
              integrity(tx.get(key), "Preparação de recibo ausente");
            for (const key of receiptKeys)
              integrity(
                expectedReceipts.has(key.replace(/:[0-9]{2}$/, "")),
                "Preparação de recibo órfã",
              );
            const next = registry.expire(
              record,
              this.identity.public.id,
              this.now(),
            );
            if (next.revision !== record.revision) {
              for (const entry of record.entries) {
                if (
                  entry.receipt?.stage &&
                  !next.entries.find((e) => e.id === entry.id)?.receipt?.stage
                ) {
                  this.readReceipt(receipts, entry);
                  receipts.remove(this.receiptKey(entry.id));
                }
                if (
                  entry.proof &&
                  !next.entries.find((e) => e.id === entry.id)?.proof
                ) {
                  this.readProof(values, entry);
                  values.remove(this.proofKey(entry.id));
                }
              }
              values.write(this.key + ":record", next);
              record = next;
            }
            return fn(values, record, receipts);
          },
        ),
      ),
    );
  }
  state() {
    return this.run((_v, record) => structuredClone(record));
  }
  /** A cache-backed source can be checked before reserving unverified inbox
   * capacity. This is a current observation, never a reusable permission token. */
  checkSource(envelope: Bundle, source: Bundle) {
    this.source(this.certificate(envelope), source, this.now());
  }
  admit(input: Bundle, allow: Policy) {
    const envelope = JSON.parse(canonical(input)) as Bundle,
      proposal = this.certificate(envelope),
      proof: Proof = { envelope, source: null };
    return this.run((values, record) => {
      allow(proposal.body.target.snapshotId, proposal.body.contributor.id);
      allow(proposal.body.target.snapshotId, this.identity.public.id);
      const result = registry.observe(
        record,
        this.identity.public.id,
        proposal,
        this.describe(proof),
        this.now(),
      );
      if (result.outcome === "new") {
        integrity(
          values.read(this.proofKey(proposal.id)) === null,
          "Slot de prova já ocupado",
        );
        values.write(this.proofKey(proposal.id), proof);
      } else if (result.entry.proof) this.readProof(values, result.entry);
      if (result.record.revision !== record.revision)
        values.write(this.key + ":record", result.record);
      return result;
    });
  }
  attachSource(id: string, input: Bundle, allow: Policy) {
    const source = JSON.parse(canonical(input)) as Bundle;
    verifyStoredBundle(source);
    return this.run((values, record) => {
      const entry = record.entries.find((e) => e.id === id);
      if (!entry?.proof) throw Error("Candidato ausente ou expirado");
      const original = this.readProof(values, entry);
      this.source(original.proposal, source, this.now());
      allow(entry.target.snapshotId, entry.contributorId);
      allow(entry.target.snapshotId, this.identity.public.id);
      this.source(original.proposal, source, this.now());
      const proof = { envelope: original.proof.envelope, source },
        verified = registry.verified(
          record,
          this.identity.public.id,
          id,
          this.describe(proof),
          this.now(),
        ),
        result = registry.prepareReceipt(
          verified.record,
          this.identity.public,
          original.proposal,
        );
      if (result.record.revision !== record.revision) {
        values.write(this.proofKey(id), proof);
        values.write(this.key + ":record", result.record);
      }
      return result.entry;
    });
  }
  dismiss(id: string, revision: number) {
    return this.run((values, record) => {
      const result = registry.dismiss(
        record,
        this.identity.public.id,
        id,
        revision,
        this.now(),
      );
      if (result.record.revision !== record.revision) {
        // Fail closed on corrupt evidence; a cleanup must not conceal tampering.
        this.readProof(
          values,
          record.entries.find((e) => e.id === id)!,
        );
        values.remove(this.proofKey(id));
        values.write(this.key + ":record", result.record);
      }
      return { entry: result.entry, revision: result.record.revision };
    });
  }
  read(id: string, allow: Policy) {
    return this.run((values, record) => {
      const entry = record.entries.find((e) => e.id === id);
      if (!entry) return null;
      allow(entry.target.snapshotId, entry.contributorId);
      allow(entry.target.snapshotId, this.identity.public.id);
      if (!entry.proof) return { entry };
      if (entry.expires <= this.now())
        throw Error("Proposta expirada durante a política");
      const { proof, proposal } = this.readProof(values, entry);
      if (proof.source === null) return { entry };
      this.source(proposal, proof.source, this.now());
      if (!entry.receipt) {
        const migrated = registry.prepareReceipt(
          record,
          this.identity.public,
          proposal,
        );
        values.write(this.key + ":record", migrated.record);
        return { entry: migrated.entry, proposal, source: proof.source };
      }
      return { entry, proposal, source: proof.source };
    });
  }
}
