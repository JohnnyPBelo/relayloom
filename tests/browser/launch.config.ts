import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import base from "./browser.config";
process.env.RELAYLOOM_PUBLIC_BUILD = "1";
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "launch.checks.ts",
  outputDir: "../../.cache/public-web/launch-results",
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: resolve(".cache/public-web/launch-playwright.json") },
    ],
  ],
});
