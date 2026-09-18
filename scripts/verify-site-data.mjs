// Sequential, resumable by an explicit phase selection. A selected phase never
// claims the unexecuted gates. No installation, service or provider changes.
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
const root = resolve(import.meta.dirname, ".."),
  require = createRequire(import.meta.url);
process.chdir(root);
const cli = (pkg, path) =>
  join(dirname(require.resolve(pkg + "/package.json")), path);
const output = resolve(
  process.env.RELAYLOOM_SITE_DATA_EVIDENCE ??
    `.cache/site-data-gate/${Date.now()}`,
);
if (
  !output.startsWith(root + sep + ".cache" + sep) ||
  existsSync(join(output, "report.json"))
)
  throw Error("Choose a new evidence directory inside this project's .cache");
mkdirSync(output, { recursive: true });
const temp = resolve(".cache/tmp");
mkdirSync(temp, { recursive: true });
const env = {
  ...process.env,
  TMPDIR: temp,
  TMP: temp,
  TEMP: temp,
  XDG_CACHE_HOME: resolve(".cache/site-data-runtime"),
  PLAYWRIGHT_BROWSERS_PATH:
    process.env.PLAYWRIGHT_BROWSERS_PATH ?? resolve(".cache/playwright"),
};
const pw = cli("playwright", "cli.js");
const browserFiles = [
  "site-data-component",
  "site-data-editor",
  "site-api",
  "site-network",
  "site-studio",
  "site-language",
  "site-revisions",
  "site-worker",
  "site-publication",
  "site-pages",
  "large-site-draft",
  "site-catalog",
].map((name) => `tests/browser/${name}.spec.ts`);
const uiFiles = ["site-studio", "site-publication", "site-pages"].map(
  (name) => `tests/e2e/${name}.spec.ts`,
);
const phases = [
  { name: "typecheck", args: [cli("typescript", "bin/tsc"), "--noEmit"] },
  { name: "web-build", args: [cli("vite", "bin/vite.js"), "build"] },
  { name: "native-build", args: ["scripts/native-build.mjs"] },
  {
    name: "node-sites",
    args: [
      "--import",
      "tsx",
      "--test",
      "--test-concurrency=1",
      ...readdirSync("tests")
        .filter((name) => /^(site.*|content|i18n)\.test\.ts$/.test(name))
        .sort()
        .map((name) => "tests/" + name),
    ],
  },
  {
    name: "go-sites-app-race",
    args: ["scripts/go.mjs", "test", "-race", "-p=2", "./sites", "./app"],
  },
  {
    name: "native-site-interop",
    args: [
      "--import",
      "tsx",
      "--test",
      "--test-concurrency=1",
      ...readdirSync("tests/native")
        .filter((name) => /^site.*\.test\.ts$/.test(name))
        .sort()
        .map((name) => "tests/native/" + name),
    ],
  },
  ...["node", "native"].map((backend) => ({
    name: "ui-" + backend,
    args: [
      pw,
      "test",
      "--config",
      "playwright.config.ts",
      ...uiFiles,
      "--reporter=list,json",
    ],
    env: { RELAYLOOM_TEST_BACKEND: backend },
  })),
  ...["chromium", "firefox", "webkit"].map((engine) => ({
    name: "browser-" + engine,
    args: [
      pw,
      "test",
      "--config",
      "tests/browser/matrix.config.ts",
      ...browserFiles,
      "--reporter=list,json",
    ],
    env: { RELAYLOOM_MATRIX_ENGINE: engine },
  })),
];
const selected = process.argv.slice(2);
if (
  new Set(selected).size !== selected.length ||
  selected.some((name) => !phases.some((p) => p.name === name))
)
  throw Error(
    "Optional arguments must be unique phase names: " +
      phases.map((p) => p.name).join(" "),
  );
const chosen = phases.filter(
  (p) => !selected.length || selected.includes(p.name),
);
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
const report = {
  status: "RUNNING",
  startedAt: new Date().toISOString(),
  baseCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  platform: process.platform,
  phasesSelected: chosen.map((p) => p.name),
  scope:
    "Site-data increment on this host: real native processes and browser engines as named by each executed phase. Not physical radios/mobile/Apple execution, complete product acceptance or independent review.",
  sources: sources(),
  checks: [],
};
const save = () =>
  writeFileSync(
    join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
save();
try {
  for (const phase of chosen) {
    const disk = statfsSync(root),
      freeBytes = disk.bavail * disk.bsize;
    if (freeBytes < 15 * 1024 ** 3)
      throw Error("15 GiB disk reserve required before " + phase.name);
    console.log("Starting " + phase.name);
    const started = Date.now(),
      log = join(output, phase.name + ".log");
    const args =
      phase.args[0] === pw
        ? [...phase.args, "--output", join(output, phase.name + "-artifacts")]
        : phase.args;
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: {
        ...env,
        ...phase.env,
        PLAYWRIGHT_JSON_OUTPUT_FILE: join(output, phase.name + ".json"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    report.current = {
      phase: phase.name,
      pid: child.pid,
      startedAt: new Date().toISOString(),
      command: [process.execPath, ...args],
      environmentOverrides: phase.env ?? {},
    };
    save();
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (b) => appendFileSync(log, b));
    const code = await new Promise((done, fail) => {
      child.once("error", fail);
      child.once("close", done);
    });
    report.checks.push({
      ...report.current,
      exitCode: code,
      elapsedMs: Date.now() - started,
      freeBytesBefore: freeBytes,
      log: relative(output, log),
      logSHA256: existsSync(log)
        ? createHash("sha256").update(readFileSync(log)).digest("hex")
        : null,
    });
    delete report.current;
    save();
    console.log(phase.name + ": exit " + code);
    if (code !== 0)
      throw Error(phase.name + " failed; its evidence is preserved");
  }
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.error = error.message;
  process.exitCode = 1;
} finally {
  report.sourcesUnchanged =
    JSON.stringify(report.sources) === JSON.stringify(sources());
  if (!report.sourcesUnchanged) {
    report.status = "FAIL";
    report.sourceError = "Sources changed during this gate";
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  save();
  console.log(
    report.status + ": " + relative(root, join(output, "report.json")),
  );
}
