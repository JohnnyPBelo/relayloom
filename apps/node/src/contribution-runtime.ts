import { readContributionForm } from "./contribution-read";
import { inspectContribution } from "./contribution-content";
import {
  canonical,
  hash,
  verifyBundle,
  type Identity,
  type Bundle,
  type ContentStore,
} from "../../../packages/core/src/index";
import { nodeCertificateCrypto } from "../../../packages/core/src/certificate-crypto";
import { NodeContributionCatalog } from "../../../packages/sites/src/contribution-catalog";
import { NodeContributionInbox } from "../../../packages/sites/src/contribution-inbox-catalog";
import type { ContributionInboxEntry } from "../../../packages/sites/src/contribution-inbox";
import {
  createContributionOperations,
  type ContributionOperation,
} from "../../../packages/sites/src/contribution-operations";
import { contributionCommandShape } from "../../../packages/sites/src/contribution-command";
import { parseSiteAddress } from "../../../packages/sites/src/protocol";
const operations = createContributionOperations(nodeCertificateCrypto);
interface Context {
  identity: Identity;
  catalog: NodeContributionCatalog;
  incoming: NodeContributionInbox;
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
  /** Reception persists evidence separately from relay cache and human decisions. */
  receive(bundle: Bundle) {
    this.context.ensure();
    const content = inspectContribution(bundle, this.context.identity);
    if (
      !content ||
      parseSiteAddress(content.proposal.body.target.site).ownerId !==
        this.context.identity.public.id
    )
      return;
    let source: Bundle | undefined;
    try {
      source = this.context.store.get(
        content.proposal.body.target.snapshotId,
        false,
      );
    } catch {
      /* Keep a bounded candidate while its source is missing. */
    }
    if (source) {
      try {
        this.context.incoming.checkSource(bundle, source);
      } catch {
        this.context.ensure();
        return;
      }
    }
    const result = this.context.incoming.admit(bundle, this.policy);
    if (result.outcome !== "conflict")
      this.completeSource(result.entry, source);
  }
  receiveSource(bundle: Bundle) {
    this.context.ensure();
    if (bundle.manifest.author.id !== this.context.identity.public.id) return;
    for (const entry of this.context.incoming.state().entries)
      if (
        entry.phase === "missing-source" &&
        entry.target.snapshotId === bundle.manifest.id
      )
        this.completeSource(entry, bundle);
  }
  private completeSource(entry: ContributionInboxEntry, supplied?: Bundle) {
    if (entry.phase !== "missing-source") return;
    let source: Bundle;
    try {
      source =
        supplied ?? this.context.store.get(entry.target.snapshotId, false);
    } catch {
      return;
    }
    try {
      this.context.incoming.attachSource(entry.id, source, this.policy);
    } catch {
      // An invalid/unauthorized source does not confer form authority. A private
      // integrity failure locks the profile through the database wrapper.
      this.context.ensure();
    }
  }
  /** Durable candidates; verification still does not mean owner approval. */
  private inbox() {
    const items: any[] = [];
    // Recover readable, still-live envelopes saved by versions before this inbox.
    for (const m of this.context.store.list()) {
      if (m.kind !== "site-contribution") continue;
      try {
        this.receive(this.context.store.get(m.id, false));
      } catch {
        this.context.ensure();
      }
    }
    for (const entry of this.context.incoming.state().entries) {
      if (entry.phase === "expired") continue;
      try {
        this.completeSource(entry);
        const current = this.context.incoming.read(entry.id, this.policy);
        if (!current || current.entry.phase === "expired") continue;
        const e = current.entry;
        const base = {
          id: e.id,
          bundleId: e.proof!.bundleId,
          contributorId: e.contributorId,
          operationId: e.operationId,
          target: e.target,
          created: e.created,
          expires: e.expires,
          conflicts: e.conflicts,
          conflictOverflow: e.conflictOverflow,
        };
        if (!current.proposal) {
          // A present but invalid source is not a reviewable missing-source row.
          if (!this.context.store.has(e.target.snapshotId))
            items.push({ ...base, status: "missing-source" });
          continue;
        }
        const b = current.proposal.body;
        items.push({
          ...base,
          contributor: b.contributor,
          status: "verified-candidate",
          values: b.values,
          publicationScope: b.publicationScope,
          schemaHash: b.schemaHash,
        });
      } catch {
        this.context.ensure();
      }
    }
    return { items, scope: "candidates", durable: true };
  }
}
