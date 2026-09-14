import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { appHost } from "./app-host";
import { mkdirSync, writeFileSync } from "node:fs";
const password = "frase de recuperação do navegador";
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
async function contact(page: Page, card: unknown) {
  await nav(page, "Conversas");
  await page
    .getByRole("button", { name: "Adicionar contacto", exact: true })
    .click();
  await page
    .getByLabel("Cartão público do contacto")
    .fill(JSON.stringify(card));
  await page.getByRole("button", { name: "Verificar e adicionar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function network(page: Page) {
  await nav(page, "A rede");
  await page.getByRole("button", { name: "Ligar um par", exact: true }).click();
}
async function audit(page: Page, name: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  mkdirSync(".cache/browser-application/ui", { recursive: true });
  writeFileSync(
    `.cache/browser-application/ui/${name}-axe.json`,
    JSON.stringify(
      { violations: result.violations, passes: result.passes.length },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: `.cache/browser-application/ui/${name}.png`,
    fullPage: true,
  });
  expect(result.violations).toEqual([]);
}

test("autonomous Liquid Glass UI owns identity and offline outbox, connects through real RTC, receives signed confirmations and survives reload", async ({
  browser,
}) => {
  const ca = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    cb = await browser.newContext({ viewport: { width: 390, height: 844 } }),
    a = await ca.newPage(),
    b = await cb.newPage();
  const errors: string[] = [];
  a.on("pageerror", (e) => errors.push(e.message));
  b.on("pageerror", (e) => errors.push(e.message));
  try {
    await enter(a, "Alice autónoma");
    await enter(b, "Bruno autónomo");
    const alice = await card(a),
      bruno = await card(b);
    await contact(a, bruno);
    await contact(b, alice);
    await a.getByRole("button", { name: "Nova conversa", exact: true }).click();
    await a.getByRole("button", { name: /Bruno autónomo/ }).click();
    await a
      .getByLabel("Escrever mensagem")
      .fill("Esta mensagem nasce no navegador, sem daemon.");
    await a
      .getByRole("button", { name: "Enviar mensagem", exact: true })
      .click();
    await expect(
      a.getByRole("button", { name: "Estado do envio: Em espera" }),
    ).toBeVisible();
    await audit(a, "offline-message");
    await network(a);
    await a.getByRole("button", { name: "Criar código de ligação" }).click();
    const offer = await a.getByLabel("Código para partilhar").inputValue();
    expect(JSON.parse(offer).type).toBe("offer");
    await network(b);
    await b.getByRole("tab", { name: "Receber código" }).click();
    await b.getByLabel("Código de ligação recebido").fill(offer);
    await b
      .getByRole("button", { name: "Criar resposta", exact: true })
      .click();
    const answer = await b.getByLabel("Código para partilhar").inputValue();
    expect(JSON.parse(answer).type).toBe("answer");
    await a.getByLabel("Resposta do outro dispositivo").fill(answer);
    await a.getByRole("button", { name: "Concluir ligação" }).click();
    await expect(
      a.getByText("Ligação estabelecida. Já podem trocar conteúdo."),
    ).toBeVisible();
    await audit(a, "peer-linked");
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "Fechar", exact: true })
      .click();
    await b
      .getByRole("dialog")
      .getByRole("button", { name: "Fechar", exact: true })
      .click();
    await nav(b, "Conversas");
    await expect(
      b.getByRole("button", { name: /Alice autónoma.*Esta mensagem/ }),
    ).toBeVisible();
    await b
      .getByRole("button", { name: /Alice autónoma.*Esta mensagem/ })
      .click();
    await expect(
      b
        .locator(".bubble")
        .getByText("Esta mensagem nasce no navegador, sem daemon.", {
          exact: true,
        }),
    ).toBeVisible();
    await nav(a, "Conversas");
    await expect(
      a.getByRole("button", { name: "Estado do envio: Lida", exact: true }),
    ).toBeVisible();
    await audit(b, "received-mobile");
    await a.reload();
    await expect(
      a.getByRole("heading", { name: "Bom ter-te de volta." }),
    ).toBeVisible();
    await a.getByLabel("Frase-passe", { exact: true }).fill(password);
    await a.getByRole("button", { name: "Entrar na minha rede" }).click();
    await expect(
      a.getByRole("heading", { name: "As tuas conversas" }),
    ).toBeVisible();
    await a
      .getByRole("button", { name: /Bruno autónomo.*Esta mensagem/ })
      .click();
    await expect(
      a.getByRole("button", { name: "Estado do envio: Lida", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await ca.close();
    await cb.close();
  }
});

async function connectUI(a: Page, b: Page) {
  await network(a);
  await a.getByRole("button", { name: "Criar código de ligação" }).click();
  const offer = await a.getByLabel("Código para partilhar").inputValue();
  await network(b);
  await b.getByRole("tab", { name: "Receber código" }).click();
  await b.getByLabel("Código de ligação recebido").fill(offer);
  await b.getByRole("button", { name: "Criar resposta", exact: true }).click();
  const answer = await b.getByLabel("Código para partilhar").inputValue();
  await a.getByLabel("Resposta do outro dispositivo").fill(answer);
  await a.getByRole("button", { name: "Concluir ligação" }).click();
  await expect(
    a.getByText("Ligação estabelecida. Já podem trocar conteúdo."),
  ).toBeVisible();
  for (const p of [a, b])
    await p
      .getByRole("dialog")
      .getByRole("button", { name: "Fechar", exact: true })
      .click();
}
async function unlock(page: Page) {
  await page.getByLabel("Frase-passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar na minha rede" }).click();
  await expect(
    page.getByRole("heading", { name: "As tuas conversas" }),
  ).toBeVisible();
}

test("autonomous social actions and safe signed site builder persist and remain viewable after author closes", async ({
  browser,
}) => {
  const ca = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    cb = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    a = await ca.newPage(),
    b = await cb.newPage();
  try {
    await enter(a, "Alice das páginas");
    await enter(b, "Bruno da praça");
    const alice = await card(a),
      bruno = await card(b);
    await contact(a, bruno);
    await contact(b, alice);
    await connectUI(a, b);
    await nav(a, "A praça");
    await a
      .getByRole("button", { name: "Partilhar algo", exact: true })
      .click();
    await a
      .getByLabel("A tua publicação")
      .fill("O jardim voltou a reunir os vizinhos.");
    await a.getByRole("button", { name: "Publicar", exact: true }).click();
    await nav(b, "A praça");
    await expect(
      b.getByText("O jardim voltou a reunir os vizinhos.", { exact: true }),
    ).toBeVisible();
    await b
      .getByRole("button", { name: "Gostar da publicação", exact: true })
      .click();
    await expect(
      a.getByRole("button", { name: "Gostar da publicação", exact: true }),
    ).toContainText("1");
    await b.getByRole("button", { name: "Comentar", exact: true }).click();
    await b
      .getByLabel("Texto", { exact: true })
      .fill("Encontro confirmado na biblioteca.");
    await b.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(
      a.getByText("Encontro confirmado na biblioteca.", { exact: false }),
    ).toBeVisible();
    await b
      .getByRole("button", { name: "Guardar publicação", exact: true })
      .click();
    await nav(b, "Guardados");
    await b
      .getByRole("button", { name: "Criar colecção", exact: true })
      .click();
    await b.getByLabel("Nome da colecção").fill("Encontros locais");
    await b
      .getByRole("button", { name: "Guardar colecção", exact: true })
      .click();
    await nav(b, "A praça");
    await b
      .getByRole("button", { name: "Mais opções da publicação", exact: true })
      .click();
    await b
      .getByRole("checkbox", { name: "Encontros locais", exact: true })
      .check();
    await b
      .getByRole("dialog")
      .getByRole("button", { name: "Fechar", exact: true })
      .click();
    await nav(a, "A minha página");
    await a
      .getByLabel("Título do bloco 1", { exact: true })
      .fill("Um lugar para nos encontrarmos");
    await a
      .getByLabel("Texto do bloco 2", { exact: true })
      .fill(
        "<script>window.remoteScriptRan=true</script> Texto seguro e assinado.",
      );
    const blocks = a.locator(".site-block.editable");
    await blocks.nth(0).dragTo(blocks.nth(1));
    await expect(
      a.getByLabel("Título do bloco 1", { exact: true }),
    ).toHaveValue("Sobre mim");
    await a
      .getByRole("button", { name: "Mover bloco 1 para baixo", exact: true })
      .click();
    await a
      .getByRole("button", { name: "Guardar rascunho", exact: true })
      .click();
    await expect(a.getByRole("status")).toContainText("Rascunho cifrado");
    await a
      .getByRole("button", { name: "Publicar página", exact: true })
      .click();
    await expect(a.getByRole("status")).toContainText("Página assinada");
    await nav(b, "A praça");
    await expect(
      b.getByRole("button", {
        name: "Ver página de Alice das páginas",
        exact: true,
      }),
    ).toBeVisible();
    await audit(a, "autonomous-site-editor");
    await ca.close();
    expect(a.isClosed()).toBe(true);
    await b
      .getByRole("button", {
        name: "Ver página de Alice das páginas",
        exact: true,
      })
      .click();
    await expect(
      b.getByRole("heading", {
        name: "Um lugar para nos encontrarmos",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      b.getByText(
        "<script>window.remoteScriptRan=true</script> Texto seguro e assinado.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      await b.evaluate(() => (window as any).remoteScriptRan),
    ).toBeUndefined();
    await b
      .getByRole("dialog")
      .getByRole("button", { name: "Fechar", exact: true })
      .click();
    await b.reload();
    await unlock(b);
    await nav(b, "Guardados");
    await b
      .locator(".collection-choice")
      .filter({ hasText: "Encontros locais" })
      .click();
    await expect(
      b.getByText("O jardim voltou a reunir os vizinhos.", { exact: true }),
    ).toBeVisible();
    await nav(b, "A praça");
    await b
      .getByRole("button", {
        name: "Ver página de Alice das páginas",
        exact: true,
      })
      .click();
    await expect(
      b.getByRole("heading", {
        name: "Um lugar para nos encontrarmos",
        exact: true,
      }),
    ).toBeVisible();
    await audit(b, "cached-foreign-site");
  } finally {
    await ca.close();
    await cb.close();
  }
});

test("production worker keeps private keys out of replies and recovers an applied send after the UI response is lost", async ({
  browser,
}) => {
  const ca = await browser.newContext(),
    cb = await browser.newContext(),
    a = await ca.newPage(),
    b = await cb.newPage();
  try {
    await a.addInitScript(() => {
      const Original = Worker;
      (window as any).workerPrivateLeak = false;
      (window as any).droppedSend = false;
      const sensitive = (v: any): boolean =>
        !!v &&
        typeof v === "object" &&
        (Object.keys(v).some((k) => k === "signSecret" || k === "boxSecret") ||
          Object.values(v).some(sensitive));
      class Observed extends Original {
        private sendID: number | undefined;
        override postMessage(value: any, ...rest: any[]) {
          if (
            value?.type === "request" &&
            value.domain === "api" &&
            value.operation === "send" &&
            !(window as any).droppedSend
          )
            this.sendID = value.id;
          return super.postMessage(value, ...(rest as [any]));
        }
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.addEventListener("message", (event) => {
            if (sensitive(event.data)) (window as any).workerPrivateLeak = true;
            if (
              event.data?.type === "result" &&
              event.data.id === this.sendID &&
              !(window as any).droppedSend
            ) {
              (window as any).droppedSend = true;
              event.stopImmediatePropagation();
            }
          });
        }
      }
      (window as any).Worker = Observed;
    });
    await enter(a, "Alice com resposta perdida");
    await enter(b, "Bruno de reserva");
    const recipient = await card(b);
    await contact(a, recipient);
    await a.getByRole("button", { name: "Nova conversa", exact: true }).click();
    await a.getByRole("button", { name: /Bruno de reserva/ }).click();
    await a
      .getByLabel("Escrever mensagem")
      .fill("Só uma publicação para este identificador.");
    await a
      .getByRole("button", { name: "Enviar mensagem", exact: true })
      .click();
    await expect(
      a.getByRole("alert").filter({ hasText: "O motor demorou demasiado" }),
    ).toBeVisible({ timeout: 25000 });
    expect(await a.evaluate(() => (window as any).droppedSend)).toBe(true);
    await a
      .getByRole("button", { name: "Enviar mensagem", exact: true })
      .click();
    await expect(a.getByLabel("Escrever mensagem")).toHaveValue("");
    await expect(
      a
        .locator(".bubble")
        .getByText("Só uma publicação para este identificador.", {
          exact: true,
        }),
    ).toHaveCount(1);
    expect(await a.evaluate(() => (window as any).workerPrivateLeak)).toBe(
      false,
    );
    await a
      .getByRole("button", { name: "Bloquear identidade", exact: true })
      .click();
    await expect(
      a.getByRole("heading", { name: "Bom ter-te de volta." }),
    ).toBeVisible();
    await expect(
      a.getByText("Só uma publicação para este identificador.", {
        exact: true,
      }),
    ).toHaveCount(0);
    await unlock(a);
    await a
      .getByRole("button", { name: /Bruno de reserva.*Só uma publicação/ })
      .click();
    await expect(
      a
        .locator(".bubble")
        .getByText("Só uma publicação para este identificador.", {
          exact: true,
        }),
    ).toHaveCount(1);
  } finally {
    await ca.close();
    await cb.close();
  }
});

test("a second tab cannot take ownership of a live application profile and an unknown or corrupt profile is never silently reset", async ({
  browser,
}) => {
  const context = await browser.newContext(),
    a = await context.newPage(),
    b = await context.newPage();
  try {
    await enter(a, "Perfil exclusivo");
    await b.goto(host.url + "/browser/index.html");
    await expect(
      b.getByRole("heading", { name: "Não foi possível abrir este perfil" }),
    ).toBeVisible();
    await expect(
      b.getByText(/Este perfil já está aberto noutro separador/),
    ).toBeVisible();
    await a.close();
    await b.reload();
    await expect(
      b.getByRole("heading", { name: "Bom ter-te de volta." }),
    ).toBeVisible();
    await unlock(b);
    await b
      .getByRole("button", { name: "Bloquear identidade", exact: true })
      .click();
    await b.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("relayloom-web-v1");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("profile", "readwrite"),
          store = tx.objectStore("profile"),
          r = store.get("state");
        r.onsuccess = () => {
          const row = r.result;
          row.sealed.tag = "AAAAAAAAAAAAAAAAAAAAAA==";
          store.put(row, "state");
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    });
    await b.reload();
    await b.getByLabel("Frase-passe", { exact: true }).fill(password);
    await b.getByRole("button", { name: "Entrar na minha rede" }).click();
    await expect(b.getByRole("alert")).toBeVisible();
    await expect(b.getByLabel("Como te chamas?")).toHaveCount(0);
    await expect(
      b.getByRole("heading", { name: "As tuas conversas" }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("cached application code and encrypted profile reopen when the static host is unavailable, without installing the PWA", async ({
  browser,
  request,
}) => {
  const context = await browser.newContext(),
    page = await context.newPage();
  try {
    await enter(page, "Sem instalação");
    await nav(page, "A minha página");
    await page
      .getByLabel("Título do bloco 1", { exact: true })
      .fill("Uma página disponível offline");
    await page
      .getByRole("button", { name: "Guardar rascunho", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Rascunho cifrado");
    await expect(page.locator("html")).toHaveAttribute(
      "data-offline-assets",
      "ready",
    );
    expect(
      await page.evaluate(() =>
        navigator.serviceWorker.controller?.scriptURL.endsWith(
          "/browser/sw.js",
        ),
      ),
    ).toBe(true);
    const before = await request.get(host.url + "/browser/index.html");
    expect(before.status()).toBe(200);
    host.setUnavailable(true);
    const negative = await request.get(host.url + "/browser/index.html");
    expect(negative.status()).toBe(503);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Bom ter-te de volta." }),
    ).toBeVisible();
    await unlock(page);
    await nav(page, "A minha página");
    await expect(
      page.getByLabel("Título do bloco 1", { exact: true }),
    ).toHaveValue("Uma página disponível offline");
    const cached = await page.evaluate(async () => {
      const result: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const entry of await cache.keys())
          result.push(new URL(entry.url).pathname);
      }
      return result;
    });
    expect(
      cached.every(
        (path) => path.startsWith("/assets/") || path.startsWith("/browser/"),
      ),
    ).toBe(true);
    expect(cached.some((path) => path.startsWith("/api/"))).toBe(false);
    await audit(page, "offline-application");
  } finally {
    host.setUnavailable(false);
    await context.close();
  }
});

test("corrupted cached worker is rejected offline and recovered only from verified available code", async ({
  browser,
}) => {
  const context = await browser.newContext(),
    page = await context.newPage();
  try {
    await enter(page, "Código verificado");
    await expect(page.locator("html")).toHaveAttribute(
      "data-offline-assets",
      "ready",
    );
    await page.evaluate(async () => {
      const name = (await caches.keys()).find((name) =>
          name.startsWith("relayloom-browser-assets-"),
        )!,
        cache = await caches.open(name),
        requests = await cache.keys(),
        worker = requests.find((request) =>
          /\/browser\/worker-.*\.js$/.test(new URL(request.url).pathname),
        )!;
      await cache.put(
        worker,
        new Response(
          'self.postMessage({type:"boot-error",error:"Unverified cache executed"})',
          { headers: { "Content-Type": "text/javascript" } },
        ),
      );
    });
    host.setUnavailable(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Não foi possível abrir este perfil" }),
    ).toBeVisible();
    await expect(
      page.getByText("O motor do navegador não iniciou"),
    ).toBeVisible();
    await expect(page.getByText("Unverified cache executed")).toHaveCount(0);
    host.setUnavailable(false);
    await page
      .getByRole("button", { name: "Tentar novamente", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Bom ter-te de volta." }),
    ).toBeVisible();
    await unlock(page);
  } finally {
    host.setUnavailable(false);
    await context.close();
  }
});
