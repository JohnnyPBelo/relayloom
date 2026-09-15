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

test("both pending outboxes deliver after completing signalling; modes stay separate and diagnostics contain no secrets", async ({
  browser,
}, info) => {
  const ca = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const cb = await browser.newContext();
  const a = await ca.newPage(),
    b = await cb.newPage();
  const out = `.cache/connectivity/${info.project.name || "chromium"}`;
  mkdirSync(out, { recursive: true });
  try {
    const alice = await enter(a, "Alice ligação"),
      bruno = await enter(b, "Bruno ligação");
    await contact(a, bruno);
    await contact(b, alice);
    await rows(a)
      .getByRole("button", { name: /Bruno ligação/ })
      .click();
    await rows(b)
      .getByRole("button", { name: /Alice ligação/ })
      .click();
    await send(a, "Mensagem pendente de Alice");
    await send(b, "Mensagem pendente de Bruno");
    for (const p of [a, b]) {
      await expect(p.getByText(/Sem dispositivos ligados/)).toBeVisible();
      await expect(
        p.getByRole("button", { name: "Estado do envio: Em espera" }),
      ).toBeVisible();
      await nav(p, "A rede");
      await p
        .getByRole("button", { name: "Ligar um par", exact: true })
        .click();
    }
    // Contact card is not SDP, and its rejection must not discard either outbox.
    await b.getByRole("tab", { name: "Receber código" }).click();
    await b.getByLabel("Código de ligação recebido").fill(alice);
    await b
      .getByRole("button", { name: "Criar resposta", exact: true })
      .click();
    await expect(b.getByRole("alert")).toContainText(
      "Um cartão de contacto não abre uma ligação",
    );
    await a.getByRole("button", { name: "Criar código de ligação" }).click();
    const offer = await a.getByLabel("Código para partilhar").inputValue();
    await audit(a, out + "/mobile-offer");
    await a.getByRole("tab", { name: "Receber código" }).click();
    await expect(a.getByLabel("Código para partilhar")).toHaveCount(0);
    await a
      .getByLabel("Código de ligação recebido")
      .fill("rascunho independente");
    await a.getByRole("tab", { name: "Criar ligação", exact: true }).click();
    await expect(a.getByLabel("Código para partilhar")).toHaveValue(offer);
    await expect(a.getByLabel("Resposta do outro dispositivo")).toHaveValue("");
    await b.getByLabel("Código de ligação recebido").fill(offer);
    await b
      .getByRole("button", { name: "Criar resposta", exact: true })
      .click();
    const answer = await b.getByLabel("Código para partilhar").inputValue();
    await expect(
      b.getByRole("status").filter({ hasText: "Falta colá-la" }),
    ).toBeVisible();
    await expect(
      b.getByRole("button", { name: "Criar resposta", exact: true }),
    ).toBeDisabled();
    await audit(b, out + "/answer-pending");
    await a.getByLabel("Resposta do outro dispositivo").fill(answer);
    await a.getByRole("button", { name: "Concluir ligação" }).click();
    for (const p of [a, b]) {
      await expect(
        p.getByText("Ligação estabelecida. Já podem trocar conteúdo."),
      ).toBeVisible();
      await p.getByText("Diagnóstico desta ligação", { exact: true }).click();
      const value = JSON.parse(
        await p.getByLabel("Diagnóstico sem dados pessoais").innerText(),
      );
      expect(Object.keys(value).sort()).toEqual(
        [
          "version",
          "connection",
          "ice",
          "gathering",
          "signalling",
          "channel",
          "closed",
          "reason",
          "sent",
          "received",
        ].sort(),
      );
      expect(value.channel).toBe("open");
      expect(value.closed).toBe(false);
      writeFileSync(
        out + `/diagnostic-${p === a ? "a" : "b"}.json`,
        JSON.stringify(value, null, 2),
      );
      await p
        .getByRole("dialog")
        .getByRole("button", { name: "Fechar", exact: true })
        .click();
      await nav(p, "Conversas");
      await expect(
        p
          .locator(".bubble")
          .getByText("Mensagem pendente de Alice", { exact: true }),
      ).toHaveCount(1);
      await expect(
        p
          .locator(".bubble")
          .getByText("Mensagem pendente de Bruno", { exact: true }),
      ).toHaveCount(1);
      await expect(
        p.getByRole("button", { name: /^Estado do envio: (Recebida|Lida)$/ }),
      ).toBeVisible();
      await expect(p.getByText(/Sem dispositivos ligados/)).toHaveCount(0);
    }
    // Explicit restart of an unfinished attempt releases its resources.
    await nav(a, "A rede");
    await a.getByRole("button", { name: "Ligar um par", exact: true }).click();
    await a.getByRole("button", { name: "Criar código de ligação" }).click();
    await a.getByRole("button", { name: "Recomeçar ligação" }).click();
    await expect(a.getByLabel("Código para partilhar")).toHaveCount(0);
    await expect(
      a.getByRole("button", { name: "Criar código de ligação" }),
    ).toBeVisible();
    await a.getByRole("button", { name: "Criar código de ligação" }).click();
    await expect(a.locator(".peer-row:not(.head)")).toHaveCount(2);
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "Fechar", exact: true })
      .click();
    await expect(a.locator(".peer-row:not(.head)")).toHaveCount(1);
    await nav(a, "Conversas");
    await expect(
      a
        .locator(".bubble")
        .getByText("Mensagem pendente de Bruno", { exact: true }),
    ).toHaveCount(1);
  } finally {
    await ca.close();
    await cb.close();
  }
});

test("closing while a code is being generated releases the late pending peer", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const create = RTCPeerConnection.prototype.createOffer;
    RTCPeerConnection.prototype.createOffer = async function (this: RTCPeerConnection, ...args: any[]) {
      await new Promise((done) => setTimeout(done, 2000));
      return (create as any).apply(this, args);
    } as typeof create;
  });
  const page = await context.newPage();
  try {
    await enter(page, "Convite em preparação");
    await nav(page, "A rede");
    await page
      .getByRole("button", { name: "Ligar um par", exact: true })
      .click();
    await page.getByRole("button", { name: "Criar código de ligação" }).click();
    await expect(page.locator(".peer-row:not(.head)")).toHaveCount(1);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Fechar", exact: true })
      .click();
    await expect(page.locator(".peer-row:not(.head)")).toHaveCount(0, {
      timeout: 6000,
    });
  } finally {
    await context.close();
  }
});
