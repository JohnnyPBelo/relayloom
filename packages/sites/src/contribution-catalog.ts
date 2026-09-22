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
  type SiteContribution,
} from "./contribution-protocol";
interface Database {
  transaction<T>(callback: (tx: RegistryTransaction) => T): T;
}
interface Stage {
  request: ContributionCreationRequest;
  source: Bundle;
  certificate: SiteContribution | null;
}
const registry = createContributionOperations(nodeCertificateCrypto),
  resolver = createContributionContextResolver(nodeCertificateCrypto),
  protocol = createSiteContributionProtocol(nodeCertificateCrypto);
const pending = (op: ContributionOperation) =>
  op.phase === "prepared" || op.phase === "signed";
function insist(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new RegistryIntegrityError(reason);
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
          insist(
            exactShape(raw, ["request", "source", "certificate"]),
            "Preparação de proposta em falta",
          );
          stage = raw as Stage;
          const checked = registry.request(
            stage.request,
            this.identity.public.id,
          );
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
            insist(
              stage.certificate === null,
              "Assinatura sem autorização guardada",
            );
          else {
            insist(stage.certificate !== null, "Assinatura preparada em falta");
            registry.signed(
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
          if (op.expires <= this.now()) {
            record = registry.expire(
              record,
              this.identity.public.id,
              this.now(),
            );
            values.remove(this.key + ":stage");
            values.write(this.key + ":record", record);
            stage = null;
          }
        } else insist(raw === null, "Preparação sem operação pendente");
        return fn(values, record, stage);
      }),
    );
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
      insist(
        found && found.fingerprint === op.fingerprint,
        "Preparação desconhecida",
      );
      if (!pending(found)) return found;
      insist(stage !== null, "Preparação em falta");
      const now = this.now(),
        source = this.source(stage.request, stage.source, now);
      allow(source.context.target.snapshotId, source.owner.id);
      if (found.phase === "signed") return found;
      const certificate = protocol.create(this.identity, {
        target: source.context.target,
        schemaHash: found.schemaHash,
        operationId: found.operationId,
        created: found.created,
        expires: found.expires,
        values: stage.request.values,
        publicationScope: stage.request.publicationScope,
      });
      protocol.verifyForSubmission(certificate, source.context, now);
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
    return this.run((_values, record, stage) => {
      const found = registry.lookup(
        record,
        this.identity.public.id,
        op.sequence,
        op.operationId,
      ).operation;
      insist(
        found && found.fingerprint === op.fingerprint,
        "Preparação desconhecida",
      );
      if (found.phase !== "signed") return null;
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
  cancel(op: ContributionOperation) {
    return this.run((values, record) => {
      const next = registry.cancel(record, this.identity.public.id, op);
      values.write(this.key + ":record", next);
      values.remove(this.key + ":stage");
      return next.operations.find((v) => v.sequence === op.sequence)!;
    });
  }
}
