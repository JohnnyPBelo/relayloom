import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import base from "./browser.config";
const engine = process.env.RELAYLOOM_MATRIX_ENGINE;
if (!["chromium", "firefox", "webkit"].includes(engine ?? ""))
  throw new Error("Choose RELAYLOOM_MATRIX_ENGINE=chromium|firefox|webkit");
export default defineConfig({
  ...base,
  testDir: ".",
  workers: 1,
  projects: [
    {
      name: engine!,
      use: {
        browserName: engine as "chromium" | "firefox" | "webkit",
        channel: undefined,
        launchOptions: engine === "chromium" ? { chromiumSandbox: true } : {},
      },
    },
  ],
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: resolve(`.cache/browser-matrix/${engine}/playwright.json`),
      },
    ],
  ],
});
