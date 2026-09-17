import { test, expect } from "@playwright/test";
import { uiHost } from "./app-host";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
let host: Awaited<ReturnType<typeof uiHost>>;
test.beforeAll(async () => {
  host = await uiHost();
});
test.afterAll(async () => {
  await host.close();
});

test("an allowed large site image saves through the UI and survives encrypted browser restart", async ({
  page,
}, info) => {
  const password = "frase sintética do rascunho grande";
  await page.goto(host.url + "/browser/index.html");
  expect(page.url()).toBe(host.url + "/browser/index.html");
  await page.getByRole("button", { name: "Começar", exact: true }).click();
  await page
    .getByLabel("Como te chamas?", { exact: true })
    .fill("Autora de imagem grande");
  await page.getByLabel("Frase-passe", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Criar identidade", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "As tuas conversas", exact: true }),
  ).toBeVisible();
  // Incompressible synthetic pixels make a valid PNG larger than the old 1MiB
  // metadata budget, without large dimensions, camera input or external files.
  const encoded = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 512;
    const context = canvas.getContext("2d")!,
      pixels = context.createImageData(768, 512);
    const bytes = new Uint8Array(pixels.data.buffer);
    for (let at = 0; at < bytes.length; at += 65536)
      crypto.getRandomValues(
        bytes.subarray(at, Math.min(bytes.length, at + 65536)),
      );
    for (let at = 3; at < bytes.length; at += 4) bytes[at] = 255;
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const bytes = Buffer.from(encoded, "base64");
  expect(bytes.length).toBeGreaterThan(1024 * 1024);
  expect(bytes.length).toBeLessThanOrEqual(2 * 1024 * 1024);
  await page
    .getByRole("button", { name: "A minha página", exact: true })
    .click();
  const studio = page.getByRole("region", { name: "Estúdio do site" });
  const project = {
    format: "relayloom-site-project",
    version: 1,
    theme: "sand",
    site: {
      version: 1,
      title: "Imagem preservada",
      description: "Teste privado",
      home: "home",
      design: {
        font: "sans",
        width: "standard",
        radius: "soft",
        accent: "#207a70",
      },
      pages: [
        {
          id: "home",
          slug: "inicio",
          title: "Início",
          blocks: [
            {
              id: "large-image",
              type: "image",
              title: "Uma imagem válida",
              body: "",
              media: [{ attachment: 0, alt: "Imagem sintética grande" }],
            },
          ],
        },
      ],
    },
    attachments: [{ name: "large.png", mime: "image/png", data: encoded }],
  };
  await studio.getByRole("tab", { name: "Avançado", exact: true }).click();
  await studio
    .getByLabel("Projecto declarativo", { exact: true })
    .fill(JSON.stringify(project));
  await studio
    .getByRole("button", { name: "Validar e aplicar", exact: true })
    .click();
  await studio.getByRole("tab", { name: "Blocos", exact: true }).click();
  await expect
    .poll(() =>
      studio
        .getByRole("img", { name: "Imagem sintética grande" })
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(768);
  await studio
    .getByRole("button", { name: "Guardar rascunho", exact: true })
    .click();
  await expect(studio.getByRole("status")).toContainText("Rascunho cifrado");
  await page.reload();
  await page.getByLabel("Frase-passe", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Entrar na minha rede", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "As tuas conversas", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "A minha página", exact: true })
    .click();
  await expect
    .poll(() =>
      studio
        .getByRole("img", { name: "Imagem sintética grande" })
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(768);
  await studio.getByRole("tab", { name: "Avançado", exact: true }).click();
  const restored = JSON.parse(
    await studio
      .getByLabel("Projecto declarativo", { exact: true })
      .inputValue(),
  );
  expect(Buffer.from(restored.attachments[0].data, "base64")).toEqual(bytes);
  expect(restored.site).toEqual(project.site);
  const out = `.cache/site-revisions/large-draft-${info.project.name || "chromium"}`;
  mkdirSync(out, { recursive: true });
  writeFileSync(
    out + "/report.json",
    JSON.stringify(
      {
        status: "PASS",
        applicationURL: page.url(),
        imageBytes: bytes.length,
        imageSHA256: createHash("sha256").update(bytes).digest("hex"),
        exactImageAfterUIReload: true,
        physicalDevice: false,
        syntheticImage: true,
      },
      null,
      2,
    ) + "\n",
  );
});
