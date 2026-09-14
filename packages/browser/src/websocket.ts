import { exactShape } from "../../core/src/protocol";
import {
  RtcMessageChannel,
  nativeStreamFraming,
  type ReliableMessageStream,
} from "./rtc";
import { packetCodec, type Packet } from "./packet";
export interface WebPeerInvitation {
  version: 1;
  endpoint: string;
  token: string;
  origin: string;
  expires: number;
}
export function validateWebInvitation(value: unknown): WebPeerInvitation {
  if (!exactShape(value, ["version", "endpoint", "token", "origin", "expires"]))
    throw new Error("Convite web inválido");
  const v = { ...(value as WebPeerInvitation) };
  if (
    v.version !== 1 ||
    typeof v.endpoint !== "string" ||
    v.endpoint.length > 2048 ||
    typeof v.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(v.token) ||
    v.origin !== location.origin ||
    !Number.isSafeInteger(v.expires) ||
    v.expires <= Date.now() ||
    v.expires > Date.now() + 3600_000 + 1000
  )
    throw new Error("Convite web inválido ou expirado");
  const url = new URL(v.endpoint);
  if (
    !["ws:", "wss:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/relayloom" ||
    url.search ||
    url.hash ||
    (url.protocol === "ws:" &&
      !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname))
  )
    throw new Error("A ligação web requer WSS, excepto em loopback");
  return v;
}
class WebSocketChannel extends EventTarget implements ReliableMessageStream {
  readonly ordered = true;
  readonly maxPacketLifeTime = null;
  readonly maxRetransmits = null;
  bufferedAmountLowThreshold = 64 * 1024;
  #closed = false;
  #timer?: ReturnType<typeof setTimeout>;
  constructor(private socket: WebSocket) {
    super();
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () =>
      this.dispatchEvent(new Event("open")),
    );
    socket.addEventListener("error", () => {
      this.dispatchEvent(new Event("error"));
      this.close();
    });
    socket.addEventListener("close", () => this.close());
    socket.addEventListener("message", (event) => {
      try {
        const raw = event.data;
        if (typeof raw !== "string" && !(raw instanceof ArrayBuffer))
          throw new Error("Frame inválida");
        const text =
          typeof raw === "string"
            ? raw
            : new TextDecoder("utf-8", { fatal: true }).decode(raw);
        if (
          text.length < 2 ||
          text.length > 4097 ||
          !text.endsWith("\n") ||
          text.slice(0, -1).includes("\n")
        )
          throw new Error("Frame inválida");
        if (!this.#closed)
          this.dispatchEvent(
            new MessageEvent("message", { data: text.slice(0, -1) }),
          );
      } catch {
        this.close();
      }
    });
  }
  get readyState(): RTCDataChannelState {
    return this.#closed
      ? "closed"
      : (["connecting", "open", "closing", "closed"][
          this.socket.readyState
        ] as RTCDataChannelState);
  }
  get bufferedAmount() {
    return this.socket.bufferedAmount;
  }
  private watchDrain() {
    if (
      this.#closed ||
      this.#timer ||
      this.bufferedAmount <= this.bufferedAmountLowThreshold
    )
      return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      if (this.#closed) return;
      if (this.bufferedAmount <= this.bufferedAmountLowThreshold)
        this.dispatchEvent(new Event("bufferedamountlow"));
      else this.watchDrain();
    }, 20);
  }
  send(data: string): void {
    if (this.#closed || data.length > 4096)
      throw new Error("Ligação indisponível");
    this.socket.send(data + "\n");
    this.watchDrain();
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#timer);
    this.socket.close();
    this.dispatchEvent(new Event("close"));
  }
}
export class BrowserWebSocketPeer {
  readonly link: RtcMessageChannel<Packet>;
  readonly endpoint: string;
  #timer: ReturnType<typeof setTimeout>;
  constructor(invitation: unknown, receive: (packet: Packet) => Promise<void>) {
    const v = validateWebInvitation(invitation);
    this.endpoint = v.endpoint;
    const socket = new WebSocket(v.endpoint, [
      "relayloom-stream-v1",
      "invite-" + v.token,
    ]);
    this.link = new RtcMessageChannel(
      new WebSocketChannel(socket),
      receive,
      packetCodec,
      nativeStreamFraming,
    );
    this.#timer = setTimeout(
      () => this.close(),
      Math.max(0, v.expires - Date.now()),
    );
    socket.addEventListener("open", () => {
      if (socket.protocol !== "relayloom-stream-v1") this.close();
    });
    socket.addEventListener("close", () => clearTimeout(this.#timer));
  }
  close() {
    clearTimeout(this.#timer);
    this.link.close();
  }
}
