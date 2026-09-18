import {
  canonical,
  type Bundle,
  type PublicIdentity,
} from "../../core/src/protocol";
import {
  describeSiteResource,
  parseSiteResource,
  type SiteReadScope,
} from "../../content/src/site-resource";
import {
  createResourceOperations,
  type ResourceCreationRecord,
  type ResourceOperation,
} from "../../sites/src/resource-operations";
import type { ResourceOperationHandle } from "../../sites/src/resource-catalog";
import { browserCertificateCrypto } from "./certificate-crypto";
import {
  verifiedBundle,
  verifiedStoredBundle,
  validateIdentity,
} from "./crypto";
import { BrowserProfile, type ProfileValueTransaction } from "./profile";
const hash = browserCertificateCrypto.hash,
  registry = createResourceOperations({ hash });
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function insist(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}

/** Same operation records as Node/Go; the browser transaction encrypts all
 * private values with signing ownership and guards the live profile generation. */
export class BrowserResourceCatalog {
  private readonly owner: PublicIdentity;
  private readonly generation: number;
  private readonly key: string;
  constructor(private readonly profile: BrowserProfile) {
    const owner = profile.identity;
    if (!owner) throw Error("Desbloqueia a identidade");
    this.owner = structuredClone(owner);
    this.generation = profile.sessionGeneration;
    this.key =
      "resource:" +
      hash(
        canonical({
          domain: "relayloom/resource-catalog-key/1",
          owner: owner.id,
        }),
      );
  }
  private ensure() {
    if (
      this.profile.sessionGeneration !== this.generation ||
      !same(this.profile.identity, this.owner)
    )
      throw Error("Sessão de recursos bloqueada");
  }
  private async verify(value: Bundle, op: ResourceOperation) {
    this.ensure();
    const bundle = await verifiedStoredBundle(value);
    insist(
      bundle.manifest.kind === "site-resource" &&
        bundle.manifest.author.id === this.owner.id,
      "Autor ou tipo do recurso preparado inválido",
    );
    const resource = parseSiteResource(
      await this.profile.decryptStaging(bundle),
    );
    this.ensure();
    const scope: SiteReadScope =
      bundle.manifest.publicKey !== null
        ? "public"
        : bundle.manifest.keys.map((k) => k.reader).sort();
    const reference = describeSiteResource(resource, {
      id: bundle.manifest.id,
      authorId: bundle.manifest.author.id,
      kind: bundle.manifest.kind,
    });
    insist(
      same(reference, op.reference) &&
        same(scope, op.recipients) &&
        bundle.manifest.created === op.created &&
        bundle.manifest.expires === op.expires &&
        hash(canonical(bundle)) === op.bundleHash,
      "Preparação não corresponde ao registo de criação",
    );
    return bundle;
  }
  private async run<T>(
    fn: (
      values: ProfileValueTransaction,
      record: ResourceCreationRecord,
      stage: Bundle | null,
    ) => Promise<T>,
  ): Promise<T> {
    this.ensure();
    return this.profile.transactValues(async (values) => {
      this.ensure();
      const saved = await values.get(this.key + ":record"),
        raw = await values.get(this.key + ":stage");
      this.ensure();
      let record: ResourceCreationRecord;
      if (saved === null) {
        insist(
          values.keys("resource:").length === 0,
          "Registo de criação ausente com dados existentes",
        );
        record = registry.initial(this.owner.id);
      } else record = registry.validate(saved, this.owner.id);
      const pending = record.operations.find(
        (op) => op.phase === "copy-pending",
      );
      let stage: Bundle | null = null;
      if (pending) {
        insist(raw !== null, "Preparação de recurso em falta");
        stage = await this.verify(raw as Bundle, pending);
        this.ensure();
        if (pending.expires <= Date.now()) {
          record = registry.expire(record, this.owner.id, Date.now());
          await values.remove(this.key + ":stage");
          values.set(this.key + ":record", record);
          stage = null;
        }
      } else
        insist(raw === null, "Assinatura de recurso sem operação pendente");
      const result = await fn(values, record, stage);
      this.ensure();
      return result;
    });
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
  // Resolver consumes an already-loaded contact snapshot. Calling profile
  // methods here would re-enter its exclusive transaction lock.
  async prepare(
    input: unknown,
    resolveReaders: (scope: SiteReadScope) => PublicIdentity[] | "public",
  ) {
    const checked = registry.request(input, this.owner.id),
      q = checked.request;
    return this.run(async (values, record) => {
      const found = registry.lookup(
        record,
        this.owner.id,
        q.sequence,
        q.operationId,
      );
      if (found.operation) {
        if (found.operation.fingerprint !== checked.fingerprint)
          throw Error("Pedido de recurso repetido com outros valores");
        return found.operation;
      }
      if (
        found.retired ||
        q.sequence !== record.nextSequence ||
        record.operations.some((op) => op.phase === "copy-pending")
      )
        throw Error("Recurso pendente, pedido retirado ou sequência diferente");
      const readers = resolveReaders(q.recipients);
      this.ensure();
      if (readers !== "public") {
        insist(
          Array.isArray(readers) &&
            readers.length <= 64 &&
            new Set(readers.map((c) => c.id)).size === readers.length,
          "Leitores do recurso inválidos",
        );
        for (const card of readers)
          insist(await validateIdentity(card), "Cartão de leitor inválido");
      }
      const scope =
        readers === "public" ? "public" : readers.map((c) => c.id).sort();
      insist(
        same(scope, q.recipients),
        "Os cartões não correspondem aos leitores do recurso",
      );
      const bundle = await this.profile.signContent(
        "site-resource",
        q.content,
        readers,
        q.ttlMs,
      );
      this.ensure();
      const ref = describeSiteResource(q.content, {
        id: bundle.manifest.id,
        authorId: bundle.manifest.author.id,
        kind: bundle.manifest.kind,
      });
      const prepared = registry.prepare(record, this.owner.id, q, {
        reference: ref,
        created: bundle.manifest.created,
        expires: bundle.manifest.expires,
        bundleHash: hash(canonical(bundle)),
        recipients: scope,
      });
      await this.verify(bundle, prepared.operation);
      this.ensure();
      values.set(this.key + ":stage", bundle);
      values.set(this.key + ":record", prepared.record);
      return prepared.operation;
    });
  }
  authorizedBundle(handle: ResourceOperationHandle): Promise<Bundle | null> {
    return this.run(async (_values, record, stage) => {
      const { operation } = registry.lookup(
        record,
        this.owner.id,
        handle.sequence,
        handle.operationId,
      );
      if (!operation || operation.fingerprint !== handle.fingerprint)
        throw Error("Resultado de criação desconhecido");
      if (operation.phase !== "copy-pending") return null;
      insist(stage !== null, "Preparação de recurso em falta");
      const bundle = await verifiedBundle(stage);
      this.ensure();
      return bundle;
    });
  }
  ready(handle: ResourceOperationHandle, copied: Bundle) {
    return this.run(async (values, record, stage) => {
      const { operation } = registry.lookup(
        record,
        this.owner.id,
        handle.sequence,
        handle.operationId,
      );
      if (!operation || operation.fingerprint !== handle.fingerprint)
        throw Error("Resultado de criação desconhecido");
      await this.verify(copied, operation);
      this.ensure();
      if (operation.phase === "ready") return operation;
      insist(
        operation.phase === "copy-pending" &&
          stage !== null &&
          same(stage, copied),
        "A cópia não corresponde ao recurso autorizado",
      );
      await verifiedBundle(copied);
      this.ensure();
      const next = registry.ready(
        record,
        this.owner.id,
        handle.sequence,
        handle.operationId,
        handle.fingerprint,
        hash(canonical(copied)),
      );
      values.set(this.key + ":record", next);
      await values.remove(this.key + ":stage");
      return next.operations.find((op) => op.sequence === handle.sequence)!;
    });
  }
}
