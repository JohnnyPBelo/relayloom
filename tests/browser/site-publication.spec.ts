import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { appHost } from "./app-host";
import { mkdirSync, writeFileSync } from "node:fs";
const password = "site publication UI fixture passphrase";
let host: Awaited<ReturnType<typeof appHost>>;
test.beforeAll(async () => {
  host = await appHost();
});
test.afterAll(async () => {
  await host.close();
  expect(host.requests.some((p) => p.startsWith("/api/"))).toBe(false);
});
async function enter(page: Page, name: string, recovery?: string) {
  await page.goto(host.url + "/browser/index.html");
  await page.getByRole("button", { name: "Começar", exact: true }).click();
  await page.getByLabel("Como te chamas?").fill(name);
  await page.getByLabel("Frase-passe", { exact: true }).fill(password);
  if (recovery) {
    await page
      .getByText("Já tenho uma cópia de recuperação", { exact: true })
      .click();
    await page.getByLabel("Cofre exportado", { exact: true }).fill(recovery);
  }
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
async function pageOf(page: Page, name: string) {
  await nav(page, "A praça");
  await page
    .getByRole("button", { name: "Ver página de " + name, exact: true })
    .click();
  return page.getByRole("dialog", { name: "Página de " + name, exact: true });
}
async function history(region: Locator) {
  await region
    .getByRole("button", { name: "Ver histórico", exact: true })
    .click();
  await expect(
    region.getByRole("heading", { name: "Publicações deste site" }),
  ).toBeVisible();
}
async function close(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Fechar", exact: true })
    .click();
}
async function audit(page: Page, name: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const dir = ".cache/site-editor/ui";
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    `${dir}/${name}-axe.json`,
    JSON.stringify(
      { violations: result.violations, passed: result.passes.length },
      null,
      2,
    ),
  );
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  expect(result.violations).toEqual([]);
}

test("real UI publishes public and private revisions, reads fixed history and restores original privacy without granting readers authorship", async ({
  browser,
}, info) => {
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext({ viewport: { width: 390, height: 844 } }),
  ]);
  const [a, b, c] = await Promise.all(contexts.map((c) => c.newPage()));
  try {
    await enter(a, "Alice das versões");
    await enter(b, "Bruno leitor");
    await enter(c, "Carla pública");
    const alice = await card(a),
      bruno = await card(b),
      carla = await card(c);
    await contact(a, bruno);
    await contact(a, carla);
    await contact(b, alice);
    await contact(c, alice);
    await connect(a, b);
    await connect(a, c);
    await nav(a, "A minha página");
    await publish(a, "Primeira versão pública");
    const address = await studio(a)
      .getByLabel("Endereço permanente do site")
      .inputValue();
    expect(address).toBe("relayloom:site:" + alice.id + "/profile");
    const firstB = await pageOf(b, alice.name);
    await expect(
      firstB.getByRole("heading", {
        name: "Primeira versão pública",
        exact: true,
      }),
    ).toBeVisible();
    const firstC = await pageOf(c, alice.name);
    await expect(
      firstC.getByRole("heading", {
        name: "Primeira versão pública",
        exact: true,
      }),
    ).toBeVisible();
    await studio(a)
      .getByRole("button", { name: /Opções de publicação:/ })
      .click();
    await studio(a)
      .getByLabel("Quem pode ler o site", { exact: true })
      .selectOption("private");
    await studio(a)
      .getByRole("group", { name: "Leitores privados do site", exact: true })
      .getByRole("checkbox", { name: bruno.name, exact: true })
      .check();
    await studio(a)
      .getByLabel("Prazo desta publicação", { exact: true })
      .selectOption("86400000");
    await publish(a, "Segunda versão só para Bruno");
    await expect(
      firstB.getByRole("heading", {
        name: "Segunda versão só para Bruno",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      firstC.getByRole("heading", {
        name: "Primeira versão pública",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      firstC.getByText("Segunda versão só para Bruno", { exact: true }),
    ).toHaveCount(0);
    await history(firstB);
    await expect(
      firstB.getByRole("button", { name: /^Ver versão 2:/ }),
    ).toBeVisible();
    await expect(
      firstB.getByRole("button", { name: /Recuperar versão/ }),
    ).toHaveCount(0);
    await firstB.getByRole("button", { name: /^Ver versão 1:/ }).click();
    await expect(
      firstB.getByRole("heading", {
        name: "Primeira versão pública",
        exact: true,
      }),
    ).toBeVisible();
    await firstB
      .getByRole("button", { name: "Ver versão actual", exact: true })
      .click();
    await expect(
      firstB.getByRole("heading", {
        name: "Segunda versão só para Bruno",
        exact: true,
      }),
    ).toBeVisible();
    await history(studio(a));
    await studio(a)
      .getByRole("button", { name: /^Recuperar versão 1:/ })
      .click();
    const review = a.getByRole("dialog", {
      name: "Recuperar uma versão anterior",
      exact: true,
    });
    await expect(
      review.getByRole("heading", {
        name: "Primeira versão pública",
        exact: true,
      }),
    ).toBeVisible();
    await review
      .getByRole("button", {
        name: "Substituir rascunho por esta versão",
        exact: true,
      })
      .click();
    await expect(review).toHaveCount(0);
    await expect(
      studio(a).getByLabel("Título do bloco 1", { exact: true }),
    ).toHaveValue("Primeira versão pública");
    await expect(
      studio(a).getByRole("button", {
        name: "Opções de publicação: Público",
        exact: true,
      }),
    ).toBeVisible();
    await publish(a, "Terceira versão pública restaurada");
    await expect(
      firstB.getByRole("heading", {
        name: "Terceira versão pública restaurada",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      firstC.getByRole("heading", {
        name: "Terceira versão pública restaurada",
        exact: true,
      }),
    ).toBeVisible();
    await history(studio(a));
    await studio(a)
      .getByRole("button", { name: /^Recuperar versão 2:/ })
      .click();
    const privateReview = a.getByRole("dialog", {
      name: "Recuperar uma versão anterior",
      exact: true,
    });
    await expect(
      privateReview.getByRole("heading", {
        name: "Segunda versão só para Bruno",
        exact: true,
      }),
    ).toBeVisible();
    await privateReview
      .getByRole("button", {
        name: "Substituir rascunho por esta versão",
        exact: true,
      })
      .click();
    await expect(privateReview).toHaveCount(0);
    await expect(
      studio(a).getByRole("button", {
        name: "Opções de publicação: Privado · 2 leitores",
        exact: true,
      }),
    ).toBeVisible();
    await publish(a, "Quarta versão recuperada em privado");
    await expect(
      firstB.getByRole("heading", {
        name: "Quarta versão recuperada em privado",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      firstC.getByRole("heading", {
        name: "Terceira versão pública restaurada",
        exact: true,
      }),
    ).toBeVisible();
    await audit(b, `${info.project.name || "chromium"}-private-reader`);
    await a.evaluate(() => window.scrollTo(0, 0));
    await audit(a, `${info.project.name || "chromium"}-editor`);
    await a.reload();
    await a.getByLabel("Frase-passe", { exact: true }).fill(password);
    await a
      .getByRole("button", { name: "Entrar na minha rede", exact: true })
      .click();
    await expect(
      a.getByRole("heading", { name: "As tuas conversas" }),
    ).toBeVisible();
    await nav(a, "A minha página");
    await expect(
      studio(a).getByLabel("Título do bloco 1", { exact: true }),
    ).toHaveValue("Quarta versão recuperada em privado");
    await expect(
      studio(a).getByRole("button", {
        name: "Opções de publicação: Privado · 2 leitores",
        exact: true,
      }),
    ).toBeVisible();
    await history(studio(a));
    await expect(
      studio(a).getByRole("button", { name: /^Ver versão / }),
    ).toHaveCount(4);
    expect(
      await studio(a).getByLabel("Endereço permanente do site").inputValue(),
    ).toBe(address);
  } finally {
    for (const context of contexts) await context.close();
  }
});

test("two user-restored identities preserve a visible fork until the UI explicitly reviews and confirms all versions", async ({
  browser,
}, info) => {
  const ca = await browser.newContext(),
    cb = await browser.newContext(),
    a = await ca.newPage(),
    b = await cb.newPage();
  try {
    await enter(a, "Identidade em dois dispositivos");
    await nav(a, "Definições");
    await a
      .getByRole("button", {
        name: "Exportar cofre de recuperação",
        exact: true,
      })
      .click();
    await a.getByLabel("Frase-passe para esta cópia").fill(password);
    const download = a.waitForEvent("download");
    await a
      .getByRole("button", { name: "Descarregar cofre cifrado", exact: true })
      .click();
    const stream = await (await download).createReadStream();
    if (!stream) throw Error("Recovery download unavailable");
    const pieces: Buffer[] = [];
    for await (const piece of stream) pieces.push(Buffer.from(piece));
    const recovery = Buffer.concat(pieces).toString("utf8");
    await enter(b, "Nome ignorado na recuperação", recovery);
    const acard = await card(a),
      bcard = await card(b);
    expect(bcard.id).toBe(acard.id);
    await nav(a, "A minha página");
    await publish(a, "Ramo do primeiro dispositivo");
    await nav(b, "A minha página");
    await publish(b, "Ramo do segundo dispositivo");
    await connect(a, b);
    await nav(a, "A minha página");
    await studio(a)
      .getByRole("button", {
        name: "Verificar estado da publicação",
        exact: true,
      })
      .click();
    await expect(
      studio(a).getByText("Há 2 versões concorrentes", { exact: true }),
    ).toBeVisible();
    await expect(
      studio(a).getByRole("button", { name: "Publicar página", exact: true }),
    ).toBeDisabled();
    await studio(a)
      .getByRole("button", { name: "Comparar versões", exact: true })
      .click();
    const review = a.getByRole("dialog", {
      name: "Escolher a versão de partida",
      exact: true,
    });
    await review
      .getByRole("button", {
        name: "Manter o rascunho e continuar",
        exact: true,
      })
      .click();
    await expect(review).toHaveCount(0);
    await expect(
      studio(a).getByRole("button", { name: "Publicar página", exact: true }),
    ).toBeDisabled();
    await studio(a)
      .getByRole("checkbox", {
        name: "Confirmo que este rascunho resolve todas as versões indicadas",
        exact: true,
      })
      .check();
    await publish(a, "Versão escolhida depois da comparação");
    await expect(
      studio(a).getByText("Há 2 versões concorrentes", { exact: true }),
    ).toHaveCount(0);
    await history(studio(a));
    await expect(
      studio(a).getByRole("button", { name: /^Ver versão 1:/ }),
    ).toHaveCount(2);
    await expect(
      studio(a).getByRole("button", { name: /^Ver versão 2:/ }),
    ).toHaveCount(1);
    await audit(a, `${info.project.name || "chromium"}-resolved-history`);
    await nav(b, "A minha página");
    await studio(b)
      .getByRole("button", {
        name: "Verificar estado da publicação",
        exact: true,
      })
      .click();
    await expect(
      studio(b).getByText("Revê a versão de partida", { exact: true }),
    ).toBeVisible();
    await expect(
      studio(b).getByLabel("Título do bloco 1", { exact: true }),
    ).toHaveValue("Ramo do segundo dispositivo");
    await expect(
      studio(b).getByRole("button", { name: "Publicar página", exact: true }),
    ).toBeDisabled();
  } finally {
    await ca.close();
    await cb.close();
  }
});

test("studio reports local validation, preserves the saved draft and keeps keyboard focus after saving", async ({
  page,
}, info) => {
  await enter(page, "Validação e teclado");
  await nav(page, "A minha página");
  const s = studio(page),
    save = s.getByRole("button", { name: "Guardar rascunho", exact: true });
  await save.click();
  await expect(
    s.getByRole("status", {
      name: "Estado da publicação do site",
      exact: true,
    }),
  ).toContainText("Rascunho cifrado");
  await s.getByLabel("Nome da página", { exact: true }).fill("");
  await save.click();
  await expect(s.getByRole("alert")).toHaveText(
    "Site inválido: endereço ou nome de página",
  );
  await expect(
    s.getByRole("status", {
      name: "Estado da publicação do site",
      exact: true,
    }),
  ).toHaveCount(0);
  await s
    .getByLabel("Nome da página", { exact: true })
    .fill("Página corrigida");
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(
    s.getByRole("status", {
      name: "Estado da publicação do site",
      exact: true,
    }),
  ).toContainText("Rascunho cifrado");
  await expect(save).toBeFocused();
  await audit(page, `${info.project.name || "chromium"}-validation-keyboard`);
  await page.reload();
  await page.getByLabel("Frase-passe", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Entrar na minha rede", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "As tuas conversas" }),
  ).toBeVisible();
  await nav(page, "A minha página");
  await expect(
    studio(page).getByLabel("Nome da página", { exact: true }),
  ).toHaveValue("Página corrigida");
});

test("lost worker publication response keeps the editor frozen and resumes the same version through the UI", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = Worker,
      w = window as any;
    w.sitePublicationRequests = [];
    w.sitePublicationResponseDropped = false;
    class Observed extends Original {
      private publicationID: number | undefined;
      override postMessage(value: any, ...rest: any[]) {
        if (
          value?.type === "request" &&
          value.domain === "api" &&
          value.operation === "site-command" &&
          value.body?.action === "publish"
        ) {
          w.sitePublicationRequests.push({
            operationId: value.body.operationId,
            sequence: value.body.sequence,
          });
          if (!w.sitePublicationResponseDropped) this.publicationID = value.id;
        }
        return super.postMessage(value, ...(rest as [any]));
      }
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event) => {
          if (
            event.data?.type === "result" &&
            event.data.id === this.publicationID &&
            !w.sitePublicationResponseDropped
          ) {
            w.sitePublicationResponseDropped = true;
            event.stopImmediatePropagation();
          }
        });
      }
    }
    w.Worker = Observed;
  });
  await enter(page, "Publicação sem resposta");
  await nav(page, "A minha página");
  const s = studio(page);
  await s
    .getByLabel("Título do bloco 1", { exact: true })
    .fill("Uma única versão, mesmo sem resposta");
  await s.getByRole("button", { name: "Publicar página", exact: true }).click();
  await expect(s.getByRole("alert")).toContainText(
    "O motor demorou demasiado",
    { timeout: 25000 },
  );
  await expect(
    s.getByLabel("Título do bloco 1", { exact: true }),
  ).toBeDisabled();
  await expect(
    s.getByRole("button", { name: "Publicar página", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => (window as any).sitePublicationResponseDropped),
  ).toBe(true);
  await s
    .getByRole("button", {
      name: "Verificar e retomar publicação",
      exact: true,
    })
    .click();
  await expect(
    s.getByRole("status", {
      name: "Estado da publicação do site",
      exact: true,
    }),
  ).toContainText("Página assinada");
  expect(
    await page.evaluate(() => (window as any).sitePublicationRequests.length),
  ).toBe(1);
  await history(s);
  await expect(s.getByRole("button", { name: /^Ver versão / })).toHaveCount(1);
  await page.reload();
  await page.getByLabel("Frase-passe", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Entrar na minha rede", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "As tuas conversas" }),
  ).toBeVisible();
  await nav(page, "A minha página");
  await history(studio(page));
  await expect(
    studio(page).getByRole("button", { name: /^Ver versão / }),
  ).toHaveCount(1);
  await expect(
    studio(page).getByLabel("Título do bloco 1", { exact: true }),
  ).toHaveValue("Uma única versão, mesmo sem resposta");
});

test("application waits for an owned closing lease and never takes a live profile from another tab", async ({
  browser,
}) => {
  const context = await browser.newContext(),
    holder = await context.newPage(),
    app = await context.newPage();
  try {
    await holder.route(host.url + "/__closing_profile__", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="pt"><title>Closing profile fixture</title><body>Owned closing lease</body></html>',
      }),
    );
    await holder.goto(host.url + "/__closing_profile__");
    await holder.evaluate(async () => {
      const w = window as any;
      let acquired!: () => void;
      const ready = new Promise<void>((resolve) => (acquired = resolve));
      w.heldLease = navigator.locks.request(
        "relayloom-application:relayloom-web-v1",
        async () => {
          acquired();
          await new Promise<void>((resolve) => (w.releaseLease = resolve));
        },
      );
      await ready;
    });
    await app.goto(host.url + "/browser/index.html");
    await expect
      .poll(() =>
        holder.evaluate(
          async () =>
            (await navigator.locks.query()).pending?.filter(
              (l) => l.name === "relayloom-application:relayloom-web-v1",
            ).length ?? 0,
        ),
      )
      .toBe(1);
    await expect(
      app.getByRole("button", { name: "Começar", exact: true }),
    ).toHaveCount(0);
    await holder.evaluate(async () => {
      (window as any).releaseLease();
      await (window as any).heldLease;
    });
    await expect(
      app.getByRole("button", { name: "Começar", exact: true }),
    ).toBeVisible();
    await app.getByRole("button", { name: "Começar", exact: true }).click();
    await app.getByLabel("Como te chamas?").fill("Perfil sem sobreposição");
    await app.getByLabel("Frase-passe", { exact: true }).fill(password);
    await app
      .getByRole("button", { name: "Criar identidade", exact: true })
      .click();
    await expect(
      app.getByRole("heading", { name: "As tuas conversas" }),
    ).toBeVisible();
    const before = await app.evaluate(
      async () =>
        (await navigator.locks.query()).held?.find(
          (l) => l.name === "relayloom-application:relayloom-web-v1",
        )?.clientId,
    );
    expect(before).toBeTruthy();
    const duplicate = await context.newPage();
    await duplicate.goto(host.url + "/browser/index.html");
    await expect(
      duplicate.getByText(/Este perfil já está aberto noutro separador/),
    ).toBeVisible();
    expect(
      await app.evaluate(
        async () =>
          (await navigator.locks.query()).held?.find(
            (l) => l.name === "relayloom-application:relayloom-web-v1",
          )?.clientId,
      ),
    ).toBe(before);
    await expect(
      app.getByRole("heading", { name: "As tuas conversas" }),
    ).toBeVisible();
  } finally {
    if (!holder.isClosed())
      await holder
        .evaluate(() => (window as any).releaseLease?.())
        .catch(() => {});
    await context.close();
  }
});

for (const language of [
  {
    code: "en-GB",
    start: "Get started",
    name: "What is your name?",
    password: "Passphrase",
    create: "Create identity",
    conversations: "Your conversations",
    site: "My site",
    studio: "Site studio",
    title: "Block 1 title",
    options: /Publication options:/,
    audience: "Who can read this site",
    lifetime: "Publication lifetime",
    publish: "Publish page",
    status: "Site publication status",
    done: "Page signed and published to P2P storage",
    history: "View history",
    version: /^View version 1:/,
    current: "View current version",
    close: "Close",
    settings: "Settings",
    language: "Application language",
    only: "Publication options: Only you",
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
    title: "Título del bloque 1",
    options: /Opciones de publicación:/,
    audience: "Quién puede leer el sitio",
    lifetime: "Duración de esta publicación",
    publish: "Publicar página",
    status: "Estado de publicación del sitio",
    done: "Página firmada y publicada en el almacenamiento P2P",
    history: "Ver historial",
    version: /^Ver versión 1:/,
    current: "Ver versión actual",
    close: "Cerrar",
    settings: "Ajustes",
    language: "Idioma de la aplicación",
    only: "Opciones de publicación: Solo tú",
  },
])
  test(`publication and history controls work in ${language.code} and keep authored text across a language change`, async ({
    page,
  }, info) => {
    await page.goto(host.url + "/browser/index.html");
    await page
      .getByLabel("Idioma da aplicação", { exact: true })
      .selectOption(language.code);
    await expect(page.locator("html")).toHaveAttribute("lang", language.code);
    await page
      .getByRole("button", { name: language.start, exact: true })
      .click();
    await page
      .getByLabel(language.name, { exact: true })
      .fill("Autora " + language.code);
    await page.getByLabel(language.password, { exact: true }).fill(password);
    await page
      .getByRole("button", { name: language.create, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: language.conversations, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: language.site, exact: true })
      .click();
    const s = page.getByRole("region", { name: language.studio, exact: true }),
      authored = "Texto original: coração e memória 🧶";
    await s.getByLabel(language.title, { exact: true }).fill(authored);
    await s.getByRole("button", { name: language.options }).click();
    await s
      .getByLabel(language.audience, { exact: true })
      .selectOption("private");
    await s
      .getByLabel(language.lifetime, { exact: true })
      .selectOption("86400000");
    await s
      .getByRole("button", { name: language.publish, exact: true })
      .click();
    await expect(
      s.getByRole("status", { name: language.status, exact: true }),
    ).toHaveText(language.done);
    await expect(
      s.getByRole("button", { name: language.only, exact: true }),
    ).toBeVisible();
    await s
      .getByRole("button", { name: language.history, exact: true })
      .click();
    await s.getByRole("button", { name: language.version }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: authored, exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: language.current, exact: true }),
    ).toBeVisible();
    const addressField = dialog.getByLabel(
      language.code === "en-GB"
        ? "Permanent site address"
        : "Dirección permanente del sitio",
      { exact: true },
    );
    expect((await addressField.boundingBox())!.width).toBeGreaterThanOrEqual(
      180,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect((await addressField.boundingBox())!.width).toBeGreaterThanOrEqual(
      180,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await audit(
      page,
      `${info.project.name || "chromium"}-${language.code}-history`,
    );
    await dialog
      .getByRole("button", { name: language.close, exact: true })
      .click();
    await page
      .getByRole("button", { name: language.settings, exact: true })
      .click();
    await page
      .getByLabel(language.language, { exact: true })
      .selectOption("pt-PT");
    await nav(page, "A minha página");
    await expect(
      studio(page).getByLabel("Título do bloco 1", { exact: true }),
    ).toHaveValue(authored);
    await expect(
      studio(page).getByRole("button", {
        name: "Opções de publicação: Só tu",
        exact: true,
      }),
    ).toBeVisible();
  });
