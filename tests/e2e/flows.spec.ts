import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { launch, password, type Client, until } from "../helpers";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";

async function enter(page: Page, client: Client, name: string) {
  await page.goto(client.url + "/#token=" + client.token);
  await page.getByLabel("Como te chamas?").fill(name);
  await page.getByLabel("Frase-passe", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Criar identidade", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "As tuas conversas" }),
  ).toBeVisible();
}
async function contact(page: Page, card: unknown) {
  await page
    .getByRole("button", { name: "Adicionar contacto", exact: true })
    .click();
  await page
    .getByLabel("Cartão público do contacto")
    .fill(JSON.stringify(card));
  await page.getByRole("button", { name: "Verificar e adicionar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function audit(page: Page, name: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  mkdirSync("docs/evidence/ui", { recursive: true });
  writeFileSync(
    `docs/evidence/ui/${name}-axe.json`,
    JSON.stringify(
      {
        tested: new Date().toISOString(),
        url: new URL(page.url()).pathname,
        violations: result.violations,
        passCount: result.passes.length,
      },
      null,
      2,
    ),
  );
  expect(
    result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.screenshot({
    path: `docs/evidence/ui/${name}.png`,
    fullPage: true,
  });
}

test("two live clients: identities, connection, message, attachment, reaction, group, social, safe site and offline recovery", async ({
  browser,
}) => {
  const a = await launch(),
    b = await launch();
  let resumed: Client | undefined;
  const ca = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    cb = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const pa = await ca.newPage(),
    pb = await cb.newPage();
  const errors: string[] = [];
  pa.on("pageerror", (e) => errors.push(e.message));
  pb.on("pageerror", (e) => errors.push(e.message));
  try {
    await pa.goto(a.url + "/#token=" + a.token);
    await audit(pa, "onboarding");
    await enter(pa, a, "Alice Pereira");
    await enter(pb, b, "Bruno Silva");
    const alice = (await a.call("state")).identity,
      bob = (await b.call("state")).identity;
    await contact(pa, bob);
    await contact(pb, alice);
    await pa.getByRole("button", { name: "A rede", exact: true }).click();
    await pa.getByRole("button", { name: "Ligar um par", exact: true }).click();
    await pa.getByLabel("Porta TCP de transporte").fill(String(b.tcpPort));
    await pa.getByRole("button", { name: "Ligar por TCP" }).click();
    await expect(pa.getByText("1 ligação activa")).toBeVisible();
    await pa.getByRole("button", { name: "Conversas", exact: true }).click();
    await pa
      .getByRole("button", { name: "Nova conversa", exact: true })
      .click();
    await pa
      .getByRole("dialog")
      .getByRole("button", { name: /Bruno Silva/ })
      .click();
    await pa
      .getByLabel("Escrever mensagem")
      .fill("Olá Bruno. O caminho pela ponte já está aberto.");
    await pa.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect(
      pb.getByRole("button", { name: /Alice Pereira.*Olá Bruno/ }),
    ).toBeVisible();
    await pb.getByRole("button", { name: /Alice Pereira.*Olá Bruno/ }).click();
    await expect(
      pb
        .locator(".bubble")
        .getByText("Olá Bruno. O caminho pela ponte já está aberto.", {
          exact: true,
        }),
    ).toBeVisible();
    await pb
      .getByLabel("Escrever mensagem")
      .fill("Recebido. Vamos manter-nos em contacto.");
    await pb.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect(
      pa
        .locator(".bubble")
        .getByText("Recebido. Vamos manter-nos em contacto.", { exact: true }),
    ).toBeVisible();
    await pa.locator("input[type=file]").setInputFiles({
      name: "ponto-encontro.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Ponto de encontro: biblioteca."),
    });
    await pa.getByLabel("Escrever mensagem").fill("Deixo aqui as indicações.");
    await pa.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect(
      pb.getByRole("link", { name: "ponto-encontro.txt" }),
    ).toBeVisible();
    const downloadPromise = pb.waitForEvent("download");
    await pb.getByRole("link", { name: "ponto-encontro.txt" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("ponto-encontro.txt");
    await pb
      .locator(".message")
      .filter({ hasText: "Deixo aqui as indicações." })
      .getByRole("button", { name: "Reagir à mensagem" })
      .click();
    await expect(
      pa
        .locator(".message")
        .filter({ hasText: "Deixo aqui as indicações." })
        .getByRole("button", { name: "Reagir à mensagem" }),
    ).toHaveText("1");
    await pa.getByLabel("Pesquisar conversas e mensagens").fill("ponte");
    await expect(pa.getByLabel("Escrever mensagem")).toBeVisible();
    await expect(
      pa
        .locator(".bubble")
        .getByText("Olá Bruno. O caminho pela ponte já está aberto.", {
          exact: true,
        }),
    ).toBeVisible();
    await pa.getByLabel("Pesquisar conversas e mensagens").fill("");
    await audit(pa, "messenger-light");
    await pa.getByRole("button", { name: "Alternar tema" }).click();
    await audit(pa, "messenger-dark");
    await pa.getByRole("button", { name: "Alternar tema" }).click();
    await pa
      .getByLabel("Escrever mensagem")
      .fill("Rascunho privado só para o Bruno");
    await pa.getByRole("button", { name: "Novo grupo" }).click();
    // Legacy fixed-reader groups remain usable alongside the separately tested
    // explicit invitation/admission workflow.
    await pa.getByRole("button", { name: "Lista de leitores fixos" }).click();
    await pa.getByLabel("Nome do grupo").fill("Vizinhos da ponte");
    await pa
      .getByRole("checkbox", { name: "Bruno Silva", exact: true })
      .check();
    await pa.getByRole("button", { name: "Criar grupo", exact: true }).click();
    await expect(pa.getByLabel("Escrever mensagem")).toHaveValue("");
    await pa.getByLabel("Escrever mensagem").fill("Bem-vindos ao nosso grupo.");
    await pa.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect(
      pb.getByRole("button", { name: /Vizinhos da ponte/ }),
    ).toBeVisible();
    await pa.getByRole("button", { name: "A praça", exact: true }).click();
    await pa.getByRole("button", { name: "Partilhar algo" }).click();
    await pa
      .getByLabel("A tua publicação")
      .fill("A biblioteca abriu as portas à comunidade.");
    await pa.getByRole("button", { name: "Publicar", exact: true }).click();
    await pb.getByRole("button", { name: "A praça", exact: true }).click();
    await expect(
      pb.getByText("A biblioteca abriu as portas à comunidade.", {
        exact: true,
      }),
    ).toBeVisible();
    await pb.getByRole("button", { name: "Comentar", exact: true }).click();
    await pb
      .getByLabel("Texto", { exact: true })
      .fill("Obrigado pela partilha!");
    await pb.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(
      pa.getByText("Obrigado pela partilha!", { exact: false }),
    ).toBeVisible();
    await pb.getByRole("button", { name: "Guardar publicação" }).click();
    await pb.getByRole("button", { name: "Guardados", exact: true }).click();
    await expect(
      pb.getByText("A biblioteca abriu as portas à comunidade.", {
        exact: true,
      }),
    ).toBeVisible();
    await audit(pa, "social");
    await pa
      .getByRole("button", { name: "A minha página", exact: true })
      .click();
    await pa
      .getByLabel("Título do bloco 1", { exact: true })
      .fill("Olá, sou a Alice.");
    await pa
      .getByLabel("Texto do bloco 2", { exact: true })
      .fill("Gosto de aproximar pessoas e cuidar dos lugares.");
    const editableBlocks = pa.locator(".site-block.editable");
    await expect(editableBlocks).toHaveCount(2);
    await editableBlocks.nth(0).dragTo(editableBlocks.nth(1));
    await expect(
      pa.getByLabel("Título do bloco 1", { exact: true }),
    ).toHaveValue("Sobre mim");
    await editableBlocks.nth(0).dragTo(editableBlocks.nth(1));
    await expect(
      pa.getByLabel("Título do bloco 1", { exact: true }),
    ).toHaveValue("Olá, sou a Alice.");
    await pa.getByRole("button", { name: "Mover bloco 2 para cima" }).focus();
    await pa.keyboard.press("Enter");
    await expect(
      pa.getByLabel("Título do bloco 1", { exact: true }),
    ).toHaveValue("Sobre mim");
    await pa.getByRole("button", { name: "Mover bloco 1 para baixo" }).click();
    await pa
      .getByRole("button", { name: "Guardar rascunho", exact: true })
      .click();
    await expect(
      pa.getByRole("status").filter({ hasText: "Rascunho cifrado" }),
    ).toBeVisible();
    await pa.reload();
    await pa
      .getByRole("button", { name: "A minha página", exact: true })
      .click();
    await expect(
      pa.getByLabel("Título do bloco 1", { exact: true }),
    ).toHaveValue("Olá, sou a Alice.");
    await audit(pa, "site-editor");
    await pa
      .getByRole("button", { name: "Publicar página", exact: true })
      .click();
    await expect(
      pa.getByRole("status").filter({ hasText: "Página assinada" }),
    ).toBeVisible();
    await until(
      () => b.call("state"),
      (s) => s.objects.some((o: any) => o.kind === "site"),
    );
    await pb.getByRole("button", { name: "A praça", exact: true }).click();
    await a.stop();
    await pb
      .getByRole("button", { name: "Ver página de Alice Pereira" })
      .click();
    await expect(
      pb.getByRole("heading", { name: "Olá, sou a Alice." }),
    ).toBeVisible();
    await pb.getByRole("button", { name: "Fechar", exact: true }).click();
    await pb.setViewportSize({ width: 390, height: 844 });
    await pb.emulateMedia({ reducedMotion: "reduce" });
    await audit(pb, "mobile-social");
    expect(
      await pb.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const port = Number(new URL(b.url).port);
    await b.stop();
    resumed = await launch(b.dir, port);
    await pb.goto(resumed.url + "/#token=" + resumed.token);
    await pb.getByLabel("Frase-passe", { exact: true }).fill(password);
    await pb.getByRole("button", { name: "Entrar na minha rede" }).click();
    await pb.getByRole("button", { name: "Abrir navegação" }).click();
    await pb.getByRole("button", { name: /^Conversas/ }).click();
    await expect(
      pb
        .locator(".bubble")
        .getByText("Deixo aqui as indicações.", { exact: true }),
    ).toBeVisible();
    await expect(
      pb.getByRole("link", { name: "ponto-encontro.txt" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    const cleanup = await Promise.allSettled([
      ca.close(),
      cb.close(),
      a.stop(),
      b.stop(),
      ...(resumed ? [resumed.stop()] : []),
    ]);
    for (const result of cleanup)
      if (result.status === "rejected")
        console.error("Fixture cleanup:", result.reason);
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});
