import { readSiteResource } from "./resource-read";
import { exactShape, type PublicIdentity } from "../../core/src/protocol";
import type { SiteReadScope } from "../../content/src/site-resource";
import type { ResourceOperation } from "../../sites/src/resource-operations";
import { BrowserResourceCatalog } from "./resource-catalog";
import { BrowserProfile } from "./profile";

interface Context {
  profile: BrowserProfile;
  blocked(): Promise<readonly string[]>;
  request(id: string): Promise<void>;
  withdrawn(id: string, authorId: string): Promise<boolean>;
  // Load contacts before entering the catalogue's exclusive transaction.
  readerSnapshot(): Promise<
    (scope: SiteReadScope) => PublicIdentity[] | "public"
  >;
}
export class BrowserResourceRuntime {
  private readonly catalog: BrowserResourceCatalog;
  private readonly generation: number;
  private closed = false;
  private tail = Promise.resolve();
  private nextRetry = 0;
  private ticking = false;
  constructor(private readonly context: Context) {
    this.generation = context.profile.sessionGeneration;
    this.catalog = new BrowserResourceCatalog(context.profile);
  }
  private ensure() {
    if (
      this.closed ||
      this.context.profile.sessionGeneration !== this.generation
    )
      throw Error("Sessão de recursos bloqueada");
  }
  close() {
    this.closed = true;
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
  private async finish(operation: ResourceOperation) {
    this.ensure();
    if (operation.phase !== "copy-pending") return { operation };
    try {
      const bundle = await this.catalog.authorizedBundle(operation);
      this.ensure();
      if (bundle) {
        await this.context.profile.putBundle(bundle, true, {
          key: "mesh-settings",
          update: (previous: any) => {
            this.ensure();
            if (
              operation.recipients !== "public" &&
              operation.recipients.some((id) => previous?.blocked?.includes(id))
            )
              throw Error(
                "A criação está em pausa porque um leitor foi bloqueado.",
              );
            // Check current blocking within the same atomic copy transaction.
            return previous;
          },
        });
        this.ensure();
        const copied = await this.context.profile.getBundle(bundle.manifest.id);
        this.ensure();
        operation = await this.catalog.ready(operation, copied);
      } else {
        operation = (
          await this.catalog.operation(
            operation.sequence,
            operation.operationId,
          )
        ).operation!;
      }
      return { operation };
    } catch (error) {
      this.ensure();
      const current = (
        await this.catalog.operation(operation.sequence, operation.operationId)
      ).operation;
      if (!current) throw error;
      return { operation: current, error: (error as Error).message };
    }
  }
  async tick() {
    if (this.ticking || this.closed || Date.now() < this.nextRetry) return;
    this.nextRetry = Date.now() + 5000;
    this.ticking = true;
    try {
      await this.serial(async () => {
        const pending = (await this.catalog.state()).operations.find(
          (op) => op.phase === "copy-pending",
        );
        if (pending) await this.finish(pending);
      });
    } catch {
      // Keep the journal intact. Explicit state/resume reports integrity errors.
    } finally {
      this.ticking = false;
    }
  }
  command(value: any): Promise<any> {
    return this.serial(async () => {
      if (["inspect", "obtain"].includes(value?.action))
        return readSiteResource(value, {
          ...this.context,
          ensure: () => this.ensure(),
        });
      if (value?.action === "state" && exactShape(value, ["action"]))
        return this.catalog.state();
      if (
        ["operation", "resume"].includes(value?.action) &&
        exactShape(value, ["action", "sequence", "operationId"])
      ) {
        const found = await this.catalog.operation(
          value.sequence,
          value.operationId,
        );
        if (value.action === "operation") return found;
        if (!found.operation)
          throw Error("Resultado de criação desconhecido ou retirado");
        return this.finish(found.operation);
      }
      if (
        value?.action !== "create" ||
        !exactShape(value, [
          "action",
          "sequence",
          "operationId",
          "content",
          "recipients",
          "ttlMs",
        ])
      )
        throw Error("Comando de recurso inválido");
      const { action: _action, ...request } = value;
      const readers = await this.context.readerSnapshot();
      this.ensure();
      const operation = await this.catalog.prepare(request, readers);
      return this.finish(operation);
    });
  }
}
