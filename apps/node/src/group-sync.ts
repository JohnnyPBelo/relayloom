import {
  canonical,
  hash,
  verifyBundle,
  type Bundle,
  type Identity,
  type PublicIdentity,
  type ContentStore,
} from "../../../packages/core/src/index.js";
import {
  checkedSnapshot,
  CONTROL_LIMITS,
  openGroupControl,
  requestedHeaders,
  requestedSnapshot,
  sealGroupControl,
  snapshotMaterial,
  snapshotPreview,
  type ControlAuthorization,
  type GroupControl,
} from "../../../packages/groups/src/carriers.js";
import {
  memberCardHash,
  verifyGroupEpoch,
  type GroupEpoch,
} from "../../../packages/groups/src/certificates.js";
import type { GroupRegistry } from "../../../packages/groups/src/registry.js";
import type { GroupCommand } from "./group-commands.js";

export interface GroupSyncHost {
  identity(): Identity | undefined;
  registry<T>(fn: (g: GroupRegistry) => T): T;
  apply(command: GroupCommand): unknown;
  store: ContentStore;
  connected(): boolean;
  relay(): boolean;
  blocked(): readonly string[];
  send(bundle: Bundle, relayed: boolean): void;
  pauseGroups(): void;
  needs(): { groupId: string; epochId: string }[];
}
const boundedSet = (
  map: Map<string, number>,
  key: string,
  value: number,
  max = 512,
) => {
  if (!map.has(key) && map.size >= max) map.delete(map.keys().next().value!);
  map.set(key, value);
};
const member = (epoch: GroupEpoch, card: PublicIdentity) =>
  epoch.body.members.some(
    (m) => m.id === card.id && m.cardHash === memberCardHash(card),
  );

/** The scheduler owns no membership authority. Every effect crosses the host's
 * existing registry/stop transaction; only verified creator certificates apply. */
export class GroupSynchronizer {
  private seen = new Map<string, number>();
  private cooldown = new Map<string, number>();
  private published = new Map<string, string>();
  private deferred = new Set<string>();
  private replay: string[] = [];
  private cursor = 0;
  private providers = new Map<string, number>();
  private historyCursor = new Map<string, number>();
  private holders = new Map<
    string,
    { groupId: string; card: PublicIdentity; number: number }
  >();
  private requests = 0;
  private requestIDs = new Set<string>();
  private processing = false;
  private budget = 0;
  private sentBytes = 0;
  private window = 0;
  readonly counts = { received: 0, applied: 0, rejected: 0, sent: 0 };
  constructor(private readonly host: GroupSyncHost) {}
  get ready() {
    return this.replay.length === 0;
  }
  get applying() {
    return this.processing;
  }
  status() {
    return {
      ...this.counts,
      replay: this.replay.length,
      deferred: this.deferred.size,
    };
  }
  reset() {
    this.seen.clear();
    this.cooldown.clear();
    this.published.clear();
    this.deferred.clear();
    this.replay = [];
    this.providers.clear();
    this.historyCursor.clear();
    this.holders.clear();
    this.requestIDs.clear();
    this.processing = false;
  }
  recover() {
    this.reset();
    const identity = this.host.identity();
    if (!identity) return;
    this.replay = this.host.store
      .list()
      .filter(
        (m) =>
          m.kind === "group-control" &&
          m.keys.some((k) => k.reader === identity.public.id),
      )
      .map((m) => m.id);
    if (this.replay.length) this.host.pauseGroups();
    this.drain();
  }
  drain() {
    for (let n = 0; n < 16 && this.replay.length; n++) {
      const id = this.replay.shift()!;
      try {
        this.receive(this.host.store.get(id, false));
      } catch {
        this.counts.rejected++;
      }
    }
    return this.ready;
  }
  private output(
    key: string,
    make: () => Bundle,
    relayed = false,
    interval = 10_000,
  ) {
    const now = Date.now();
    if (
      !this.host.connected() ||
      (relayed && !this.host.relay()) ||
      now - (this.cooldown.get(key) ?? 0) < interval
    )
      return;
    // Aggregate limits include response amplification from authenticated peers.
    if (now - this.window >= 60_000) {
      this.window = now;
      this.budget = 0;
      this.sentBytes = 0;
      this.requests = 0;
    }
    if (this.budget >= 64 || this.sentBytes >= 4 * 1024 * 1024) return;
    // Failed encryption/storage/transport attempts still spend work budget.
    this.budget++;
    boundedSet(this.cooldown, key, now);
    let bundle: Bundle | undefined;
    const id = this.published.get(key);
    if (id) {
      try {
        if (!this.host.store.has(id))
          throw new Error("Carrier expirado ou ausente");
        bundle = this.host.store.get(id, false);
      } catch {
        this.published.delete(key);
      }
    }
    bundle ??= make();
    if (
      bundle.manifest.keys.some((k) => this.host.blocked().includes(k.reader))
    )
      return;
    const bytes = Buffer.byteLength(canonical(bundle));
    if (
      bytes > CONTROL_LIMITS.bundle ||
      this.sentBytes + bytes > 4 * 1024 * 1024
    )
      return;
    this.sentBytes += bytes;
    if (!this.retain(bundle, false)) return;
    if (this.published.size >= 256 && !this.published.has(key))
      this.published.delete(this.published.keys().next().value!);
    this.published.set(key, bundle.manifest.id);
    this.host.send(bundle, relayed);
    this.counts.sent++;
  }
  /** Cache each local membership change, including while peers are absent.
   * The authority operation has already committed; cache pressure must never
   * undo a removal/closure. Historical catch-up is bounded and best effort. */
  record(command: GroupCommand, result: any) {
    if (
      !["create", "commit", "close"].includes(command.action) ||
      this.processing
    )
      return;
    const groupId = result?.operation?.groupId,
      epochId = result?.operation?.epochId;
    if (typeof groupId !== "string" || typeof epochId !== "string") return;
    try {
      const materials = this.host.registry((g) => {
        const info = g.syncState(groupId);
        if (info.anchor.body.creator.id !== this.host.identity()?.public.id)
          return [];
        let epoch: GroupEpoch | undefined;
        for (
          let n = 0;
          info.view.head && n <= info.view.head.body.number && !epoch;
          n += 16
        )
          epoch = g.proofs(groupId, n).find((e) => e.id === epochId);
        if (!epoch) return [];
        const result: {
          key: string;
          payload: GroupControl;
          readers: PublicIdentity[];
        }[] = [];
        const snapshot = g.privateState(groupId, epochId);
        if (snapshot) {
          const material = snapshotMaterial(
            g,
            this.host.identity()!.public,
            epoch,
            snapshot,
          );
          result.push({ key: `snapshot:${groupId}:${epochId}`, ...material });
        }
        if ("expected" in command) {
          const before = g.privateState(groupId, command.expected);
          for (const card of before?.members ?? [])
            if (
              card.id !== this.host.identity()!.public.id &&
              !member(epoch, card)
            ) {
              const payload: GroupControl = {
                type: "group-control",
                version: 1,
                action: "headers",
                groupId,
                to: card.id,
                from: epoch.body.number,
                headers: [epoch],
                head: epoch,
              };
              result.push({
                key: hash(canonical(payload)),
                payload,
                readers: [card],
              });
            }
        }
        return result;
      });
      for (const material of materials)
        this.cache(material.key, material.payload, material.readers, true);
    } catch {
      this.counts.rejected++;
    }
  }
  private cache(
    key: string,
    payload: GroupControl,
    readers: PublicIdentity[],
    critical: boolean,
  ) {
    const identity = this.host.identity();
    if (!identity) return;
    const existing = this.published.get(key);
    if (existing && this.host.store.has(existing)) return;
    if (readers.some((c) => this.host.blocked().includes(c.id))) return;
    const bundle = sealGroupControl(identity, payload, readers);
    if (!this.retain(bundle, critical)) return;
    if (!this.published.has(key) && this.published.size >= 256)
      this.published.delete(this.published.keys().next().value!);
    this.published.set(key, bundle.manifest.id);
    this.output(key, () => bundle, false);
  }
  /** All locally produced controls, including directed responses, share the
   * auxiliary quota. Only a committed local change may replace older controls. */
  private retain(bundle: Bundle, critical: boolean): boolean {
    const identity = this.host.identity();
    if (!identity) return false;
    if (this.host.store.has(bundle.manifest.id)) return true;
    const size = Buffer.byteLength(canonical(bundle));
    const limit = Math.min(8 * 1024 * 1024, this.host.store.stats().quota / 4);
    const retained = this.host.store
      .list()
      .filter(
        (m) => m.kind === "group-control" && m.author.id === identity.public.id,
      );
    const estimate = (m: (typeof retained)[number]) =>
      512 +
      Buffer.byteLength(canonical(m)) +
      m.chunks.reduce((sum, c) => sum + 80 + Math.ceil(c.size / 3) * 4, 0);
    let bytes = retained.reduce((sum, m) => sum + estimate(m), 0);
    if (size > limit) return false;
    const removals: string[] = [];
    for (const old of retained) {
      if (bytes + size <= limit) break;
      if (!critical) return false;
      if (
        this.host.store.isPinned(old.id) ||
        this.host.store.reservations().includes(old.id)
      )
        continue;
      removals.push(old.id);
      bytes -= estimate(old);
    }
    if (bytes + size > limit) return false;
    // Validate the entire plan and store the replacement before pruning. A
    // refused admission or failed write must not pre-emptively discard proofs.
    this.host.store.put(bundle);
    for (const id of removals)
      if (this.host.store.has(id)) this.host.store.remove(id);
    return true;
  }
  receive(bundle: Bundle, retry = false) {
    const identity = this.host.identity();
    if (!identity || this.processing) return;
    if (
      bundle.manifest.kind !== "group-control" ||
      !bundle.manifest.keys.some((k) => k.reader === identity.public.id)
    )
      return;
    if (
      !retry &&
      this.seen.has(bundle.manifest.id) &&
      !this.requestIDs.has(bundle.manifest.id) &&
      !this.deferred.has(bundle.manifest.id)
    )
      return;
    this.processing = true;
    this.counts.received++;
    try {
      const value = openGroupControl(bundle, identity);
      if ("to" in value && value.to !== identity.public.id) return;
      if (
        value.action === "headers-request" ||
        value.action === "snapshot-request"
      ) {
        if (
          this.requestIDs.size >= 512 &&
          !this.requestIDs.has(bundle.manifest.id)
        )
          this.requestIDs.delete(this.requestIDs.values().next().value!);
        this.requestIDs.add(bundle.manifest.id);
        if (!this.ready) return;
        const now = Date.now(),
          key = `incoming:${bundle.manifest.author.id}:${value.action}`;
        if (now - this.window >= 60_000) {
          this.window = now;
          this.budget = 0;
          this.sentBytes = 0;
          this.requests = 0;
        }
        if (this.requests >= 64 || now - (this.cooldown.get(key) ?? 0) < 1000)
          return;
        this.requests++;
        boundedSet(this.cooldown, key, now);
      }
      const known = this.host.registry((g) =>
        g.list().some((v) => v.id === value.groupId),
      );
      if (!known) return; // A network hint cannot enrol an unknown group.
      const blocked = this.host.blocked().includes(bundle.manifest.author.id);
      if (
        value.action === "headers-request" ||
        value.action === "snapshot-request"
      ) {
        if (blocked) return;
        const response = this.host.registry((g) => {
          const own =
            g.anchor(value.groupId).body.creator.id === identity.public.id;
          if (!own && !this.host.relay()) return null;
          if (value.action === "headers-request") {
            const data = requestedHeaders(g, value, bundle.manifest.author);
            const payload: GroupControl = {
              type: "group-control",
              version: 1,
              action: "headers",
              groupId: value.groupId,
              to: bundle.manifest.author.id,
              from: value.from,
              ...data,
            };
            return {
              key: hash(canonical(payload)),
              relayed: !own,
              make: () =>
                sealGroupControl(identity, payload, [bundle.manifest.author]),
            };
          }
          const state = requestedSnapshot(
            g,
            value,
            bundle.manifest.author,
            identity.public,
          );
          // Derive immutable material in this scope; the registry never escapes.
          const material = snapshotMaterial(
            g,
            identity.public,
            state.epoch,
            state.snapshot,
            bundle.manifest.author,
          );
          return {
            key: `snapshot:${value.groupId}:${state.epoch.id}:${bundle.manifest.author.id}`,
            relayed: !own,
            make: () =>
              sealGroupControl(identity, material.payload, material.readers),
          };
        });
        if (response)
          this.output(response.key, response.make, response.relayed);
      } else if (value.action === "headers") {
        // The registry preserves a valid restrictive prefix even on rejection.
        if (value.headers.length) {
          try {
            this.host.apply({
              action: "headers",
              groupId: value.groupId,
              headers: value.headers as GroupEpoch[],
            });
          } catch {
            this.counts.rejected++;
          }
        }
        // A hint is still a signed certificate; an unanchored one never wins
        // over the chain and a conflicting anchored one must freeze normally.
        try {
          this.host.apply({
            action: "headers",
            groupId: value.groupId,
            headers: [value.head as GroupEpoch],
          });
        } catch {
          this.counts.rejected++;
        }
        this.counts.applied++;
      } else {
        try {
          this.host.apply({
            action: "headers",
            groupId: value.groupId,
            headers: [value.epoch as GroupEpoch],
          });
        } catch {
          this.counts.rejected++;
        }
        if (blocked) return; // Security headers apply; no other interaction with a blocked source.
        const preview = this.host.registry((g) =>
          snapshotPreview(bundle, value, g.anchor(value.groupId)),
        );
        const holderKey = `${value.groupId}:${bundle.manifest.author.id}`;
        if (this.holders.size >= 256 && !this.holders.has(holderKey))
          this.holders.delete(this.holders.keys().next().value!);
        this.holders.set(holderKey, {
          groupId: value.groupId,
          card: bundle.manifest.author,
          number: preview.epoch.body.number,
        });
        const prepared = this.host.registry((g) => {
          const info = g.syncState(value.groupId);
          if (
            g.proofs(value.groupId, preview.epoch.body.number, 1)[0]?.id !==
              preview.epoch.id ||
            (!info.admitted && !info.consent)
          )
            return null;
          return checkedSnapshot(g, bundle, value);
        });
        if (!prepared) {
          if (this.deferred.size < 128) this.deferred.add(bundle.manifest.id);
          return;
        }
        try {
          const checked = prepared;
          this.host.apply({
            action: "snapshot",
            groupId: value.groupId,
            epochId: checked.epoch.id,
            snapshot: checked.snapshot,
          });
          this.deferred.delete(bundle.manifest.id);
          this.counts.applied++;
          if (bundle.manifest.author.id === identity.public.id)
            this.published.set(
              `snapshot:${value.groupId}:${checked.epoch.id}${value.to ? ":" + value.to : ""}`,
              bundle.manifest.id,
            );
        } catch {
          // Missing ancestry/consent may become available later. The bounded
          // retry set confers no permission; each retry validates everything.
          if (this.deferred.size < 128) this.deferred.add(bundle.manifest.id);
        }
      }
    } catch {
      this.counts.rejected++;
    } finally {
      boundedSet(this.seen, bundle.manifest.id, Date.now());
      this.processing = false;
    }
  }
  tick() {
    const identity = this.host.identity();
    if (!identity) return;
    this.drain();
    if (!this.ready || !this.host.connected()) return;
    if (!this.host.registry((g) => g.list().length)) return;
    for (const id of [...this.deferred].slice(0, 2)) {
      this.deferred.delete(id);
      try {
        this.receive(this.host.store.get(id, false), true);
      } catch {}
    }
    const known = this.host.store.list();
    const needs = this.host.needs();
    const plan = this.host.registry((g) => {
      const groups = g.list();
      if (!groups.length) return null;
      const group = groups[this.cursor++ % groups.length],
        info = g.syncState(group.id);
      let auth: ControlAuthorization | undefined,
        authorizationEpoch: GroupEpoch | undefined;
      if (info.invitation && info.invitationParent) {
        authorizationEpoch = info.invitationParent;
        auth = {
          number: authorizationEpoch.body.number,
          id: authorizationEpoch.id,
          invitation: info.invitation,
        };
      } else if (group.head) {
        for (let n = group.head.body.number; n >= 0 && !auth; n -= 16) {
          for (const epoch of g
            .proofs(group.id, Math.max(0, n - 15), Math.min(16, n + 1))
            .reverse())
            if (member(epoch, identity.public)) {
              authorizationEpoch = epoch;
              auth = { number: epoch.body.number, id: epoch.id };
              break;
            }
        }
      }
      if (!auth || !authorizationEpoch) return null;
      const current = group.head
        ? g.privateState(group.id, group.head.id)
        : null;
      const cards = [
        info.anchor.body.creator,
        ...(current?.members ?? []),
        ...known.map((m) => m.author),
        ...[...this.holders.values()]
          .filter((h) => h.groupId === group.id)
          .map((h) => h.card),
      ];
      const providers = [
        ...new Map(
          cards
            .filter(
              (c) =>
                c.id !== identity.public.id &&
                !this.host.blocked().includes(c.id) &&
                (c.id === info.anchor.body.creator.id ||
                  member(authorizationEpoch!, c) ||
                  (this.holders.get(`${group.id}:${c.id}`)?.number ?? -1) >=
                    authorizationEpoch!.body.number),
            )
            .map((c) => [c.id, c]),
        ).values(),
      ];
      const at = this.providers.get(group.id) ?? 0;
      this.providers.set(group.id, at + 1);
      const provider = providers[at % Math.max(1, providers.length)];
      let wanted: GroupEpoch | undefined;
      if (info.consent && info.invitationParent && !info.admitted) {
        wanted = g.proofs(
          group.id,
          Math.min(1023, info.invitationParent.body.number + 1),
          1,
        )[0];
      } else if (
        info.checkedThrough !== null &&
        group.head &&
        group.status !== "closed" &&
        info.checkedThrough < group.head.body.number
      ) {
        wanted = g.proofs(group.id, info.checkedThrough + 1, 1)[0];
      }
      if (
        !wanted &&
        group.head &&
        member(group.head, identity.public) &&
        !current
      )
        wanted = group.head;
      if (!wanted && group.head) {
        const missing = needs.find(
          (n) => n.groupId === group.id && !g.privateState(group.id, n.epochId),
        );
        if (missing)
          for (let n = 0; n <= group.head.body.number && !wanted; n += 16)
            wanted = g
              .proofs(group.id, n)
              .find((e) => e.id === missing.epochId);
      }
      const publication =
        current &&
        group.head &&
        member(group.head, identity.public) &&
        ["active", "closed"].includes(group.status) &&
        (group.creator.id === identity.public.id || this.host.relay()) &&
        current.members.every((c) => !this.host.blocked().includes(c.id))
          ? snapshotMaterial(g, identity.public, group.head, current)
          : null;
      let historical: ReturnType<typeof snapshotMaterial> | null = null;
      if (
        group.creator.id === identity.public.id &&
        group.head &&
        ["active", "closed"].includes(group.status)
      ) {
        const cursor = this.historyCursor.get(group.id) ?? 0;
        if (cursor <= group.head.body.number) {
          this.historyCursor.set(group.id, cursor + 1);
          const header = g.proofs(group.id, cursor, 1)[0];
          if (
            header &&
            !this.published.has(`snapshot:${group.id}:${header.id}`)
          ) {
            const snapshot = g.privateState(group.id, header.id);
            if (snapshot)
              historical = snapshotMaterial(
                g,
                identity.public,
                header,
                snapshot,
              );
          }
        }
      }
      return {
        group,
        auth,
        provider,
        wanted: wanted && member(wanted, identity.public) ? wanted : undefined,
        publication,
        historical,
      };
    });
    if (!plan) return;
    if (plan.historical) {
      const epoch = plan.historical.payload.epoch as GroupEpoch;
      this.cache(
        `snapshot:${plan.group.id}:${epoch.id}`,
        plan.historical.payload,
        plan.historical.readers,
        false,
      );
    }
    if (plan.publication)
      this.output(
        `snapshot:${plan.group.id}:${plan.group.head!.id}`,
        () =>
          sealGroupControl(
            identity,
            plan.publication!.payload,
            plan.publication!.readers,
          ),
        plan.group.creator.id !== identity.public.id,
        30_000,
      );
    if (plan.provider) {
      const request: GroupControl = {
        type: "group-control",
        version: 1,
        action: "headers-request",
        groupId: plan.group.id,
        to: plan.provider.id,
        from: Math.min(1023, (plan.group.head?.body.number ?? -1) + 1),
        count: 16,
        authorization: plan.auth,
      };
      if (!plan.wanted)
        this.output(`request:${hash(canonical(request))}`, () =>
          sealGroupControl(identity, request, [plan.provider!]),
        );
      if (plan.wanted) {
        const request: GroupControl = {
          type: "group-control",
          version: 1,
          action: "snapshot-request",
          groupId: plan.group.id,
          to: plan.provider.id,
          number: plan.wanted.body.number,
          epochId: plan.wanted.id,
        };
        this.output(`request:${hash(canonical(request))}`, () =>
          sealGroupControl(identity, request, [plan.provider!]),
        );
      }
    }
  }
}
