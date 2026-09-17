/// <reference lib="webworker" />
import { BrowserProfile } from "../../../../packages/browser/src/profile";
import { BrowserApplication } from "../../../../packages/browser/src/application";
const worker = self as unknown as DedicatedWorkerGlobalScope;
const profileName = "relayloom-web-v1";
let app: BrowserApplication | undefined;
let generation = 0,
  identityId: string | null = null,
  network = {
    peers: [] as any[],
    counters: {} as Record<string, number>,
    error: "",
  };
let next = 0;
const waiting = new Map<
  number,
  {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function networkCommand(operation: string, body?: unknown): Promise<any> {
  if (waiting.size >= 32)
    return Promise.reject(new Error("Demasiadas operações de rede"));
  const id = ++next;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error("A operação de rede demorou demasiado"));
    }, 20_000);
    waiting.set(id, { resolve, reject, timer });
    worker.postMessage({
      type: "network-command",
      id,
      operation,
      body,
      generation,
    });
  });
}
function reply(id: number, value?: any, error?: unknown) {
  if (error)
    worker.postMessage({
      type: "result",
      id,
      error:
        error instanceof Error && error.message
          ? error.message
          : "Não foi possível verificar ou concluir esta operação",
    });
  else worker.postMessage({ type: "result", id, value });
}
worker.onmessage = async (event: MessageEvent) => {
  const m = event.data;
  if (m?.type === "network-result") {
    const entry = waiting.get(m.id);
    if (entry) {
      clearTimeout(entry.timer);
      waiting.delete(m.id);
      m.error !== undefined
        ? entry.reject(new Error(m.error || "A operação de rede falhou"))
        : entry.resolve(m.value);
    }
    return;
  }
  if (m?.type === "network-state") {
    if (m.generation === generation) network = m.value;
    return;
  }
  if (m?.type !== "request" || !Number.isSafeInteger(m.id) || !app) return;
  try {
    if (JSON.stringify(m.body ?? null).length > 8 * 1024 * 1024)
      throw new Error("Pedido demasiado grande");
    let value: any;
    if (m.domain === "api") value = await app.call(m.operation, m.body);
    else if (m.domain === "profile") {
      if (m.operation === "get-value" && m.body.key === "mesh-settings")
        value = await app.profile.getValue("mesh-settings");
      else if (m.operation === "set-value" && m.body.key === "mesh-settings")
        value = await app.profile.setValue("mesh-settings", m.body.value);
      else if (m.operation === "ids") value = await app.profile.ids();
      else if (m.operation === "get-bundle")
        value = await app.profile.getBundle(m.body.id);
      else if (m.operation === "put-bundle")
        value = await app.ingest(m.body.bundle);
      else throw new Error("Operação de transporte inválida");
    } else throw new Error("Operação inválida");
    reply(m.id, value);
  } catch (error) {
    reply(m.id, undefined, error);
  }
};
void (async () => {
  if (!navigator.locks) {
    worker.postMessage({
      type: "boot-error",
      error: "Este navegador não permite proteger o perfil entre separadores.",
    });
    return;
  }
  // Reload may start this worker before the previous worker's termination has
  // released its lock. Queue briefly; never break or take over a live lease.
  const acquisition = new AbortController();
  const deadline = setTimeout(() => acquisition.abort(), 2000);
  try {
    await navigator.locks.request(
      "relayloom-application:" + profileName,
      { signal: acquisition.signal },
      async (lease) => {
        clearTimeout(deadline);
        if (!lease) {
          worker.postMessage({
            type: "boot-error",
            error:
              "Este perfil já está aberto noutro separador. Continua nesse separador ou fecha-o primeiro.",
          });
          return;
        }
        try {
          const profile = await BrowserProfile.connect(profileName);
          app = new BrowserApplication(profile, {
            publish: (bundle, priority) =>
              worker.postMessage({
                type: "publish",
                bundle,
                priority,
                generation,
                owner: identityId,
              }),
            command: networkCommand,
            state: () => network,
            context: (identity, g) => {
              generation = g;
              identityId = identity?.id ?? null;
              network = { peers: [], counters: {}, error: "" };
              worker.postMessage({ type: "context", identity, generation });
            },
          });
          worker.postMessage({ type: "ready", state: await app.state() });
          // The browser terminates this owned worker and releases the lease on page teardown.
          await new Promise(() => {});
        } catch (error) {
          worker.postMessage({
            type: "boot-error",
            error:
              error instanceof Error && error.message
                ? error.message
                : "Não foi possível abrir o perfil",
          });
        }
      },
    );
  } catch (error) {
    worker.postMessage({
      type: "boot-error",
      error: acquisition.signal.aborted
        ? "Este perfil já está aberto noutro separador. Continua nesse separador ou fecha-o primeiro."
        : error instanceof Error && error.message
          ? error.message
          : "Não foi possível abrir o perfil",
    });
  } finally {
    clearTimeout(deadline);
  }
})();
