// One engine at a time; the complete browser suite is unchanged across engines.
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  statfsSync,
  readdirSync,
  statSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { resolve, relative, dirname, join } from "node:path";
import { createHash } from "node:crypto";

const engine = process.argv[2];
if (!["chromium", "firefox", "webkit"].includes(engine))
  throw new Error(
    "Usage: node scripts/verify-browser-matrix.mjs chromium|firefox|webkit",
  );
const root = process.cwd(),
  output = resolve(`.cache/browser-matrix/${engine}`),
  temp = resolve(".cache/tmp");
mkdirSync(output, { recursive: true });
mkdirSync(temp, { recursive: true });
for (const name of ["TMPDIR", "TMP", "TEMP"]) process.env[name] = temp;
process.env.XDG_CACHE_HOME = resolve(".cache/browser-matrix/runtime-cache");
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(".cache/playwright");
const { chromium, firefox, webkit } = await import("playwright");
const environment = {
  ...process.env,
  TMPDIR: temp,
  TMP: temp,
  TEMP: temp,
  RELAYLOOM_MATRIX_ENGINE: engine,
};
delete environment.RELAYLOOM_BROWSER_CHANNEL;
function sources() {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(
      (p) =>
        /^(apps|packages|tests|scripts|native|adapters)\//.test(p) ||
        /^(package.*\.json|.*config\.ts)$/.test(p),
    );
  return Object.fromEntries(
    [...new Set(files)]
      .sort()
      .map((p) => [
        p,
        createHash("sha256").update(readFileSync(p)).digest("hex"),
      ]),
  );
}
const before = sources(),
  started = Date.now();
const report = {
  started: new Date().toISOString(),
  baseCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  platform: process.platform,
  engine,
  status: "RUNNING",
  applicationCrypto: {
    curves: "@noble/curves 2.4.0 Ed25519/X25519",
    symmetricAndHash: "Web Crypto AES-GCM/HKDF/SHA-256",
    nativeCurveProbe:
      "Capability snapshot only; intermittent native WebKit curve failures reproduced separately",
  },
  scope:
    "One actual browser engine on this host, full autonomous browser suite. No claim of Safari, mobile device, radio, native application parity or independent review.",
  sources: before,
  checks: [],
};
const save = () =>
  writeFileSync(
    join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
save();
const disk = statfsSync(root);
if (disk.bavail * disk.bsize < 15 * 1024 ** 3)
  throw new Error("15 GiB reserve required");
async function check(name, args) {
  writeFileSync(join(output, name + ".log"), "");
  const begin = Date.now(),
    child = spawn(process.execPath, args, {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
  report.current = {
    name,
    pid: child.pid,
    startedAt: new Date().toISOString(),
  };
  save();
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (b) => appendFileSync(join(output, name + ".log"), b));
  const code = await new Promise((accept, reject) => {
    child.once("error", reject);
    child.once("close", accept);
  });
  delete report.current;
  report.checks.push({
    name,
    command: ["node", ...args].join(" "),
    exit: code,
    elapsedMs: Date.now() - begin,
  });
  save();
  if (code !== 0) throw new Error(name + " failed; see its log");
}
try {
  await check("typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"]);
  await check("web-build", ["node_modules/vite/bin/vite.js", "build"]);
  await check("native-build", ["scripts/native-build.mjs"]);
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(
      "<!doctype html><title>RelayLoom browser capability probe</title>",
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let browser;
  try {
    browser = await { chromium, firefox, webkit }[engine].launch({
      headless: true,
      ...(engine === "chromium" ? { chromiumSandbox: true } : {}),
      env: environment,
      timeout: 15000,
    });
    const context = await browser.newContext(),
      page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    report.runtime = {
      browserType: browser.browserType().name(),
      version: browser.version(),
      capabilities: await page.evaluate(async () => {
        const algorithms = {};
        for (const algorithm of ["Ed25519", "X25519"]) {
          try {
            await crypto.subtle.generateKey(
              algorithm,
              false,
              algorithm === "Ed25519" ? ["sign", "verify"] : ["deriveBits"],
            );
            algorithms[algorithm] = "available";
          } catch (e) {
            algorithms[algorithm] = e.name + ": " + e.message;
          }
        }
        return {
          userAgent: navigator.userAgent,
          secureContext: isSecureContext,
          indexedDB: !!globalThis.indexedDB,
          locks: !!navigator.locks,
          worker: !!globalThis.Worker,
          serviceWorker: !!navigator.serviceWorker,
          webRTC: !!globalThis.RTCPeerConnection,
          webSocket: !!globalThis.WebSocket,
          algorithms,
        };
      }),
    };
    save();
  } finally {
    await browser?.close();
    await new Promise((r) => server.close(r));
  }
  // Missing capabilities do not turn failing product tests into skips.
  await check("browser-all", [
    "scripts/e2e.mjs",
    "--config",
    "tests/browser/matrix.config.ts",
  ]);
  report.status = "PASSED";
} catch (error) {
  report.status = "FAILED";
  report.error = error.message;
  process.exitCode = 1;
} finally {
  report.sourcesUnchanged =
    JSON.stringify(sources()) === JSON.stringify(before);
  if (!report.sourcesUnchanged) {
    report.status = "FAILED";
    report.error = "Sources changed during engine gate";
    process.exitCode = 1;
  }
  // Keep only evidence actually generated in this run; old reports are not
  // relabelled when an engine cannot reach their corresponding test.
  for (const folder of [
    "browser-foundation",
    "browser-routing",
    "browser-native",
    "browser-application/ui",
    "browser-groups",
  ]) {
    const directory = resolve(".cache", folder);
    const visit = (dir) => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "final") visit(path);
          continue;
        }
        if (
          !/\.(json|png)$/.test(path) ||
          entry.name === "playwright.json" ||
          statSync(path).mtimeMs < started
        )
          continue;
        const target = join(
          output,
          "evidence",
          folder,
          relative(directory, path),
        );
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(path, target);
      }
    };
    visit(directory);
  }
  report.finished = new Date().toISOString();
  save();
  console.log(
    `${engine}: ${report.status}. Report: ${relative(root, join(output, "report.json"))}`,
  );
}
