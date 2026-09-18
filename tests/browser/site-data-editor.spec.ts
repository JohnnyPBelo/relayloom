import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { uiHost } from "./app-host";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { authoredTable } from "../fixtures/site-table";
const password = "structured table editor fixture passphrase";
let host: Awaited<ReturnType<typeof uiHost>> & { requests?: string[] };
test.beforeAll(async () => {
  host = await uiHost();
});

test("table file import validates before replacement, preserves typed nulls, undoes changes and exports literal CSV safely", async ({
  page,
}, info) => {
  await enter(page, "Editora de directórios");
  await nav(page, "A minha página");
  const studio = page.getByRole("region", {
    name: "Estúdio do site",
    exact: true,
  });
  await studio.getByRole("button", { name: "Tabela", exact: true }).click();
  const editor = studio.getByRole("region", {
    name: "Editar dados da tabela",
    exact: true,
  });
  const file = editor.getByLabel("Ficheiro de dados da tabela", {
    exact: true,
  });
  const input = (buffer: Buffer, name = "table.json") =>
    file.setInputFiles({
      name,
      mimeType: name.endsWith("csv") ? "text/csv" : "application/json",
      buffer,
    });
  const exportFile = async () => {
    const pending = page.waitForEvent("download");
    await editor
      .getByRole("button", { name: "Exportar dados", exact: true })
      .click();
    const download = await pending;
    return readFileSync((await download.path())!, "utf8");
  };
  for (const [bytes, error] of [
    [Buffer.from("{"), "O ficheiro JSON não é válido"],
    [
      Buffer.from([0xc3, 0x28]),
      "Não foi possível ler o ficheiro como texto UTF-8",
    ],
    [Buffer.alloc(128 * 1024 + 1, 0x20), "O ficheiro de dados excede 128 KiB"],
    [
      Buffer.from(
        JSON.stringify({
          ...authoredTable(),
          script: "https://example.org/run.js",
        }),
      ),
      "Dados do site inválidos: campos da tabela",
    ],
  ] as const) {
    await input(bytes);
    await expect(editor.getByRole("alert")).toHaveText(error);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      editor.getByLabel("Nome da coluna 1", { exact: true }),
    ).toHaveValue("Nome");
  }
  const original = authoredTable();
  await input(Buffer.from(JSON.stringify(original)));
  let confirmation = page.getByRole("dialog", {
    name: "Substituir dados da tabela",
    exact: true,
  });
  await expect(confirmation).toContainText("3 linhas · 5 colunas");
  await confirmation
    .getByRole("button", { name: "Fechar", exact: true })
    .click();
  await expect(
    editor.getByLabel("Nome da coluna 1", { exact: true }),
  ).toHaveValue("Nome");
  await input(Buffer.from(JSON.stringify(original)));
  await confirmation
    .getByRole("button", { name: "Substituir por estes dados", exact: true })
    .click();
  expect(JSON.parse(await exportFile())).toEqual(original);
  await editor
    .getByLabel("Tipo da coluna 4", { exact: true })
    .selectOption("text");
  const converted = JSON.parse(await exportFile());
  expect(converted.rows[2].values.date).toBeNull();
  await studio
    .getByRole("button", { name: "Desfazer alteração do site", exact: true })
    .click();
  expect(JSON.parse(await exportFile())).toEqual(original);
  await editor
    .getByLabel("Linha 2, Aberto", { exact: true })
    .selectOption("true");
  expect(JSON.parse(await exportFile()).rows[1].values.open).toBe(true);
  await editor.getByLabel("Linha 1, Data", { exact: true }).fill("2023-02-29");
  await expect(editor.getByRole("alert")).toBeVisible();
  await editor.getByLabel("Linha 1, Data", { exact: true }).fill("");
  await expect(editor.getByRole("alert")).toHaveCount(0);
  expect(JSON.parse(await exportFile()).rows[0].values.date).toBeNull();
  await editor
    .getByLabel("Linha 1, Informação", { exact: true })
    .fill("javascript:alert(1)");
  await expect(editor.getByRole("alert")).toBeVisible();
  await editor.getByLabel("Linha 1, Informação", { exact: true }).fill("");
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await editor
    .getByRole("button", { name: "Eliminar linha 2", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Eliminar linha da tabela", exact: true })
    .getByRole("button", { name: "Confirmar eliminação", exact: true })
    .click();
  expect(JSON.parse(await exportFile()).rows).toHaveLength(2);
  await studio
    .getByRole("button", { name: "Desfazer alteração do site", exact: true })
    .click();
  expect(JSON.parse(await exportFile()).rows).toHaveLength(3);
  await editor
    .getByRole("button", { name: "Eliminar coluna 5", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Eliminar coluna da tabela", exact: true })
    .getByRole("button", { name: "Confirmar eliminação", exact: true })
    .click();
  expect(JSON.parse(await exportFile()).columns).toHaveLength(4);
  await studio
    .getByRole("button", { name: "Desfazer alteração do site", exact: true })
    .click();
  expect(JSON.parse(await exportFile()).columns).toHaveLength(5);
  await editor
    .getByLabel("Formato dos dados", { exact: true })
    .selectOption("csv");
  const csv =
    'Nome,Código,Notas\r\n"Centro, norte",001,"linha 1\nlinha ""2"""\r\n' +
    Array.from({ length: 11 }, (_, i) => `Local ${i},=2+2,Texto`).join("\r\n") +
    "\r\n";
  await input(Buffer.from(csv), "directory.csv");
  await confirmation
    .getByRole("button", { name: "Substituir por estes dados", exact: true })
    .click();
  await expect(
    editor.getByLabel("Linha 1, Código", { exact: true }),
  ).toHaveValue("001");
  await expect(editor.getByRole("table").getByRole("row")).toHaveCount(11);
  await editor
    .getByRole("button", { name: "Página seguinte", exact: true })
    .click();
  await expect(
    editor.getByLabel("Linha 12, Nome", { exact: true }),
  ).toHaveValue("Local 10");
  const csvExport = await exportFile();
  expect(csvExport).toContain(",001,");
  expect(csvExport).toContain(",'=2+2,");
  expect(csvExport).toContain('"linha 1\nlinha ""2"""');
  await editor
    .getByLabel("Formato dos dados", { exact: true })
    .selectOption("json");
  const saved = JSON.parse(await exportFile());
  expect(saved.rows[1].values["column-2"]).toBe("=2+2");
  await studio
    .getByRole("button", { name: "Guardar rascunho", exact: true })
    .click();
  await expect(
    studio.getByRole("status", {
      name: "Estado da publicação do site",
      exact: true,
    }),
  ).toContainText("Rascunho cifrado");
  const out = ".cache/site-data-editor/" + (info.project.name || "chromium");
  mkdirSync(out, { recursive: true });
  await editor.scrollIntoViewIfNeeded();
  await editor
    .getByRole("region", { name: "Células editáveis da tabela", exact: true })
    .evaluate((el) => (el.scrollLeft = 0));
  await page.screenshot({ path: out + "/editor-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await editor.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const name of [
    "Adicionar linha",
    "Adicionar coluna",
    "Importar dados",
    "Exportar dados",
  ]) {
    const bounds = await editor
      .getByRole("button", { name, exact: true })
      .boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(140);
    expect(bounds!.height).toBeLessThan(80);
  }
  await expect(file).toBeHidden();
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({ path: out + "/editor-mobile.png" });
  writeFileSync(
    out + "/editor-axe.json",
    JSON.stringify(
      { violations: axe.violations, passes: axe.passes.length },
      null,
      2,
    ),
  );
  await page
    .getByRole("button", { name: "Alternar tema", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await editor.getByLabel("Nome da coluna 1", { exact: true }).fill("");
  await expect(
    editor.getByLabel("Nome da coluna 1", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(editor.getByRole("alert")).toBeVisible();
  await editor.scrollIntoViewIfNeeded();
  const darkAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(darkAxe.violations).toEqual([]);
  await page.screenshot({ path: out + "/editor-mobile-dark.png" });
  writeFileSync(
    out + "/editor-dark-axe.json",
    JSON.stringify(
      { violations: darkAxe.violations, passes: darkAxe.passes.length },
      null,
      2,
    ),
  );
  await studio
    .getByRole("button", { name: "Desfazer alteração do site", exact: true })
    .click();
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await page.reload();
  await page.getByLabel("Frase-passe", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Entrar na minha rede", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "As tuas conversas" }),
  ).toBeVisible();
  await nav(page, "A minha página");
  expect(JSON.parse(await exportFile())).toEqual(saved);
});
test.afterAll(async () => {
  await host.close();
  if (host.requests)
    expect(host.requests.some((p) => p.startsWith("/api/"))).toBe(false);
});
async function nav(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  if (!(await button.isVisible()))
    await page
      .getByRole("button", { name: "Abrir navegação", exact: true })
      .click();
  await button.click();
}
async function enter(page: Page, name: string) {
  await page.goto(host.url + "/browser/index.html");
  await page.getByRole("button", { name: "Começar", exact: true }).click();
  await page.getByLabel("Como te chamas?").fill(name);
  await page.getByLabel("Frase-passe", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Criar identidade", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "As tuas conversas" }),
  ).toBeVisible();
}
async function connect(a: Page, b: Page) {
  for (const p of [a, b]) {
    await nav(p, "A rede");
    await p.getByRole("button", { name: "Ligar um par", exact: true }).click();
  }
  await a
    .getByRole("button", { name: "Criar código de ligação", exact: true })
    .click();
  const offer = await a.getByLabel("Código para partilhar").inputValue();
  await b.getByRole("tab", { name: "Receber código", exact: true }).click();
  await b.getByLabel("Código de ligação recebido").fill(offer);
  await b.getByRole("button", { name: "Criar resposta", exact: true }).click();
  await a
    .getByLabel("Resposta do outro dispositivo")
    .fill(await b.getByLabel("Código para partilhar").inputValue());
  await a
    .getByRole("button", { name: "Concluir ligação", exact: true })
    .click();
  await expect(
    a.getByText("Ligação estabelecida. Já podem trocar conteúdo.", {
      exact: true,
    }),
  ).toBeVisible();
  for (const p of [a, b])
    await p
      .getByRole("dialog")
      .getByRole("button", { name: "Fechar", exact: true })
      .click();
}

for (const words of [
  {
    locale: "en-GB",
    start: "Get started",
    name: "What is your name?",
    pass: "Passphrase",
    create: "Create identity",
    heading: "Your conversations",
    site: "My site",
    table: "Table",
    editor: "Edit table data",
    file: "Table data file",
    error: "The JSON file is invalid",
    confirm: "Replace with this data",
    column: "Column 1 name",
  },
  {
    locale: "es-ES",
    start: "Empezar",
    name: "¿Cómo te llamas?",
    pass: "Frase de contraseña",
    create: "Crear identidad",
    heading: "Tus conversaciones",
    site: "Mi sitio",
    table: "Tabla",
    editor: "Editar datos de la tabla",
    file: "Archivo de datos de la tabla",
    error: "El archivo JSON no es válido",
    confirm: "Sustituir por estos datos",
    column: "Nombre de la columna 1",
  },
])
  test(`table controls and import failures use ${words.locale} while authored data retains its language`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale: words.locale });
    try {
      const page = await context.newPage(),
        requests: string[] = [];
      page.on("request", (r) => requests.push(r.url()));
      await page.goto(host.url + "/browser/index.html");
      await page
        .getByRole("button", { name: words.start, exact: true })
        .click();
      await page
        .getByLabel(words.name, { exact: true })
        .fill("Autora dos dados");
      await page.getByLabel(words.pass, { exact: true }).fill(password);
      await page
        .getByRole("button", { name: words.create, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: words.heading, exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: words.site, exact: true }).click();
      await page
        .getByRole("button", { name: words.table, exact: true })
        .click();
      const editor = page.getByRole("region", {
          name: words.editor,
          exact: true,
        }),
        file = editor.getByLabel(words.file, { exact: true });
      await file.setInputFiles({
        name: "invalid.json",
        mimeType: "application/json",
        buffer: Buffer.from("{"),
      });
      await expect(editor.getByRole("alert")).toHaveText(words.error);
      await file.setInputFiles({
        name: "data.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(authoredTable())),
      });
      await page
        .getByRole("dialog")
        .getByRole("button", { name: words.confirm, exact: true })
        .click();
      await expect(
        editor.getByLabel(words.column, { exact: true }),
      ).toHaveValue("Lugar");
      expect(
        requests.every(
          (url) => new URL(url).origin === new URL(host.url).origin,
        ),
      ).toBe(true);
    } finally {
      await context.close();
    }
  });

test("real table editor types decimal cells, preserves drafts, publishes signed data and permits read-only queries after the author closes", async ({
  browser,
}, info) => {
  const ca = await browser.newContext({ locale: "pt-PT" }),
    cb = await browser.newContext({
      locale: "pt-PT",
      viewport: { width: 390, height: 844 },
    }),
    a = await ca.newPage(),
    b = await cb.newPage();
  try {
    await enter(a, "Autora dos dados");
    await enter(b, "Leitor dos dados");
    await nav(a, "Definições");
    const card = await a
      .getByLabel("Cartão público da identidade")
      .inputValue();
    await nav(b, "Conversas");
    await b
      .getByRole("button", { name: "Adicionar contacto", exact: true })
      .click();
    await b.getByLabel("Cartão público do contacto").fill(card);
    await b.getByRole("button", { name: "Verificar e adicionar" }).click();
    await expect(b.getByRole("dialog")).toHaveCount(0);
    await connect(a, b);
    await nav(a, "A minha página");
    const studio = a.getByRole("region", {
      name: "Estúdio do site",
      exact: true,
    });
    await studio.getByRole("button", { name: "Tabela", exact: true }).click();
    const editor = studio.getByRole("region", {
      name: "Editar dados da tabela",
      exact: true,
    });
    await editor.getByLabel("Nome da coluna 1", { exact: true }).fill("Local");
    await editor.getByLabel("Nome da coluna 2", { exact: true }).fill("Litros");
    await editor
      .getByLabel("Tipo da coluna 2", { exact: true })
      .selectOption("number");
    await editor
      .getByRole("button", { name: "Adicionar linha", exact: true })
      .click();
    await editor.getByLabel("Linha 1, Local", { exact: true }).fill("Escola");
    const number = editor.getByLabel("Linha 1, Litros", { exact: true });
    await number.fill("");
    await number.pressSequentially("1,25");
    await number.press("Tab");
    await expect(number).toHaveValue("1.25");
    await editor
      .getByRole("button", { name: "Adicionar linha", exact: true })
      .click();
    await editor
      .getByLabel("Linha 2, Local", { exact: true })
      .fill("<script>window.siteTableExecuted=true</script>");
    await editor.getByLabel("Linha 2, Litros", { exact: true }).fill("20");
    await editor.getByLabel("Linha 2, Litros", { exact: true }).press("Tab");
    await studio
      .getByRole("button", { name: "Guardar rascunho", exact: true })
      .click();
    await expect(
      studio.getByRole("status", {
        name: "Estado da publicação do site",
        exact: true,
      }),
    ).toContainText("Rascunho cifrado");
    await editor.getByLabel("Linha 1, Litros", { exact: true }).fill("1e-");
    await editor.getByLabel("Linha 1, Litros", { exact: true }).press("Tab");
    await expect(editor.getByRole("alert")).toBeVisible();
    await expect(
      editor.getByLabel("Linha 1, Litros", { exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    await studio
      .getByRole("button", { name: "Publicar página", exact: true })
      .click();
    await expect(
      studio.getByRole("alert").filter({ hasText: "Dados do site inválidos" }),
    ).toBeVisible();
    await editor.getByLabel("Linha 1, Litros", { exact: true }).fill("1.25");
    await editor.getByLabel("Linha 1, Litros", { exact: true }).press("Tab");
    await expect(
      editor.getByLabel("Linha 1, Litros", { exact: true }),
    ).toHaveAttribute("aria-invalid", "false");
    await studio
      .getByRole("button", { name: "Publicar página", exact: true })
      .click();
    await expect(
      studio.getByRole("status", {
        name: "Estado da publicação do site",
        exact: true,
      }),
    ).toContainText("Página assinada");
    await nav(b, "A praça");
    await b
      .getByRole("button", {
        name: "Ver página de Autora dos dados",
        exact: true,
      })
      .click();
    const read = b.getByRole("dialog");
    const dialogBounds = await read.boundingBox();
    expect(dialogBounds!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBounds!.y + dialogBounds!.height).toBeLessThanOrEqual(845);
    const table = read.getByRole("table", {
      name: "Dados da comunidade",
      exact: true,
    });
    await expect(
      table.getByRole("cell", { name: "Escola", exact: true }),
    ).toBeVisible();
    await expect(
      table.getByRole("cell", { name: "1,25", exact: true }),
    ).toBeVisible();
    expect(
      await b.evaluate(() => (window as any).siteTableExecuted),
    ).toBeUndefined();
    await expect(
      read.getByRole("region", { name: "Editar dados da tabela" }),
    ).toHaveCount(0);
    await read
      .getByLabel("Pesquisar nesta tabela", { exact: true })
      .fill("Escola");
    await expect(table.getByRole("row")).toHaveCount(2);
    await ca.close();
    await read
      .getByRole("button", { name: "Limpar filtros", exact: true })
      .click();
    await read
      .getByRole("button", { name: "Ordenar por Litros", exact: true })
      .click();
    await expect(table.getByRole("row").nth(1)).toContainText("Escola");
    await read
      .getByRole("button", { name: "Ordenar por Litros", exact: true })
      .click();
    await expect(table.getByRole("row").nth(1)).toContainText(
      "<script>window.siteTableExecuted=true</script>",
    );
    const axe = await new AxeBuilder({ page: b })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    const out = ".cache/site-data-editor/" + (info.project.name || "chromium");
    mkdirSync(out, { recursive: true });
    await b.screenshot({ path: out + "/reader.png" });
    writeFileSync(
      out + "/axe.json",
      JSON.stringify(
        { violations: axe.violations, passes: axe.passes.length },
        null,
        2,
      ),
    );
    await read.getByRole("button", { name: "Fechar", exact: true }).click();
    await b.reload();
    await b.getByLabel("Frase-passe", { exact: true }).fill(password);
    await b
      .getByRole("button", { name: "Entrar na minha rede", exact: true })
      .click();
    await expect(
      b.getByRole("heading", { name: "As tuas conversas" }),
    ).toBeVisible();
    await nav(b, "A praça");
    await b
      .getByRole("button", {
        name: "Ver página de Autora dos dados",
        exact: true,
      })
      .click();
    await expect(
      b
        .getByRole("dialog")
        .getByRole("table", { name: "Dados da comunidade" })
        .getByRole("cell", { name: "Escola", exact: true }),
    ).toBeVisible();
  } finally {
    await ca.close();
    await cb.close();
  }
});
