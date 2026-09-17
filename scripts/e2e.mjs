import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
if (
  process.env.RELAYLOOM_TEST_BACKEND !== undefined &&
  !["node", "native"].includes(process.env.RELAYLOOM_TEST_BACKEND)
)
  throw new Error(
    "Use RELAYLOOM_TEST_BACKEND=node|native; native selects the Go runtime.",
  );
const temp = resolve(".cache/tmp");
mkdirSync(temp, { recursive: true });
const child = spawn(
  process.execPath,
  ["node_modules/playwright/cli.js", "test", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      TMPDIR: temp,
      TMP: temp,
      TEMP: temp,
      PLAYWRIGHT_BROWSERS_PATH: resolve(".cache/playwright"),
    },
  },
);
child.on("exit", (code) => process.exit(code ?? 1));
