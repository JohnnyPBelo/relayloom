import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { launch, password, type Client } from "../helpers";

test("native profile keeps language and appearance across an actual process restart on a different HTTP port", async ({
  browser,
}) => {
  let client = await launch();
  const context = await browser.newContext({
      locale: "en-GB",
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  const dir = client.dir,
    blocker = createServer((_q, r) => {
      r.writeHead(503);
      r.end();
    });
  try {
    await page.goto(client.url + "/#token=" + client.token);
    await page
      .getByLabel("Application language", { exact: true })
      .selectOption("es-ES");
    await page.getByRole("button", { name: "Empezar", exact: true }).click();
    await page.getByRole("button", { name: "Oscuro", exact: true }).click();
    await page.getByLabel("Texto más grande", { exact: true }).check();
    await expect
      .poll(() => client.call("ui-preferences"))
      .toEqual({ language: "es-ES", theme: "dark", largeText: true });
    expect((await client.call("state")).initialized).toBe(false);
    await page
      .getByLabel("¿Cómo te llamas?", { exact: true })
      .fill("Identidade persistente");
    await page
      .getByLabel("Frase de contraseña", { exact: true })
      .fill(password);
    await page
      .getByRole("button", { name: "Crear identidad", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Tus conversaciones", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Ajustes", exact: true }).click();
    const before = JSON.parse(
      await page
        .getByLabel("Tarjeta pública de identidad", { exact: true })
        .inputValue(),
    );
    const original = client.url,
      port = Number(new URL(original).port);
    await client.stop();
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(port, "127.0.0.1", resolve);
    });
    client = await launch(dir);
    expect(new URL(client.url).port).not.toBe(String(port));
    await page.goto(client.url + "/#token=" + client.token);
    await expect(
      page.getByRole("heading", {
        name: "Qué bueno tenerte de vuelta.",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "es-ES");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute(
      "data-readability",
      "large",
    );
    await page
      .getByLabel("Frase de contraseña", { exact: true })
      .fill(password);
    await page
      .getByRole("button", { name: "Entrar en mi red", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Tus conversaciones", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Ajustes", exact: true }).click();
    await expect
      .poll(async () =>
        JSON.parse(
          await page
            .getByLabel("Tarjeta pública de identidad", { exact: true })
            .inputValue(),
        ),
      )
      .toEqual(before);
    const runtime =
        process.env.RELAYLOOM_TEST_BACKEND === "native" ? "go" : "node",
      out = `.cache/onboarding-i18n/preferences-${runtime}`;
    mkdirSync(out, { recursive: true });
    await page.screenshot({ path: out + "/restored.png", fullPage: true });
    writeFileSync(
      out + "/report.json",
      JSON.stringify(
        {
          status: "PASS",
          runtime,
          actualProcessRestart: true,
          httpPortChanged: true,
          languageRestored: true,
          appearanceRestored: true,
          identityPreserved: true,
          physicalDevice: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
    await client.stop();
    if (blocker.listening)
      await new Promise<void>((r) => blocker.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a late native preference read cannot overwrite a newer language choice", async ({
  browser,
}) => {
  const client = await launch(),
    context = await browser.newContext({ locale: "en-GB" }),
    page = await context.newPage();
  let release!: () => void, observed!: () => void;
  const waiting = new Promise<void>((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      observed = resolve;
    });
  try {
    await client.call("ui-preferences", { language: "pt-PT", theme: "dark" });
    let delayed = false;
    await page.route("**/api/ui-preferences", async (route) => {
      if (route.request().method() === "GET" && !delayed) {
        delayed = true;
        const response = await route.fetch();
        observed();
        await waiting;
        await route.fulfill({ response });
      } else await route.continue();
    });
    await page.goto(client.url + "/#token=" + client.token);
    await started;
    await page
      .getByLabel("Application language", { exact: true })
      .selectOption("es-ES");
    await expect
      .poll(() => client.call("ui-preferences"))
      .toEqual({ language: "es-ES", theme: "dark" });
    release();
    await expect(
      page.getByRole("button", { name: "Empezar", exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "es-ES");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  } finally {
    release();
    await context.close();
    await client.stop();
    rmSync(client.dir, { recursive: true, force: true });
  }
});

test("a lost preference response can be retried without replacing a newer choice", async ({
  browser,
}) => {
  const client = await launch(),
    context = await browser.newContext({ locale: "en-GB" }),
    page = await context.newPage();
  let release!: () => void, seen!: () => void;
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    second = new Promise<void>((resolve) => {
      seen = resolve;
    });
  let writes = 0;
  try {
    await page.route("**/api/ui-preferences", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      writes++;
      const response = await route.fetch();
      if (writes === 1) {
        await route.abort("failed");
        return;
      }
      if (writes === 2) {
        seen();
        await held;
      }
      await route.fulfill({ response });
    });
    await page.goto(client.url + "/#token=" + client.token);
    await page
      .getByRole("button", { name: "Get started", exact: true })
      .waitFor();
    await page
      .getByLabel("Application language", { exact: true })
      .selectOption("es-ES");
    await expect(
      page.getByText(
        "Las preferencias se aplican en esta sesión, pero no se han podido guardar.",
        { exact: true },
      ),
    ).toBeVisible();
    expect((await client.call("ui-preferences")).language).toBe("es-ES");
    await page
      .getByRole("button", {
        name: "Volver a guardar las preferencias",
        exact: true,
      })
      .click();
    await second;
    await page
      .getByLabel("Idioma de la aplicación", { exact: true })
      .selectOption("en-GB");
    release();
    await expect
      .poll(async () => (await client.call("ui-preferences")).language)
      .toBe("en-GB");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    await expect(
      page.getByRole("button", {
        name: "Retry saving preferences",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(writes).toBe(3);
    expect((await client.call("state")).initialized).toBe(false);
  } finally {
    release();
    await context.close();
    await client.stop();
    rmSync(client.dir, { recursive: true, force: true });
  }
});
