import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { uiHost } from "./app-host";
import { inspectOrganisedSite, organisePages } from "../site-pages-journey";
let host: Awaited<ReturnType<typeof uiHost>>;
test.beforeAll(async () => {
  host = await uiHost();
});
test.afterAll(async () => {
  await host.close();
});
const password = "frase sintética para ordenar páginas";
async function enter(page: Page, name: string) {
  await page.goto(host.url + "/browser/index.html");
  await expect(page).toHaveURL(host.url + "/browser/index.html");
  await page.getByRole("button", { name: "Começar", exact: true }).click();
  await page.getByLabel("Como te chamas?", { exact: true }).fill(name);
  await page.getByLabel("Frase-passe", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Criar identidade", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "As tuas conversas", exact: true }),
  ).toBeVisible();
}
async function connect(a: Page, b: Page) {
  for (const page of [a, b]) {
    await page.getByRole("button", { name: "A rede", exact: true }).click();
    const consent = page.getByRole("checkbox", {
      name: "Permitir retransmissão",
      exact: true,
    });
    await consent.check();
    await expect(consent).toBeChecked();
    await page
      .getByRole("button", { name: "Ligar um par", exact: true })
      .click();
  }
  await a
    .getByRole("button", { name: "Criar código de ligação", exact: true })
    .click();
  await b.getByRole("tab", { name: "Receber código", exact: true }).click();
  await b
    .getByLabel("Código de ligação recebido")
    .fill(await a.getByLabel("Código para partilhar").inputValue());
  await b.getByRole("button", { name: "Criar resposta", exact: true }).click();
  await a
    .getByLabel("Resposta do outro dispositivo")
    .fill(await b.getByLabel("Código para partilhar").inputValue());
  await a
    .getByRole("button", { name: "Concluir ligação", exact: true })
    .click();
  for (const page of [a, b]) {
    await expect(
      page.getByText("Ligação estabelecida. Já podem trocar conteúdo.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Fechar", exact: true })
      .click();
  }
}
test("web users copy pages, reorder with keyboard, reopen encrypted drafts and read the signed result after the author closes", async ({
  browser,
}, info) => {
  const ca = await browser.newContext({
    locale: "pt-PT",
    viewport: { width: 1440, height: 1000 },
  });
  const cb = await browser.newContext({
    locale: "pt-PT",
    viewport: { width: 1440, height: 1000 },
  });
  const a = await ca.newPage(),
    b = await cb.newPage(),
    owner = "Autora de páginas na web";
  const output = `.cache/page-organisation/browser-${info.project.name || "chromium"}`;
  try {
    await enter(a, owner);
    await enter(b, "Leitor do site organizado");
    await a
      .getByRole("button", { name: "A minha página", exact: true })
      .click();
    const value = await organisePages(a, output);
    await a.reload();
    await a.getByLabel("Frase-passe", { exact: true }).fill(password);
    await a
      .getByRole("button", { name: "Entrar na minha rede", exact: true })
      .click();
    await expect(
      a.getByRole("heading", { name: "As tuas conversas", exact: true }),
    ).toBeVisible();
    await a.getByRole("button", { name: "Definições", exact: true }).click();
    const card = JSON.parse(
      await a.getByLabel("Cartão público da identidade").inputValue(),
    );
    await b
      .getByRole("button", { name: "Adicionar contacto", exact: true })
      .click();
    await b.getByLabel("Cartão público do contacto").fill(JSON.stringify(card));
    await b
      .getByRole("button", { name: "Verificar e adicionar", exact: true })
      .click();
    await expect(b.getByRole("dialog")).toHaveCount(0);
    await connect(a, b);
    await a
      .getByRole("button", { name: "A minha página", exact: true })
      .click();
    const studio = a.getByRole("region", { name: "Estúdio do site" });
    await expect(
      studio.locator(".studio-pages > button").first(),
    ).toContainText("Arquivo de campo");
    await studio.getByRole("tab", { name: "Avançado", exact: true }).click();
    expect(
      JSON.parse(
        await studio
          .getByLabel("Projecto declarativo", { exact: true })
          .inputValue(),
      ).site,
    ).toEqual(value.site);
    await studio
      .getByRole("button", { name: "Publicar página", exact: true })
      .click();
    await expect(studio.getByRole("status")).toContainText("Página assinada");
    await b.getByRole("button", { name: "A praça", exact: true }).click();
    await expect(
      b.getByRole("button", { name: "Ver página de " + owner, exact: true }),
    ).toBeVisible();
    await ca.close();
    await inspectOrganisedSite(b, owner);
    mkdirSync(output, { recursive: true });
    writeFileSync(
      output + "/report.json",
      JSON.stringify(
        {
          status: "PASS",
          applicationURL: host.url,
          pages: 3,
          encryptedDraftReloaded: true,
          authorClosed: true,
          copiedSelfLinkVerified: true,
          originalPageUnchanged: true,
          homePreserved: true,
          realWebRTC: true,
          physicalDevices: false,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await ca.close();
    await cb.close();
  }
});
