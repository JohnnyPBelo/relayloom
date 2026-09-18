import {
  canonical,
  hash,
  createBundle,
  verifyBundle,
  verifyStoredBundle,
  decryptStoredBundle,
  type Bundle,
  type Identity,
  type PublicIdentity,
} from "../../core/src/index";
import { validateIdentity } from "../../core/src/index";
import {
  RegistryIntegrityError,
  type RegistryTransaction,
} from "../../groups/src/storage";
import {
  describeSiteResource,
  parseSiteResource,
  type SiteReadScope,
} from "../../content/src/site-resource";
import {
  createResourceOperations,
  type ResourceCreationRecord,
  type ResourceOperation,
} from "./resource-operations";
import { SitePrivateRecords } from "./private-storage";

interface Database {
  transaction<T>(callback: (tx: RegistryTransaction) => T): T;
}
export interface ResourceOperationHandle {
  sequence: number;
  operationId: string;
  fingerprint: string;
}
const registry = createResourceOperations({ hash });
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function insist(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new RegistryIntegrityError(reason);
}

/** Signing-owned local creation journal. Transactions return only after real
 * commit. The runtime copies authorized bytes to ContentStore without broadcast,
 * verifies the copy and calls ready. Lost responses recover the retained ID. */
export class NodeResourceCatalog {
  private readonly key: string;
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
  ) {
    this.key =
      "resource:" +
      hash(
        canonical({
          domain: "relayloom/resource-catalog-key/1",
          owner: identity.public.id,
        }),
      );
  }
  private verify(bundle: Bundle, op: ResourceOperation) {
    verifyStoredBundle(bundle);
    insist(
      bundle.manifest.kind === "site-resource" &&
        bundle.manifest.author.id === this.identity.public.id,
      "Autor ou tipo do recurso preparado inválido",
    );
    const resource = parseSiteResource(
      decryptStoredBundle(bundle, this.identity),
    );
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
    return JSON.parse(canonical(bundle)) as Bundle;
  }
  private run<T>(
    fn: (
      values: SitePrivateRecords,
      record: ResourceCreationRecord,
      stage: Bundle | null,
    ) => T,
  ): T {
    return this.database.transaction((tx) =>
      SitePrivateRecords.runResource(tx, this.identity, (values) => {
        const saved = values.read(this.key + ":record"),
          raw = values.read(this.key + ":stage");
        let record: ResourceCreationRecord;
        if (saved === null) {
          insist(
            tx.keys("resource:").length === 0,
            "Registo de criação ausente com dados existentes",
          );
          record = registry.initial(this.identity.public.id);
        } else {
          try {
            record = registry.validate(saved, this.identity.public.id);
          } catch {
            throw new RegistryIntegrityError(
              "Registo de criação de recursos inválido",
            );
          }
        }
        const pending = record.operations.find(
          (op) => op.phase === "copy-pending",
        );
        let stage: Bundle | null = null;
        if (pending) {
          insist(raw !== null, "Preparação de recurso em falta");
          try {
            stage = this.verify(raw as Bundle, pending);
          } catch {
            throw new RegistryIntegrityError("Preparação de recurso inválida");
          }
          if (pending.expires <= Date.now()) {
            record = registry.expire(
              record,
              this.identity.public.id,
              Date.now(),
            );
            values.remove(this.key + ":stage");
            values.write(this.key + ":record", record);
            stage = null;
          }
        } else
          insist(raw === null, "Assinatura de recurso sem operação pendente");
        return fn(values, record, stage);
      }),
    );
  }
  state() {
    return this.run((_values, record) => structuredClone(record));
  }
  operation(sequence: number, operationId: string) {
    return this.run((_values, record) => {
      const found = registry.lookup(
        record,
        this.identity.public.id,
        sequence,
        operationId,
      );
      return { operation: found.operation, retired: found.retired };
    });
  }
  prepare(
    input: unknown,
    resolveReaders: (scope: SiteReadScope) => PublicIdentity[] | "public",
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
      if (
        readers !== "public" &&
        (readers.length > 64 ||
          readers.some((c) => !validateIdentity(c)) ||
          new Set(readers.map((c) => c.id)).size !== readers.length)
      )
        throw Error("Leitores do recurso inválidos");
      const scope =
        readers === "public" ? "public" : readers.map((c) => c.id).sort();
      if (!same(scope, q.recipients))
        throw Error("Os cartões não correspondem aos leitores do recurso");
      const bundle = createBundle(
        this.identity,
        "site-resource",
        q.content,
        readers,
        q.ttlMs,
      );
      verifyBundle(bundle);
      const ref = describeSiteResource(q.content, {
        id: bundle.manifest.id,
        authorId: bundle.manifest.author.id,
        kind: bundle.manifest.kind,
      });
      const prepared = registry.prepare(record, this.identity.public.id, q, {
        reference: ref,
        created: bundle.manifest.created,
        expires: bundle.manifest.expires,
        bundleHash: hash(canonical(bundle)),
        recipients: scope,
      });
      this.verify(bundle, prepared.operation);
      values.write(this.key + ":stage", bundle);
      values.write(this.key + ":record", prepared.record);
      return prepared.operation;
    });
  }
  authorizedBundle(handle: ResourceOperationHandle): Bundle | null {
    return this.run((_values, record, stage) => {
      const { operation } = registry.lookup(
        record,
        this.identity.public.id,
        handle.sequence,
        handle.operationId,
      );
      if (!operation || operation.fingerprint !== handle.fingerprint)
        throw Error("Resultado de criação desconhecido");
      if (operation.phase !== "copy-pending") return null;
      insist(stage !== null, "Preparação de recurso em falta");
      verifyBundle(stage);
      return stage;
    });
  }
  ready(handle: ResourceOperationHandle, copied: Bundle) {
    return this.run((values, record, stage) => {
      const { operation } = registry.lookup(
        record,
        this.identity.public.id,
        handle.sequence,
        handle.operationId,
      );
      if (!operation || operation.fingerprint !== handle.fingerprint)
        throw Error("Resultado de criação desconhecido");
      this.verify(copied, operation);
      if (operation.phase === "ready") return operation;
      insist(
        operation.phase === "copy-pending" &&
          stage !== null &&
          same(stage, copied),
        "A cópia não corresponde ao recurso autorizado",
      );
      verifyBundle(copied);
      const next = registry.ready(
        record,
        this.identity.public.id,
        handle.sequence,
        handle.operationId,
        handle.fingerprint,
        hash(canonical(copied)),
      );
      values.write(this.key + ":record", next);
      values.remove(this.key + ":stage");
      return next.operations.find((op) => op.sequence === handle.sequence)!;
    });
  }
}
