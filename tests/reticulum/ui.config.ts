import { defineConfig } from "@playwright/test";
import base from "../../playwright.config";
import { resolve } from "node:path";
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "*.spec.ts",
  reporter: [
    ["list"],
    ["json", { outputFile: resolve(".cache/reticulum-ui/playwright.json") }],
  ],
});
