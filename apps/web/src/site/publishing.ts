import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { canonical } from "../../../../packages/core/src/protocol";
import {
  siteAddress,
  type SiteRevision,
} from "../../../../packages/sites/src/protocol";
import {
  validateSiteEditingContext,
  type SiteEditingContext,
} from "../../../../packages/sites/src/editing";
import { siteFallback } from "../../../../packages/content/src/site";
import type { DisplayObject } from "../../../../packages/content/src/types";
import type { API } from "../api";
import { validateStudio, type StudioValue } from "./model";
export interface SiteCatalogState {
  address: string;
  base: string;
  nextSequence: number | null;
  number: number;
  status: string;
  heads: SiteRevision[];
  bundleHints: { revisionId: string; bundles: string[] }[];
  pending: SiteOperation[];
}
export interface SiteOperation {
  sequence: number;
  operationId: string;
  bundleId: string;
  phase: string;
  requested?: boolean;
}
export interface PublishingSession {
  editing?: SiteEditingContext;
  catalog: SiteCatalogState;
  defaultRecipients?: "public" | string[];
}
export interface PublishingState extends PublishingSession {
  busy: boolean;
  operation?: SiteOperation;
  message: string;
  error: string;
}
export const SITE_DEFAULT_TTL = 30 * 86400_000;
export function pendingCannotBeAdmitted(
  editing: SiteEditingContext,
  catalog: SiteCatalogState,
): boolean {
  if (
    !editing.pending ||
    catalog.address !== editing.address ||
    !/^[a-f0-9]{64}$/.test(catalog.base) ||
    !Array.isArray(catalog.pending) ||
    (catalog.nextSequence !== null &&
      (!Number.isSafeInteger(catalog.nextSequence) || catalog.nextSequence < 1))
  )
    return false;
  // Registry heads never roll back: higher generations supersede older ones,
  // same-generation forks accumulate, and expiry never removes a known head.
  // A changed authenticated base therefore rejects every delayed old request.
  return (
    (catalog.nextSequence === null ||
      catalog.nextSequence > editing.sequence ||
      catalog.base !== editing.base) &&
    !catalog.pending.some(
      (operation) => operation.operationId === editing.pending!.operationId,
    )
  );
}
const hash = (v: unknown) =>
  bytesToHex(sha256(new TextEncoder().encode(canonical(v))));
export function contextFor(
  owner: string,
  catalog: SiteCatalogState,
  previous?: SiteEditingContext,
  defaultRecipients: "public" | string[] = "public",
): SiteEditingContext {
  if (catalog.nextSequence === null)
    throw Error(
      "Este site atingiu o limite de publicações. O histórico continua disponível.",
    );
  return {
    domain: "relayloom/site-editing/1",
    address: siteAddress(owner, "profile"),
    base: catalog.base,
    sequence: catalog.nextSequence,
    recipients: previous?.recipients ?? defaultRecipients,
    ttlMs: previous?.ttlMs ?? SITE_DEFAULT_TTL,
  };
}
export function draftBody(value: StudioValue, editing?: SiteEditingContext) {
  validateStudio(value);
  return {
    blocks: siteFallback(value.site),
    theme: value.theme,
    site: value.site,
    attachments: value.attachments,
    ...(editing ? { editing } : {}),
  };
}
/** Client transaction coordinator. Its pending UUID/digest is persisted with
 * the draft before publication. A transport error is never an absent outcome. */
export class SitePublisher {
  private current: PublishingState;
  private closed = false;
  private listeners = new Set<() => void>();
  private mutation = 0;
  private observing = false;
  private observation = 0;
  constructor(
    private api: API,
    private owner: string,
    initial: PublishingSession,
    private active: () => boolean,
    private changed: (session: PublishingSession) => void,
  ) {
    this.current = {
      ...structuredClone(initial),
      busy: false,
      message: "",
      error: "",
    };
    if (this.current.editing)
      validateSiteEditingContext(this.current.editing, owner);
  }
  snapshot = () => this.current;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  close() {
    this.closed = true;
    this.listeners.clear();
  }
  report(error: Error) {
    if (!this.closed && this.active())
      this.set({ message: "", error: error.message });
  }
  private ensure() {
    if (this.closed || !this.active())
      throw Error("Sessão do estúdio bloqueada");
  }
  private set(next: Partial<PublishingState>, observation = false) {
    this.ensure();
    if (!observation) this.mutation++;
    this.current = { ...this.current, ...next };
    this.changed({
      editing: this.current.editing,
      catalog: this.current.catalog,
      defaultRecipients: this.current.defaultRecipients,
    });
    for (const fn of this.listeners) fn();
  }
  private async task<T>(run: () => Promise<T>): Promise<T> {
    this.ensure();
    if (this.current.busy) throw Error("Aguarda a operação do site em curso");
    this.set({ busy: true, message: "", error: "" });
    try {
      const result = await run();
      this.ensure();
      return result;
    } catch (e) {
      if (!this.closed && this.active())
        this.set({ error: (e as Error).message });
      throw e;
    } finally {
      if (!this.closed && this.active()) this.set({ busy: false });
    }
  }
  private async call(action: string, fields: Record<string, unknown> = {}) {
    this.ensure();
    const result = await this.api("site-command", { action, ...fields });
    this.ensure();
    return result;
  }
  private async state() {
    const catalog: SiteCatalogState = await this.call("state", {
      address: siteAddress(this.owner, "profile"),
    });
    this.set({ catalog });
    return catalog;
  }
  async sync() {
    return this.task(async () => {
      await this.state();
      const e = this.current.editing;
      const operation = e?.pending
        ? (
            await this.call("operation", {
              name: "profile",
              sequence: e.sequence,
              operationId: e.pending.operationId,
            })
          ).operation
        : undefined;
      this.set({ operation });
    });
  }
  observe() {
    this.observation++;
    if (this.observing || this.current.busy || this.closed || !this.active())
      return;
    const sequence = this.observation,
      mutation = this.mutation;
    this.observing = true;
    void this.call("state", { address: siteAddress(this.owner, "profile") })
      .then((catalog) => {
        if (
          sequence !== this.observation ||
          mutation !== this.mutation ||
          this.current.busy
        )
          return;
        if (canonical(catalog) !== canonical(this.current.catalog))
          this.set({ catalog }, true);
      })
      .catch((error) => {
        if (
          !this.closed &&
          this.active() &&
          sequence === this.observation &&
          mutation === this.mutation
        )
          this.set({ error: (error as Error).message }, true);
      })
      .finally(() => {
        this.observing = false;
        if (
          !this.closed &&
          this.active() &&
          !this.current.busy &&
          (sequence !== this.observation || mutation !== this.mutation)
        )
          this.observe();
      });
  }
  configure(recipients: "public" | string[], ttlMs: number) {
    this.ensure();
    const e = this.current.editing;
    if (this.current.busy || e?.pending)
      throw Error("Verifica a publicação pendente antes de editar");
    if (!e) throw Error("Escolhe a versão de partida antes de publicar");
    this.set({
      editing: validateSiteEditingContext(
        { ...e, recipients, ttlMs },
        this.owner,
      ),
      message: "",
      error: "",
    });
  }
  private async saveExact(value: StudioValue, editing?: SiteEditingContext) {
    this.ensure();
    await this.api("site-draft", draftBody(value, editing));
    this.ensure();
  }
  save(value: StudioValue) {
    return this.task(async () => {
      if (this.current.editing?.pending)
        throw Error("Verifica a publicação pendente antes de editar");
      await this.saveExact(structuredClone(value), this.current.editing);
      this.set({ message: "Rascunho cifrado guardado neste dispositivo" });
    });
  }
  adopt(
    value: StudioValue,
    expectedBase: string,
    recipients?: "public" | string[],
  ) {
    return this.task(async () => {
      if (this.current.editing?.pending)
        throw Error("Verifica a publicação pendente antes de editar");
      const catalog = await this.state();
      if (catalog.base !== expectedBase)
        throw Error(
          "Chegou uma nova versão durante a revisão. Actualiza e confirma novamente.",
        );
      const editing = contextFor(
        this.owner,
        catalog,
        this.current.editing,
        this.current.defaultRecipients ?? [],
      );
      if (recipients !== undefined) editing.recipients = recipients;
      validateSiteEditingContext(editing, this.owner);
      await this.saveExact(structuredClone(value), editing);
      this.set({
        editing,
        operation: undefined,
        message:
          "Versão de partida guardada. O conteúdo do rascunho foi mantido.",
      });
    });
  }
  private request(
    value: StudioValue,
    e: SiteEditingContext,
    operationId: string,
    confirmedHeads?: string[],
  ) {
    const { editing: _, ...data } = draftBody(value);
    return {
      action: "publish",
      name: "profile",
      sequence: e.sequence,
      operationId,
      expectedBase: e.base,
      payload: { type: "site", ...data },
      recipients: e.recipients,
      ttlMs: e.ttlMs,
      ...(confirmedHeads ? { confirmedHeads } : {}),
    };
  }
  private async finish(
    value: StudioValue,
    result: { operation: SiteOperation; error?: string },
  ) {
    const e = this.current.editing!;
    this.set({ operation: result.operation });
    if (result.operation.phase !== "ready")
      throw Error(
        result.error ||
          (
            {
              prepared: "Publicação preparada. Retoma para concluir.",
              committed: "Publicação autorizada. A cópia está pendente.",
              expired: "Esta tentativa expirou. Conservámos o teu rascunho.",
              cancelled:
                "A publicação foi cancelada. Conservámos o teu rascunho.",
              superseded:
                "Outra versão ultrapassou esta tentativa. Conservámos o teu rascunho.",
            } as Record<string, string>
          )[result.operation.phase] ||
          "Resultado da publicação por verificar",
      );
    const catalog = await this.state();
    const current =
      catalog.heads.length === 1 &&
      catalog.bundleHints.some(
        (h) =>
          h.revisionId === catalog.heads[0].id &&
          h.bundles.includes(result.operation.bundleId),
      );
    const { pending: _, ...previous } = e,
      editing =
        current && catalog.nextSequence !== null
          ? contextFor(this.owner, catalog, e)
          : previous;
    // If this final save loses its reply, keep the original pending handle in
    // memory/on disk. The next attempt queries the already-ready operation.
    await this.saveExact(value, editing);
    this.set({
      editing,
      operation: result.operation,
      message: current
        ? "Página assinada e publicada no armazenamento P2P"
        : "Página publicada. Chegou outra versão; compara as versões antes de voltar a publicar.",
    });
    return result;
  }
  publish(value: StudioValue, confirmedHeads?: string[]) {
    return this.task(async () => {
      const snapshot = structuredClone(value);
      validateStudio(snapshot);
      let editing = this.current.editing;
      if (!editing)
        throw Error("Escolhe a versão de partida antes de publicar");
      const created = !editing.pending;
      const operationId = editing.pending?.operationId ?? crypto.randomUUID();
      const request = this.request(
        snapshot,
        editing,
        operationId,
        editing.pending?.confirmedHeads ?? confirmedHeads,
      );
      const requestHash = hash(request);
      if (editing.pending) {
        if (editing.pending.requestHash !== requestHash)
          throw Error(
            "O rascunho não corresponde ao pedido pendente. Não foi publicada outra versão.",
          );
      } else {
        const catalog = await this.state();
        if (catalog.pending.length)
          throw Error("Conclui a publicação anterior antes de iniciar outra.");
        if (
          catalog.base !== editing.base ||
          catalog.nextSequence !== editing.sequence
        )
          throw Error(
            "O site mudou desde que começaste a editar. Compara as versões antes de publicar.",
          );
        if (
          catalog.status === "conflict" &&
          canonical(confirmedHeads ?? []) !==
            canonical(catalog.heads.map((h) => h.id).sort())
        )
          throw Error(
            "Confirma todas as versões concorrentes antes de publicar",
          );
        editing = {
          ...editing,
          pending: {
            operationId,
            requestHash,
            ...(confirmedHeads ? { confirmedHeads } : {}),
          },
        };
        this.set({ editing, operation: undefined });
      }
      // Repeating the identical encrypted draft save is safe even if its first
      // reply was lost. Never send a command until this save is acknowledged.
      try {
        await this.saveExact(snapshot, editing);
      } catch (error) {
        // This fresh UUID has not reached site-command, even if the draft save
        // reply was lost. A failed new draft save must not freeze editing.
        if (created && !this.closed && this.active()) {
          const { pending: _, ...beforeSubmission } = editing;
          this.set({ editing: beforeSubmission });
        }
        throw error;
      }
      const prior = (
        await this.call("operation", {
          name: "profile",
          sequence: editing.sequence,
          operationId,
        })
      ).operation as SiteOperation | null;
      this.set({ operation: prior ?? undefined });
      if (prior?.phase === "ready")
        return this.finish(snapshot, { operation: prior });
      if (prior && !["prepared", "committed"].includes(prior.phase))
        return this.finish(snapshot, { operation: prior });
      const result = prior
        ? await this.call("resume", {
            name: "profile",
            sequence: editing.sequence,
            operationId,
          })
        : await this.call(
            "publish",
            Object.fromEntries(
              Object.entries(request).filter(([key]) => key !== "action"),
            ),
          );
      return this.finish(snapshot, result);
    });
  }
  clearTerminal(value: StudioValue, cancel = false) {
    return this.task(async () => {
      const e = this.current.editing;
      if (!e?.pending) return;
      let operation: SiteOperation | undefined;
      let checkedCatalog: SiteCatalogState | undefined;
      try {
        operation = (
          await this.call(cancel ? "cancel" : "operation", {
            name: "profile",
            sequence: e.sequence,
            operationId: e.pending.operationId,
          })
        ).operation;
      } catch (error) {
        if (cancel) throw error;
        checkedCatalog = await this.state();
        // Its past outcome may still be unknown; never call it cancelled.
        if (!pendingCannotBeAdmitted(e, checkedCatalog)) throw error;
      }
      this.set({ operation });
      if (
        operation &&
        !["cancelled", "expired", "superseded"].includes(operation.phase)
      )
        throw Error(
          "O resultado ainda não permite abandonar esta tentativa. Verifica ou retoma a publicação.",
        );
      if (!operation) {
        checkedCatalog ??= await this.state();
        if (!pendingCannotBeAdmitted(e, checkedCatalog))
          throw Error(
            "O resultado ainda não permite abandonar esta tentativa. Verifica ou retoma a publicação.",
          );
      }
      const { pending: _, ...editing } = e;
      await this.saveExact(structuredClone(value), editing);
      await this.state();
      this.set({
        editing,
        message:
          "Tentativa encerrada. Compara as versões para criar uma nova publicação.",
      });
    });
  }
  settleRetained(action: "resume" | "cancel") {
    return this.task(async () => {
      if (this.current.editing?.pending)
        throw Error("Verifica a publicação pendente antes de editar");
      const catalog = await this.state(),
        operation = catalog.pending[0];
      if (!operation) return;
      if (
        action === "resume" &&
        operation.phase !== "committed" &&
        !operation.requested
      )
        throw Error("Revê a preparação na aplicação que a criou.");
      const result = await this.call(action, {
        name: "profile",
        sequence: operation.sequence,
        operationId: operation.operationId,
      });
      await this.state();
      if (
        !result.operation ||
        !["ready", "cancelled", "expired", "superseded"].includes(
          result.operation.phase,
        )
      )
        throw Error(
          result.error || "Publicação autorizada. A cópia está pendente.",
        );
      this.set({
        message:
          "A tentativa anterior terminou. O teu rascunho foi mantido; compara as versões antes de publicar.",
      });
    });
  }
  async recoveryValue(
    object: DisplayObject,
    expectedBase: string,
  ): Promise<StudioValue> {
    this.ensure();
    if (this.current.busy || this.current.editing?.pending)
      throw Error("Verifica a publicação pendente antes de editar");
    if (
      object.author.id !== this.owner ||
      object.kind !== "site" ||
      !object.content.site ||
      (object.content.siteRevision as SiteRevision | undefined)?.body?.name !==
        "profile"
    )
      throw Error("Só podes recuperar uma versão do teu próprio site");
    const value = {
      site: object.content.site,
      theme: object.content.theme ?? "sand",
      attachments: object.content.attachments ?? [],
    };
    validateStudio(value);
    await this.adopt(
      value,
      expectedBase,
      object.public
        ? "public"
        : object.readers.filter((id) => id !== this.owner).sort(),
    );
    return structuredClone(value);
  }
}
