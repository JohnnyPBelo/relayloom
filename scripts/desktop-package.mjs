import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (
  args.some(
    (arg) =>
      !["--linux", "--win", "--mac", "--x64", "--arm64", "--dir"].includes(arg),
  )
)
  throw new Error(
    "Supported packaging options: --linux --win --mac --x64 --arm64 --dir",
  );
if (!existsSync(join(repository, "dist/desktop/app/main.cjs")))
  throw new Error(
    "Stage the desktop app first: node scripts/desktop-build.mjs",
  );
const cache = join(repository, ".cache", "electron-builder"),
  temporary = join(repository, ".cache", "desktop", "packaging-tmp");
mkdirSync(cache, { recursive: true });
mkdirSync(temporary, { recursive: true });
const executable = createRequire(import.meta.url).resolve(
  "electron-builder/out/cli/cli.js",
);
const child = spawn(
  process.execPath,
  [
    executable,
    "--config",
    join(repository, "apps/desktop/electron-builder.cjs"),
    ...args,
  ],
  {
    cwd: repository,
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_CACHE: join(repository, ".cache/electron"),
      ELECTRON_BUILDER_CACHE: cache,
      TMPDIR: temporary,
      TMP: temporary,
      TEMP: temporary,
    },
  },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
