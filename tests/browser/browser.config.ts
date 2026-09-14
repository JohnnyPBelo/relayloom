import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import base from "../../playwright.config";
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "*.spec.ts",
  reporter: [
    ["list"],
    ["json", { outputFile: resolve(".cache/browser-foundation/playwright.json") }],
  ],
});
