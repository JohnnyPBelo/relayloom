import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { uiHost } from "./app-host";
let host: Awaited<ReturnType<typeof uiHost>>;
test.beforeAll(async () => {
  host = await uiHost();
});
test.afterAll(async () => {
  await host.close();
});

test("initial language, product guide and appearance work without altering identity form values", async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    locale: "en-GB",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const directory = `.cache/onboarding-i18n/${info.project.name || "chromium"}`;
  mkdirSync(directory, { recursive: true });
  try {
    await page.goto(host.url + "/browser/index.html");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    await expect(
      page.getByRole("heading", { name: "Your place in the network." }),
    ).toBeVisible();
    const guide = page.getByRole("region", { name: "How RelayLoom works" });
    await guide.getByRole("button", { name: "Sites", exact: true }).click();
    await expect(guide).toContainText("without gaining permission to edit it");
    await page.screenshot({
      path: `${directory}/intro-en-desktop.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const startButton = await page
      .getByRole("button", { name: "Get started", exact: true })
      .boundingBox();
    expect(startButton).not.toBeNull();
    expect(startButton!.y + startButton!.height).toBeLessThanOrEqual(844);
    await page.screenshot({
      path: `${directory}/intro-en-mobile.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .getByRole("button", { name: "Get started", exact: true })
      .click();
    await page.getByLabel("What is your name?").fill("Guardar — Alice");
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("private onboarding test passphrase");
    await page.getByRole("button", { name: "Dark", exact: true }).click();
    await page.getByLabel("Larger text", { exact: true }).check();
    await page.getByLabel("High contrast", { exact: true }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute(
      "data-readability",
      "large",
    );
    await expect(page.locator("html")).toHaveAttribute("data-contrast", "high");
    await page.getByLabel("Application language").selectOption("es-ES");
    await expect(page.getByLabel("¿Cómo te llamas?")).toHaveValue(
      "Guardar — Alice",
    );
    await expect(
      page.getByLabel("Frase de contraseña", { exact: true }),
    ).toHaveValue("private onboarding test passphrase");
    await page
      .getByRole("button", { name: "Volver a la presentación", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Cómo funciona RelayLoom" }),
    ).toContainText("sin obtener permiso para editarla");
    await page.getByRole("button", { name: "Empezar", exact: true }).click();
    await expect(page.getByLabel("¿Cómo te llamas?")).toHaveValue(
      "Guardar — Alice",
    );
    await expect(
      page.getByLabel("Frase de contraseña", { exact: true }),
    ).toHaveValue("private onboarding test passphrase");
    for (const width of [1440, 900, 720, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `${directory}/setup-es-${width}.png`,
        fullPage: true,
      });
    }
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    writeFileSync(
      `${directory}/setup-axe.json`,
      JSON.stringify(
        { violations: audit.violations, passes: audit.passes.length },
        null,
        2,
      ),
    );
    expect(audit.violations).toEqual([]);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "es-ES");
    await page.getByRole("button", { name: "Empezar", exact: true }).click();
    await expect(page.getByLabel("¿Cómo te llamas?")).toHaveValue("");
    await expect(
      page.getByLabel("Frase de contraseña", { exact: true }),
    ).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "Oscuro", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByLabel("Texto más grande", { exact: true }),
    ).toBeChecked();
    await expect(
      page.getByLabel("Alto contraste", { exact: true }),
    ).toBeChecked();
    await page.getByLabel("Idioma de la aplicación").selectOption("pt-PT");
    await expect(
      page.getByRole("button", { name: "Criar identidade", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("English and Spanish identities exchange encrypted messages and files without translating authored text", async ({
  browser,
}, info) => {
  const aContext = await browser.newContext({
    locale: "en-GB",
    viewport: { width: 1440, height: 1000 },
  });
  const bContext = await browser.newContext({
    locale: "es-ES",
    viewport: { width: 1440, height: 1000 },
  });
  const a = await aContext.newPage(),
    b = await bContext.newPage();
  const phrase = "private cross-language test passphrase";
  const en = {
    start: "Get started",
    name: "What is your name?",
    pass: "Passphrase",
    create: "Create identity",
    heading: "Your conversations",
    settings: "Settings",
    card: "Public identity card",
    add: "Add contact",
    cardInput: "Contact's public card",
    verify: "Verify and add",
    conversations: "Conversations",
    network: "Network",
    connect: "Connect a peer",
    close: "Close",
    write: "Write a message",
    send: "Send message",
  };
  const es = {
    start: "Empezar",
    name: "¿Cómo te llamas?",
    pass: "Frase de contraseña",
    create: "Crear identidad",
    heading: "Tus conversaciones",
    settings: "Ajustes",
    card: "Tarjeta pública de identidad",
    add: "Añadir contacto",
    cardInput: "Tarjeta pública del contacto",
    verify: "Verificar y añadir",
    conversations: "Conversaciones",
    network: "La red",
    connect: "Conectar un par",
    close: "Cerrar",
    write: "Escribir mensaje",
    send: "Enviar mensaje",
  };
  const enter = async (page: typeof a, words: typeof en, name: string) => {
    await page.goto(host.url + "/browser/index.html");
    await expect(page).toHaveURL(host.url + "/browser/index.html");
    await page.getByRole("button", { name: words.start, exact: true }).click();
    await page.getByLabel(words.name, { exact: true }).fill(name);
    await page.getByLabel(words.pass, { exact: true }).fill(phrase);
    await page.getByRole("button", { name: words.create, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: words.heading, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: words.settings, exact: true })
      .click();
    return page.getByLabel(words.card, { exact: true }).inputValue();
  };
  try {
    const alice = await enter(a, en, "Guardar"),
      bruno = await enter(b, es, "Definições");
    for (const [page, words, card] of [
      [a, en, bruno],
      [b, es, alice],
    ] as const) {
      await page
        .getByRole("button", { name: words.conversations, exact: true })
        .click();
      await page.getByRole("button", { name: words.add, exact: true }).click();
      await page.getByLabel(words.cardInput, { exact: true }).fill(card);
      await page
        .getByRole("button", { name: words.verify, exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    await a.locator(".conversation").filter({ hasText: "Definições" }).click();
    await a.getByLabel(en.write, { exact: true }).fill("Conversas");
    await a.getByRole("button", { name: en.send, exact: true }).click();
    await expect(
      a.getByRole("button", { name: "Sending status: Pending", exact: true }),
    ).toBeVisible();
    for (const [page, words] of [
      [a, en],
      [b, es],
    ] as const) {
      await page
        .getByRole("button", { name: words.network, exact: true })
        .click();
      await page
        .getByRole("button", { name: words.connect, exact: true })
        .click();
    }
    await a
      .getByRole("button", { name: "Create connection code", exact: true })
      .click();
    await b.getByRole("tab", { name: "Recibir código", exact: true }).click();
    await b
      .getByLabel("Código de conexión recibido")
      .fill(await a.getByLabel("Code to share").inputValue());
    await b
      .getByRole("button", { name: "Crear respuesta", exact: true })
      .click();
    await a
      .getByLabel("Other device's reply")
      .fill(await b.getByLabel("Código para compartir").inputValue());
    await a
      .getByRole("button", { name: "Complete connection", exact: true })
      .click();
    await expect(
      a.getByText("Connection established. You can now exchange content.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      b.getByText("Conexión establecida. Ya podéis intercambiar contenido.", {
        exact: true,
      }),
    ).toBeVisible();
    for (const [page, words] of [
      [a, en],
      [b, es],
    ] as const) {
      await page
        .getByRole("dialog")
        .getByRole("button", { name: words.close, exact: true })
        .click();
      await page
        .getByRole("button", { name: words.conversations, exact: true })
        .click();
    }
    await b.locator(".conversation").filter({ hasText: "Guardar" }).click();
    await expect(
      b.locator(".bubble").getByText("Conversas", { exact: true }),
    ).toHaveCount(1);
    const bytes = Buffer.from(
      "As palavras Guardar e Definições pertencem ao autor.\n".repeat(30),
    );
    await a.locator(".composer input[type=file]").setInputFiles({
      name: "idiomas.txt",
      mimeType: "text/plain",
      buffer: bytes,
    });
    await a
      .getByLabel(en.write, { exact: true })
      .fill("Nome original do ficheiro");
    await a.getByRole("button", { name: en.send, exact: true }).click();
    const downloadPromise = b.waitForEvent("download");
    await b.getByRole("link", { name: "idiomas.txt", exact: true }).click();
    const stream = await (await downloadPromise).createReadStream(),
      chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(bytes);
    await b
      .getByLabel(es.write, { exact: true })
      .fill("Resposta em português, mesmo com a interface em espanhol.");
    await b.getByRole("button", { name: es.send, exact: true }).click();
    await expect(
      a
        .locator(".bubble")
        .getByText(
          "Resposta em português, mesmo com a interface em espanhol.",
          { exact: true },
        ),
    ).toBeVisible();
    await a
      .getByLabel(en.write, { exact: true })
      .fill("Rascunho Guardar intacto");
    await a.getByRole("button", { name: en.settings, exact: true }).click();
    await a.getByLabel("Application language").selectOption("es-ES");
    await a
      .getByRole("button", { name: es.conversations, exact: true })
      .click();
    await expect(a.getByLabel(es.write, { exact: true })).toHaveValue(
      "Rascunho Guardar intacto",
    );
    await expect(
      a.locator(".conversation").filter({ hasText: "Definições" }),
    ).toHaveCount(1);
    await b.getByRole("button", { name: es.settings, exact: true }).click();
    await b.getByLabel("Idioma de la aplicación").selectOption("en-GB");
    await b.reload();
    await b.getByLabel(en.pass, { exact: true }).fill(phrase);
    await b
      .getByRole("button", { name: "Enter my network", exact: true })
      .click();
    await expect(
      b.getByRole("heading", { name: en.heading, exact: true }),
    ).toBeVisible();
    await b.locator(".conversation").filter({ hasText: "Guardar" }).click();
    await expect(
      b.locator(".bubble").getByText("Conversas", { exact: true }),
    ).toHaveCount(1);
    await expect(
      b.getByRole("link", { name: "idiomas.txt", exact: true }),
    ).toHaveAttribute("href", /^blob:/);
    const directory = `.cache/onboarding-i18n/${info.project.name || "chromium"}`;
    mkdirSync(directory, { recursive: true });
    await b.screenshot({
      path: directory + "/messages-original-text.png",
      fullPage: true,
    });
    writeFileSync(
      directory + "/two-identities.json",
      JSON.stringify(
        {
          status: "PASS",
          applicationURL: host.url,
          languages: ["en-GB", "es-ES"],
          transport: "real WebRTC",
          authoredTextUnchanged: true,
          draftUnchanged: true,
          attachmentBytes: bytes.length,
          reload: true,
          physicalDevices: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await aContext.close();
    await bContext.close();
  }
});

test("a blocked tab can change UI language while the owning identity remains intact", async ({
  browser,
}) => {
  const context = await browser.newContext({
      locale: "en-GB",
      viewport: { width: 1440, height: 1000 },
    }),
    owner = await context.newPage();
  const phrase = "private profile ownership language passphrase";
  try {
    await owner.goto(host.url + "/browser/index.html");
    await owner
      .getByRole("button", { name: "Get started", exact: true })
      .click();
    await owner
      .getByLabel("What is your name?", { exact: true })
      .fill("Identidade original");
    await owner.getByLabel("Passphrase", { exact: true }).fill(phrase);
    await owner
      .getByRole("button", { name: "Create identity", exact: true })
      .click();
    await expect(
      owner.getByRole("heading", { name: "Your conversations", exact: true }),
    ).toBeVisible();
    await owner.getByRole("button", { name: "Settings", exact: true }).click();
    const before = JSON.parse(
      await owner
        .getByLabel("Public identity card", { exact: true })
        .inputValue(),
    );
    const blocked = await context.newPage();
    await blocked.goto(host.url + "/browser/index.html");
    await expect(
      blocked.getByRole("heading", {
        name: "This profile could not be opened",
        exact: true,
      }),
    ).toBeVisible();
    await expect(blocked.getByRole("alert")).toContainText(
      "already open in another tab",
    );
    await blocked
      .getByLabel("Application language", { exact: true })
      .selectOption("es-ES");
    await expect(
      blocked.getByRole("heading", {
        name: "No se ha podido abrir este perfil",
        exact: true,
      }),
    ).toBeVisible();
    await expect(blocked.getByRole("alert")).toContainText(
      "ya está abierto en otra pestaña",
    );
    await expect(
      blocked.getByRole("button", { name: "Crear identidad", exact: true }),
    ).toHaveCount(0);
    await expect(owner.locator("html")).toHaveAttribute("lang", "es-ES");
    await expect
      .poll(async () =>
        JSON.parse(
          await owner
            .getByLabel("Tarjeta pública de identidad", { exact: true })
            .inputValue(),
        ),
      )
      .toEqual(before);
    await blocked.close();
    await owner.reload();
    await owner.getByLabel("Frase de contraseña", { exact: true }).fill(phrase);
    await owner
      .getByRole("button", { name: "Entrar en mi red", exact: true })
      .click();
    await expect(
      owner.getByRole("heading", { name: "Tus conversaciones", exact: true }),
    ).toBeVisible();
    await owner.getByRole("button", { name: "Ajustes", exact: true }).click();
    await expect
      .poll(async () =>
        JSON.parse(
          await owner
            .getByLabel("Tarjeta pública de identidad", { exact: true })
            .inputValue(),
        ),
      )
      .toEqual(before);
  } finally {
    await context.close();
  }
});

test("unavailable preference storage and localized form validation never reset a profile", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "en-GB" });
  await context.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "relayloom.language.v1")
        throw new DOMException(
          "synthetic language preference quota",
          "QuotaExceededError",
        );
      return set.call(this, key, value);
    };
  });
  const page = await context.newPage(),
    phrase = "private persistent identity language passphrase";
  try {
    await page.goto(host.url + "/browser/index.html");
    await page
      .getByLabel("Application language", { exact: true })
      .selectOption("es-ES");
    await expect(page.getByRole("status")).toContainText(
      "no ha permitido guardar la preferencia",
    );
    await page.getByRole("button", { name: "Empezar", exact: true }).click();
    await page
      .getByRole("button", { name: "Crear identidad", exact: true })
      .click();
    await expect
      .poll(() =>
        page
          .getByLabel("¿Cómo te llamas?", { exact: true })
          .evaluate((input: HTMLInputElement) => input.validationMessage),
      )
      .toBe("Introduce un nombre de 1 a 64 caracteres.");
    await page
      .getByLabel("¿Cómo te llamas?", { exact: true })
      .fill("Cuenta conservada");
    await page.getByLabel("Frase de contraseña", { exact: true }).fill(phrase);
    await page
      .getByRole("button", { name: "Crear identidad", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Tus conversaciones", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Ajustes", exact: true }).click();
    const identity = JSON.parse(
      await page
        .getByLabel("Tarjeta pública de identidad", { exact: true })
        .inputValue(),
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Welcome back.", exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    await page.getByLabel("Passphrase", { exact: true }).fill(phrase);
    await page
      .getByRole("button", { name: "Enter my network", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your conversations", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect
      .poll(async () =>
        JSON.parse(
          await page
            .getByLabel("Public identity card", { exact: true })
            .inputValue(),
        ),
      )
      .toEqual(identity);
  } finally {
    await context.close();
  }
});

test("saving one preference does not hide a different unsaved preference", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "en-GB" });
  await context.addInitScript(() => {
    const blocked = new Set(["relayloom-theme", "relayloom.language.v1"]);
    (window as any).preferenceFailures = blocked;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (blocked.has(key))
        throw new DOMException(
          "synthetic preference quota",
          "QuotaExceededError",
        );
      return set.call(this, key, value);
    };
  });
  const page = await context.newPage();
  try {
    await page.goto(host.url + "/browser/index.html");
    await page
      .getByRole("button", { name: "Get started", exact: true })
      .click();
    await page.getByRole("button", { name: "Dark", exact: true }).click();
    await page
      .getByLabel("Application language", { exact: true })
      .selectOption("es-ES");
    await page.evaluate(() =>
      (window as any).preferenceFailures.delete("relayloom.language.v1"),
    );
    await page
      .getByLabel("Idioma de la aplicación", { exact: true })
      .selectOption("en-GB");
    await expect(
      page.getByText(
        "Preferences apply in this session, but could not be saved.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.evaluate(() => (window as any).preferenceFailures.clear());
    await page
      .getByRole("button", { name: "Retry saving preferences", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Retry saving preferences",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.reload();
    await page
      .getByRole("button", { name: "Get started", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Dark", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  } finally {
    await context.close();
  }
});
