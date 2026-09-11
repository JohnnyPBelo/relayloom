import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  session,
  utilityProcess,
  type UtilityProcess,
} from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { checkExternalRequestBlocking } from "./smoke-controls.js";
import {
  allowMicrophone,
  allowNavigation,
  allowRequest,
  childEnvironment,
  downloadFilename,
  parseDaemonReady,
  rejectUnsafeRuntime,
  type DaemonReady,
} from "./policy.js";

rejectUnsafeRuntime(process.argv, process.env);
app.enableSandbox();
app.setName("RelayLoom");
const repository = resolve(__dirname, "../../..");
const smoke = process.argv.includes("--relayloom-smoke") && !app.isPackaged;
const profile = app.isPackaged
  ? app.getPath("userData")
  : join(
      repository,
      ".runtime",
      "desktop",
      smoke ? "smoke-" + randomUUID() : "profile",
    );
const transient = app.isPackaged
  ? join(profile, "runtime")
  : join(repository, ".cache", "desktop");
for (const path of [
  profile,
  transient,
  join(transient, "session"),
  join(transient, "tmp"),
  join(transient, "logs"),
  join(transient, "crashes"),
])
  mkdirSync(path, { recursive: true, mode: 0o700 });
app.setPath("userData", profile);
app.setPath("sessionData", join(transient, "session"));
app.setPath("temp", join(transient, "tmp"));
app.setPath("logs", join(transient, "logs"));
app.setPath("crashDumps", join(transient, "crashes"));

let window: BrowserWindow | undefined,
  child: UtilityProcess | undefined,
  quitting = false,
  shutdown: Promise<void> | undefined;
let childExit: (() => void) | undefined,
  childReady = false,
  startupReject: ((reason: Error) => void) | undefined;
let bootstrap: DaemonReady | undefined;

async function stopDaemon(): Promise<void> {
  if (shutdown) return shutdown;
  const running = child;
  if (!running) return;
  shutdown = new Promise((resolveStop) => {
    const timer = setTimeout(() => {
      running.kill();
    }, 5000);
    const finalTimer = setTimeout(() => {
      clearTimeout(timer);
      resolveStop();
    }, 7000);
    childExit = () => {
      clearTimeout(timer);
      clearTimeout(finalTimer);
      resolveStop();
    };
    try {
      running.postMessage("relayloom:shutdown");
    } catch {
      running.kill();
    }
  });
  return shutdown;
}

async function fail(message: string): Promise<void> {
  if (quitting) return;
  quitting = true;
  await stopDaemon();
  const safe = message.replace(/[a-f0-9]{64}/gi, "[redigido]").slice(0, 2000);
  if (smoke)
    console.error(JSON.stringify({ desktopSmoke: "failed", error: safe }));
  else dialog.showErrorBox("RelayLoom não conseguiu iniciar", safe);
  app.exit(1);
}

function startDaemon(): Promise<DaemonReady> {
  const daemonRoot = app.isPackaged
    ? join(process.resourcesPath, "daemon")
    : resolve(app.getAppPath(), "../daemon");
  const data = join(profile, "data");
  mkdirSync(data, { recursive: true, mode: 0o700 });
  return new Promise((resolveReady, rejectReady) => {
    startupReject = rejectReady;
    let stdout = "",
      stderr = "";
    const timer = setTimeout(
      () => rejectReady(new Error("O nó local não iniciou em 20 segundos.")),
      20_000,
    );
    child = utilityProcess.fork(
      join(daemonRoot, "cli.mjs"),
      [
        "--data",
        data,
        "--http-port",
        "0",
        "--tcp-port",
        "0",
        "--tcp-host",
        "127.0.0.1",
      ],
      {
        cwd: daemonRoot,
        env: childEnvironment(process.env),
        stdio: "pipe",
        serviceName: "RelayLoom local node",
      },
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      if (childReady) return;
      stdout += chunk.toString("utf8");
      if (stdout.length > 4096) {
        clearTimeout(timer);
        rejectReady(new Error("Resposta de arranque inválida."));
        return;
      }
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      try {
        const ready = parseDaemonReady(stdout.slice(0, newline), data);
        childReady = true;
        startupReject = undefined;
        clearTimeout(timer);
        stdout = "";
        resolveReady(ready);
      } catch {
        clearTimeout(timer);
        rejectReady(new Error("O nó local não devolveu uma sessão válida."));
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-8192);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      child = undefined;
      childExit?.();
      if (!childReady)
        startupReject?.(
          new Error(
            "O nó local terminou durante o arranque: " + stderr.slice(-1200),
          ),
        );
      else if (!quitting)
        void fail(
          "O nó local terminou inesperadamente (código " +
            code +
            "). Reinicia a aplicação.",
        );
    });
  });
}

function createWindow(ready: DaemonReady): BrowserWindow {
  const isolated = session.fromPartition("relayloom-" + randomUUID(), {
    cache: false,
  });
  let microphoneGranted = false,
    microphonePrompt = false;
  isolated.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      if (
        permission === "clipboard-sanitized-write" &&
        contents === view.webContents &&
        details.isMainFrame &&
        allowNavigation(details.requestingUrl, ready.origin)
      ) {
        void contents
          .executeJavaScript("navigator.userActivation.isActive")
          .then(
            (active) => callback(active === true),
            () => callback(false),
          );
        return;
      }
      const types = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
      if (
        contents !== view.webContents ||
        !allowMicrophone(
          permission,
          details.requestingUrl,
          ready.origin,
          details.isMainFrame,
          types,
        ) ||
        microphonePrompt
      ) {
        callback(false);
        return;
      }
      if (microphoneGranted) {
        callback(true);
        return;
      }
      microphonePrompt = true;
      void contents
        .executeJavaScript("navigator.userActivation.isActive")
        .then(async (active) => {
          if (!active || view.isDestroyed()) return false;
          const answer = await dialog.showMessageBox(view, {
            type: "question",
            title: "Gravar mensagem de voz",
            message: "Permitir o microfone nesta sessão do RelayLoom?",
            detail:
              "A gravação começa através do botão da conversa. A câmara e a captura do ecrã continuam bloqueadas.",
            buttons: ["Não permitir", "Permitir microfone"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          return answer.response === 1;
        })
        .then(
          (granted) => {
            microphoneGranted = granted;
            callback(granted);
          },
          () => callback(false),
        )
        .finally(() => {
          microphonePrompt = false;
        });
    },
  );
  isolated.setPermissionCheckHandler(
    (contents, permission, requestingOrigin, details) =>
      microphoneGranted &&
      contents === view.webContents &&
      requestingOrigin === ready.origin &&
      allowMicrophone(
        permission,
        details.requestingUrl ?? "",
        ready.origin,
        details.isMainFrame,
        [details.mediaType ?? "unknown"],
      ),
  );
  isolated.setDevicePermissionHandler(() => false);
  isolated.on("will-download", (event, item, contents) => {
    let localBlob = false;
    try {
      const url = new URL(item.getURL());
      localBlob = url.protocol === "blob:" && url.origin === ready.origin;
    } catch {
      /* Reject malformed download URLs. */
    }
    if (contents !== view.webContents || !localBlob) {
      event.preventDefault();
      return;
    }
    const exports = join(profile, "exports");
    mkdirSync(exports, { recursive: true, mode: 0o700 });
    item.setSaveDialogOptions({
      title: "Guardar ficheiro do RelayLoom",
      defaultPath: join(exports, downloadFilename(item.getFilename())),
    });
  });
  isolated.webRequest.onBeforeRequest((details, callback) =>
    callback({
      cancel: !allowRequest(details.url, ready.origin, details.resourceType),
    }),
  );
  const view = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 720,
    minHeight: 600,
    show: false,
    title: "RelayLoom",
    backgroundColor: "#f7f7f2",
    autoHideMenuBar: true,
    webPreferences: {
      session: isolated,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools: false,
    },
  });
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.on("will-attach-webview", (event) => event.preventDefault());
  view.webContents.on("will-navigate", (event, url) => {
    if (!allowNavigation(url, ready.origin)) event.preventDefault();
  });
  view.webContents.on("will-frame-navigate", (event) => {
    if (!event.isMainFrame || !allowNavigation(event.url, ready.origin))
      event.preventDefault();
  });
  view.webContents.on("will-redirect", (event, url) => {
    if (!allowNavigation(url, ready.origin)) event.preventDefault();
  });
  view.webContents.on("render-process-gone", (_event, details) => {
    if (!quitting)
      void fail(
        "A interface local terminou (" +
          details.reason +
          "). Reinicia a aplicação.",
      );
  });
  view.once("ready-to-show", () => {
    if (!smoke) view.show();
  });
  view.on("closed", () => {
    window = undefined;
  });
  void view
    .loadURL(ready.url)
    .catch(() => fail("Não foi possível abrir a interface do nó local."));
  return view;
}

async function smokeCheck(view: BrowserWindow, ready: DaemonReady) {
  await new Promise<void>((resolveLoad, rejectLoad) => {
    if (!view.webContents.isLoading()) {
      resolveLoad();
      return;
    }
    view.webContents.once("did-finish-load", () => resolveLoad());
    view.webContents.once("did-fail-load", () =>
      rejectLoad(new Error("A interface não carregou.")),
    );
  });
  const deadline = Date.now() + 15_000;
  let renderer: { require: string; process: string; text: string } | undefined;
  while (Date.now() < deadline) {
    renderer = await view.webContents.executeJavaScript(
      `({ require: typeof window.require, process: typeof window.process, text: document.body.innerText })`,
    );
    if (renderer?.text.includes("Criar identidade")) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (
    !renderer?.text.includes("Criar identidade") ||
    renderer.require !== "undefined" ||
    renderer.process !== "undefined"
  )
    throw new Error("A interface real ou o isolamento do renderer falhou.");
  const unauthorized = await fetch(ready.origin + "/api/state");
  const response = await fetch(ready.origin + "/api/state", {
    headers: { Authorization: "Bearer " + ready.token },
  });
  const state = await response.json();
  if (
    unauthorized.status !== 401 ||
    !response.ok ||
    state.initialized !== false ||
    state.tcpPort !== ready.tcpPort
  )
    throw new Error("A autenticação ou o nó TCP local falhou.");
  const externalRequestControl = await checkExternalRequestBlocking(
    view.webContents,
  );
  const processMetrics = app
    .getAppMetrics()
    .find((metric) => metric.pid === view.webContents.getOSProcessId());
  if (processMetrics?.sandboxed === false)
    throw new Error("O processo da interface não tem sandbox.");
  const evidence = join(repository, ".cache", "desktop");
  writeFileSync(
    join(evidence, "smoke.png"),
    (await view.webContents.capturePage()).toPNG(),
  );
  const report = {
    result: "pass",
    at: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    rendererSandboxRequested: true,
    rendererSandboxReported: processMetrics?.sandboxed ?? "unavailable",
    rendererNodeAccess: false,
    isolatedSession: true,
    unauthorizedApiStatus: unauthorized.status,
    authorizedApiStatus: response.status,
    externalRequestBlocked: true,
    externalRequestControl,
    daemonSeparateProcess: child?.pid !== process.pid,
    tcpListener: "127.0.0.1",
    physicalRadio: "not tested",
    screenshot: ".cache/desktop/smoke.png",
  };
  quitting = true;
  await stopDaemon();
  writeFileSync(
    join(evidence, "smoke.json"),
    JSON.stringify(
      { ...report, result: child ? "failed" : "pass", daemonStopped: !child },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      desktopSmoke: child ? "failed" : "pass",
      report: ".cache/desktop/smoke.json",
      screenshot: ".cache/desktop/smoke.png",
    }),
  );
  app.exit(child ? 1 : 0);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  process.on("SIGTERM", () => app.quit());
  process.on("SIGINT", () => app.quit());
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void stopDaemon().then(() => app.quit());
  });
  app
    .whenReady()
    .then(async () => {
      Menu.setApplicationMenu(null);
      bootstrap = await startDaemon();
      window = createWindow(bootstrap);
      if (smoke) await smokeCheck(window, bootstrap);
    })
    .catch((error) =>
      fail(
        error instanceof Error
          ? error.message
          : "Falha inesperada no arranque.",
      ),
    );
}
