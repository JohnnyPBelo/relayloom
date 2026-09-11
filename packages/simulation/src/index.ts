import {
  canonical,
  hash,
  verifyBundle,
  verifyManifest,
  MAX_STORED_OBJECTS,
  type Bundle,
} from "../../core/src/index.js";
import { TRANSPORT_LIMITS, type Priority } from "../../transport/src/index.js";

/** Virtual-time model. This does not instantiate Router, sockets, serial ports or radios. */
export interface SimNode {
  id: string;
  storageBytes: number;
  maxObjects?: number;
  relay?: boolean;
  lowPower?: boolean;
}
export interface SimLink {
  id: string;
  from: string;
  to: string;
  bytesPerSecond: number;
  latencyMs: number;
  loss: number;
  mtu: number;
  queueBytes?: number;
  queueSlots?: number;
  retryMs?: number;
  up?: boolean;
}
export interface SimFaults {
  routingDisabled?: boolean;
  verificationBypassed?: boolean;
}
interface Packet {
  id: string;
  source: string;
  created: number;
  expires: number;
  maxHops: number;
  hops: string[];
  priority: Priority;
  payload: Bundle;
}
interface Stored {
  packet: Packet;
  label: string;
  bytes: number;
  accessed: number;
  pinned: boolean;
}
interface Transfer extends Stored {
  parts: Buffer[];
  next: number;
  sent: number;
  served: number;
  attempts: number;
  inFlight: boolean;
}
interface Assembly {
  parts: Map<number, Buffer>;
  count: number;
  bytes: number;
  updated: number;
}
interface Event {
  at: number;
  order: number;
  run: () => void;
}
export interface SimTrace {
  at: number;
  event: string;
  node?: string;
  link?: string;
  label?: string;
  detail?: string;
}
export interface Delivery {
  node: string;
  label: string;
  at: number;
  hops: string[];
  priority: Priority;
  verified: boolean;
}
interface NodeState {
  config: SimNode;
  cache: Map<string, Stored>;
  seen: Map<string, number>;
  bytes: number;
  accepted: number;
  evicted: number;
  rejectedStorage: number;
  rejectedCrypto: number;
  rejectedEnvelope: number;
  duplicates: number;
  maxStoredBytes: number;
  maxStoredObjects: number;
}
interface LinkState {
  config: Required<SimLink>;
  pending: Map<string, Transfer>;
  assemblies: Map<string, Assembly>;
  controls: Map<
    string,
    { packet: Packet; label: string; acknowledgeOn: LinkState }
  >;
  pendingBytes: number;
  assemblyBytes: number;
  busy: boolean;
  generation: number;
  turns: number;
  stats: {
    wireBytes: number;
    frames: number;
    segments: number;
    lostSegments: number;
    retransmits: number;
    droppedQueue: number;
    expired: number;
    rejectedAssembly: number;
    acknowledgements: number;
    maxQueueBytes: number;
    maxQueueObjects: number;
    maxAssemblyBytes: number;
    maxAssemblies: number;
    maxWireSegment: number;
    maxFrameBytes: number;
  };
}
export interface SimulationReport {
  kind: "SIMULATION";
  model: string;
  seed: number;
  elapsedMs: number;
  processedEvents: number;
  faults: SimFaults;
  bounds: typeof TRANSPORT_LIMITS;
  nodes: Array<
    SimNode &
      Omit<NodeState, "config" | "cache" | "seen"> & { storedObjects: number }
  >;
  links: Array<
    Required<SimLink> &
      LinkState["stats"] & { queuedBytes: number; queuedObjects: number }
  >;
  deliveries: Delivery[];
  trace: SimTrace[];
  omittedTraceEvents: number;
}

const EPOCH = 1_700_000_000_000;
const WIRE_HEADER = 24; // Modeled medium segment header, not a claim about a physical radio protocol.
const rank = (p: Priority) => (p === "sos" ? 0 : p === "normal" ? 1 : 2);
const positiveInteger = (n: number) => Number.isSafeInteger(n) && n > 0;

export class Simulation {
  private now = 0;
  private sequence = 0;
  private randomState: number;
  private events: Event[] = [];
  private nodes = new Map<string, NodeState>();
  private links = new Map<string, LinkState>();
  private trace: SimTrace[] = [];
  private deliveries: Delivery[] = [];
  private processedEvents = 0;
  private omittedTraceEvents = 0;

  constructor(
    readonly seed: number,
    readonly faults: SimFaults = {},
  ) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff)
      throw new Error("Seed must be an unsigned 32-bit integer");
    this.randomState = seed >>> 0;
  }
  private random() {
    // Mulberry32: reproducible scheduling/loss only. Never used for keys or ciphertext.
    this.randomState = (this.randomState + 0x6d2b79f5) >>> 0;
    let t = this.randomState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  private record(event: string, fields: Omit<SimTrace, "at" | "event"> = {}) {
    if (this.trace.length < 20_000)
      this.trace.push({ at: this.now, event, ...fields });
    else this.omittedTraceEvents++;
  }
  at(at: number, run: () => void) {
    if (!Number.isSafeInteger(at) || at < this.now)
      throw new Error("Event time must be a future integer millisecond");
    const event = { at, order: this.sequence++, run };
    // Sorted insertion is sufficient for bounded test workloads and preserves equal-time FIFO order.
    let lo = 0,
      hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.events[mid].at <= at) lo = mid + 1;
      else hi = mid;
    }
    this.events.splice(lo, 0, event);
  }
  addNode(config: SimNode) {
    if (
      !config.id ||
      config.id.length > 128 ||
      this.nodes.has(config.id) ||
      !positiveInteger(config.storageBytes) ||
      config.storageBytes > 1024 ** 3 ||
      !positiveInteger(config.maxObjects ?? MAX_STORED_OBJECTS) ||
      (config.maxObjects ?? MAX_STORED_OBJECTS) > MAX_STORED_OBJECTS
    )
      throw new Error("Invalid simulated node");
    this.nodes.set(config.id, {
      config: { relay: true, lowPower: false, maxObjects: 1024, ...config },
      cache: new Map(),
      seen: new Map(),
      bytes: 0,
      accepted: 0,
      evicted: 0,
      rejectedStorage: 0,
      rejectedCrypto: 0,
      rejectedEnvelope: 0,
      duplicates: 0,
      maxStoredBytes: 0,
      maxStoredObjects: 0,
    });
    return this;
  }
  addLink(config: SimLink) {
    const c: Required<SimLink> = {
      queueBytes: TRANSPORT_LIMITS.maxPendingBytes,
      queueSlots: TRANSPORT_LIMITS.maxTransfers,
      retryMs: 1000,
      up: true,
      ...config,
    };
    if (
      !c.id ||
      this.links.has(c.id) ||
      !this.nodes.has(c.from) ||
      !this.nodes.has(c.to) ||
      c.from === c.to ||
      !positiveInteger(c.bytesPerSecond) ||
      !Number.isSafeInteger(c.latencyMs) ||
      c.latencyMs < 0 ||
      !Number.isFinite(c.loss) ||
      c.loss < 0 ||
      c.loss > 1 ||
      !positiveInteger(c.mtu) ||
      c.mtu <= WIRE_HEADER ||
      !positiveInteger(c.queueBytes) ||
      c.queueBytes > TRANSPORT_LIMITS.maxPendingBytes ||
      !positiveInteger(c.queueSlots) ||
      c.queueSlots > TRANSPORT_LIMITS.maxTransfers ||
      !positiveInteger(c.retryMs)
    )
      throw new Error("Invalid simulated directed link");
    this.links.set(c.id, {
      config: c,
      pending: new Map(),
      controls: new Map(),
      assemblies: new Map(),
      pendingBytes: 0,
      assemblyBytes: 0,
      busy: false,
      generation: 0,
      turns: 0,
      stats: {
        wireBytes: 0,
        frames: 0,
        segments: 0,
        lostSegments: 0,
        retransmits: 0,
        droppedQueue: 0,
        expired: 0,
        rejectedAssembly: 0,
        acknowledgements: 0,
        maxQueueBytes: 0,
        maxQueueObjects: 0,
        maxAssemblyBytes: 0,
        maxAssemblies: 0,
        maxWireSegment: 0,
        maxFrameBytes: 0,
      },
    });
    return this;
  }
  setLinkUp(id: string, up: boolean) {
    const link = this.link(id);
    link.config.up = up;
    link.generation++;
    this.record(up ? "link-healed" : "link-partitioned", { link: id });
    if (up) {
      this.recover(link);
      this.pump(link);
    }
  }
  setLowPower(id: string, lowPower: boolean) {
    this.node(id).config.lowPower = lowPower;
    this.record(lowPower ? "low-power-on" : "low-power-off", { node: id });
    for (const link of this.links.values())
      if (link.config.from === id) this.pump(link);
  }
  private node(id: string) {
    const node = this.nodes.get(id);
    if (!node) throw new Error("Unknown node " + id);
    return node;
  }
  private link(id: string) {
    const link = this.links.get(id);
    if (!link) throw new Error("Unknown link " + id);
    return link;
  }
  private remember(node: NodeState, packet: Packet) {
    for (const [id, expires] of node.seen)
      if (expires <= EPOCH + this.now) node.seen.delete(id);
    if (node.seen.size >= 4096)
      node.seen.delete(node.seen.keys().next().value!);
    node.seen.set(packet.id, packet.expires);
  }

  inject(
    nodeId: string,
    label: string,
    bundle: Bundle,
    options: {
      priority?: Priority;
      ttlMs?: number;
      maxHops?: number;
      pinned?: boolean;
    } = {},
  ) {
    const node = this.node(nodeId),
      priority = options.priority ?? "normal",
      ttlMs = options.ttlMs ?? 60_000,
      maxHops = options.maxHops ?? TRANSPORT_LIMITS.maxHops;
    if (
      !label ||
      !["sos", "normal", "bulk"].includes(priority) ||
      !positiveInteger(ttlMs) ||
      ttlMs > TRANSPORT_LIMITS.maxTtlMs ||
      !positiveInteger(maxHops) ||
      maxHops > TRANSPORT_LIMITS.maxHops
    )
      throw new Error("Invalid injection envelope");
    const body = {
      source: nodeId,
      created: EPOCH + this.now,
      expires: EPOCH + this.now + ttlMs,
      maxHops,
      priority,
      payload: structuredClone(bundle),
    };
    const packet: Packet = {
      ...body,
      id: hash(canonical(body)),
      hops: [nodeId],
    };
    if (Buffer.byteLength(canonical(packet)) > TRANSPORT_LIMITS.maxPacketBytes)
      throw new Error("Packet exceeds production envelope bound");
    if (node.seen.has(packet.id)) {
      node.duplicates++;
      return;
    }
    // Injection is an adversarial boundary: deliberately damaged fixtures may originate here.
    const stored = this.store(node, packet, label, options.pinned ?? false);
    if (!stored) return;
    this.remember(node, packet);
    this.record("injected", { node: nodeId, label });
    for (const link of this.links.values())
      if (link.config.from === nodeId) this.enqueue(link, stored);
  }
  private store(
    node: NodeState,
    packet: Packet,
    label: string,
    pinned = false,
  ): Stored | undefined {
    const bytes = Buffer.byteLength(canonical(packet.payload));
    const victims: Stored[] = [];
    let available = node.bytes + bytes,
      count = node.cache.size + 1;
    for (const entry of [...node.cache.values()].sort(
      (a, b) => a.accessed - b.accessed,
    )) {
      if (
        available <= node.config.storageBytes &&
        count <= node.config.maxObjects!
      )
        break;
      if (!entry.pinned) {
        victims.push(entry);
        available -= entry.bytes;
        count--;
      }
    }
    if (
      available > node.config.storageBytes ||
      count > node.config.maxObjects!
    ) {
      node.rejectedStorage++;
      this.record("storage-rejected", { node: node.config.id, label });
      return;
    }
    for (const victim of victims) {
      node.cache.delete(victim.packet.id);
      node.bytes -= victim.bytes;
      node.evicted++;
      this.record("storage-evicted", {
        node: node.config.id,
        label: victim.label,
      });
    }
    const stored = { packet, label, bytes, accessed: this.now, pinned };
    node.cache.set(packet.id, stored);
    node.bytes += bytes;
    node.maxStoredBytes = Math.max(node.maxStoredBytes, node.bytes);
    node.maxStoredObjects = Math.max(node.maxStoredObjects, node.cache.size);
    return stored;
  }
  private remove(link: LinkState, id: string) {
    const prior = link.pending.get(id);
    if (prior) {
      link.pendingBytes -= prior.bytes;
      link.pending.delete(id);
    }
  }
  private maintain(link: LinkState) {
    for (const [id, t] of link.pending)
      if (t.packet.expires <= EPOCH + this.now) {
        this.remove(link, id);
        link.stats.expired++;
        this.record("queued-expired", { link: link.config.id, label: t.label });
      }
    for (const [id, a] of link.assemblies)
      if (this.now - a.updated >= 120_000) {
        link.assemblies.delete(id);
        link.assemblyBytes -= a.bytes;
      }
  }
  private enqueue(link: LinkState, stored: Stored) {
    this.maintain(link);
    const packet = stored.packet;
    if (
      link.pending.has(packet.id) ||
      packet.expires <= EPOCH + this.now ||
      packet.hops.length > packet.maxHops ||
      packet.hops.includes(link.config.to)
    )
      return;
    const encoded = Buffer.from(canonical(packet)),
      bytes = encoded.length;
    if (bytes > TRANSPORT_LIMITS.maxPacketBytes) {
      link.stats.droppedQueue++;
      return;
    }
    const reserve = Math.min(64 * 1024, Math.floor(link.config.queueBytes / 8));
    const byteLimit =
      link.config.queueBytes - (packet.priority === "sos" ? 0 : reserve);
    const slotLimit = Math.max(
      1,
      link.config.queueSlots -
        (packet.priority === "sos"
          ? 0
          : Math.min(2, link.config.queueSlots - 1)),
    );
    while (
      link.pendingBytes + bytes > byteLimit ||
      link.pending.size >= slotLimit
    ) {
      const victim = [...link.pending.values()]
        .filter(
          (t) =>
            !t.inFlight &&
            rank(t.packet.priority) > rank(packet.priority) &&
            (t.next === 0 || t.next === t.parts.length),
        )
        .sort(
          (a, b) =>
            rank(b.packet.priority) - rank(a.packet.priority) ||
            b.packet.created - a.packet.created,
        )[0];
      if (!victim) {
        link.stats.droppedQueue++;
        this.record("queue-rejected", {
          link: link.config.id,
          label: stored.label,
        });
        return;
      }
      this.remove(link, victim.packet.id);
      link.stats.droppedQueue++;
      this.record("queue-preempted", {
        link: link.config.id,
        label: victim.label,
      });
    }
    const parts: Buffer[] = [];
    for (let at = 0; at < bytes; at += TRANSPORT_LIMITS.fragmentBytes)
      parts.push(encoded.subarray(at, at + TRANSPORT_LIMITS.fragmentBytes));
    link.pending.set(packet.id, {
      ...stored,
      bytes,
      parts,
      next: 0,
      sent: 0,
      served: 0,
      attempts: 0,
      inFlight: false,
    });
    link.pendingBytes += bytes;
    link.stats.maxQueueBytes = Math.max(
      link.stats.maxQueueBytes,
      link.pendingBytes,
    );
    link.stats.maxQueueObjects = Math.max(
      link.stats.maxQueueObjects,
      link.pending.size,
    );
    this.at(this.now, () => this.pump(link));
    this.at(packet.expires - EPOCH, () => this.maintain(link));
  }
  private recover(link: LinkState) {
    const source = this.node(link.config.from);
    for (const value of source.cache.values())
      if (
        value.packet.source === source.config.id ||
        (source.config.relay && !this.faults.routingDisabled)
      )
        this.enqueue(link, value);
  }
  private pump(link: LinkState) {
    this.maintain(link);
    if (link.busy || !link.config.up) return;
    const ack = link.controls.values().next().value;
    if (ack) {
      link.controls.delete(ack.packet.id);
      this.transmit(
        link,
        Buffer.from(JSON.stringify({ t: "ack", id: ack.packet.id }) + "\n"),
        ack.label,
        "ack",
        () => {
          this.remove(ack.acknowledgeOn, ack.packet.id);
          link.stats.acknowledgements++;
          this.record("acknowledged", {
            link: link.config.id,
            label: ack.label,
          });
        },
      );
      return;
    }
    const due = [...link.pending.values()].filter(
      (t) =>
        !(
          this.node(link.config.from).config.lowPower &&
          t.packet.priority === "bulk"
        ) &&
        (t.next < t.parts.length || this.now >= t.sent + link.config.retryMs),
    );
    const partials = [...link.pending.values()].filter(
      (t) => t.next > 0 && t.next < t.parts.length,
    );
    const counts = { sos: 0, normal: 0, bulk: 0 };
    for (const t of partials) counts[t.packet.priority]++;
    const waiting = new Set(
      due
        .filter((t) => !counts[t.packet.priority])
        .map((t) => t.packet.priority),
    );
    const eligible = due.filter((t) => {
      if (partials.includes(t)) return true;
      const p = t.packet.priority;
      if (
        p === "sos"
          ? counts.sos >= 7
          : counts.normal + counts.bulk >= 6 || counts[p] >= 5
      )
        return false;
      return (
        partials.length <
        TRANSPORT_LIMITS.maxAssemblies -
          [...waiting].filter((other) => other !== p).length
      );
    });
    const fair = (link.turns + 1) % 4 === 0;
    eligible.sort(
      (a, b) =>
        (fair ? 0 : rank(a.packet.priority) - rank(b.packet.priority)) ||
        a.served - b.served ||
        a.packet.created - b.packet.created,
    );
    const transfer = eligible[0];
    if (!transfer) {
      const times = [...link.pending.values()]
        .filter(
          (t) =>
            !(
              this.node(link.config.from).config.lowPower &&
              t.packet.priority === "bulk"
            ),
        )
        .map((t) =>
          t.next >= t.parts.length
            ? t.sent + link.config.retryMs
            : t.packet.expires - EPOCH,
        );
      if (times.length)
        this.at(Math.max(this.now + 1, Math.min(...times)), () =>
          this.pump(link),
        );
      return;
    }
    if (transfer.next >= transfer.parts.length) transfer.next = 0;
    if (transfer.next === 0 && transfer.attempts++ > 0) {
      link.stats.retransmits++;
      this.record("retransmit", {
        link: link.config.id,
        label: transfer.label,
      });
    }
    const index = transfer.next++,
      data = transfer.parts[index],
      count = transfer.parts.length;
    transfer.served = ++link.turns;
    const frame = Buffer.from(
      JSON.stringify({
        t: "part",
        id: transfer.packet.id,
        index,
        count,
        data: data.toString("base64"),
      }) + "\n",
    );
    if (frame.length - 1 > TRANSPORT_LIMITS.maxFrameBytes)
      throw new Error("Frame exceeds production frame bound");
    transfer.inFlight = true;
    this.transmit(
      link,
      frame,
      transfer.label,
      `${transfer.packet.priority}:${index}/${count}`,
      () => this.receivePart(link, transfer, index, count, data),
      () => {
        transfer.inFlight = false;
      },
    );
    if (transfer.next === count)
      transfer.sent =
        this.now +
        Math.ceil(
          (this.wireBytes(frame.length, link.config.mtu) * 1000) /
            link.config.bytesPerSecond,
        );
  }
  private wireBytes(length: number, mtu: number) {
    return length + Math.ceil(length / (mtu - WIRE_HEADER)) * WIRE_HEADER;
  }
  private transmit(
    link: LinkState,
    frame: Buffer,
    label: string,
    detail: string,
    receive: () => void,
    sent: () => void = () => {},
  ) {
    link.busy = true;
    const generation = link.generation;
    let lost = false,
      bytes = 0;
    for (let at = 0; at < frame.length; at += link.config.mtu - WIRE_HEADER) {
      const size =
        Math.min(frame.length - at, link.config.mtu - WIRE_HEADER) +
        WIRE_HEADER;
      bytes += size;
      link.stats.segments++;
      link.stats.maxWireSegment = Math.max(link.stats.maxWireSegment, size);
      if (this.random() < link.config.loss) {
        lost = true;
        link.stats.lostSegments++;
      }
    }
    link.stats.wireBytes += bytes;
    link.stats.frames++;
    link.stats.maxFrameBytes = Math.max(
      link.stats.maxFrameBytes,
      frame.length - 1,
    );
    this.record("frame-sent", { link: link.config.id, label, detail });
    const finish =
      this.now +
      Math.max(1, Math.ceil((bytes * 1000) / link.config.bytesPerSecond));
    this.at(finish, () => {
      sent();
      link.busy = false;
      this.pump(link);
    });
    this.at(finish + link.config.latencyMs, () => {
      if (lost || !link.config.up || link.generation !== generation) {
        this.record("frame-lost", { link: link.config.id, label, detail });
        return;
      }
      receive();
    });
  }
  private acknowledge(link: LinkState, packet: Packet, label: string) {
    const reverse = [...this.links.values()].find(
      (l) =>
        l.config.from === link.config.to && l.config.to === link.config.from,
    );
    if (reverse && reverse.controls.size < 64) {
      reverse.controls.set(packet.id, { packet, label, acknowledgeOn: link });
      this.at(this.now, () => this.pump(reverse));
    }
  }
  private receivePart(
    link: LinkState,
    transfer: Transfer,
    index: number,
    count: number,
    data: Buffer,
  ) {
    const node = this.node(link.config.to),
      id = transfer.packet.id;
    if (node.seen.has(id)) {
      node.duplicates++;
      this.acknowledge(link, transfer.packet, transfer.label);
      return;
    }
    let assembly = link.assemblies.get(id);
    if (!assembly) {
      if (link.assemblies.size >= TRANSPORT_LIMITS.maxAssemblies) {
        link.stats.rejectedAssembly++;
        return;
      }
      assembly = { parts: new Map(), count, bytes: 0, updated: this.now };
      link.assemblies.set(id, assembly);
    }
    if (!assembly.parts.has(index)) {
      if (
        link.assemblyBytes + data.length > TRANSPORT_LIMITS.maxPendingBytes ||
        assembly.bytes + data.length > TRANSPORT_LIMITS.maxPacketBytes
      ) {
        link.stats.rejectedAssembly++;
        return;
      }
      assembly.parts.set(index, data);
      assembly.bytes += data.length;
      link.assemblyBytes += data.length;
      assembly.updated = this.now;
    }
    link.stats.maxAssemblyBytes = Math.max(
      link.stats.maxAssemblyBytes,
      link.assemblyBytes,
    );
    link.stats.maxAssemblies = Math.max(
      link.stats.maxAssemblies,
      link.assemblies.size,
    );
    if (assembly.parts.size !== assembly.count) return;
    link.assemblies.delete(id);
    link.assemblyBytes -= assembly.bytes;
    const packet: Packet = JSON.parse(
      Buffer.concat(
        Array.from({ length: count }, (_, i) => assembly!.parts.get(i)!),
      ).toString("utf8"),
    );
    const { id: packetId, hops, ...body } = packet;
    if (
      packetId !== id ||
      hash(canonical(body)) !== id ||
      packet.expires <= EPOCH + this.now ||
      packet.expires - packet.created > TRANSPORT_LIMITS.maxTtlMs ||
      packet.created > EPOCH + this.now ||
      packet.expires <= packet.created ||
      hops.length < 1 ||
      hops.length > packet.maxHops ||
      packet.maxHops > TRANSPORT_LIMITS.maxHops ||
      hops[0] !== packet.source ||
      new Set(hops).size !== hops.length ||
      hops.includes(node.config.id)
    ) {
      node.rejectedEnvelope++;
      this.record("envelope-rejected", {
        node: node.config.id,
        label: transfer.label,
      });
      return;
    }
    if (!this.faults.verificationBypassed) {
      try {
        verifyManifest(
          packet.payload.manifest,
          packet.payload.manifest.created + this.now,
        );
        verifyBundle(packet.payload);
      } catch {
        node.rejectedCrypto++;
        this.record("crypto-rejected", {
          node: node.config.id,
          label: transfer.label,
        });
        return;
      }
    }
    const forwarded = { ...packet, hops: [...hops, node.config.id] };
    const stored = this.store(node, forwarded, transfer.label);
    if (!stored) return;
    this.remember(node, packet);
    node.accepted++;
    this.deliveries.push({
      node: node.config.id,
      label: transfer.label,
      at: this.now,
      hops: [...hops, node.config.id],
      priority: packet.priority,
      verified: !this.faults.verificationBypassed,
    });
    this.record("accepted", { node: node.config.id, label: transfer.label });
    this.acknowledge(link, packet, transfer.label);
    if (
      node.config.relay &&
      !this.faults.routingDisabled &&
      hops.length < packet.maxHops
    )
      for (const next of this.links.values())
        if (next.config.from === node.config.id) this.enqueue(next, stored);
  }
  run(untilMs: number): SimulationReport {
    if (
      !Number.isSafeInteger(untilMs) ||
      untilMs < this.now ||
      untilMs > 3600_000
    )
      throw new Error("Simulation horizon must be at most one virtual hour");
    while (this.events[0]?.at <= untilMs) {
      if (++this.processedEvents > 200_000)
        throw new Error("Simulation event budget exhausted");
      const event = this.events.shift()!;
      this.now = event.at;
      event.run();
    }
    this.now = untilMs;
    for (const link of this.links.values()) this.maintain(link);
    return this.report();
  }
  report(): SimulationReport {
    return {
      kind: "SIMULATION",
      model: "directed-frame-store-forward-v1",
      seed: this.seed,
      elapsedMs: this.now,
      processedEvents: this.processedEvents,
      faults: { ...this.faults },
      bounds: TRANSPORT_LIMITS,
      nodes: [...this.nodes.values()].map(
        ({ config, cache, seen: _seen, ...state }) => ({
          ...config,
          ...state,
          storedObjects: cache.size,
        }),
      ),
      links: [...this.links.values()].map((l) => ({
        ...l.config,
        ...l.stats,
        queuedBytes: l.pendingBytes,
        queuedObjects: l.pending.size,
      })),
      deliveries: structuredClone(this.deliveries),
      trace: structuredClone(this.trace),
      omittedTraceEvents: this.omittedTraceEvents,
    };
  }
}

export interface Expectations {
  required?: Array<{ node: string; label: string }>;
  forbidden?: Array<{ node: string; label: string }>;
}
export function assess(report: SimulationReport, expectations: Expectations) {
  const failures: string[] = [];
  for (const x of expectations.required ?? [])
    if (
      !report.deliveries.some((d) => d.node === x.node && d.label === x.label)
    )
      failures.push(`Missing required delivery ${x.label} at ${x.node}`);
  for (const x of expectations.forbidden ?? [])
    if (report.deliveries.some((d) => d.node === x.node && d.label === x.label))
      failures.push(`Forbidden delivery ${x.label} accepted at ${x.node}`);
  for (const node of report.nodes)
    if (
      node.maxStoredBytes > node.storageBytes ||
      node.maxStoredObjects > node.maxObjects!
    )
      failures.push(`Storage bound exceeded at ${node.id}`);
  for (const link of report.links)
    if (
      link.maxQueueBytes > link.queueBytes ||
      link.maxQueueObjects > link.queueSlots ||
      link.maxWireSegment > link.mtu ||
      link.maxFrameBytes > report.bounds.maxFrameBytes ||
      link.maxAssemblies > report.bounds.maxAssemblies ||
      link.maxAssemblyBytes > report.bounds.maxPendingBytes
    )
      failures.push(`Transport bound exceeded at ${link.id}`);
  return { pass: failures.length === 0, failures };
}
