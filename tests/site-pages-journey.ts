import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { validateStudio, type StudioValue } from "../apps/web/src/site/model";

export function pageProject(): StudioValue {
  return {
    theme: "forest",
    attachments: [
      {
        name: "campo.png",
        mime: "image/png",
        data: readFileSync(
          "apps/ios/Tests/Fixtures/synthetic-photo.png",
        ).toString("base64"),
      },
    ],
    site: {
      version: 1,
      title: "Caderno de campo",
      description: "Conteúdo da autora",
      home: "home",
      design: {
        font: "serif",
        width: "standard",
        radius: "soft",
        accent: "#207a70",
      },
      pages: [
        {
          id: "home",
          slug: "inicio",
          title: "Início",
          blocks: [
            {
              id: "home-hero",
              type: "hero",
              title: "O nosso ponto de encontro.",
              body: "Entrada original.",
            },
            {
              id: "about-link",
              type: "button",
              title: "Conhecer o projecto",
              body: "",
              url: "page:about",
            },
          ],
        },
        {
          id: "about",
          slug: "sobre",
          title: "Sobre",
          blocks: [
            {
              id: "about-hero",
              type: "hero",
              title: "Sobre o projecto.",
              body: "Texto original da autora.",
            },
            {
              id: "about-columns",
              type: "columns",
              title: "",
              body: "",
              style: { columns: 2 },
              children: [
                {
                  id: "about-text",
                  type: "text",
                  title: "Uma história partilhada",
                  body: "Cada página tem o seu lugar.",
                },
                {
                  id: "about-self",
                  type: "button",
                  title: "Nesta página",
                  body: "",
                  url: "page:about",
                },
              ],
            },
            {
              id: "about-image",
              type: "image",
              title: "Uma imagem do campo",
              body: "",
              media: [{ attachment: 0, alt: "Imagem sintética de campo" }],
            },
          ],
        },
      ],
    },
  };
}

export async function organisePages(page: Page, output: string) {
  const studio = page.getByRole("region", { name: "Estúdio do site" });
  const original = pageProject();
  await studio.getByRole("tab", { name: "Avançado", exact: true }).click();
  await studio.getByLabel("Projecto declarativo", { exact: true }).fill(
    JSON.stringify({
      format: "relayloom-site-project",
      version: 1,
      ...original,
    }),
  );
  await studio
    .getByRole("button", { name: "Validar e aplicar", exact: true })
    .click();
  const pages = studio.locator(".studio-pages > button");
  await expect(pages).toHaveCount(2);
  await pages.filter({ hasText: "Sobre" }).click();
  await studio
    .getByRole("button", { name: "Duplicar página seleccionada" })
    .click();
  await expect(pages).toHaveCount(3);
  await expect(
    studio.getByLabel("Nome da página", { exact: true }),
  ).toHaveValue("Sobre (cópia)");
  await expect(
    studio.getByLabel("Endereço da página", { exact: true }),
  ).toHaveValue("sobre-2");
  await studio
    .getByRole("button", { name: "Desfazer alteração do site" })
    .click();
  await expect(pages).toHaveCount(2);
  await studio
    .getByRole("button", { name: "Refazer alteração do site" })
    .click();
  await expect(pages).toHaveCount(3);
  await expect(
    studio.getByLabel("Nome da página", { exact: true }),
  ).toHaveValue("Sobre (cópia)");
  await studio
    .getByLabel("Nome da página", { exact: true })
    .fill("Arquivo de campo");
  await studio
    .getByLabel("Título do bloco 1", { exact: true })
    .fill("Diário em viagem.");
  for (let step = 0; step < 2; step++) {
    await studio
      .getByRole("button", { name: "Mover página para cima" })
      .focus();
    await page.keyboard.press("Enter");
  }
  await expect(pages.first()).toContainText("Arquivo de campo");
  await expect(
    studio.getByRole("button", { name: "Mover página para cima" }),
  ).toBeDisabled();
  await expect(
    studio.getByRole("button", { name: "Usar como início" }),
  ).toBeEnabled();
  await studio.getByRole("button", { name: "Mover página para baixo" }).click();
  await expect(pages.nth(1)).toContainText("Arquivo de campo");
  await studio
    .getByRole("button", { name: "Desfazer alteração do site" })
    .click();
  await expect(pages.first()).toContainText("Arquivo de campo");
  await studio
    .getByRole("button", { name: "Refazer alteração do site" })
    .click();
  await expect(pages.nth(1)).toContainText("Arquivo de campo");
  await studio.getByRole("button", { name: "Mover página para cima" }).click();
  await studio.getByRole("tab", { name: "Blocos", exact: true }).click();
  await studio.getByRole("tab", { name: "Avançado", exact: true }).click();
  const parsed = JSON.parse(
    await studio
      .getByLabel("Projecto declarativo", { exact: true })
      .inputValue(),
  );
  expect(parsed.format).toBe("relayloom-site-project");
  const value: StudioValue = {
    site: parsed.site,
    theme: parsed.theme,
    attachments: parsed.attachments,
  };
  validateStudio(value);
  expect(value.site.home).toBe("home");
  expect(value.site.pages.map((p) => p.title)).toEqual([
    "Arquivo de campo",
    "Início",
    "Sobre",
  ]);
  expect(value.site.pages.find((p) => p.id === "about")).toEqual(
    original.site.pages[1],
  );
  expect(value.attachments).toEqual(original.attachments);
  expect(value.site.pages[0].blocks[1].children![1].url).toBe(
    "page:" + value.site.pages[0].id,
  );
  await studio.getByRole("tab", { name: "Blocos", exact: true }).click();
  await studio
    .getByRole("button", { name: "Pré-visualizar", exact: true })
    .click();
  await studio
    .getByRole("button", { name: "Nesta página", exact: true })
    .click();
  await expect(
    studio.getByRole("heading", { name: "Diário em viagem.", exact: true }),
  ).toBeVisible();
  await studio.getByRole("button", { name: "Editar", exact: true }).click();
  mkdirSync(output, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const actions = studio.getByRole("group", { name: "Organizar página" });
    await actions.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const button of await actions.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
    writeFileSync(
      `${output}/axe-${width}.json`,
      JSON.stringify(
        { violations: audit.violations, passes: audit.passes.length },
        null,
        2,
      ) + "\n",
    );
    await actions
      .getByRole("button", { name: "Mover página para baixo" })
      .focus();
    await page.keyboard.press("Tab");
    await expect(
      actions.getByRole("button", { name: "Duplicar página seleccionada" }),
    ).toBeFocused();
    await page.screenshot({
      path: `${output}/editor-${width}.png`,
      fullPage: true,
    });
    await page.screenshot({ path: `${output}/editor-${width}-viewport.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await studio
    .getByRole("button", { name: "Guardar rascunho", exact: true })
    .click();
  await expect(studio.getByRole("status")).toContainText("Rascunho cifrado");
  return value;
}

export async function inspectOrganisedSite(page: Page, owner: string) {
  await page.getByRole("button", { name: "A praça", exact: true }).click();
  await page
    .getByRole("button", { name: "Ver página de " + owner, exact: true })
    .click();
  const dialog = page.getByRole("dialog"),
    navigation = dialog.getByRole("navigation", { name: "Páginas do site" });
  await expect(
    navigation.getByRole("button", { name: "Início", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(navigation.getByRole("button")).toHaveText([
    "Arquivo de campo",
    "Início",
    "Sobre",
  ]);
  await navigation
    .getByRole("button", { name: "Arquivo de campo", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Nesta página", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Diário em viagem.", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      dialog
        .getByRole("img", { name: "Imagem sintética de campo" })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(128);
  await navigation.getByRole("button", { name: "Sobre", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Sobre o projecto.", exact: true }),
  ).toBeVisible();
}
