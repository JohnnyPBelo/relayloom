import {
  canonical,
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
interface Proof {
  envelope: Bundle;
  source: Bundle | null;
}
type Policy = (snapshotId: string, authorId: string) => void;
const registry = createContributionInboxProtocol(nodeCertificateCrypto),
  envelopes = createContributionEnvelopeProtocol(nodeCertificateCrypto),
  resolver = createContributionContextResolver(nodeCertificateCrypto),
  certificates = createSiteContributionProtocol(nodeCertificateCrypto);
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
  private run<T>(
    fn: (values: SitePrivateRecords, record: ContributionInboxRecord) => T,
  ): T {
    return this.database.transaction((tx) =>
      SitePrivateRecords.runContributionInbox(tx, this.identity, (values) => {
        const saved = values.read(this.key + ":record"),
          keys = tx.keys("contribution-inbox:");
        let record: ContributionInboxRecord;
        if (saved === null) {
          integrity(keys.length === 0, "Inbox ausente com provas existentes");
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
        const next = registry.expire(
          record,
          this.identity.public.id,
          this.now(),
        );
        if (next.revision !== record.revision) {
          for (const entry of record.entries) {
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
        return fn(values, record);
      }),
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
        result = registry.verified(
          record,
          this.identity.public.id,
          id,
          this.describe(proof),
          this.now(),
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
      return { entry, proposal, source: proof.source };
    });
  }
}
