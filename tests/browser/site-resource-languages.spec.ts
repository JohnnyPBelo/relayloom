import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { appHost } from "./app-host";
let host: Awaited<ReturnType<typeof appHost>>;
test.beforeAll(async () => {
  host = await appHost();
});
test.afterAll(async () => {
  await host.close();
  expect(host.requests.some((path) => path.startsWith("/api/"))).toBe(false);
});

for (const l of [
  {
    code: "en-GB",
    start: "Get started",
    name: "What is your name?",
    password: "Passphrase",
    create: "Create identity",
    conversations: "Your conversations",
    site: "My site",
    studio: "Site studio",
    menu: "Open navigation",
    theme: "Switch theme",
    resources: "Resources",
    library: "Resource library",
    newFile: "New file",
    file: "Resource file",
    save: "Save resource",
    status: "Resource creation status",
    done: "Resource saved",
    insert: "Insert into site",
    saveDraft: "Save draft",
    publish: "Publish page",
    siteStatus: "Site publication status",
    siteDone: "Page signed",
    close: "Close",
    search: "Search resources",
  },
  {
    code: "es-ES",
    start: "Empezar",
    name: "¿Cómo te llamas?",
    password: "Frase de contraseña",
    create: "Crear identidad",
    conversations: "Tus conversaciones",
    site: "Mi sitio",
    studio: "Estudio del sitio",
    menu: "Abrir navegación",
    theme: "Cambiar tema",
    resources: "Recursos",
    library: "Biblioteca de recursos",
    newFile: "Nuevo archivo",
    file: "Archivo del recurso",
    save: "Guardar recurso",
    status: "Estado de creación del recurso",
    done: "Recurso guardado",
    insert: "Insertar en el sitio",
    saveDraft: "Guardar borrador",
    publish: "Publicar página",
    siteStatus: "Estado de publicación del sitio",
    siteDone: "Página firmada",
    close: "Cerrar",
    search: "Buscar recursos",
  },
])
  test(`resource library works in ${l.code} on a compact dark reduced-motion interface without translating authored filenames`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(host.url + "/browser/index.html");
    await page
      .getByLabel("Idioma da aplicação", { exact: true })
      .selectOption(l.code);
    await expect(page.locator("html")).toHaveAttribute("lang", l.code);
    await page.getByRole("button", { name: l.theme, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: l.start, exact: true }).click();
    await page.getByLabel(l.name, { exact: true }).fill("Autora coração 🧶");
    await page
      .getByLabel(l.password, { exact: true })
      .fill("resource language UI fixture passphrase");
    await page.getByRole("button", { name: l.create, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: l.conversations, exact: true }),
    ).toBeVisible();
    const siteButton = page.getByRole("button", { name: l.site, exact: true });
    if (!(await siteButton.isVisible()))
      await page.getByRole("button", { name: l.menu, exact: true }).click();
    await siteButton.click();
    const studio = page.getByRole("region", { name: l.studio, exact: true });
    await studio
      .getByRole("button", { name: l.resources, exact: true })
      .click();
    let library = page.getByRole("dialog", { name: l.library, exact: true });
    await library.getByRole("button", { name: l.newFile, exact: true }).click();
    const filename = "Memória e coração 🧶.txt";
    await library
      .getByLabel(l.file, { exact: true })
      .setInputFiles({
        name: filename,
        mimeType: "text/plain",
        buffer: Buffer.from("Texto original: memória e coração 🧶"),
      });
    await library.getByRole("button", { name: l.save, exact: true }).click();
    await expect(
      library.getByRole("status", { name: l.status, exact: true }),
    ).toContainText(l.done);
    await expect(
      library.getByRole("heading", { name: filename, exact: true }),
    ).toBeVisible();
    const controls = library.getByRole("button", {
      name: l.insert,
      exact: true,
    });
    await controls.scrollIntoViewIfNeeded();
    await controls.focus();
    await expect(controls).toBeFocused();
    const bounds = await library.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(390);
    expect(
      await library.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    const output = `.cache/resource-ui-languages/${info.project.name || "chromium"}`;
    mkdirSync(output, { recursive: true });
    await page.screenshot({ path: output + "/" + l.code + "-dark.png" });
    writeFileSync(
      output + "/" + l.code + "-axe.json",
      JSON.stringify(
        {
          violations: result.violations,
          passed: result.passes.length,
          compact: true,
          reducedMotion: true,
          keyboardFocus: true,
          filenamePreserved: filename,
        },
        null,
        2,
      ),
    );
    await page.keyboard.press("Enter");
    await expect(library).toHaveCount(0);
    await expect(studio.locator(".site-resource")).toContainText(filename);
    await studio
      .getByRole("button", { name: l.saveDraft, exact: true })
      .click();
    await studio.getByRole("button", { name: l.publish, exact: true }).click();
    await expect(
      studio.getByRole("status", { name: l.siteStatus, exact: true }),
    ).toContainText(l.siteDone);
    await studio
      .getByRole("button", { name: l.resources, exact: true })
      .click();
    library = page.getByRole("dialog", { name: l.library, exact: true });
    await library.getByLabel(l.search, { exact: true }).fill("coração");
    await expect(
      library.getByRole("heading", { name: filename, exact: true }),
    ).toBeVisible();
    await library.getByRole("button", { name: l.close, exact: true }).click();
  });
