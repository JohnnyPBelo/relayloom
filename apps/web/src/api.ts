export type API = (
  path: string,
  body?: unknown,
  signal?: AbortSignal,
) => Promise<any>;
let localAPI: API | undefined;
let initialised = false;
export function useLocalAPI(api: API) {
  if (initialised || localAPI) throw new Error("Motor já configurado");
  localAPI = api;
}
function initialiseNative() {
  if (initialised) return;
  initialised = true;
  takeLaunchToken();
  window.addEventListener("hashchange", takeLaunchToken);
}
function takeLaunchToken() {
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  if (token) {
    sessionStorage.setItem("relayloom-token", token);
    history.replaceState(null, "", location.pathname);
  }
}

export async function api(path: string, body?: unknown, signal?: AbortSignal) {
  if (localAPI) return localAPI(path, body, signal);
  initialiseNative();
  const controller = new AbortController();
  let timedOut = false;
  const cancelled = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", cancelled, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 20_000);
  try {
    const res = await fetch("/api/" + path, {
      signal: controller.signal,
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization:
          "Bearer " + (sessionStorage.getItem("relayloom-token") ?? ""),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await res.json();
    if (!res.ok) throw new Error(value.error ?? "Não foi possível concluir");
    return value;
  } catch (error) {
    if (timedOut)
      throw new Error("O nó demorou demasiado a responder. Tenta novamente.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancelled);
  }
}
