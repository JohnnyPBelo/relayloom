import {
  exactShape,
  type Bundle,
  type Identity,
  type PublicIdentity,
} from "../../../packages/core/src/protocol";
import {
  canonical,
  decryptBundle,
  ContentStore,
} from "../../../packages/core/src/index";
import { nodeCertificateCrypto } from "../../../packages/core/src/certificate-crypto";
import {
  NodeSiteCatalog,
  type SiteOperationHandle,
} from "../../../packages/sites/src/catalog";
import { createSiteContentProtocol } from "../../../packages/sites/src/content";
import {
  parseSiteAddress,
  siteAddress,
} from "../../../packages/sites/src/protocol";
import { validateContent } from "./content-validation";
import type {
  Content,
  DisplayObject,
} from "../../../packages/content/src/types";
const snapshots = createSiteContentProtocol(nodeCertificateCrypto);
type Operation = NonNullable<ReturnType<NodeSiteCatalog["operation"]>>;

/** A reader can relay opaque private envelopes; readable versioned sites must
 * also bind their inner certificate to the external signing owner and payload. */
export function inspectSite(bundle: Bundle, identity?: Identity) {
  if (bundle.manifest.kind !== "site") return null;
  if (
    bundle.manifest.publicKey === null &&
    !bundle.manifest.keys.some((k) => k.reader === identity?.public.id)
  )
    return null;
  const content = decryptBundle(bundle, identity) as Content;
  validateContent(content);
  if (content.type !== "site") throw new Error("Conteúdo de site inválido");
  if (!Object.hasOwn(content, "siteRevision")) return null;
  return snapshots.verify(content, bundle.manifest.author);
}
interface Context {
  identity: Identity;
  catalog: NodeSiteCatalog;
  store: ContentStore;
  blocked(): readonly string[];
  readers(ids: unknown): PublicIdentity[] | "public";
  publish(bundle: Bundle): void;
  request(ids: string[]): void;
}
/** The same local profile owns commands and recovery. No central content host
 * or alternate transport is introduced; bundles travel on the existing router. */
export class SiteRuntime {
  private initialized = false;
  private pending = new Map<string, { name: string; operation: Operation }>();
  private nextRetry = 0;
  lastError = "";
  constructor(private readonly context: Context) {}
  private slot(name: string, operation: SiteOperationHandle) {
    return name + ":" + operation.sequence;
  }
  private initialize() {
    if (this.initialized) return;
    for (const manifest of this.context.store.list()) {
      if (
        manifest.kind !== "site" ||
        this.context.blocked().includes(manifest.author.id)
      )
        continue;
      let bundle: Bundle, parsed: ReturnType<typeof inspectSite>;
      try {
        bundle = this.context.store.get(manifest.id, false);
        parsed = inspectSite(bundle, this.context.identity);
      } catch {
        continue;
      }
      if (parsed)
        this.context.catalog.observe(bundle, parsed.revision.body.name);
    }
    this.pending.clear();
    for (const item of this.context.catalog.pending())
      this.pending.set(this.slot(item.name, item), {
        name: item.name,
        operation: item,
      });
    this.initialized = true;
  }
  receive(bundle: Bundle) {
    const parsed = inspectSite(bundle, this.context.identity);
    if (parsed) this.context.catalog.observe(bundle, parsed.revision.body.name);
  }
  private current(name: string, handle: SiteOperationHandle) {
    const operation = this.context.catalog.operation(
      name,
      handle.sequence,
      handle.operationId,
    );
    if (!operation || operation.fingerprint !== handle.fingerprint)
      throw new Error("Operação de site desconhecida");
    return operation;
  }
  private finish(name: string, handle: SiteOperationHandle) {
    let operation = this.current(name, handle);
    const access = this.context.catalog.preparationAccess(name, operation);
    if (
      access?.readers !== "public" &&
      access?.readers.some((id) => this.context.blocked().includes(id))
    ) {
      this.lastError =
        "A publicação está em pausa porque um leitor foi bloqueado.";
      return { operation, error: this.lastError };
    }
    if (operation.phase === "prepared")
      operation = this.context.catalog.commit(name, operation);
    if (operation.phase === "committed") {
      const bundle = this.context.catalog.authorizedBundle(name, operation);
      this.context.store.put(bundle, true);
      const stored = this.context.store.get(bundle.manifest.id, false);
      if (canonical(stored) !== canonical(bundle))
        throw new Error("A cópia do site não corresponde à publicação");
      operation = this.context.catalog.markReady(name, operation);
      this.context.publish(stored);
    }
    if (!["prepared", "committed"].includes(operation.phase))
      this.pending.delete(this.slot(name, operation));
    this.lastError = "";
    return { operation };
  }
  status() {
    return { pending: this.pending.size, error: this.lastError };
  }
  tick() {
    if (Date.now() < this.nextRetry) return;
    this.nextRetry = Date.now() + 5000;
    try {
      this.initialize();
      const next = [...this.pending.values()].find(
        (p) => p.operation.phase === "committed" || p.operation.requested,
      );
      if (next) {
        // Move to the back so one full-cache/blocked operation cannot starve another.
        const key = this.slot(next.name, next.operation);
        this.pending.delete(key);
        this.pending.set(key, next);
        const result = this.finish(next.name, next.operation);
        this.lastError = result.error ?? "";
      }
    } catch (error) {
      this.lastError = (error as Error).message;
    }
  }
  private parseAddress(address: unknown) {
    const parsed = parseSiteAddress(address);
    if (this.context.blocked().includes(parsed.ownerId))
      throw new Error("Contacto bloqueado");
    return parsed;
  }
  private resolve(address: string, revisionId?: string) {
    const { ownerId, name } = this.parseAddress(address),
      state = this.context.catalog.state(ownerId, name);
    if (revisionId !== undefined && !/^[a-f0-9]{64}$/.test(revisionId))
      throw new Error("Revisão inválida");
    if (!revisionId && state.status === "conflict")
      return { status: "conflict", address, state };
    const chosen = revisionId ?? state.heads[0]?.id;
    if (!chosen) return { status: "pending", address, state };
    const header = this.context.catalog
      .history(ownerId, name)
      .find((h) => h.revision.id === chosen);
    if (!header)
      return { status: "unknown-revision", address, revisionId: chosen, state };
    const candidates = [
      ...new Set([
        ...header.bundles,
        ...this.context.store
          .list()
          .filter((m) => m.kind === "site" && m.author.id === ownerId)
          .map((m) => m.id),
      ]),
    ];
    for (const id of candidates) {
      try {
        const bundle = this.context.store.get(id),
          parsed = inspectSite(bundle, this.context.identity);
        if (
          !parsed ||
          parsed.revision.id !== chosen ||
          bundle.manifest.author.id !== ownerId ||
          parsed.revision.body.name !== name
        )
          continue;
        const object: DisplayObject = {
          id,
          author: bundle.manifest.author,
          kind: "site",
          created: bundle.manifest.created,
          expires: bundle.manifest.expires,
          content: parsed.content,
          pinned: this.context.store.isPinned(id),
          readers: bundle.manifest.keys.map((k) => k.reader),
          public: bundle.manifest.publicKey !== null,
        };
        return {
          status: "available",
          address,
          revisionId: chosen,
          object,
          state,
        };
      } catch {
        /* A retained head is not proof that its payload is still available. */
      }
    }
    this.context.request(header.bundles);
    return { status: "pending", address, revisionId: chosen, state };
  }
  command(value: any): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Comando de site inválido");
    if (value.action === "operation" || value.action === "cancel") {
      if (!exactShape(value, ["action", "name", "sequence", "operationId"]))
        throw new Error("Comando de site inválido");
      const operation = this.context.catalog.operation(
        value.name,
        value.sequence,
        value.operationId,
      );
      if (value.action === "operation" || !operation) return { operation };
      const cancelled = this.context.catalog.cancel(value.name, operation);
      if (cancelled.phase === "cancelled")
        this.pending.delete(this.slot(value.name, cancelled));
      return { operation: cancelled };
    }
    this.initialize();
    if (value.action === "state" || value.action === "history") {
      if (!exactShape(value, ["action", "address"]))
        throw new Error("Comando de site inválido");
      const { ownerId, name } = this.parseAddress(value.address);
      return value.action === "state"
        ? this.context.catalog.state(ownerId, name)
        : {
            address: value.address,
            revisions: this.context.catalog.history(ownerId, name),
          };
    }
    if (value.action === "resolve") {
      if (
        !exactShape(value, ["action", "address"]) &&
        !exactShape(value, ["action", "address", "revisionId"])
      )
        throw new Error("Comando de site inválido");
      return this.resolve(value.address, value.revisionId);
    }
    if (value.action === "resume") {
      if (!exactShape(value, ["action", "name", "sequence", "operationId"]))
        throw new Error("Comando de site inválido");
      const operation = this.context.catalog.operation(
        value.name,
        value.sequence,
        value.operationId,
      );
      if (!operation) throw new Error("Operação de site desconhecida");
      return this.finish(value.name, operation);
    }
    const publicationFields = [
      "action",
      "name",
      "sequence",
      "operationId",
      "expectedBase",
      "payload",
      "recipients",
      "ttlMs",
    ];
    if (
      value.action !== "publish" ||
      (!exactShape(value, publicationFields) &&
        !exactShape(value, [...publicationFields, "confirmedHeads"]))
    )
      throw new Error("Comando de site inválido");
    const operation = this.context.catalog.createPublication(value.name, {
      sequence: value.sequence,
      operationId: value.operationId,
      expectedBase: value.expectedBase,
      payload: value.payload,
      readers: this.context.readers(value.recipients),
      ttlMs: value.ttlMs,
      ...(value.confirmedHeads !== undefined
        ? { confirmedHeads: value.confirmedHeads }
        : {}),
    });
    const address = siteAddress(this.context.identity.public.id, value.name);
    if (["prepared", "committed"].includes(operation.phase))
      this.pending.set(this.slot(value.name, operation), {
        name: value.name,
        operation,
      });
    try {
      return { address, ...this.finish(value.name, operation) };
    } catch (error) {
      this.lastError = (error as Error).message;
      try {
        return {
          address,
          operation: this.current(value.name, operation),
          error: this.lastError,
        };
      } catch {
        throw error;
      }
    }
  }
}
