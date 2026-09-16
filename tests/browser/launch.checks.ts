import { test, expect, chromium, firefox, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { appHost } from "./app-host";

const passphrase = "frase sintética do teste público RelayLoom";
async function nav(page: Page, name: string) {
  const target = page.getByRole("button", { name, exact: true });
  if (!(await target.isVisible()))
    await page
      .getByRole("button", { name: "Abrir navegação", exact: true })
      .click();
  await target.click();
}
async function enter(page: Page, url: string, name: string) {
  await page.goto(url + "/browser/index.html");
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
  return page.getByLabel("Cartão público da identidade").inputValue();
}
async function contact(page: Page, value: string) {
  await nav(page, "Conversas");
  await page
    .getByRole("button", { name: "Adicionar contacto", exact: true })
    .click();
  await page.getByLabel("Cartão público do contacto").fill(value);
  await page.getByRole("button", { name: "Verificar e adicionar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function network(page: Page) {
  await nav(page, "A rede");
  await page.getByRole("button", { name: "Ligar um par", exact: true }).click();
}
async function send(page: Page, text: string) {
  await page.getByLabel("Escrever mensagem").fill(text);
  await page
    .getByRole("button", { name: "Enviar mensagem", exact: true })
    .click();
}

test("two independent Chromium and Firefox processes exchange UI messages and exact attachment bytes, then reopen offline", async () => {
  const remote =
    process.env.RELAYLOOM_LAUNCH_URL?.replace(/\/$/, "") || undefined;
  if (remote && !remote.startsWith("https://"))
    throw new Error(
      "A public launch requires HTTPS, without certificate overrides",
    );
  const host = remote ? undefined : await appHost(),
    url = remote ?? host!.url;
  const scope = remote ? "published-https" : "local-subpath";
  const directory = `.cache/public-web/${scope}`;
  mkdirSync(directory, { recursive: true });
  const aBrowser = await chromium.launch({ chromiumSandbox: true });
  let bBrowser: Awaited<ReturnType<typeof firefox.launch>> | undefined;
  const errors: string[] = [],
    requests: { method: string; url: string }[] = [];
  try {
    bBrowser = await firefox.launch();
    const ca = await aBrowser.newContext({ locale: "pt-PT",
      viewport: { width: 1440, height: 1000 },
    });
    const cb = await bBrowser.newContext({ locale: "pt-PT",
      viewport: { width: 390, height: 844 },
    });
    for (const context of [ca, cb])
      context.on("request", (request) =>
        requests.push({ method: request.method(), url: request.url() }),
      );
    const a = await ca.newPage(),
      b = await cb.newPage();
    for (const p of [a, b]) p.on("pageerror", (e) => errors.push(e.message));
    await enter(a, url, "Alice teste web");
    await enter(b, url, "Bruno teste web");
    const alice = await card(a),
      bruno = await card(b);
    expect(JSON.parse(alice).id).not.toBe(JSON.parse(bruno).id);
    await contact(a, bruno);
    await contact(b, alice);
    await a.getByRole("button", { name: "Nova conversa", exact: true }).click();
    await a
      .getByRole("dialog")
      .getByRole("button", { name: /Bruno teste web/ })
      .click();
    const message =
      "Olá do primeiro dispositivo. O conteúdo segue entre pares.";
    const bytes = Buffer.from(
      "Ficheiro sintético RelayLoom. Água, abrigo e comunicação.\n".repeat(
        1024,
      ),
    );
    await a.locator('input[type="file"]').setInputFiles({
      name: "teste-relayloom.txt",
      mimeType: "text/plain",
      buffer: bytes,
    });
    await send(a, message);
    await expect(
      a.getByRole("button", { name: "Estado do envio: Em espera" }),
    ).toBeVisible();
    // Negative control: distribution over HTTPS alone supplies no peer path.
    await expect(
      b.getByRole("button", { name: /Alice teste web.*Olá do primeiro/ }),
    ).toHaveCount(0);
    await network(a);
    await a.getByRole("button", { name: "Criar código de ligação" }).click();
    const offer = await a.getByLabel("Código para partilhar").inputValue();
    await network(b);
    await b.getByRole("tab", { name: "Receber código" }).click();
    await b.getByLabel("Código de ligação recebido").fill(offer);
    await b
      .getByRole("button", { name: "Criar resposta", exact: true })
      .click();
    const answer = await b.getByLabel("Código para partilhar").inputValue();
    await a.getByLabel("Resposta do outro dispositivo").fill(answer);
    await a.getByRole("button", { name: "Concluir ligação" }).click();
    await expect(
      a.getByText("Ligação estabelecida. Já podem trocar conteúdo."),
    ).toBeVisible();
    for (const p of [a, b])
      await p
        .getByRole("dialog")
        .getByRole("button", { name: "Fechar", exact: true })
        .click();
    await nav(b, "Conversas");
    await b
      .getByRole("button", { name: /Alice teste web.*Olá do primeiro/ })
      .click();
    await expect(
      b.locator(".bubble").getByText(message, { exact: true }),
    ).toBeVisible();
    const link = b.getByRole("link", { name: "teste-relayloom.txt" });
    await expect(link).toHaveAttribute("href", /^blob:/);
    const downloaded = b.waitForEvent("download");
    await link.click();
    const stream = await (await downloaded).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).equals(bytes)).toBe(true);
    await send(b, "Recebido. A resposta também chega cifrada.");
    await nav(a, "Conversas");
    await expect(
      a
        .locator(".bubble")
        .getByText("Recebido. A resposta também chega cifrada.", {
          exact: true,
        }),
    ).toBeVisible();
    await expect(
      a.getByRole("button", { name: "Estado do envio: Lida", exact: true }),
    ).toBeVisible();
    for (const [page, name] of [
      [a, "desktop"],
      [b, "compact"],
    ] as const) {
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      writeFileSync(
        `${directory}/${name}-axe.json`,
        JSON.stringify(
          { violations: audit.violations, passes: audit.passes.length },
          null,
          2,
        ),
      );
      expect(audit.violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `${directory}/${name}.png`,
        fullPage: true,
      });
    }
    await expect(b.locator("html")).toHaveAttribute(
      "data-offline-assets",
      "ready",
    );
    await ca.close();
    await cb.setOffline(true);
    await b.reload();
    await expect(
      b.getByRole("heading", { name: "Bom ter-te de volta." }),
    ).toBeVisible();
    await b.getByLabel("Frase-passe", { exact: true }).fill(passphrase);
    await b.getByRole("button", { name: "Entrar na minha rede" }).click();
    await b.getByRole("button", { name: /Alice teste web.*Recebido/ }).click();
    await expect(
      b.locator(".bubble").getByText(message, { exact: true }),
    ).toBeVisible();
    await expect(
      b.getByRole("link", { name: "teste-relayloom.txt" }),
    ).toHaveAttribute("href", /^blob:/);
    expect(errors).toEqual([]);
    expect(
      requests.every(
        (r) =>
          r.method === "GET" &&
          r.url.startsWith(url + "/") &&
          !r.url.includes("/api/"),
      ),
    ).toBe(true);
    writeFileSync(
      `${directory}/report.json`,
      JSON.stringify(
        {
          status: "PASS",
          date: new Date().toISOString(),
          url,
          scope,
          engines: {
            chromium: aBrowser.version(),
            firefox: bBrowser.version(),
          },
          separateBrowserProcesses: true,
          physicalDevices: false,
          daemon: false,
          messagesBothDirections: true,
          readReceipt: true,
          exactAttachmentBytes: bytes.length,
          authorClosedAndReaderOfflineReload: true,
          requests,
          errors,
        },
        null,
        2,
      ),
    );
  } finally {
    await bBrowser?.close();
    await aBrowser.close();
    await host?.close();
  }
});
