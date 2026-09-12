import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { launch, password, until, type Client } from "../helpers";

const runtime = process.env.RELAYLOOM_TEST_BACKEND === "native" ? "go" : "node";
const evidence = `docs/evidence/outbox/${runtime}`;
async function pair() {
  const a = await launch(),
    b = await launch();
  await a.call("setup", { name: "Alice dos Envios", password });
  await b.call("setup", { name: "Bruno dos Envios", password });
  const alice = (await a.call("state")).identity,
    bob = (await b.call("state")).identity;
  await a.call("contact", { contact: bob });
  await b.call("contact", { contact: alice });
  return { a, b, alice, bob };
}
async function compose(page: Page, a: Client, text: string) {
  await page.goto(a.url + "/#token=" + a.token);
  await page
    .getByRole("button", { name: "Nova conversa", exact: true })
    .click();
  await page.getByRole("button", { name: /Bruno dos Envios/ }).click();
  await page.getByLabel("Escrever mensagem").fill(text);
}
async function audit(page: Page, name: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  mkdirSync(evidence, { recursive: true });
  writeFileSync(
    `${evidence}/${name}-axe.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        violations: result.violations,
        passed: result.passes.length,
      },
      null,
      2,
    ),
  );
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
}
async function cleanup(clients: Client[]) {
  const results = await Promise.allSettled(clients.map((c) => c.stop()));
  for (const dir of new Set(clients.map((c) => c.dir)))
    rmSync(dir, { recursive: true, force: true });
  expect(results.filter((r) => r.status === "rejected")).toEqual([]);
}

test("durable composer retries a lost response once, survives restart, and shows distinct real received/read states", async ({
  page,
  browser,
}) => {
  const { a, b, bob } = await pair();
  let current = a;
  const clients = [a, b];
  const message = "Fica guardada até haver caminho.";
  try {
    await a.call("settings", { relay: false });
    await compose(page, a, message);
    await page.getByLabel("Prazo da mensagem").selectOption(String(3600_000));
    const operations: string[] = [];
    let lose = true;
    await page.route("**/api/send", async (route) => {
      operations.push(route.request().postDataJSON().operationId);
      if (lose) {
        lose = false;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("Escrever mensagem")).toHaveValue(message);
    const first = (await a.call("state")).outbox[0];
    expect(first.status).toBe("pending");
    expect(first.expires - first.created).toBe(3600_000);
    await page.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect(page.getByLabel("Escrever mensagem")).toHaveValue("");
    expect(operations).toHaveLength(2);
    expect(new Set(operations).size).toBe(1);
    expect((await a.call("state")).outbox).toHaveLength(1);
    await page.getByRole("button", { name: "Estado dos envios" }).click();
    const card = page.getByRole("dialog").getByRole("button", {
      name: new RegExp(message.replaceAll(".", "\\.")),
    });
    await page.getByLabel("Filtrar envios").focus();
    await page.keyboard.press("Tab");
    await expect(card).toBeFocused();
    expect(
      await card.evaluate((element) => element.matches(":focus-visible")),
    ).toBe(true);
    await audit(page, "keyboard-focus");
    await page.keyboard.press("Space");
    await expect(card).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByText("Sem confirmação", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Tentar novamente" })
      .click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      "O envio continua guardado",
    );
    expect((await a.call("state")).outbox[0].attempts).toBe(0);
    await audit(page, "pending-light");
    await page.getByRole("button", { name: "Fechar", exact: true }).click();
    await page.getByRole("button", { name: "Alternar tema" }).click();
    await page.getByRole("button", { name: "Estado dos envios" }).click();
    await audit(page, "pending-dark");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await audit(page, "pending-mobile");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Fechar", exact: true }).click();
    await a.stop();
    current = await launch(a.dir, Number(new URL(a.url).port));
    clients.push(current);
    await page.goto(current.url + "/#token=" + current.token);
    await page.getByLabel("Frase-passe", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar na minha rede" }).click();
    await page.getByRole("button", { name: "Estado dos envios" }).click();
    await expect(
      page.getByRole("dialog").getByText(message, { exact: true }),
    ).toBeVisible();
    expect((await current.call("state")).settings.relay).toBe(false);
    expect((await current.call("state")).outbox[0].id).toBe(first.id);
    await current.call("connect", { host: "127.0.0.1", port: b.tcpPort });
    await until(
      () => current.call("state"),
      (s) => s.outbox[0].status === "received",
      20_000,
    );
    await expect(
      page.getByRole("dialog").getByText("Recebida", { exact: true }),
    ).toBeVisible();
    expect((await current.call("state")).outbox[0].readCount).toBe(0);
    const reader = await browser.newPage();
    try {
      await reader.goto(b.url + "/#token=" + b.token);
      await reader
        .getByRole("button", { name: /Alice dos Envios.*Fica guardada/ })
        .click();
      await expect(
        reader.locator(".bubble").getByText(message, { exact: true }),
      ).toBeVisible();
      await until(
        () => current.call("state"),
        (s) => s.outbox[0].status === "read",
      );
      await expect(
        page.getByRole("dialog").getByText("Lida", { exact: true }),
      ).toBeVisible();
      const item = (await current.call("state")).outbox[0];
      expect(item.recipients[0].id).toBe(bob.id);
      expect(item.receivedCount).toBe(1);
      expect(item.readCount).toBe(1);
      mkdirSync(evidence, { recursive: true });
      writeFileSync(
        `${evidence}/durable-send.json`,
        JSON.stringify(
          {
            result: "pass",
            runtime,
            lostResponseSameOperation: true,
            originalContentIdAfterRestart: true,
            relayDisabledOwnRetry: true,
            receivedWithoutReadControl: true,
            realReaderUIRead: true,
            physicalDevice: false,
          },
          null,
          2,
        ),
      );
    } finally {
      await reader.close();
    }
  } finally {
    await cleanup(clients);
  }
});

test("expired pending sends remain visible without delivery, and locking clears the outbox UI", async ({
  page,
}) => {
  const { a, b, bob } = await pair();
  try {
    const sent = await a.call("send", {
      operationId: randomUUID(),
      content: { type: "message", text: "Prazo curto durante a partição" },
      recipients: [bob.id],
      ttlMs: 1000,
    });
    await until(
      () => a.call("state"),
      (s) => s.outbox[0].status === "expired",
    );
    await page.goto(a.url + "/#token=" + a.token);
    await page.getByRole("button", { name: "Estado dos envios" }).click();
    await page
      .getByRole("button", { name: /Prazo curto durante a partição/ })
      .click();
    await expect(
      page.getByText("Prazo terminado", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/O conteúdo já não está disponível neste nó/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Tentar novamente" }),
    ).toHaveCount(0);
    await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
    await delay(2600);
    expect(
      (await b.call("state")).objects.some((o: any) => o.id === sent.id),
    ).toBe(false);
    await audit(page, "expired");
    await page.getByRole("button", { name: "Fechar", exact: true }).click();
    await page.getByRole("button", { name: "Bloquear identidade" }).click();
    await expect(
      page.getByRole("heading", { name: "Bom ter-te de volta." }),
    ).toBeVisible();
    await expect(
      page.getByText("Prazo curto durante a partição", { exact: true }),
    ).toHaveCount(0);
    expect((await a.call("state")).outbox).toEqual([]);
  } finally {
    await cleanup([a, b]);
  }
});

test("an absent record after an uncertain response requires an explicit new-send choice", async ({
  page,
}) => {
  const { a, b } = await pair();
  try {
    await compose(
      page,
      a,
      "Uma resposta incerta não cria duplicados em silêncio.",
    );
    const operations: string[] = [];
    let reject = true;
    await page.route("**/api/send", async (route) => {
      operations.push(route.request().postDataJSON().operationId);
      if (reject) {
        reject = false;
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    expect((await a.call("state")).outbox).toHaveLength(0);
    await page.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect(
      page.getByRole("button", { name: "Preparar um novo envio" }),
    ).toBeVisible();
    expect(operations).toHaveLength(1);
    await page.getByRole("button", { name: "Preparar um novo envio" }).click();
    await page.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect(page.getByLabel("Escrever mensagem")).toHaveValue("");
    expect(operations).toHaveLength(2);
    expect(new Set(operations).size).toBe(2);
    expect((await a.call("state")).outbox).toHaveLength(1);
  } finally {
    await cleanup([a, b]);
  }
});

test("legacy group read labels count unique recipients without retained outbox metadata", async ({
  page,
}) => {
  const { a, b, alice, bob } = await pair(),
    c = await launch(),
    clients = [a, b, c];
  try {
    await c.call("setup", { name: "Carla dos Envios", password });
    const carla = (await c.call("state")).identity;
    await a.call("contact", { contact: carla });
    await c.stop();
    await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
    const group = await a.call("publish", {
      content: { type: "group", title: "Histórico do grupo" },
      recipients: [bob.id, carla.id],
    });
    const message = await a.call("publish", {
      content: {
        type: "message",
        conversation: group.id,
        text: "Confirmações independentes no histórico",
      },
      recipients: [bob.id, carla.id],
    });
    await until(
      () => b.call("state"),
      (s) => s.objects.some((o: any) => o.id === message.id),
    );
    await b.call("view", { id: message.id });
    await until(
      () => a.call("state"),
      (s) =>
        s.objects.some(
          (o: any) => o.kind === "receipt" && o.content.target === message.id,
        ),
    );
    expect((await a.call("state")).outbox).toHaveLength(0);
    await page.goto(a.url + "/#token=" + a.token);
    await page
      .getByRole("button", {
        name: /Histórico do grupo.*Confirmações independentes/,
      })
      .click();
    const bubble = page
      .locator(".message")
      .filter({ hasText: "Confirmações independentes no histórico" });
    await expect(
      bubble.getByText("Lida por 1 de 2", { exact: true }),
    ).toBeVisible();
    await expect(bubble.getByText("Lida", { exact: true })).toHaveCount(0);
    await b.call("publish", {
      content: { type: "receipt", target: message.id },
      recipients: [alice.id, bob.id, carla.id],
    });
    await until(
      () => a.call("state"),
      (s) =>
        s.objects.filter(
          (o: any) => o.kind === "receipt" && o.content.target === message.id,
        ).length >= 2,
    );
    await expect(
      bubble.getByText("Lida por 1 de 2", { exact: true }),
    ).toBeVisible();
    const resumed = await launch(c.dir);
    clients.push(resumed);
    await resumed.call("unlock", { password });
    await resumed.call("connect", { host: "127.0.0.1", port: b.tcpPort });
    await until(
      () => resumed.call("state"),
      (s) => s.objects.some((o: any) => o.id === message.id),
    );
    await resumed.call("view", { id: message.id });
    await expect(bubble.getByText("Lida", { exact: true })).toBeVisible();
    await audit(page, "legacy-group-read");
  } finally {
    await cleanup(clients);
  }
});
