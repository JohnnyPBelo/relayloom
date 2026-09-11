import { test, expect } from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";
import { rmSync } from "node:fs";
import { launch, password } from "../helpers";

test("an earlier delayed state cannot restore private UI after identity lock", async ({
  page,
}) => {
  const node = await launch();
  try {
    await node.call("setup", { name: "Private identity", password });
    await node.call("publish", {
      content: { type: "post", text: "Private snapshot content" },
      recipients: [],
    });
    await page.goto(node.url + "/#token=" + node.token);
    await expect(
      page.getByRole("heading", { name: "As tuas conversas" }),
    ).toBeVisible();
    const stale = await node.call("state");
    let release!: () => void, held!: () => void, delivered!: () => void;
    const deliveredState = new Promise<void>((r) => (delivered = r));
    const waiting = new Promise<void>((r) => (release = r)),
      intercepted = new Promise<void>((r) => (held = r));
    let first = true;
    await page.route("**/api/state", async (route) => {
      if (first) {
        first = false;
        held();
        await waiting;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(stale),
        });
        delivered();
      } else await route.continue();
    });
    await intercepted;
    await page.getByRole("button", { name: "Bloquear identidade" }).click();
    await expect(
      page.getByRole("heading", { name: "Bom ter-te de volta." }),
    ).toBeVisible();
    release();
    await deliveredState;
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await expect(
      page.getByRole("heading", { name: "Bom ter-te de volta." }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Bloquear identidade" }),
    ).toHaveCount(0);
    await page.waitForResponse(
      (r) => r.url().endsWith("/api/state") && r.status() === 200,
    );
    await expect(
      page.getByText("Private snapshot content", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await node.stop();
    rmSync(node.dir, { recursive: true, force: true });
  }
});

test("history page loads older verified posts without inflating the periodic snapshot", async ({
  page,
}) => {
  const node = await launch();
  try {
    await node.call("setup", { name: "Archive", password });
    for (let i = 0; i < 110; i++) {
      if (i && i % 40 === 0) await delay(1050);
      await node.call("publish", {
        content: { type: "post", text: `Archive post ${i}` },
        recipients: "public",
      });
    }
    await page.goto(node.url + "/#token=" + node.token);
    await page.getByRole("button", { name: "A praça", exact: true }).click();
    await expect(page.getByText("Archive post 0", { exact: true })).toHaveCount(
      0,
    );
    await page
      .getByRole("button", { name: "Carregar histórico anterior" })
      .click();
    await expect(
      page.getByText("Archive post 0", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Carregar histórico anterior" }),
    ).toHaveCount(0);
    const snapshot = await node.call("state");
    expect(snapshot.objects.length).toBe(100);
    expect(snapshot.history.total).toBe(110);
  } finally {
    await node.stop();
    rmSync(node.dir, { recursive: true, force: true });
  }
});
