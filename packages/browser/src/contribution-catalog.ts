import { createContributionEnvelopeProtocol } from "../../sites/src/contribution-envelope";
import {
  canonical,
  exactShape,
  type Bundle,
  type PublicIdentity,
} from "../../core/src/protocol";
import {
  createContributionOperations,
  type ContributionCreationRecord,
  type ContributionCreationRequest,
  type ContributionOperation,
} from "../../sites/src/contribution-operations";
import { createContributionContextResolver } from "../../sites/src/contribution-context";
import {
  createSiteContributionProtocol,
  type SiteContribution,
} from "../../sites/src/contribution-protocol";
import { browserCertificateCrypto } from "./certificate-crypto";
import { verifiedStoredBundle } from "./crypto";
import { BrowserProfile, type ProfileValueTransaction } from "./profile";
interface Stage {
  request: ContributionCreationRequest;
  source: Bundle;
  certificate: SiteContribution | null;
  envelope?: Bundle;
}
type Policy = (
  values: ProfileValueTransaction,
  snapshotId: string,
  ownerId: string,
) => Promise<void>;
const registry = createContributionOperations(browserCertificateCrypto),
  resolver = createContributionContextResolver(browserCertificateCrypto),
  protocol = createSiteContributionProtocol(browserCertificateCrypto),
  envelopes = createContributionEnvelopeProtocol(browserCertificateCrypto);
const pending = (op: ContributionOperation) =>
  op.phase === "prepared" || op.phase === "signed";
function insist(ok: unknown, reason: string): asserts ok {
  if (!ok) throw Error(reason);
}
/** Internal durable intent/signing stage. App submission/outbox is not wired yet.
 * Private values use the existing signing-owned encryption and key-bound AAD. */
export class BrowserContributionCatalog {
  private readonly generation: number;
  private readonly owner: PublicIdentity;
  private readonly key: string;
  constructor(
    private readonly profile: BrowserProfile,
    private readonly now: () => number = Date.now,
  ) {
    const owner = profile.identity;
    if (!owner) throw Error("Desbloqueia a identidade");
    this.owner = structuredClone(owner);
    this.generation = profile.sessionGeneration;
    this.key =
      "contribution:" +
      browserCertificateCrypto.hash(
        canonical({
          domain: "relayloom/contribution-catalog-key/1",
          owner: owner.id,
        }),
      );
  }
  private ensure() {
    if (
      this.profile.sessionGeneration !== this.generation ||
      this.profile.identity?.id !== this.owner.id
    )
      throw Error("Sessão de proposta bloqueada");
  }
  private async source(
    request: ContributionCreationRequest,
    raw: Bundle,
    now: number,
  ) {
    this.ensure();
    const bundle = await verifiedStoredBundle(raw);
    this.ensure();
    insist(
      bundle.manifest.created - now <= 300000 && bundle.manifest.expires > now,
      "Snapshot fora do prazo de preparação",
    );
    const plaintext = await this.profile.decryptStaging(bundle);
    this.ensure();
    return resolver.resolve(
      {
        action: "form",
        snapshotId: request.snapshotId,
        pageId: request.pageId,
        formId: request.formId,
      },
      bundle,
      plaintext,
      this.owner.id,
      now,
    );
  }
  private queueKey(op: ContributionOperation) {
    insist(op.certificateId, "Certificado da fila em falta");
    return "contribution:" + op.certificateId + ":stage";
  }
  private async verifyStage(
    raw: unknown,
    op: ContributionOperation,
    record: ContributionCreationRecord,
  ): Promise<Stage> {
    insist(
      exactShape(raw, ["request", "source", "certificate"]) ||
        exactShape(raw, ["request", "source", "certificate", "envelope"]),
      "Preparação de proposta em falta",
    );
    const stage = raw as Stage;
    const checked = registry.request(stage.request, this.owner.id);
    insist(
      checked.fingerprint === op.fingerprint &&
        checked.request.sequence === op.sequence &&
        checked.request.operationId === op.operationId,
      "Intenção privada diferente",
    );
    const found = await this.source(checked.request, stage.source, op.created);
    this.ensure();
    insist(
      canonical(found.context.target) === canonical(op.target) &&
        protocol.schemaHash(found.context.form, found.context.table) ===
          op.schemaHash,
      "Snapshot preparado diferente",
    );
    insist(
      op.expires ===
        Math.min(
          op.created + checked.request.ttlMs,
          found.context.snapshotExpires,
        ),
      "Prazo privado diferente da intenção",
    );
    if (op.phase === "prepared")
      insist(stage.certificate === null, "Assinatura sem autorização guardada");
    else {
      insist(stage.certificate !== null, "Assinatura preparada em falta");
      registry.checkCertificate(
        record,
        this.owner.id,
        op,
        stage.request,
        stage.certificate,
      );
      protocol.verifyForSubmission(
        stage.certificate,
        found.context,
        op.created,
      );
    }
    if (Object.hasOwn(stage, "envelope")) {
      insist(
        (op.phase === "signed" || op.phase === "queued") && stage.envelope,
        "Envelope sem proposta assinada",
      );
      await this.verifyEnvelope(stage.envelope, stage.certificate!);
      this.ensure();
    }

    if (op.phase === "queued") {
      insist(stage.envelope && op.transport, "Envelope da fila em falta");
      insist(
        stage.envelope.manifest.id === op.transport.bundleId &&
          browserCertificateCrypto.hash(canonical(stage.envelope)) ===
            op.transport.bundleHash &&
          new TextEncoder().encode(canonical(stage)).length ===
            op.transport.bytes,
        "Payload da fila diferente do descritor",
      );
    }
    return stage;
  }
  private async queuedStage(
    values: ProfileValueTransaction,
    record: ContributionCreationRecord,
    op: ContributionOperation,
  ) {
    insist(op.phase === "queued", "Operação não está em fila");
    const raw = await values.get(this.queueKey(op));
    this.ensure();
    return this.verifyStage(raw, op, record);
  }
  private async run<T>(
    fn: (
      values: ProfileValueTransaction,
      record: ContributionCreationRecord,
      stage: Stage | null,
    ) => Promise<T>,
  ): Promise<T> {
    this.ensure();
    return this.profile.transactValues(async (values) => {
      this.ensure();
      const saved = await values.get(this.key + ":record"),
        raw = await values.get(this.key + ":stage");
      this.ensure();
      let record: ContributionCreationRecord;
      if (saved === null) {
        insist(
          values.keys("contribution:").length === 0,
          "Registo de propostas ausente com dados existentes",
        );
        record = registry.initial(this.owner.id);
      } else record = registry.validate(saved, this.owner.id);
      const op = record.operations.find(pending);
      let stage: Stage | null = null;
      if (op) {
        stage = await this.verifyStage(raw, op, record);
        this.ensure();
      } else insist(raw === null, "Preparação sem operação pendente");
      const now = this.now(),
        expired = record.operations.filter(
          (value) =>
            (pending(value) || value.phase === "queued") &&
            value.expires <= now,
        );
      for (const value of expired) {
        if (value.phase === "queued") {
          await this.queuedStage(values, record, value);
          this.ensure();
          await values.remove(this.queueKey(value));
        } else {
          await values.remove(this.key + ":stage");
          stage = null;
        }
      }
      if (expired.length) {
        record = registry.expire(record, this.owner.id, now);
        values.set(this.key + ":record", record);
      }
      const result = await fn(values, record, stage);
      this.ensure();
      return result;
    });
  }
  private async verifyEnvelope(raw: Bundle, certificate: SiteContribution) {
    const bundle = await verifiedStoredBundle(raw);
    this.ensure();
    const value = envelopes.match(
      bundle,
      await this.profile.decryptStaging(bundle),
    );
    this.ensure();
    insist(
      canonical(value.proposal) === canonical(certificate),
      "Envelope de outra preparação",
    );
    return bundle;
  }
  state() {
    return this.run(async (_values, record) => structuredClone(record));
  }
  operation(sequence: number, operationId: string) {
    return this.run(async (_values, record) => {
      const found = registry.lookup(
        record,
        this.owner.id,
        sequence,
        operationId,
      );
      return { operation: found.operation, retired: found.retired };
    });
  }
  async prepare(input: unknown, load: () => Promise<Bundle>, allow: Policy) {
    const checked = registry.request(input, this.owner.id),
      q = checked.request;
    const previous = await this.run(async (_values, record) => {
      const found = registry.lookup(
        record,
        this.owner.id,
        q.sequence,
        q.operationId,
      );
      if (found.operation) {
        insist(
          found.operation.fingerprint === checked.fingerprint,
          "Pedido de proposta repetido com outros valores",
        );
        return found.operation;
      }
      insist(
        !found.retired &&
          record.nextSequence === q.sequence &&
          !record.operations.some(pending),
        "Proposta pendente ou resultado retirado",
      );
      return null;
    });
    if (previous) return previous;
    // Loading may acquire the profile lock, so it must happen before transactValues.
    const source = await verifiedStoredBundle(await load());
    this.ensure();
    return this.run(async (values, record) => {
      const found = registry.lookup(
        record,
        this.owner.id,
        q.sequence,
        q.operationId,
      );
      if (found.operation) {
        insist(
          found.operation.fingerprint === checked.fingerprint,
          "Pedido de proposta repetido com outros valores",
        );
        return found.operation;
      }
      insist(
        !found.retired &&
          record.nextSequence === q.sequence &&
          !record.operations.some(pending),
        "Proposta pendente ou resultado retirado",
      );
      const now = this.now(),
        resolved = await this.source(q, source, now);
      this.ensure();
      await allow(values, source.manifest.id, source.manifest.author.id);
      this.ensure();
      const prepared = registry.prepare(
        record,
        this.owner.id,
        q,
        resolved.context,
        this.now(),
      );
      values.set(this.key + ":stage", {
        request: q,
        source,
        certificate: null,
      });
      values.set(this.key + ":record", prepared.record);
      return prepared.operation;
    });
  }
  sign(op: ContributionOperation, allow: Policy) {
    return this.run(async (values, record, stage) => {
      const found = registry.lookup(
        record,
        this.owner.id,
        op.sequence,
        op.operationId,
      ).operation;
      insist(
        found && found.fingerprint === op.fingerprint,
        "Preparação desconhecida",
      );
      if (!pending(found)) return found;
      insist(stage !== null, "Preparação em falta");
      const now = this.now(),
        source = await this.source(stage.request, stage.source, now);
      this.ensure();
      await allow(values, source.context.target.snapshotId, source.owner.id);
      this.ensure();
      if (found.phase === "signed") return found;
      if (found.expires <= this.now())
        throw Error("A proposta expirou durante a verificação de política");
      const certificate = await this.profile.signSiteContribution({
        target: source.context.target,
        schemaHash: found.schemaHash,
        operationId: found.operationId,
        created: found.created,
        expires: found.expires,
        values: stage.request.values,
        publicationScope: stage.request.publicationScope,
      });
      this.ensure();
      protocol.verifyForSubmission(certificate, source.context, this.now());
      const signed = registry.signed(
        record,
        this.owner.id,
        found,
        stage.request,
        certificate,
      );
      values.set(this.key + ":stage", { ...stage, certificate });
      values.set(this.key + ":record", signed.record);
      return signed.operation;
    });
  }
  authorizedCertificate(op: ContributionOperation, allow: Policy) {
    return this.run(async (values, record, stage) => {
      const found = registry.lookup(
        record,
        this.owner.id,
        op.sequence,
        op.operationId,
      ).operation;
      insist(
        found && found.fingerprint === op.fingerprint,
        "Preparação desconhecida",
      );
      if (found.phase === "queued") {
        stage = await this.queuedStage(values, record, found);
        this.ensure();
      }
      if (!["signed", "queued"].includes(found.phase)) return null;
      insist(stage?.certificate, "Assinatura em falta");
      const source = await this.source(stage.request, stage.source, this.now());
      this.ensure();
      await allow(values, source.context.target.snapshotId, source.owner.id);
      this.ensure();
      return protocol.verifyForSubmission(
        stage.certificate,
        source.context,
        this.now(),
      );
    });
  }
  seal(op: ContributionOperation, allow: Policy) {
    return this.run(async (values, record, stage) => {
      const found = registry.lookup(
        record,
        this.owner.id,
        op.sequence,
        op.operationId,
      ).operation;
      insist(
        found && found.fingerprint === op.fingerprint,
        "Preparação desconhecida",
      );
      if (found.phase === "queued") {
        stage = await this.queuedStage(values, record, found);
        this.ensure();
      }
      if (!["signed", "queued"].includes(found.phase))
        return { operation: found, bundleId: null };
      insist(stage?.certificate, "Proposta assinada indisponível");
      const source = await this.source(stage.request, stage.source, this.now());
      this.ensure();
      await allow(values, source.context.target.snapshotId, source.owner.id);
      this.ensure();
      protocol.verifyForSubmission(
        stage.certificate,
        source.context,
        this.now(),
      );
      const envelope =
        stage.envelope ??
        (await this.profile.sealSiteContribution(
          stage.certificate,
          source.owner,
        ));
      this.ensure();
      const checked = await this.verifyEnvelope(envelope, stage.certificate);
      this.ensure();
      protocol.verifyForSubmission(
        stage.certificate,
        source.context,
        this.now(),
      );
      if (!stage.envelope)
        values.set(this.key + ":stage", { ...stage, envelope: checked });
      return { operation: found, bundleId: checked.manifest.id };
    });
  }
  authorizedBundle(op: ContributionOperation, allow: Policy) {
    return this.run(async (values, record, stage) => {
      const found = registry.lookup(
        record,
        this.owner.id,
        op.sequence,
        op.operationId,
      ).operation;
      insist(
        found && found.fingerprint === op.fingerprint,
        "Preparação desconhecida",
      );
      if (found.phase === "queued") {
        stage = await this.queuedStage(values, record, found);
        this.ensure();
      }
      if (!["signed", "queued"].includes(found.phase) || !stage?.envelope)
        return null;
      insist(stage.certificate, "Assinatura em falta");
      const source = await this.source(stage.request, stage.source, this.now());
      this.ensure();
      await allow(values, source.context.target.snapshotId, source.owner.id);
      this.ensure();
      protocol.verifyForSubmission(
        stage.certificate,
        source.context,
        this.now(),
      );
      const bundle = await this.verifyEnvelope(
        stage.envelope,
        stage.certificate,
      );
      this.ensure();
      protocol.verifyForSubmission(
        stage.certificate,
        source.context,
        this.now(),
      );
      return bundle;
    });
  }
  queue(op: ContributionOperation, allow: Policy) {
    return this.run(async (values, record, stage) => {
      const found = registry.lookup(
        record,
        this.owner.id,
        op.sequence,
        op.operationId,
      ).operation;
      insist(
        found && found.fingerprint === op.fingerprint,
        "Preparação desconhecida",
      );
      if (["queued", "expired", "cancelled"].includes(found.phase))
        return found;
      insist(
        found.phase === "signed" && stage?.certificate && stage.envelope,
        "Envelope privado ainda indisponível",
      );
      const source = await this.source(stage.request, stage.source, this.now());
      this.ensure();
      await allow(values, source.context.target.snapshotId, source.owner.id);
      this.ensure();
      protocol.verifyForSubmission(
        stage.certificate,
        source.context,
        this.now(),
      );
      const descriptor = {
        bundleId: stage.envelope.manifest.id,
        bundleHash: browserCertificateCrypto.hash(canonical(stage.envelope)),
        bytes: new TextEncoder().encode(canonical(stage)).length,
      };
      const queued = registry.queue(record, this.owner.id, found, descriptor),
        key = this.queueKey(queued.operation);
      const previous = await values.get(key);
      this.ensure();
      insist(previous === null, "Slot privado de fila já ocupado");
      values.set(key, stage);
      values.set(this.key + ":record", queued.record);
      await values.remove(this.key + ":stage");
      return queued.operation;
    });
  }
  markCopied(op: ContributionOperation, copied: Bundle) {
    return this.run(async (values, record) => {
      const found = registry.lookup(
        record,
        this.owner.id,
        op.sequence,
        op.operationId,
      ).operation;
      insist(
        found &&
          found.fingerprint === op.fingerprint &&
          found.phase === "queued",
        "Envio desconhecido",
      );
      const stage = await this.queuedStage(values, record, found);
      this.ensure();
      await this.verifyEnvelope(copied, stage.certificate!);
      this.ensure();
      const next = registry.copied(
        record,
        this.owner.id,
        found,
        browserCertificateCrypto.hash(canonical(copied)),
      );
      values.set(this.key + ":record", next.record);
      return next.operation;
    });
  }
  queuedSource(op: ContributionOperation, allow: Policy) {
    return this.run(async (values, record) => {
      const found = registry.lookup(
        record,
        this.owner.id,
        op.sequence,
        op.operationId,
      ).operation;
      insist(
        found &&
          found.fingerprint === op.fingerprint &&
          found.phase === "queued",
        "Envio desconhecido",
      );
      const stage = await this.queuedStage(values, record, found);
      this.ensure();
      const source = await this.source(stage.request, stage.source, this.now());
      this.ensure();
      await allow(values, source.context.target.snapshotId, source.owner.id);
      this.ensure();
      protocol.verifyForSubmission(
        stage.certificate,
        source.context,
        this.now(),
      );
      return JSON.parse(canonical(stage.source)) as Bundle;
    });
  }
  cancel(op: ContributionOperation) {
    return this.run(async (values, record) => {
      const found = registry.lookup(
        record,
        this.owner.id,
        op.sequence,
        op.operationId,
      ).operation;
      insist(
        found && found.fingerprint === op.fingerprint,
        "Operação desconhecida",
      );
      const next = registry.cancel(record, this.owner.id, op);
      if (found.phase === "queued") {
        await this.queuedStage(values, record, found);
        this.ensure();
        await values.remove(this.queueKey(found));
      } else if (pending(found)) await values.remove(this.key + ":stage");
      values.set(this.key + ":record", next);
      return next.operations.find((v) => v.sequence === op.sequence)!;
    });
  }
}
