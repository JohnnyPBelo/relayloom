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
  certificates = createSiteContributionProtocol(crypto);
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
  private async run<T>(
    fn: (
      values: ProfileValueTransaction,
      record: ContributionInboxRecord,
    ) => Promise<T>,
  ): Promise<T> {
    this.ensure();
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
      const keys = values.keys("contribution-inbox:");
      let record: ContributionInboxRecord;
      if (saved === null) {
        if (keys.length !== 0)
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
      const next = registry.expire(record, this.owner.id, this.now());
      if (next.revision !== record.revision) {
        for (const entry of record.entries) {
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
      const result = await fn(values, record);
      this.ensure();
      return result;
    });
    this.ensure();
    return result;
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
        result = registry.verified(
          record,
          this.owner.id,
          id,
          this.describe(proof),
          this.now(),
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
      return { entry, proposal, source: proof.source };
    });
    if (result?.entry.proof && result.entry.expires <= this.now())
      throw Error("Proposta expirada durante a consulta");
    return result;
  }
}
