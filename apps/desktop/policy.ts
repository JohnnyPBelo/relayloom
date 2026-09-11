export interface DaemonReady {
  origin: string;
  url: string;
  token: string;
  tcpPort: number;
  data: string;
}

/** Only the child launched by this shell supplies the bootstrap capability. */
export function parseDaemonReady(
  line: string,
  expectedData: string,
): DaemonReady {
  if (line.length > 4096)
    throw new Error("Resposta de arranque demasiado grande");
  const value = JSON.parse(line);
  if (
    !value ||
    value.ready !== true ||
    typeof value.url !== "string" ||
    value.data !== expectedData ||
    !Number.isInteger(value.tcpPort) ||
    value.tcpPort < 1 ||
    value.tcpPort > 65535
  )
    throw new Error("Resposta de arranque inválida");
  const url = new URL(value.url),
    fragment = new URLSearchParams(url.hash.slice(1)),
    token = fragment.get("token");
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    Number(url.port) < 1 ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    fragment.size !== 1 ||
    !token ||
    !/^[a-f0-9]{64}$/.test(token)
  )
    throw new Error("Endereço de arranque inválido");
  return {
    origin: url.origin,
    url: url.href,
    token,
    tcpPort: value.tcpPort,
    data: value.data,
  };
}

export function allowNavigation(raw: string, origin: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "http:" &&
      url.origin === origin &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search
    );
  } catch {
    return false;
  }
}

export function allowRequest(
  raw: string,
  origin: string,
  resourceType: string,
): boolean {
  if (resourceType === "subFrame" || resourceType === "webSocket") return false;
  try {
    const url = new URL(raw);
    if (url.username || url.password) return false;
    if (url.protocol === "http:") return url.origin === origin;
    if (url.protocol === "blob:")
      return url.origin === origin && ["image", "media"].includes(resourceType);
    return (
      url.protocol === "data:" && ["image", "media"].includes(resourceType)
    );
  } catch {
    return false;
  }
}

export function rejectUnsafeRuntime(
  argv: string[],
  environment: NodeJS.ProcessEnv,
): void {
  if (
    argv.some((arg) =>
      /^(--no-sandbox|--disable-setuid-sandbox|--disable-web-security|--remote-debugging-port|--remote-debugging-pipe|--inspect|--inspect-brk|--inspect-port|--inspect-publish-uid)(=|$)/.test(
        arg,
      ),
    ) ||
    environment.ELECTRON_DISABLE_SANDBOX
  )
    throw new Error(
      "Esta aplicação requer o sandbox e não aceita depuração remota",
    );
}

export function childEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result = { ...environment };
  for (const name of [
    "NODE_OPTIONS",
    "NODE_PATH",
    "ELECTRON_RUN_AS_NODE",
    "ELECTRON_ENABLE_LOGGING",
    "ELECTRON_DISABLE_SANDBOX",
  ])
    delete result[name];
  return result;
}

export function allowMicrophone(
  permission: string,
  requestingUrl: string,
  origin: string,
  mainFrame: boolean,
  mediaTypes: readonly string[],
): boolean {
  return (
    permission === "media" &&
    mainFrame &&
    allowNavigation(requestingUrl, origin) &&
    mediaTypes.length === 1 &&
    mediaTypes[0] === "audio"
  );
}

export function downloadFilename(name: string): string {
  const safe = name
    .replaceAll("\\", "/")
    .split("/")
    .pop()!
    .replace(/[\x00-\x1f\x7f<>:"|?*]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 150);
  return !safe || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(safe)
    ? "relayloom-export"
    : safe;
}
