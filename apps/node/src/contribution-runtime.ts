import { inspectContributionRejection } from "./contribution-rejection-content";
import { readContributionForm } from "./contribution-read";
import { inspectContributionReceipt } from "./contribution-receipt-content";
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
import {
  contributionInboxManagement,
  type ContributionInboxEntry,
} from "../../../packages/sites/src/contribution-inbox";
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
  publishSource(bundle: Bundle, ttlMs: number, deadline: number): string;
  cancelPackets(ids: ReadonlySet<string>): void;
  requestSource(id: string): boolean;
}
export class ContributionRuntime {
  private rejectionAllowed = new Map<string, ContributionInboxEntry>();
  private outcomeAllowed(kind: "receipt" | "rejection") {
    return kind === "receipt" ? this.receiptAllowed : this.rejectionAllowed;
  }
  private receiptAllowed = new Map<string, ContributionInboxEntry>();
  private receiptCursor = 0;
  private receiptSendCursor = 0;
  private nextRetry = 0;
  private allowed = new Map<string, ContributionOperation>();
  private sending = false;
  private publishedAt = new Map<string, number>();
  private sourcePackets = new Map<
    string,
    { packetId: string; operationId: string; until: number; sent: number }
  >();
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
    if (bundle.manifest.kind === "site-contribution-rejection")
      return this.canServeReceipt(bundle, "rejection");
    if (bundle.manifest.kind === "site-contribution-receipt")
      return this.canServeReceipt(bundle);
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
  private permitReceipt(
    entry: ContributionInboxEntry,
    kind: "receipt" | "rejection" = "receipt",
  ) {
    this.policy(entry.target.snapshotId, entry.contributorId);
    this.policy(entry.target.snapshotId, this.context.identity.public.id);
    if (
      !entry[kind] ||
      entry[kind].phase !== "queued" ||
      entry[kind].request.expires <= Date.now()
    )
      throw Error("Recibo indisponível ou expirado");
  }
  private canServeReceipt(
    bundle: Bundle,
    kind: "receipt" | "rejection" = "receipt",
  ) {
    try {
      const entry = this.outcomeAllowed(kind).get(bundle.manifest.id);
      if (!entry?.[kind]?.transport?.copied) return false;
      this.permitReceipt(entry, kind);
      return (
        entry[kind].transport.bundleHash === hash(canonical(bundle)) &&
        (kind === "receipt"
          ? inspectContributionReceipt
          : inspectContributionRejection)(bundle, this.context.identity) !==
          null
      );
    } catch {
      return false;
    }
  }
  private stopReceipt(
    entry: ContributionInboxEntry,
    kind: "receipt" | "rejection" = "receipt",
  ) {
    const id = entry[kind]?.transport?.bundleId;
    if (!id) return;
    this.outcomeAllowed(kind).delete(id);
    this.publishedAt.delete(id);
    this.context.cancel(id);
  }
  private flushReceipts() {
    const state = this.context.incoming.state();
    const prior = new Set([
      ...this.receiptAllowed.keys(),
      ...this.rejectionAllowed.keys(),
    ]);
    const active: {
      entry: ContributionInboxEntry;
      kind: "receipt" | "rejection";
    }[] = [];
    for (const entry of state.entries)
      for (const kind of ["receipt", "rejection"] as const) {
        const op = entry[kind];
        if (!op || op.phase === "expired") continue;
        active.push({ entry, kind });
        if (op.transport) prior.delete(op.transport.bundleId);
      }
    const start = this.receiptSendCursor % Math.max(1, active.length),
      count = Math.min(8, active.length);
    this.receiptSendCursor = (start + count) % Math.max(1, active.length);
    for (let i = 0; i < count; i++) {
      let { entry, kind } = active[(start + i) % active.length];
      if (!entry[kind]) continue;
      try {
        if (entry[kind].phase === "prepared")
          entry = (
            kind === "receipt"
              ? this.context.incoming.signReceipt.bind(this.context.incoming)
              : this.context.incoming.signRejection.bind(this.context.incoming)
          )(entry.id, this.policy);
        if (entry[kind]!.phase === "signed")
          entry = (
            kind === "receipt"
              ? this.context.incoming.sealReceipt.bind(this.context.incoming)
              : this.context.incoming.sealRejection.bind(this.context.incoming)
          )(entry.id, this.policy);
        this.permitReceipt(entry, kind);
        const bundle = (
          kind === "receipt"
            ? this.context.incoming.receiptBundle.bind(this.context.incoming)
            : this.context.incoming.rejectionBundle.bind(this.context.incoming)
        )(entry.id, this.policy);
        if (!bundle) throw Error("Envelope de recibo indisponível");
        this.context.store.put(bundle, true);
        const actual = this.context.store.get(bundle.manifest.id, false);
        verifyBundle(actual);
        entry = (
          kind === "receipt"
            ? this.context.incoming.copyReceipt.bind(this.context.incoming)
            : this.context.incoming.copyRejection.bind(this.context.incoming)
        )(entry.id, actual, this.policy);
        const previous = this.outcomeAllowed(kind).get(actual.manifest.id);
        if (!previous || canonical(previous[kind]) !== canonical(entry[kind]))
          this.outcomeAllowed(kind).set(
            actual.manifest.id,
            structuredClone(entry),
          );
        if (!this.canServeReceipt(actual, kind))
          throw Error("Recibo suspenso pela política actual");
        if (
          Date.now() - (this.publishedAt.get(actual.manifest.id) ?? 0) >=
          30000
        ) {
          this.context.publish(actual);
          this.publishedAt.set(actual.manifest.id, Date.now());
        }
      } catch {
        this.stopReceipt(entry, kind);
        this.context.ensure();
      }
    }
    for (const id of prior) {
      this.receiptAllowed.delete(id);
      this.rejectionAllowed.delete(id);
      this.publishedAt.delete(id);
      this.context.cancel(id);
    }
  }
  receiveReceipt(bundle: Bundle) {
    this.context.ensure();
    const content = inspectContributionReceipt(bundle, this.context.identity);
    if (
      !content ||
      content.receipt.body.contributorId !== this.context.identity.public.id
    )
      return;
    const operation = this.context.catalog.receiveReceipt(bundle, this.policy);
    this.stop(operation);
  }
  receiveRejection(bundle: Bundle) {
    this.context.ensure();
    const content = inspectContributionRejection(bundle, this.context.identity);
    if (
      !content ||
      content.rejection.body.contributorId !== this.context.identity.public.id
    )
      return;
    const operation = this.context.catalog.receiveRejection(
      bundle,
      this.policy,
    );
    this.stop(operation);
  }
  private stop(op: ContributionOperation) {
    for (const [id, sent] of this.sourcePackets)
      if (sent.operationId === op.operationId) {
        this.context.cancelPackets(new Set([sent.packetId]));
        this.sourcePackets.delete(id);
      }
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
    for (const entry of [...this.rejectionAllowed.values()]) {
      try {
        this.permitReceipt(entry, "rejection");
      } catch {
        this.stopReceipt(entry, "rejection");
      }
    }
    for (const entry of [...this.receiptAllowed.values()]) {
      try {
        this.permitReceipt(entry);
      } catch {
        this.stopReceipt(entry);
      }
    }
    for (const op of [...this.allowed.values()]) {
      try {
        this.permit(op);
      } catch {
        this.stop(op);
      }
    }
  }
  close() {
    for (const entry of [...this.rejectionAllowed.values()])
      this.stopReceipt(entry, "rejection");
    for (const entry of [...this.receiptAllowed.values()])
      this.stopReceipt(entry);
    for (const id of this.allowed.keys()) this.context.cancel(id);
    this.allowed.clear();
    this.publishedAt.clear();
    this.context.cancelPackets(
      new Set([...this.sourcePackets.values()].map((s) => s.packetId)),
    );
    this.sourcePackets.clear();
  }
  /** No general private-store lookup: only the original source of an active,
   * durably copied outgoing proposal can support that proposal's delivery. */
  sourceForRequest(id: string) {
    this.context.ensure();
    for (const op of this.allowed.values()) {
      if (
        op.target.snapshotId !== id ||
        op.phase !== "queued" ||
        !op.transport?.copied ||
        op.expires <= Date.now()
      )
        continue;
      let bundle: Bundle;
      try {
        this.permit(op);
        bundle = this.context.catalog.queuedSource(op, this.policy);
      } catch {
        this.context.ensure();
        return null;
      }
      return {
        bundle,
        operationId: op.operationId,
        until: Math.min(op.expires, bundle.manifest.expires),
      };
    }
    return null;
  }
  respondSource(id: string): boolean {
    const now = Date.now();
    for (const [key, p] of this.sourcePackets)
      if (p.until <= now) this.sourcePackets.delete(key);
    const source = this.sourceForRequest(id);
    if (!source) return false;
    const previous = this.sourcePackets.get(id);
    if (
      previous &&
      previous.operationId === source.operationId &&
      now - previous.sent < 30000
    )
      return true;
    if (previous) this.context.cancelPackets(new Set([previous.packetId]));
    const ttl = Math.min(120000, source.until - Date.now());
    if (ttl < 1) return false;
    const packetId = this.context.publishSource(
      source.bundle,
      ttl,
      source.until,
    );
    this.sourcePackets.set(id, {
      packetId,
      operationId: source.operationId,
      until: now + ttl,
      sent: now,
    });
    return true;
  }
  private recoverReceipts(operations: readonly ContributionOperation[]) {
    const receiptOwners = new Set(
      operations
        .filter((op) => op.transport?.copied && !op.receipt)
        .map((op) => parseSiteAddress(op.target.site).ownerId),
    );
    const rejectionOwners = new Set(
      operations
        .filter((op) => op.transport?.copied && !op.rejection)
        .map((op) => parseSiteAddress(op.target.site).ownerId),
    );
    if (!receiptOwners.size && !rejectionOwners.size) return;
    const candidates = this.context.store
      .list()
      .filter(
        (m) =>
          ((m.kind === "site-contribution-receipt" &&
            receiptOwners.has(m.author.id)) ||
            (m.kind === "site-contribution-rejection" &&
              rejectionOwners.has(m.author.id))) &&
          m.keys.some((k) => k.reader === this.context.identity.public.id),
      );
    const start = this.receiptCursor % Math.max(1, candidates.length),
      count = Math.min(32, candidates.length);
    this.receiptCursor = (start + count) % Math.max(1, candidates.length);
    for (let i = 0; i < count; i++) {
      try {
        const bundle = this.context.store.get(
          candidates[(start + i) % candidates.length].id,
          false,
        );
        if (bundle.manifest.kind === "site-contribution-rejection")
          this.receiveRejection(bundle);
        else this.receiveReceipt(bundle);
      } catch {
        this.context.ensure();
      }
    }
  }
  tick() {
    if (this.sending || Date.now() < this.nextRetry) return;
    this.nextRetry = Date.now() + 5000;
    this.sending = true;
    try {
      this.recoverReceipts(this.context.catalog.state().operations);
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
      this.flushReceipts();
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
    if (value.action === "reject")
      return this.context.incoming.reject(
        value.id,
        value.revision,
        value.reason,
        this.policy,
      );
    if (value.action === "dismiss")
      return this.context.incoming.dismiss(value.id, value.revision);
    if (value.action === "obtain-source") {
      let found = this.context.incoming.read(value.id, this.policy);
      if (!found || !found.entry.proof)
        throw Error("Candidata indisponível ou expirada");
      this.completeSource(found.entry);
      found = this.context.incoming.read(value.id, this.policy);
      if (!found || !found.entry.proof)
        throw Error("Candidata indisponível ou expirada");
      if (found.proposal)
        return {
          status: "available",
          snapshotId: found.entry.target.snapshotId,
          requested: false,
        };
      return {
        status: "waiting",
        snapshotId: found.entry.target.snapshotId,
        requested: this.context.requestSource(found.entry.target.snapshotId),
      };
    }
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
      if (!entry.proof) continue;
      try {
        this.completeSource(entry);
        const current = this.context.incoming.read(entry.id, this.policy);
        if (!current || !current.entry.proof) continue;
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
    const management = contributionInboxManagement(
      this.context.incoming.state(),
    );
    return { items, scope: "candidates", durable: true, management };
  }
}
