import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { launch, password, until, type Client } from "../helpers";

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

test("shared Liquid Glass UI sends without choosing a medium over TCP and real RNS serial, recovers a partition and receives a reply", async ({
  browser,
}) => {
  const work = mkdtempSync(resolve(".cache/rns-ui-"));
  const bridge = spawn("python3", ["scripts/pty-bridge.py"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  bridge.stderr.on("data", (b) =>
    writeFileSync(join(work, "pty.stderr"), b, { flag: "a" }),
  );
  const clients: Client[] = [];
  const ca = await browser.newContext(),
    cc = await browser.newContext();
  const pa = await ca.newPage(),
    pc = await cc.newPage(),
    errors: string[] = [];
  for (const page of [pa, pc])
    page.on("pageerror", (e) => errors.push(e.message));
  try {
    const paths = await new Promise<{ left: string; right: string }>(
      (accept, reject) => {
        let bytes = "";
        const timer = setTimeout(
          () => reject(new Error("PTY readiness deadline")),
          5000,
        );
        bridge.once("error", reject);
        bridge.stdout.on("data", (b) => {
          bytes += b;
          if (bytes.includes("\n")) {
            clearTimeout(timer);
            accept(JSON.parse(bytes.split("\n")[0]));
          }
        });
      },
    );
    function config(name: string, device: string) {
      const dir = join(work, name);
      mkdirSync(dir);
      writeFileSync(
        join(dir, "config"),
        `[reticulum]\nshare_instance = No\nenable_transport = No\n[interfaces]\n [[Serial]]\n type = SerialInterface\n enabled = Yes\n port = ${device}\n speed = 115200\n`,
      );
      return dir;
    }
    const a = await launch(join(work, "a"), 0, 0, "node");
    clients.push(a);
    const b = await launch(join(work, "b"), 0, 0, "node", [
      "--rns-config",
      config("b-rns", paths.left),
    ]);
    clients.push(b);
    const c = await launch(join(work, "c"), 0, -1, "node", [
      "--rns-config",
      config("c-rns", paths.right),
    ]);
    clients.push(c);
    await enter(pa, a, "Alice da Rede");
    await enter(pc, c, "Clara da Rede");
    await b.call("setup", { name: "Relay sem leitura", password });
    await contact(pa, (await c.call("state")).identity);
    await contact(pc, (await a.call("state")).identity);
    // Fixture bootstrap only; the people composing messages never choose a carrier.
    await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
    await b.call("reticulum-connect", {
      destination: (await c.call("state")).reticulum.destination,
    });
    const connected = await until(
      () => c.call("state"),
      (s) => s.peers.some((p: any) => p.medium === "reticulum"),
      20_000,
    );
    expect(connected.tcpPort).toBe(-1);
    expect(connected.peers.map((p: any) => p.medium)).toEqual(["reticulum"]);
    bridge.kill("SIGUSR1");
    await delay(100);
    await pa
      .getByRole("button", { name: "Nova conversa", exact: true })
      .click();
    await pa
      .getByRole("dialog")
      .getByRole("button", { name: /Clara da Rede/ })
      .click();
    const text = "Cheguei à biblioteca. Está tudo bem.";
    await pa.getByLabel("Escrever mensagem").fill(text);
    await pa.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect(
      pa.locator(".bubble").getByText(text, { exact: true }),
    ).toBeVisible();
    await until(
      () => b.call("state"),
      (s) => s.storage.count > 0,
    );
    await delay(3000);
    expect((await c.call("state")).objects).toHaveLength(0);
    bridge.kill("SIGUSR1");
    await expect(
      pc.getByRole("button", { name: /Alice da Rede.*Cheguei/ }),
    ).toBeVisible({ timeout: 20_000 });
    await pc.getByRole("button", { name: /Alice da Rede.*Cheguei/ }).click();
    await expect(
      pc.locator(".bubble").getByText(text, { exact: true }),
    ).toBeVisible();
    const original = (await a.call("state")).objects.find(
      (o: any) => o.kind === "message" && o.content.text === text,
    );
    await expect(b.call("view", { id: original.id })).rejects.toThrow();
    await pc
      .getByLabel("Escrever mensagem")
      .fill("Recebido. Também já cá estamos.");
    await pc.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect(
      pa
        .locator(".bubble")
        .getByText("Recebido. Também já cá estamos.", { exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    const evidence = "docs/evidence/reticulum/ui";
    mkdirSync(evidence, { recursive: true });
    for (const [name, page] of [
      ["sender", pa],
      ["reader", pc],
    ] as const) {
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      writeFileSync(
        `${evidence}/${name}-axe.json`,
        JSON.stringify(
          { violations: audit.violations, passes: audit.passes.length },
          null,
          2,
        ),
      );
      expect(audit.violations).toEqual([]);
      await page.screenshot({
        path: `${evidence}/${name}.png`,
        fullPage: true,
      });
    }
    await pc.getByRole("button", { name: "A rede", exact: true }).click();
    await expect(pc.getByText("Reticulum", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
    writeFileSync(
      `${evidence}/scope.json`,
      JSON.stringify(
        {
          result: "passed",
          engine: browser.browserType().name(),
          platform: process.platform,
          at: new Date().toISOString(),
          scope:
            "Shared native-backed UI over actual TCP plus reference RNS/serial PTY; identity/contact/send/read/reply, partition control and two Axe audits",
          limits:
            "Not the autonomous browser runtime, a screen-reader assessment or physical radio execution",
        },
        null,
        2,
      ),
    );
  } finally {
    await ca.close();
    await cc.close();
    for (const client of clients) await client.stop();
    if (bridge.exitCode === null && bridge.signalCode === null) {
      bridge.kill("SIGTERM");
      await new Promise<void>((r) => bridge.once("close", () => r()));
    }
  }
});
