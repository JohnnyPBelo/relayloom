import { canonical, exactShape } from "../../core/src/protocol";
import type { Bundle } from "../../core/src/protocol";
import { b64, un64, utf8, verifiedBundle } from "./crypto";

export const RTC_LIMITS = Object.freeze({
  frame: 24_000,
  fragment: 12_288,
  bundle: 6 * 1024 * 1024,
  pending: 16 * 1024 * 1024,
  transfers: 8,
  transferMs: 15_000,
  signalBytes: 64_000,
});
type Assembly = {
  parts: Uint8Array[];
  count: number;
  bytes: number;
  next: number;
  deadline: number;
};
type Pending = {
  bytes: Uint8Array;
  id: string;
  index: number;
  count: number;
  rank: number;
  scheduled: number;
  allowed: () => boolean;
  finish: (error?: Error) => void;
};
const decoder = new TextDecoder("utf-8", { fatal: true });
const address = (id: unknown): id is string =>
  typeof id === "string" && /^[a-f0-9]{64}$/.test(id);

export interface RtcCodec<T> {
  protocol: string;
  verified(value: T): Promise<T>;
  id(value: T): string;
  expires?(value: T): number;
}
export class RtcCapacityError extends Error {}
export type RtcCloseReason =
  | "local"
  | "remote"
  | "channel-error"
  | "invalid-frame"
  | "incomplete-transfer"
  | "heartbeat-timeout"
  | "receipt-timeout"
  | "connection-failed"
  | "signalling-error";
const bundleCodec: RtcCodec<Bundle> = {
  protocol: "relayloom-bundles-v1",
  verified: verifiedBundle,
  id: (b) => b.manifest.id,
};

export interface ReliableMessageStream extends EventTarget {
  readonly ordered: boolean;
  readonly maxPacketLifeTime: number | null;
  readonly maxRetransmits: number | null;
  readonly readyState: RTCDataChannelState;
  readonly bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  send(data: string): void;
  close(): void;
}
const rtcFraming = {
  fragment: RTC_LIMITS.fragment,
  frame: RTC_LIMITS.frame,
  repeated: false,
};
export const nativeStreamFraming = Object.freeze({
  fragment: 2048,
  frame: 4096,
  repeated: true,
});

/** Bounded reliable link; the supplied codec owns cryptographic/wire verification. */
export class RtcMessageChannel<T> {
  #pending = new Map<string, Pending>();
  #assemblies = new Map<string, Assembly>();
  #completed = new Map<string, { expires: number; acknowledged: number }>();
  #pendingBytes = 0;
  #assemblyBytes = 0;
  #queuedBytes = 0;
  #chain = Promise.resolve();
  #closed = false;
  closeReason?: RtcCloseReason;
  #preparing = 0;
  #preparingBytes = 0;
  #pumping = false;
  #turn = 0;
  #ping?: { nonce: string; deadline: number };
  #lastProbe = Date.now();
  #controlStart = Date.now();
  #controls = 0;
  #timer: ReturnType<typeof setInterval>;
  readonly counters = { sent: 0, received: 0, accepted: 0, rejected: 0 };
  constructor(
    readonly channel: ReliableMessageStream,
    private receive: (value: T) => Promise<void>,
    private codec: RtcCodec<T>,
    private framing: {
      fragment: number;
      frame: number;
      repeated: boolean;
    } = rtcFraming,
  ) {
    if (
      !channel.ordered ||
      channel.maxPacketLifeTime !== null ||
      channel.maxRetransmits !== null
    )
      throw new Error("É necessário um canal fiável e ordenado");
    channel.bufferedAmountLowThreshold = 64 * 1024;
    channel.addEventListener("close", () => this.close("remote"));
    channel.addEventListener("error", () => this.close("channel-error"));
    channel.addEventListener("message", (event) => {
      const frame = (event as MessageEvent).data;
      if (
        typeof frame !== "string" ||
        frame.length > this.framing.frame ||
        this.#queuedBytes + frame.length > RTC_LIMITS.pending
      ) {
        this.counters.rejected++;
        this.close("invalid-frame");
        return;
      }
      this.#queuedBytes += frame.length;
      this.#chain = this.#chain
        .then(async () => {
          if (this.#closed) return;
          try {
            await this.accept(JSON.parse(frame));
          } catch {
            this.counters.rejected++;
            this.close("invalid-frame");
          }
        })
        .finally(() => {
          this.#queuedBytes -= frame.length;
        });
    });
    this.#timer = setInterval(() => {
      const now = Date.now();
      for (const [id, entry] of this.#completed)
        if (entry.expires <= now) this.#completed.delete(id);
      if (
        [...this.#assemblies.values()].some((a) => a.deadline <= now) ||
        (this.#ping && this.#ping.deadline <= now)
      ) {
        this.close(
          this.#ping && this.#ping.deadline <= now
            ? "heartbeat-timeout"
            : "incomplete-transfer",
        );
        return;
      }
      if (
        !this.#closed &&
        channel.readyState === "open" &&
        !this.#ping &&
        now - this.#lastProbe >= 2000 &&
        channel.bufferedAmount <= 128 * 1024
      ) {
        const nonce = crypto.randomUUID();
        this.#ping = { nonce, deadline: now + 5000 };
        this.#lastProbe = now;
        void this.write({ t: "ping", nonce }).catch(() => this.close());
      }
    }, 1000);
  }
  get closed() {
    return this.#closed;
  }
  get resources() {
    return {
      outgoingBytes: this.#pendingBytes,
      incomingBytes: this.#assemblyBytes,
      queuedBytes: this.#queuedBytes,
      outgoing: this.#pending.size,
      incoming: this.#assemblies.size,
      completed: this.#completed.size,
    };
  }
  close(reason: RtcCloseReason = "local"): void {
    if (this.#closed) return;
    this.closeReason = reason;
    this.#closed = true;
    clearInterval(this.#timer);
    for (const p of this.#pending.values())
      p.finish(new Error("Ligação encerrada antes da confirmação"));
    this.#pending.clear();
    this.#assemblies.clear();
    this.#completed.clear();
    this.#pendingBytes = this.#assemblyBytes = 0;
    this.channel.close();
  }
  async ready(): Promise<void> {
    if (this.channel.readyState === "open" && !this.#closed) return;
    if (this.#closed || this.channel.readyState === "closed")
      throw new Error("Ligação encerrada");
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.channel.removeEventListener("open", opened);
        this.channel.removeEventListener("close", closed);
      };
      const opened = () => {
          cleanup();
          resolve();
        },
        closed = () => {
          cleanup();
          reject(new Error("Ligação encerrada"));
        };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Não foi possível estabelecer o caminho entre pares"));
      }, RTC_LIMITS.transferMs);
      this.channel.addEventListener("open", opened);
      this.channel.addEventListener("close", closed);
    });
  }
  private async write(
    frame: unknown,
    allowed: () => boolean = () => true,
  ): Promise<void> {
    if (!allowed() || this.#closed || this.channel.readyState !== "open")
      throw new Error("Ligação indisponível");
    if (this.channel.bufferedAmount > 128 * 1024) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          this.channel.removeEventListener("bufferedamountlow", low);
          this.channel.removeEventListener("close", closed);
        };
        const low = () => {
            cleanup();
            resolve();
          },
          closed = () => {
            cleanup();
            reject(new Error("Ligação encerrada"));
          };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("Ligação congestionada"));
        }, RTC_LIMITS.transferMs);
        this.channel.addEventListener("bufferedamountlow", low);
        this.channel.addEventListener("close", closed);
      });
    }
    if (!allowed() || this.#closed || this.channel.readyState !== "open")
      throw new Error("Ligação indisponível");
    const encoded = canonical(frame);
    if (encoded.length > this.framing.frame)
      throw new Error("Fragmento demasiado grande");
    this.channel.send(encoded);
    this.counters.sent += utf8(encoded).length;
  }
  /** Resolves after peer acceptance; callers still need signed application receipts. */
  async send(
    value: T,
    allowed: () => boolean = () => true,
    priority: "sos" | "normal" | "bulk" = "normal",
  ): Promise<void> {
    if (
      !["sos", "normal", "bulk"].includes(priority) ||
      this.#closed ||
      !allowed()
    )
      throw new Error("Envio não autorizado");
    const preparedSize = utf8(canonical(value)).length;
    if (
      preparedSize > RTC_LIMITS.bundle ||
      this.#pending.size + this.#preparing >= RTC_LIMITS.transfers ||
      this.#pendingBytes + this.#preparingBytes + preparedSize >
        RTC_LIMITS.pending
    )
      throw new RtcCapacityError("Limite de transferências");
    this.#preparing++;
    this.#preparingBytes += preparedSize;
    let bytes: Uint8Array, id: string;
    try {
      const owned = await this.codec.verified(value);
      bytes = utf8(canonical(owned));
      id = this.codec.id(owned);
      await this.ready();
      if (this.#closed || !allowed()) throw new Error("Envio cancelado");
      if (
        bytes.length > RTC_LIMITS.bundle ||
        this.#pendingBytes + bytes.length > RTC_LIMITS.pending ||
        this.#pending.has(id)
      )
        throw new RtcCapacityError("Limite de transferências");
    } finally {
      this.#preparing--;
      this.#preparingBytes -= preparedSize;
    }
    let finish!: (error?: Error) => void;
    const ack = new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        finish(new Error("Confirmação de armazenamento em falta"));
        this.close("receipt-timeout");
      }, RTC_LIMITS.transferMs);
      finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.#pending.delete(id)) this.#pendingBytes -= bytes.length;
        error ? reject(error) : resolve();
      };
    });
    void ack.catch(() => {});
    this.#pending.set(id, {
      id,
      bytes,
      index: 0,
      count: Math.ceil(bytes.length / this.framing.fragment),
      rank: priority === "sos" ? 0 : priority === "normal" ? 1 : 2,
      scheduled: 0,
      allowed,
      finish,
    });
    this.#pendingBytes += bytes.length;
    void this.pump();
    return ack;
  }
  private async pump(): Promise<void> {
    if (this.#pumping || this.#closed) return;
    this.#pumping = true;
    try {
      while (!this.#closed) {
        const eligible = [...this.#pending.values()].filter(
          (p) => p.index < p.count,
        );
        if (!eligible.length) break;
        // Seven priority turns, then one least-recently-served fragment to prevent bulk starvation.
        const fair = this.#turn % 8 === 7;
        eligible.sort(
          (a, b) => (fair ? 0 : a.rank - b.rank) || a.scheduled - b.scheduled,
        );
        const next = eligible[0];
        try {
          await this.write(
            {
              t: "part",
              id: next.id,
              index: next.index,
              count: next.count,
              data: b64(
                next.bytes.subarray(
                  next.index * this.framing.fragment,
                  (next.index + 1) * this.framing.fragment,
                ),
              ),
            },
            next.allowed,
          );
          next.index++;
          next.scheduled = ++this.#turn;
        } catch (error) {
          next.finish(
            error instanceof Error ? error : new Error("Transferência falhou"),
          );
          if (!next.allowed() && !this.#closed)
            await this.write({ t: "drop", id: next.id });
          else {
            this.close();
            break;
          }
        }
        // Let incoming ACKs, policy changes and newly queued SOS frames run between batches.
        if (this.#turn % 8 === 0)
          await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch {
      this.close();
    } finally {
      this.#pumping = false;
    }
  }
  private async accept(frame: any): Promise<void> {
    if (
      frame?.t === "ping" ||
      frame?.t === "pong" ||
      frame?.t === "ack" ||
      frame?.t === "drop"
    ) {
      const now = Date.now();
      if (now - this.#controlStart >= 1000) {
        this.#controlStart = now;
        this.#controls = 0;
      }
      if (++this.#controls > 64)
        throw new Error("Demasiados controlos de ligação");
    }
    if (frame?.t === "ping" || frame?.t === "pong") {
      if (
        !exactShape(frame, ["t", "nonce"]) ||
        typeof frame.nonce !== "string" ||
        !/^[a-f0-9-]{36}$/.test(frame.nonce)
      )
        throw new Error("Controlo de presença inválido");
      if (frame.t === "ping")
        await this.write({ t: "pong", nonce: frame.nonce });
      else if (this.#ping?.nonce === frame.nonce) this.#ping = undefined;
      else throw new Error("Resposta de presença inesperada");
      return;
    }
    if (!address(frame?.id)) throw new Error("Endereço inválido");
    if (frame.t === "drop" && exactShape(frame, ["t", "id"])) {
      const assembly = this.#assemblies.get(frame.id);
      if (assembly) {
        this.#assemblyBytes -= assembly.bytes;
        this.#assemblies.delete(frame.id);
      }
      return;
    }
    if (frame.t === "ack" && exactShape(frame, ["t", "id"])) {
      this.#pending.get(frame.id)?.finish();
      return;
    }
    if (
      !exactShape(frame, ["t", "id", "index", "count", "data"]) ||
      frame.t !== "part" ||
      !Number.isInteger(frame.index) ||
      !Number.isInteger(frame.count) ||
      frame.count < 1 ||
      frame.count > Math.ceil(RTC_LIMITS.bundle / this.framing.fragment) ||
      frame.index < 0 ||
      frame.index >= frame.count
    )
      throw new Error("Fragmento inválido");
    const data = un64(frame.data, this.framing.frame);
    if (
      !data.length ||
      data.length > this.framing.fragment ||
      (frame.index < frame.count - 1 && data.length !== this.framing.fragment)
    )
      throw new Error("Fragmento inválido");
    const completed = this.#completed.get(frame.id),
      now = Date.now();
    if (completed && completed.expires > now) {
      // A late ACK can stop a native retry after just a few fragments. Never
      // recreate an incomplete assembly for a packet already accepted here.
      if (now - completed.acknowledged >= 1000) {
        completed.acknowledged = now;
        await this.write({ t: "ack", id: frame.id });
      }
      return;
    }
    if (completed) this.#completed.delete(frame.id);
    let a = this.#assemblies.get(frame.id);
    if (!a) {
      if (frame.index !== 0 || this.#assemblies.size >= RTC_LIMITS.transfers)
        throw new Error("Limite de reassemblagem");
      a = {
        parts: [],
        count: frame.count,
        next: 0,
        bytes: 0,
        deadline: Date.now() + RTC_LIMITS.transferMs,
      };
      this.#assemblies.set(frame.id, a);
    }
    if (
      this.framing.repeated &&
      frame.index < a.next &&
      a.count === frame.count
    ) {
      const previous = a.parts[frame.index];
      if (
        !previous ||
        previous.length !== data.length ||
        previous.some((byte, index) => byte !== data[index])
      )
        throw new Error("Fragmento repetido foi alterado");
      return;
    }
    if (
      a.count !== frame.count ||
      frame.index !== a.next ||
      a.bytes + data.length > RTC_LIMITS.bundle ||
      this.#assemblyBytes + data.length > RTC_LIMITS.pending
    )
      throw new Error("Reassemblagem inválida");
    a.parts.push(data);
    a.next++;
    a.bytes += data.length;
    this.#assemblyBytes += data.length;
    if (a.next !== a.count) return;
    this.#assemblies.delete(frame.id);
    this.#assemblyBytes -= a.bytes;
    const joined = new Uint8Array(a.bytes);
    let at = 0;
    for (const part of a.parts) {
      joined.set(part, at);
      at += part.length;
    }
    const bundle = await this.codec.verified(
      JSON.parse(decoder.decode(joined)),
    );
    if (this.codec.id(bundle) !== frame.id)
      throw new Error("Endereço não corresponde");
    // Includes application authorization/storage failures: no success ACK and no forwarding on failure.
    if (this.#closed) return;
    await this.receive(bundle);
    if (this.#closed) return;
    if (this.framing.repeated) {
      const now = Date.now(),
        expires = this.codec.expires?.(bundle) ?? now + RTC_LIMITS.transferMs;
      if (Number.isSafeInteger(expires) && expires > now) {
        if (this.#completed.size >= 4096)
          this.#completed.delete(this.#completed.keys().next().value!);
        this.#completed.set(frame.id, {
          expires: Math.min(expires, now + 3600_000),
          acknowledged: now,
        });
      }
    }
    this.counters.accepted++;
    this.counters.received += a.bytes;
    await this.write({ t: "ack", id: frame.id });
  }
}

/** SDP is exchanged explicitly; no mandatory signalling/STUN/TURN service or external traffic. */
export class RtcTransportPeer<T> {
  readonly connection = new RTCPeerConnection({ iceServers: [] });
  link?: RtcMessageChannel<T>;
  #closed = false;
  #reason?: RtcCloseReason;
  /** Deliberately excludes SDP, candidates, addresses, keys and content. */
  get diagnostics() {
    return {
      connection: this.connection.connectionState,
      ice: this.connection.iceConnectionState,
      gathering: this.connection.iceGatheringState,
      signalling: this.connection.signalingState,
      channel: this.link?.channel.readyState ?? "absent",
      closed: this.#closed || this.link?.closed === true,
      reason: this.#reason ?? this.link?.closeReason ?? null,
      sent: this.link?.counters.sent ?? 0,
      received: this.link?.counters.received ?? 0,
    };
  }
  constructor(
    private receive: (value: T) => Promise<void>,
    private codec: RtcCodec<T>,
  ) {
    this.connection.ondatachannel = (event) => {
      if (
        this.#closed ||
        this.link ||
        event.channel.label !== this.codec.protocol ||
        event.channel.protocol !== this.codec.protocol
      ) {
        event.channel.close();
        return;
      }
      try {
        this.link = new RtcMessageChannel(
          event.channel,
          this.receive,
          this.codec,
        );
      } catch {
        event.channel.close();
        this.close("connection-failed");
      }
    };
    this.connection.onconnectionstatechange = () => {
      if (
        this.connection.connectionState === "failed" ||
        this.connection.connectionState === "closed"
      )
        this.close(
          this.connection.connectionState === "failed"
            ? "connection-failed"
            : "remote",
        );
    };
  }
  close(reason: RtcCloseReason = "local"): void {
    if (this.#closed) return;
    this.#reason = this.link?.closeReason ?? reason;
    this.#closed = true;
    this.link?.close(reason);
    this.connection.close();
  }
  private remote(
    signal: string,
    type: "offer" | "answer",
  ): RTCSessionDescriptionInit {
    if (typeof signal !== "string" || signal.length > RTC_LIMITS.signalBytes)
      throw new Error("Convite de ligação demasiado grande");
    let value: any;
    try {
      value = JSON.parse(signal);
    } catch {
      throw new Error(
        "Código inválido. Copia o código completo, incluindo as chavetas.",
      );
    }
    if (value?.type !== type)
      throw new Error(
        type === "offer"
          ? "É necessário um código de ligação, criado em A rede. Um cartão de contacto não abre uma ligação."
          : "É necessária a resposta criada no outro dispositivo, em Receber código.",
      );
    if (
      !exactShape(value, ["type", "sdp"]) ||
      value.type !== type ||
      typeof value.sdp !== "string" ||
      !value.sdp.startsWith("v=0\r\n")
    )
      throw new Error("Convite de ligação inválido");
    return value;
  }
  private async gather(): Promise<string> {
    if (this.connection.iceGatheringState !== "complete")
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          this.connection.removeEventListener(
            "icegatheringstatechange",
            change,
          );
          this.connection.removeEventListener("connectionstatechange", change);
        };
        const change = () => {
          if (this.#closed) {
            cleanup();
            reject(new Error("Ligação encerrada"));
          } else if (this.connection.iceGatheringState === "complete") {
            cleanup();
            resolve();
          }
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("Não foi possível obter endereços de ligação"));
        }, 7500);
        this.connection.addEventListener("icegatheringstatechange", change);
        this.connection.addEventListener("connectionstatechange", change);
      });
    if (this.#closed || !this.connection.localDescription)
      throw new Error("Ligação encerrada");
    const { type, sdp } = this.connection.localDescription,
      encoded = JSON.stringify({ type, sdp });
    if (encoded.length > RTC_LIMITS.signalBytes)
      throw new Error("Convite de ligação demasiado grande");
    return encoded;
  }
  async offer(): Promise<string> {
    if (this.link || this.#closed) throw new Error("Ligação já iniciada");
    this.link = new RtcMessageChannel(
      this.connection.createDataChannel(this.codec.protocol, {
        ordered: true,
        protocol: this.codec.protocol,
      }),
      this.receive,
      this.codec,
    );
    try {
      await this.connection.setLocalDescription(
        await this.connection.createOffer(),
      );
      return await this.gather();
    } catch (error) {
      this.close("signalling-error");
      throw error;
    }
  }
  async answer(signal: string): Promise<string> {
    if (
      this.link ||
      this.#closed ||
      this.connection.signalingState !== "stable" ||
      this.connection.remoteDescription
    )
      throw new Error("Ligação já iniciada");
    try {
      await this.connection.setRemoteDescription(this.remote(signal, "offer"));
      await this.connection.setLocalDescription(
        await this.connection.createAnswer(),
      );
      return await this.gather();
    } catch (error) {
      this.close("signalling-error");
      throw error;
    }
  }
  async accept(signal: string): Promise<void> {
    if (
      !this.link ||
      this.#closed ||
      this.connection.signalingState !== "have-local-offer"
    )
      throw new Error("Oferta de ligação em falta");
    try {
      await this.connection.setRemoteDescription(this.remote(signal, "answer"));
    } catch (error) {
      this.close("signalling-error");
      throw error;
    }
  }
}

/** Compatible direct-bundle API retained for W1 users/tests. */
export class RtcBundleChannel extends RtcMessageChannel<Bundle> {
  constructor(
    channel: RTCDataChannel,
    receive: (bundle: Bundle) => Promise<void>,
  ) {
    super(channel, receive, bundleCodec);
  }
}
export class RtcPeer extends RtcTransportPeer<Bundle> {
  constructor(receive: (bundle: Bundle) => Promise<void>) {
    super(receive, bundleCodec);
  }
}
