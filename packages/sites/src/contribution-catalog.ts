import { createContributionReceiptProtocol } from "./contribution-receipt";
import { createContributionEnvelopeProtocol } from "./contribution-envelope";
import { createBundleAt } from "../../core/src/index";
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
  createContributionOperations,
  type ContributionCreationRecord,
  type ContributionCreationRequest,
  type ContributionOperation,
} from "./contribution-operations";
import { createContributionContextResolver } from "./contribution-context";
import {
  createSiteContributionProtocol,
  SITE_CONTRIBUTION_LIMITS,
  type SiteContribution,
} from "./contribution-protocol";
interface Database {
  transaction<T>(callback: (tx: RegistryTransaction) => T): T;
}
interface Stage {
  request: ContributionCreationRequest;
  source: Bundle;
  certificate: SiteContribution | null;
  envelope?: Bundle;
}
const registry = createContributionOperations(nodeCertificateCrypto),
  resolver = createContributionContextResolver(nodeCertificateCrypto),
  protocol = createSiteContributionProtocol(nodeCertificateCrypto),
  envelopes = createContributionEnvelopeProtocol(nodeCertificateCrypto),
  receiptEnvelopes = createContributionReceiptProtocol(nodeCertificateCrypto);
const pending = (op: ContributionOperation) =>
  op.phase === "prepared" || op.phase === "signed";
function insist(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new RegistryIntegrityError(reason);
}
function requireOperation(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new Error(reason);
}
/** Private preparation only: no application endpoint or transport is wired yet.
 * prepare commits the source and intent WITHOUT a visitor signature. sign is a
 * later transaction and never returns a signature before its actual commit. */
export class NodeContributionCatalog {
  private readonly key: string;
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
    private readonly now: () => number = Date.now,
  ) {
    this.key =
      "contribution:" +
      hash(
        canonical({
          domain: "relayloom/contribution-catalog-key/1",
          owner: identity.public.id,
        }),
      );
  }
  private source(
    request: ContributionCreationRequest,
    bundle: Bundle,
    now: number,
  ) {
    verifyStoredBundle(bundle);
    insist(
      bundle.manifest.created - now <= 300000 && bundle.manifest.expires > now,
      "Snapshot fora do prazo de preparação",
    );
    return resolver.resolve(
      {
        action: "form",
        snapshotId: request.snapshotId,
        pageId: request.pageId,
        formId: request.formId,
      },
      bundle,
      decryptStoredBundle(bundle, this.identity),
      this.identity.public.id,
      now,
    );
  }
  private queueKey(op: ContributionOperation) {
    insist(op.certificateId, "Certificado da fila em falta");
    return "contribution:" + op.certificateId + ":stage";
  }
  private verifyStage(
    raw: unknown,
    op: ContributionOperation,
    record: ContributionCreationRecord,
  ): Stage {
    insist(
      exactShape(raw, ["request", "source", "certificate"]) ||
        exactShape(raw, ["request", "source", "certificate", "envelope"]),
      "Preparação de proposta em falta",
    );
    const stage = raw as Stage;
    const checked = registry.request(stage.request, this.identity.public.id);
    insist(
      checked.fingerprint === op.fingerprint &&
        checked.request.sequence === op.sequence &&
        checked.request.operationId === op.operationId,
      "Intenção privada diferente",
    );
    const found = this.source(checked.request, stage.source, op.created);
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
        this.identity.public.id,
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
      this.verifyEnvelope(stage.envelope, stage.certificate!);
    }

    if (op.phase === "queued") {
      insist(stage.envelope && op.transport, "Envelope da fila em falta");
      insist(
        stage.envelope.manifest.id === op.transport.bundleId &&
          hash(canonical(stage.envelope)) === op.transport.bundleHash &&
          Buffer.byteLength(canonical(stage)) === op.transport.bytes,
        "Payload da fila diferente do descritor",
      );
    }
    return stage;
  }
  private queuedStage(
    values: SitePrivateRecords,
    record: ContributionCreationRecord,
    op: ContributionOperation,
  ) {
    insist(op.phase === "queued", "Operação não está em fila");
    return this.verifyStage(values.read(this.queueKey(op)), op, record);
  }
  private run<T>(
    fn: (
      values: SitePrivateRecords,
      record: ContributionCreationRecord,
      stage: Stage | null,
    ) => T,
  ): T {
    return this.database.transaction((tx) =>
      SitePrivateRecords.runContribution(tx, this.identity, (values) => {
        const saved = values.read(this.key + ":record"),
          raw = values.read(this.key + ":stage");
        let record: ContributionCreationRecord;
        if (saved === null) {
          insist(
            tx.keys("contribution:").length === 0,
            "Registo de propostas ausente com dados existentes",
          );
          record = registry.initial(this.identity.public.id);
        } else record = registry.validate(saved, this.identity.public.id);
        const op = record.operations.find(pending);
        let stage: Stage | null = null;
        if (op) {
          stage = this.verifyStage(raw, op, record);
        } else insist(raw === null, "Preparação sem operação pendente");
        const now = this.now(),
          expired = record.operations.filter(
            (value) =>
              (pending(value) || value.phase === "queued") &&
              value.expires <= now,
          );
        for (const value of expired) {
          if (value.phase === "queued") {
            this.queuedStage(values, record, value);
            values.remove(this.queueKey(value));
          } else {
            values.remove(this.key + ":stage");
            stage = null;
          }
        }
        if (expired.length) {
          record = registry.expire(record, this.identity.public.id, now);
          values.write(this.key + ":record", record);
        }
        return fn(values, record, stage);
      }),
    );
  }
  private verifyEnvelope(bundle: Bundle, certificate: SiteContribution) {
    verifyStoredBundle(bundle);
    const value = envelopes.match(
      bundle,
      decryptStoredBundle(bundle, this.identity),
    );
    insist(
      canonical(value.proposal) === canonical(certificate),
      "Envelope de outra preparação",
    );
    return JSON.parse(canonical(bundle)) as Bundle;
  }
  receiveReceipt(
    input: Bundle,
    allow: (snapshotId: string, ownerId: string) => void,
  ) {
    const bundle = JSON.parse(canonical(input)) as Bundle;
    verifyStoredBundle(bundle);
    const receipt = receiptEnvelopes.matchEnvelope(
      bundle,
      decryptStoredBundle(bundle, this.identity),
    ).receipt;
    return this.run((values, record) => {
      const b = receipt.body;
      allow(b.target.snapshotId, b.owner.id);
      const now = this.now();
      if (
        bundle.manifest.expires <= now ||
        bundle.manifest.created - now > SITE_CONTRIBUTION_LIMITS.clockSkewMs
      )
        throw Error("Recibo fora do prazo de admissão");
      const result = registry.receive(
        record,
        this.identity.public.id,
        receipt,
        now,
      );
      if (!result.changed) return result.operation;
      const previous = record.operations.find(
        (op) => op.sequence === result.operation.sequence,
      )!;
      if (previous.phase === "queued") {
        this.queuedStage(values, record, previous);
        values.remove(this.queueKey(previous));
      }
      values.write(this.key + ":record", result.record);
      return result.operation;
    });
  }
  state() {
    return this.run((_v, record) => structuredClone(record));
  }
  operation(sequence: number, operationId: string) {
    return this.run((_v, r) => {
      const found = registry.lookup(
        r,
        this.identity.public.id,
        sequence,
        operationId,
      );
      return { operation: found.operation, retired: found.retired };
    });
  }
  prepare(
    input: unknown,
    load: () => Bundle,
    allow: (snapshotId: string, siteOwnerId: string) => void,
  ) {
    const checked = registry.request(input, this.identity.public.id),
      q = checked.request;
    return this.run((values, record) => {
      const found = registry.lookup(
        record,
        this.identity.public.id,
        q.sequence,
        q.operationId,
      );
      if (found.operation) {
        requireOperation(
          found.operation.fingerprint === checked.fingerprint,
          "Pedido de proposta repetido com outros valores",
        );
        return found.operation;
      }
      requireOperation(
        !found.retired &&
          record.nextSequence === q.sequence &&
          !record.operations.some(pending),
        "Proposta pendente ou resultado retirado",
      );
      const source = JSON.parse(canonical(load())) as Bundle,
        now = this.now(),
        resolved = this.source(q, source, now);
      allow(source.manifest.id, source.manifest.author.id);
      const prepared = registry.prepare(
        record,
        this.identity.public.id,
        q,
        resolved.context,
        this.now(),
      );
      values.write(this.key + ":stage", {
        request: q,
        source,
        certificate: null,
      });
      values.write(this.key + ":record", prepared.record);
      return prepared.operation;
    });
  }
  sign(
    op: ContributionOperation,
    allow: (snapshotId: string, siteOwnerId: string) => void,
  ) {
    return this.run((values, record, stage) => {
      const found = registry.lookup(
        record,
        this.identity.public.id,
        op.sequence,
        op.operationId,
      ).operation;
      requireOperation(
        found && found.fingerprint === op.fingerprint,
        "Preparação desconhecida",
      );
      if (!pending(found)) return found;
      insist(stage !== null, "Preparação em falta");
      const now = this.now(),
        source = this.source(stage.request, stage.source, now);
      allow(source.context.target.snapshotId, source.owner.id);
      if (found.phase === "signed") return found;
      if (found.expires <= this.now())
        throw Error("A proposta expirou durante a verificação de política");
      const certificate = protocol.create(this.identity, {
        target: source.context.target,
        schemaHash: found.schemaHash,
        operationId: found.operationId,
        created: found.created,
        expires: found.expires,
        values: stage.request.values,
        publicationScope: stage.request.publicationScope,
      });
      protocol.verifyForSubmission(certificate, source.context, this.now());
      const signed = registry.signed(
        record,
        this.identity.public.id,
        found,
        stage.request,
        certificate,
      );
      values.write(this.key + ":stage", { ...stage, certificate });
      values.write(this.key + ":record", signed.record);
      return signed.operation;
    });
  }
  authorizedCertificate(
    op: ContributionOperation,
    allow: (snapshotId: string, siteOwnerId: string) => void,
  ) {
    return this.run((values, record, stage) => {
      const found = registry.lookup(
        record,
        this.identity.public.id,
        op.sequence,
        op.operationId,
      ).operation;
      requireOperation(
        found && found.fingerprint === op.fingerprint,
        "Preparação desconhecida",
      );
      if (found.phase === "queued")
        stage = this.queuedStage(values, record, found);
      if (!["signed", "queued"].includes(found.phase)) return null;
      insist(stage?.certificate, "Assinatura em falta");
      const source = this.source(stage.request, stage.source, this.now());
      allow(source.context.target.snapshotId, source.owner.id);
      return protocol.verifyForSubmission(
        stage.certificate,
        source.context,
        this.now(),
      );
    });
  }
  seal(
    op: ContributionOperation,
    allow: (snapshotId: string, ownerId: string) => void,
  ) {
    return this.run((values, record, stage) => {
      const found = registry.lookup(
        record,
        this.identity.public.id,
        op.sequence,
        op.operationId,
      ).operation;
      requireOperation(
        found && found.fingerprint === op.fingerprint,
        "Preparação desconhecida",
      );
      if (found.phase === "queued")
        stage = this.queuedStage(values, record, found);
      if (!["signed", "queued"].includes(found.phase))
        return { operation: found, bundleId: null };
      insist(stage?.certificate, "Proposta assinada indisponível");
      const source = this.source(stage.request, stage.source, this.now());
      allow(source.context.target.snapshotId, source.owner.id);
      protocol.verifyForSubmission(
        stage.certificate,
        source.context,
        this.now(),
      );
      const envelope =
        stage.envelope ??
        createBundleAt(
          this.identity,
          "site-contribution",
          { type: "site-contribution", proposal: stage.certificate },
          [source.owner],
          found.expires - found.created,
          found.created,
        );
      const checked = this.verifyEnvelope(envelope, stage.certificate);
      protocol.verifyForSubmission(
        stage.certificate,
        source.context,
        this.now(),
      );
      if (!stage.envelope)
        values.write(this.key + ":stage", { ...stage, envelope: checked });
      return { operation: found, bundleId: checked.manifest.id };
    });
  }
  authorizedBundle(
    op: ContributionOperation,
    allow: (snapshotId: string, ownerId: string) => void,
  ) {
    return this.run((values, record, stage) => {
      const found = registry.lookup(
        record,
        this.identity.public.id,
        op.sequence,
        op.operationId,
      ).operation;
      requireOperation(
        found && found.fingerprint === op.fingerprint,
        "Preparação desconhecida",
      );
      if (found.phase === "queued")
        stage = this.queuedStage(values, record, found);
      if (!["signed", "queued"].includes(found.phase) || !stage?.envelope)
        return null;
      insist(stage.certificate, "Assinatura em falta");
      const source = this.source(stage.request, stage.source, this.now());
      allow(source.context.target.snapshotId, source.owner.id);
      protocol.verifyForSubmission(
        stage.certificate,
        source.context,
        this.now(),
      );
      const bundle = this.verifyEnvelope(stage.envelope, stage.certificate);
      protocol.verifyForSubmission(
        stage.certificate,
        source.context,
        this.now(),
      );
      return bundle;
    });
  }
  queue(
    op: ContributionOperation,
    allow: (snapshotId: string, ownerId: string) => void,
  ) {
    return this.run((values, record, stage) => {
      const found = registry.lookup(
        record,
        this.identity.public.id,
        op.sequence,
        op.operationId,
      ).operation;
      requireOperation(
        found && found.fingerprint === op.fingerprint,
        "Preparação desconhecida",
      );
      if (
        found.phase === "queued" ||
        found.phase === "expired" ||
        found.phase === "cancelled"
      )
        return found;
      requireOperation(
        found.phase === "signed" && stage?.certificate && stage.envelope,
        "Envelope privado ainda indisponível",
      );
      const source = this.source(stage.request, stage.source, this.now());
      allow(source.context.target.snapshotId, source.owner.id);
      protocol.verifyForSubmission(
        stage.certificate,
        source.context,
        this.now(),
      );
      const descriptor = {
        bundleId: stage.envelope.manifest.id,
        bundleHash: hash(canonical(stage.envelope)),
        bytes: Buffer.byteLength(canonical(stage)),
      };
      const queued = registry.queue(
          record,
          this.identity.public.id,
          found,
          descriptor,
        ),
        key = this.queueKey(queued.operation);
      insist(values.read(key) === null, "Slot privado de fila já ocupado");
      values.write(key, stage);
      values.write(this.key + ":record", queued.record);
      values.remove(this.key + ":stage");
      return queued.operation;
    });
  }
  markCopied(op: ContributionOperation, copied: Bundle) {
    return this.run((values, record) => {
      const found = registry.lookup(
        record,
        this.identity.public.id,
        op.sequence,
        op.operationId,
      ).operation;
      requireOperation(
        found &&
          found.fingerprint === op.fingerprint &&
          found.phase === "queued",
        "Envio desconhecido",
      );
      const stage = this.queuedStage(values, record, found);
      this.verifyEnvelope(copied, stage.certificate!);
      const next = registry.copied(
        record,
        this.identity.public.id,
        found,
        hash(canonical(copied)),
      );
      values.write(this.key + ":record", next.record);
      return next.operation;
    });
  }
  queuedSource(
    op: ContributionOperation,
    allow: (snapshotId: string, ownerId: string) => void,
  ) {
    return this.run((values, record) => {
      const found = registry.lookup(
        record,
        this.identity.public.id,
        op.sequence,
        op.operationId,
      ).operation;
      requireOperation(
        found &&
          found.fingerprint === op.fingerprint &&
          found.phase === "queued",
        "Envio desconhecido",
      );
      const stage = this.queuedStage(values, record, found),
        source = this.source(stage.request, stage.source, this.now());
      allow(source.context.target.snapshotId, source.owner.id);
      protocol.verifyForSubmission(
        stage.certificate,
        source.context,
        this.now(),
      );
      return JSON.parse(canonical(stage.source)) as Bundle;
    });
  }
  cancel(op: ContributionOperation) {
    return this.run((values, record) => {
      const found = registry.lookup(
        record,
        this.identity.public.id,
        op.sequence,
        op.operationId,
      ).operation;
      requireOperation(
        found && found.fingerprint === op.fingerprint,
        "Operação desconhecida",
      );
      const next = registry.cancel(record, this.identity.public.id, op);
      if (found.phase === "queued") {
        this.queuedStage(values, record, found);
        values.remove(this.queueKey(found));
      } else if (pending(found)) values.remove(this.key + ":stage");
      values.write(this.key + ":record", next);
      return next.operations.find((v) => v.sequence === op.sequence)!;
    });
  }
}
