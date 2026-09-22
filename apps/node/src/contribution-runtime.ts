import { readContributionForm } from "./contribution-read";
import { inspectContribution } from "./contribution-content";
import {
  canonical,
  hash,
  verifyBundle,
  decryptBundle,
  type Identity,
  type Bundle,
  type ContentStore,
} from "../../../packages/core/src/index";
import { nodeCertificateCrypto } from "../../../packages/core/src/certificate-crypto";
import { NodeContributionCatalog } from "../../../packages/sites/src/contribution-catalog";
import {
  createContributionOperations,
  type ContributionOperation,
} from "../../../packages/sites/src/contribution-operations";
import { contributionCommandShape } from "../../../packages/sites/src/contribution-command";
import { createContributionContextResolver } from "../../../packages/sites/src/contribution-context";
import { createSiteContributionProtocol } from "../../../packages/sites/src/contribution-protocol";
import { parseSiteAddress } from "../../../packages/sites/src/protocol";
const operations = createContributionOperations(nodeCertificateCrypto),
  resolver = createContributionContextResolver(nodeCertificateCrypto),
  certificates = createSiteContributionProtocol(nodeCertificateCrypto);
interface Context {
  identity: Identity;
  catalog: NodeContributionCatalog;
  store: ContentStore;
  ensure(): void;
  blocked(): readonly string[];
  withdrawn(id: string, author: string): boolean;
  publish(bundle: Bundle): void;
  cancel(id: string): void;
}
export class ContributionRuntime {
  private nextRetry = 0;
  private allowed = new Map<string, ContributionOperation>();
  private sending = false;
  private publishedAt = new Map<string, number>();
  constructor(private readonly context: Context) {}
  private policy = (snapshotId: string, ownerId: string) => {
    this.context.ensure();
    if (this.context.blocked().includes(ownerId))
      throw Error("Autor do site bloqueado");
    if (this.context.withdrawn(snapshotId, ownerId))
      throw Error("O autor retirou este snapshot");
  };
  private permit(op: ContributionOperation) {
    this.policy(op.target.snapshotId, parseSiteAddress(op.target.site).ownerId);
    if (op.expires <= Date.now()) throw Error("Proposta expirada");
  }
  canServe(bundle: Bundle) {
    try {
      const op = this.allowed.get(bundle.manifest.id);
      if (!op || op.phase !== "queued" || !op.transport?.copied) return false;
      this.permit(op);
      return (
        op.transport.bundleHash === hash(canonical(bundle)) &&
        inspectContribution(bundle, this.context.identity) !== null
      );
    } catch {
      return false;
    }
  }
  private stop(op: ContributionOperation) {
    if (op.transport) {
      this.allowed.delete(op.transport.bundleId);
      this.publishedAt.delete(op.transport.bundleId);
      this.context.cancel(op.transport.bundleId);
    }
  }
  private finish(operation: ContributionOperation) {
    this.context.ensure();
    try {
      if (operation.phase === "prepared")
        operation = this.context.catalog.sign(operation, this.policy);
      if (operation.phase === "signed") {
        this.context.catalog.seal(operation, this.policy);
        operation = this.context.catalog.queue(operation, this.policy);
      }
      if (operation.phase !== "queued") {
        this.stop(operation);
        return { operation };
      }
      this.permit(operation);
      const bundle = this.context.catalog.authorizedBundle(
        operation,
        this.policy,
      );
      if (!bundle) throw Error("Envelope guardado indisponível");
      this.context.store.put(bundle, true);
      const actual = this.context.store.get(bundle.manifest.id, false);
      verifyBundle(actual);
      operation = this.context.catalog.markCopied(operation, actual);
      this.allowed.set(bundle.manifest.id, operation);
      if (!this.canServe(actual))
        throw Error("Envio suspenso pela política actual");
      if (
        Date.now() - (this.publishedAt.get(actual.manifest.id) ?? 0) >=
        30000
      ) {
        this.context.publish(actual);
        this.publishedAt.set(actual.manifest.id, Date.now());
      }
      return { operation };
    } catch (error) {
      this.stop(operation);
      this.context.ensure();
      const current = this.context.catalog.operation(
        operation.sequence,
        operation.operationId,
      ).operation;
      if (!current) throw error;
      return { operation: current, error: (error as Error).message };
    }
  }
  revokeInvalid() {
    for (const op of [...this.allowed.values()]) {
      try {
        this.permit(op);
      } catch {
        this.stop(op);
      }
    }
  }
  close() {
    for (const id of this.allowed.keys()) this.context.cancel(id);
    this.allowed.clear();
    this.publishedAt.clear();
  }
  tick() {
    if (this.sending || Date.now() < this.nextRetry) return;
    this.nextRetry = Date.now() + 5000;
    this.sending = true;
    try {
      const state = this.context.catalog.state();
      const prior = new Set(this.allowed.keys());
      for (const op of state.operations) {
        if (op.transport) prior.delete(op.transport.bundleId);
        if (["prepared", "signed", "queued"].includes(op.phase))
          this.finish(op);
        else this.stop(op);
      }
      for (const id of prior) {
        this.allowed.delete(id);
        this.publishedAt.delete(id);
        this.context.cancel(id);
      }
    } catch {
      this.close();
    } finally {
      this.sending = false;
    }
  }
  command(input: unknown): any {
    this.context.ensure();
    const value = contributionCommandShape(input);
    if (value.action === "form")
      return readContributionForm(value, this.context);
    if (value.action === "state") return this.context.catalog.state();
    if (value.action === "inbox") return this.inbox();
    if (value.action === "submit") {
      const { action: _action, ...raw } = value,
        request = operations.request(
          raw,
          this.context.identity.public.id,
        ).request;
      const op = this.context.catalog.prepare(
        request,
        () => this.context.store.get(request.snapshotId, false),
        this.policy,
      );
      return this.finish(op);
    }
    const found = this.context.catalog.operation(
      value.sequence,
      value.operationId,
    );
    if (value.action === "operation") return found;
    if (!found.operation)
      throw Error("Resultado de proposta desconhecido ou retirado");
    if (value.action === "cancel") {
      const operation = this.context.catalog.cancel(found.operation);
      this.stop(operation);
      return { operation };
    }
    return this.finish(found.operation);
  }
  /** Readable candidates, not durable owner decisions or receipt of approval. */
  private inbox() {
    const items: any[] = [];
    const seen = new Set<string>();
    for (const m of this.context.store.list()) {
      if (
        m.kind !== "site-contribution" ||
        this.context.blocked().includes(m.author.id)
      )
        continue;
      try {
        const bundle = this.context.store.get(m.id, false),
          content = inspectContribution(bundle, this.context.identity);
        if (!content) continue;
        const p = content.proposal,
          b = p.body;
        if (
          parseSiteAddress(b.target.site).ownerId !==
            this.context.identity.public.id ||
          seen.has(p.id)
        )
          continue;
        seen.add(p.id);
        this.policy(b.target.snapshotId, this.context.identity.public.id);
        const base = {
          id: p.id,
          bundleId: m.id,
          contributor: b.contributor,
          target: b.target,
          created: b.created,
          expires: b.expires,
        };
        let source: Bundle;
        try {
          source = this.context.store.get(b.target.snapshotId, false);
        } catch {
          items.push({ ...base, status: "missing-source" });
          continue;
        }
        this.policy(source.manifest.id, source.manifest.author.id);
        const context = resolver.resolve(
          {
            action: "form",
            snapshotId: source.manifest.id,
            pageId: b.target.pageId,
            formId: b.target.formId,
          },
          source,
          decryptBundle(source, this.context.identity),
          b.contributor.id,
          Date.now(),
        );
        certificates.verifyForSubmission(p, context.context, Date.now());
        items.push({
          ...base,
          status: "verified-candidate",
          values: b.values,
          publicationScope: b.publicationScope,
          schemaHash: b.schemaHash,
        });
      } catch {
        /* Invalid or unauthorized candidates do not become reviewable rows. */
      }
    }
    return { items: items.slice(-128), scope: "candidates" };
  }
}
