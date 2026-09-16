import { t } from "../i18n/core";
import {
  BrowserMesh,
  type MeshProfile,
} from "../../../../packages/browser/src/mesh";
import type { PublicIdentity } from "../../../../packages/core/src/protocol";
import type { RtcTransportPeer } from "../../../../packages/browser/src/rtc";
import type { Packet } from "../../../../packages/browser/src/packet";
export async function browserAPI() {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
  let sequence = 0,
    context: { identity: PublicIdentity | null; generation: number } = {
      identity: null,
      generation: 0,
    },
    mesh: BrowserMesh | undefined,
    networkReady = Promise.resolve();
  let readyResolve!: (value: void) => void,
    readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      cleanup: () => void;
    }
  >();
  const offers = new Map<string, RtcTransportPeer<Packet>>();
  function remember(id: string, peer: RtcTransportPeer<Packet>) {
    // Keep only a bounded history for diagnostics; live links are bounded by the router.
    if (offers.size >= 24) {
      const old = [...offers].find(([, p]) => p.diagnostics.closed);
      if (old) offers.delete(old[0]);
      else throw new Error("Conclui ou cancela as ligações em curso");
    }
    offers.set(id, peer);
  }
  let error = "";
  const request = (
    domain: string,
    operation: string,
    body?: unknown,
    signal?: AbortSignal,
  ) => {
    if (signal?.aborted)
      return Promise.reject(
        new DOMException("Operação cancelada", "AbortError"),
      );
    if (pending.size >= 64)
      return Promise.reject(new Error("Há demasiadas operações em curso"));
    if (JSON.stringify(body ?? null).length > 8 * 1024 * 1024)
      return Promise.reject(new Error("Pedido demasiado grande"));
    const id = ++sequence;
    return new Promise<any>((resolve, reject) => {
      const abort = () => {
        const item = pending.get(id);
        if (item) {
          clearTimeout(item.timer);
          item.cleanup();
          pending.delete(id);
          reject(new DOMException("Operação cancelada", "AbortError"));
        }
      };
      const timer = setTimeout(() => {
        const item = pending.get(id);
        item?.cleanup();
        pending.delete(id);
        reject(
          new Error(
            "O motor demorou demasiado a responder. Verifica o estado antes de repetir.",
          ),
        );
      }, 20_000);
      const cleanup = () => signal?.removeEventListener("abort", abort);
      pending.set(id, { resolve, reject, timer, cleanup });
      signal?.addEventListener("abort", abort, { once: true });
      worker.postMessage({ type: "request", id, domain, operation, body });
    });
  };
  const profile: MeshProfile = {
    name: "relayloom-web-v1",
    get identity() {
      return context.identity;
    },
    get locked() {
      return !context.identity;
    },
    getValue: (key) => request("profile", "get-value", { key }),
    setValue: (key, value) => request("profile", "set-value", { key, value }),
    ids: () => request("profile", "ids"),
    getBundle: (id) => request("profile", "get-bundle", { id }),
    putBundle: (bundle) => request("profile", "put-bundle", { bundle }),
  };
  const publishState = () =>
    worker.postMessage({
      type: "network-state",
      generation: context.generation,
      value: {
        peers:
          mesh?.router.peers.map((p) => ({
            ...p,
            address:
              p.medium === "webrtc"
                ? t("Par de navegador")
                : t("Par WebSocket"),
          })) ?? [],
        counters: mesh?.router.counters ?? {},
        error: error || mesh?.lastError || "",
      },
    });
  async function command(operation: string, body: any = {}) {
    await networkReady;
    if (!mesh || !context.identity)
      throw new Error("Desbloqueia a identidade para ligar a rede");
    if (operation === "peer-status") {
      const peer = offers.get(body.handle);
      return peer ? peer.diagnostics : { unavailable: true };
    }
    if (operation === "relay") await mesh.setRelay(body.value);
    else if (operation === "low-power") await mesh.setLowPower(body.value);
    else if (operation === "block") await mesh.setBlocked(body.id, body.value);
    else if (operation === "request") await mesh.request(body.id);
    else if (operation === "peer-offer") {
      const entry = mesh.router.newPeer();
      try {
        remember(entry.id, entry.peer);
        return { handle: entry.id, signal: await entry.peer.offer() };
      } catch (e) {
        offers.delete(entry.id);
        mesh.router.disconnect(entry.id);
        throw e;
      }
    } else if (operation === "peer-answer") {
      const entry = mesh.router.newPeer();
      try {
        remember(entry.id, entry.peer);
        return {
          handle: entry.id,
          signal: await entry.peer.answer(body.signal),
        };
      } catch (e) {
        offers.delete(entry.id);
        mesh.router.disconnect(entry.id);
        throw e;
      }
    } else if (operation === "peer-accept") {
      const peer = offers.get(body.handle);
      if (!peer) throw new Error("Convite local indisponível");
      await peer.accept(body.signal);
      await peer.link!.ready();
      return { connected: true };
    } else if (operation === "peer-websocket") {
      const entry = mesh.router.connectWebSocket(body.invitation);
      try {
        await entry.peer.link.ready();
        return { handle: entry.id, connected: true };
      } catch (e) {
        mesh.router.disconnect(entry.id);
        throw e;
      }
    } else if (
      operation === "peer-close" ||
      operation === "peer-close-pending"
    ) {
      const peer = offers.get(body.handle);
      if (
        operation === "peer-close-pending" &&
        peer?.link?.channel.readyState === "open" &&
        !peer.link.closed
      )
        return { ok: true };

      offers.delete(body.handle);
      mesh.router.disconnect(body.handle);
    } else throw new Error("Operação de rede não disponível no navegador");
    publishState();
    return { ok: true };
  }
  worker.onmessage = async (event: MessageEvent) => {
    const m = event.data;
    if (m?.type === "ready") {
      readyResolve();
      return;
    }
    if (m?.type === "boot-error") {
      readyReject(new Error(m.error || "Não foi possível abrir o perfil"));
      return;
    }
    if (m?.type === "result") {
      const item = pending.get(m.id);
      if (item) {
        clearTimeout(item.timer);
        item.cleanup();
        pending.delete(m.id);
        m.error !== undefined
          ? item.reject(
              new Error(m.error || "Não foi possível concluir a operação"),
            )
          : item.resolve(m.value);
      }
      return;
    }
    if (m?.type === "context") {
      const old = mesh;
      mesh = undefined;
      offers.clear();
      context = { identity: m.identity, generation: m.generation };
      const current = context;
      networkReady = (async () => {
        await old?.close();
        if (context !== current || !current.identity) return;
        const next = await BrowserMesh.start(profile);
        if (context !== current) {
          await next.close();
          return;
        }
        mesh = next;
        error = "";
        publishState();
      })();
      void networkReady.catch((e) => {
        error = (e as Error).message;
        publishState();
      });
      return;
    }
    if (m?.type === "network-command") {
      try {
        if (m.generation !== context.generation)
          throw new Error("Sessão alterada");
        const value = await command(m.operation, m.body);
        worker.postMessage({ type: "network-result", id: m.id, value });
      } catch (e) {
        worker.postMessage({
          type: "network-result",
          id: m.id,
          error: (e as Error).message,
        });
      }
      return;
    }
    if (m?.type === "publish") {
      try {
        await networkReady;
        if (
          !mesh ||
          !context.identity ||
          m.generation !== context.generation ||
          m.owner !== context.identity.id
        )
          return;
        await mesh.router.broadcast(
          { type: "bundle", bundle: m.bundle },
          m.priority,
        );
        publishState();
      } catch (e) {
        error = (e as Error).message;
        publishState();
      }
    }
  };
  worker.onerror = () => {
    readyReject(new Error("O motor do navegador não iniciou"));
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.cleanup();
      p.reject(new Error("O motor do navegador parou"));
    }
    pending.clear();
    void mesh?.close();
  };
  const ticker = setInterval(publishState, 750);
  addEventListener(
    "pagehide",
    () => {
      const root = document.getElementById("root");
      if (root) {
        root.replaceChildren();
        const message = document.createElement("p");
        message.textContent = t("O teu espaço está bloqueado.");
        root.append(message);
      }
      clearInterval(ticker);
      void mesh?.close();
      worker.terminate();
    },
    { once: true },
  );
  try {
    await ready;
  } catch (e) {
    clearInterval(ticker);
    worker.terminate();
    throw e;
  }
  return async (path: string, body?: unknown, signal?: AbortSignal) => {
    if (path.startsWith("peer-")) return command(path, body);
    if (path === "lock") {
      context = { identity: null, generation: context.generation };
      const old = mesh;
      mesh = undefined;
      offers.clear();
      void old?.close();
      publishState();
    }
    return request("api", path, body, signal);
  };
}
