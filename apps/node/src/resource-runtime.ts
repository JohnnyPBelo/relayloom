import { readSiteResource } from "./resource-read";
import type { Identity } from "../../../packages/core/src/protocol";
import { exactShape } from "../../../packages/core/src/protocol";
import type {
  ContentStore,
  PublicIdentity,
} from "../../../packages/core/src/index";
import type { SiteReadScope } from "../../../packages/content/src/site-resource";
import { NodeResourceCatalog } from "../../../packages/sites/src/resource-catalog";
import type { ResourceOperation } from "../../../packages/sites/src/resource-operations";

interface Context {
  identity: Identity;
  request(id: string): void;
  withdrawn(id: string, authorId: string): boolean;
  catalog: NodeResourceCatalog;
  store: ContentStore;
  ensure(): void;
  blocked(): readonly string[];
  readers(scope: SiteReadScope): PublicIdentity[] | "public";
}

/** Local creation only. References in signed sites provide discovery; this
 * runtime never broadcasts bytes or adds resources to automatic inventories. */
export class ResourceRuntime {
  private nextRetry = 0;
  constructor(private readonly context: Context) {}
  private finish(operation: ResourceOperation) {
    this.context.ensure();
    if (operation.phase !== "copy-pending") return { operation };
    try {
      if (
        operation.recipients !== "public" &&
        operation.recipients.some((id) => this.context.blocked().includes(id))
      )
        throw Error("A criação está em pausa porque um leitor foi bloqueado.");
      const bundle = this.context.catalog.authorizedBundle(operation);
      if (bundle) {
        this.context.store.put(bundle, true);
        // Re-read the actual committed bytes. A successful put alone is not
        // sufficient proof of an exact, available copy.
        const copied = this.context.store.get(bundle.manifest.id, false);
        operation = this.context.catalog.ready(operation, copied);
      } else {
        operation = this.context.catalog.operation(
          operation.sequence,
          operation.operationId,
        ).operation!;
      }
      return { operation };
    } catch (error) {
      this.context.ensure();
      // A failed/uncertain copy leaves the durable signature available for
      // recovery. Integrity errors in the journal still fail closed.
      const current = this.context.catalog.operation(
        operation.sequence,
        operation.operationId,
      ).operation;
      if (!current) throw error;
      return { operation: current, error: (error as Error).message };
    }
  }
  tick() {
    if (Date.now() < this.nextRetry) return;
    this.nextRetry = Date.now() + 5000;
    this.context.ensure();
    const pending = this.context.catalog
      .state()
      .operations.find((op) => op.phase === "copy-pending");
    if (pending) this.finish(pending);
  }
  command(value: any): any {
    this.context.ensure();
    if (["inspect", "obtain"].includes(value?.action))
      return readSiteResource(value, this.context);
    if (value?.action === "state" && exactShape(value, ["action"]))
      return this.context.catalog.state();
    if (
      ["operation", "resume"].includes(value?.action) &&
      exactShape(value, ["action", "sequence", "operationId"])
    ) {
      const found = this.context.catalog.operation(
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
    const operation = this.context.catalog.prepare(request, (scope) =>
      this.context.readers(scope),
    );
    return this.finish(operation);
  }
}
