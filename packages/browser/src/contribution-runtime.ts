import { createContributionRejectionProtocol } from "../../sites/src/contribution-rejection";
import { createContributionReceiptProtocol } from "../../sites/src/contribution-receipt";
import {
  BrowserContributionInbox,
  ContributionInboxIntegrityError,
} from "./contribution-inbox";
import {
  contributionInboxManagement,
  type ContributionInboxEntry,
} from "../../sites/src/contribution-inbox";
import type { Bundle } from "../../core/src/protocol";
import { canonical } from "../../core/src/protocol";
import { BrowserProfile, type ProfileValueTransaction } from "./profile";
import { BrowserContributionCatalog } from "./contribution-catalog";
import { browserCertificateCrypto } from "./certificate-crypto";
import {
  createContributionOperations,
  UnmatchedContributionReceipt,
  UnmatchedContributionRejection,
  type ContributionOperation,
} from "../../sites/src/contribution-operations";
import { contributionCommandShape } from "../../sites/src/contribution-command";
import { readContributionForm } from "./contribution-read";
import { createContributionEnvelopeProtocol } from "../../sites/src/contribution-envelope";
import { parseSiteAddress } from "../../sites/src/protocol";
const registry = createContributionOperations(browserCertificateCrypto),
  envelopes = createContributionEnvelopeProtocol(browserCertificateCrypto),
  rejectionEnvelopes = createContributionRejectionProtocol(
    browserCertificateCrypto,
  ),
  receiptEnvelopes = createContributionReceiptProtocol(
    browserCertificateCrypto,
  );
interface Context {
  profile: BrowserProfile;
  policy(
    values: ProfileValueTransaction,
    id: string,
    author: string,
  ): Promise<void>;
  copyPolicy(
    id: string,
    author: string,
  ): { key: string; update(value: any): any }[];
  publish(bundle: Bundle): void;
  cancel(id: string): Promise<void>;
  cancelSource?(id: string, operationId: string): Promise<void>;
  requestSource?(id: string): Promise<boolean>;
}
export class BrowserContributionRuntime {
  private catalog: BrowserContributionCatalog;
  private incoming: BrowserContributionInbox;
  private generation: number;
  private closed = false;
  private tail = Promise.resolve();
  private receiptCursor = 0;
  private receiptSendCursor = 0;
  private nextRetry = 0;
  private ticking = false;
  private allowed = new Map<string, ContributionOperation>();
  private rejectionAllowed = new Map<string, ContributionInboxEntry>();
  private outcomeAllowed(kind: "receipt" | "rejection") {
    return kind === "receipt" ? this.receiptAllowed : this.rejectionAllowed;
  }
  private receiptAllowed = new Map<string, ContributionInboxEntry>();
  private publishedAt = new Map<string, number>();
  constructor(private context: Context) {
    this.catalog = new BrowserContributionCatalog(context.profile);
    this.incoming = new BrowserContributionInbox(context.profile);
    this.generation = context.profile.sessionGeneration;
  }
  private ensure() {
    if (
      this.closed ||
      this.context.profile.sessionGeneration !== this.generation
    )
      throw Error("Sessão de propostas bloqueada");
  }
  close() {
    this.closed = true;
    for (const op of this.allowed.values())
      void this.context
        .cancelSource?.(op.target.snapshotId, op.operationId)
        .catch(() => {});
    for (const entry of this.receiptAllowed.values())
      if (entry.receipt?.transport)
        void this.context
          .cancel(entry.receipt.transport.bundleId)
          .catch(() => {});
    for (const entry of this.rejectionAllowed.values())
      if (entry.rejection?.transport)
        void this.context
          .cancel(entry.rejection.transport.bundleId)
          .catch(() => {});
    this.rejectionAllowed.clear();
    this.receiptAllowed.clear();
    this.allowed.clear();
    this.publishedAt.clear();
  }
  private serial<T>(fn: () => Promise<T>) {
    const work = this.tail.then(async () => {
      this.ensure();
      const value = await fn();
      this.ensure();
      return value;
    });
    this.tail = work.then(
      () => {},
      () => {},
    );
    return work;
  }
  private policy = async (
    values: ProfileValueTransaction,
    id: string,
    author: string,
  ) => {
    this.ensure();
    await this.context.policy(values, id, author);
    this.ensure();
  };
  private async stop(op: ContributionOperation) {
    if (op.transport) {
      this.allowed.delete(op.transport.bundleId);
      this.publishedAt.delete(op.transport.bundleId);
      await this.context.cancelSource?.(op.target.snapshotId, op.operationId);
      this.ensure();
      await this.context.cancel(op.transport.bundleId);
      this.ensure();
    }
  }
  async canServe(bundle: Bundle) {
    if (bundle.manifest.kind === "site-contribution-rejection")
      return this.canServeReceipt(bundle, "rejection");
    if (bundle.manifest.kind === "site-contribution-receipt")
      return this.canServeReceipt(bundle);
    try {
      this.ensure();
      const op = this.allowed.get(bundle.manifest.id);
      if (
        !op ||
        op.phase !== "queued" ||
        !op.transport?.copied ||
        op.expires <= Date.now() ||
        op.transport.bundleHash !==
          browserCertificateCrypto.hash(canonical(bundle))
      )
        return false;
      await this.context.profile.transactValues((values) =>
        this.policy(
          values,
          op.target.snapshotId,
          parseSiteAddress(op.target.site).ownerId,
        ),
      );
      this.ensure();
      // The policy read can complete before a concurrent cancellation commits.
      // A retained reply must not revive its old permission or expired lifetime.
      return (
        this.allowed.get(bundle.manifest.id) === op && op.expires > Date.now()
      );
    } catch {
      return false;
    }
  }
  private async permitReceipt(
    entry: ContributionInboxEntry,
    kind: "receipt" | "rejection" = "receipt",
  ) {
    this.ensure();
    await this.context.profile.transactValues(async (values) => {
      await this.policy(values, entry.target.snapshotId, entry.contributorId);
      await this.policy(
        values,
        entry.target.snapshotId,
        this.context.profile.identity!.id,
      );
    });
    this.ensure();
    if (
      !entry[kind] ||
      entry[kind].phase !== "queued" ||
      entry[kind].request.expires <= Date.now()
    )
      throw Error("Recibo indisponível ou expirado");
  }
  private async stopReceipt(
    entry: ContributionInboxEntry,
    kind: "receipt" | "rejection" = "receipt",
  ) {
    const id = entry[kind]?.transport?.bundleId;
    if (!id) return;
    this.outcomeAllowed(kind).delete(id);
    this.publishedAt.delete(id);
    await this.context.cancel(id);
    this.ensure();
  }
  private async canServeReceipt(
    bundle: Bundle,
    kind: "receipt" | "rejection" = "receipt",
  ) {
    try {
      this.ensure();
      const entry = this.outcomeAllowed(kind).get(bundle.manifest.id);
      if (
        !entry?.[kind]?.transport?.copied ||
        entry[kind].transport.bundleHash !==
          browserCertificateCrypto.hash(canonical(bundle))
      )
        return false;
      await this.permitReceipt(entry, kind);
      this.ensure();
      return (
        this.outcomeAllowed(kind).get(bundle.manifest.id) === entry &&
        entry[kind].request.expires > Date.now()
      );
    } catch {
      return false;
    }
  }
  private async flushReceipts() {
    const state = await this.incoming.state();
    this.ensure();
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
          entry = await (
            kind === "receipt"
              ? this.incoming.signReceipt.bind(this.incoming)
              : this.incoming.signRejection.bind(this.incoming)
          )(entry.id, this.policy);
        this.ensure();
        if (entry[kind]!.phase === "signed")
          entry = await (
            kind === "receipt"
              ? this.incoming.sealReceipt.bind(this.incoming)
              : this.incoming.sealRejection.bind(this.incoming)
          )(entry.id, this.policy);
        this.ensure();
        await this.permitReceipt(entry, kind);
        this.ensure();
        const bundle = await (
          kind === "receipt"
            ? this.incoming.receiptBundle.bind(this.incoming)
            : this.incoming.rejectionBundle.bind(this.incoming)
        )(entry.id, this.policy);
        this.ensure();
        if (!bundle) throw Error("Envelope de recibo indisponível");
        await this.context.profile.putBundle(
          bundle,
          true,
          this.context.copyPolicy(entry.target.snapshotId, entry.contributorId),
        );
        this.ensure();
        const actual = await this.context.profile.getBundle(bundle.manifest.id);
        this.ensure();
        entry = await (
          kind === "receipt"
            ? this.incoming.copyReceipt.bind(this.incoming)
            : this.incoming.copyRejection.bind(this.incoming)
        )(entry.id, actual, this.policy);
        this.ensure();
        const previous = this.outcomeAllowed(kind).get(actual.manifest.id);
        if (!previous || canonical(previous[kind]) !== canonical(entry[kind]))
          this.outcomeAllowed(kind).set(
            actual.manifest.id,
            structuredClone(entry),
          );
        if (!(await this.canServeReceipt(actual, kind)))
          throw Error("Recibo suspenso pela política actual");
        this.ensure();
        if (
          Date.now() - (this.publishedAt.get(actual.manifest.id) ?? 0) >=
          30000
        ) {
          this.context.publish(actual);
          this.publishedAt.set(actual.manifest.id, Date.now());
        }
      } catch (error) {
        await this.stopReceipt(entry, kind);
        this.expectedFailure(error);
      }
    }
    for (const id of prior) {
      this.receiptAllowed.delete(id);
      this.rejectionAllowed.delete(id);
      this.publishedAt.delete(id);
      await this.context.cancel(id);
      this.ensure();
    }
  }
  private async applyReceipt(bundle: Bundle) {
    const plain = await this.context.profile.decryptStaging(bundle);
    this.ensure();
    const content = receiptEnvelopes.matchEnvelope(bundle, plain);
    if (
      content.receipt.body.contributorId !== this.context.profile.identity?.id
    )
      return true;
    try {
      const operation = await this.catalog.receiveReceipt(bundle, this.policy);
      this.ensure();
      await this.stop(operation);
      return true;
    } catch (error) {
      this.ensure();
      // History can legitimately have retired while an authentic receipt was
      // in transit. Consume this control without admitting it or closing RTC.
      // Signature/envelope corruption and storage failures still propagate.
      if (error instanceof UnmatchedContributionReceipt) return false;
      throw error;
    }
  }
  receiveReceipt(input: Bundle) {
    const bundle = JSON.parse(canonical(input)) as Bundle;
    return this.serial(() => this.applyReceipt(bundle));
  }
  private async applyRejection(bundle: Bundle) {
    const plain = await this.context.profile.decryptStaging(bundle);
    this.ensure();
    const content = rejectionEnvelopes.matchEnvelope(bundle, plain);
    if (
      content.rejection.body.contributorId !== this.context.profile.identity?.id
    )
      return true;
    try {
      const operation = await this.catalog.receiveRejection(
        bundle,
        this.policy,
      );
      this.ensure();
      await this.stop(operation);
      return true;
    } catch (error) {
      this.ensure();
      // History can legitimately have retired while an authentic rejection was
      // in transit. Consume this control without admitting it or closing RTC.
      // Signature/envelope corruption and storage failures still propagate.
      if (error instanceof UnmatchedContributionRejection) return false;
      throw error;
    }
  }
  receiveRejection(input: Bundle) {
    const bundle = JSON.parse(canonical(input)) as Bundle;
    return this.serial(() => this.applyRejection(bundle));
  }
  private async recoverReceipts(operations: readonly ContributionOperation[]) {
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
    const records = await this.context.profile.records();
    this.ensure();
    // The closed receipt body is at most 8 KiB; this generous serialized-bundle
    // bound avoids scanning large photos/video. Rotate at most 32 small values.
    const candidates = Object.keys(records)
      .filter((id) => records[id].size <= 64 * 1024)
      .sort(
        (a, b) =>
          (records[b].created ?? 0) - (records[a].created ?? 0) ||
          a.localeCompare(b),
      );
    const start = this.receiptCursor % Math.max(1, candidates.length),
      count = Math.min(32, candidates.length);
    this.receiptCursor = (start + count) % Math.max(1, candidates.length);
    for (let i = 0; i < count; i++) {
      try {
        const bundle = await this.context.profile.getBundle(
          candidates[(start + i) % candidates.length],
        );
        this.ensure();
        if (
          ((bundle.manifest.kind === "site-contribution-receipt" &&
            receiptOwners.has(bundle.manifest.author.id)) ||
            (bundle.manifest.kind === "site-contribution-rejection" &&
              rejectionOwners.has(bundle.manifest.author.id))) &&
          bundle.manifest.keys.some(
            (k) => k.reader === this.context.profile.identity?.id,
          )
        )
          if (bundle.manifest.kind === "site-contribution-rejection")
            await this.applyRejection(bundle);
          else await this.applyReceipt(bundle);
      } catch (error) {
        this.expectedFailure(error);
      }
    }
  }
  async sourceForRequest(id: string) {
    this.ensure();
    for (const op of [...this.allowed.values()]) {
      if (
        op.target.snapshotId !== id ||
        op.phase !== "queued" ||
        !op.transport?.copied ||
        op.expires <= Date.now()
      )
        continue;
      let bundle: Bundle;
      try {
        bundle = await this.catalog.queuedSource(op, this.policy);
      } catch {
        this.ensure();
        return null;
      }
      this.ensure();
      if (
        this.allowed.get(op.transport.bundleId) !== op ||
        op.expires <= Date.now()
      )
        continue;
      return {
        bundle,
        operationId: op.operationId,
        expires: Math.min(op.expires, bundle.manifest.expires),
      };
    }
    return null;
  }
  async revokeInvalid() {
    for (const kind of ["receipt", "rejection"] as const)
      for (const entry of [...this.outcomeAllowed(kind).values()]) {
        try {
          await this.permitReceipt(entry, kind);
        } catch {
          await this.stopReceipt(entry, kind).catch(() => {});
        }
      }
    for (const op of [...this.allowed.values()]) {
      try {
        this.ensure();
        if (op.expires <= Date.now()) throw Error("Proposta expirada");
        await this.context.profile.transactValues((values) =>
          this.policy(
            values,
            op.target.snapshotId,
            parseSiteAddress(op.target.site).ownerId,
          ),
        );
        this.ensure();
      } catch {
        await this.stop(op).catch(() => {});
      }
    }
  }
  private async finish(operation: ContributionOperation) {
    this.ensure();
    try {
      if (operation.phase === "prepared")
        operation = await this.catalog.sign(operation, this.policy);
      this.ensure();
      if (operation.phase === "signed") {
        await this.catalog.seal(operation, this.policy);
        this.ensure();
        operation = await this.catalog.queue(operation, this.policy);
      }
      this.ensure();
      if (operation.phase !== "queued") {
        await this.stop(operation);
        return { operation };
      }
      const bundle = await this.catalog.authorizedBundle(
        operation,
        this.policy,
      );
      this.ensure();
      if (!bundle) throw Error("Envelope guardado indisponível");
      await this.context.profile.putBundle(
        bundle,
        true,
        this.context.copyPolicy(
          operation.target.snapshotId,
          parseSiteAddress(operation.target.site).ownerId,
        ),
      );
      this.ensure();
      const actual = await this.context.profile.getBundle(bundle.manifest.id);
      this.ensure();
      operation = await this.catalog.markCopied(operation, actual);
      this.ensure();
      // An unchanged durable retry is still the same authorization. Replacing
      // its object would invalidate concurrent reads solely because a timer ran.
      // stop/revoke removes the object: a later grant must get a new identity,
      // so a reply retained across real revocation can never revive itself.
      const prior = this.allowed.get(actual.manifest.id);
      if (!prior || canonical(prior) !== canonical(operation))
        this.allowed.set(actual.manifest.id, structuredClone(operation));
      if (!(await this.canServe(actual)))
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
      this.ensure();
      await this.stop(operation);
      const current = (
        await this.catalog.operation(operation.sequence, operation.operationId)
      ).operation;
      this.ensure();
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
        const before = await this.catalog.state();
        this.ensure();
        await this.recoverReceipts(before.operations);
        this.ensure();
        const state = await this.catalog.state();
        this.ensure();
        const prior = new Set(this.allowed.keys());
        for (const op of state.operations) {
          if (op.transport) prior.delete(op.transport.bundleId);
          if (["prepared", "signed", "queued"].includes(op.phase))
            await this.finish(op);
          else await this.stop(op);
        }
        for (const id of prior) {
          this.allowed.delete(id);
          this.publishedAt.delete(id);
          await this.context.cancel(id);
          this.ensure();
        }
        await this.flushReceipts();
        this.ensure();
      });
    } catch {
      const ids = [
        ...this.allowed.keys(),
        ...this.receiptAllowed.keys(),
        ...this.rejectionAllowed.keys(),
      ];
      this.rejectionAllowed.clear();
      this.receiptAllowed.clear();
      this.allowed.clear();
      this.publishedAt.clear();
      for (const id of ids) await this.context.cancel(id).catch(() => {});
    } finally {
      this.ticking = false;
    }
  }
  command(input: unknown) {
    const value = contributionCommandShape(input),
      owner = this.context.profile.identity;
    if (!owner) throw Error("Desbloqueia a identidade");
    const command =
      value.action === "submit"
        ? {
            action: "submit" as const,
            ...registry.request(
              (({ action: _action, ...request }) => request)(value),
              owner.id,
            ).request,
          }
        : value;
    return this.serial(async () => {
      if (command.action === "form")
        return readContributionForm(command, {
          profile: this.context.profile,
          ensure: () => this.ensure(),
          policy: async (id, author) => {
            await this.context.profile.transactValues((values) =>
              this.policy(values, id, author),
            );
            return { blocked: [], withdrawn: false };
          },
        });
      if (command.action === "state") return this.catalog.state();
      if (command.action === "inbox") return this.inbox();
      if (command.action === "reject")
        return this.incoming.reject(
          command.id,
          command.revision,
          command.reason,
          this.policy,
        );
      if (command.action === "dismiss")
        return this.incoming.dismiss(command.id, command.revision);
      if (command.action === "obtain-source") {
        let found = await this.incoming.read(command.id, this.policy);
        this.ensure();
        if (!found || !found.entry.proof)
          throw Error("Candidata indisponível ou expirada");
        await this.completeSource(found.entry);
        this.ensure();
        found = await this.incoming.read(command.id, this.policy);
        this.ensure();
        if (!found || !found.entry.proof)
          throw Error("Candidata indisponível ou expirada");
        const snapshotId = found.entry.target.snapshotId;
        if (found.proposal)
          return { status: "available", snapshotId, requested: false };
        if (!this.context.requestSource)
          throw Error("Recuperação de origem indisponível");
        const requested = await this.context.requestSource(snapshotId);
        this.ensure();
        return { status: "waiting", snapshotId, requested };
      }
      if (command.action === "submit") {
        const { action: _action, ...request } = command;
        const op = await this.catalog.prepare(
          request,
          () => this.context.profile.getBundle(request.snapshotId),
          this.policy,
        );
        this.ensure();
        return this.finish(op);
      }
      const found = await this.catalog.operation(
        command.sequence,
        command.operationId,
      );
      this.ensure();
      if (command.action === "operation") return found;
      if (!found.operation)
        throw Error("Resultado de proposta desconhecido ou retirado");
      if (command.action === "cancel") {
        const operation = await this.catalog.cancel(found.operation);
        this.ensure();
        await this.stop(operation);
        return { operation };
      }
      return this.finish(found.operation);
    });
  }
  private expectedFailure(error: unknown) {
    this.ensure();
    if (error instanceof ContributionInboxIntegrityError) throw error;
  }
  receive(input: Bundle) {
    const bundle = JSON.parse(canonical(input)) as Bundle;
    return this.serial(() => this.receiveNow(bundle));
  }
  receiveSource(input: Bundle) {
    this.ensure();
    if (input.manifest.author.id !== this.context.profile.identity!.id)
      return Promise.resolve();
    const bundle = JSON.parse(canonical(input)) as Bundle;
    return this.serial(async () => {
      for (const entry of (await this.incoming.state()).entries) {
        this.ensure();
        if (
          entry.phase === "missing-source" &&
          entry.target.snapshotId === bundle.manifest.id
        )
          await this.completeSource(entry, bundle);
      }
    });
  }
  private async receiveNow(bundle: Bundle) {
    this.ensure();
    const owner = this.context.profile.identity!.id;
    if (
      bundle.manifest.kind !== "site-contribution" ||
      !bundle.manifest.keys.some((k) => k.reader === owner)
    )
      return;
    const content = envelopes.match(
      bundle,
      await this.context.profile.decrypt(bundle),
    );
    this.ensure();
    if (parseSiteAddress(content.proposal.body.target.site).ownerId !== owner)
      return;
    let source: Bundle | undefined;
    try {
      source = await this.context.profile.getBundle(
        content.proposal.body.target.snapshotId,
      );
    } catch {
      this.ensure();
    }
    this.ensure();
    if (source) {
      try {
        await this.incoming.checkSource(bundle, source);
      } catch (error) {
        this.expectedFailure(error);
        return;
      }
    }
    const result = await this.incoming.admit(bundle, this.policy);
    this.ensure();
    if (result.outcome !== "conflict")
      await this.completeSource(result.entry, source);
  }
  private async completeSource(
    entry: ContributionInboxEntry,
    supplied?: Bundle,
  ) {
    if (entry.phase !== "missing-source") return;
    let source: Bundle;
    try {
      source =
        supplied ??
        (await this.context.profile.getBundle(entry.target.snapshotId));
    } catch {
      this.ensure();
      return;
    }
    this.ensure();
    try {
      await this.incoming.attachSource(entry.id, source, this.policy);
    } catch (error) {
      this.expectedFailure(error);
    }
  }
  private async inbox() {
    const items: any[] = [],
      ids = await this.context.profile.ids(),
      present = new Set(ids);
    this.ensure();
    // Upgrade still-live pre-inbox cache entries without inventing a reception.
    for (const id of ids) {
      try {
        const bundle = await this.context.profile.getBundle(id);
        this.ensure();
        if (bundle.manifest.kind === "site-contribution")
          await this.receiveNow(bundle);
      } catch (error) {
        this.expectedFailure(error);
      }
    }
    for (const entry of (await this.incoming.state()).entries) {
      this.ensure();
      if (!entry.proof) continue;
      try {
        await this.completeSource(entry);
        const current = await this.incoming.read(entry.id, this.policy);
        this.ensure();
        if (!current || !current.entry.proof) continue;
        const e = current.entry,
          base = {
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
          if (!present.has(e.target.snapshotId))
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
      } catch (error) {
        this.expectedFailure(error);
      }
    }
    const management = contributionInboxManagement(await this.incoming.state());
    this.ensure();
    return { items, scope: "candidates", durable: true, management };
  }
}
