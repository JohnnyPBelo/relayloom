import { validateSiteResources } from "./site-resource";
import {
  canonical,
  exactShape,
  type Bundle,
  type PublicIdentity,
} from "../../core/src/protocol";
import { validateContentShape } from "../../content/src/validation";
import type { Content, DisplayObject } from "../../content/src/types";
import { parseSiteAddress, siteAddress } from "../../sites/src/protocol";
import { BrowserProfile } from "./profile";
import { BrowserSiteCatalog, type SiteOperationHandle } from "./site-catalog";
import { verifySiteContent } from "./site-content";
type Operation = NonNullable<
  Awaited<ReturnType<BrowserSiteCatalog["operation"]>>
>;
interface Context {
  profile: BrowserProfile;
  blocked(): Promise<readonly string[]>;
  knownWithdrawals?(
    readValue: (key: string) => Promise<unknown>,
  ): Promise<Record<string, string>>;
  readers(ids: unknown): Promise<PublicIdentity[] | "public">;
  publish(bundle: Bundle): void;
  request(ids: string[]): Promise<void>;
}
export class BrowserSiteRuntime {
  private readonly catalog: BrowserSiteCatalog;
  private readonly owner: PublicIdentity;
  private readonly generation: number;
  private initialized = false;
  private closed = false;
  private tail = Promise.resolve();
  private pending = new Map<string, { name: string; operation: Operation }>();
  private nextRetry = 0;
  private ticking = false;
  lastError = "";
  constructor(private readonly context: Context) {
    const owner = context.profile.identity;
    if (!owner) throw new Error("Desbloqueia a identidade");
    this.owner = owner;
    this.generation = context.profile.sessionGeneration;
    this.catalog = new BrowserSiteCatalog(context.profile);
  }
  private ensure() {
    if (
      this.closed ||
      this.context.profile.sessionGeneration !== this.generation
    )
      throw new Error("Sessão de site bloqueada");
  }
  close() {
    this.closed = true;
    this.pending.clear();
  }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const work = this.tail.then(async () => {
      this.ensure();
      const result = await run();
      this.ensure();
      return result;
    });
    this.tail = work.then(
      () => {},
      () => {},
    );
    return work;
  }
  private slot(name: string, handle: SiteOperationHandle) {
    return name + ":" + handle.sequence;
  }
  private async inspect(bundle: Bundle) {
    if (bundle.manifest.kind !== "site") return null;
    if (
      bundle.manifest.publicKey === null &&
      !bundle.manifest.keys.some((k) => k.reader === this.owner.id)
    )
      return null;
    const content = (await this.context.profile.decrypt(bundle)) as Content;
    validateContentShape(content);
    if (content.type !== "site") throw new Error("Conteúdo de site inválido");
    return verifySiteContent(content, bundle.manifest.author);
  }
  private async initialize() {
    if (this.initialized) return;
    const blocked = await this.context.blocked();
    for (const id of await this.context.profile.ids()) {
      let bundle: Bundle, parsed: ReturnType<typeof verifySiteContent>;
      try {
        bundle = await this.context.profile.getBundle(id);
        if (
          bundle.manifest.kind !== "site" ||
          blocked.includes(bundle.manifest.author.id)
        )
          continue;
        parsed = await this.inspect(bundle);
      } catch {
        continue;
      }
      if (parsed) await this.catalog.observe(bundle, parsed.revision.body.name);
    }
    this.pending.clear();
    for (const item of await this.catalog.pending())
      this.pending.set(this.slot(item.name, item), {
        name: item.name,
        operation: item,
      });
    this.initialized = true;
  }
  receive(bundle: Bundle) {
    return this.serial(async () => {
      const parsed = await this.inspect(bundle);
      if (parsed) await this.catalog.observe(bundle, parsed.revision.body.name);
    });
  }
  private async current(name: string, h: SiteOperationHandle) {
    const op = await this.catalog.operation(name, h.sequence, h.operationId);
    if (!op || op.fingerprint !== h.fingerprint)
      throw new Error("Operação de site desconhecida");
    return op;
  }
  private async finish(name: string, h: SiteOperationHandle) {
    let operation = await this.current(name, h);
    const access = await this.catalog.preparationAccess(name, operation),
      blocked = await this.context.blocked();
    if (
      access?.readers !== "public" &&
      access?.readers.some((id) => blocked.includes(id))
    ) {
      this.lastError =
        "A publicação está em pausa porque um leitor foi bloqueado.";
      return { operation, error: this.lastError };
    }
    if (operation.phase === "prepared")
      operation = await this.catalog.commit(name, operation);
    if (operation.phase === "committed") {
      const bundle = await this.catalog.authorizedBundle(name, operation);
      this.ensure();
      await this.context.profile.putBundle(bundle, true);
      const stored = await this.context.profile.getBundle(bundle.manifest.id);
      if (canonical(stored) !== canonical(bundle))
        throw new Error("A cópia do site não corresponde à publicação");
      operation = await this.catalog.markReady(name, operation);
      this.ensure();
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
  async tick() {
    if (this.closed || this.ticking || Date.now() < this.nextRetry) return;
    this.nextRetry = Date.now() + 5000;
    this.ticking = true;
    try {
      await this.serial(async () => {
        await this.initialize();
        const next = [...this.pending.values()].find(
          (p) => p.operation.phase === "committed" || p.operation.requested,
        );
        if (next) {
          const key = this.slot(next.name, next.operation);
          this.pending.delete(key);
          this.pending.set(key, next);
          const result = await this.finish(next.name, next.operation);
          this.lastError = result.error ?? "";
        }
      });
    } catch (error) {
      this.lastError = (error as Error).message;
    } finally {
      this.ticking = false;
    }
  }
  private async address(value: unknown) {
    const parsed = parseSiteAddress(value);
    if ((await this.context.blocked()).includes(parsed.ownerId))
      throw new Error("Contacto bloqueado");
    return parsed;
  }
  private async resolve(address: string, revisionId?: string) {
    const { ownerId, name } = await this.address(address),
      state = await this.catalog.state(ownerId, name);
    if (revisionId !== undefined && !/^[a-f0-9]{64}$/.test(revisionId))
      throw new Error("Revisão inválida");
    if (!revisionId && state.status === "conflict")
      return { status: "conflict", address, state };
    const chosen = revisionId ?? state.heads[0]?.id;
    if (!chosen) return { status: "pending", address, state };
    const header = (await this.catalog.history(ownerId, name)).find(
      (h) => h.revision.id === chosen,
    );
    if (!header)
      return { status: "unknown-revision", address, revisionId: chosen, state };
    const ids = [
      ...new Set([...header.bundles, ...(await this.context.profile.ids())]),
    ];
    for (const id of ids) {
      try {
        const bundle = await this.context.profile.getBundle(id);
        if (
          bundle.manifest.kind !== "site" ||
          bundle.manifest.author.id !== ownerId
        )
          continue;
        const parsed = await this.inspect(bundle);
        if (
          !parsed ||
          parsed.revision.id !== chosen ||
          parsed.revision.body.name !== name
        )
          continue;
        const records = await this.context.profile.records();
        const object: DisplayObject = {
          id,
          author: bundle.manifest.author,
          kind: "site",
          created: bundle.manifest.created,
          expires: bundle.manifest.expires,
          content: parsed.content,
          pinned: records[id]?.pinned === true,
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
        /* A remembered header does not prove current payload availability. */
      }
    }
    await this.context.request(header.bundles);
    return { status: "pending", address, revisionId: chosen, state };
  }
  command(value: any): Promise<any> {
    return this.serial(() => this.execute(value));
  }
  private async execute(value: any): Promise<any> {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Comando de site inválido");
    if (value.action === "operation" || value.action === "cancel") {
      if (!exactShape(value, ["action", "name", "sequence", "operationId"]))
        throw new Error("Comando de site inválido");
      const operation = await this.catalog.operation(
        value.name,
        value.sequence,
        value.operationId,
      );
      if (value.action === "operation" || !operation) return { operation };
      const cancelled = await this.catalog.cancel(value.name, operation);
      if (cancelled.phase === "cancelled")
        this.pending.delete(this.slot(value.name, cancelled));
      return { operation: cancelled };
    }
    await this.initialize();
    if (value.action === "state" || value.action === "history") {
      if (!exactShape(value, ["action", "address"]))
        throw new Error("Comando de site inválido");
      const { ownerId, name } = await this.address(value.address);
      return value.action === "state"
        ? this.catalog.state(ownerId, name)
        : {
            address: value.address,
            revisions: await this.catalog.history(ownerId, name),
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
      const operation = await this.catalog.operation(
        value.name,
        value.sequence,
        value.operationId,
      );
      if (!operation) throw new Error("Operação de site desconhecida");
      return this.finish(value.name, operation);
    }
    const fields = [
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
      (!exactShape(value, fields) &&
        !exactShape(value, [...fields, "confirmedHeads"]))
    )
      throw new Error("Comando de site inválido");
    const operation = await this.catalog.createPublication(
      value.name,
      {
        sequence: value.sequence,
        operationId: value.operationId,
        expectedBase: value.expectedBase,
        payload: value.payload,
        readers: await this.context.readers(value.recipients),
        ttlMs: value.ttlMs,
        ...(value.confirmedHeads !== undefined
          ? { confirmedHeads: value.confirmedHeads }
          : {}),
      },
      async (request, readValue) => {
        const settings = (await readValue("mesh-settings")) as any;
        const withdrawn =
          (await this.context.knownWithdrawals?.(readValue)) ?? {};
        return validateSiteResources(
          request,
          this.context.profile,
          settings?.blocked ?? [],
          withdrawn,
        );
      },
    );
    const address = siteAddress(this.owner.id, value.name);
    if (["prepared", "committed"].includes(operation.phase))
      this.pending.set(this.slot(value.name, operation), {
        name: value.name,
        operation,
      });
    try {
      return { address, ...(await this.finish(value.name, operation)) };
    } catch (error) {
      this.lastError = (error as Error).message;
      try {
        return {
          address,
          operation: await this.current(value.name, operation),
          error: this.lastError,
        };
      } catch {
        throw error;
      }
    }
  }
}
