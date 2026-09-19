import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { launch, password } from "../helpers";
import {
  mkdirSync,
  readFileSync,
  existsSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
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
  const button = page.getByRole("button", { name, exact: true });
  if (!(await button.isVisible()))
    await page
      .getByRole("button", { name: "Abrir navegação", exact: true })
      .click();
  await button.click();
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
test("shared resource UI creates a private file and table, enforces reader scope and retrieves exact bytes through independent native peers", async ({
  browser,
}) => {
  const a = await launch(),
    b = await launch(),
    ca = await browser.newContext(),
    cb = await browser.newContext({ viewport: { width: 390, height: 844 } }),
    pa = await ca.newPage(),
    pb = await cb.newPage(),
    output = `.cache/resource-native-ui/${backend}`;
  mkdirSync(output, { recursive: true });
  const bytes = Buffer.from("Native UI resource transfer 🧶\n".repeat(128));
  try {
    expect((await a.call("state")).nativeRuntime).toBe(
      backend === "native" ? "Go" : undefined,
    );
    expect((await b.call("state")).nativeRuntime).toBe(
      backend === "native" ? "Go" : undefined,
    );
    await enter(
      pa,
      a.url + "/#token=" + a.token,
      "Autora de recursos " + backend,
    );
    await enter(
      pb,
      b.url + "/#token=" + b.token,
      "Leitor de recursos " + backend,
    );
    const alice = await card(pa),
      bob = await card(pb);
    await contact(pa, bob);
    await contact(pb, alice);
    // Network setup only: all resource/site creation, retrieval and downloads
    // below use the shipped UI. These are independent actual core processes.
    await a.call("settings", { relay: true });
    await b.call("settings", { relay: true });
    await b.call("connect", { host: "127.0.0.1", port: a.tcpPort });
    await nav(pa, "A minha página");
    const studio = pa.getByRole("region", {
      name: "Estúdio do site",
      exact: true,
    });
    await studio.getByRole("button", { name: /Opções de publicação:/ }).click();
    await studio
      .getByLabel("Quem pode ler o site", { exact: true })
      .selectOption("private");
    await studio
      .getByRole("group", { name: "Leitores privados do site", exact: true })
      .getByRole("checkbox", { name: bob.name, exact: true })
      .check();
    await studio.getByRole("button", { name: "Recursos", exact: true }).click();
    let library = pa.getByRole("dialog", {
      name: "Biblioteca de recursos",
      exact: true,
    });
    await library
      .getByRole("button", { name: "Novo ficheiro", exact: true })
      .click();
    await library
      .getByLabel("Ficheiro do recurso", { exact: true })
      .setInputFiles({
        name: "Guia privado.txt",
        mimeType: "text/plain",
        buffer: bytes,
      });
    await library
      .getByRole("button", { name: "Guardar recurso", exact: true })
      .click();
    await expect(
      library.getByRole("status", {
        name: "Estado da criação do recurso",
        exact: true,
      }),
    ).toContainText("Recurso guardado");
    await library
      .getByRole("button", { name: "Inserir no site", exact: true })
      .click();
    await expect(library).toHaveCount(0);
    const fileId = await studio
      .locator("[data-resource-id]")
      .getAttribute("data-resource-id");
    await studio.getByRole("button", { name: "Recursos", exact: true }).click();
    library = pa.getByRole("dialog", {
      name: "Biblioteca de recursos",
      exact: true,
    });
    await library
      .getByRole("button", { name: "Nova tabela", exact: true })
      .click();
    await library
      .getByLabel("Nome do recurso", { exact: true })
      .fill("Pontos privados");
    await library
      .getByLabel("Formato dos dados", { exact: true })
      .selectOption("csv");
    await library
      .getByLabel("Ficheiro de dados da tabela", { exact: true })
      .setInputFiles({
        name: "pontos.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("Local,Vagas\nCentro,8\nEscola,12\n"),
      });
    await pa
      .getByRole("dialog", { name: "Substituir dados da tabela", exact: true })
      .getByRole("button", { name: "Substituir por estes dados", exact: true })
      .click();
    await library
      .getByRole("button", { name: "Guardar recurso", exact: true })
      .click();
    await expect(
      library.getByRole("status", {
        name: "Estado da criação do recurso",
        exact: true,
      }),
    ).toContainText("Recurso guardado");
    const tableCard = library.getByRole("article").filter({
      has: pa.getByRole("heading", { name: "Pontos privados", exact: true }),
    });
    await tableCard
      .getByRole("button", { name: "Inserir no site", exact: true })
      .click();
    await expect(library).toHaveCount(0);
    await studio
      .getByRole("button", { name: "Guardar rascunho", exact: true })
      .click();
    await studio
      .getByLabel("Quem pode ler o site", { exact: true })
      .selectOption("public");
    await studio
      .getByRole("button", { name: "Publicar página", exact: true })
      .click();
    await expect(studio.getByRole("alert")).toContainText(
      "Um recurso não permite todos os leitores escolhidos",
    );
    await studio
      .getByLabel("Quem pode ler o site", { exact: true })
      .selectOption("private");
    await studio
      .getByRole("group", { name: "Leitores privados do site", exact: true })
      .getByRole("checkbox", { name: bob.name, exact: true })
      .check();
    await studio
      .getByRole("button", { name: "Publicar página", exact: true })
      .click();
    await expect(
      studio.getByRole("status", {
        name: "Estado da publicação do site",
        exact: true,
      }),
    ).toContainText("Página assinada");
    await nav(pb, "A praça");
    await pb
      .getByRole("button", { name: "Ver página de " + alice.name, exact: true })
      .click();
    const visit = pb.getByRole("dialog");
    const fileCard = visit.locator(".site-resource").filter({
      has: pb.getByRole("heading", { name: "Guia privado.txt", exact: true }),
    });
    await expect(
      fileCard.getByText("Ainda não guardado neste dispositivo", {
        exact: true,
      }),
    ).toBeVisible();
    expect(existsSync(join(b.dir, "store/objects", fileId + ".json"))).toBe(
      false,
    );
    await fileCard
      .getByRole("button", { name: "Obter ficheiro", exact: true })
      .click();
    const downloadLink = fileCard.getByRole("link", {
      name: /Guardar ficheiro/,
    });
    await expect(downloadLink).toBeVisible();
    const downloading = pb.waitForEvent("download");
    await downloadLink.click();
    await (await downloading).saveAs(output + "/download.txt");
    expect(readFileSync(output + "/download.txt")).toEqual(bytes);
    const table = visit.locator(".site-resource").filter({
      has: pb.getByRole("heading", { name: "Pontos privados", exact: true }),
    });
    await table
      .getByRole("button", { name: "Obter e abrir tabela", exact: true })
      .click();
    await expect(
      table.getByRole("cell", { name: "Centro", exact: true }),
    ).toBeVisible();
    await table
      .getByLabel("Pesquisar nesta tabela", { exact: true })
      .fill("Escola");
    await expect(
      table.getByRole("cell", { name: "Escola", exact: true }),
    ).toBeVisible();
    await expect(
      table.getByRole("cell", { name: "Centro", exact: true }),
    ).toHaveCount(0);
    await table.scrollIntoViewIfNeeded();
    const audit = await new AxeBuilder({ page: pb })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
    await pb.screenshot({ path: output + "/reader-mobile.png" });
    writeFileSync(
      output + "/result.json",
      JSON.stringify(
        {
          status: "PASS",
          backend,
          actualRuntime: (await a.call("state")).nativeRuntime ?? "Node",
          independentProcesses: [a.process.pid, b.process.pid],
          UIFileAndTableCreation: true,
          publicPrivacyFailure: true,
          absentBeforeChoice: true,
          exactFileBytes: bytes.length,
          signedAuthorPreserved:
            (await b.call("view", { id: fileId })).author.id === alice.id,
          violations: audit.violations,
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
