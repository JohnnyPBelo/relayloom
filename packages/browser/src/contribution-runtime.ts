import {
  BrowserContributionInbox,
  ContributionInboxIntegrityError,
} from "./contribution-inbox";
import type { ContributionInboxEntry } from "../../sites/src/contribution-inbox";
import type { Bundle } from "../../core/src/protocol";
import { canonical } from "../../core/src/protocol";
import { BrowserProfile, type ProfileValueTransaction } from "./profile";
import { BrowserContributionCatalog } from "./contribution-catalog";
import { browserCertificateCrypto } from "./certificate-crypto";
import {
  createContributionOperations,
  type ContributionOperation,
} from "../../sites/src/contribution-operations";
import { contributionCommandShape } from "../../sites/src/contribution-command";
import { readContributionForm } from "./contribution-read";
import { createContributionEnvelopeProtocol } from "../../sites/src/contribution-envelope";
import { parseSiteAddress } from "../../sites/src/protocol";
const registry = createContributionOperations(browserCertificateCrypto),
  envelopes = createContributionEnvelopeProtocol(browserCertificateCrypto);
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
}
export class BrowserContributionRuntime {
  private catalog: BrowserContributionCatalog;
  private incoming: BrowserContributionInbox;
  private generation: number;
  private closed = false;
  private tail = Promise.resolve();
  private nextRetry = 0;
  private ticking = false;
  private allowed = new Map<string, ContributionOperation>();
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
      await this.context.cancel(op.transport.bundleId);
      this.ensure();
    }
  }
  async canServe(bundle: Bundle) {
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
  async revokeInvalid() {
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
      this.allowed.set(actual.manifest.id, operation);
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
      });
    } catch {
      const ids = [...this.allowed.keys()];
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
      if (entry.phase === "expired") continue;
      try {
        await this.completeSource(entry);
        const current = await this.incoming.read(entry.id, this.policy);
        this.ensure();
        if (!current || current.entry.phase === "expired") continue;
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
    return { items, scope: "candidates", durable: true };
  }
}
