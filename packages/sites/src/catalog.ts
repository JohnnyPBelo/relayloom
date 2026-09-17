import {
  canonical,
  hash,
  verifyBundle,
  decryptBundle,
  verifyStoredBundle,
  decryptStoredBundle,
  type Bundle,
  type Identity,
} from "../../core/src/index";
import { exactShape } from "../../core/src/protocol";
import { nodeCertificateCrypto } from "../../core/src/certificate-crypto";
import {
  RegistryCapacityError,
  RegistryIntegrityError,
  type RegistryTransaction,
} from "../../groups/src/storage";
import {
  createSiteRegistry,
  type SiteRecord,
  type SiteOperation,
} from "./registry";
import { createSiteContentProtocol } from "./content";
import { SitePrivateRecords } from "./private-storage";
import { siteAddress } from "./protocol";

export const SITE_CATALOG_LIMITS = Object.freeze({ sites: 64 });
interface Database {
  transaction<T>(callback: (tx: RegistryTransaction) => T): T;
}
interface Entry {
  ownerId: string;
  name: string;
}
interface Index {
  domain: "relayloom/site-catalog/1";
  sites: Entry[];
}
export interface SiteOperationHandle {
  sequence: number;
  operationId: string;
  fingerprint: string;
}
const registry = createSiteRegistry(nodeCertificateCrypto),
  snapshots = createSiteContentProtocol(nodeCertificateCrypto);
const summary = (operation: SiteOperation) => ({
  sequence: operation.sequence,
  operationId: operation.operationId,
  fingerprint: operation.fingerprint,
  bundleId: operation.bundleId,
  phase: operation.phase,
});
function insist(value: unknown, message: string): asserts value {
  if (!value) throw new RegistryIntegrityError(message);
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** Persistent local catalog. Every public method returns only after the actual
 * database transaction completes; no callback receives an authorized bundle
 * before commit. The application still owns copying/serving the public bundle,
 * transport resolution, UI integration and consent. */
export class NodeSiteCatalog {
  private readonly indexKey: string;
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
  ) {
    this.indexKey =
      "site:" +
      hash(
        canonical({
          domain: "relayloom/local-site-catalog-key/1",
          owner: identity.public.id,
        }),
      ) +
      ":record";
  }
  private run<T>(fn: (values: SitePrivateRecords, index: Index) => T): T {
    return this.database.transaction((tx) =>
      SitePrivateRecords.run(tx, this.identity, (values) => {
        const stored = values.read(this.indexKey);
        if (stored === null) {
          insist(
            tx.keys("site:").length === 0,
            "Catálogo de sites ausente com registos existentes",
          );
          return fn(values, { domain: "relayloom/site-catalog/1", sites: [] });
        }
        insist(
          exactShape(stored, ["domain", "sites"]),
          "Catálogo de sites inválido",
        );
        const index = stored as Index;
        insist(
          index.domain === "relayloom/site-catalog/1" &&
            Array.isArray(index.sites) &&
            index.sites.length <= SITE_CATALOG_LIMITS.sites,
          "Limites do catálogo de sites inválidos",
        );
        let previous = "";
        for (const entry of index.sites) {
          insist(
            exactShape(entry, ["ownerId", "name"]),
            "Entrada de catálogo inválida",
          );
          let address: string;
          try {
            address = siteAddress(entry.ownerId, entry.name);
          } catch {
            throw new RegistryIntegrityError("Contexto do catálogo inválido");
          }
          insist(
            previous < address,
            "Catálogo de sites repetido ou desordenado",
          );
          previous = address;
        }
        return fn(values, index);
      }),
    );
  }
  private key(ownerId: string, name: string) {
    return registry.recordKey(ownerId, name);
  }
  private record(
    values: SitePrivateRecords,
    index: Index,
    ownerId: string,
    name: string,
  ) {
    const key = this.key(ownerId, name),
      known = index.sites.some((e) => e.ownerId === ownerId && e.name === name),
      data = values.read(key + ":record");
    if (!known) {
      insist(
        data === null && values.read(key + ":stage") === null,
        "Registo de site fora do catálogo",
      );
      return registry.initial(ownerId, name);
    }
    insist(data !== null, "Registo de site em falta");
    let record: SiteRecord;
    try {
      record = registry.validate(data, ownerId, name);
    } catch {
      throw new RegistryIntegrityError("Registo de site inválido");
    }
    const stage = this.stage(values, record);
    if (stage && stage.manifest.expires <= Date.now()) {
      const pending = record.operations.find(
        (o) => o.phase === "prepared" || o.phase === "committed",
      )!;
      record = registry.expire(
        record,
        pending.sequence,
        pending.operationId,
        pending.fingerprint,
      ).record;
      values.remove(this.key(ownerId, name) + ":stage");
      this.save(values, index, record);
    }
    return record;
  }
  private save(values: SitePrivateRecords, index: Index, record: SiteRecord) {
    if (
      !index.sites.some(
        (e) => e.ownerId === record.ownerId && e.name === record.name,
      )
    ) {
      if (index.sites.length >= SITE_CATALOG_LIMITS.sites)
        throw new RegistryCapacityError("Limite de sites guardados atingido");
      index.sites.push({ ownerId: record.ownerId, name: record.name });
      index.sites.sort((a, b) => {
        const aa = siteAddress(a.ownerId, a.name),
          bb = siteAddress(b.ownerId, b.name);
        return aa < bb ? -1 : aa > bb ? 1 : 0;
      });
      values.write(this.indexKey, index);
    }
    values.write(this.key(record.ownerId, record.name) + ":record", record);
  }
  private verified(value: Bundle, name: string, stored = false) {
    (stored ? verifyStoredBundle : verifyBundle)(value);
    const bundle = JSON.parse(canonical(value)) as Bundle;
    if (bundle.manifest.kind !== "site")
      throw new Error("Envelope de site inválido");
    const snapshot = snapshots.verify(
      (stored ? decryptStoredBundle : decryptBundle)(bundle, this.identity),
      bundle.manifest.author,
      name,
    );
    return { bundle, ...snapshot };
  }
  private fingerprint(
    bundle: Bundle,
    base: string,
    name: string,
    stored = false,
  ) {
    const { revision } = this.verified(bundle, name, stored);
    return hash(
      canonical({
        domain: "relayloom/site-publication-command/1",
        ownerId: bundle.manifest.author.id,
        name,
        number: revision.body.number,
        expectedBase: base,
        documentHash: revision.body.documentHash,
        readers:
          bundle.manifest.publicKey !== null
            ? "public"
            : {
                ids: bundle.manifest.keys.map((k) => k.reader).sort(),
                envelope: bundle.manifest.id,
              },
      }),
    );
  }
  private stage(values: SitePrivateRecords, record: SiteRecord): Bundle | null {
    const pending = record.operations.find(
        (o) => o.phase === "prepared" || o.phase === "committed",
      ),
      stored = values.read(this.key(record.ownerId, record.name) + ":stage");
    if (!pending) {
      insist(stored === null, "Preparação de site sem operação pendente");
      return null;
    }
    insist(
      record.ownerId === this.identity.public.id &&
        exactShape(stored, ["domain", "bundle"]) &&
        (stored as any).domain === "relayloom/site-stage/1",
      "Preparação privada de site inválida ou ausente",
    );
    try {
      const { bundle, revision } = this.verified(
        (stored as any).bundle,
        record.name,
        true,
      );
      insist(
        bundle.manifest.id === pending.bundleId &&
          same(revision, pending.revision) &&
          this.fingerprint(bundle, pending.expectedBase, record.name, true) ===
            pending.fingerprint,
        "Preparação de site não corresponde à operação",
      );
      return bundle;
    } catch (error) {
      if (error instanceof RegistryIntegrityError) throw error;
      throw new RegistryIntegrityError("Preparação de site corrompida");
    }
  }
  state(ownerId: string, name: string) {
    return this.run((values, index) => {
      const record = this.record(values, index, ownerId, name),
        selected = registry.state(record);
      return {
        ...selected,
        base: registry.baseHash(record),
        bundleHints: record.headers
          .filter((h) => selected.heads.some((s) => s.id === h.revision.id))
          .map((h) => ({ revisionId: h.revision.id, bundles: [...h.bundles] })),
        pending: record.operations
          .filter((o) => o.phase === "prepared" || o.phase === "committed")
          .map(summary),
      };
    });
  }
  prepare(
    name: string,
    input: { expectedBase: string; operationId: string; bundle: Bundle },
  ) {
    if (!exactShape(input, ["expectedBase", "operationId", "bundle"]))
      throw new Error("Pedido de publicação inválido");
    // Historical verification can recover an existing outcome after its TTL.
    // A new admission must still pass the ordinary wall-clock check below.
    const { bundle, revision } = this.verified(input.bundle, name, true);
    if (bundle.manifest.author.id !== this.identity.public.id)
      throw new Error("Só o proprietário pode preparar a publicação");
    const fingerprint = this.fingerprint(
      bundle,
      input.expectedBase,
      name,
      true,
    );
    return this.run((values, index) => {
      const record = this.record(values, index, this.identity.public.id, name);
      const retained = registry.lookup(
        record,
        revision.body.number,
        input.operationId,
        fingerprint,
      );
      if (retained) return summary(retained);
      verifyBundle(bundle);
      const result = registry.begin(record, {
        sequence: revision.body.number,
        operationId: input.operationId,
        fingerprint,
        expectedBase: input.expectedBase,
        revision,
        bundleId: bundle.manifest.id,
      });
      if (result.created) {
        values.write(this.key(record.ownerId, name) + ":stage", {
          domain: "relayloom/site-stage/1",
          bundle,
        });
        this.save(values, index, result.record);
      }
      return summary(result.operation);
    });
  }
  private transition(
    name: string,
    handle: SiteOperationHandle,
    kind: "commit" | "cancel" | "markReady",
  ) {
    return this.run((values, index) => {
      const record = this.record(values, index, this.identity.public.id, name);
      const result = registry[kind](
        record,
        handle.sequence,
        handle.operationId,
        handle.fingerprint,
      );
      if (!same(record, result.record)) {
        if (!["prepared", "committed"].includes(result.operation.phase))
          values.remove(this.key(record.ownerId, name) + ":stage");
        this.save(values, index, result.record);
      }
      return summary(result.operation);
    });
  }
  commit(name: string, handle: SiteOperationHandle) {
    return this.transition(name, handle, "commit");
  }
  cancel(name: string, handle: SiteOperationHandle) {
    return this.transition(name, handle, "cancel");
  }
  /** Called only after the application has copied and verified this bundle. */
  markReady(name: string, handle: SiteOperationHandle) {
    return this.transition(name, handle, "markReady");
  }
  /** This read occurs in its own completed transaction after authorization. A
   * prepared, cancelled or superseded bundle is never returned for publication. */
  authorizedBundle(name: string, handle: SiteOperationHandle): Bundle {
    const bundle = this.run((values, index) => {
      const record = this.record(values, index, this.identity.public.id, name),
        operation = registry.lookup(
          record,
          handle.sequence,
          handle.operationId,
          handle.fingerprint,
        );
      if (operation?.phase !== "committed")
        throw new Error("Publicação sem autorização durável pendente de cópia");
      return this.stage(values, record)!;
    });
    verifyBundle(bundle);
    return bundle;
  }
  observe(value: Bundle, name: string) {
    const { bundle, revision } = this.verified(value, name);
    return this.run((values, index) => {
      const record = this.record(values, index, revision.body.owner.id, name),
        next = registry.observe(record, revision, bundle.manifest.id);
      if (!same(record, next)) this.save(values, index, next);
      return {
        address: siteAddress(next.ownerId, name),
        revisionId: revision.id,
      };
    });
  }
  pending() {
    return this.run((values, index) =>
      index.sites
        .filter((e) => e.ownerId === this.identity.public.id)
        .flatMap((entry) => {
          const record = this.record(values, index, entry.ownerId, entry.name);
          return record.operations
            .filter((o) => o.phase === "prepared" || o.phase === "committed")
            .map((o) => ({ name: entry.name, ...summary(o) }));
        }),
    );
  }
}
