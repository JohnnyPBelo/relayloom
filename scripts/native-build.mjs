import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, ".."),
  dir = resolve(root, ".cache/native-app");
mkdirSync(dir, { recursive: true });
const binary = resolve(
  dir,
  process.platform === "win32" ? "relayloom.exe" : "relayloom",
);
const child = spawn(
  process.execPath,
  ["scripts/go.mjs", "build", "-p=2", "-o", binary, "./cmd/relayloom"],
  { cwd: root, stdio: "inherit" },
);
child.on("exit", (code) => {
  if (code === 0) console.log("Native app CLI built in project cache.");
  process.exit(code ?? 1);
});
