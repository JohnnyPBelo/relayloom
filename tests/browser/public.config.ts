import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import base from "./browser.config";
process.env.RELAYLOOM_PUBLIC_BUILD = "1";
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: [
    "application.spec.ts",
    "contact-relay.spec.ts",
    "connectivity.spec.ts",
    "site-studio.spec.ts",
    "onboarding-language.spec.ts",
    "site-language.spec.ts",
    "public-distribution.checks.ts",
  ],
  projects: ["chromium", "firefox", "webkit"].map((name) => ({
    name,
    use: {
      browserName: name as "chromium" | "firefox" | "webkit",
      channel: undefined,
      launchOptions: name === "chromium" ? { chromiumSandbox: true } : {},
    },
  })),
  outputDir: "../../.cache/public-web/results",
  reporter: [
    ["list"],
    ["json", { outputFile: resolve(".cache/public-web/playwright.json") }],
  ],
});
