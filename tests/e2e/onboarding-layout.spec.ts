import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { launch } from "../helpers";

const backend = process.env.RELAYLOOM_TEST_BACKEND === "native" ? "go" : "node";

test("onboarding fits the native minimum window and intermediate widths with keyboard access", async ({
  page,
}) => {
  const client = await launch();
  const evidence = `docs/evidence/ui/onboarding-layout-${backend}`;
  mkdirSync(evidence, { recursive: true });
  try {
    await page.setViewportSize({ width: 720, height: 600 });
    await page.goto(client.url + "/#token=" + client.token);
    await expect(
      page.getByRole("button", { name: "Criar identidade", exact: true }),
    ).toBeVisible();
    const measurements = [];
    for (const width of [720, 681, 800, 900, 901, 1150, 1440, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const measured = await page.evaluate(() => {
        const form = document
          .querySelector(".onboarding")!
          .getBoundingClientRect();
        return {
          viewport: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          formLeft: form.left,
          formRight: form.right,
        };
      });
      measurements.push(measured);
      if (width === 720)
        await page.screenshot({
          path: `${evidence}/minimum-light.png`,
          fullPage: true,
        });
      expect(
        measured.documentWidth,
        `document overflows at ${width}px`,
      ).toBeLessThanOrEqual(measured.viewport);
      expect(measured.formLeft).toBeGreaterThanOrEqual(0);
      expect(measured.formRight).toBeLessThanOrEqual(measured.viewport);
    }
    await page.setViewportSize({ width: 720, height: 600 });
    await page.getByLabel("Como te chamas?").focus();
    await expect(page.getByLabel("Como te chamas?")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Frase-passe", { exact: true })).toBeFocused();
    for (const theme of ["light", "dark"]) {
      if (theme === "dark")
        await page.getByRole("button", { name: "Alternar tema" }).click();
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      writeFileSync(
        `${evidence}/${theme}-axe.json`,
        JSON.stringify(
          { violations: audit.violations, passed: audit.passes.length },
          null,
          2,
        ),
      );
      expect(
        audit.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
      await page.screenshot({
        path: `${evidence}/minimum-${theme}.png`,
        fullPage: true,
      });
    }
    writeFileSync(
      `${evidence}/result.json`,
      JSON.stringify(
        {
          result: "pass",
          backend,
          measurements,
          keyboardNameToPassword: true,
          nativeWindow: false,
          physicalDevice: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.stop();
    rmSync(client.dir, { recursive: true, force: true });
  }
});
