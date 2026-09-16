import { test, expect } from "@playwright/test";
import { createIdentity } from "../../packages/core/src/index.js";
import { launch, password, until } from "../helpers.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

test("a cached site dialog is visible and reachable after scrolling a long mobile contact list", async ({
  browser,
}) => {
  const author = await launch(),
    viewer = await launch();
  const context = await browser.newContext({ locale: "pt-PT",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
  });
  try {
    const owner = await author.call("setup", {
      name: "ZZZ Cached page author",
      password,
    });
    await viewer.call("setup", { name: "Long page viewer", password });
    for (let i = 0; i < 45; i++)
      await viewer.call("contact", {
        contact: createIdentity("Earlier contact " + i).public,
      });
    await viewer.call("contact", { contact: owner });
    const site = await author.call("publish", {
      content: {
        type: "site",
        theme: "forest",
        blocks: [
          {
            id: "cover",
            type: "hero",
            title: "Visible offline page",
            body: "Read from the peer cache",
          },
        ],
      },
      recipients: "public",
    });
    await viewer.call("connect", { host: "127.0.0.1", port: author.tcpPort });
    await until(
      () => viewer.call("state"),
      (s) => s.objects.some((o: any) => o.id === site.id),
    );
    await author.stop();
    const page = await context.newPage();
    await page.goto(viewer.url + "/#token=" + viewer.token);
    await page.getByRole("button", { name: "Abrir navegação" }).click();
    await page.getByRole("button", { name: "A praça", exact: true }).click();
    const trigger = page.getByRole("button", {
      name: "Ver página de ZZZ Cached page author",
      exact: true,
    });
    await trigger.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(1500);
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Visible offline page" }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      dialog.getByRole("button", { name: "Fechar", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    const geometry = await dialog.evaluate((node: HTMLDialogElement) => {
      const r = node.getBoundingClientRect();
      return {
        modal: node.matches(":modal"),
        top: r.top,
        bottom: r.bottom,
        viewport: innerHeight,
        scrollY,
        visibleViewport: visualViewport?.height,
      };
    });
    expect(geometry.modal).toBe(true);
    mkdirSync(".cache/long-dialog", { recursive: true });
    writeFileSync(
      ".cache/long-dialog/geometry.json",
      JSON.stringify(geometry, null, 2),
    );
    await page.screenshot({ path: ".cache/long-dialog/visible.png" });
    await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  } finally {
    await context.close();
    await author.stop();
    await viewer.stop();
    rmSync(author.dir, { recursive: true, force: true });
    rmSync(viewer.dir, { recursive: true, force: true });
  }
});
