import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { appHost } from "./app-host";
const password = "resource UI account fixture passphrase";
let host: Awaited<ReturnType<typeof appHost>>;
test.beforeAll(async () => {
  host = await appHost();
});
test.afterAll(async () => {
  await host.close();
  expect(host.requests.some((path) => path.startsWith("/api/"))).toBe(false);
});
async function enter(page: Page, name: string) {
  await page.goto(host.url + "/browser/index.html");
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
async function addContact(page: Page, contact: unknown) {
  await nav(page, "Conversas");
  await page
    .getByRole("button", { name: "Adicionar contacto", exact: true })
    .click();
  await page
    .getByLabel("Cartão público do contacto")
    .fill(JSON.stringify(contact));
  await page.getByRole("button", { name: "Verificar e adicionar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function relay(page: Page, enabled: boolean) {
  await nav(page, "A rede");
  await page
    .getByLabel("Permitir retransmissão", { exact: true })
    .setChecked(enabled);
}
async function connect(a: Page, b: Page) {
  for (const p of [a, b]) {
    await nav(p, "A rede");
    await p.getByRole("button", { name: "Ligar um par", exact: true }).click();
  }
  await a
    .getByRole("button", { name: "Criar código de ligação", exact: true })
    .click();
  const offer = await a.getByLabel("Código para partilhar").inputValue();
  await b.getByRole("tab", { name: "Receber código", exact: true }).click();
  await b.getByLabel("Código de ligação recebido").fill(offer);
  await b.getByRole("button", { name: "Criar resposta", exact: true }).click();
  const answer = await b.getByLabel("Código para partilhar").inputValue();
  await a.getByLabel("Resposta do outro dispositivo").fill(answer);
  await a
    .getByRole("button", { name: "Concluir ligação", exact: true })
    .click();
  await expect(
    a.getByText("Ligação estabelecida. Já podem trocar conteúdo.", {
      exact: true,
    }),
  ).toBeVisible();
  for (const p of [a, b])
    await p
      .getByRole("dialog")
      .getByRole("button", { name: "Fechar", exact: true })
      .click();
}
async function siteOf(page: Page, name: string) {
  await nav(page, "A praça");
  await page
    .getByRole("button", { name: "Ver página de " + name, exact: true })
    .click();
  return page.getByRole("dialog", { name: "Página de " + name, exact: true });
}
async function studioOf(page: Page) {
  await nav(page, "A minha página");
  return page.getByRole("region", { name: "Estúdio do site", exact: true });
}
async function newFile(
  library: Locator,
  name: string,
  mimeType: string,
  buffer: Buffer,
) {
  await library
    .getByRole("button", { name: "Novo ficheiro", exact: true })
    .click();
  await library
    .getByLabel("Ficheiro do recurso", { exact: true })
    .setInputFiles({ name, mimeType, buffer });
  await library
    .getByRole("button", { name: "Guardar recurso", exact: true })
    .click();
  await expect(
    library.getByRole("heading", { name, exact: true }),
  ).toBeVisible();
}
async function withFile(page: Page, name: string, bytes: Buffer) {
  const studio = await studioOf(page);
  await studio.getByRole("button", { name: /Opções de publicação:/ }).click();
  await studio
    .getByLabel("Quem pode ler o site", { exact: true })
    .selectOption("public");
  await studio.getByRole("button", { name: "Recursos", exact: true }).click();
  const library = page.getByRole("dialog", {
    name: "Biblioteca de recursos",
    exact: true,
  });
  await newFile(library, name, "text/plain", bytes);
  await library
    .getByRole("button", { name: "Inserir no site", exact: true })
    .click();
  // Insertion verifies the local resource asynchronously. selectOption can
  // otherwise mutate an inert background select before that operation finishes.
  await expect(library).toHaveCount(0);
  await expect(studio.locator("[data-resource-id]")).toHaveCount(1);
  await expect(
    studio.getByRole("heading", { name, exact: true }),
  ).toBeVisible();
  return studio;
}
async function publish(studio: Locator, expectedVersion = 1) {
  await studio
    .getByRole("button", { name: "Guardar rascunho", exact: true })
    .click();
  await studio
    .getByRole("button", { name: "Publicar página", exact: true })
    .click();
  await expect(
    studio.getByRole("status", {
      name: "Estado da publicação do site",
      exact: true,
    }),
  ).toContainText("Página assinada");
  await expect(
    studio.getByRole("button", { name: "Publicar página", exact: true }),
  ).toBeEnabled();
  await expect(
    studio.getByText(`Versão ${expectedVersion} conhecida`, { exact: true }),
  ).toBeVisible();
}

test("the maximum valid page inspects every resource without exhausting the browser command budget", async ({
  page,
}, info) => {
  const out = `.cache/resource-inspection-budget/${info.project.name}${info.repeatEachIndex ? "-repeat" + info.repeatEachIndex : ""}`;
  mkdirSync(out, { recursive: true });
  await page.addInitScript(() => {
    const Original = Worker,
      w = window as any;
    w.inspectionBudget = { hold: false, posted: 0, held: 0, peak: 0 };
    const replies: (() => void)[] = [];
    w.releaseInspections = () => {
      w.inspectionBudget.hold = false;
      for (const release of replies.splice(0)) release();
    };
    class Observed extends Original {
      inspections = new Set<number>();
      override postMessage(value: any, ...rest: any[]) {
        if (
          value?.type === "request" &&
          value.operation === "resource-command" &&
          value.body?.action === "inspect"
        ) {
          this.inspections.add(value.id);
          w.inspectionBudget.posted++;
          w.inspectionBudget.peak = Math.max(
            w.inspectionBudget.peak,
            this.inspections.size,
          );
        }
        return super.postMessage(value, ...(rest as [any]));
      }
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event) => {
          if (
            event.data?.type !== "result" ||
            !this.inspections.has(event.data.id)
          )
            return;
          if (w.inspectionBudget.hold) {
            w.inspectionBudget.held++;
            event.stopImmediatePropagation();
            replies.push(() =>
              this.dispatchEvent(
                new MessageEvent("message", { data: event.data }),
              ),
            );
          } else this.inspections.delete(event.data.id);
        });
      }
    }
    w.Worker = Observed;
  });
  await enter(page, "Autora da página extensa");
  const studio = await withFile(
    page,
    "Um recurso reutilizável.txt",
    Buffer.from("ONE_VERIFIED_RESOURCE_MANY_REFERENCES"),
  );
  await studio.getByRole("tab", { name: "Avançado", exact: true }).click();
  const project = JSON.parse(
    await studio.getByLabel("Projecto declarativo").inputValue(),
  );
  const home = project.site.pages.find((p: any) => p.id === project.site.home);
  const resource = home.blocks.find((b: any) => b.type === "resource");
  expect(resource).toBeTruthy();
  let next = 0;
  const entry = () => {
    const i = next++;
    return { ...resource, id: `resource-${i}`, title: `Referência ${i + 1}` };
  };
  // The contract permits 24 siblings: 5 containers + 123 resource leaves = 128 blocks.
  home.blocks = [
    entry(),
    entry(),
    entry(),
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `shelf-${i}`,
      type: "columns",
      title: `Recursos ${i + 1}`,
      body: "",
      style: { columns: 1 },
      children: Array.from({ length: 24 }, entry),
    })),
  ];
  project.site.pages = [home];
  const bytes = Buffer.byteLength(JSON.stringify(project.site));
  expect(bytes).toBeLessThanOrEqual(128 * 1024);
  await studio.getByLabel("Projecto declarativo").fill(JSON.stringify(project));
  await studio
    .getByRole("button", { name: "Validar e aplicar", exact: true })
    .click();
  await expect(
    studio.getByText("Projecto validado e aplicado", { exact: true }),
  ).toBeVisible();
  await publish(studio);
  await studio
    .getByRole("button", { name: "Ver histórico", exact: true })
    .click();
  await page.evaluate(() => {
    (window as any).inspectionBudget.hold = true;
  });
  await studio.getByRole("button", { name: /^Ver versão 1:/ }).click();
  const visit = page.getByRole("dialog", {
    name: "Página de Autora da página extensa",
    exact: true,
  });
  try {
    await expect(visit.locator(".site-resource")).toHaveCount(123);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const c = (window as any).inspectionBudget;
          return c.posted > 0 && c.held === c.posted;
        }),
      )
      .toBe(true);
    const pending = await page.evaluate(
      () => (window as any).inspectionBudget.posted,
    );
    expect(pending).toBeLessThan(64);
    await visit.getByRole("button", { name: "Fechar", exact: true }).click();
    await studio.getByRole("button", { name: /^Ver versão 1:/ }).click();
    await expect(visit.locator(".site-resource")).toHaveCount(123);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    // Closing cancels waiting work, but cannot release active request slots early.
    expect(
      await page.evaluate(() => (window as any).inspectionBudget.posted),
    ).toBe(pending);
    await page.evaluate(() => (window as any).releaseInspections());
    await expect(
      visit
        .locator(".resource-status")
        .filter({ hasText: "Disponível neste dispositivo" }),
    ).toHaveCount(123);
    await expect(visit.getByRole("alert")).toHaveCount(0);
    await visit
      .getByRole("button", { name: "Obter ficheiro", exact: true })
      .last()
      .click();
    await expect(
      visit.getByRole("link", { name: /Guardar ficheiro/ }),
    ).toHaveCount(1);
    const download = page.waitForEvent("download");
    await visit.getByRole("link", { name: /Guardar ficheiro/ }).click();
    await (await download).saveAs(out + "/received.txt");
    expect(readFileSync(out + "/received.txt").toString()).toBe(
      "ONE_VERIFIED_RESOURCE_MANY_REFERENCES",
    );
    const budget = await page.evaluate(() => (window as any).inspectionBudget);
    expect(budget.posted).toBe(pending + 123);
    expect(budget.peak).toBeLessThan(64);
    writeFileSync(out + "/cancellation.json", JSON.stringify(budget, null, 2));
  } finally {
    const status = await visit.locator(".resource-status").allTextContents();
    const errors = await visit.getByRole("alert").allTextContents();
    writeFileSync(
      out + "/result.json",
      JSON.stringify(
        {
          blocks: 128,
          resourceBlocks: 123,
          distinctResources: 1,
          documentBytes: bytes,
          statusCounts: status.reduce(
            (acc: any, value: string) => ({
              ...acc,
              [value]: (acc[value] ?? 0) + 1,
            }),
            {},
          ),
          errors,
        },
        null,
        2,
      ),
    );
    await page.screenshot({ path: out + "/reader.png" });
  }
});
