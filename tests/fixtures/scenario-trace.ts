import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Client } from "../helpers.js";

/** Bounded local test diagnostics: only fixed phase/peer/API labels, timing,
 * process termination and counts. No request bodies, URLs or capabilities. */
export class ScenarioTrace {
  readonly path: string;
  private start = performance.now();
  private events: { phase: string; elapsedMs: number }[] = [];
  private active = new Map<
    number,
    { peer: string; api: string; action?: string; startedMs: number }
  >();
  private calls = new Map<
    string,
    { count: number; totalMs: number; maximumMs: number; failed: number }
  >();
  private clients = new Map<string, Client>();
  private sequence = 0;
  private aborted = false;
  private detach: (() => void)[] = [];
  private readonly onAbort = () => {
    this.aborted = true;
    this.flush(this.path + ".abort.json", "test-aborted");
  };
  constructor(
    name: string,
    private signal?: AbortSignal,
    directory = resolve(".cache/fixture-http-failures"),
  ) {
    mkdirSync(directory, { recursive: true });
    this.path = join(
      directory,
      `${name.replace(/[^a-z0-9-]/gi, "-")}-${process.pid}-${Date.now()}.json`,
    );
    signal?.addEventListener("abort", this.onAbort, { once: true });
    this.phase("start");
  }
  private elapsed() {
    return Math.round(performance.now() - this.start);
  }
  private label(value: unknown) {
    return typeof value === "string" && /^[a-z-]{1,40}$/.test(value)
      ? value
      : "unknown";
  }
  wrap(client: Client, peer: "author" | "seeder" | "newcomer" | "resumed") {
    this.clients.set(peer, client);
    const original = client.call;
    client.call = async (path, body) => {
      const id = ++this.sequence,
        started = this.elapsed();
      const api = this.label(path),
        action =
          body && typeof body === "object" && "action" in body
            ? this.label(body.action)
            : undefined;
      const key = `${peer}/${api}${action ? ":" + action : ""}`;
      const stats = this.calls.get(key) ?? {
        count: 0,
        totalMs: 0,
        maximumMs: 0,
        failed: 0,
      };
      if (this.active.size < 16)
        this.active.set(id, {
          peer,
          api,
          ...(action ? { action } : {}),
          startedMs: started,
        });
      try {
        return await original(path, body);
      } catch (error) {
        stats.failed++;
        throw error;
      } finally {
        const elapsed = this.elapsed() - started;
        stats.count++;
        stats.totalMs += elapsed;
        stats.maximumMs = Math.max(stats.maximumMs, elapsed);
        if (this.calls.size < 96 || this.calls.has(key))
          this.calls.set(key, stats);
        this.active.delete(id);
      }
    };
    this.detach.push(() => {
      client.call = original;
    });
    return client;
  }
  phase(phase: string) {
    if (this.events.length < 64)
      this.events.push({ phase, elapsedMs: this.elapsed() });
    this.flush(this.path, "running");
  }
  private flush(path: string, status: string) {
    const data = {
      status,
      elapsedMs: this.elapsed(),
      phases: this.events,
      active: [...this.active.values()],
      calls: Object.fromEntries(this.calls),
      processes: Object.fromEntries(
        [...this.clients].map(([peer, c]) => [
          peer,
          { exit: c.process.exitCode, signal: c.process.signalCode },
        ]),
      ),
    };
    writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
  }
  finish(passed: boolean) {
    this.signal?.removeEventListener("abort", this.onAbort);
    this.flush(
      this.path,
      this.aborted ? "test-aborted" : passed ? "passed" : "failed",
    );
    for (const detach of this.detach) detach();
  }
}
