import { createServer as httpServer, type Server } from "node:http";
import { createServer as httpsServer } from "node:https";
import { Duplex } from "node:stream";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { exactShape } from "../../core/src/protocol.js";
import type { Router } from "./index.js";

const protocol = "relayloom-stream-v1";
const MAX_FRAME = 4097;
export interface WebPeerInvitation {
  version: 1;
  endpoint: string;
  token: string;
  origin: string;
  expires: number;
}
export function webOrigin(value: string): string {
  if (typeof value !== "string" || value.length > 2048)
    throw new Error("Origem web inválida");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== value ||
    url.hostname.includes("*") ||
    url.username ||
    url.password
  )
    throw new Error("Origem web inválida");
  return value;
}
export const loopback = (host: string) =>
  ["127.0.0.1", "::1", "[::1]", "localhost"].includes(host);

/** WS controls are consumed here; only ordinary native stream frames reach the router. */
class WebSocketStream extends Duplex {
  discard?: (id: string) => void;
  #window = Date.now();
  #frames = 0;
  #bytes = 0;
  #controls = 0;
  constructor(private ws: WebSocket) {
    super({ highWaterMark: 16 * 1024 });
    ws.on("message", (raw, binary) => {
      try {
        const bytes = Buffer.isBuffer(raw)
          ? raw
          : Buffer.concat(raw as Buffer[]);
        if (Date.now() - this.#window >= 1000) {
          this.#window = Date.now();
          this.#frames = this.#bytes = this.#controls = 0;
        }
        this.#frames++;
        this.#bytes += bytes.length;
        if (
          bytes.length < 2 ||
          bytes.length > MAX_FRAME ||
          this.#frames > 8192 ||
          this.#bytes > 12 * 1024 * 1024 ||
          bytes[bytes.length - 1] !== 10
        )
          throw new Error("Frame inválida");
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          frame = JSON.parse(text);
        if (frame?.t === "ping" || frame?.t === "drop") {
          if (++this.#controls > 64) throw new Error("Limite de controlos");
          if (
            frame.t === "ping" &&
            exactShape(frame, ["t", "nonce"]) &&
            typeof frame.nonce === "string" &&
            /^[a-f0-9-]{36}$/.test(frame.nonce)
          )
            this.control({ t: "pong", nonce: frame.nonce });
          else if (
            frame.t === "drop" &&
            exactShape(frame, ["t", "id"]) &&
            typeof frame.id === "string" &&
            /^[a-f0-9]{64}$/.test(frame.id)
          )
            this.discard?.(frame.id);
          else throw new Error("Controlo inválido");
          return;
        }
        if (!this.push(bytes)) ws.pause();
      } catch {
        this.destroy();
      }
    });
    ws.on("close", () => {
      this.push(null);
      this.destroy();
    });
    ws.on("error", () => this.destroy());
  }
  _read() {
    this.ws.resume();
  }
  _write(
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    if (
      chunk.length > MAX_FRAME ||
      this.ws.readyState !== 1 ||
      this.ws.bufferedAmount > 256 * 1024
    ) {
      callback(new Error("Ligação indisponível"));
      return;
    }
    this.ws.send(chunk, { binary: true }, callback);
  }
  private control(value: unknown) {
    if (this.ws.readyState !== 1 || this.ws.bufferedAmount > 256 * 1024) {
      this.destroy();
      return;
    }
    this.ws.send(JSON.stringify(value) + "\n", (error) => {
      if (error) this.destroy();
    });
  }
  cancelPacket(id: string) {
    if (/^[a-f0-9]{64}$/.test(id)) this.control({ t: "drop", id });
  }
  _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    this.ws.terminate();
    callback(error);
  }
}
export async function listenWebSocket(
  router: Router,
  options: {
    origin: string;
    port?: number;
    host?: string;
    advertisedHost?: string;
    ttlMs?: number;
    tls?: { key: Buffer; cert: Buffer };
  },
) {
  const origin = webOrigin(options.origin),
    host = options.host ?? "127.0.0.1",
    port = options.port ?? 0,
    ttl = options.ttlMs ?? 600_000;
  if (
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535 ||
    !Number.isSafeInteger(ttl) ||
    ttl < 1000 ||
    ttl > 3600_000 ||
    (!loopback(host) && !options.tls)
  )
    throw new Error(
      "Configuração WebSocket inválida; TLS é obrigatório fora de loopback",
    );
  const advertisedHost = options.advertisedHost ?? host;
  const check = new URL(
    `${options.tls ? "https" : "http"}://${advertisedHost.includes(":") && !advertisedHost.startsWith("[") ? "[" + advertisedHost + "]" : advertisedHost}`,
  );
  if (
    check.hostname.includes("*") ||
    check.username ||
    check.password ||
    check.pathname !== "/" ||
    check.search ||
    check.hash ||
    check.port ||
    ["0.0.0.0", "[::]"].includes(check.hostname)
  )
    throw new Error("Endereço anunciado inválido");
  const token = randomBytes(32).toString("hex"),
    expires = Date.now() + ttl;
  const server: Server = options.tls ? httpsServer(options.tls) : httpServer();
  server.maxConnections = 32;
  server.maxRequestsPerSocket = 4;
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  server.keepAliveTimeout = 2000;
  server.on("request", (_req, res) => {
    res.writeHead(404, { "Cache-Control": "no-store" });
    res.end();
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME,
    perMessageDeflate: false,
    handleProtocols: (protocols) =>
      protocols.has(protocol) ? protocol : false,
  });
  const streams = new Set<WebSocketStream>(),
    sockets = new Set<import("node:net").Socket>();
  const rates = new Map<string, { at: number; n: number }>();
  let stopped = false,
    closing: Promise<void> | undefined,
    endpoint = "";
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (req, socket, head) => {
    const refuse = () => {
      socket.end(
        "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
    };
    try {
      const now = Date.now();
      for (const [key, value] of rates)
        if (now - value.at >= 60_000) rates.delete(key);
      const ip = req.socket.remoteAddress ?? "unknown";
      if (!rates.has(ip) && rates.size >= 128) return refuse();
      const rate = rates.get(ip) ?? { at: now, n: 0 };
      rate.n++;
      rates.set(ip, rate);
      const offered = (req.headers["sec-websocket-protocol"] ?? "")
        .split(",")
        .map((s) => s.trim());
      const supplied =
        offered.find((s) => s.startsWith("invite-"))?.slice(7) ?? "";
      if (
        stopped ||
        now >= expires ||
        rate.n > 30 ||
        streams.size >= 8 ||
        req.method !== "GET" ||
        req.url !== "/relayloom" ||
        req.headers.host !== new URL(endpoint).host ||
        req.headers.origin !== origin ||
        offered.length !== 2 ||
        !offered.includes(protocol) ||
        !/^[a-f0-9]{64}$/.test(supplied) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
      )
        return refuse();
      wss.handleUpgrade(req, socket, head, (ws) => {
        const stream = new WebSocketStream(ws);
        streams.add(stream);
        stream.on("close", () => streams.delete(stream));
        const handle = router.attachStream(
          stream,
          "websocket",
          `${req.socket.remoteAddress}:${req.socket.remotePort}`,
        );
        stream.discard = handle.discard;
      });
    } catch {
      refuse();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  endpoint = `${options.tls ? "wss" : "ws"}://${check.host}:${(server.address() as { port: number }).port}/relayloom`;
  const timer = setTimeout(
    () => {
      for (const stream of streams) stream.destroy();
    },
    Math.max(0, expires - Date.now()),
  );
  timer.unref();
  const invitation: WebPeerInvitation = {
    version: 1,
    endpoint,
    token,
    origin,
    expires,
  };
  return {
    invitation,
    state: () => ({
      endpoint,
      origin,
      expires,
      connections: streams.size,
      active: !stopped && Date.now() < expires,
    }),
    close: () =>
      (closing ??= (async () => {
        stopped = true;
        clearTimeout(timer);
        for (const stream of streams) stream.destroy();
        for (const socket of sockets) socket.destroy();
        await Promise.all([
          new Promise<void>((resolve) => wss.close(() => resolve())),
          new Promise<void>((resolve) => server.close(() => resolve())),
        ]);
      })()),
  };
}
