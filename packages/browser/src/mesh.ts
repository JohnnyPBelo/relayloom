import { exactShape } from "../../core/src/protocol";
import type { Bundle } from "../../core/src/protocol";
import { verifiedBundle } from "./crypto";
import { inspectPublicSite } from "./site-content";
import type { PublicIdentity } from "../../core/src/protocol";
export interface MeshProfile {
  readonly name: string;
  readonly locked: boolean;
  readonly identity: PublicIdentity | null;
  getValue(key: string): Promise<unknown>;
  setValue(key: string, value: unknown): Promise<void>;
  ids(): Promise<string[]>;
  getBundle(id: string): Promise<Bundle>;
  putBundle(bundle: Bundle): Promise<string>;
}
import { BrowserRouter, type BrowserRoute } from "./router";
import type { Priority } from "./packet";

type Wire =
  | { type: "bundle"; bundle: Bundle }
  | { type: "inventory" | "request"; ids: string[] };
type Settings = { relay: boolean; lowPower: boolean; blocked: string[] };
const idValid = (id: unknown): id is string =>
  typeof id === "string" && /^[a-f0-9]{64}$/.test(id);

/** Browser storage/network service. Domain messaging/group authority and the shared UI are integrated separately. */
export class BrowserMesh {
  readonly router: BrowserRouter;
  #settings: Settings;
  #stopped = false;
  #closing?: Promise<void>;
  #settingsTail = Promise.resolve();
  #settingsSequence = 0;
  #revokedAt = 0;
  #syncing = false;
  #cursor = 0;
  #marks = new Map<string, number>();
  #routes = new Map<string, BrowserRoute>();
  #timer: ReturnType<typeof setInterval>;
  lastError = "";
  private constructor(
    readonly profile: MeshProfile,
    settings: Settings,
    private release: () => void,
  ) {
    this.#settings = settings;
    this.router = new BrowserRouter({
      relay: settings.relay,
      running: () => !this.#stopped && !profile.locked,
      validate: (payload) => this.validate(payload),
      receive: (payload, route) => this.receive(payload as Wire, route),
      maySend: async (payload) => {
        if (profile.locked || this.#stopped) return false;
        const value = payload as Wire;
        return (
          value.type !== "bundle" ||
          (!this.#settings.blocked.includes(value.bundle.manifest.author.id) &&
            !(
              value.bundle.manifest.author.id === profile.identity?.id &&
              value.bundle.manifest.keys.some((key) =>
                this.#settings.blocked.includes(key.reader),
              )
            ))
        );
      },
    });
    this.router.lowPower = settings.lowPower;
    this.#timer = setInterval(() => {
      void this.sync();
    }, 2200);
  }
  static async start(profile: MeshProfile): Promise<BrowserMesh> {
    if (profile.locked) throw new Error("Desbloqueia a identidade");
    return new Promise<BrowserMesh>((resolve, reject) => {
      void navigator.locks
        .request(
          "relayloom-mesh:" + profile.name,
          { ifAvailable: true },
          async (lock) => {
            if (!lock) {
              reject(
                new Error("Este perfil já tem rede activa noutro separador"),
              );
              return;
            }
            let release!: () => void;
            const held = new Promise<void>((done) => {
              release = done;
            });
            try {
              let settings = (await profile.getValue(
                "mesh-settings",
              )) as Settings | null;
              if (settings === null) {
                settings = { relay: false, lowPower: false, blocked: [] };
                await profile.setValue("mesh-settings", settings);
              }
              if (
                !exactShape(settings, ["relay", "lowPower", "blocked"]) ||
                typeof settings.relay !== "boolean" ||
                typeof settings.lowPower !== "boolean" ||
                !Array.isArray(settings.blocked) ||
                settings.blocked.length > 1024 ||
                settings.blocked.some((id) => !idValid(id))
              )
                throw new Error("Preferências de rede inválidas");
              resolve(new BrowserMesh(profile, settings, release));
              await held;
            } catch (error) {
              release();
              reject(error);
            }
          },
        )
        .catch(reject);
    });
  }
  get settings(): Settings {
    return structuredClone(this.#settings);
  }
  get routes(): Record<string, BrowserRoute> {
    return Object.fromEntries(
      [...this.#routes].map(([id, route]) => [id, structuredClone(route)]),
    );
  }
  private updateSettings(
    update: (previous: Settings) => Settings,
    sequence: number,
  ): Promise<void> {
    const run = this.#settingsTail.then(async () => {
      if (this.#stopped || this.profile.locked)
        throw new Error("Perfil bloqueado");
      const next = update(this.#settings);
      await this.profile.setValue("mesh-settings", next);
      if (this.#stopped || this.profile.locked)
        throw new Error("Perfil bloqueado durante a operação");
      // A later revocation is effective immediately, even while an earlier enable finishes persisting.
      this.#settings = {
        ...next,
        relay: next.relay && sequence >= this.#revokedAt,
      };
      this.router.relay = this.#settings.relay;
      this.router.lowPower = this.#settings.lowPower;
    });
    this.#settingsTail = run.catch(() => {});
    return run;
  }
  async setRelay(enabled: boolean): Promise<void> {
    if (typeof enabled !== "boolean" || this.#stopped || this.profile.locked)
      throw new Error("Preferência indisponível");
    const sequence = ++this.#settingsSequence;
    if (!enabled) {
      this.#revokedAt = sequence;
      this.router.relay = false;
      this.#settings.relay = false;
    }
    await this.updateSettings(
      (previous) => ({ ...previous, relay: enabled }),
      sequence,
    );
    if (enabled) await this.sync();
  }
  async setLowPower(enabled: boolean): Promise<void> {
    if (typeof enabled !== "boolean" || this.#stopped || this.profile.locked)
      throw new Error("Preferência indisponível");
    await this.updateSettings(
      (previous) => ({ ...previous, lowPower: enabled }),
      ++this.#settingsSequence,
    );
  }
  async setBlocked(id: string, enabled: boolean): Promise<void> {
    if (
      !idValid(id) ||
      typeof enabled !== "boolean" ||
      this.#stopped ||
      this.profile.locked
    )
      throw new Error("Bloqueio inválido");
    const next = [
      ...this.#settings.blocked.filter((value) => value !== id),
      ...(enabled ? [id] : []),
    ];
    if (next.length > 1024) throw new Error("Limite de bloqueios");
    if (enabled) {
      this.#settings.blocked = next;
      this.router.cancel((payload) => {
        const p = payload as Wire;
        return (
          p.type === "bundle" &&
          (p.bundle.manifest.author.id === id ||
            (p.bundle.manifest.author.id === this.profile.identity?.id &&
              p.bundle.manifest.keys.some((key) => key.reader === id)))
        );
      });
    }
    await this.updateSettings(
      (previous) => ({ ...previous, blocked: next }),
      ++this.#settingsSequence,
    );
  }
  private mark(key: string, gap: number): boolean {
    const now = Date.now(),
      old = this.#marks.get(key);
    if (old !== undefined && now - old < gap) return false;
    if (this.#marks.size >= 2048)
      this.#marks.delete(this.#marks.keys().next().value!);
    this.#marks.set(key, now);
    return true;
  }
  private async validate(value: unknown): Promise<void> {
    if (this.#stopped || this.profile.locked) throw new Error("Rede bloqueada");
    const wire = value as Wire;
    if (wire?.type === "bundle" && exactShape(wire, ["type", "bundle"])) {
      const bundle = await verifiedBundle(wire.bundle);
      if (bundle.manifest.kind.startsWith("group-"))
        throw new Error("Controlos de grupo ainda não ligados ao motor web");
      if (this.#settings.blocked.includes(bundle.manifest.author.id))
        throw new Error("Origem bloqueada");
      await inspectPublicSite(bundle);
    } else if (
      !wire ||
      !exactShape(wire, ["type", "ids"]) ||
      !["inventory", "request"].includes(wire.type) ||
      !Array.isArray((wire as any).ids) ||
      (wire as any).ids.length > 64 ||
      (wire as any).ids.some((id: unknown) => !idValid(id)) ||
      new Set((wire as any).ids).size !== (wire as any).ids.length
    )
      throw new Error("Inventário inválido");
  }
  private async receive(wire: Wire, route: BrowserRoute): Promise<void> {
    if (this.#stopped || this.profile.locked) throw new Error("Rede bloqueada");
    if (wire.type === "bundle") {
      await this.profile.putBundle(wire.bundle);
      this.#routes.set(wire.bundle.manifest.id, route);
      if (this.#routes.size > 1024)
        this.#routes.delete(this.#routes.keys().next().value!);
      return;
    }
    if (!this.#settings.relay) return;
    if (wire.type === "inventory") {
      const known = new Set(await this.profile.ids());
      const missing = wire.ids
        .filter((id) => !known.has(id))
        .slice(0, 8)
        .filter((id) => this.mark("request:" + id, 5000));
      if (missing.length)
        await this.router.broadcast(
          { type: "request", ids: missing },
          "normal",
          120_000,
          true,
        );
    } else {
      for (const id of wire.ids.slice(0, 8)) {
        if (!this.mark("serve:" + id, 1000)) continue;
        let bundle: Bundle;
        try {
          bundle = await this.profile.getBundle(id);
        } catch {
          continue;
        }
        if (this.#settings.blocked.includes(bundle.manifest.author.id))
          continue;
        await this.router.broadcast(
          { type: "bundle", bundle },
          bundle.manifest.kind === "alert" ? "sos" : "bulk",
          120_000,
          true,
        );
      }
    }
  }
  async request(id: string): Promise<void> {
    if (!idValid(id)) throw new Error("Endereço inválido");
    if (this.mark("explicit:" + id, 1500))
      await this.router.broadcast({ type: "request", ids: [id] });
  }
  /** Publish an already author-signed object after durable admission; this is not the product outbox API. */
  async announce(
    bundle: Bundle,
    priority: Priority = "normal",
  ): Promise<string> {
    if (this.#stopped || this.profile.locked) throw new Error("Rede bloqueada");
    const owned = await verifiedBundle(bundle);
    if (owned.manifest.author.id !== this.profile.identity?.id)
      throw new Error("A publicação tem de pertencer à identidade local");
    await this.validate({ type: "bundle", bundle: owned });
    await this.profile.putBundle(owned);
    return this.router.broadcast({ type: "bundle", bundle: owned }, priority);
  }
  async sync(): Promise<void> {
    if (
      this.#stopped ||
      this.profile.locked ||
      this.#syncing ||
      !this.#settings.relay ||
      !this.router.peers.some((p) => p.connected)
    )
      return;
    this.#syncing = true;
    try {
      const ids = (await this.profile.ids()).sort(),
        eligible: string[] = [];
      // Bounded verified reads per tick, including after reopening a profile with no in-memory cache.
      for (const id of ids.slice(this.#cursor, this.#cursor + 8)) {
        try {
          const bundle = await this.profile.getBundle(id);
          if (!this.#settings.blocked.includes(bundle.manifest.author.id))
            eligible.push(id);
        } catch {
          /* A corrupt/expired entry is never advertised. */
        }
      }
      this.#cursor = this.#cursor + 8 >= ids.length ? 0 : this.#cursor + 8;
      if (eligible.length)
        await this.router.broadcast(
          { type: "inventory", ids: eligible },
          "normal",
          120_000,
          true,
        );
      this.lastError = "";
    } catch {
      this.lastError =
        "Sincronização adiada; o estado será verificado na próxima tentativa.";
    } finally {
      this.#syncing = false;
    }
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#stopped = true;
    clearInterval(this.#timer);
    this.router.close();
    this.#marks.clear();
    this.#routes.clear();
    this.#closing = Promise.allSettled([
      this.#settingsTail,
      this.router.drain(),
    ]).then(() => this.release());
    return this.#closing;
  }
}
