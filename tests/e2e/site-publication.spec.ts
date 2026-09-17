import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { launch, password } from "../helpers";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const backend = process.env.RELAYLOOM_TEST_BACKEND ?? "node";
async function enter(page: Page, url: string, name: string) {
  await page.goto(url);
  await page.getByRole("button", { name: "Começar", exact: true }).click();
  await page.getByLabel("Como te chamas?").fill(name);
  await page.getByLabel("Frase-passe", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Criar identidade", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "As tuas conversas" }),
  ).toBeVisible();
}
async function nav(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
}
async function card(page: Page) {
  await nav(page, "Definições");
  return JSON.parse(
    await page.getByLabel("Cartão público da identidade").inputValue(),
  );
}
async function contact(page: Page, value: unknown) {
  await nav(page, "Conversas");
  await page
    .getByRole("button", { name: "Adicionar contacto", exact: true })
    .click();
  await page
    .getByLabel("Cartão público do contacto")
    .fill(JSON.stringify(value));
  await page.getByRole("button", { name: "Verificar e adicionar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
const studio = (page: Page) =>
  page.getByRole("region", { name: "Estúdio do site", exact: true });
async function publish(page: Page, title: string) {
  const s = studio(page);
  await s.getByLabel("Título do bloco 1", { exact: true }).fill(title);
  await s.getByRole("button", { name: "Publicar página", exact: true }).click();
  await expect(
    s.getByRole("status", {
      name: "Estado da publicação do site",
      exact: true,
    }),
  ).toContainText("Página assinada");
}

test("native-backed UI publishes private versions, resolves the current head and preserves cached history with the author offline", async ({
  browser,
}) => {
  const a = await launch(),
    b = await launch(),
    ca = await browser.newContext({ locale: "pt-PT" }),
    cb = await browser.newContext({ locale: "pt-PT" }),
    pa = await ca.newPage(),
    pb = await cb.newPage();
  try {
    const runtime = (await a.call("state")).nativeRuntime;
    expect(runtime).toBe(backend === "native" ? "Go" : undefined);
    expect((await b.call("state")).nativeRuntime).toBe(runtime);
    await enter(pa, a.url + "/#token=" + a.token, "Autora do motor " + backend);
    await enter(pb, b.url + "/#token=" + b.token, "Leitor do motor " + backend);
    const alice = await card(pa),
      bob = await card(pb);
    await contact(pa, bob);
    await contact(pb, alice);
    // Transport fixture: actual independent cores over TCP; all site actions below use the UI.
    await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
    await nav(pa, "A minha página");
    await publish(pa, "Primeira versão no motor " + backend);
    await nav(pb, "A praça");
    await pb
      .getByRole("button", { name: "Ver página de " + alice.name, exact: true })
      .click();
    const reader = pb.getByRole("dialog");
    await expect(
      reader.getByRole("heading", {
        name: "Primeira versão no motor " + backend,
        exact: true,
      }),
    ).toBeVisible();
    await studio(pa)
      .getByRole("button", { name: /Opções de publicação:/ })
      .click();
    await studio(pa)
      .getByLabel("Quem pode ler o site", { exact: true })
      .selectOption("private");
    await studio(pa)
      .getByRole("group", { name: "Leitores privados do site", exact: true })
      .getByRole("checkbox", { name: bob.name, exact: true })
      .check();
    await publish(pa, "Segunda versão privada " + backend);
    await expect(
      reader.getByRole("heading", {
        name: "Segunda versão privada " + backend,
        exact: true,
      }),
    ).toBeVisible();
    const saved = await a.call("site-draft-load", {});
    expect(saved.editing.recipients).toEqual([bob.id]);
    expect(saved.editing.pending).toBeUndefined();
    expect(saved.editing.sequence).toBe(3);
    await reader
      .getByRole("button", { name: "Ver histórico", exact: true })
      .click();
    await expect(
      reader.getByRole("button", { name: /^Ver versão \d+:/ }),
    ).toHaveCount(2);
    await reader.getByRole("button", { name: /^Ver versão 1:/ }).click();
    await expect(
      reader.getByRole("heading", {
        name: "Primeira versão no motor " + backend,
        exact: true,
      }),
    ).toBeVisible();
    await reader
      .getByRole("button", { name: "Ver versão actual", exact: true })
      .click();
    await expect(
      reader.getByRole("heading", {
        name: "Segunda versão privada " + backend,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      reader.getByRole("button", { name: /Recuperar versão/ }),
    ).toHaveCount(0);
    await studio(pa)
      .getByRole("button", { name: "Ver histórico", exact: true })
      .click();
    await studio(pa)
      .getByRole("button", { name: /^Recuperar versão 1:/ })
      .click();
    const recovery = pa.getByRole("dialog", {
      name: "Recuperar uma versão anterior",
      exact: true,
    });
    await expect(
      recovery.getByRole("heading", {
        name: "Primeira versão no motor " + backend,
        exact: true,
      }),
    ).toBeVisible();
    await recovery
      .getByRole("button", {
        name: "Substituir rascunho por esta versão",
        exact: true,
      })
      .click();
    await expect(recovery).toHaveCount(0);
    expect((await a.call("site-draft-load", {})).editing.recipients).toBe(
      "public",
    );
    expect(
      (
        await a.call("site-command", {
          action: "state",
          address: saved.editing.address,
        })
      ).number,
    ).toBe(2);
    await expect(
      reader.getByRole("heading", {
        name: "Segunda versão privada " + backend,
        exact: true,
      }),
    ).toBeVisible();
    await ca.close();
    await a.stop();
    expect(a.process.exitCode !== null || a.process.signalCode !== null).toBe(
      true,
    );
    await pb.reload();
    await expect(
      pb.getByRole("heading", { name: "As tuas conversas" }),
    ).toBeVisible();
    await nav(pb, "A praça");
    await pb
      .getByRole("button", { name: "Ver página de " + alice.name, exact: true })
      .click();
    await expect(
      pb.getByRole("dialog").getByRole("heading", {
        name: "Segunda versão privada " + backend,
        exact: true,
      }),
    ).toBeVisible();
    const audit = await new AxeBuilder({ page: pb })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
    const directory = ".cache/site-editor/native-ui/" + backend;
    mkdirSync(directory, { recursive: true });
    await pb.screenshot({ path: directory + "/reader.png", fullPage: true });
    writeFileSync(
      directory + "/result.json",
      JSON.stringify(
        {
          status: "PASS",
          requestedBackend: backend,
          actualRuntime: runtime ?? "Node",
          authorProcess: a.process.pid,
          readerProcess: b.process.pid,
          independentTCP: true,
          authorStopped: true,
          privateReadersPreserved: true,
          history: true,
          violations: audit.violations,
          passedAxeRules: audit.passes.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await ca.close();
    await cb.close();
    await a.stop();
    await b.stop();
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});
