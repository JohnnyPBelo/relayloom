import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { launch, password, until } from "../helpers";

const backend = process.env.RELAYLOOM_TEST_BACKEND === "native" ? "go" : "node";
const evidence = `.cache/liquid-glass/${backend}`;

async function audit(page: Page, name: string) {
  mkdirSync(evidence, { recursive: true });
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  writeFileSync(
    `${evidence}/${name}-axe.json`,
    JSON.stringify(
      {
        violations: result.violations,
        passed: result.passes.length,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}
async function command(page: Page, query: string) {
  await page.keyboard.press("Control+k");
  await page
    .getByRole("combobox", { name: "Pesquisar no teu espaço" })
    .fill(query);
}

test("command search uses real authorised peer messages, preserves drafts and forgets private queries on lock", async ({
  page,
}) => {
  const a = await launch(),
    b = await launch();
  try {
    const alice = await a.call("setup", { name: "Alice do Vidro", password });
    const bruno = await b.call("setup", {
      name: "Bruno dos Caminhos",
      password,
    });
    await a.call("contact", { contact: bruno });
    await b.call("contact", { contact: alice });
    await b.call("connect", { host: "127.0.0.1", port: a.tcpPort });
    const original = await b.call("publish", {
      content: {
        type: "message",
        text: "Amanhã encontramo-nos na biblioteca.",
      },
      recipients: [alice.id],
    });
    const deleted = await b.call("publish", {
      content: { type: "message", text: "Segredo eliminado da pesquisa." },
      recipients: [alice.id],
    });
    await b.call("publish", {
      content: { type: "delete", target: deleted.id },
      recipients: [alice.id],
    });
    await b.call("publish", {
      content: { type: "message", text: "Privado só no Bruno." },
      recipients: [],
    });
    await until(
      () => a.call("state"),
      (s) =>
        s.objects.some((o: any) => o.id === original.id) &&
        s.objects.some((o: any) => o.id === deleted.id && o.deleted),
    );
    await page.goto(a.url + "/#token=" + a.token);
    const trigger = page.getByRole("button", { name: "Pesquisar e navegar" });
    await trigger.click();
    const query = page.getByRole("combobox", {
      name: "Pesquisar no teu espaço",
    });
    await expect(query).toBeFocused();
    await query.fill("amanha biblioteca");
    await expect(
      page
        .getByRole("listbox", { name: "Resultados da pesquisa" })
        .getByRole("option"),
    ).toHaveCount(1);
    await audit(page, "commands-light");
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Meta+k");
    await expect(query).toHaveValue("");
    await query.fill("amanha biblioteca");
    await page.keyboard.press("Enter");
    await expect(page.locator(`#message-${original.id}`)).toBeFocused();
    await page
      .getByLabel("Escrever mensagem")
      .fill("Um rascunho que fica nesta conversa.");
    await command(page, "guardados");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: /Vale a pena guardar/ }),
    ).toBeVisible();
    await command(page, "Bruno dos Caminhos");
    // First result is the conversation, followed by its authorised messages.
    await page.keyboard.press("ArrowDown");
    const active = await query.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    await expect(page.locator(`[id="${active}"]`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Escrever mensagem")).toHaveValue(
      "Um rascunho que fica nesta conversa.",
    );
    await page.setViewportSize({ width: 320, height: 844 });
    await expect(
      page.getByRole("navigation", { name: "Navegação rápida" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(320);
    for (const button of await page.locator(".chat button:visible").all()) {
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await audit(page, "messenger-mobile-320");
    expect(
      (await page.locator(".message-scroll").boundingBox())!.height,
    ).toBeGreaterThan(450);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await command(page, "Segredo eliminado");
    await expect(
      page
        .getByRole("listbox", { name: "Resultados da pesquisa" })
        .getByRole("option"),
    ).toHaveCount(0);
    await query.fill("Privado só no Bruno");
    await expect(
      page
        .getByRole("listbox", { name: "Resultados da pesquisa" })
        .getByRole("option"),
    ).toHaveCount(0);
    await query.fill("amanha biblioteca");
    // Lock by the real API while the palette is open; polling must remove all results.
    await a.call("lock", {});
    await expect(
      page.getByRole("heading", { name: "Bom ter-te de volta." }),
    ).toBeVisible();
    await expect(query).toHaveCount(0);
    await expect(
      page.getByText("Amanhã encontramo-nos na biblioteca.", { exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await page.evaluate(() => JSON.stringify(localStorage)),
    ).not.toContain("biblioteca");
    await page.getByLabel("Frase-passe", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar na minha rede" }).click();
    await trigger.click();
    await expect(query).toHaveValue("");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Alternar tema" }).click();
    await command(page, "Nova conversa");
    await audit(page, "commands-dark");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Começar uma conversa" }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
  } finally {
    await a.stop();
    await b.stop();
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

test("glass respects device effects, low power, contrast and keyboard access across responsive screens", async ({
  page,
}) => {
  const client = await launch();
  try {
    await client.call("setup", { name: "Inês da Comunidade", password });
    await page.goto(client.url + "/#token=" + client.token);
    await page.getByRole("button", { name: "Definições", exact: true }).click();
    const root = page.locator("html");
    const effects = page.getByRole("checkbox", { name: /^Liquid Glass/ });
    const blur = () =>
      page
        .locator(".topbar")
        .evaluate((el) => getComputedStyle(el).backdropFilter);
    await expect(root).toHaveAttribute("data-effects", "glass");
    expect(await blur()).toContain("blur");
    await effects.uncheck();
    await expect(root).toHaveAttribute("data-effects", "reduced");
    expect(await blur()).toBe("none");
    await page.reload();
    await page.getByRole("button", { name: "Definições", exact: true }).click();
    await expect(effects).not.toBeChecked();
    await effects.check();
    const lowPower = page.getByRole("checkbox", {
      name: /^Modo de baixo consumo/,
    });
    await lowPower.click();
    await expect(lowPower).toBeChecked();
    await expect(root).toHaveAttribute("data-effects", "reduced");
    expect((await client.call("state")).settings.lowPower).toBe(true);
    expect(await blur()).toBe("none");
    await expect(effects).toBeChecked();
    await lowPower.click();
    await expect(lowPower).not.toBeChecked();
    await expect(root).toHaveAttribute("data-effects", "glass");
    const contrast = page.getByRole("checkbox", { name: /^Alto contraste/ });
    await contrast.check();
    await expect(root).toHaveAttribute("data-effects", "reduced");
    await audit(page, "settings-high-contrast");
    await contrast.uncheck();
    await page.emulateMedia({ contrast: "more", reducedMotion: "reduce" });
    await expect(root).toHaveAttribute("data-effects", "reduced");
    expect(await blur()).toBe("none");
    await page.emulateMedia({ contrast: "no-preference" });
    await expect(root).toHaveAttribute("data-effects", "glass");
    // Real Chromium media-query evaluation; this does not change OS preferences.
    const media = await page.context().newCDPSession(page);
    await media.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
    });
    await expect(root).toHaveAttribute("data-effects", "reduced");
    expect(await blur()).toBe("none");
    await media.send("Emulation.setEmulatedMedia", { features: [] });
    await media.detach();
    await expect(root).toHaveAttribute("data-effects", "glass");
    await page.emulateMedia({ forcedColors: "active" });
    await expect(root).toHaveAttribute("data-effects", "reduced");
    await command(page, "rede");
    await audit(page, "commands-forced-colors");
    await page.keyboard.press("Escape");
    await page.emulateMedia({ forcedColors: "none" });
    const measurements = [];
    for (const width of [320, 390, 720, 900, 1150, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      for (const destination of [
        "Conversas",
        "A praça",
        "A minha página",
        "Guardados",
        "A rede",
        "Definições",
      ]) {
        await command(page, destination);
        await page.keyboard.press("Enter");
        const geometry = await page.evaluate(() => ({
          viewport: innerWidth,
          content: document.documentElement.scrollWidth,
        }));
        const smallTargets = await page
          .locator("button:visible")
          .evaluateAll((buttons) =>
            buttons.flatMap((button) => {
              const rect = button.getBoundingClientRect();
              return rect.width < 43.9 || rect.height < 43.9
                ? [
                    {
                      label:
                        button.getAttribute("aria-label") ?? button.textContent,
                      width: rect.width,
                      height: rect.height,
                    },
                  ]
                : [];
            }),
          );
        expect
          .soft(smallTargets, `${destination} touch targets at ${width}px`)
          .toEqual([]);
        measurements.push({ width, destination, ...geometry, smallTargets });
        expect(
          geometry.content,
          `${destination} at ${width}px`,
        ).toBeLessThanOrEqual(width);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", { name: "Ir para A minha página", exact: true })
      .click();
    await expect(
      page.getByLabel("Título do bloco 1", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Ir para A minha página", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await audit(page, "editor-mobile");
    await command(page, "rede");
    await expect(
      page.getByRole("combobox", { name: "Pesquisar no teu espaço" }),
    ).toBeFocused();
    await audit(page, "commands-mobile");
    // Viewport resize is a geometry control, not a claim of a real OS software keyboard.
    await page.setViewportSize({ width: 390, height: 420 });
    await expect(
      page.getByRole("combobox", { name: "Pesquisar no teu espaço" }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByRole("button", { name: "Fechar pesquisa" }),
    ).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const dark of [false, true]) {
      if (dark)
        await page.getByRole("button", { name: "Alternar tema" }).click();
      for (const destination of [
        "A praça",
        "A minha página",
        "A rede",
        "Definições",
      ]) {
        await command(page, destination);
        await page.keyboard.press("Enter");
        await audit(
          page,
          `${destination.replaceAll(" ", "-")}-${dark ? "dark" : "light"}`,
        );
      }
    }
    writeFileSync(
      `${evidence}/responsive.json`,
      JSON.stringify(
        { backend, measurements, physicalKeyboard: false },
        null,
        2,
      ),
    );
  } finally {
    await client.stop();
    rmSync(client.dir, { recursive: true, force: true });
  }
});
