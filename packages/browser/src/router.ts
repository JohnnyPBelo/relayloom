import { canonical } from "../../core/src/protocol";
import { utf8 } from "./crypto";
import {
  createPacket,
  packetCodec,
  verifiedPacket,
  ROUTER_LIMITS,
  type Packet,
  type Priority,
} from "./packet";
import { RtcTransportPeer, RtcCapacityError } from "./rtc";
import { BluetoothStream, type BleDevice } from "./bluetooth";
import { RtcMessageChannel, nativeStreamFraming } from "./rtc";
import { BrowserWebSocketPeer } from "./websocket";
interface PacketEndpoint {
  readonly medium: "webrtc" | "websocket" | "bluetooth";
  readonly state: "connecting" | "open" | "closed";
  readonly sent: number;
  readonly received: number;
  send(
    packet: Packet,
    allowed: () => boolean,
    priority: Priority,
  ): Promise<void>;
  close(): void;
}

export interface LocalPacketPermission {
  expires: number;
  valid(): boolean;
  check(): Promise<boolean>;
}
type Retained = {
  packet: Packet;
  bytes: number;
  relayOnly: boolean;
  permission?: LocalPacketPermission;
};
type Link = {
  id: string;
  endpoint: PacketEndpoint;
  queue: Map<string, Retained>;
  sending: Set<string>;
  turn: number;
};
export type BrowserRoute = {
  hops: string[];
  source: string;
  medium: "webrtc" | "websocket" | "bluetooth";
  packetId: string;
};
export interface BrowserRouterOptions {
  relay: boolean;
  id?: string;
  validate(payload: unknown): Promise<void>;
  receive(payload: unknown, route: BrowserRoute): Promise<void>;
  maySend?(payload: unknown): Promise<boolean>;
  running?(): boolean;
}
const rank = (p: Priority) => (p === "sos" ? 0 : p === "normal" ? 1 : 2);

/** Local consent changed while preparing automatic relay work. This is not an
 * invalid incoming packet and must never hide other validation/storage errors. */
export class RelayRevokedError extends Error {
  constructor() {
    super("Relay desactivado");
    this.name = "RelayRevokedError";
  }
}

/** Async store-and-forward with native-compatible packet IDs and bounded in-memory retry state. */
export class BrowserRouter {
  readonly id: string;
  lowPower = false;
  readonly counters = {
    received: 0,
    forwarded: 0,
    duplicates: 0,
    rejected: 0,
    dropped: 0,
    sent: 0,
  };
  #relaying: boolean;
  #stopped = false;
  #retained = new Map<string, Retained>();
  #retainedBytes = 0;
  #seen = new Map<string, number>();
  #links = new Map<string, Link>();
  #inflightBytes = 0;
  #inflightCount = 0;
  #receiveChain = Promise.resolve();
  #timer: ReturnType<typeof setInterval>;
  constructor(private options: BrowserRouterOptions) {
    this.id = options.id ?? crypto.randomUUID();
    if (
      typeof this.id !== "string" ||
      !this.id.length ||
      this.id.length > 128 ||
      typeof options.relay !== "boolean"
    )
      throw new Error("Configuração do router inválida");
    this.#relaying = options.relay;
    this.#timer = setInterval(() => this.tick(), 200);
  }
  get relay() {
    return this.#relaying;
  }
  set relay(enabled: boolean) {
    if (typeof enabled !== "boolean") throw new Error("Consentimento inválido");
    this.#relaying = enabled;
    if (!enabled)
      for (const [id, value] of this.#retained)
        if (value.relayOnly) this.remove(id);
  }
  get peers() {
    return [...this.#links.values()].map((l) => ({
      id: l.id,
      medium: l.endpoint.medium,
      connected: l.endpoint.state === "open",
      queued: l.queue.size + l.sending.size,
      sent: l.endpoint.sent,
      received: l.endpoint.received,
    }));
  }
  get resources() {
    return {
      retained: this.#retained.size,
      retainedBytes: this.#retainedBytes,
      seen: this.#seen.size,
      receiving: this.#inflightCount,
      receivingBytes: this.#inflightBytes,
      links: this.#links.size,
    };
  }
  private remove(id: string) {
    const old = this.#retained.get(id);
    if (!old) return;
    this.#retained.delete(id);
    this.#retainedBytes -= old.bytes;
    for (const link of this.#links.values()) link.queue.delete(id);
  }
  cancel(match: (payload: unknown) => boolean): number {
    let count = 0;
    for (const [id, value] of this.#retained)
      if (match(structuredClone(value.packet.payload))) {
        this.remove(id);
        count++;
      }
    return count;
  }
  cancelLocal(match: (payload: unknown) => boolean): number {
    let count = 0;
    for (const [id, value] of this.#retained)
      if (
        value.packet.source === this.id &&
        match(structuredClone(value.packet.payload))
      ) {
        this.remove(id);
        count++;
      }
    return count;
  }
  cancelLocalIds(ids: ReadonlySet<string>): number {
    let count = 0;
    for (const [id, value] of this.#retained)
      if (value.packet.source === this.id && ids.has(id)) {
        this.remove(id);
        count++;
      }
    return count;
  }
  private permitted(e: Retained) {
    return (
      !this.#stopped &&
      (this.options.running?.() ?? true) &&
      this.#retained.get(e.packet.id) === e &&
      e.packet.expires > Date.now() &&
      (e.permission?.valid() ?? true) &&
      (!e.relayOnly || this.#relaying)
    );
  }
  private remember(p: Packet) {
    if (this.#seen.size >= ROUTER_LIMITS.seen)
      this.#seen.delete(this.#seen.keys().next().value!);
    this.#seen.set(p.id, p.expires);
  }
  private retain(packet: Packet, relayOnly: boolean): Retained {
    const encoded = canonical(packet),
      bytes = utf8(encoded).length;
    if (bytes > ROUTER_LIMITS.maxPacket)
      throw new Error("Pacote demasiado grande");
    for (const [id, entry] of this.#retained)
      if (entry.packet.expires <= Date.now()) this.remove(id);
    const old = this.#retained.get(packet.id);
    if (old) return old;
    const work = (id: string) => {
      let queued = false,
        sending = false;
      for (const link of this.#links.values()) {
        if (link.endpoint.state === "closed") continue;
        queued ||= link.queue.has(id);
        sending ||= link.sending.has(id);
      }
      return { idle: !queued && !sending, sending };
    };
    const victims = [...this.#retained.values()]
      .map((entry) => ({ entry, ...work(entry.packet.id) }))
      .filter(
        ({ entry, idle, sending }) =>
          (rank(entry.packet.priority) >= rank(packet.priority) &&
            (packet.priority === "sos" || !sending)) ||
          (entry.packet.priority !== "sos" && idle),
      )
      .sort(
        (a, b) =>
          (packet.priority === "sos" ? 0 : Number(b.idle) - Number(a.idle)) ||
          rank(b.entry.packet.priority) - rank(a.entry.packet.priority) ||
          a.entry.packet.created - b.entry.packet.created,
      );
    const drop: string[] = [];
    let count = this.#retained.size,
      size = this.#retainedBytes;
    while (
      count >= ROUTER_LIMITS.retained ||
      size + bytes > ROUTER_LIMITS.pendingBytes
    ) {
      const v = victims.shift()?.entry;
      if (!v) throw new Error("Fila reservada a tráfego prioritário");
      drop.push(v.packet.id);
      size -= v.bytes;
      count--;
    }
    for (const id of drop) {
      this.remove(id);
      this.counters.dropped++;
    }
    const value = { packet: JSON.parse(encoded) as Packet, bytes, relayOnly };
    this.#retained.set(packet.id, value);
    this.#retainedBytes += bytes;
    return value;
  }
  /** Construct a managed peer; callers exchange SDP explicitly via offer/answer/accept. */
  newPeer(): { id: string; peer: RtcTransportPeer<Packet> } {
    this.tick();
    if (this.#stopped || this.#links.size >= ROUTER_LIMITS.links)
      throw new Error("Limite de ligações");
    const id = crypto.randomUUID(),
      peer = new RtcTransportPeer<Packet>(
        (p) => this.accept(p, id, "webrtc"),
        packetCodec,
      );
    const link: Link = {
      id,
      endpoint: {
        medium: "webrtc",
        get state() {
          return peer.link?.closed ||
            ["closed", "failed"].includes(peer.connection.connectionState)
            ? "closed"
            : peer.link?.channel.readyState === "open"
              ? "open"
              : "connecting";
        },
        get sent() {
          return peer.link?.counters.sent ?? 0;
        },
        get received() {
          return peer.link?.counters.received ?? 0;
        },
        send: (packet, allowed, priority) =>
          peer.link!.send(packet, allowed, priority),
        close: () => peer.close(),
      },
      queue: new Map(),
      sending: new Set(),
      turn: 0,
    };
    this.#links.set(id, link);
    for (const value of this.#retained.values())
      if (this.permitted(value)) link.queue.set(value.packet.id, value);
    return { id, peer };
  }
  connectWebSocket(invitation: unknown): {
    id: string;
    peer: BrowserWebSocketPeer;
  } {
    this.tick();
    if (this.#stopped || this.#links.size >= ROUTER_LIMITS.links)
      throw new Error("Limite de ligações");
    const id = crypto.randomUUID(),
      peer = new BrowserWebSocketPeer(invitation, (p) =>
        this.accept(p, id, "websocket"),
      );
    const link: Link = {
      id,
      endpoint: {
        medium: "websocket",
        get state() {
          return peer.link.closed
            ? "closed"
            : peer.link.channel.readyState === "open"
              ? "open"
              : "connecting";
        },
        get sent() {
          return peer.link.counters.sent;
        },
        get received() {
          return peer.link.counters.received;
        },
        send: (p, allowed, priority) => peer.link.send(p, allowed, priority),
        close: () => peer.close(),
      },
      queue: new Map(),
      sending: new Set(),
      turn: 0,
    };
    this.#links.set(id, link);
    for (const value of this.#retained.values())
      if (this.permitted(value)) link.queue.set(value.packet.id, value);
    return { id, peer };
  }
  connectBluetooth(device: BleDevice) {
    this.tick();
    if (this.#stopped || this.#links.size >= ROUTER_LIMITS.links) throw Error("Limite de ligações");
    const id = crypto.randomUUID(), peer = new BluetoothStream(device);
    const channel = new RtcMessageChannel(peer, p => this.accept(p, id, "bluetooth"), packetCodec,
      { ...nativeStreamFraming, highWater: 4096, transferMs: 600000, heartbeatMs: 30000, heartbeatBuffer: 0 });
    const link: Link = { id, endpoint: {
      medium: "bluetooth",
      get state() { return channel.closed || peer.readyState === "closed" ? "closed" : peer.readyState === "open" ? "open" : "connecting"; },
      get sent() { return channel.counters.sent; },
      get received() { return channel.counters.received; },
      send: (packet, allowed, priority) => channel.send(packet, allowed, priority),
      close: () => channel.close(),
    }, queue: new Map(), sending: new Set(), turn: 0 };
    this.#links.set(id, link);
    for (const value of this.#retained.values()) if (this.permitted(value)) link.queue.set(value.packet.id, value);
    return { id, peer };
  }
  disconnect(id: string): void {
    const link = this.#links.get(id);
    if (link) {
      link.endpoint.close();
      link.queue.clear();
      this.#links.delete(id);
    }
  }
  async broadcast(
    payload: unknown,
    priority: Priority = "normal",
    ttlMs = 120_000,
    relayOnly = false,
    permission?: LocalPacketPermission,
  ): Promise<string> {
    if (this.#stopped || typeof relayOnly !== "boolean")
      throw new Error("Router indisponível");
    const packet = await createPacket(
      this.id,
      payload,
      priority,
      ttlMs,
      permission?.expires,
    );
    await this.options.validate(packet.payload);
    if (this.#stopped) throw new Error("Router encerrado");
    if (relayOnly && !this.#relaying) throw new RelayRevokedError();
    if (
      permission &&
      (!permission.valid() ||
        !(await permission.check()) ||
        !permission.valid())
    )
      throw new Error("Permissão local de envio retirada");
    if (this.#stopped) throw new Error("Router encerrado");
    if (relayOnly && !this.#relaying) throw new RelayRevokedError();
    if (this.#seen.has(packet.id)) return packet.id;
    const value = this.retain(packet, relayOnly);
    value.permission = permission;
    this.remember(packet);
    for (const link of this.#links.values()) link.queue.set(packet.id, value);
    this.tick();
    return packet.id;
  }
  private accept(
    packet: Packet,
    source: string,
    medium: "webrtc" | "websocket" | "bluetooth",
  ): Promise<void> {
    const size = utf8(canonical(packet)).length;
    if (
      this.#stopped ||
      this.#inflightBytes + size > ROUTER_LIMITS.pendingBytes ||
      this.#inflightCount >= ROUTER_LIMITS.retained
    )
      return Promise.reject(new Error("Limite de recepção"));
    this.#inflightBytes += size;
    this.#inflightCount++;
    const run = this.#receiveChain.then(async () => {
      if (this.#stopped) throw new Error("Router encerrado");
      const p = await verifiedPacket(packet);
      if (this.#seen.has(p.id) || p.hops.includes(this.id)) {
        this.counters.duplicates++;
        return;
      }
      await this.options.validate(p.payload);
      if (this.#stopped) throw new Error("Router encerrado");
      await this.options.receive(structuredClone(p.payload), {
        hops: [...p.hops],
        source: p.source,
        medium,
        packetId: p.id,
      });
      if (this.#stopped || p.expires <= Date.now())
        throw new Error("Recepção interrompida ou expirada");
      this.remember(p);
      this.counters.received++;
      if (this.#relaying && p.hops.length < p.maxHops) {
        let value: Retained;
        try {
          value = this.retain({ ...p, hops: [...p.hops, this.id] }, true);
        } catch {
          this.counters.dropped++;
          return;
        } // Stored locally; forwarding quota is a separate best-effort obligation.
        for (const link of this.#links.values())
          if (link.id !== source) {
            link.queue.set(p.id, value);
            this.counters.forwarded++;
          }
        this.tick();
      }
    });
    this.#receiveChain = run.catch(() => {
      this.counters.rejected++;
    });
    return run.finally(() => {
      this.#inflightBytes -= size;
      this.#inflightCount--;
    });
  }
  private tick(): void {
    if (this.#stopped) return;
    const now = Date.now();
    for (const [id, expiry] of this.#seen)
      if (expiry <= now) this.#seen.delete(id);
    for (const [id, entry] of this.#retained)
      if (entry.packet.expires <= now) this.remove(id);
    for (const link of this.#links.values()) {
      if (link.endpoint.state === "closed") {
        this.disconnect(link.id);
        continue;
      }
      if (link.endpoint.state !== "open") continue;
      const max = this.lowPower ? 2 : 4;
      while (link.sending.size < max) {
        const candidates = [...link.queue.values()].filter(
          (e) =>
            this.permitted(e) &&
            (!this.lowPower || e.packet.priority !== "bulk"),
        );
        if (!candidates.length) break;
        const fair = ++link.turn % 8 === 0;
        candidates.sort(
          (a, b) =>
            (fair ? 0 : rank(a.packet.priority) - rank(b.packet.priority)) ||
            a.packet.created - b.packet.created,
        );
        const e = candidates[0],
          id = e.packet.id;
        link.queue.delete(id);
        link.sending.add(id);
        void this.transmit(link, e).finally(() => {
          link.sending.delete(id);
        });
      }
    }
  }
  private async transmit(link: Link, value: Retained): Promise<void> {
    try {
      if (!this.permitted(value)) return;
      if (value.permission && !(await value.permission.check())) {
        this.remove(value.packet.id);
        return;
      }
      if (
        this.options.maySend &&
        !(await this.options.maySend(structuredClone(value.packet.payload)))
      ) {
        this.remove(value.packet.id);
        return;
      }
      if (!this.permitted(value) || !this.#links.has(link.id)) return;
      await link.endpoint.send(
        value.packet,
        () => this.permitted(value) && this.#links.has(link.id),
        value.packet.priority,
      );
      this.counters.sent++;
    } catch (error) {
      this.counters.dropped++;
      if (
        error instanceof RtcCapacityError &&
        this.permitted(value) &&
        this.#links.has(link.id)
      )
        link.queue.set(value.packet.id, value);
      // On disconnect a new link is seeded from retained packets, with the same original expiry.
    }
  }
  drain(): Promise<void> {
    return this.#receiveChain;
  }
  close(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    clearInterval(this.#timer);
    for (const link of this.#links.values()) link.endpoint.close();
    this.#links.clear();
    this.#retained.clear();
    this.#retainedBytes = 0;
    this.#seen.clear();
  }
}
