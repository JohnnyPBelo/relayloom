import { spawn, execFileSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  appendFileSync,
  statfsSync,
  cpSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { webSources, webArtifacts } from "./web-artifact.mjs";

const output = resolve(".cache/public-web/gate"),
  temp = resolve(".cache/tmp");
mkdirSync(output, { recursive: true });
mkdirSync(temp, { recursive: true });
const report = {
  status: "RUNNING",
  started: new Date().toISOString(),
  baseCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  sources: webSources(),
  checks: [],
  scope:
    "Build/default UI + public subpath UI Chromium/Firefox/WebKit on Linux; separate Chromium/Firefox processes. No physical-device or complete-product claim.",
};
const save = () =>
  writeFileSync(
    join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
async function check(name, args, extra = {}) {
  const disk = statfsSync(".");
  if (disk.bavail * disk.bsize < 15 * 1024 ** 3)
    throw new Error("15 GiB free reserve required");
  const log = join(output, name + ".log");
  writeFileSync(log, "");
  const started = Date.now();
  const child = spawn(process.execPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      TMPDIR: temp,
      TMP: temp,
      TEMP: temp,
      PLAYWRIGHT_BROWSERS_PATH: resolve(".cache/playwright"),
      XDG_CACHE_HOME: resolve(".cache/public-web/runtime"),
      RELAYLOOM_LAUNCH_URL: "", // This gate must exercise the local candidate.
      ...extra,
    },
  });
  report.current = { name, pid: child.pid, args };
  save();
  for (const pipe of [child.stdout, child.stderr])
    pipe.on("data", (data) => appendFileSync(log, data));
  const exitCode = await new Promise((done, fail) => {
    child.on("error", fail);
    child.on("exit", done);
  });
  report.checks.push({
    name,
    command: [process.execPath, ...args],
    exitCode,
    durationMs: Date.now() - started,
  });
  delete report.current;
  save();
  console.log(name + ": " + exitCode);
  if (exitCode !== 0) throw new Error("Failed check: " + name);
}
save();
try {
  await check("typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"]);
  await check("conversation-address", [
    "--import",
    "tsx",
    "--test",
    "tests/conversation-id.test.ts",
  ]);
  await check("default-build", ["node_modules/vite/bin/vite.js", "build"]);
  for (const engine of ["chromium", "firefox", "webkit"]) {
    await check(
      "default-ui-" + engine,
      [
        "scripts/e2e.mjs",
        "--config",
        "tests/browser/matrix.config.ts",
        "tests/browser/application.spec.ts",
        "tests/browser/contact-relay.spec.ts",
        "tests/browser/connectivity.spec.ts",
        "tests/browser/site-studio.spec.ts",
        "tests/browser/onboarding-language.spec.ts",
      "tests/browser/site-language.spec.ts",
      "tests/browser/site-pages.spec.ts",
      "tests/browser/mobile-navigation.spec.ts",
      ],
      { RELAYLOOM_MATRIX_ENGINE: engine },
    );
    cpSync(".cache/browser-application/ui", join(output, "default-" + engine), {
      recursive: true,
    });
  }
  await check("public-build", [
    "node_modules/vite/bin/vite.js",
    "build",
    "--mode",
    "public-web",
    "--base",
    "/relayloom/",
  ]);
  report.artifacts = webArtifacts();
  save();
  await check("public-matrix", [
    "scripts/e2e.mjs",
    "--config",
    "tests/browser/public.config.ts",
  ]);
  await check("two-processes", [
    "scripts/e2e.mjs",
    "--config",
    "tests/browser/launch.config.ts",
  ]);
  if (
    !isDeepStrictEqual(report.sources, webSources()) ||
    !isDeepStrictEqual(report.artifacts, webArtifacts())
  )
    throw new Error("Inputs or artifacts changed during validation");
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.error = error.message;
  process.exitCode = 1;
} finally {
  report.finished = new Date().toISOString();
  save();
}
