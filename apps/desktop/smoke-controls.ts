import { BrowserWindow, session, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const probeTimeout = 5000;

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("O controlo de rede do renderer expirou.")),
          probeTimeout + 2000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// This fixture is reached only by the development smoke path. It never changes
// the real window's CSP, request filter, sandbox or web security preferences.
export async function checkExternalRequestBlocking(protectedView: WebContents) {
  const challenge = randomUUID();
  const requests = { main: 0, control: 0, protected: 0 };
  const fixture = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "GET" && request.url === "/control") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end("<!doctype html><title>RelayLoom smoke control</title>");
      return;
    }
    const phase = request.url?.slice("/probe/".length);
    if (
      request.method === "GET" &&
      request.url?.startsWith("/probe/") &&
      (phase === "main" || phase === "control" || phase === "protected")
    ) {
      requests[phase] += 1;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      // A request that reaches the fixture must be readable cross-origin too:
      // CORS rejection must not masquerade as the app's network restriction.
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.end(challenge);
      return;
    }
    response.writeHead(404).end();
  });
  let control: BrowserWindow | undefined;
  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      fixture.once("error", rejectListen);
      fixture.listen(0, "127.0.0.1", () => {
        fixture.off("error", rejectListen);
        resolveListen();
      });
    });
    const address = fixture.address();
    if (!address || typeof address === "string")
      throw new Error("O servidor de controlo de rede não iniciou.");
    const origin = "http://127.0.0.1:" + address.port;
    const mainResponse = await fetch(origin + "/probe/main", {
      cache: "no-store",
      signal: AbortSignal.timeout(probeTimeout),
    });
    if (
      !mainResponse.ok ||
      (await mainResponse.text()) !== challenge ||
      requests.main !== 1
    )
      throw new Error("O controlo de rede do processo principal falhou.");

    // A separate fresh renderer deliberately has no application CSP/filter.
    // Its normal Chromium security settings remain enabled.
    control = new BrowserWindow({
      show: false,
      webPreferences: {
        session: session.fromPartition("relayloom-smoke-" + randomUUID(), {
          cache: false,
        }),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        devTools: false,
      },
    });
    control.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    await bounded(control.loadURL(origin + "/control"));
    const fetchScript = (phase: "control" | "protected") => `
      fetch(${JSON.stringify(origin + "/probe/" + phase)}, {
        cache: "no-store", credentials: "omit",
        signal: AbortSignal.timeout(${probeTimeout})
      }).then(async response => response.ok &&
        await response.text() === ${JSON.stringify(challenge)} ? "reachable" : "invalid",
        error => error.name === "TimeoutError" || error.name === "AbortError" ? "timeout" : "rejected")
    `;
    const controlResult = await bounded(
      control.webContents.executeJavaScript(fetchScript("control")),
    );
    if (controlResult !== "reachable" || requests.control !== 1)
      throw new Error("O controlo de rede do renderer não foi alcançado.");
    const protectedResult = await bounded(
      protectedView.executeJavaScript(fetchScript("protected")),
    );
    if (protectedResult !== "rejected" || requests.protected !== 0)
      throw new Error("O bloqueio de pedidos externos falhou.");
    return {
      mainProcessReachable: true,
      controlRendererReachable: true,
      protectedRendererRejected: true,
      controlRendererSandboxRequested: true,
      controlRendererWebSecurity: true,
      requests: { ...requests },
    };
  } finally {
    if (control && !control.isDestroyed()) control.destroy();
    await new Promise<void>((resolveClose) => {
      fixture.close(() => resolveClose());
      fixture.closeAllConnections();
    });
  }
}
