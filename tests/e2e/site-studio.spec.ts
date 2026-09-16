import { test, expect } from "@playwright/test";
import { rmSync } from "node:fs";
import { launch, password, until } from "../helpers";
import { templateSite } from "../../apps/web/src/site/model";
import { siteFallback } from "../../packages/content/src/site";

test("native site studio restores full draft, renders edited posts and publishes verified pages to another process", async ({
  browser,
}) => {
  const a = await launch(),
    b = await launch();
  const ca = await browser.newContext({ locale: "pt-PT" }),
    cb = await browser.newContext({ locale: "pt-PT" });
  try {
    const alice = await a.call("setup", {
      name: "Alice páginas nativas",
      password,
    });
    await b.call("setup", { name: "Leitor de páginas", password });
    await b.call("contact", { contact: alice });
    await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
    const value = templateSite("journal", "Alice");
    value.site.pages[1].blocks.push({
      id: "photo",
      type: "image",
      title: "Fotografia incluída",
      body: "",
      media: [{ attachment: 0, alt: "Pixel assinado da autora" }],
    });
    value.attachments.push({
      name: "pixel.png",
      mime: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQqCr4DwAD0gIKZKEF0gAAAABJRU5ErkJggg==",
    });
    await a.call("site-draft", { ...value, blocks: siteFallback(value.site) });
    const post = await a.call("publish", {
      content: { type: "post", text: "Versão inicial" },
      recipients: "public",
    });
    await a.call("publish", {
      content: {
        type: "edit",
        target: post.id,
        text: "Versão revista pelo autor",
      },
      recipients: "public",
    });
    const pa = await ca.newPage(),
      pb = await cb.newPage();
    await pa.goto(a.url + "/#token=" + a.token);
    await pa
      .getByRole("button", { name: "A minha página", exact: true })
      .click();
    const studio = pa.getByRole("region", { name: "Estúdio do site" });
    await expect(
      studio.getByLabel("Título do bloco 1", { exact: true }),
    ).toHaveValue("Notas de um mundo em comum.");
    await studio
      .getByRole("button", { name: "Pré-visualizar", exact: true })
      .click();
    await expect(
      studio.getByText("Versão revista pelo autor", { exact: true }),
    ).toBeVisible();
    await expect(
      studio.getByText("Versão inicial", { exact: true }),
    ).toHaveCount(0);
    await studio
      .getByRole("navigation", { name: "Páginas do site" })
      .getByRole("button", { name: "Sobre", exact: true })
      .click();
    await expect
      .poll(() =>
        studio
          .getByRole("img", { name: "Pixel assinado da autora" })
          .evaluate((e: HTMLImageElement) => e.naturalWidth),
      )
      .toBe(1);
    await studio
      .getByRole("button", { name: "Guardar rascunho", exact: true })
      .click();
    await expect(studio.getByRole("status")).toContainText("Rascunho cifrado");
    await studio
      .getByRole("navigation", { name: "Páginas do site" })
      .getByRole("button", { name: "Início", exact: true })
      .click();
    await studio.getByRole("button", { name: "Editar", exact: true }).click();
    value.site.pages[0].blocks[0].title = "A versão que foi publicada.";
    await studio
      .getByLabel("Título do bloco 1", { exact: true })
      .fill(value.site.pages[0].blocks[0].title);
    expect(
      (await a.call("site-draft-load", {})).site.pages[0].blocks[0].title,
    ).toBe("Notas de um mundo em comum.");
    await studio
      .getByRole("button", { name: "Publicar página", exact: true })
      .click();
    await expect(studio.getByRole("status")).toContainText("Página assinada");
    expect((await a.call("site-draft-load", {})).site).toEqual(value.site);
    const received = await until(
      () => b.call("state"),
      (s) => s.objects.some((o: any) => o.kind === "site"),
    );
    expect(
      received.objects.find((o: any) => o.kind === "site").content.site.pages,
    ).toHaveLength(2);
    await pb.goto(b.url + "/#token=" + b.token);
    await pb.getByRole("button", { name: "A praça", exact: true }).click();
    await ca.close();
    await a.stop();
    await pb
      .getByRole("button", { name: "Ver página de Alice páginas nativas" })
      .click();
    const dialog = pb.getByRole("dialog");
    await expect(
      dialog.getByText("Versão revista pelo autor", { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("navigation", { name: "Páginas do site" })
      .getByRole("button", { name: "Sobre", exact: true })
      .click();
    await expect
      .poll(() =>
        dialog
          .getByRole("img", { name: "Pixel assinado da autora" })
          .evaluate((e: HTMLImageElement) => e.naturalWidth),
      )
      .toBe(1);
  } finally {
    await ca.close();
    await cb.close();
    await a.stop();
    await b.stop();
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});
