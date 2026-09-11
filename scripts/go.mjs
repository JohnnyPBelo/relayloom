import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
for (const name of ["go-build", "go-mod", "go"])
  mkdirSync(resolve(root, ".cache", name), { recursive: true });
const patchedGo = resolve(root, ".cache/toolchains/go1.26.8/bin/go");
const go = existsSync(patchedGo) ? patchedGo : "go";
const child = spawn(go, process.argv.slice(2), {
  cwd: resolve(root, "native"),
  stdio: "inherit",
  env: {
    ...process.env,
    GOTOOLCHAIN: "local",
    GOCACHE: resolve(root, ".cache/go-build"),
    GOMODCACHE: resolve(root, ".cache/go-mod"),
    GOPATH: resolve(root, ".cache/go"),
  },
});
child.on("error", (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
child.on("exit", (code) => process.exit(code ?? 1));
