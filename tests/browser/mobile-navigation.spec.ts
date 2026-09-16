import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { createIdentity } from "../../packages/core/src/index";
import { uiHost } from "./app-host";
let host: Awaited<ReturnType<typeof uiHost>>;
test.beforeAll(async () => {
  host = await uiHost();
});
test.afterAll(async () => {
  await host.close();
});

test("a single touch activates compact sidebar destinations after an open conversation hides the dock", async ({
  browser,
  browserName,
}, info) => {
  const context = await browser.newContext({
    locale: "en-GB",
    viewport: { width: 375, height: 647 },
    hasTouch: true,
    ...(browserName === "firefox" ? {} : { isMobile: true }),
  });
  const page = await context.newPage();
  try {
    await page.goto(host.url + "/browser/index.html");
    await expect(page).toHaveURL(host.url + "/browser/index.html");
    await page.getByRole("button", { name: "Get started", exact: true }).tap();
    await page
      .getByLabel("What is your name?", { exact: true })
      .fill("Touch navigation owner");
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("private touch fixture passphrase");
    await page
      .getByRole("button", { name: "Create identity", exact: true })
      .tap();
    await expect(
      page.getByRole("heading", { name: "Your conversations", exact: true }),
    ).toBeVisible();
    const contact = createIdentity("Offline navigation contact").public;
    await page.getByRole("button", { name: "Add contact", exact: true }).tap();
    await page
      .getByLabel("Contact's public card", { exact: true })
      .fill(JSON.stringify(contact));
    await page
      .getByRole("button", { name: "Verify and add", exact: true })
      .tap();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator(".conversation").filter({ hasText: contact.name }).tap();
    await expect(page.locator(".mobile-dock")).toHaveCount(0);
    for (const [destination, control] of [
      ["Network", "Connect a peer"],
      ["Community", "Share something"],
      ["Network", "Connect a peer"],
    ]) {
      const menu = page.getByRole("button", {
        name: "Open navigation",
        exact: true,
      });
      await menu.tap();
      await expect(menu).toHaveAttribute("aria-expanded", "true");
      const navigation = page.getByRole("navigation", {
        name: "Main navigation",
        exact: true,
      });
      await navigation
        .getByRole("button", { name: destination, exact: true })
        .tap();
      await expect(menu).toHaveAttribute("aria-expanded", "false");
      await expect(
        page.getByRole("button", { name: control, exact: true }),
      ).toBeVisible();
    }
    await page
      .getByRole("button", { name: "Connect a peer", exact: true })
      .tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    const output = `.cache/page-organisation/touch-${info.project.name || browserName}`;
    mkdirSync(output, { recursive: true });
    await page.screenshot({
      path: output + "/connected-panel.png",
      fullPage: true,
    });
    writeFileSync(
      output + "/report.json",
      JSON.stringify(
        {
          status: "PASS",
          applicationURL: host.url,
          browserName,
          emulatedTouch: true,
          nativeXCTest: false,
          physicalDevice: false,
          singleTapPerDestination: true,
          viewport: { width: 375, height: 647 },
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await context.close();
  }
});
