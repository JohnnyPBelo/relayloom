import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { appHost } from "./app-host";
let host: Awaited<ReturnType<typeof appHost>>;
test.beforeAll(async () => {
  host = await appHost();
});
test.afterAll(async () => {
  await host.close();
});
const pass = "private multilingual site test passphrase";
const en = {
  start: "Get started",
  name: "What is your name?",
  pass: "Passphrase",
  create: "Create identity",
  heading: "Your conversations",
  settings: "Settings",
  card: "Public identity card",
  conversations: "Conversations",
  add: "Add contact",
  cardInput: "Contact's public card",
  verify: "Verify and add",
  network: "Network",
  connect: "Connect a peer",
  createCode: "Create connection code",
  receive: "Receive code",
  received: "Received connection code",
  reply: "Create reply",
  share: "Code to share",
  answer: "Other device's reply",
  complete: "Complete connection",
  connected: "Connection established. You can now exchange content.",
  close: "Close",
};
const es = {
  start: "Empezar",
  name: "¿Cómo te llamas?",
  pass: "Frase de contraseña",
  create: "Crear identidad",
  heading: "Tus conversaciones",
  settings: "Ajustes",
  card: "Tarjeta pública de identidad",
  conversations: "Conversaciones",
  add: "Añadir contacto",
  cardInput: "Tarjeta pública del contacto",
  verify: "Verificar y añadir",
  network: "La red",
  connect: "Conectar un par",
  createCode: "Crear código de conexión",
  receive: "Recibir código",
  received: "Código de conexión recibido",
  reply: "Crear respuesta",
  share: "Código para compartir",
  answer: "Respuesta del otro dispositivo",
  complete: "Completar conexión",
  connected: "Conexión establecida. Ya podéis intercambiar contenido.",
  close: "Cerrar",
};
async function enter(p: Page, name: string, w: typeof en) {
  await p.goto(host.url + "/browser/index.html");
  await p.getByRole("button", { name: w.start, exact: true }).click();
  await p.getByLabel(w.name, { exact: true }).fill(name);
  await p.getByLabel(w.pass, { exact: true }).fill(pass);
  await p.getByRole("button", { name: w.create, exact: true }).click();
  await expect(
    p.getByRole("heading", { name: w.heading, exact: true }),
  ).toBeVisible();
}
async function nav(p: Page, name: string) {
  const button = p
    .locator("#primary-sidebar")
    .getByRole("button", { name, exact: true });
  await button.click();
}
async function contact(p: Page, card: string, w: typeof en) {
  await nav(p, w.conversations);
  await p.getByRole("button", { name: w.add, exact: true }).click();
  await p.getByLabel(w.cardInput, { exact: true }).fill(card);
  await p.getByRole("button", { name: w.verify, exact: true }).click();
  await expect(p.getByRole("dialog")).toHaveCount(0);
}
async function connect(a: Page, b: Page, aw: typeof en, bw: typeof en) {
  for (const [p, w] of [
    [a, aw],
    [b, bw],
  ] as const) {
    await nav(p, w.network);
    await p.getByRole("button", { name: w.connect, exact: true }).click();
  }
  await a.getByRole("button", { name: aw.createCode, exact: true }).click();
  await b.getByRole("tab", { name: bw.receive, exact: true }).click();
  await b
    .getByLabel(bw.received, { exact: true })
    .fill(await a.getByLabel(aw.share, { exact: true }).inputValue());
  await b.getByRole("button", { name: bw.reply, exact: true }).click();
  await a
    .getByLabel(aw.answer, { exact: true })
    .fill(await b.getByLabel(bw.share, { exact: true }).inputValue());
  await a.getByRole("button", { name: aw.complete, exact: true }).click();
  for (const [p, w] of [
    [a, aw],
    [b, bw],
  ] as const) {
    await expect(p.getByText(w.connected, { exact: true })).toBeVisible();
    await p
      .getByRole("dialog")
      .getByRole("button", { name: w.close, exact: true })
      .click();
  }
}

test("three multilingual identities edit signed pages, preserve original text and seed to a new reader after author closes", async ({
  browser,
}, info) => {
  const ca = await browser.newContext({
      locale: "en-GB",
      viewport: { width: 1440, height: 1000 },
    }),
    cb = await browser.newContext({
      locale: "es-ES",
      viewport: { width: 1440, height: 1000 },
    }),
    cc = await browser.newContext({
      locale: "es-ES",
      viewport: { width: 1440, height: 1000 },
    });
  const a = await ca.newPage(),
    b = await cb.newPage(),
    c = await cc.newPage();
  const output = `.cache/onboarding-i18n/sites-${info.project.name || "chromium"}`;
  mkdirSync(output, { recursive: true });
  try {
    await enter(a, "Autor original", en);
    await enter(b, "Leitor intermédio", es);
    await nav(a, en.settings);
    const card = await a.getByLabel(en.card, { exact: true }).inputValue();
    await contact(b, card, es);
    await nav(a, "My site");
    let studio = a.getByRole("region", { name: "Site studio", exact: true });
    await studio.getByRole("tab", { name: "Templates", exact: true }).click();
    await studio.getByRole("button", { name: /Visual portfolio/ }).click();
    await expect(
      studio.getByRole("heading", { name: "Pages", exact: true }),
    ).toBeVisible();
    await expect(studio.getByLabel("Page name", { exact: true })).toHaveValue(
      "Home",
    );
    await expect(
      studio.getByLabel("Block 1 title", { exact: true }),
    ).toHaveValue("Ideas taking shape.");
    await studio.getByLabel("Block 1 title", { exact: true }).fill("Guardar");
    const gallery = studio.locator(".studio-stage .gallery.editable");
    await gallery.locator("input").first().click();
    await studio
      .getByLabel("Add images to the site", { exact: true })
      .setInputFiles({
        name: "original.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQqCr4DwAD0gIKZKEF0gAAAABJRU5ErkJggg==",
          "base64",
        ),
      });
    await studio
      .getByLabel("Image description 1", { exact: true })
      .fill("Descrição da imagem");
    await studio
      .getByRole("button", { name: "Close block properties", exact: true })
      .click();
    await studio
      .getByRole("button", { name: "Add a page to the site", exact: true })
      .click();
    await studio.getByLabel("Page name", { exact: true }).fill("Arquivo");
    await studio.getByLabel("Page address", { exact: true }).fill("arquivo");
    await expect(
      studio.getByLabel("Block 1 title", { exact: true }),
    ).toHaveValue("A place for your ideas.");
    await studio
      .getByLabel("Block 1 title", { exact: true })
      .fill("Definições");
    await studio
      .getByLabel("Block 1 text", { exact: true })
      .fill("Conteúdo escrito pelo autor; não é texto da interface.");
    await studio.getByRole("tab", { name: "Advanced", exact: true }).click();
    const exported = JSON.parse(
      await studio
        .getByLabel("Declarative project", { exact: true })
        .inputValue(),
    );
    expect(exported.site.pages).toHaveLength(3);
    exported.site.script = "not permitted";
    await studio
      .getByLabel("Declarative project", { exact: true })
      .fill(JSON.stringify(exported));
    await studio
      .getByRole("button", { name: "Validate and apply", exact: true })
      .click();
    await expect(studio.getByRole("alert")).toContainText("Invalid site:");
    await expect(
      studio.getByLabel("Block 1 title", { exact: true }),
    ).toHaveValue("Definições");
    await nav(a, en.settings);
    await a
      .getByLabel("Application language", { exact: true })
      .selectOption("es-ES");
    await nav(a, "Mi sitio");
    studio = a.getByRole("region", { name: "Estudio del sitio", exact: true });
    await studio
      .locator(".studio-pages")
      .getByRole("button", { name: /Arquivo/ })
      .click();
    await expect(
      studio.getByLabel("Título del bloque 1", { exact: true }),
    ).toHaveValue("Definições");
    await expect(
      studio.getByLabel("Texto del bloque 1", { exact: true }),
    ).toHaveValue("Conteúdo escrito pelo autor; não é texto da interface.");
    await studio.getByRole("tab", { name: "Bloques", exact: true }).click();
    for (const width of [1440, 720, 390]) {
      await a.setViewportSize({ width, height: 900 });
      expect(
        await a.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const clipped = await studio
        .locator(".studio-palette > button")
        .evaluateAll((buttons) =>
          buttons
            .filter((b) => b.scrollWidth > b.clientWidth + 1)
            .map((b) => b.textContent),
        );
      expect(clipped, "Spanish palette labels fit at " + width).toEqual([]);
      const review = await new AxeBuilder({ page: a })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(review.violations).toEqual([]);
      await a.screenshot({
        path: output + `/spanish-editor-${width}.png`,
        fullPage: true,
      });
    }
    await a.setViewportSize({ width: 1440, height: 1000 });
    await studio
      .getByRole("button", { name: "Guardar borrador", exact: true })
      .click();
    await expect(studio.getByRole("status")).toContainText("Borrador cifrado");
    await connect(a, b, es, es);
    await nav(a, "Mi sitio");
    await studio
      .getByRole("button", { name: "Publicar página", exact: true })
      .click();
    await expect(studio.getByRole("status")).toContainText("Página firmada");
    await nav(b, "La plaza");
    await expect(
      b.getByRole("button", {
        name: "Ver sitio de Autor original",
        exact: true,
      }),
    ).toBeVisible();
    await ca.close();
    await b
      .getByRole("button", { name: "Ver sitio de Autor original", exact: true })
      .click();
    let dialog = b.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Guardar", exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("img", { name: "Descrição da imagem", exact: true })
      .scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        dialog
          .getByRole("img", {
            name: "Descrição da imagem",
            exact: true,
          })
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBe(1);
    await dialog
      .getByRole("navigation", { name: "Páginas del sitio", exact: true })
      .getByRole("button", { name: "Arquivo", exact: true })
      .click();
    await expect(
      dialog.getByRole("heading", { name: "Definições", exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
    await enter(c, "Leitor novo", es);
    await contact(c, card, es);
    await nav(c, es.network);
    await c
      .getByRole("region", { name: "Ayudar a la red", exact: true })
      .getByRole("checkbox", { name: "Permitir retransmisión", exact: true })
      .check();
    await connect(b, c, es, es);
    await nav(c, "La plaza");
    await nav(b, es.network);
    const relay = b
      .getByRole("region", { name: "Ayudar a la red", exact: true })
      .getByRole("checkbox", { name: "Permitir retransmisión", exact: true });
    await expect(relay).not.toBeChecked();
    for (let i = 0; i < 3; i++) {
      await new Promise((done) => setTimeout(done, 700));
      await expect(
        c.getByRole("button", {
          name: "Ver sitio de Autor original",
          exact: true,
        }),
      ).toHaveCount(0);
    }
    await relay.check();
    await c
      .getByRole("button", { name: "Ver sitio de Autor original", exact: true })
      .click();
    dialog = c.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Guardar", exact: true }),
    ).toBeVisible();
    const seededImage = dialog.getByRole("img", {
      name: "Descrição da imagem",
      exact: true,
    });
    await seededImage.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        seededImage.evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBe(1);
    await dialog
      .getByRole("navigation", { name: "Páginas del sitio", exact: true })
      .getByRole("button", { name: "Arquivo", exact: true })
      .click();
    await expect(
      dialog.getByRole("heading", { name: "Definições", exact: true }),
    ).toBeVisible();
    await expect(dialog).toContainText(
      "Conteúdo escrito pelo autor; não é texto da interface.",
    );
    expect(a.isClosed()).toBe(true);
    const axe = await new AxeBuilder({ page: c })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    await c.screenshot({ path: output + "/third-reader.png", fullPage: true });
    writeFileSync(
      output + "/report.json",
      JSON.stringify(
        {
          status: "PASS",
          pages: 3,
          invalidImportRejected: true,
          languages: ["en-GB", "es-ES"],
          authorClosed: true,
          pausedSeederNegative: true,
          consentingSeederPositive: true,
          authoredTextPreserved: true,
          decodedImage: true,
          axeViolations: axe.violations,
          physicalDevices: false,
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
