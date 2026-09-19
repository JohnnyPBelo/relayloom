import {
  siteResourceBlocks,
  type SiteDocument,
} from "../../../../packages/content/src/site";
import { canonical } from "../../../../packages/core/src/protocol";
import type { API } from "../api";
import type { PublicIdentity } from "../../../../packages/core/src/protocol";
import type { DisplayObject } from "../../../../packages/content/src/types";
import {
  parseSiteResource,
  matchSiteResource,
  resourceScopeCoversSite,
  parseSiteResourceReference,
  type SiteResource,
  type SiteResourceReference,
  type SiteReadScope,
} from "../../../../packages/content/src/site-resource";
import type {
  ResourceCreationRequest,
  ResourceCreationRecord,
  ResourceOperation,
} from "../../../../packages/sites/src/resource-operations";

export interface ResourceEntry {
  reference: SiteResourceReference;
  author: PublicIdentity;
  scope: SiteReadScope;
  expires: number;
  created: number;
  pinned: boolean;
  withdrawn: boolean;
}
/** Local, authenticated history only. This never asks peers for optional data. */
export async function loadResourceLibrary(
  api: API,
  active: () => boolean,
): Promise<ResourceEntry[]> {
  const result = new Map<string, ResourceEntry>();
  const cursors = new Set<string>();
  let before: string | undefined;
  for (let page = 0; page < 1024; page++) {
    const response = await api("history", before ? { before } : {});
    if (!active()) throw Error("Sessão de recursos encerrada");
    for (const object of response.objects as DisplayObject[]) {
      if (object.kind !== "site-resource") continue;
      const c = object.content;
      if (c.domain !== "relayloom/site-resource-summary/1")
        throw Error("Resumo do recurso inválido");
      const reference = parseSiteResourceReference({
        domain: "relayloom/site-resource-reference/1",
        bundleId: object.id,
        authorId: object.author.id,
        name: c.name,
        kind: c.kind,
        mime: c.mime,
        bytes: c.bytes,
        payloadHash: c.payloadHash,
      });
      result.set(object.id, {
        reference,
        author: object.author,
        scope: object.public ? "public" : [...object.readers].sort(),
        expires: object.expires,
        created: object.created,
        pinned: object.pinned,
        withdrawn: object.deleted === true,
      });
    }
    if (!response.history.hasMore)
      return [...result.values()].sort(
        (a, b) =>
          b.created - a.created ||
          b.reference.bundleId.localeCompare(a.reference.bundleId),
      );
    before = response.history.nextBefore;
    if (!before || cursors.has(before))
      throw Error("O histórico mudou; actualiza a lista");
    cursors.add(before);
  }
  throw Error("O histórico excede o limite de armazenamento");
}

/** One user decision, one UUID. A lost response is queried, never replaced by a
 * fresh signature. Reopening the library loads actual journal/store outcomes. */
export class ResourceCreator {
  private pending?: ResourceCreationRequest;
  constructor(
    private api: API,
    private ownerId: string,
    private active: () => boolean,
  ) {}
  private ensure() {
    if (!this.active()) throw Error("Sessão de recursos encerrada");
  }
  get uncertain() {
    return this.pending !== undefined;
  }
  async state(): Promise<ResourceCreationRecord> {
    this.ensure();
    const state = await this.api("resource-command", { action: "state" });
    this.ensure();
    if (state.ownerId !== this.ownerId)
      throw Error("Proprietário do recurso mudou");
    return state;
  }
  async create(content: SiteResource, scope: SiteReadScope, ttlMs: number) {
    this.ensure();
    if (this.pending)
      throw Error("Confirma primeiro o resultado da tentativa anterior.");
    const state = await this.state();
    if (state.operations.some((op) => op.phase === "copy-pending"))
      throw Error("Conclui primeiro o recurso que está por guardar.");
    this.pending = {
      sequence: state.nextSequence,
      operationId: crypto.randomUUID(),
      content: parseSiteResource(content),
      recipients: scope === "public" ? scope : [...scope].sort(),
      ttlMs,
    };
    return this.send();
  }
  private accepted(
    operation: ResourceOperation,
    request: ResourceCreationRequest,
  ) {
    if (
      !operation ||
      operation.sequence !== request.sequence ||
      operation.operationId !== request.operationId ||
      !["copy-pending", "ready", "expired"].includes(operation.phase) ||
      operation.ttlMs !== request.ttlMs ||
      canonical(operation.recipients) !== canonical(request.recipients)
    )
      throw Error("O resultado não corresponde à tentativa de criação.");
    matchSiteResource(operation.reference, request.content, {
      id: operation.reference.bundleId,
      authorId: this.ownerId,
      kind: "site-resource",
    });
    return operation;
  }
  private async send(): Promise<{
    operation: ResourceOperation;
    error?: string;
  }> {
    this.ensure();
    const request = this.pending!;
    try {
      const result = await this.api("resource-command", {
        action: "create",
        ...request,
      });
      this.ensure();
      this.accepted(result.operation, request);
      this.pending = undefined;
      return result;
    } catch (error) {
      this.ensure();
      try {
        const known = await this.api("resource-command", {
          action: "operation",
          sequence: request.sequence,
          operationId: request.operationId,
        });
        this.ensure();
        if (known.operation) {
          this.accepted(known.operation, request);
          this.pending = undefined;
          return { operation: known.operation };
        }
      } catch {
        this.ensure();
      }
      throw error;
    }
  }
  async retry() {
    this.ensure();
    if (!this.pending) throw Error("Não há uma tentativa por confirmar.");
    const state = await this.state(),
      request = this.pending;
    const prior = state.operations.find(
      (op) => op.sequence === request.sequence,
    );
    if (prior) {
      if (prior.operationId !== request.operationId)
        throw Error(
          "A sequência pertence a outra tentativa. Consulta o arquivo antes de criar outra cópia.",
        );
      this.accepted(prior, request);
      this.pending = undefined;
      return this.resume(prior);
    }
    if (state.nextSequence !== request.sequence)
      throw Error(
        "O resultado antigo já não está no histórico. Não foi criada outra cópia.",
      );
    return this.send();
  }
  async resume(operation: ResourceOperation) {
    this.ensure();
    const result = await this.api("resource-command", {
      action: "resume",
      sequence: operation.sequence,
      operationId: operation.operationId,
    });
    this.ensure();
    return result as { operation: ResourceOperation; error?: string };
  }
}

/** UI preflight happens before a publication intent is recorded. The runtime
 * repeats these checks atomically before any new signature. */
export async function validateResourcePublication(
  site: SiteDocument,
  scope: SiteReadScope,
  api: API,
  active: () => boolean,
) {
  const refs = siteResourceBlocks(site);
  if (!refs.length) return;
  const entries = await loadResourceLibrary(api, active),
    byId = new Map(entries.map((e) => [e.reference.bundleId, e]));
  for (const { reference } of refs) {
    const entry = byId.get(reference.bundleId);
    if (!entry || entry.expires <= Date.now())
      throw Error(
        "Um recurso deste site já não está disponível. Actualiza a referência antes de publicar.",
      );
    if (entry.withdrawn)
      throw Error(
        "O autor retirou um recurso deste site. Remove ou substitui a referência.",
      );
    if (canonical(entry.reference) !== canonical(reference))
      throw Error(
        "Uma referência deste site não corresponde ao recurso guardado.",
      );
    if (!resourceScopeCoversSite(scope, entry.scope))
      throw Error(
        "Um recurso não permite todos os leitores escolhidos. Ajusta a privacidade do site ou escolhe outro recurso.",
      );
  }
}

export function formatResourceBytes(bytes: number, language: string) {
  if (bytes < 1024) return new Intl.NumberFormat(language).format(bytes) + " B";
  const unit = bytes < 1024 * 1024 ? "KiB" : "MiB",
    divisor = unit === "KiB" ? 1024 : 1024 * 1024;
  return (
    new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(
      bytes / divisor,
    ) +
    " " +
    unit
  );
}
