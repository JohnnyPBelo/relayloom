import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { appHost } from "./app-host";
const password = "frase sintética dos contactos relay";
let host: Awaited<ReturnType<typeof appHost>> | undefined;
let url = "";
const requests: { url: string; method: string }[] = [];
test.beforeAll(async () => {
  const remote = process.env.RELAYLOOM_LAUNCH_URL?.replace(/\/$/, "");
  if (remote) {
    if (new URL(remote).protocol !== "https:")
      throw new Error("A public test requires HTTPS");
    url = remote;
  } else {
    host = await appHost();
    url = host.url;
  }
});
test.afterAll(async () => {
  await host?.close();
  expect(
    requests.every(
      (r) =>
        r.method === "GET" &&
        r.url.startsWith(url + "/") &&
        !r.url.includes("/api/"),
    ),
  ).toBe(true);
});
async function nav(p: Page, name: string) {
  const button = p.getByRole("button", { name, exact: true });
  if (!(await button.isVisible()))
    await p
      .getByRole("button", { name: "Abrir navegação", exact: true })
      .click();
  await button.click();
}
async function enter(p: Page, name: string) {
  p.on("request", (request) =>
    requests.push({ url: request.url(), method: request.method() }),
  );
  await p.goto(url + "/browser/index.html");
  await p.getByRole("button", { name: "Começar", exact: true }).click();
  await p.getByLabel("Como te chamas?").fill(name);
  await p.getByLabel("Frase-passe", { exact: true }).fill(password);
  await p
    .getByRole("button", { name: "Criar identidade", exact: true })
    .click();
  await expect(
    p.getByRole("heading", { name: "As tuas conversas" }),
  ).toBeVisible();
  await nav(p, "Definições");
  return p.getByLabel("Cartão público da identidade").inputValue();
}
async function unlock(p: Page) {
  await p.getByLabel("Frase-passe", { exact: true }).fill(password);
  await p.getByRole("button", { name: "Entrar na minha rede" }).click();
  await expect(
    p.getByRole("heading", { name: "As tuas conversas" }),
  ).toBeVisible();
}
async function contact(p: Page, card: string) {
  await nav(p, "Conversas");
  await p
    .getByRole("button", { name: "Adicionar contacto", exact: true })
    .click();
  await p.getByLabel("Cartão público do contacto").fill(card);
  await p.getByRole("button", { name: "Verificar e adicionar" }).click();
  await expect(p.getByRole("dialog")).toHaveCount(0);
}
const rows = (p: Page) =>
  p.getByRole("region", { name: "Lista de conversas", exact: true });
async function connect(a: Page, b: Page) {
  for (const p of [a, b]) {
    await nav(p, "A rede");
    await p.getByRole("button", { name: "Ligar um par", exact: true }).click();
  }
  await a.getByRole("button", { name: "Criar código de ligação" }).click();
  const offer = await a.getByLabel("Código para partilhar").inputValue();
  await b.getByRole("tab", { name: "Receber código" }).click();
  await b.getByLabel("Código de ligação recebido").fill(offer);
  await b.getByRole("button", { name: "Criar resposta", exact: true }).click();
  await a
    .getByLabel("Resposta do outro dispositivo")
    .fill(await b.getByLabel("Código para partilhar").inputValue());
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
async function send(p: Page, text: string) {
  await p.getByLabel("Escrever mensagem").fill(text);
  await p.getByRole("button", { name: "Enviar mensagem", exact: true }).click();
}
async function audit(p: Page, path: string) {
  const result = await new AxeBuilder({ page: p })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  writeFileSync(
    path + "-axe.json",
    JSON.stringify(
      { violations: result.violations, passes: result.passes.length },
      null,
      2,
    ),
  );
  expect(result.violations).toEqual([]);
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await p.screenshot({ path: path + ".png", fullPage: true });
  await p.screenshot({ path: path + "-viewport.png", fullPage: false });
}

test("imported contact immediately appears once, survives reload and becomes the first real DM without a duplicate", async ({
  browser,
}, info) => {
  const ca = await browser.newContext({ locale: "pt-PT",
      viewport: { width: 390, height: 844 },
    }),
    cb = await browser.newContext({ locale: "pt-PT" });
  const a = await ca.newPage(),
    b = await cb.newPage();
  const out = `.cache/contact-relay/${info.project.name || "chromium"}/${process.env.RELAYLOOM_PUBLIC_BUILD === "1" ? "public" : "default"}`;
  mkdirSync(out, { recursive: true });
  try {
    await enter(a, "Alice contacto");
    const bruno = await enter(b, "Bruno contacto");
    await nav(a, "Conversas");
    await expect(
      rows(a).getByRole("button", { name: /Bruno contacto/ }),
    ).toHaveCount(0);
    await contact(a, bruno);
    const row = rows(a).getByRole("button", { name: /Bruno contacto/ });
    await expect(row).toBeVisible();
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Contacto guardado");
    await audit(a, out + "/contact-list");
    await contact(a, bruno);
    await expect(row).toHaveCount(1);
    await a.reload();
    await unlock(a);
    await expect(row).toBeVisible();
    await a.getByLabel("Pesquisar conversas e mensagens").fill("Não existe");
    await expect(row).toHaveCount(0);
    await a.getByLabel("Pesquisar conversas e mensagens").fill("Bruno");
    await row.click();
    await expect(a.getByLabel("Escrever mensagem")).toBeVisible();
    await expect(
      a.getByRole("button", { name: "Ligar outro dispositivo", exact: true }),
    ).toBeVisible();
    await a
      .getByLabel("Escrever mensagem")
      .fill("Rascunho antes de uma ligação");
    await nav(a, "A rede");
    const help = a.getByRole("region", { name: "Ajudar a rede", exact: true });
    await expect(
      help.getByRole("checkbox", { name: "Permitir retransmissão" }),
    ).not.toBeChecked();
    await help
      .getByRole("checkbox", { name: "Permitir retransmissão" })
      .check();
    await expect(help.getByRole("status")).toContainText("falta ligar pares");
    await a
      .getByText("Wi-Fi, Bluetooth e outros meios", { exact: true })
      .click();
    await expect(
      help.getByText("Bluetooth directo · por implementar", { exact: true }),
    ).toBeVisible();
    await audit(a, out + "/relay-no-peers");
    await nav(a, "Conversas");
    await expect(a.getByLabel("Escrever mensagem")).toHaveValue(
      "Rascunho antes de uma ligação",
    );
    await send(a, "Primeira mensagem do contacto guardado");
    await expect(
      a.getByRole("button", { name: "Estado do envio: Em espera" }),
    ).toBeVisible();
    await a
      .getByRole("button", { name: "Voltar às conversas", exact: true })
      .click();
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Primeira mensagem");
    await expect(
      rows(a).getByText("Contacto guardado · começar conversa", {
        exact: true,
      }),
    ).toHaveCount(0);
    await a.reload();
    await unlock(a);
    await expect(row).toHaveCount(1);
    await nav(a, "A rede");
    await expect(
      help.getByRole("checkbox", { name: "Permitir retransmissão" }),
    ).toBeChecked();
  } finally {
    await ca.close();
    await cb.close();
  }
});

test("relay consent through the UI gates a real A to B to C path and does not grant B private reading", async ({
  browser,
}, info) => {
  const contexts = [];
  for (let i = 0; i < 3; i++) contexts.push(await browser.newContext({ locale: "pt-PT" }));
  const [a, b, c] = await Promise.all(
    contexts.map((context) => context.newPage()),
  );
  const out = `.cache/contact-relay/${info.project.name || "chromium"}/${process.env.RELAYLOOM_PUBLIC_BUILD === "1" ? "public" : "default"}`;
  mkdirSync(out, { recursive: true });
  try {
    const alice = await enter(a, "Alice origem");
    await enter(b, "Bia relay");
    const carlos = await enter(c, "Carlos destino");
    await contact(a, carlos);
    await contact(c, alice);
    // Only these links are created: A has no connection/signalling exchange with C.
    await connect(a, b);
    await connect(b, c);
    await nav(b, "A rede");
    const relay = b.getByRole("region", { name: "Ajudar a rede", exact: true });
    await expect(
      relay.getByRole("checkbox", { name: "Permitir retransmissão" }),
    ).not.toBeChecked();
    await expect(relay.getByRole("status")).toContainText(
      "2 ligações disponíveis",
    );
    await nav(a, "Conversas");
    await rows(a)
      .getByRole("button", { name: /Carlos destino/ })
      .click();
    await nav(c, "Conversas");
    await rows(c)
      .getByRole("button", { name: /Alice origem/ })
      .click();
    await c
      .getByLabel("Escrever mensagem")
      .fill("Rascunho mantido enquanto chega a primeira mensagem");
    const message = "Só passa quando Bia autoriza a retransmissão.";
    await send(a, message);
    // Observe absence across more than two mesh-sync ticks, with both links open.
    for (let i = 0; i < 5; i++) {
      await new Promise((done) => setTimeout(done, 1000));
      await expect(
        c.locator(".bubble").getByText(message, { exact: true }),
      ).toHaveCount(0);
    }
    await expect(
      a.getByRole("button", { name: "Estado do envio: Em espera" }),
    ).toBeVisible();
    await relay
      .getByRole("checkbox", { name: "Permitir retransmissão" })
      .check();
    await expect(
      c.locator(".bubble").getByText(message, { exact: true }),
    ).toBeVisible();
    await expect(c.getByLabel("Escrever mensagem")).toHaveValue(
      "Rascunho mantido enquanto chega a primeira mensagem",
    );
    await rows(c)
      .getByRole("button", { name: /Alice origem/ })
      .click();
    await expect(c.getByLabel("Escrever mensagem")).toHaveValue(
      "Rascunho mantido enquanto chega a primeira mensagem",
    );
    await send(c, "Resposta na mesma conversa, através da Bia.");
    await expect(
      a
        .locator(".bubble")
        .getByText("Resposta na mesma conversa, através da Bia.", {
          exact: true,
        }),
    ).toBeVisible();
    const id = (await c
      .locator('[id^="message-"]')
      .filter({ hasText: message })
      .getAttribute("id"))!.slice(8);
    await expect
      .poll(async () =>
        Number(
          await b
            .locator(".metrics > div")
            .filter({ hasText: "Pacotes encaminhados" })
            .locator("strong")
            .innerText(),
        ),
      )
      .toBeGreaterThan(0);
    await audit(b, out + "/relay-forwarding");
    await nav(b, "A praça");
    await b
      .getByRole("button", { name: "Obter conteúdo por endereço" })
      .click();
    await b.getByLabel("Endereço do conteúdo").fill(id);
    await b.getByRole("button", { name: "Pedir aos pares" }).click();
    await expect(b.getByRole("dialog").getByRole("alert")).toContainText(
      "não tem autorização para o ler",
    );
    await b
      .getByRole("dialog")
      .getByRole("button", { name: "Fechar", exact: true })
      .click();
    await nav(b, "A rede");
    await relay
      .getByRole("checkbox", { name: "Permitir retransmissão" })
      .uncheck();
    await expect(relay.getByRole("status")).toContainText(
      "Retransmissão em pausa",
    );
    const second = "A pausa também tem de impedir a próxima mensagem.";
    await send(a, second);
    for (let i = 0; i < 5; i++) {
      await new Promise((done) => setTimeout(done, 1000));
      await expect(
        c.locator(".bubble").getByText(second, { exact: true }),
      ).toHaveCount(0);
    }
    await relay
      .getByRole("checkbox", { name: "Permitir retransmissão" })
      .check();
    await expect(
      c.locator(".bubble").getByText(second, { exact: true }),
    ).toBeVisible();
    writeFileSync(
      out + "/relay-control.json",
      JSON.stringify(
        {
          scope: "Three browser contexts on Linux, no physical-radio claim",
          links: ["A-B", "B-C"],
          directAC: false,
          consentViaUI: true,
          pausedBeforeAndAfterPositive: true,
          privateReadRefusedByUI: true,
          draftPreservedOnFirstIncomingDM: true,
          replyUsesTheSameDM: true,
          forwarded: Number(
            await b
              .locator(".metrics > div")
              .filter({ hasText: "Pacotes encaminhados" })
              .locator("strong")
              .innerText(),
          ),
        },
        null,
        2,
      ),
    );
  } finally {
    for (const context of contexts) await context.close();
  }
});
