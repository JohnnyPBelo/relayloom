import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { uiHost } from "./app-host";
const password = "resource UI account fixture passphrase";
let host: Awaited<ReturnType<typeof uiHost>>;
const forbiddenRequests: string[] = [];
test.beforeAll(async () => {
  host = await uiHost();
});

test("resource library builds a private table through the UI and prevents accidental public publication", async ({
  page,
}, info) => {
  const output = `.cache/resource-ui/${info.project.name || "chromium"}`;
  mkdirSync(output, { recursive: true });
  await enter(page, "Autora da tabela");
  await nav(page, "A minha página");
  const studio = page.getByRole("region", {
    name: "Estúdio do site",
    exact: true,
  });
  await studio.getByRole("button", { name: /Opções de publicação:/ }).click();
  await studio
    .getByLabel("Quem pode ler o site", { exact: true })
    .selectOption("private");
  await studio.getByRole("button", { name: "Recursos", exact: true }).click();
  const library = page.getByRole("dialog", {
    name: "Biblioteca de recursos",
    exact: true,
  });
  await library
    .getByRole("button", { name: "Novo ficheiro", exact: true })
    .click();
  await library
    .getByLabel("Ficheiro do recurso", { exact: true })
    .setInputFiles({
      name: "too-large.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
    });
  await expect(library.getByRole("alert")).toHaveText(
    "O ficheiro excede 2 MiB.",
  );
  await expect(
    library.getByRole("button", { name: "Guardar recurso", exact: true }),
  ).toBeDisabled();
  await library
    .getByRole("button", { name: "Nova tabela", exact: true })
    .click();
  await library
    .getByLabel("Nome do recurso", { exact: true })
    .fill("Pontos de apoio");
  await library
    .getByLabel("Formato dos dados", { exact: true })
    .selectOption("csv");
  await library
    .getByLabel("Ficheiro de dados da tabela", { exact: true })
    .setInputFiles({
      name: "pontos.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Local,Vagas\nAbrigo central,12\nPonto do rio,4\n"),
    });
  await page
    .getByRole("dialog", { name: "Substituir dados da tabela", exact: true })
    .getByRole("button", { name: "Substituir por estes dados", exact: true })
    .click();
  await library
    .getByLabel("Tipo da coluna 2", { exact: true })
    .selectOption("number");
  await library
    .getByRole("button", { name: "Guardar recurso", exact: true })
    .click();
  await expect(
    library.getByRole("status", {
      name: "Estado da criação do recurso",
      exact: true,
    }),
  ).toContainText("Recurso guardado");
  await library
    .getByRole("button", { name: "Abrir recurso", exact: true })
    .click();
  await expect(
    library.getByRole("cell", { name: "Abrigo central", exact: true }),
  ).toBeVisible();
  await expect(
    library.getByRole("cell", { name: "12", exact: true }),
  ).toBeVisible();
  await audit(page, output + "/private-table-library");
  await library
    .getByRole("button", { name: "Inserir no site", exact: true })
    .click();
  await expect(library).toHaveCount(0);
  await studio
    .getByRole("button", { name: "Guardar rascunho", exact: true })
    .click();
  await studio
    .getByLabel("Quem pode ler o site", { exact: true })
    .selectOption("public");
  await studio
    .getByRole("button", { name: "Publicar página", exact: true })
    .click();
  await expect(studio.getByRole("alert")).toContainText(
    "Um recurso não permite todos os leitores escolhidos",
  );
  await expect(
    studio.getByLabel("Quem pode ler o site", { exact: true }),
  ).toBeEnabled();
  await studio
    .getByLabel("Quem pode ler o site", { exact: true })
    .selectOption("private");
  await studio
    .getByRole("button", { name: "Publicar página", exact: true })
    .click();
  await expect(
    studio.getByRole("status", {
      name: "Estado da publicação do site",
      exact: true,
    }),
  ).toContainText("Página assinada");
  await studio
    .getByRole("button", { name: "Ver histórico", exact: true })
    .click();
  await studio.getByRole("button", { name: /^Ver versão 1:/ }).click();
  const visit = page.getByRole("dialog", {
    name: "Página de Autora da tabela",
    exact: true,
  });
  await visit
    .getByRole("button", { name: "Obter e abrir tabela", exact: true })
    .click();
  await expect(
    visit.getByRole("cell", { name: "Abrigo central", exact: true }),
  ).toBeVisible();
  await expect(
    visit.getByRole("cell", { name: "12", exact: true }),
  ).toBeVisible();
  await visit.getByLabel("Pesquisar nesta tabela", { exact: true }).fill("rio");
  await expect(
    visit.getByRole("cell", { name: "Ponto do rio", exact: true }),
  ).toBeVisible();
  await expect(
    visit.getByRole("cell", { name: "Abrigo central", exact: true }),
  ).toHaveCount(0);
  await visit.locator(".site-resource").scrollIntoViewIfNeeded();
  await audit(page, output + "/private-table-reader");
});
test.afterAll(async () => {
  await host.close();
  expect(forbiddenRequests).toEqual([]);
});
async function enter(page: Page, name: string) {
  page.on("request", (request) => {
    if (/\/api\//.test(new URL(request.url()).pathname))
      forbiddenRequests.push(new URL(request.url()).pathname);
  });
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
async function nav(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  if (!(await button.isVisible()))
    await page
      .getByRole("button", { name: "Abrir navegação", exact: true })
      .click();
  await button.click();
}
async function card(page: Page) {
  await nav(page, "Definições");
  return JSON.parse(
    await page.getByLabel("Cartão público da identidade").inputValue(),
  );
}
async function addContact(page: Page, contact: unknown) {
  await nav(page, "Conversas");
  await page
    .getByRole("button", { name: "Adicionar contacto", exact: true })
    .click();
  await page
    .getByLabel("Cartão público do contacto")
    .fill(JSON.stringify(contact));
  await page.getByRole("button", { name: "Verificar e adicionar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function relay(page: Page, enabled: boolean) {
  await nav(page, "A rede");
  await page
    .getByLabel("Permitir retransmissão", { exact: true })
    .setChecked(enabled);
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
  const answer = await b.getByLabel("Código para partilhar").inputValue();
  await a.getByLabel("Resposta do outro dispositivo").fill(answer);
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
async function siteOf(page: Page, name: string) {
  await nav(page, "A praça");
  await page
    .getByRole("button", { name: "Ver página de " + name, exact: true })
    .click();
  return page.getByRole("dialog", { name: "Página de " + name, exact: true });
}
async function present(page: Page, id: string) {
  // Read-only storage control in an isolated test context, without application
  // API injection, private keys or changing the shipped worker.
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("relayloom-web-v1");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<boolean>((resolve, reject) => {
        const r = db
          .transaction("bundles", "readonly")
          .objectStore("bundles")
          .getKey(id);
        r.onsuccess = () => resolve(r.result !== undefined);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  }, id);
}
async function audit(page: Page, path: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  writeFileSync(
    path + "-axe.json",
    JSON.stringify(
      { violations: result.violations, passed: result.passes.length },
      null,
      2,
    ),
  );
  await page.screenshot({ path: path + ".png", fullPage: false });
  expect(result.violations).toEqual([]);
}
test("three accounts create, publish and retrieve optional files entirely through the UI; a restarted reader seeds after the author closes", async ({
  browser,
}, info) => {
  test.setTimeout(120000);
  const output = `.cache/resource-ui/${info.project.name || "chromium"}`;
  mkdirSync(output, { recursive: true });
  const contexts = [
      await browser.newContext(),
      await browser.newContext({ viewport: { width: 390, height: 844 } }),
      await browser.newContext(),
    ],
    [a, b, c] = await Promise.all(contexts.map((context) => context.newPage()));
  const file = Buffer.from("RELAYLOOM_RESOURCE_UI_603174\n".repeat(512));
  const errors: string[] = [];
  for (const p of [a, b, c]) p.on("pageerror", (e) => errors.push(e.message));
  try {
    await enter(a, "Alice dos recursos");
    await enter(b, "Bruno conserva");
    await enter(c, "Carla recebe");
    const alice = await card(a);
    await addContact(b, alice);
    await addContact(c, alice);
    await relay(a, true);
    await relay(b, true);
    await relay(c, true);
    await connect(a, b);
    await nav(a, "A minha página");
    const studio = a.getByRole("region", {
      name: "Estúdio do site",
      exact: true,
    });
    await studio.getByRole("button", { name: /Opções de publicação:/ }).click();
    await studio
      .getByLabel("Quem pode ler o site", { exact: true })
      .selectOption("public");
    await studio.getByRole("button", { name: "Recursos", exact: true }).click();
    const library = a.getByRole("dialog", {
      name: "Biblioteca de recursos",
      exact: true,
    });
    await expect(
      library.getByRole("heading", { name: "O teu arquivo começa aqui" }),
    ).toBeVisible();
    await library
      .getByRole("button", { name: "Novo ficheiro", exact: true })
      .click();
    await library
      .getByLabel("Ficheiro do recurso", { exact: true })
      .setInputFiles({
        name: "Guia da comunidade.txt",
        mimeType: "text/plain",
        buffer: file,
      });
    await library
      .getByRole("button", { name: "Guardar recurso", exact: true })
      .click();
    await expect(
      library.getByRole("status", {
        name: "Estado da criação do recurso",
        exact: true,
      }),
    ).toContainText("Recurso guardado");
    await audit(a, output + "/library");
    await library
      .getByRole("button", { name: "Inserir no site", exact: true })
      .click();
    await expect(library).toHaveCount(0);
    const resourceId = await studio
      .locator("[data-resource-id]")
      .getAttribute("data-resource-id");
    expect(resourceId).toMatch(/^[a-f0-9]{64}$/);
    await studio
      .getByRole("button", { name: "Guardar rascunho", exact: true })
      .click();
    await studio
      .getByRole("button", { name: "Publicar página", exact: true })
      .click();
    await expect(
      studio.getByRole("status", {
        name: "Estado da publicação do site",
        exact: true,
      }),
    ).toContainText("Página assinada");
    const visit = await siteOf(b, alice.name);
    await expect(
      visit.getByText("Ainda não guardado neste dispositivo", { exact: true }),
    ).toBeVisible();
    expect(await present(b, resourceId!)).toBe(false);
    await visit.locator(".site-resource").scrollIntoViewIfNeeded();
    await audit(b, output + "/mobile-before-choice");
    await visit
      .getByRole("button", { name: "Obter ficheiro", exact: true })
      .click();
    const link = visit.getByRole("link", { name: /Guardar ficheiro/ });
    await expect(link).toBeVisible();
    expect(await present(b, resourceId!)).toBe(true);
    const download = b.waitForEvent("download");
    await link.click();
    const received = await download;
    const path = output + "/received.txt";
    await received.saveAs(path);
    expect(readFileSync(path)).toEqual(file);
    await visit.getByRole("button", { name: "Fechar", exact: true }).click();
    await contexts[0].close();
    await b.reload();
    await b.getByLabel("Frase-passe", { exact: true }).fill(password);
    await b
      .getByRole("button", { name: "Entrar na minha rede", exact: true })
      .click();
    await expect(
      b.getByRole("heading", { name: "As tuas conversas" }),
    ).toBeVisible();
    await connect(b, c);
    const last = await siteOf(c, alice.name);
    await expect(
      last.getByText("Ainda não guardado neste dispositivo", { exact: true }),
    ).toBeVisible();
    expect(await present(c, resourceId!)).toBe(false);
    await relay(b, false);
    await last
      .getByRole("button", { name: "Obter ficheiro", exact: true })
      .click();
    await expect(
      last.getByText("À espera de uma cópia na rede", { exact: true }),
    ).toBeVisible();
    await c.waitForTimeout(2300);
    expect(await present(c, resourceId!)).toBe(false);
    await relay(b, true);
    await last
      .getByRole("button", { name: "Obter ficheiro", exact: true })
      .click();
    await expect(
      last.getByRole("link", { name: /Guardar ficheiro/ }),
    ).toBeVisible();
    await expect(last.locator(".resource-credit")).toContainText(alice.name);
    await expect(last.locator(".resource-credit [title]")).toHaveAttribute(
      "title",
      alice.id,
    );
    const finalDownload = c.waitForEvent("download");
    await last.getByRole("link", { name: /Guardar ficheiro/ }).click();
    await (await finalDownload).saveAs(output + "/seeded.txt");
    expect(readFileSync(output + "/seeded.txt")).toEqual(file);
    await last.locator(".site-resource").scrollIntoViewIfNeeded();
    await audit(c, output + "/reader-after-seeder-takeover");
    expect(errors).toEqual([]);
    writeFileSync(
      output + "/result.json",
      JSON.stringify(
        {
          status: "PASS",
          threeUIAccounts: true,
          realRTC: true,
          authorClosed: true,
          readerReloadedAndSoleSeeder: true,
          pausedSeederNegative: true,
          absentBeforeChoice: true,
          exactBytes: file.length,
          authorPreserved: true,
          scope:
            "Actual UI and desktop browsers on this host; not physical devices or radios.",
        },
        null,
        2,
      ),
    );
  } finally {
    for (const context of contexts) await context.close();
  }
});
