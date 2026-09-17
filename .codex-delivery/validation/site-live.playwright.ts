import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import base from "../../playwright.config";
export default defineConfig({
  ...base,
  testDir: "../../tests",
  testMatch: "site-publication-live.checks.ts",
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        channel: undefined,
        launchOptions: { chromiumSandbox: true },
      },
    },
    {
      name: "firefox",
      use: { browserName: "firefox", channel: undefined, launchOptions: {} },
    },
  ],
  outputDir: "../../.cache/site-editor/live/results",
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: resolve(
          process.argv.includes("--list")
            ? ".cache/site-editor/live/listing.json"
            : ".cache/site-editor/live/playwright.json",
        ),
      },
    ],
  ],
});
