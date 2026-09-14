import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import type { Router } from "./index.js";

const MAX_FRAME = 4097;
const address = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{32}$/.test(value);

class RnsStream extends Duplex {
  pending?: (error?: Error | null) => void;
  constructor(
    readonly id: string,
    private adapter: ReticulumAdapter,
  ) {
    super({ highWaterMark: 8192 });
  }
  _read() {}
  receive(bytes: Buffer) {
    if (this.readableLength + bytes.length > 8192) this.destroy();
    else this.push(bytes);
  }
  _write(
    bytes: Buffer,
    _encoding: BufferEncoding,
    done: (error?: Error | null) => void,
  ) {
    if (!bytes.length || bytes.length > MAX_FRAME || this.pending) {
      done(new Error("Limite de escrita Reticulum"));
      return;
    }
    this.pending = done;
    try {
      this.adapter.command({
        t: "send",
        id: this.id,
        data: bytes.toString("base64"),
      });
    } catch (error) {
      this.pending = undefined;
      done(error as Error);
    }
  }
  written() {
    const pending = this.pending;
    this.pending = undefined;
    pending?.();
  }
  _destroy(error: Error | null, done: (error?: Error | null) => void) {
    const pending = this.pending;
    this.pending = undefined;
    pending?.(error ?? new Error("Ligação Reticulum encerrada"));
    this.adapter.drop(this.id);
    done(error);
  }
}

/** Owns exactly one dedicated reference RNS process; no shell, global daemon or content keys. */
export class ReticulumAdapter {
  readonly process: ChildProcessWithoutNullStreams;
  readonly streams = new Map<string, RnsStream>();
  readonly paths = new Map<string, { destination: string; hops: number }>();
  destination = "";
  private diagnostics: unknown = null;
  private desired = new Set<string>();
  private closed = false;
  private output = "";
  private errors = "";
  private exited: Promise<void>;
  private ready: Promise<void>;
  private rejectReady!: (error: Error) => void;
  private resolveReady!: () => void;
  constructor(
    private router: Router,
    options: { python: string; config: string },
  ) {
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.process = spawn(
      options.python,
      [
        "-u",
        fileURLToPath(
          new URL("../../../adapters/reticulum/sidecar.py", import.meta.url),
        ),
        "--config",
        options.config,
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    this.exited = new Promise((resolve) =>
      this.process.once("close", () => {
        this.fail(new Error("Reticulum terminou: " + this.errors.slice(-1024)));
        resolve();
      }),
    );
    this.process.on("error", (error) => this.fail(error));
    this.process.stdin.on("error", (error) => this.fail(error));
    this.process.stderr.on(
      "data",
      (data) => (this.errors = (this.errors + data).slice(-8192)),
    );
    this.process.stdout.on("data", (data: Buffer) => {
      try {
        this.output += data.toString("utf8");
        if (this.output.length > 256 * 1024)
          throw new Error("Limite IPC Reticulum");
        let end: number;
        while ((end = this.output.indexOf("\n")) >= 0) {
          if (end > 8192) throw new Error("Frame IPC Reticulum inválida");
          const line = this.output.slice(0, end);
          this.output = this.output.slice(end + 1);
          this.event(JSON.parse(line));
        }
        if (this.output.length > 8192)
          throw new Error("Frame IPC Reticulum incompleta");
      } catch (error) {
        this.fail(error as Error);
      }
    });
  }
  static async start(
    router: Router,
    options: { python: string; config: string },
  ) {
    const adapter = new ReticulumAdapter(router, options);
    const timer = setTimeout(
      () => adapter.fail(new Error("Arranque Reticulum excedeu o prazo")),
      15_000,
    );
    try {
      await adapter.ready;
      return adapter;
    } catch (error) {
      await adapter.close();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  private event(value: any) {
    if (this.closed) return;
    if (value.t === "stats") {
      this.diagnostics = value;
      return;
    }
    if (
      value.t === "ready" &&
      !this.destination &&
      address(value.destination) &&
      value.version === "1.5.4"
    ) {
      this.destination = value.destination;
      this.resolveReady();
      return;
    }
    if (!address(value.id)) throw new Error("Identificador IPC inválido");
    if (value.t === "up") {
      if (
        !address(value.destination) ||
        this.streams.has(value.id) ||
        this.streams.size >= 16 ||
        !Number.isInteger(value.hops)
      )
        throw new Error("Ligação IPC inválida");
      const stream = new RnsStream(value.id, this);
      this.streams.set(value.id, stream);
      this.paths.set(value.id, {
        destination: value.destination,
        hops: value.hops,
      });
      this.router.attachStream(stream, "reticulum", value.destination);
    } else if (value.t === "data") {
      if (
        typeof value.data !== "string" ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data) ||
        value.data.length > 344
      )
        throw new Error("Dados IPC inválidos");
      const bytes = Buffer.from(value.data, "base64");
      if (bytes.length > 256 || bytes.toString("base64") !== value.data)
        throw new Error("Segmento IPC inválido");
      this.streams.get(value.id)?.receive(bytes);
    } else if (value.t === "written") this.streams.get(value.id)?.written();
    else if (value.t === "down") this.streams.get(value.id)?.destroy();
    else throw new Error("Evento IPC desconhecido");
  }
  command(value: unknown) {
    const line = JSON.stringify(value) + "\n";
    if (
      this.closed ||
      line.length > 8192 ||
      this.process.stdin.writableLength + line.length > 128 * 1024
    )
      throw new Error("Reticulum indisponível ou fila cheia");
    this.process.stdin.write(line);
  }
  connect(destination: string) {
    if (!address(destination) || destination === this.destination)
      throw new Error("Destino Reticulum inválido");
    if (!this.desired.has(destination) && this.desired.size >= 16)
      throw new Error("Limite de destinos Reticulum");
    this.command({ t: "connect", destination });
    this.desired.add(destination);
  }
  drop(id: string) {
    this.streams.delete(id);
    this.paths.delete(id);
    if (!this.closed) {
      try {
        this.command({ t: "close", id });
      } catch (error) {
        this.fail(error as Error);
      }
    }
  }
  state() {
    return {
      destination: this.destination,
      running: !this.closed,
      paths: [...this.paths.values()],
      diagnostics: this.diagnostics,
      progress: [...this.router.links]
        .filter((link) => link.state.medium === "reticulum")
        .map((link) => ({
          queued: [...link.pending.values()].map((value) => ({
            priority: value.packet.priority,
            next: value.next,
            count: Math.ceil(value.bytes / 2048),
          })),
          assembling: [...link.assemblies.values()].map((value) => ({
            count: value.count,
            received: value.parts.size,
          })),
        })),
    };
  }
  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    this.rejectReady(error);
    for (const stream of [...this.streams.values()]) stream.destroy();
    this.process.stdin.end();
  }
  async close() {
    if (!this.closed) {
      try {
        this.command({ t: "stop" });
      } catch {}
      this.fail(new Error("Reticulum encerrado"));
    }
    // Only the subprocess owned by this adapter; cleanup must finish after errors too.
    const timer = setTimeout(() => this.process.kill("SIGTERM"), 5000);
    try {
      await this.exited;
    } finally {
      clearTimeout(timer);
    }
  }
}
