import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { appHost } from "./app-host";

test("public build serves every integrity-pinned asset below its prefix, with no daemon entry", async ({
  request,
}) => {
  const host = await appHost();
  try {
    const origin = new URL(host.url).origin;
    const manifest = await (
      await request.get(host.url + "/browser/assets.json")
    ).json();
    expect(manifest.assets.length).toBeGreaterThan(5);
    for (const asset of manifest.assets) {
      expect(asset.path).toMatch(/^\/relayloom\/(browser|assets)\//);
      const response = await request.get(origin + asset.path);
      expect(response.status(), asset.path).toBe(200);
      expect(
        createHash("sha256")
          .update(await response.body())
          .digest("hex"),
      ).toBe(asset.sha256);
      if (asset.path.endsWith(".webmanifest")) {
        const value = await response.json();
        expect(new URL(value.start_url, origin + asset.path).pathname).toBe(
          "/relayloom/browser/index.html",
        );
        expect(new URL(value.scope, origin + asset.path).pathname).toBe(
          "/relayloom/browser/",
        );
        expect(new URL(value.icons[0].src, origin + asset.path).pathname).toBe(
          "/relayloom/browser/icon.svg",
        );
      }
    }
    expect((await request.get(origin + "/browser/sw.js")).status()).toBe(404);
    expect((await request.get(host.url + "/api/state")).status()).toBe(404);
    const entry = readFileSync("dist/public-web/index.html", "utf8");
    expect(entry).toContain("./browser/index.html");
    expect(entry).not.toContain("<script");
    const webmanifest = await (
      await request.get(host.url + "/browser/manifest.webmanifest")
    ).json();
    expect(
      new URL(webmanifest.start_url, host.url + "/browser/manifest.webmanifest")
        .pathname,
    ).toBe("/relayloom/browser/index.html");
    expect(
      new URL(webmanifest.scope, host.url + "/browser/manifest.webmanifest")
        .pathname,
    ).toBe("/relayloom/browser/");
  } finally {
    await host.close();
  }
});

test("subpath offline installation preserves other installations' caches and uses no external runtime", async ({
  browser,
}) => {
  const host = await appHost({ cacheProbe: true }),
    context = await browser.newContext({ locale: "pt-PT" }),
    page = await context.newPage();
  const requests: string[] = [],
    errors: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    // A cache on the same origin but outside this installation is a negative
    // control for activation's cleanup. Its sentinel must survive unchanged.
    const sibling = await context.newPage();
    await sibling.goto(host.url + "/__fixture__/cache.html");
    await sibling.evaluate(async () => {
      const cache = await caches.open(
        "relayloom-browser-assets-another-installation",
      );
      await cache.put("/another-project/sentinel", new Response("keep me"));
      if (
        (await (await cache.match("/another-project/sentinel"))?.text()) !==
        "keep me"
      )
        throw new Error("Cache sentinel was not stored");
    });
    // Keep the independent HTML client alive while this app installs. This
    // exercises actual activation without unregistering browser storage.
    await page.goto(host.url + "/browser/index.html");
    await page.getByRole("button", { name: "Começar", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Criar identidade", exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "data-offline-assets",
      "ready",
    );
    expect(await page.evaluate(() => isSecureContext)).toBe(true);
    expect(
      await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL),
    ).toBe(host.url + "/browser/sw.js");
    host.setUnavailable(true);
    await page.reload();
    await page.getByRole("button", { name: "Começar", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Criar identidade", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(async () =>
        (
          await (
            await caches.open("relayloom-browser-assets-another-installation")
          ).match("/another-project/sentinel")
        )?.text(),
      ),
    ).toBe("keep me");
    expect(requests.every((url) => url.startsWith(host.url + "/"))).toBe(true);
    expect(requests.some((url) => url.includes("/api/"))).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await host.close();
  }
});
