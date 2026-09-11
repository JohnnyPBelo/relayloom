import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { rmSync } from "node:fs";
import { launch, until, password } from "../helpers";

test("named private collections, followed feed, sharing reference and UI persistence", async ({
  page,
}) => {
  const a = await launch(),
    b = await launch();
  try {
    const alice = await a.call("setup", { name: "Alice", password });
    await b.call("setup", { name: "Bruno", password });
    await b.call("contact", { contact: alice });
    await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
    await until(
      () => a.call("state"),
      (s) => s.peers.length === 1,
    );
    const shared = await a.call("publish", {
      content: { type: "post", text: "Uma história da Alice" },
      recipients: "public",
    });
    await b.call("publish", {
      content: { type: "post", text: "Uma história do Bruno" },
      recipients: "public",
    });
    await until(
      () => b.call("state"),
      (s) => s.objects.some((o: any) => o.id === shared.id),
    );
    await page.goto(b.url + "/#token=" + b.token);
    await page.getByRole("button", { name: "Guardados", exact: true }).click();
    await page
      .getByRole("button", { name: "Criar colecção", exact: true })
      .click();
    await page.getByLabel("Nome da colecção").fill("Pessoas por perto");
    await page.getByRole("button", { name: "Guardar colecção" }).click();
    await expect(
      page
        .locator(".collection-choice")
        .filter({ hasText: "Pessoas por perto" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "A praça", exact: true }).click();
    await page
      .locator(".post")
      .filter({ hasText: "Uma história da Alice" })
      .getByRole("button", { name: "Mais opções da publicação" })
      .click();
    await page.getByRole("checkbox", { name: "Pessoas por perto" }).check();
    await page.getByRole("button", { name: "Fechar", exact: true }).click();
    await page.getByRole("button", { name: "Guardados", exact: true }).click();
    await page
      .locator(".collection-choice")
      .filter({ hasText: "Pessoas por perto" })
      .click();
    await expect(page.locator(".post")).toHaveCount(1);
    await expect(
      page.getByText("Uma história da Alice", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Renomear colecção Pessoas por perto" })
      .click();
    await page.getByLabel("Nome da colecção").fill("A comunidade");
    await page.getByRole("button", { name: "Guardar colecção" }).click();
    await page.reload();
    await page.getByRole("button", { name: "Guardados", exact: true }).click();
    await page
      .locator(".collection-choice")
      .filter({ hasText: "A comunidade" })
      .click();
    await expect(
      page.getByText("Uma história da Alice", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "A praça", exact: true }).click();
    await page
      .getByRole("button", { name: "Seguir localmente", exact: true })
      .click();
    await page
      .locator(".social-tabs")
      .getByRole("button", { name: "A seguir", exact: true })
      .click();
    await expect(page.locator(".post")).toHaveCount(1);
    await expect(
      page.getByText("Uma história do Bruno", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Obter conteúdo por endereço" })
      .click();
    await page
      .getByLabel("Endereço do conteúdo", { exact: true })
      .fill(shared.id);
    await page.getByRole("button", { name: "Pedir aos pares" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole('button', { name: 'Definições', exact: true }).click();
    await page.getByRole('checkbox', { name: /Texto maior/ }).check(); await page.getByRole('checkbox', { name: /Alto contraste/ }).check();
    await expect(page.locator('html')).toHaveAttribute('data-readability', 'large'); await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(audit.violations.map((v) => v.id)).toEqual([]);
    await page.getByRole("button", { name: "Guardados", exact: true }).click();
    await page
      .getByRole("button", { name: "Eliminar colecção A comunidade" })
      .click();
    await expect(
      page.locator(".collection-choice").filter({ hasText: "A comunidade" }),
    ).toHaveCount(0);
  } finally {
    await Promise.all([a.stop(), b.stop()]);
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});
