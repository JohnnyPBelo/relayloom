import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, password, until } from "../helpers";
import { appHost } from "../browser/app-host";

async function panel(page: Page) {
  await page.getByRole("button", { name: "A rede", exact: true }).click();
  await page.getByRole("button", { name: "Ligar um par", exact: true }).click();
  await page
    .getByText("Usar a versão web neste dispositivo", { exact: true })
    .click();
}

test("native invitation UI connects an autonomous browser, preserves identity authority and revokes the actual socket", async ({
  browser,
}) => {
  const host = await appHost(),
    native = await launch(),
    aContext = await browser.newContext({ locale: "pt-PT" }),
    bContext = await browser.newContext({ locale: "pt-PT" }),
    a = await aContext.newPage(),
    b = await bContext.newPage();
  try {
    await native.call("setup", { name: "App instalada", password });
    await a.goto(native.url + "/#token=" + native.token);
    await b.goto(host.url + "/browser/index.html");
    await b.getByRole("button", { name: "Começar", exact: true }).click();
    await b.getByLabel("Como te chamas?").fill("Pessoa no navegador");
    await b.getByLabel("Frase-passe", { exact: true }).fill(password);
    await b
      .getByRole("button", { name: "Criar identidade", exact: true })
      .click();
    await expect(
      b.getByRole("heading", { name: "As tuas conversas" }),
    ).toBeVisible();
    await panel(a);
    await a
      .getByLabel("Endereço da versão web")
      .fill(host.url + "/browser/index.html");
    await a.getByRole("button", { name: "Criar convite", exact: true }).click();
    await expect(a.getByLabel("Convite para a versão web")).toBeVisible();
    const invitation = JSON.parse(
      await a.getByLabel("Convite para a versão web").inputValue(),
    );
    expect(invitation.origin).toBe(host.url);
    expect(JSON.stringify(invitation)).not.toContain(native.token);
    // A rejected address must leave the previous capability working.
    await a
      .getByLabel("Endereço da versão web")
      .fill("https://alice:secret@example.test/");
    await a.getByRole("button", { name: "Renovar convite" }).click();
    await expect(a.getByRole("alert")).toHaveText(
      "Usa um endereço web sem credenciais.",
    );
    expect((await native.call("state")).webPeer.expires).toBe(
      invitation.expires,
    );
    await b.getByRole("button", { name: "A rede", exact: true }).click();
    await b.getByRole("button", { name: "Ligar um par", exact: true }).click();
    await b.getByRole("tab", { name: "App instalada" }).click();
    await b
      .getByLabel("Convite da aplicação instalada")
      .fill(JSON.stringify(invitation));
    await b.getByRole("button", { name: "Ligar ao nó", exact: true }).click();
    await expect(
      b.getByRole("status").getByText("Ligação ao nó estabelecida."),
    ).toBeVisible();
    const connected = await until(
      () => native.call("state"),
      (s) => s.peers.some((p: any) => p.medium === "websocket"),
    );
    expect(connected.contacts).toEqual([]);
    expect(JSON.stringify(connected)).not.toContain(invitation.token);
    const unauthorized = await fetch(native.url + "/api/state", {
      headers: { Authorization: "Bearer " + invitation.token },
    });
    expect(unauthorized.status).toBe(401);
    await unauthorized.arrayBuffer();
    await a.getByRole("button", { name: "Fechar", exact: true }).click();
    await panel(a);
    await expect(a.getByLabel("Convite para a versão web")).toHaveCount(0);
    await expect(
      a.getByRole("button", { name: "Revogar convite" }),
    ).toBeVisible();
    await a.getByLabel("Endereço da versão web").fill(host.url);
    const audit = await new AxeBuilder({ page: a })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
    const dir = `.cache/web-invitation/${process.env.RELAYLOOM_TEST_BACKEND ?? "node"}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      dir + "/invitation-axe.json",
      JSON.stringify(
        { violations: audit.violations, passes: audit.passes.length },
        null,
        2,
      ),
    );
    await a.screenshot({ path: dir + "/invitation.png", fullPage: true });
    await a.setViewportSize({ width: 320, height: 740 });
    const revoke = a.getByRole("button", { name: "Revogar convite" });
    await revoke.focus();
    await expect(revoke).toBeFocused();
    expect(
      await a.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await a
        .getByRole("dialog")
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    const mobileAudit = await new AxeBuilder({ page: a })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(mobileAudit.violations).toEqual([]);
    writeFileSync(
      dir + "/mobile-axe.json",
      JSON.stringify(
        {
          violations: mobileAudit.violations,
          passes: mobileAudit.passes.length,
        },
        null,
        2,
      ),
    );
    await a.screenshot({ path: dir + "/mobile.png", fullPage: true });
    await revoke.press("Enter");
    await expect(
      a.getByRole("status").getByText(/Convite revogado/),
    ).toBeVisible();
    await until(
      () => native.call("state"),
      (s) =>
        s.webPeer === null &&
        !s.peers.some((p: any) => p.medium === "websocket"),
    );
    await expect(
      b.getByText("À espera de pares", { exact: true }),
    ).toBeVisible();
    expect((await native.call("state")).locked).toBe(false);
    expect(host.requests.some((p) => p.startsWith("/api/"))).toBe(false);
  } finally {
    await aContext.close();
    await bContext.close();
    await native.stop();
    await host.close();
  }
});

test("late invitation response after closing and locking cannot disclose its capability on unlock", async ({
  page,
}) => {
  const native = await launch();
  let release = () => {},
    intercepted = () => {},
    delivered = () => {};
  const pending = new Promise<void>((r) => {
      release = r;
    }),
    held = new Promise<void>((r) => {
      intercepted = r;
    }),
    finished = new Promise<void>((r) => {
      delivered = r;
    });
  let issued = "";
  try {
    await native.call("setup", { name: "Convite privado", password });
    await page.goto(native.url + "/#token=" + native.token);
    await panel(page);
    await page.route("**/api/web-peer", async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      const data = await response.json();
      issued = data.token;
      intercepted();
      await pending;
      await route.fulfill({ response, json: data });
      delivered();
    });
    await page
      .getByLabel("Endereço da versão web")
      .fill("http://127.0.0.1:4174/browser/index.html");
    await page
      .getByRole("button", { name: "Criar convite", exact: true })
      .click();
    await held;
    await page.getByRole("button", { name: "Fechar", exact: true }).click();
    await page.getByRole("button", { name: "Bloquear identidade" }).click();
    await expect(
      page.getByRole("heading", { name: "Bom ter-te de volta." }),
    ).toBeVisible();
    release();
    await finished;
    await page.getByLabel("Frase-passe", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Entrar na minha rede", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Bloquear identidade" }),
    ).toBeVisible();
    await panel(page);
    await expect(page.getByLabel("Convite para a versão web")).toHaveCount(0);
    expect(await page.content()).not.toContain(issued);
    await page.getByRole("button", { name: "Revogar convite" }).click();
    await until(
      () => native.call("state"),
      (s) => s.webPeer === null,
    );
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
    await native.stop();
  }
});
