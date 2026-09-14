import { commitGroupSendIntent } from "./group-send.js";
import {
  readProfileState,
  writeProfileState,
} from "../../../packages/profile/src/state.js";
import {
  reconcileGroupOutbox,
  groupOutboxReservations,
  type GroupRetry,
} from "./group-outbox.js";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProfileOwnership } from "../../../packages/profile/src/ownership.js";
import { EventEmitter } from "node:events";
import {
  createIdentity,
  exportVault,
  importVault,
  validateIdentity,
  ContentStore,
  createBundle,
  decryptBundle,
  verifyBundle,
  atomic,
  type Identity,
  type PublicIdentity,
  type Bundle,
  type Manifest,
  canonical,
  hash,
} from "../../../packages/core/src/index.js";
import { validateContent } from "./content-validation.js";
import { type PrivateState } from "./local-state.js";
import { openPrivateProfile } from "./protected-private.js";
import { commitGroupConfirmation } from "./group-confirmations.js";
import { GroupSynchronizer } from "./group-sync.js";
import { NoticeSynchronizer } from "./group-notice-sync.js";
import {
  GroupNotices,
  GroupNoticeError,
  noticeManifestPolicy,
  openGroupNotice,
  verifyNoticeEnvelope,
} from "../../../packages/groups/src/notices.js";
import {
  GroupControlError,
  groupControlPolicy,
  verifyGroupControlEnvelope,
} from "../../../packages/groups/src/carriers.js";
import type { GroupRegistry } from "../../../packages/groups/src/registry.js";
import {
  commitGroupEvent,
  currentGroupEvent,
  localGroupEvents,
  groupEventSeeds,
} from "./group-events.js";
import type { ProfileDatabase } from "../../../packages/profile/src/database.js";
import { executeGroupCommand, type GroupCommand } from "./group-commands.js";
import {
  GroupAccess,
  hasGroupBinding,
  parseGroupBinding,
  type GroupDecision,
} from "../../../packages/groups/src/access.js";
import {
  GroupLedger,
  type HeldRecord,
} from "../../../packages/groups/src/ledger.js";
import {
  inspectGroupObjects,
  observeGroupObject,
  reconcileGroupReservations,
} from "./group-content.js";
import {
  Router,
  type Priority,
} from "../../../packages/transport/src/index.js";

import {
  applyCollectionCommand,
  validateCollections,
  validateFollowing,
  followedFeed,
  requireContentId,
  type CollectionCommand,
} from "./social.js";
import {
  admitOutbox,
  applyConfirmations,
  isPending,
  outboxItem,
  outboxPreview,
  requireOperationId,
  sendFingerprint,
  type OutboxEntry,
  type OutboxItem,
  OUTBOX_LIMITS,
} from "./outbox.js";

import type {
  Attachment,
  SiteBlock,
  Content,
  DisplayObject,
} from "../../../packages/content/src/types.js";
export type {
  Attachment,
  SiteBlock,
  Content,
  DisplayObject,
} from "../../../packages/content/src/types.js";
interface Config {
  contacts: PublicIdentity[];
  blocked: string[];
  following: string[];
  saved: string[];
  reports: { target: string; reason: string; at: number }[];
  relay: boolean;
  lowPower: boolean;
  quota: number;
  peers: { host: string; port: number }[];
}
export class LoomNode extends EventEmitter {
  identity?: Identity;
  private privateState: PrivateState = { mutations: {} };
  private privateDatabase?: ProfileDatabase;
  private privateDigest?: string;
  private summaryCache = new Map<
    string,
    { object: DisplayObject; bytes: number }
  >();
  private summaryCacheBytes = 0;
  private groupHolds: HeldRecord[] = [];
  private groupDecisions = new Map<string, GroupDecision>();
  readonly store: ContentStore;
  readonly router: Router;
  config: Config;
  lastTransportError = "";
  tcpPort = 0;
  private syncTimer: ReturnType<typeof setInterval>;
  private routes = new Map<string, unknown>();
  private requests = new Map<string, number>();
  private cancellations: (() => void)[] = [];
  private readonly ownership: ProfileOwnership;
  private stopped = false;
  private stopping?: Promise<void>;
  constructor(readonly dir: string) {
    super();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.ownership = new ProfileOwnership(dir);
    try {
      this.config = existsSync(join(dir, "config.json"))
        ? JSON.parse(readFileSync(join(dir, "config.json"), "utf8"))
        : {
            contacts: [],
            blocked: [],
            following: [],
            saved: [],
            reports: [],
            relay: true,
            lowPower: false,
            quota: 128 * 1024 * 1024,
            peers: [],
          };
      this.store = new ContentStore(join(dir, "store"), this.config.quota);
      this.router = new Router({
        relay: this.config.relay,
        validate: (payload) => this.validateWire(payload),
      });
      this.router.lowPower = this.config.lowPower;
      this.groupSync = new GroupSynchronizer({
        identity: () => this.identity,
        store: this.store,
        connected: () => this.router.peers.some((p) => p.connected),
        relay: () => this.config.relay,
        blocked: () => this.config.blocked,
        registry: <T>(fn: (g: GroupRegistry) => T) => this.controlRegistry(fn),
        apply: (command) => this.groupCommand(command),
        send: (bundle, relayed) => {
          this.router.broadcast(
            { type: "bundle", bundle },
            "normal",
            120_000,
            relayed,
          );
        },
        pauseGroups: () => this.cancelGroupPackets(true),
        needs: () =>
          [...this.summaryCache.values()].flatMap(({ object }) =>
            object.content.groupAudience
              ? [object.content.groupEpoch, object.content.targetEpoch]
                  .filter((id): id is string => !!id)
                  .map((epochId) => ({
                    groupId: object.content.conversation!,
                    epochId,
                  }))
              : [],
          ),
        receiveNotice: (bundle) => this.noticeSync.receive(bundle),
      });
      this.noticeSync = new NoticeSynchronizer({
        identity: () => this.identity,
        registry: <T>(fn: (g: GroupRegistry, notices: GroupNotices) => T) =>
          this.controlRegistry((g, notices) => fn(g, notices())),
        apply: (command) => this.groupCommand(command),
        publish: (value) => this.groupSync.publishNotice(value),
        blocked: () => this.config.blocked,
        ready: () => this.groupSync.ready,
        connected: () => this.router.peers.some((p) => p.connected),
      });
      this.router.on("payload", (payload, route) =>
        this.receive(payload, route),
      );
      this.router.on("transportError", (message) => {
        this.lastTransportError = message;
      });
      this.syncTimer = setInterval(() => this.sync(), 2200);
      this.syncTimer.unref();
    } catch (error) {
      this.ownership.close();
      throw error;
    }
  }
  get initialized() {
    return existsSync(join(this.dir, "identity.vault"));
  }
  private groupSync: GroupSynchronizer;
  private noticeSync: NoticeSynchronizer;
  private controlRegistry<T>(
    fn: (g: GroupRegistry, notices: () => GroupNotices) => T,
  ): T {
    const identity = this.requireIdentity();
    if (!this.privateDatabase || !this.privateDigest)
      throw new Error("Estado privado indisponível");
    try {
      return this.privateDatabase.transaction((tx) => {
        if (readProfileState(tx)?.digest !== this.privateDigest)
          throw new Error("Estado privado desactualizado");
        return GroupLedger.run(tx, identity, (_, g) =>
          fn(g, () => new GroupNotices(tx, identity.public)),
        ).value;
      });
    } catch (error) {
      if (
        error instanceof GroupControlError ||
        error instanceof GroupNoticeError
      )
        throw error;
      this.cancelGroupPackets(true);
      try {
        this.privateDatabase.close();
        const loaded = openPrivateProfile(this.dir, identity);
        this.privateDatabase = loaded.database;
        this.privateState = loaded.state;
        this.privateDigest = loaded.digest;
        this.restoreGroupHolds();
      } catch {
        this.lock();
      }
      throw error;
    }
  }
  private requireGroupReplay() {
    if (!this.groupSync.applying && !this.groupSync.drain())
      throw new Error(
        "A verificar controlos de grupo recebidos; tente novamente.",
      );
    this.requireIdentity();
  }
  private saveConfig() {
    this.requireRunning();
    atomic(join(this.dir, "config.json"), JSON.stringify(this.config));
  }
  async start(tcpPort = 0, host = "127.0.0.1") {
    this.requireRunning();
    this.tcpPort =
      tcpPort === -1 ? -1 : await this.router.listen(tcpPort, host);
    for (const p of this.config.peers)
      this.cancellations.push(this.router.connectTcp(p.host, p.port));
    return this.tcpPort;
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    this.stopping = (async () => {
      try {
        clearInterval(this.syncTimer);
        for (const cancel of this.cancellations) cancel();
        await this.router.stop();
        this.privateDatabase?.close();
        this.privateDatabase = undefined;
        this.privateDigest = undefined;
        this.ownership.close();
      } finally {
        this.identity = undefined;
        this.privateState = { mutations: {} };
        this.summaryCache.clear();
        this.summaryCacheBytes = 0;
        this.groupHolds = [];
        this.groupDecisions.clear();
      }
    })();
    return this.stopping;
  }
  private requireRunning() {
    if (this.stopped) throw new Error("Nó encerrado");
  }
  setup(name: string, password: string, recovery?: string) {
    this.requireRunning();
    if (this.initialized) throw new Error("Já existe uma identidade neste nó");
    const identity = recovery
      ? importVault(recovery, password)
      : createIdentity(name);
    atomic(join(this.dir, "identity.vault"), exportVault(identity, password));
    const loaded = openPrivateProfile(this.dir, identity);
    this.summaryCache.clear();
    this.summaryCacheBytes = 0;
    this.identity = identity;
    this.privateState = loaded.state;
    this.privateDatabase = loaded.database;
    this.privateDigest = loaded.digest;
    try {
      this.noticeSync.reset();
      this.groupSync.recover();
      this.restoreGroupHolds();
    } catch (error) {
      this.lock();
      throw error;
    }
    return identity.public;
  }
  unlock(password: string) {
    this.requireRunning();
    const identity = importVault(
      readFileSync(join(this.dir, "identity.vault"), "utf8"),
      password,
    );
    const loaded = openPrivateProfile(this.dir, identity);
    this.privateDatabase?.close();
    this.summaryCache.clear();
    this.summaryCacheBytes = 0;
    this.identity = identity;
    this.privateState = loaded.state;
    this.privateDatabase = loaded.database;
    this.privateDigest = loaded.digest;
    try {
      this.noticeSync.reset();
      this.groupSync.recover();
      this.restoreGroupHolds();
    } catch (error) {
      this.lock();
      throw error;
    }
    return identity.public;
  }
  lock() {
    this.cancelGroupPackets(true);
    this.groupSync.reset();
    this.noticeSync.reset();
    this.summaryCache.clear();
    this.summaryCacheBytes = 0;
    this.groupHolds = [];
    this.groupDecisions.clear();
    this.groupRetries.clear();
    this.groupEventSeeds.clear();
    this.identity = undefined;
    this.privateState = { mutations: {} };
    this.privateDatabase?.close();
    this.privateDatabase = undefined;
    this.privateDigest = undefined;
  }
  private requireIdentity() {
    this.requireRunning();
    if (!this.identity) throw new Error("Desbloqueie a identidade");
    return this.identity;
  }
  private groupRetries = new Map<string, GroupRetry>();
  private groupEventSeeds = new Set<string>();
  private cancelGroupPackets(all = false) {
    const ids = new Set(
      Object.values(this.privateState.outbox ?? {})
        .filter(
          (e) =>
            e.groupEpoch &&
            (all ||
              !(
                this.groupRetries.get(e.operationId)?.allowed ||
                this.groupRetries.get(e.operationId)?.seedAllowed
              )),
        )
        .map((e) => e.id),
    );
    this.router.cancelLocal((payload: any) => {
      if (payload?.type !== "bundle") return false;
      const manifest = payload.bundle?.manifest;
      if (ids.has(manifest?.id)) return true;
      if (
        manifest?.kind === "group-control" ||
        manifest?.kind === "group-notice"
      )
        return (
          (Array.isArray(manifest.keys) &&
            manifest.keys.some((k: any) =>
              this.config.blocked.includes(k.reader),
            )) ||
          (all && manifest.author?.id === this.identity?.public.id)
        );
      if (
        !manifest ||
        manifest.publicKey ||
        manifest.author?.id !== this.identity?.public.id ||
        !currentGroupEvent(manifest.kind)
      )
        return false;
      if (all) return true;
      try {
        const content = decryptBundle(payload.bundle, this.identity) as Content;
        return (
          hasGroupBinding(content) && !this.groupEventSeeds.has(manifest.id)
        );
      } catch {
        return true;
      }
    });
  }
  private reconcileGroupSends(stored?: readonly Manifest[]) {
    if (!this.identity || !this.privateDatabase || !this.privateDigest) return;
    const events = localGroupEvents(this.store, this.identity, stored);
    if (
      !events.length &&
      !Object.values(this.privateState.outbox ?? {}).some((e) => e.groupEpoch)
    ) {
      this.groupEventSeeds.clear();
      this.cancelGroupPackets();
      return;
    }
    const next = structuredClone(this.privateState);
    try {
      const decisions = this.privateDatabase.transaction((tx) => {
        if (readProfileState(tx)?.digest !== this.privateDigest)
          throw new Error("Estado privado desactualizado");
        return GroupLedger.run(tx, this.identity!, (l, registry) => ({
          outbox: reconcileGroupOutbox(l, next.outbox),
          events: groupEventSeeds(
            l,
            events,
            this.config.blocked,
            new GroupAccess(registry, this.identity!.public),
          ),
        })).value;
      });
      this.privateState = next;
      this.groupRetries = decisions.outbox;
      this.groupEventSeeds = decisions.events;
      this.cancelGroupPackets();
    } catch (error) {
      this.cancelGroupPackets(true);
      try {
        this.privateDatabase.close();
        const loaded = openPrivateProfile(this.dir, this.identity);
        this.privateDatabase = loaded.database;
        this.privateState = loaded.state;
        this.privateDigest = loaded.digest;
        this.groupRetries.clear();
        this.groupEventSeeds.clear();
      } catch {
        this.lock();
      }
      throw error;
    }
  }
  groupCommand(command: GroupCommand) {
    const identity = this.requireIdentity();
    if (
      ![
        "list",
        "state",
        "operation",
        "proofs",
        "private-state",
        "headers",
        "snapshot",
        "remember",
        "leave",
        "notice-list",
        "notice-outbox",
        "notice-dismiss",
        "notice-open",
      ].includes(command?.action)
    )
      this.requireGroupReplay();
    if (!this.privateDatabase || !this.privateDigest)
      throw new Error("Estado privado indisponível");
    try {
      const next = structuredClone(this.privateState);
      let decisions = this.groupRetries;
      const result = executeGroupCommand(
        this.privateDatabase,
        identity,
        this.privateDigest,
        command,
        (ledger) => {
          decisions = reconcileGroupOutbox(ledger, next.outbox);
        },
      );
      this.privateState = next;
      this.groupRetries = decisions;
      this.restoreGroupHolds();
      this.groupSync.record(command, result);
      if (
        [
          "headers",
          "snapshot",
          "commit",
          "close",
          "leave",
          "accept",
          "notice-open",
        ].includes(command.action)
      )
        this.cancelStaleNotices();
      this.noticeSync.record(command, result);
      return result;
    } catch (error) {
      // Reopen authenticated state after any uncertain outer commit. Never
      // replace it with the legacy JSON, or return success before verification.
      try {
        this.privateDatabase.close();
        const loaded = openPrivateProfile(this.dir, identity);
        this.privateDatabase = loaded.database;
        this.privateDigest = loaded.digest;
        this.privateState = loaded.state;
        this.restoreGroupHolds();
        if (
          [
            "headers",
            "snapshot",
            "commit",
            "close",
            "leave",
            "accept",
            "notice-open",
          ].includes(command?.action)
        )
          this.cancelStaleNotices();
      } catch {
        this.lock();
      }
      throw error;
    }
  }
  private observeGroup(id: string, protectedIds: ReadonlySet<string>) {
    const identity = this.requireIdentity();
    if (!this.privateDatabase || !this.privateDigest)
      throw new Error("Estado privado indisponível");
    try {
      const result = observeGroupObject(
        this.privateDatabase,
        identity,
        this.privateDigest,
        this.privateState,
        this.store,
        id,
        protectedIds,
      );
      this.privateState = result.state;
      this.privateDigest = result.digest;
      this.groupHolds = result.held;
      this.groupDecisions.set(id, result.decision);
      return result.decision.status === "accepted";
    } catch (error) {
      try {
        this.privateDatabase.close();
        const loaded = openPrivateProfile(this.dir, identity);
        this.privateDatabase = loaded.database;
        this.privateState = loaded.state;
        this.privateDigest = loaded.digest;
        this.restoreGroupHolds();
      } catch {
        this.lock();
      }
      throw error;
    }
  }
  private inspectGroups(
    objects: DisplayObject[],
    available: ReadonlySet<string>,
  ) {
    const identity = this.requireIdentity();
    if (!this.privateDatabase || !this.privateDigest)
      throw new Error("Estado privado indisponível");
    try {
      const result = inspectGroupObjects(
        this.privateDatabase,
        identity,
        this.privateDigest,
        objects,
      );
      reconcileGroupReservations(this.store, [
        ...groupOutboxReservations(this.privateState.outbox).filter(
          (id) => available.has(id) && this.store.has(id),
        ),
        ...result.held
          .filter(
            (entry) => available.has(entry.id) && this.store.has(entry.id),
          )
          .map((entry) => entry.id),
      ]);
      this.groupHolds = result.held;
      return result.results;
    } catch (error) {
      try {
        this.privateDatabase.close();
        const loaded = openPrivateProfile(this.dir, identity);
        this.privateDatabase = loaded.database;
        this.privateState = loaded.state;
        this.privateDigest = loaded.digest;
        this.restoreGroupHolds();
      } catch {
        this.lock();
      }
      throw error;
    }
  }
  private restoreGroupHolds() {
    if (!this.identity || !this.privateDatabase) return;
    const stored = this.store.list();
    this.reconcileGroupSends(stored);
    const held = this.privateDatabase
      .transaction(
        (tx) =>
          GroupLedger.run(tx, this.identity!, (ledger) => ledger.held()).value,
      )
      .filter((entry) => entry.expires > Date.now());
    const verified = new Set(stored.map((manifest) => manifest.id));
    this.store.setReservations([
      ...groupOutboxReservations(this.privateState.outbox).filter((id) =>
        verified.has(id),
      ),
      ...held
        .filter((entry) => verified.has(entry.id))
        .map((entry) => entry.id),
    ]);
    this.groupHolds = held;
  }
  saveDraft(blocks: SiteBlock[], theme: string) {
    this.requireIdentity();
    validateContent({ type: "site", blocks, theme });
    const next = {
      ...this.privateState,
      siteDraft: { blocks, theme, savedAt: Date.now() },
    };
    this.persistPrivate(next);
  }
  private persistPrivate(next = this.privateState) {
    const identity = this.requireIdentity();
    if (!this.privateDatabase || !this.privateDigest)
      throw new Error("Estado privado indisponível");
    try {
      if (
        Object.values({ ...this.privateState.outbox, ...next.outbox }).some(
          (e) => e.groupEpoch,
        )
      ) {
        next = structuredClone(next);
        let decisions = this.groupRetries;
        this.privateDigest = this.privateDatabase.transaction((tx) => {
          if (readProfileState(tx)?.digest !== this.privateDigest)
            throw new Error("Estado privado desactualizado");
          return GroupLedger.run(tx, identity, (ledger) => {
            decisions = reconcileGroupOutbox(ledger, next.outbox);
            ledger.retireStops(new Set(Object.keys(next.outbox ?? {})));
            return writeProfileState(
              tx,
              Buffer.from(canonical(next)),
              this.privateDigest!,
            );
          }).value;
        });
        this.groupRetries = decisions;
      } else {
        this.privateDigest = this.privateDatabase.write(
          Buffer.from(canonical(next)),
          this.privateDigest,
        );
      }
    } catch (error) {
      // Reopen with the signed installation binding after any uncertain SQL
      // completion. Never fall back to an older legacy JSON snapshot.
      try {
        this.privateDatabase.close();
        const recovered = openPrivateProfile(this.dir, identity);
        this.privateDatabase = recovered.database;
        this.privateDigest = recovered.digest;
        this.privateState = recovered.state;
      } catch {
        this.lock();
      }
      throw error;
    }
    this.privateState = next;
  }
  private sendResult(entry: OutboxEntry) {
    const { objects, outboxAt } = this.objectsSnapshot();
    entry = this.privateState.outbox![entry.operationId];
    const outbox = outboxItem(
      entry,
      outboxAt,
      this.config.blocked,
      objects.some((object) => object.id === entry.id),
      this.groupRetries.get(entry.operationId),
    );
    return { accepted: outbox.accepted, id: entry.id, outbox };
  }
  send(
    operationId: string,
    content: Content,
    recipients: string[],
    ttlMs = 30 * 86400_000,
  ) {
    const identity = this.requireIdentity();
    requireOperationId(operationId);
    if (!content || content.type !== "message")
      throw new Error("Esta operação aceita apenas mensagens privadas");
    const fingerprint = sendFingerprint(content, recipients, ttlMs);
    this.objects();
    const previous = this.privateState.outbox?.[operationId];
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new Error("Este identificador já pertence a outro envio");
      return this.sendResult(previous);
    }
    if (hasGroupBinding(content)) {
      this.requireGroupReplay();
      try {
        const intent = commitGroupSendIntent(
          this.privateDatabase!,
          identity,
          this.privateState,
          this.privateDigest!,
          operationId,
          fingerprint,
          content,
          recipients,
          ttlMs,
          this.config.blocked,
          new Set(this.store.list().map((manifest) => manifest.id)),
        );
        this.privateState = intent.state;
        this.privateDigest = intent.digest;
        try {
          this.store.putReserved(intent.bundle);
        } catch (error) {
          const failed = structuredClone(this.privateState);
          failed.outbox![operationId].phase = "unavailable";
          failed.outbox![operationId].lastError =
            "Não foi possível guardar o conteúdo do envio. Não foi criado outro ID.";
          try {
            this.persistPrivate(failed);
            this.restoreGroupHolds();
          } catch {
            this.lock();
          }
          throw error;
        }
        const ready = structuredClone(this.privateState);
        ready.outbox![operationId].phase = "ready";
        this.persistPrivate(ready);
        this.flushOutbox();
        return this.sendResult(this.privateState.outbox![operationId]);
      } catch (error) {
        if (this.identity) {
          try {
            this.privateDatabase?.close();
            const loaded = openPrivateProfile(this.dir, identity);
            this.privateDatabase = loaded.database;
            this.privateState = loaded.state;
            this.privateDigest = loaded.digest;
            this.restoreGroupHolds();
          } catch {
            this.lock();
          }
        }
        throw error;
      }
    }
    const { bundle, content: prepared } = this.preparePublication(
      content,
      recipients,
      ttlMs,
    );
    const readers = bundle.manifest.keys
      .map((k) => k.reader)
      .filter((id) => id !== identity.public.id);
    if (!readers.length) throw new Error("Escolha pelo menos um destinatário");
    const entry: OutboxEntry = {
      operationId,
      fingerprint,
      id: bundle.manifest.id,
      author: identity.public.id,
      conversation: prepared.conversation!,
      preview: outboxPreview(
        prepared.text || prepared.attachments?.[0]?.name || "Mensagem",
      ),
      created: bundle.manifest.created,
      expires: bundle.manifest.expires,
      priority:
        prepared.priority ?? (prepared.attachments?.length ? "bulk" : "normal"),
      bytes: Buffer.byteLength(canonical(bundle)),
      phase: "preparing",
      attempts: 0,
      lastAttemptAt: 0,
      nextAttemptAt: 0,
      lastError: "",
      manualPin: false,
      confirmations: Object.fromEntries(readers.map((id) => [id, {}])),
    };
    const next = {
      ...this.privateState,
      outbox: admitOutbox(this.privateState.outbox ?? {}, entry, Date.now()),
    };
    this.persistPrivate(next);
    try {
      this.store.put(bundle, true);
      const ready = structuredClone(this.privateState);
      ready.outbox![operationId].phase = "ready";
      this.persistPrivate(ready);
    } catch (error) {
      // A surviving preparing record is reconciled from the exact signed ID.
      // No broadcast occurred, and retry never signs a replacement silently.
      throw error;
    }
    this.flushOutbox();
    return this.sendResult(this.privateState.outbox![operationId]);
  }
  retryOutbox(operationId: string) {
    this.requireIdentity();
    requireOperationId(operationId);
    this.objects();
    const entry = this.privateState.outbox?.[operationId];
    if (!entry) throw new Error("Envio desconhecido");
    const item = outboxItem(entry, Date.now(), this.config.blocked);
    if (item.status !== "pending") return this.sendResult(entry);
    if (Date.now() < entry.lastAttemptAt + 2200)
      throw new Error("Aguarde antes de repetir a tentativa");
    const next = structuredClone(this.privateState);
    next.outbox![operationId].nextAttemptAt = Date.now();
    this.persistPrivate(next);
    this.flushOutbox();
    return this.sendResult(this.privateState.outbox![operationId]);
  }
  private checkReservedBundle(entry: OutboxEntry) {
    const bundle = this.store.get(entry.id, false);
    if (
      bundle.manifest.author.id !== entry.author ||
      bundle.manifest.kind !== "message" ||
      bundle.manifest.created !== entry.created ||
      bundle.manifest.expires !== entry.expires ||
      Buffer.byteLength(canonical(bundle)) !== entry.bytes ||
      canonical(bundle.manifest.keys.map((k) => k.reader).sort()) !==
        canonical([entry.author, ...Object.keys(entry.confirmations)].sort())
    )
      throw new Error("Reserva não corresponde ao envio");
    if (entry.groupEpoch) {
      const content = decryptBundle(bundle, this.requireIdentity()) as Content;
      validateContent(content);
      parseGroupBinding(content);
      if (
        content.conversation !== entry.conversation ||
        content.groupEpoch !== entry.groupEpoch
      )
        throw new Error("Reserva não corresponde à época de envio");
    }
    return bundle;
  }
  private reconcileOutbox(accepted: DisplayObject[], now = Date.now()) {
    if (!this.identity || !this.privateState.outbox) return;
    const next = structuredClone(this.privateState);
    let changed = applyConfirmations(next.outbox!, accepted, now);
    const verified = new Map(accepted.map((object) => [object.id, object]));
    const pins: { id: string; value: boolean }[] = [];
    for (const entry of Object.values(next.outbox!)) {
      if (isPending(entry, now)) {
        try {
          // Availability is independent of the current authority/proof pause.
          // A valid reserved group payload must not become unavailable merely
          // because it is not presently displayable.
          if (entry.phase === "preparing" || entry.groupEpoch)
            this.checkReservedBundle(entry);
          else {
            const current = verified.get(entry.id);
            if (
              !current ||
              current.author.id !== entry.author ||
              current.kind !== "message" ||
              current.created !== entry.created ||
              current.expires !== entry.expires ||
              current.public ||
              canonical([...current.readers].sort()) !==
                canonical(
                  [entry.author, ...Object.keys(entry.confirmations)].sort(),
                )
            )
              throw new Error("Reserva não corresponde ao conteúdo verificado");
          }
          if (entry.phase === "preparing") {
            // Re-establish the index write boundary after uncertain storage.
            if (entry.groupEpoch)
              this.store.pin(
                entry.id,
                entry.manualPin || this.store.isPinned(entry.id),
              );
            entry.phase = "ready";
            entry.lastError = "";
            changed = true;
          }
          if (entry.groupEpoch) {
            const reservations = this.store.reservations();
            if (!reservations.includes(entry.id))
              this.store.setReservations([...reservations, entry.id]);
          } else if (!this.store.isPinned(entry.id))
            pins.push({ id: entry.id, value: true });
        } catch {
          entry.phase = "unavailable";
          entry.lastError =
            "Conteúdo local indisponível ou corrompido. Não foi criado outro envio.";
          changed = true;
        }
      }
      if (
        !entry.groupEpoch &&
        !isPending(entry, now) &&
        !entry.manualPin &&
        this.store.isPinned(entry.id)
      )
        pins.push({ id: entry.id, value: false });
    }
    if (changed) this.persistPrivate(next);
    for (const pin of pins) {
      try {
        this.store.pin(pin.id, pin.value);
      } catch (error) {
        if (pin.value) throw error;
        // Expired/corrupt pending payload cannot pass pin() verification. Its
        // automatic reservation may be removed; explicit user pins survive.
        this.store.remove(pin.id);
      }
    }
  }
  private flushOutbox() {
    if (!this.identity || !this.router.peers.some((p) => p.connected)) return;
    this.reconcileGroupSends();
    const priorities = { sos: 0, normal: 1, bulk: 2 },
      now = Date.now();
    const due = Object.values(this.privateState.outbox ?? {})
      .filter(
        (e) =>
          (!e.groupEpoch ||
            (this.groupSync.ready &&
              this.groupRetries.get(e.operationId)?.allowed === true)) &&
          e.phase === "ready" &&
          outboxItem(e, now, this.config.blocked).status === "pending" &&
          e.nextAttemptAt <= now,
      )
      .sort(
        (a, b) =>
          priorities[a.priority] - priorities[b.priority] ||
          a.created - b.created ||
          a.id.localeCompare(b.id),
      )
      .slice(0, 2);
    for (const entry of due) {
      try {
        const bundle = this.checkReservedBundle(entry),
          next = structuredClone(this.privateState);
        const attempt = next.outbox![entry.operationId];
        attempt.attempts = Math.min(1_000_000, attempt.attempts + 1);
        attempt.lastAttemptAt = now;
        attempt.nextAttemptAt =
          now + Math.min(60_000, 2200 * 2 ** Math.min(5, attempt.attempts - 1));
        attempt.lastError = "";
        this.persistPrivate(next);
        this.router.broadcast({ type: "bundle", bundle }, entry.priority);
      } catch {
        if (!this.identity || !this.privateState.outbox?.[entry.operationId])
          return;
        const next = structuredClone(this.privateState);
        next.outbox![entry.operationId].lastError =
          "Tentativa adiada; a confirmação do destinatário continua pendente.";
        try {
          this.persistPrivate(next);
        } catch {
          /* No unjournalled new broadcast. */
        }
        this.lastTransportError =
          "Envio pendente; nova tentativa quando possível.";
      }
    }
  }
  private receiptReaders(object: DisplayObject): string[] | undefined {
    if (object.readers.some((id) => this.config.blocked.includes(id))) return;
    if (hasGroupBinding(object.content)) return object.readers;
    const additions = (object.content.members ?? []).filter(
      (card) =>
        card.id !== this.identity?.public.id &&
        validateIdentity(card) &&
        !this.config.contacts.some((c) => c.id === card.id),
    );
    if (additions.length) {
      const previous = this.config.contacts;
      this.config.contacts = [
        ...previous,
        ...additions.slice(0, Math.max(0, 256 - previous.length)),
      ];
      try {
        this.saveConfig();
      } catch {
        this.config.contacts = previous;
      }
    }
    return object.readers;
  }
  private publishConfirmation(
    message: DisplayObject,
    kind: "receipt" | "delivery",
  ) {
    if (hasGroupBinding(message.content)) {
      const identity = this.requireIdentity();
      try {
        const bundle = commitGroupConfirmation(
          this.privateDatabase!,
          identity,
          this.privateDigest!,
          this.store,
          message.id,
          kind,
          this.config.blocked,
        );
        this.store.put(bundle);
        this.router.broadcast({ type: "bundle", bundle }, "normal", 120_000);
        return this.display(bundle)!;
      } catch (error) {
        try {
          this.privateDatabase?.close();
          const loaded = openPrivateProfile(this.dir, identity);
          this.privateDatabase = loaded.database;
          this.privateState = loaded.state;
          this.privateDigest = loaded.digest;
          this.restoreGroupHolds();
        } catch {
          this.lock();
        }
        throw error;
      }
    }
    return this.commitPublication(
      this.preparePublication(
        { type: kind, target: message.id },
        message.readers,
        Math.max(1000, message.expires - Date.now()),
        message.content.members ?? [],
      ),
    );
  }
  private issueDeliveries(objects: DisplayObject[]) {
    let issued = 0;
    for (const message of objects) {
      if (issued >= 2) break;
      if (
        message.kind !== "message" ||
        message.deleted ||
        message.author.id === this.identity?.public.id ||
        objects.some(
          (e) =>
            ["delivery", "receipt"].includes(e.kind) &&
            e.content.target === message.id &&
            e.author.id === this.identity?.public.id,
        )
      )
        continue;
      const readers = this.receiptReaders(message);
      if (!readers) continue;
      issued++;
      try {
        this.publishConfirmation(message, "delivery");
      } catch {
        /* Reading remains valid even when a confirmation cannot be sent. */
      }
    }
  }
  collection(command: CollectionCommand) {
    const identity = this.requireIdentity();
    if (
      command.action === "add" &&
      !this.objects().some((o) => o.id === command.objectId)
    )
      throw new Error("Só pode guardar conteúdo disponível e autorizado");
    const collections = applyCollectionCommand(
      this.privateState.collections ?? [],
      identity.public.id,
      command,
      Date.now(),
    );
    this.persistPrivate({ ...this.privateState, collections });
    return collections;
  }
  retrieve(value: unknown) {
    this.requireIdentity();
    const id = requireContentId(value);
    if (this.store.has(id)) {
      const object = this.objects().find((o) => o.id === id);
      return { status: object ? "available" : "unreadable", id };
    }
    if (Date.now() - (this.requests.get("user:" + id) ?? 0) > 1500) {
      this.markRequest("user:" + id);
      this.router.broadcast({ type: "request", ids: [id] });
    }
    return { status: "requested", id };
  }
  export(password: string) {
    return exportVault(this.requireIdentity(), password);
  }
  addContact(contact: PublicIdentity) {
    this.requireIdentity();
    if (contact.id === this.identity!.public.id)
      throw new Error("Este cartão é da sua própria identidade");
    if (!validateIdentity(contact))
      throw new Error("Cartão de contacto ou assinatura inválidos");
    if (
      this.config.contacts.length >= 256 &&
      !this.config.contacts.some((c) => c.id === contact.id)
    )
      throw new Error("Limite de contactos");
    this.config.contacts = [
      ...this.config.contacts.filter((c) => c.id !== contact.id),
      contact,
    ];
    this.saveConfig();
  }
  connect(host: string, port: number) {
    this.requireIdentity();
    if (this.config.peers.some((p) => p.host === host && p.port === port))
      return;
    if (this.config.peers.length >= 16) throw new Error("Limite de ligações");
    if (!this.config.peers.some((p) => p.host === host && p.port === port)) {
      this.cancellations.push(this.router.connectTcp(host, port));
      this.config.peers.push({ host, port });
      this.saveConfig();
    }
  }
  connectSerial(path: string, baud: number) {
    this.requireIdentity();
    this.cancellations.push(this.router.connectSerial(path, baud));
  }
  settings(patch: { relay?: boolean; lowPower?: boolean; quota?: number }) {
    this.requireIdentity();
    if (
      (patch.relay !== undefined && typeof patch.relay !== "boolean") ||
      (patch.lowPower !== undefined && typeof patch.lowPower !== "boolean")
    )
      throw new Error("Definições inválidas");
    if (patch.quota !== undefined) {
      this.store.setQuota(patch.quota);
      this.config.quota = patch.quota;
    }
    if (patch.relay !== undefined)
      this.config.relay = this.router.relay = patch.relay;
    if (patch.lowPower !== undefined)
      this.config.lowPower = this.router.lowPower = patch.lowPower;
    this.saveConfig();
  }
  localAction(action: string, target: string, value: boolean, reason = "") {
    this.requireIdentity();
    if (typeof value !== "boolean") throw new Error("Valor da acção inválido");
    if (!/^[a-f0-9]{64}$/.test(target)) throw new Error("Endereço inválido");
    if (action === "pin") {
      const entry = Object.values(this.privateState.outbox ?? {}).find(
        (e) => e.id === target,
      );
      if (entry && !value && isPending(entry, Date.now()))
        throw new Error(
          "O conteúdo está reservado até à confirmação ou expiração do envio.",
        );
      if (entry) {
        const next = structuredClone(this.privateState);
        next.outbox![entry.operationId].manualPin = value;
        this.persistPrivate(next);
      }
      this.store.pin(target, value);
    } else if (action === "block" || action === "follow" || action === "save") {
      const key =
        action === "block"
          ? "blocked"
          : action === "follow"
            ? "following"
            : "saved";
      const next = [
        ...this.config[key].filter((id) => id !== target),
        ...(value ? [target] : []),
      ];
      if (next.length > 2048) throw new Error("Limite de preferências locais");
      this.config[key] = key === "following" ? validateFollowing(next) : next;
    } else if (action === "report") {
      if (!reason.trim() || reason.length > 500)
        throw new Error("Indique um motivo até 500 caracteres");
      this.config.reports = [
        ...this.config.reports.slice(-199),
        { target, reason, at: Date.now() },
      ];
    } else throw new Error("Acção desconhecida");
    this.saveConfig();
    if (action === "block") this.reconcileGroupSends();
  }
  private preparePublication(
    content: Content,
    recipients: string[] | "public",
    ttlMs?: number,
    confirmedCards: PublicIdentity[] = [],
  ): { bundle: Bundle; content: Content; mutationTarget?: Manifest } {
    const identity = this.requireIdentity();
    validateContent(content);
    if (hasGroupBinding(content))
      throw new Error("O envio neste grupo ainda não está disponível");
    let mutationTarget: Manifest | undefined;
    const cards = [identity.public, ...confirmedCards, ...this.config.contacts];
    const readers =
      recipients === "public"
        ? "public"
        : [...new Set([...recipients, identity.public.id])].map((id) => {
            const card = cards.find((c) => c.id === id);
            if (!card)
              throw new Error("Adicione primeiro o cartão do destinatário");
            if (this.config.blocked.includes(id))
              throw new Error("Contacto bloqueado");
            return card;
          });
    if (content.type === "group" && !content.title?.trim())
      throw new Error("Indique o nome do grupo");
    if (
      ["message", "group", "receipt", "delivery"].includes(content.type) &&
      readers === "public"
    )
      throw new Error("Conversas exigem destinatários privados");
    if (content.type === "message") {
      if (!content.text?.trim() && !content.attachments?.length)
        throw new Error("Escreva uma mensagem ou junte um anexo");
      if (!content.conversation)
        content = {
          ...content,
          conversation:
            "dm:" +
            hash(
              (readers as PublicIdentity[])
                .map((c) => c.id)
                .sort()
                .join(":"),
            ),
        };
      const group = this.objects().find(
        (o) => o.id === content.conversation && o.kind === "group",
      );
      if (content.conversation!.startsWith("dm:")) {
        if (
          content.conversation !==
          "dm:" +
            hash(
              (readers as PublicIdentity[])
                .map((c) => c.id)
                .sort()
                .join(":"),
            )
        )
          throw new Error("Destinatários não correspondem à conversa");
      } else if (
        !group ||
        !group.content.members?.some((m) => m.id === identity.public.id) ||
        canonical(group.content.members.map((m) => m.id).sort()) !==
          canonical((readers as PublicIdentity[]).map((m) => m.id).sort())
      )
        throw new Error("Grupo ou autorização inválidos");
      content = { ...content, members: readers as PublicIdentity[] };
    }
    if (content.type === "group")
      content = { ...content, members: readers as PublicIdentity[] };
    if (
      ["edit", "delete", "reaction", "comment", "receipt", "delivery"].includes(
        content.type,
      )
    ) {
      const original = this.store.get(content.target!);
      const originalContent = decryptBundle(original, identity) as Content;
      if (
        originalContent &&
        typeof originalContent === "object" &&
        hasGroupBinding(originalContent)
      )
        throw new Error("Esta acção ainda não está disponível neste grupo");
      if (!this.objects().some((o) => o.id === content.target))
        throw new Error("Alvo sem autorização semântica");
      if (
        ["receipt", "delivery"].includes(content.type) &&
        (original.manifest.kind !== "message" ||
          original.manifest.author.id === identity.public.id)
      )
        throw new Error("Confirmação de leitura inválida");
      if (["edit", "delete"].includes(content.type)) {
        ttlMs = Math.max(1000, original.manifest.expires - Date.now());
        mutationTarget = original.manifest;
      }
      if (
        ["edit", "delete"].includes(content.type) &&
        original.manifest.author.id !== identity.public.id
      )
        throw new Error("Só o autor pode alterar este conteúdo");
      if (
        [
          "edit",
          "delete",
          "receipt",
          "delivery",
          "reaction",
          "comment",
        ].includes(original.manifest.kind)
      )
        throw new Error("Alvo inválido");
      // Follow the original privacy boundary for all related events.
      const targetReaders = original.manifest.publicKey
        ? "public"
        : original.manifest.keys.map((k) => k.reader).sort();
      const requested =
        readers === "public" ? "public" : readers.map((r) => r.id).sort();
      if (canonical(targetReaders) !== canonical(requested))
        throw new Error("A privacidade deve corresponder ao conteúdo original");
    }
    const bundle = createBundle(
      identity,
      content.type,
      content,
      readers,
      ttlMs,
    );
    return { bundle, content, mutationTarget };
  }
  publish(
    content: Content,
    recipients: string[] | "public",
    ttlMs?: number,
  ): DisplayObject {
    if (hasGroupBinding(content)) {
      if (content.groupAudience !== "historical") this.requireGroupReplay();
      const identity = this.requireIdentity();
      this.objects(); // Admit the verified original before an event can evict it.
      if (!this.privateDatabase || !this.privateDigest)
        throw new Error("Estado privado indisponível");
      let bundle: Bundle;
      try {
        bundle = commitGroupEvent(
          this.privateDatabase,
          identity,
          this.privateDigest,
          this.store,
          content,
          recipients,
          this.config.blocked,
          ttlMs,
        );
      } catch (error) {
        try {
          this.privateDatabase.close();
          const loaded = openPrivateProfile(this.dir, identity);
          this.privateDatabase = loaded.database;
          this.privateState = loaded.state;
          this.privateDigest = loaded.digest;
          this.restoreGroupHolds();
        } catch {
          this.lock();
        }
        throw error;
      }
      this.store.put(bundle);
      if (
        !this.observeGroup(
          bundle.manifest.id,
          new Set(this.store.list().map((m) => m.id)),
        )
      )
        throw new Error("O evento não pôde ser admitido");
      this.reconcileGroupSends();
      if (!this.maySeed(bundle.manifest))
        throw new Error("O grupo já não autoriza este evento");
      this.router.broadcast({ type: "bundle", bundle }, "normal");
      return this.display(bundle)!;
    }
    return this.commitPublication(
      this.preparePublication(content, recipients, ttlMs),
    );
  }
  private commitPublication(prepared: {
    bundle: Bundle;
    content: Content;
    mutationTarget?: Manifest;
  }): DisplayObject {
    const { bundle, mutationTarget, content } = prepared;
    this.store.put(bundle, ["site", "group"].includes(content.type));
    if (mutationTarget) {
      const next = structuredClone(this.privateState),
        before = next.mutations[mutationTarget.id];
      if (
        !before ||
        bundle.manifest.created > before.created ||
        (bundle.manifest.created === before.created &&
          bundle.manifest.id > before.eventId) ||
        (content.type === "delete" && !before.deleted)
      ) {
        next.mutations[mutationTarget.id] = {
          author: mutationTarget.author.id,
          expires: mutationTarget.expires,
          created: bundle.manifest.created,
          eventId: bundle.manifest.id,
          ...(before?.deleted || content.type === "delete"
            ? { deleted: true }
            : { text: content.text ?? "" }),
        };
        this.persistPrivate(next);
      }
    }
    this.router.broadcast(
      { type: "bundle", bundle },
      content.priority ?? (content.attachments?.length ? "bulk" : "normal"),
    );
    return this.display(bundle)!;
  }
  private maySeed(manifest: Manifest) {
    if (manifest.kind === "group-notice") {
      if (
        !noticeManifestPolicy(manifest) ||
        manifest.keys.some((k) => this.config.blocked.includes(k.reader))
      )
        return false;
      if (!this.identity) return !this.initialized;
      if (manifest.author.id !== this.identity.public.id) return true;
      if (!this.groupSync.ready) return false;
      return this.noticeSync.mayPublish(
        openGroupNotice(this.store.get(manifest.id, false), this.identity),
      );
    }
    if (manifest.kind === "group-control")
      return (
        groupControlPolicy(manifest) &&
        !manifest.keys.some((k) => this.config.blocked.includes(k.reader))
      );
    if (
      (manifest.kind !== "message" && !currentGroupEvent(manifest.kind)) ||
      manifest.publicKey
    )
      return true;
    // A cold locked profile cannot authenticate its own private retry history.
    // Transit relay remains active; a fresh relay without an identity can seed.
    if (!this.identity) return !this.initialized;
    if (manifest.author.id !== this.identity.public.id) return true;
    const content = decryptBundle(
      this.store.get(manifest.id, false),
      this.identity,
    ) as Content;
    validateContent(content);
    if (!hasGroupBinding(content)) return true;
    if (!this.groupSync.ready) return false;
    if (currentGroupEvent(manifest.kind))
      return this.groupEventSeeds.has(manifest.id);
    const entry = Object.values(this.privateState.outbox ?? {}).find(
      (e) => e.id === manifest.id,
    );
    if (
      !entry ||
      entry.phase !== "ready" ||
      !entry.groupEpoch ||
      entry.groupEpoch !== content.groupEpoch ||
      entry.conversation !== content.conversation ||
      !this.groupRetries.get(entry.operationId)?.seedAllowed ||
      Object.keys(entry.confirmations).some((id) =>
        this.config.blocked.includes(id),
      )
    )
      return false;
    this.checkReservedBundle(entry);
    return true;
  }
  private validateWire(payload: any) {
    if (!payload || !["bundle", "inventory", "request"].includes(payload.type))
      throw new Error("Protocolo inválido");
    if (payload.type === "bundle") {
      if (payload.bundle?.manifest?.kind === "group-control")
        verifyGroupControlEnvelope(payload.bundle);
      else if (payload.bundle?.manifest?.kind === "group-notice")
        verifyNoticeEnvelope(payload.bundle);
      else verifyBundle(payload.bundle);
    } else if (
      !Array.isArray(payload.ids) ||
      payload.ids.length > 64 ||
      payload.ids.some(
        (id: unknown) => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id),
      )
    )
      throw new Error("Inventário inválido");
  }
  private cancelStaleNotices() {
    const identity = this.identity;
    if (!identity) return;
    const allowed = new Map<string, boolean>();
    const certificates = new Map<string, boolean>();
    for (const manifest of this.store.list()) {
      if (
        manifest.kind !== "group-notice" ||
        manifest.author.id !== identity.public.id
      )
        continue;
      try {
        const notice = openGroupNotice(
          this.store.get(manifest.id, false),
          identity,
        );
        if (!certificates.has(notice.certificate.id))
          certificates.set(
            notice.certificate.id,
            this.noticeSync.mayPublish(notice),
          );
        allowed.set(manifest.id, certificates.get(notice.certificate.id)!);
      } catch {
        allowed.set(manifest.id, false);
      }
    }
    this.router.cancelLocal((payload: any) => {
      if (
        payload?.type !== "bundle" ||
        payload.bundle?.manifest?.kind !== "group-notice" ||
        payload.bundle.manifest.author.id !== identity.public.id
      )
        return false;
      const id = payload.bundle.manifest.id;
      return !allowed.get(id);
    });
  }
  private markRequest(id: string) {
    if (!this.requests.has(id) && this.requests.size >= 2048)
      this.requests.clear();
    this.requests.set(id, Date.now());
  }
  private receive(payload: any, route: unknown) {
    if (this.stopped) return;
    try {
      if (payload.type === "bundle") {
        if (
          this.config.blocked.includes(payload.bundle.manifest.author.id) &&
          payload.bundle.manifest.kind !== "group-control" &&
          payload.bundle.manifest.kind !== "group-notice"
        )
          return;
        if (payload.bundle.manifest.kind === "group-control") {
          verifyGroupControlEnvelope(payload.bundle);
          this.store.put(payload.bundle);
          this.groupSync.receive(payload.bundle);
          return;
        }
        if (payload.bundle.manifest.kind === "group-notice") {
          verifyNoticeEnvelope(payload.bundle);
          this.store.put(payload.bundle);
          this.noticeSync.receive(payload.bundle);
          return;
        }
        if (
          this.identity &&
          ["edit", "delete", "receipt", "delivery"].includes(
            payload.bundle.manifest.kind,
          )
        ) {
          const event = this.display(payload.bundle, true);
          if (event && !hasGroupBinding(event.content)) {
            const known = this.objects();
            if (this.authorized(event, [...known, event])) {
              if (["edit", "delete"].includes(event.kind))
                this.materializeMutations([...known, event]);
              else this.reconcileOutbox([...known, event]);
            }
          }
        }
        if (this.identity) {
          const incoming = this.display(payload.bundle, true);
          if (
            incoming &&
            hasGroupBinding(incoming.content) &&
            (incoming.content.target || incoming.content.replyTo)
          )
            this.objects(); // Admit the verified target before a put can evict it.
        }
        if (this.store.put(payload.bundle)) {
          this.routes.set(payload.bundle.manifest.id, route);
          if (this.routes.size > 1000)
            this.routes.delete(this.routes.keys().next().value!);
          this.emit("content");
        }
      } else if (payload.type === "inventory") {
        const missing = payload.ids
          .filter(
            (id: string) =>
              !this.store.has(id) &&
              Date.now() - (this.requests.get(id) ?? 0) > 5000,
          )
          .slice(0, 8);
        if (missing.length) {
          for (const id of missing) this.markRequest(id);
          this.router.broadcast(
            { type: "request", ids: missing },
            "normal",
            120_000,
            true,
          );
        }
      } else {
        if (!this.config.relay) return;
        this.reconcileGroupSends();
        for (const id of payload.ids.slice(0, 8))
          if (
            this.store.has(id) &&
            Date.now() - (this.requests.get("serve:" + id) ?? 0) > 1000
          ) {
            this.markRequest("serve:" + id);
            const bundle = this.store.get(id, false);
            if (!this.maySeed(bundle.manifest)) continue;
            this.router.broadcast(
              { type: "bundle", bundle },
              bundle.manifest.kind === "alert" ? "sos" : "bulk",
              120_000,
              true,
            );
          }
      }
      if (this.requests.size > 2048) this.requests.clear();
    } catch {
      this.router.counters.rejected++;
    }
  }
  sync() {
    if (this.stopped) return;
    try {
      if (this.identity) {
        this.groupSync.tick();
        this.noticeSync.tick();
        const objects = this.objects();
        this.issueDeliveries(objects);
        this.flushOutbox();
      }
      if (!this.router.peers.some((p) => p.connected) || !this.config.relay)
        return;
      const ids = this.store
        .list()
        .filter((m) => this.maySeed(m))
        .map((m) => m.id);
      if (ids.length) {
        const start =
          (Math.floor(Date.now() / 2200) * 64) %
          Math.max(64, Math.ceil(ids.length / 64) * 64);
        this.router.broadcast(
          { type: "inventory", ids: ids.slice(start, start + 64) },
          "normal",
          120_000,
          true,
        );
      }
    } catch {
      this.lastTransportError =
        "Sincronização adiada; o estado local será verificado na próxima tentativa.";
    }
  }
  private display(bundle: Bundle, summary = false): DisplayObject | undefined {
    try {
      const content = decryptBundle(bundle, this.identity) as Content;
      validateContent(content);
      if (content.type !== bundle.manifest.kind) return;
      if (hasGroupBinding(content)) parseGroupBinding(content);
      return {
        id: bundle.manifest.id,
        kind: bundle.manifest.kind,
        author: bundle.manifest.author,
        created: bundle.manifest.created,
        expires: bundle.manifest.expires,
        content: summary ? this.summarizeContent(content) : content,
        pinned: this.store.isPinned(bundle.manifest.id),
        readers: bundle.manifest.keys.map((k) => k.reader),
        public: !!bundle.manifest.publicKey,
        route: this.routes.get(bundle.manifest.id),
      };
    } catch {
      return;
    }
  }
  private summarizeContent(content: Content): Content {
    const out: Content = { type: content.type };
    const fields = ["text", "title", "priority"];
    if (hasGroupBinding(content))
      fields.push("conversation", "groupAudience", "groupEpoch", "targetEpoch");
    if (["message", "group"].includes(content.type))
      fields.push("conversation", "members");
    if (content.type === "message") fields.push("replyTo");
    if (
      ["comment", "reaction", "edit", "delete", "receipt", "delivery"].includes(
        content.type,
      )
    )
      fields.push("target");
    if (content.type === "reaction") fields.push("emoji", "value");
    for (const field of fields)
      if (content[field] !== undefined) out[field] = content[field];
    if (content.type === "site") {
      if (content.theme !== undefined) out.theme = content.theme;
      out.blocks = content.blocks!.map((b) => ({
        id: b.id,
        type: b.type,
        title: b.title,
        body: b.body,
        ...(b.url ? { url: b.url } : {}),
      }));
    }
    if (
      content.attachments &&
      ["message", "post", "alert"].includes(content.type)
    )
      out.attachments = content.attachments.map((a) => ({
        name: a.name,
        mime: a.mime,
        data: "",
        size: Buffer.from(a.data, "base64").length,
      }));
    return out;
  }
  objects(): DisplayObject[] {
    return this.objectsSnapshot().objects;
  }
  private objectsSnapshot(): { objects: DisplayObject[]; outboxAt: number } {
    this.requireRunning();
    if (!this.identity) return { objects: [], outboxAt: Date.now() };
    if (!this.groupSync.applying) this.groupSync.drain();
    if (!this.identity) return { objects: [], outboxAt: Date.now() };
    const stored = this.store.list();
    this.reconcileGroupSends(stored);
    const verifiedIds = new Set(stored.map((manifest) => manifest.id));
    const manifests = stored.filter(
      (m) =>
        m.kind !== "group-control" &&
        m.kind !== "group-notice" &&
        (!this.config.blocked.includes(m.author.id) || m.kind === "group"),
    );
    const present = new Set(manifests.map((m) => m.id));
    for (const [id, entry] of this.summaryCache)
      if (!present.has(id)) {
        this.summaryCache.delete(id);
        this.summaryCacheBytes -= entry.bytes;
      }
    const all = manifests.flatMap((m) => {
      try {
        // List validates the current bounded file-byte fingerprint; immutable IDs
        // may reuse metadata already decrypted by this unlocked identity.
        const cached = this.summaryCache.get(m.id);
        let object = cached
          ? structuredClone(cached.object)
          : this.display(this.store.get(m.id, false), true);
        if (!object) return [];
        if (!cached) {
          const bytes = Buffer.byteLength(JSON.stringify(object));
          while (
            this.summaryCache.size &&
            (this.summaryCacheBytes + bytes > 16 * 1024 * 1024 ||
              this.summaryCache.size >= 1024)
          ) {
            const oldest = this.summaryCache.keys().next().value!;
            this.summaryCacheBytes -= this.summaryCache.get(oldest)!.bytes;
            this.summaryCache.delete(oldest);
          }
          if (bytes <= 16 * 1024 * 1024) {
            this.summaryCache.set(m.id, {
              object: structuredClone(object),
              bytes,
            });
            this.summaryCacheBytes += bytes;
          }
        }
        object.pinned = this.store.isPinned(m.id);
        object.route = this.routes.get(m.id);
        return [object];
      } catch {
        return [];
      }
    });
    this.groupDecisions.clear();
    const groupObjects = this.groupSync.ready
      ? all.filter(
          (object) =>
            hasGroupBinding(object.content) &&
            !this.config.blocked.includes(object.author.id),
        )
      : [];
    const inspected =
      groupObjects.length || this.groupHolds.length
        ? this.inspectGroups(groupObjects, verifiedIds)
        : new Map<string, { decision: GroupDecision; stable: boolean }>();
    const protectedIds = new Set([
      ...verifiedIds,
      ...Object.values(this.privateState.outbox ?? {}).map((entry) => entry.id),
    ]);
    const accepted = all.filter((o) => {
      if (this.config.blocked.includes(o.author.id)) return false;
      if (!hasGroupBinding(o.content)) return this.authorized(o, all);
      if (!this.groupSync.ready) return false;
      const observation = inspected.get(o.id);
      if (observation?.stable) {
        this.groupDecisions.set(o.id, observation.decision);
        return observation.decision.status === "accepted";
      }
      return this.observeGroup(o.id, protectedIds);
    });
    this.materializeMutations(accepted);
    // Reserve changes and their displayed state share one observation time,
    // even when persistence or later snapshot projection crosses an expiry.
    const outboxAt = Date.now();
    this.reconcileOutbox(accepted, outboxAt);
    const objects = accepted.map((o) => {
      const mutation = this.privateState.mutations[o.id];
      return mutation?.author === o.author.id
        ? {
            ...o,
            deleted: mutation.deleted ?? false,
            ...(mutation.text !== undefined
              ? { editedText: mutation.text }
              : {}),
          }
        : o;
    });
    return { objects, outboxAt };
  }
  private materializeMutations(accepted: DisplayObject[]) {
    let changed = false;
    const nextPrivate = structuredClone(this.privateState);
    for (const event of accepted)
      if (
        ["edit", "delete"].includes(event.kind) &&
        !hasGroupBinding(event.content)
      ) {
        const original = accepted.find((o) => o.id === event.content.target)!;
        const before = nextPrivate.mutations[original.id];
        if (
          !before ||
          event.created > before.created ||
          (event.created === before.created &&
            event.id > (before.eventId ?? "")) ||
          (event.kind === "delete" && !before.deleted)
        ) {
          nextPrivate.mutations[original.id] = {
            author: original.author.id,
            expires: original.expires,
            created: event.created,
            eventId: event.id,
            ...(before?.deleted || event.kind === "delete"
              ? { deleted: true }
              : { text: event.content.text ?? "" }),
          };
          changed = true;
        }
      }
    for (const [id, m] of Object.entries(nextPrivate.mutations))
      if (m.expires <= Date.now()) {
        delete nextPrivate.mutations[id];
        changed = true;
      }
    if (changed) this.persistPrivate(nextPrivate);
  }
  private authorized(o: DisplayObject, all: DisplayObject[]): boolean {
    if (hasGroupBinding(o.content)) return false;
    const readers = [...o.readers].sort();
    if (
      new Set(readers).size !== readers.length ||
      (!o.public && !readers.includes(o.author.id))
    )
      return false;
    if (
      ["message", "group", "receipt", "delivery"].includes(o.kind) &&
      o.public
    )
      return false;
    if (
      ["edit", "delete", "reaction", "comment", "receipt", "delivery"].includes(
        o.kind,
      )
    ) {
      const original = all.find((a) => a.id === o.content.target);
      if (
        !original ||
        [
          "edit",
          "delete",
          "reaction",
          "comment",
          "receipt",
          "delivery",
        ].includes(original.kind) ||
        !this.authorized(original, all)
      )
        return false;
      if (
        ["edit", "delete"].includes(o.kind) &&
        original.author.id !== o.author.id
      )
        return false;
      if (
        o.public !== original.public ||
        canonical(readers) !== canonical([...original.readers].sort())
      )
        return false;
      if (!original.public && !original.readers.includes(o.author.id))
        return false;
      if (
        ["receipt", "delivery"].includes(o.kind) &&
        (original.kind !== "message" || o.author.id === original.author.id)
      )
        return false;
      return true;
    }
    if (["message", "group"].includes(o.kind)) {
      const ids = o.content.members?.map((m) => m.id).sort();
      if (!ids || canonical(ids) !== canonical(readers)) return false;
      if (o.kind === "group")
        return (
          typeof o.content.title === "string" &&
          o.content.title.trim().length > 0
        );
      if (o.content.conversation?.startsWith("dm:"))
        return o.content.conversation === "dm:" + hash(ids.join(":"));
      const group = all.find(
        (g) => g.id === o.content.conversation && g.kind === "group",
      );
      return (
        !!group &&
        this.authorized(group, all) &&
        canonical(readers) === canonical([...group.readers].sort())
      );
    }
    return true;
  }

  view(id: string) {
    this.store.get(id);
    const object = this.objects().find((o) => o.id === id);
    if (!object) throw new Error("Sem autorização de leitura");
    if (
      object.kind === "message" &&
      !object.deleted &&
      this.identity &&
      object.author.id !== this.identity.public.id
    ) {
      const readers = this.receiptReaders(object);
      const existing = this.objects().some(
        (o) =>
          o.kind === "receipt" &&
          o.content.target === id &&
          o.author.id === this.identity!.public.id,
      );
      if (!existing && readers) {
        try {
          this.publishConfirmation(object, "receipt");
        } catch {
          /* An unavailable receipt must not prevent authorized reading. */
        }
      }
    }
    const full = this.display(this.store.get(id));
    if (!full) throw new Error("Sem autorização de leitura");
    return { ...object, content: full.content };
  }
  attachment(id: string, index: number): Attachment {
    this.requireIdentity();
    if (!Number.isInteger(index) || index < 0 || index > 3)
      throw new Error("Anexo inválido");
    const object = this.view(id);
    if (object.deleted) throw new Error("Conteúdo eliminado pelo autor");
    const attachment = object.content.attachments?.[index];
    if (!attachment) throw new Error("Anexo indisponível");
    return attachment;
  }
  history(before?: string) {
    this.requireIdentity();
    return this.pageObjects(this.objects(), before);
  }
  private pageObjects(objects: DisplayObject[], before?: string) {
    let end = objects.length;
    if (before !== undefined) {
      if (!/^[a-f0-9]{64}$/.test(before))
        throw new Error("Cursor de histórico inválido");
      end = objects.findIndex((o) => o.id === before);
      if (end < 0) throw new Error("Cursor de histórico indisponível");
    }
    const selected: DisplayObject[] = [];
    let bytes = 0,
      at = end - 1;
    while (at >= 0 && selected.length < 100) {
      const value = objects[at],
        size = Buffer.byteLength(JSON.stringify(value));
      if (bytes + size > 4 * 1024 * 1024 && selected.length) break;
      if (size > 4 * 1024 * 1024)
        throw new Error("Resumo de conteúdo excede o limite");
      selected.unshift(value);
      bytes += size;
      at--;
    }
    return {
      objects: selected,
      history: {
        hasMore: at >= 0,
        nextBefore: at >= 0 ? selected[0].id : null,
        total: objects.length,
        availableIds: objects.map((o) => o.id),
      },
    };
  }
  state() {
    const { objects, outboxAt } = this.objectsSnapshot();
    const availableIds = new Set(objects.map((o) => o.id));
    const heldAvailable = this.groupHolds.length
      ? new Set(this.store.list().map((manifest) => manifest.id))
      : new Set<string>();
    return {
      initialized: this.initialized,
      locked: !this.identity,
      identity: this.identity?.public ?? null,
      tcpPort: this.tcpPort,
      peers: this.router.peers,
      counters: this.router.counters,
      storage: this.store.stats(),
      settings: { relay: this.config.relay, lowPower: this.config.lowPower },
      contacts: this.identity ? this.config.contacts : [],
      blocked: this.identity ? this.config.blocked : [],
      following: this.identity ? this.config.following : [],
      saved: this.identity ? this.config.saved : [],
      reports: this.identity ? this.config.reports : [],
      groupContent: this.identity
        ? {
            held: this.groupHolds.map((entry) => ({
              ...entry,
              available: heldAvailable.has(entry.id),
              current:
                this.groupDecisions.get(entry.id)?.status ?? "not-rechecked",
            })),
            outbound: false,
          }
        : { held: [], outbound: false },
      ...this.pageObjects(objects),
      followedPostIds: this.identity
        ? followedFeed(objects, this.config.following).map((o) => o.id)
        : [],
      collections: this.identity
        ? validateCollections(
            this.privateState.collections ?? [],
            this.identity.public.id,
          )
        : [],
      siteDraft: this.identity ? (this.privateState.siteDraft ?? null) : null,
      outbox: this.identity
        ? Object.values(this.privateState.outbox ?? {}).map((e) =>
            outboxItem(
              e,
              outboxAt,
              this.config.blocked,
              availableIds.has(e.id),
              this.groupRetries.get(e.operationId),
            ),
          )
        : [],
      outboxPolicy: {
        maxRecords: OUTBOX_LIMITS.total,
        maxPending: OUTBOX_LIMITS.pending,
        maxPendingBytes: OUTBOX_LIMITS.bytes,
        idempotency: "retained-records",
      },
      transportError: this.lastTransportError,
      now: outboxAt,
    };
  }
}
