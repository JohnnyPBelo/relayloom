import { siteResourceBlocks } from "../../content/src/site";
import {
  canonical,
  exactShape,
  type Bundle,
  type PublicIdentity,
} from "../../core/src/protocol";
import { BrowserProfile } from "./profile";
import { verifiedBundle, verifiedStoredBundle } from "./crypto";
import { browserCertificateCrypto } from "./certificate-crypto";
import {
  createSiteRegistry,
  type SiteRecord,
  type SiteOperation,
} from "../../sites/src/registry";
import { createSiteContentProtocol } from "../../sites/src/content";
import { siteAddress } from "../../sites/src/protocol";
import {
  createSiteRequestProtocol,
  type SitePublicationRequest,
} from "../../sites/src/request";
const hash = browserCertificateCrypto.hash;
class RegistryIntegrityError extends Error {}
class RegistryCapacityError extends Error {}
interface Values {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): void;
  remove(key: string): Promise<void>;
  keys(prefix?: string): string[];
}
export const SITE_CATALOG_LIMITS = Object.freeze({ sites: 64 });
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
const registry = createSiteRegistry(browserCertificateCrypto),
  snapshots = createSiteContentProtocol(browserCertificateCrypto),
  requests = createSiteRequestProtocol(browserCertificateCrypto);
const summary = (operation: SiteOperation) => ({
  sequence: operation.sequence,
  operationId: operation.operationId,
  fingerprint: operation.fingerprint,
  bundleId: operation.bundleId,
  phase: operation.phase,
  requested: operation.requestFingerprint !== undefined,
});
function insist(value: unknown, message: string): asserts value {
  if (!value) throw new RegistryIntegrityError(message);
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** Persistent local catalog. Every public method returns only after the actual
 * database transaction completes; no callback receives an authorized bundle
 * before commit. The application still owns copying/serving the public bundle,
 * transport resolution, UI integration and consent. */
export class BrowserSiteCatalog {
  private readonly indexKey: string;
  private readonly owner: PublicIdentity;
  private readonly generation: number;
  constructor(private readonly profile: BrowserProfile) {
    const owner = profile.identity;
    if (!owner) throw new Error("Desbloqueia a identidade");
    this.owner = owner;
    this.generation = profile.sessionGeneration;
    this.indexKey =
      "site:" +
      hash(
        canonical({
          domain: "relayloom/local-site-catalog-key/1",
          owner: this.owner.id,
        }),
      ) +
      ":record";
  }
  private ensure() {
    if (
      this.profile.sessionGeneration !== this.generation ||
      canonical(this.profile.identity) !== canonical(this.owner)
    )
      throw new Error("Sessão de site bloqueada");
  }
  private async run<T>(
    fn: (values: Values, index: Index) => Promise<T>,
  ): Promise<T> {
    this.ensure();
    return this.profile.transactValues(async (tx) => {
      this.ensure();
      const values: Values = {
        read: (key) => tx.get(key),
        write: (key, value) => tx.set(key, value),
        remove: (key) => tx.remove(key),
        keys: (prefix) => tx.keys(prefix),
      };
      const stored = await values.read(this.indexKey);
      if (stored === null) {
        insist(
          values.keys("site:").length === 0,
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
        const address = siteAddress(entry.ownerId, entry.name);
        insist(previous < address, "Catálogo de sites repetido ou desordenado");
        previous = address;
      }
      return fn(values, index);
    });
  }
  private key(ownerId: string, name: string) {
    return registry.recordKey(ownerId, name);
  }
  private async record(
    values: Values,
    index: Index,
    ownerId: string,
    name: string,
  ) {
    const key = this.key(ownerId, name),
      known = index.sites.some((e) => e.ownerId === ownerId && e.name === name),
      data = await values.read(key + ":record");
    if (!known) {
      insist(
        data === null && (await values.read(key + ":stage")) === null,
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
    const stage = await this.stage(values, record);
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
      await values.remove(this.key(ownerId, name) + ":stage");
      await this.save(values, index, record);
    }
    return record;
  }
  private async save(values: Values, index: Index, record: SiteRecord) {
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
      await values.write(this.indexKey, index);
    }
    await values.write(
      this.key(record.ownerId, record.name) + ":record",
      record,
    );
  }
  private async verified(value: Bundle, name: string, stored = false) {
    this.ensure();
    const bundle = await (stored ? verifiedStoredBundle : verifiedBundle)(
      value,
    );
    if (bundle.manifest.kind !== "site")
      throw new Error("Envelope de site inválido");
    const snapshot = snapshots.verify(
      await (stored
        ? this.profile.decryptStaging(bundle)
        : this.profile.decrypt(bundle)),
      bundle.manifest.author,
      name,
    );
    this.ensure();
    return { bundle, ...snapshot };
  }
  private async fingerprint(
    bundle: Bundle,
    base: string,
    name: string,
    stored = false,
  ) {
    const { revision } = await this.verified(bundle, name, stored);
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
  private async stage(
    values: Values,
    record: SiteRecord,
  ): Promise<Bundle | null> {
    const pending = record.operations.find(
        (o) => o.phase === "prepared" || o.phase === "committed",
      ),
      stored = await values.read(
        this.key(record.ownerId, record.name) + ":stage",
      );
    if (!pending) {
      insist(stored === null, "Preparação de site sem operação pendente");
      return null;
    }
    insist(
      record.ownerId === this.owner.id &&
        (exactShape(stored, ["domain", "bundle"]) ||
          exactShape(stored, ["domain", "bundle", "request"])) &&
        (stored as any).domain === "relayloom/site-stage/1",
      "Preparação privada de site inválida ou ausente",
    );
    try {
      const { bundle, revision, content } = await this.verified(
        (stored as any).bundle,
        record.name,
        true,
      );
      insist(
        bundle.manifest.id === pending.bundleId &&
          same(revision, pending.revision) &&
          (await this.fingerprint(
            bundle,
            pending.expectedBase,
            record.name,
            true,
          )) === pending.fingerprint,
        "Preparação de site não corresponde à operação",
      );
      if (pending.requestFingerprint !== undefined) {
        const contextFields = [
          "sequence",
          "operationId",
          "expectedBase",
          "readers",
          "ttlMs",
        ];
        insist(
          exactShape((stored as any).request, contextFields) ||
            exactShape((stored as any).request, [
              ...contextFields,
              "confirmedHeads",
            ]),
          "Contexto do pedido guardado inválido",
        );
        const { siteRevision: _, ...payload } = content;
        const parsed = requests.normalize(bundle.manifest.author, record.name, {
          ...(stored as any).request,
          payload,
        });
        insist(
          parsed.fingerprint === pending.requestFingerprint &&
            same(parsed.context, (stored as any).request) &&
            parsed.context.sequence === pending.sequence &&
            parsed.context.operationId === pending.operationId &&
            parsed.context.expectedBase === pending.expectedBase &&
            bundle.manifest.expires - bundle.manifest.created >=
              parsed.context.ttlMs &&
            bundle.manifest.expires - bundle.manifest.created <=
              parsed.context.ttlMs + 10 &&
            same(
              parsed.context.readers === "public"
                ? "public"
                : parsed.context.readers.map((r) => r.id).sort(),
              bundle.manifest.publicKey !== null
                ? "public"
                : bundle.manifest.keys.map((k) => k.reader).sort(),
            ),
          "Pedido guardado não corresponde à preparação",
        );
      } else
        insist(
          !Object.hasOwn(stored as object, "request"),
          "Pedido sem operação correspondente",
        );
      return bundle;
    } catch (error) {
      if (error instanceof RegistryIntegrityError) throw error;
      throw new RegistryIntegrityError("Preparação de site corrompida");
    }
  }
  state(ownerId: string, name: string) {
    return this.run(async (values, index) => {
      const record = await this.record(values, index, ownerId, name),
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
  history(ownerId: string, name: string) {
    return this.run(async (values, index) =>
      structuredClone(
        (await this.record(values, index, ownerId, name)).headers,
      ),
    );
  }
  operation(name: string, sequence: number, operationId: string) {
    return this.run(async (values, index) => {
      const record = await this.record(values, index, this.owner.id, name);
      const found = record.operations.find((o) => o.sequence === sequence);
      const result = registry.lookup(
        record,
        sequence,
        operationId,
        found?.fingerprint ?? "0".repeat(64),
      );
      return result ? summary(result) : null;
    });
  }
  /** The logical UI request and its freshly signed snapshot/cipher share one
   * durable preparation. Replays are resolved before creating any new bytes. */
  createPublication(
    name: string,
    input: SitePublicationRequest,
    validateResources?: (
      request: ReturnType<typeof requests.normalize>,
      readValue: (key: string) => Promise<unknown>,
    ) => Promise<void>,
  ) {
    const request = requests.normalize(this.owner, name, input);
    return this.run(async (values, index) => {
      const record = await this.record(values, index, this.owner.id, name);
      const found = record.operations.find(
        (o) => o.sequence === request.context.sequence,
      );
      const prior = registry.lookup(
        record,
        request.context.sequence,
        request.context.operationId,
        found?.fingerprint ?? "0".repeat(64),
      );
      if (prior) {
        if (prior.requestFingerprint !== request.fingerprint)
          throw new Error(
            "A operação já foi usada para outro pedido de publicação",
          );
        return summary(prior);
      }
      const current = registry.state(record);
      if (current.status === "conflict" || request.context.confirmedHeads) {
        if (
          !request.context.confirmedHeads ||
          !same(
            request.context.confirmedHeads,
            current.heads.map((h) => h.id).sort(),
          )
        )
          throw new Error(
            "Confirma explicitamente as versões concorrentes antes de publicar",
          );
      }
      if (
        request.context.sequence !== current.nextSequence ||
        request.context.expectedBase !== registry.baseHash(record)
      )
        throw new Error("O site mudou desde que começaste a editar");
      if (
        record.operations.some(
          (o) => o.phase === "prepared" || o.phase === "committed",
        )
      )
        throw new Error("Conclui ou cancela a publicação pendente");
      if (siteResourceBlocks(request.payload.site).length) {
        if (!validateResources)
          throw new Error(
            "As referências de recursos precisam de verificação antes de publicar",
          );
        await validateResources(request, (key) => values.read(key));
      }
      const bundle = await this.profile.signSiteBundle(
        name,
        request.context.sequence,
        current.heads
          .map((h) => h.id)
          .sort()
          .slice(0, 16),
        request.payload,
        request.context.readers,
        request.context.ttlMs,
      );
      const content = (await this.verified(bundle, name)).content;
      const result = registry.begin(record, {
        sequence: request.context.sequence,
        operationId: request.context.operationId,
        expectedBase: request.context.expectedBase,
        fingerprint: await this.fingerprint(
          bundle,
          request.context.expectedBase,
          name,
        ),
        revision: content.siteRevision,
        bundleId: bundle.manifest.id,
        requestFingerprint: request.fingerprint,
      });
      await values.write(this.key(record.ownerId, name) + ":stage", {
        domain: "relayloom/site-stage/1",
        bundle,
        request: request.context,
      });
      await this.save(values, index, result.record);
      return summary(result.operation);
    });
  }
  async prepare(
    name: string,
    input: { expectedBase: string; operationId: string; bundle: Bundle },
  ) {
    if (!exactShape(input, ["expectedBase", "operationId", "bundle"]))
      throw new Error("Pedido de publicação inválido");
    // Historical verification can recover an existing outcome after its TTL.
    // A new admission must still pass the ordinary wall-clock check below.
    const { bundle, revision } = await this.verified(input.bundle, name, true);
    if (bundle.manifest.author.id !== this.owner.id)
      throw new Error("Só o proprietário pode preparar a publicação");
    const fingerprint = await this.fingerprint(
      bundle,
      input.expectedBase,
      name,
      true,
    );
    return this.run(async (values, index) => {
      const record = await this.record(values, index, this.owner.id, name);
      const retained = registry.lookup(
        record,
        revision.body.number,
        input.operationId,
        fingerprint,
      );
      if (retained) return summary(retained);
      await verifiedBundle(bundle);
      const result = registry.begin(record, {
        sequence: revision.body.number,
        operationId: input.operationId,
        fingerprint,
        expectedBase: input.expectedBase,
        revision,
        bundleId: bundle.manifest.id,
      });
      if (result.created) {
        await values.write(this.key(record.ownerId, name) + ":stage", {
          domain: "relayloom/site-stage/1",
          bundle,
        });
        await this.save(values, index, result.record);
      }
      return summary(result.operation);
    });
  }
  private transition(
    name: string,
    handle: SiteOperationHandle,
    kind: "commit" | "cancel" | "markReady",
  ) {
    return this.run(async (values, index) => {
      const record = await this.record(values, index, this.owner.id, name);
      const result = registry[kind](
        record,
        handle.sequence,
        handle.operationId,
        handle.fingerprint,
      );
      if (!same(record, result.record)) {
        if (!["prepared", "committed"].includes(result.operation.phase))
          await values.remove(this.key(record.ownerId, name) + ":stage");
        await this.save(values, index, result.record);
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
  async authorizedBundle(
    name: string,
    handle: SiteOperationHandle,
  ): Promise<Bundle> {
    const bundle = await this.run(async (values, index) => {
      const record = await this.record(values, index, this.owner.id, name),
        operation = registry.lookup(
          record,
          handle.sequence,
          handle.operationId,
          handle.fingerprint,
        );
      if (operation?.phase !== "committed")
        throw new Error("Publicação sem autorização durável pendente de cópia");
      return (await this.stage(values, record))!;
    });
    await verifiedBundle(bundle);
    return bundle;
  }
  preparationAccess(name: string, handle: SiteOperationHandle) {
    return this.run(async (values, index) => {
      const record = await this.record(values, index, this.owner.id, name);
      const operation = registry.lookup(
        record,
        handle.sequence,
        handle.operationId,
        handle.fingerprint,
      );
      if (!operation || !["prepared", "committed"].includes(operation.phase))
        return null;
      const bundle = (await this.stage(values, record))!;
      return {
        readers:
          bundle.manifest.publicKey !== null
            ? ("public" as const)
            : bundle.manifest.keys.map((k) => k.reader),
      };
    });
  }
  async observe(value: Bundle, name: string) {
    const { bundle, revision } = await this.verified(value, name);
    return this.run(async (values, index) => {
      const record = await this.record(
          values,
          index,
          revision.body.owner.id,
          name,
        ),
        next = registry.observe(record, revision, bundle.manifest.id);
      if (!same(record, next)) await this.save(values, index, next);
      return {
        address: siteAddress(next.ownerId, name),
        revisionId: revision.id,
      };
    });
  }
  pending() {
    return this.run(async (values, index) => {
      const result: (ReturnType<typeof summary> & { name: string })[] = [];
      for (const entry of index.sites.filter(
        (e) => e.ownerId === this.owner.id,
      )) {
        const record = await this.record(
          values,
          index,
          entry.ownerId,
          entry.name,
        );
        for (const operation of record.operations)
          if (["prepared", "committed"].includes(operation.phase))
            result.push({ name: entry.name, ...summary(operation) });
      }
      return result;
    });
  }
}
