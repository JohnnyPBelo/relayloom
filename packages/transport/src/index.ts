import { EventEmitter } from "node:events";
import {
  createServer,
  createConnection,
  type Server,
  type Socket,
} from "node:net";
import { SerialPort } from "serialport";
import { randomBytes } from "node:crypto";
import { canonical, hash } from "../../core/src/index.js";
import { preserveSerialPollInterests, serialWriteDeadline } from "./serial.js";

export type Priority = "sos" | "normal" | "bulk";
interface Packet {
  id: string;
  source: string;
  created: number;
  expires: number;
  maxHops: number;
  hops: string[];
  priority: Priority;
  payload: unknown;
}
interface Frame {
  t: "part";
  id: string;
  index: number;
  count: number;
  data: string;
}
interface Retained {
  packet: Packet;
  encoded: Buffer;
  bytes: number;
  relayOnly: boolean;
}
interface Transfer extends Retained {
  sent: number;
  attempts: number;
  next: number;
  scheduled: number;
  inFlight: boolean;
}
interface Assembly {
  parts: Map<number, Buffer>;
  count: number;
  bytes: number;
  since: number;
  updated: number;
}
export interface PeerState {
  id: string;
  medium: "tcp" | "serial";
  address: string;
  connected: boolean;
  sent: number;
  received: number;
  queued: number;
}
const MAX_PACKET = 6 * 1024 * 1024,
  MAX_PENDING = 16 * 1024 * 1024,
  FRAGMENT = 2048,
  MAX_FRAME = 4096;
const MAX_TRANSFERS = 64,
  MAX_ASSEMBLIES = 8,
  MAX_CONTROL = 64,
  MAX_ACKS_PER_SECOND = 64;
export const TRANSPORT_LIMITS = Object.freeze({
  maxPacketBytes: MAX_PACKET,
  maxPendingBytes: MAX_PENDING,
  fragmentBytes: FRAGMENT,
  maxFrameBytes: MAX_FRAME,
  maxTransfers: MAX_TRANSFERS,
  maxAssemblies: MAX_ASSEMBLIES,
  maxHops: 12,
  maxTtlMs: 3600_000,
});
const rank = (priority: Priority) =>
  priority === "sos" ? 0 : priority === "normal" ? 1 : 2;

class Link {
  buffer = "";
  pending = new Map<string, Transfer>();
  assemblies = new Map<string, Assembly>();
  active = true;
  writing = false;
  turn = 0;
  private resynchronize = false;
  // Control frames use the same writer as fragments. No receive path writes directly to the stream.
  readonly controls = new Set<string>();
  private acknowledged = new Map<string, number>();
  pendingBytes = 0;
  assemblyBytes = 0;
  private cancelWrite?: () => void;
  state: PeerState;
  receivedWindow = 0;
  private framesWindow = 0;
  private invalidWindow = 0;
  windowStart = Date.now();
  private ackWindowStart = Date.now();
  private acksWindow = 0;
  constructor(
    readonly router: Router,
    readonly io: Socket | SerialPort,
    medium: "tcp" | "serial",
    address: string,
  ) {
    this.resynchronize = medium === "serial";
    this.state = {
      id: randomBytes(8).toString("hex"),
      medium,
      address,
      connected: true,
      sent: 0,
      received: 0,
      queued: 0,
    };
    io.on("data", (chunk: Buffer) => this.read(chunk));
    io.on("error", () => this.destroy());
    io.on("close", () => this.close());
  }
  close() {
    if (!this.active) return;
    this.active = false;
    this.state.connected = false;
    this.cancelWrite?.();
    this.pending.clear();
    this.assemblies.clear();
    this.controls.clear();
    this.acknowledged.clear();
    this.pendingBytes = this.assemblyBytes = this.state.queued = 0;
    this.buffer = "";
    this.router.emit("change");
  }
  private removeTransfer(id: string) {
    const transfer = this.pending.get(id);
    if (transfer) {
      this.pendingBytes -= transfer.bytes;
      this.pending.delete(id);
      this.state.queued = this.pending.size;
    }
  }
  cancelRelayed() {
    for (const [id, transfer] of this.pending)
      if (transfer.relayOnly) this.removeTransfer(id);
  }
  private removeAssembly(id: string) {
    const assembly = this.assemblies.get(id);
    if (assembly) {
      this.assemblyBytes -= assembly.bytes;
      this.assemblies.delete(id);
    }
  }
  private maintain(now: number) {
    for (const [id, assembly] of this.assemblies)
      if (now - assembly.updated > 120_000 || now - assembly.since > 3600_000)
        this.removeAssembly(id);
    for (const [id, transfer] of this.pending)
      if (transfer.packet.expires <= now) this.removeTransfer(id);
    for (const [id, at] of this.acknowledged)
      if (now - at >= 1000) this.acknowledged.delete(id);
    if (now - this.ackWindowStart >= 1000) {
      this.ackWindowStart = now;
      this.acksWindow = 0;
    }
  }
  private read(chunk: Buffer) {
    if (!this.active) return;
    if (Date.now() - this.windowStart >= 1000) {
      this.receivedWindow = this.framesWindow = this.invalidWindow = 0;
      this.windowStart = Date.now();
    }
    this.receivedWindow += chunk.length;
    if (this.receivedWindow > 12 * 1024 * 1024) {
      this.router.counters.rateLimited++;
      this.destroy();
      return;
    }
    this.state.received += chunk.length;
    this.buffer += chunk.toString("utf8");
    // Stream reads may coalesce valid frames; bound each frame and the unfinished tail.
    let at: number;
    while (this.active && (at = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 1);
      if (++this.framesWindow > 8192) {
        this.router.counters.rateLimited++;
        this.destroy();
        return;
      }
      if (!line.length) continue;
      try {
        if (line.length > MAX_FRAME) throw new Error("frame length");
        this.frame(JSON.parse(line));
      } catch {
        this.router.counters.rejected++;
        if (++this.invalidWindow >= 32) {
          this.router.counters.rateLimited++;
          this.destroy();
          return;
        }
      }
    }
    if (this.buffer.length > MAX_FRAME) {
      this.router.counters.rejected++;
      this.destroy();
    }
    void this.pump();
  }
  private acknowledge(id: string) {
    if (
      this.controls.has(id) ||
      Date.now() - (this.acknowledged.get(id) ?? 0) < 1000
    )
      return;
    if (this.controls.size >= MAX_CONTROL) {
      this.router.counters.dropped++;
      return;
    }
    this.controls.add(id);
  }
  private frame(f: Frame | { t: "ack"; id: string }) {
    if (
      !f ||
      typeof f !== "object" ||
      typeof f.id !== "string" ||
      !/^[a-f0-9]{64}$/.test(f.id)
    )
      throw new Error("frame");
    if (f.t === "ack") {
      this.removeTransfer(f.id);
      return;
    }
    if (
      f.t !== "part" ||
      !Number.isInteger(f.index) ||
      !Number.isInteger(f.count) ||
      f.count < 1 ||
      f.count > Math.ceil(MAX_PACKET / FRAGMENT) ||
      f.index < 0 ||
      f.index >= f.count ||
      typeof f.data !== "string" ||
      f.data.length > FRAGMENT * 1.4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(f.data)
    )
      throw new Error("frame");
    const data = Buffer.from(f.data, "base64");
    if (
      !data.length ||
      data.length > FRAGMENT ||
      (f.index < f.count - 1 && data.length !== FRAGMENT) ||
      data.toString("base64") !== f.data
    )
      throw new Error("frame");
    if (this.router.hasSeen(f.id)) {
      this.acknowledge(f.id);
      this.router.counters.duplicates++;
      return;
    }
    let assembly = this.assemblies.get(f.id);
    if (!assembly) {
      this.maintain(Date.now());
      if (this.assemblies.size >= MAX_ASSEMBLIES)
        throw new Error("assembly cap");
      assembly = {
        parts: new Map(),
        count: f.count,
        bytes: 0,
        since: Date.now(),
        updated: Date.now(),
      };
      this.assemblies.set(f.id, assembly);
    }
    const prior = assembly.parts.get(f.index);
    if (f.count !== assembly.count || (prior && !prior.equals(data))) {
      this.removeAssembly(f.id);
      throw new Error("fragment changed");
    }
    if (!prior) {
      if (
        assembly.bytes + data.length > MAX_PACKET ||
        this.assemblyBytes + data.length > MAX_PENDING
      ) {
        this.removeAssembly(f.id);
        throw new Error("assembly bytes");
      }
      assembly.parts.set(f.index, data);
      assembly.bytes += data.length;
      this.assemblyBytes += data.length;
      assembly.updated = Date.now();
    }
    if (assembly.parts.size === assembly.count) {
      this.removeAssembly(f.id);
      const packet: Packet = JSON.parse(
        Buffer.concat(
          Array.from({ length: assembly.count }, (_, i) =>
            assembly!.parts.get(i)!,
          ),
        ).toString("utf8"),
      );
      if (!packet || packet.id !== f.id) throw new Error("id mismatch");
      this.router.receive(packet, this);
      this.acknowledge(f.id);
    }
  }
  private write(value: unknown): Promise<boolean> {
    if (!this.active) return Promise.resolve(false);
    return new Promise((resolve) => {
      const bytes = value === undefined ? "\n" : JSON.stringify(value) + "\n";
      let settled = false,
        callbackDone = false,
        drained = false,
        returned = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.io.off("drain", onDrain);
        this.cancelWrite = undefined;
        resolve(ok);
      };
      const complete = () => {
        if (returned && callbackDone && drained) finish(this.active);
      };
      const onDrain = () => {
        drained = true;
        complete();
      };
      // Bound a single frame against its configured wire duration. Reconnect will
      // offer the retained packet again if a native serial write stops progressing.
      const timeout = setTimeout(
        () => {
          finish(false);
          this.router.counters.dropped++;
          this.destroy();
        },
        this.io instanceof SerialPort
          ? serialWriteDeadline(Buffer.byteLength(bytes), this.io.baudRate)
          : 10_000,
      );
      timeout.unref();
      this.cancelWrite = () => finish(false);
      this.io.on("drain", onDrain);
      try {
        const accepted = this.io.write(bytes, (error) => {
          if (error) {
            finish(false);
            this.destroy();
            return;
          }
          callbackDone = true;
          complete();
        });
        returned = true;
        drained ||= accepted;
        this.state.sent += Buffer.byteLength(bytes);
        complete();
      } catch {
        finish(false);
        this.destroy();
      }
    });
  }
  enqueue(value: Retained) {
    const { packet, bytes } = value;
    if (
      !this.active ||
      this.pending.has(packet.id) ||
      packet.expires <= Date.now()
    )
      return;
    const limit =
      packet.priority === "sos" ? MAX_PENDING : MAX_PENDING - 64 * 1024;
    const slots = packet.priority === "sos" ? MAX_TRANSFERS : MAX_TRANSFERS - 2;
    while (this.pending.size >= slots || bytes + this.pendingBytes > limit) {
      const victim = [...this.pending.values()]
        .filter(
          (t) =>
            !t.inFlight &&
            rank(t.packet.priority) > rank(packet.priority) &&
            (t.next === 0 || t.next === Math.ceil(t.bytes / FRAGMENT)),
        )
        .sort(
          (a, b) =>
            rank(b.packet.priority) - rank(a.packet.priority) ||
            b.packet.created - a.packet.created,
        )[0];
      if (!victim) {
        this.router.counters.dropped++;
        return;
      }
      this.removeTransfer(victim.packet.id);
      this.router.counters.dropped++;
    }
    this.pending.set(packet.id, {
      ...value,
      sent: 0,
      attempts: 0,
      next: 0,
      scheduled: 0,
      inFlight: false,
    });
    this.pendingBytes += bytes;
    this.state.queued = this.pending.size;
    void this.pump();
  }
  private select(now: number): Transfer | undefined {
    const transfers = [...this.pending.values()];
    const partials = transfers.filter(
      (t) => t.next > 0 && t.next < Math.ceil(t.bytes / FRAGMENT),
    );
    const counts = { sos: 0, normal: 0, bulk: 0 };
    for (const transfer of partials) counts[transfer.packet.priority]++;
    const ready = transfers.filter(
      (t) =>
        !(this.router.lowPower && t.packet.priority === "bulk") &&
        (t.next < Math.ceil(t.bytes / FRAGMENT) ||
          now - t.sent >= (this.state.medium === "serial" ? 120_000 : 2000)),
    );
    const waiting = new Set(
      ready
        .filter((t) => !counts[t.packet.priority])
        .map((t) => t.packet.priority),
    );
    const due = ready.filter((t) => {
      if (partials.includes(t)) return true;
      const priority = t.packet.priority;
      // Keep two slots available for SOS and one for either lower-priority class.
      // A stream of newly arriving high-priority objects must not monopolize admission.
      if (
        priority === "sos"
          ? counts.sos >= 7
          : counts.normal + counts.bulk >= 6 || counts[priority] >= 5
      )
        return false;
      const reserved = [...waiting].filter((p) => p !== priority).length;
      return partials.length < MAX_ASSEMBLIES - reserved;
    });
    // Every fourth data fragment serves the least recently served eligible transfer.
    // This gives SOS preemption at the next fragment while keeping lower priorities moving.
    const fair = (this.turn + 1) % 4 === 0;
    due.sort(
      (a, b) =>
        (fair ? 0 : rank(a.packet.priority) - rank(b.packet.priority)) ||
        a.scheduled - b.scheduled ||
        a.packet.created - b.packet.created,
    );
    return due[0];
  }
  async pump() {
    this.maintain(Date.now());
    if (this.writing || !this.active) return;
    this.writing = true;
    let controlTurn = true;
    try {
      while (this.active) {
        if (this.resynchronize) {
          // Delimit an old partial line before replay on a reopened serial port.
          this.resynchronize = false;
          if (!(await this.write(undefined))) break;
        }
        const now = Date.now();
        this.maintain(now);
        const transfer = this.select(now);
        const ack =
          this.acksWindow < MAX_ACKS_PER_SECOND
            ? this.controls.values().next().value
            : undefined;
        if (ack && (controlTurn || !transfer)) {
          this.acksWindow++;
          this.acknowledged.set(ack, now);
          if (!(await this.write({ t: "ack", id: ack }))) break;
          this.controls.delete(ack);
          controlTurn = false;
        } else if (transfer) {
          this.turn++;
          const count = Math.ceil(transfer.bytes / FRAGMENT);
          if (transfer.next >= count) transfer.next = 0;
          if (!transfer.next && ++transfer.attempts > 1)
            this.router.counters.retransmits++;
          const index = transfer.next;
          transfer.inFlight = true;
          const sent = await this.write({
            t: "part",
            id: transfer.packet.id,
            index,
            count,
            data: transfer.encoded
              .subarray(index * FRAGMENT, (index + 1) * FRAGMENT)
              .toString("base64"),
          });
          transfer.inFlight = false;
          if (!sent) break;
          transfer.next++;
          transfer.scheduled = this.turn;
          if (transfer.next === count) transfer.sent = Date.now();
          controlTurn = true;
        } else break;
        // write callbacks can resolve within a single turn on TCP. Yield for reads, new SOS and expiry.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    } catch {
      this.destroy();
    } finally {
      this.writing = false;
      this.state.queued = this.pending.size;
    }
  }
  destroy() {
    this.close();
    if (this.io instanceof SerialPort) {
      if (this.io.isOpen) this.io.close(() => {});
    } else this.io.destroy();
  }
}
export interface RouterOptions {
  id?: string;
  relay?: boolean;
  validate?: (payload: unknown) => void;
}
export class Router extends EventEmitter {
  readonly id: string;
  readonly seen = new Map<string, number>();
  readonly links = new Set<Link>();
  counters = {
    received: 0,
    forwarded: 0,
    duplicates: 0,
    rejected: 0,
    dropped: 0,
    retransmits: 0,
    rateLimited: 0,
  };
  lowPower = false;
  private relaying = true;
  private server?: Server;
  private timer: ReturnType<typeof setInterval>;
  private reconnects = new Set<ReturnType<typeof setTimeout>>();
  private stopped = false;
  // Shared encoded snapshots keep retry storage bounded even when no route currently exists.
  private retained = new Map<string, Retained>();
  private retainedBytes = 0;
  private connections = new Set<() => void>();
  constructor(readonly options: RouterOptions = {}) {
    super();
    this.id = options.id ?? randomBytes(16).toString("hex");
    this.relay = options.relay ?? true;
    if (typeof this.id !== "string" || !this.id.length || this.id.length > 128)
      throw new Error("Identificador inválido");
    this.timer = setInterval(() => {
      const now = Date.now();
      for (const [id, expires] of this.seen)
        if (expires <= now) this.seen.delete(id);
      for (const [id, value] of this.retained)
        if (value.packet.expires <= now) this.removeRetained(id);
      for (const link of this.links)
        if (link.active) void link.pump();
        else this.links.delete(link);
    }, 200);
    this.timer.unref();
  }
  get peers() {
    return [...this.links].map((link) => ({ ...link.state }));
  }
  get relay() {
    return this.relaying;
  }
  set relay(enabled: boolean) {
    this.relaying = enabled;
    if (!enabled) {
      for (const link of this.links) link.cancelRelayed();
      for (const [id, value] of this.retained)
        if (value.relayOnly) this.removeRetained(id);
    }
  }
  hasSeen(id: string) {
    const expires = this.seen.get(id);
    if (expires === undefined) return false;
    if (expires <= Date.now()) {
      this.seen.delete(id);
      return false;
    }
    return true;
  }
  private removeRetained(id: string) {
    const value = this.retained.get(id);
    if (value) {
      this.retainedBytes -= value.bytes;
      this.retained.delete(id);
    }
  }
  private retain(packet: Packet, relayOnly = true): Retained | undefined {
    const encoded = Buffer.from(canonical(packet)),
      bytes = encoded.length;
    if (bytes > MAX_PACKET) throw new Error("Pacote demasiado grande");
    const value = {
      packet: JSON.parse(encoded.toString()) as Packet,
      encoded,
      bytes,
      relayOnly,
    };
    for (const [id, old] of this.retained)
      if (old.packet.expires <= Date.now()) this.removeRetained(id);
    while (
      this.retained.size >= MAX_TRANSFERS ||
      this.retainedBytes + bytes > MAX_PENDING
    ) {
      const victim = [...this.retained.values()]
        .filter((t) => rank(t.packet.priority) >= rank(packet.priority))
        .sort(
          (a, b) =>
            rank(b.packet.priority) - rank(a.packet.priority) ||
            a.packet.created - b.packet.created,
        )[0];
      if (!victim) {
        this.counters.dropped++;
        return;
      }
      this.removeRetained(victim.packet.id);
      this.counters.dropped++;
    }
    this.retained.set(packet.id, value);
    this.retainedBytes += bytes;
    return value;
  }
  private attach(
    io: Socket | SerialPort,
    medium: "tcp" | "serial",
    address: string,
  ) {
    for (const link of this.links) if (!link.active) this.links.delete(link);
    if (this.stopped || this.links.size >= 24) {
      if (io instanceof SerialPort) io.close(() => {});
      else io.destroy();
      return;
    }
    const link = new Link(this, io, medium, address);
    this.links.add(link);
    for (const value of this.retained.values())
      if (!value.relayOnly || this.relay) link.enqueue(value);
    this.emit("change");
  }
  listen(port = 0, host = "127.0.0.1"): Promise<number> {
    if (this.stopped || this.server)
      return Promise.reject(new Error("Listener indisponível"));
    return new Promise((resolve, reject) => {
      const server = (this.server = createServer((io) =>
        this.attach(io, "tcp", `${io.remoteAddress}:${io.remotePort}`),
      ));
      server.on("error", reject);
      server.listen(port, host, () =>
        resolve((server.address() as { port: number }).port),
      );
    });
  }
  connectTcp(host: string, port: number): () => void {
    if (
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      typeof host !== "string" ||
      !host ||
      host.length > 253
    )
      throw new Error("Endereço TCP inválido");
    let cancelled = false,
      socket: Socket | undefined,
      retry: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      cancelled = true;
      if (retry) {
        clearTimeout(retry);
        this.reconnects.delete(retry);
      }
      socket?.destroy();
      this.connections.delete(cancel);
    };
    const connect = () => {
      if (cancelled || this.stopped) return;
      const next = (socket = createConnection({ host, port }));
      next.setTimeout(10_000, () => {
        if (next.connecting) next.destroy();
      });
      next.on("connect", () => {
        next.setTimeout(0);
        if (cancelled || this.stopped) next.destroy();
        else this.attach(next, "tcp", `${host}:${port}`);
      });
      next.on("error", () => {});
      next.on("close", () => {
        if (!cancelled && !this.stopped) {
          retry = setTimeout(() => {
            this.reconnects.delete(retry!);
            connect();
          }, 1000);
          this.reconnects.add(retry);
        }
      });
    };
    this.connections.add(cancel);
    connect();
    return cancel;
  }
  connectSerial(path: string, baudRate = 115200): () => void {
    if (
      typeof path !== "string" ||
      path.length > 256 ||
      !path ||
      !Number.isInteger(baudRate) ||
      baudRate < 1200 ||
      baudRate > 1_000_000
    )
      throw new Error("Dispositivo série inválido");
    let cancelled = false,
      port: SerialPort | undefined,
      retry: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      cancelled = true;
      if (retry) {
        clearTimeout(retry);
        this.reconnects.delete(retry);
        retry = undefined;
      }
      if (port?.isOpen) port.close(() => {});
      this.connections.delete(cancel);
    };
    this.connections.add(cancel);
    const schedule = () => {
      if (cancelled || this.stopped || retry) return;
      retry = setTimeout(() => {
        this.reconnects.delete(retry!);
        retry = undefined;
        connect();
      }, 1000);
      this.reconnects.add(retry);
    };
    const connect = () => {
      if (cancelled || this.stopped) return;
      const current = (port = new SerialPort({
        path,
        baudRate,
        autoOpen: false,
      }));
      current.on("close", () => {
        if (port === current) schedule();
      });
      current.on("error", () => {
        if (!cancelled && !this.stopped)
          this.emit("transportError", `Série indisponível: ${path}`);
        if (port === current && !current.isOpen && !current.opening) schedule();
      });
      current.open((error) => {
        if (error) {
          if (!cancelled && !this.stopped)
            this.emit("transportError", `Série indisponível: ${path}`);
          schedule();
        } else if (cancelled || this.stopped) current.close(() => {});
        else {
          preserveSerialPollInterests(current);
          this.attach(current, "serial", path);
        }
      });
    };
    connect();
    return cancel;
  }
  broadcast(
    payload: unknown,
    priority: Priority = "normal",
    ttlMs = 120_000,
    relayOnly = false,
  ): string {
    if (
      this.stopped ||
      !["sos", "normal", "bulk"].includes(priority) ||
      !Number.isSafeInteger(ttlMs) ||
      ttlMs < 1 ||
      ttlMs > 3600_000 ||
      typeof relayOnly !== "boolean"
    )
      throw new Error("Prazo ou prioridade inválidos");
    const now = Date.now(),
      body = {
        source: this.id,
        created: now,
        expires: now + ttlMs,
        maxHops: 12,
        priority,
        payload,
      };
    const packet: Packet = {
      ...body,
      id: hash(canonical(body)),
      hops: [this.id],
    };
    if (relayOnly && !this.relay) return packet.id;
    if (this.hasSeen(packet.id)) return packet.id;
    const value = this.retain(packet, relayOnly);
    this.remember(packet);
    if (value) for (const link of this.links) link.enqueue(value);
    return packet.id;
  }
  private remember(packet: Packet) {
    if (this.seen.size >= 4096)
      this.seen.delete(this.seen.keys().next().value!);
    this.seen.set(packet.id, packet.expires);
  }
  receive(packet: Packet, source: Link) {
    const { id, hops, ...body } = packet,
      now = Date.now();
    if (
      hash(canonical(body)) !== id ||
      typeof packet.source !== "string" ||
      !packet.source.length ||
      packet.source.length > 128 ||
      !["sos", "normal", "bulk"].includes(packet.priority) ||
      !Number.isSafeInteger(packet.created) ||
      !Number.isSafeInteger(packet.expires) ||
      packet.created > now + 300_000 ||
      packet.expires <= now ||
      packet.expires <= packet.created ||
      packet.expires - packet.created > 3600_000 ||
      !Number.isInteger(packet.maxHops) ||
      packet.maxHops < 1 ||
      packet.maxHops > 12 ||
      !Array.isArray(hops) ||
      hops.length < 1 ||
      hops.length > packet.maxHops ||
      hops[0] !== packet.source ||
      hops.some((h) => typeof h !== "string" || !h.length || h.length > 128) ||
      new Set(hops).size !== hops.length
    )
      throw new Error("Pacote inválido");
    if (this.hasSeen(id) || hops.includes(this.id)) {
      this.counters.duplicates++;
      return;
    }
    this.options.validate?.(packet.payload);
    this.remember(packet);
    this.counters.received++;
    this.emit("payload", packet.payload, {
      hops,
      medium: source.state.medium,
      source: packet.source,
      packetId: id,
    });
    if (this.relay && hops.length < packet.maxHops) {
      const value = this.retain({ ...packet, hops: [...hops, this.id] });
      if (value)
        for (const link of this.links)
          if (link !== source && link.active) {
            link.enqueue(value);
            this.counters.forwarded++;
          }
    }
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    for (const cancel of this.connections) cancel();
    for (const timer of this.reconnects) clearTimeout(timer);
    this.reconnects.clear();
    for (const link of this.links) link.destroy();
    this.links.clear();
    this.retained.clear();
    this.retainedBytes = 0;
    this.seen.clear();
    if (this.server)
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }
}
