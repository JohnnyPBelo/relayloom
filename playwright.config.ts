import { defineConfig } from "@playwright/test";
process.env.PLAYWRIGHT_BROWSERS_PATH =
  process.env.PLAYWRIGHT_BROWSERS_PATH ?? ".cache/playwright";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e.json" }]],
  use: {
    headless: true,
    actionTimeout: 12000,
    navigationTimeout: 12000,
    launchOptions: { chromiumSandbox: true },
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
