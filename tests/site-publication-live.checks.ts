import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const passphrase = "verified live site fixture passphrase";
async function nav(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  if (!(await button.isVisible()))
    await page
      .getByRole("button", { name: "Abrir navegação", exact: true })
      .click();
  await button.click();
}
async function enter(page: Page, base: string, name: string) {
  await page.goto(base + "/browser/index.html");
  expect(page.url()).toBe(base + "/browser/index.html");
  expect(await page.evaluate(() => isSecureContext)).toBe(true);
  await page.getByRole("button", { name: "Começar", exact: true }).click();
  await page.getByLabel("Como te chamas?").fill(name);
  await page.getByLabel("Frase-passe", { exact: true }).fill(passphrase);
  await page
    .getByRole("button", { name: "Criar identidade", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "As tuas conversas" }),
  ).toBeVisible();
}
async function card(page: Page) {
  await nav(page, "Definições");
  return await page.getByLabel("Cartão público da identidade").inputValue();
}
async function contact(page: Page, card: string) {
  await nav(page, "Conversas");
  await page
    .getByRole("button", { name: "Adicionar contacto", exact: true })
    .click();
  await page.getByLabel("Cartão público do contacto").fill(card);
  await page.getByRole("button", { name: "Verificar e adicionar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function pair(a: Page, b: Page) {
  for (const page of [a, b]) {
    await nav(page, "A rede");
    await page
      .getByRole("button", { name: "Ligar um par", exact: true })
      .click();
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
  for (const page of [a, b])
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Fechar", exact: true })
      .click();
}
const studio = (page: Page) =>
  page.getByRole("region", { name: "Estúdio do site", exact: true });
async function publish(page: Page, title: string) {
  await studio(page)
    .getByLabel("Título do bloco 1", { exact: true })
    .fill(title);
  await studio(page)
    .getByRole("button", { name: "Publicar página", exact: true })
    .click();
  await expect(
    studio(page).getByRole("status", {
      name: "Estado da publicação do site",
      exact: true,
    }),
  ).toContainText("Página assinada");
}

test("published HTTPS artifact exposes versioned studio, fixed history and a consenting seeder after the author closes", async ({
  browser,
}, info) => {
  const url = new URL(process.env.RELAYLOOM_SITE_LIVE_URL ?? "");
  const expected = process.env.RELAYLOOM_EXPECTED_WEB_SOURCE ?? "";
  if (
    url.protocol !== "https:" ||
    url.hostname !== "johnnypbelo.github.io" ||
    url.pathname.replace(/\/$/, "") !== "/relayloom" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^[a-f0-9]{40}$/.test(expected)
  )
    throw Error(
      "Choose the exact published RelayLoom HTTPS URL and 40-character source commit",
    );
  const base = url.href.replace(/\/$/, ""),
    releaseResponse = await fetch(base + "/release.json", {
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(10000),
    });
  expect(releaseResponse.ok).toBe(true);
  const release = await releaseResponse.json();
  expect(release.sourceCommit).toBe(expected);
  const ca = await browser.newContext({ locale: "pt-PT" }),
    cb = await browser.newContext({
      locale: "pt-PT",
      viewport: { width: 390, height: 844 },
    }),
    cc = await browser.newContext({ locale: "pt-PT" });
  const [a, b, c] = await Promise.all([
    ca.newPage(),
    cb.newPage(),
    cc.newPage(),
  ]);
  const requests: { method: string; url: string }[] = [];
  for (const context of [ca, cb, cc])
    context.on("request", (r) =>
      requests.push({ method: r.method(), url: r.url() }),
    );
  const output = ".cache/site-editor/live/" + (info.project.name || "chromium");
  mkdirSync(output, { recursive: true });
  try {
    await enter(a, base, "Autora HTTPS");
    await enter(b, base, "Leitor HTTPS");
    const alice = await card(a),
      bob = await card(b);
    await contact(a, bob);
    await contact(b, alice);
    await pair(a, b);
    await nav(b, "A rede");
    await b
      .getByRole("region", { name: "Ajudar a rede", exact: true })
      .getByRole("checkbox", { name: "Permitir retransmissão", exact: true })
      .check();
    await nav(a, "A minha página");
    const address = await studio(a)
      .getByLabel("Endereço permanente do site", { exact: true })
      .inputValue();
    expect(address).toBe("relayloom:site:" + JSON.parse(alice).id + "/profile");
    await publish(a, "Primeira edição no HTTPS");
    await nav(b, "A praça");
    await b
      .getByRole("button", { name: "Ver página de Autora HTTPS", exact: true })
      .click();
    await expect(
      b
        .getByRole("dialog")
        .getByRole("heading", {
          name: "Primeira edição no HTTPS",
          exact: true,
        }),
    ).toBeVisible();
    await publish(a, "Segunda edição no HTTPS");
    await expect(
      b
        .getByRole("dialog")
        .getByRole("heading", { name: "Segunda edição no HTTPS", exact: true }),
    ).toBeVisible();
    await b
      .getByRole("dialog")
      .getByRole("button", { name: "Ver histórico", exact: true })
      .click();
    await expect(
      b.getByRole("dialog").getByRole("button", { name: /^Ver versão \d+:/ }),
    ).toHaveCount(2);
    await b
      .getByRole("dialog")
      .getByRole("button", { name: /^Ver versão 1:/ })
      .click();
    await expect(
      b
        .getByRole("dialog")
        .getByRole("heading", {
          name: "Primeira edição no HTTPS",
          exact: true,
        }),
    ).toBeVisible();
    await b
      .getByRole("dialog")
      .getByRole("button", { name: "Ver versão actual", exact: true })
      .click();
    await expect(
      b
        .getByRole("dialog")
        .getByRole("heading", { name: "Segunda edição no HTTPS", exact: true }),
    ).toBeVisible();
    await ca.close();
    expect(a.isClosed()).toBe(true);
    await b
      .getByRole("dialog")
      .getByRole("button", { name: "Fechar", exact: true })
      .click();
    await enter(c, base, "Novo leitor HTTPS");
    await contact(c, alice);
    await pair(b, c);
    await nav(c, "A praça");
    await c
      .getByRole("button", { name: "Ver página de Autora HTTPS", exact: true })
      .click();
    await expect(
      c
        .getByRole("dialog")
        .getByRole("heading", { name: "Segunda edição no HTTPS", exact: true }),
    ).toBeVisible();
    await expect(
      c.getByRole("dialog").getByRole("button", { name: /Recuperar versão/ }),
    ).toHaveCount(0);
    const audit = await new AxeBuilder({ page: c })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
    await c.screenshot({ path: output + "/seeded-site.png", fullPage: true });
    await b.screenshot({ path: output + "/seeder.png", fullPage: true });
    expect(
      requests.some((r) => new URL(r.url).pathname.includes("/api/")),
    ).toBe(false);
    expect(
      requests
        .filter((r) => r.url.startsWith("http"))
        .every((r) => new URL(r.url).origin === url.origin),
    ).toBe(true);
    writeFileSync(
      output + "/report.json",
      JSON.stringify(
        {
          status: "PASS",
          url: base,
          sourceCommit: expected,
          engine: info.project.name || "chromium",
          autonomous: true,
          contexts: 3,
          physicalDevices: false,
          stableAddress: true,
          fixedHistory: true,
          authorClosed: true,
          seederTakeover: true,
          readerDidNotGainEditControls: true,
          apiRequests: 0,
          externalRuntimeRequests: 0,
          axe: { violations: audit.violations, passed: audit.passes.length },
        },
        null,
        2,
      ),
    );
  } finally {
    await ca.close();
    await cb.close();
    await cc.close();
  }
});
