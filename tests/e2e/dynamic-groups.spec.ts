import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { launch, password, until } from "../helpers";
import { randomUUID } from "node:crypto";
import { messagingPair } from "../fixtures/group-send";

test("a new group version preserves the draft, requires audience review, and lock removes the group dialog", async ({
  page,
}) => {
  const engine =
    process.env.RELAYLOOM_TEST_BACKEND === "native" ? "native" : "node";
  const f = await messagingPair(engine, engine);
  try {
    await f.a.call("connect", { host: "127.0.0.1", port: f.b.tcpPort });
    await page.goto(f.a.url + "/#token=" + f.a.token);
    await page.getByRole("button", { name: /^Actual group messages/ }).click();
    await page
      .getByRole("textbox", { name: "Escrever mensagem" })
      .fill("Rascunho que exige revisão");
    await expect(
      page.getByRole("button", { name: "Enviar mensagem", exact: true }),
    ).toBeEnabled();
    const changed = await f.command(f.a, {
      action: "commit",
      operationId: randomUUID(),
      groupId: f.groupId,
      expected: f.epoch,
      title: "Grupo actualizado",
      members: [f.alice, f.bob],
      joins: [],
    });
    await expect(page.getByText(/A versão do grupo mudou/)).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Escrever mensagem" }),
    ).toHaveValue("Rascunho que exige revisão");
    await expect(
      page.getByRole("button", { name: "Enviar mensagem", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Rever grupo", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Grupos e convites" });
    await expect(dialog.locator(".gm-version")).toContainText(
      `Versão ${changed.group.head.body.number}`,
    );
    await dialog.getByRole("button", { name: "Usar membros actuais" }).click();
    await expect(
      page.getByRole("button", { name: "Enviar mensagem", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Enviar mensagem", exact: true })
      .click();
    const state = await until(
      () => f.b.call("state"),
      (s) =>
        s.objects.some(
          (o: any) => o.content.text === "Rascunho que exige revisão",
        ),
    );
    expect(
      state.objects.find(
        (o: any) => o.content.text === "Rascunho que exige revisão",
      ).content.groupEpoch,
    ).toBe(changed.group.head.id);
    await page.getByRole("button", { name: "Ver participantes" }).click();
    await expect(dialog).toBeVisible();
    await f.a.call("lock", {});
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel("Frase-passe", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Grupo actualizado", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await f.close();
  }
});

test("Liquid Glass groups create, invite, consent, approve, message and leave through two real clients", async ({
  browser,
}) => {
  const a = await launch(),
    b = await launch();
  const ac = await browser.newContext({ locale: "pt-PT" }),
    bc = await browser.newContext({ locale: "pt-PT" });
  const ap = await ac.newPage(),
    bp = await bc.newPage();
  const runtime =
    process.env.RELAYLOOM_TEST_BACKEND === "native" ? "go" : "node";
  const directory = `.cache/dynamic-groups-ui/${runtime}`;
  mkdirSync(directory, { recursive: true });
  const audit = async (page: Page, name: string) => {
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    writeFileSync(
      `${directory}/${name}-axe.json`,
      JSON.stringify(
        { violations: result.violations, passed: result.passes.length },
        null,
        2,
      ),
    );
    await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true });
    expect(
      result.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  };
  try {
    for (const [client, page, name] of [
      [a, ap, "Alice do bairro"],
      [b, bp, "Bruno da ponte"],
    ] as const) {
      await page.goto(client.url + "/#token=" + client.token);
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
    const alice = (await a.call("state")).identity,
      bob = (await b.call("state")).identity;
    await a.call("contact", { contact: bob });
    await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
    await ap
      .getByRole("button", { name: "Grupos e convites", exact: true })
      .click();
    const ad = ap.getByRole("dialog", { name: "Grupos e convites" });
    await ad.getByRole("button", { name: "Criar grupo", exact: true }).click();
    await ad.getByLabel("Nome do novo grupo").fill("Ponto de encontro");
    await audit(ap, "create-light");
    await ad.getByRole("button", { name: "Criar e convidar" }).click();
    await expect(
      ad.getByRole("heading", { name: "Ponto de encontro", exact: true }),
    ).toBeVisible();
    await ad.getByLabel("Convidar uma pessoa").selectOption(bob.id);
    await ad.getByRole("button", { name: "Enviar convite" }).click();
    await expect(
      ad.getByText("1 convite à espera de resposta nesta versão."),
    ).toBeVisible();
    await bp
      .getByRole("button", { name: "Grupos e convites", exact: true })
      .click();
    const bd = bp.getByRole("dialog", { name: "Grupos e convites" });
    await bd.getByRole("button", { name: /^Convites/ }).click();
    await expect(
      bd.getByRole("heading", { name: "Convite de Alice do bairro" }),
    ).toBeVisible();
    expect((await b.call("group-command", { action: "list" })).groups).toEqual(
      [],
    );
    await audit(bp, "invitation-light");
    await bd.getByRole("button", { name: "Verificar convite" }).click();
    await expect(
      bd.getByRole("button", { name: "Aceitar convite" }),
    ).toBeVisible();
    await bd.getByRole("button", { name: "Aceitar convite" }).click();
    await expect(
      bd.getByText("A aguardar aprovação", { exact: true }),
    ).toBeVisible();
    await expect(
      ad.getByRole("heading", { name: "Pessoas que aceitaram" }),
    ).toBeVisible();
    await ad.getByRole("checkbox", { name: "Bruno da ponte" }).check();
    await ad.getByRole("button", { name: "Aprovar entradas" }).click();
    await expect(ad.locator(".gm-members")).toContainText("Bruno da ponte");
    await audit(ap, "members-light");
    await ad.getByRole("button", { name: "Usar membros actuais" }).click();
    await bd.getByRole("button", { name: "Ver grupo", exact: true }).click();
    await expect(
      bd.getByRole("button", { name: "Usar membros actuais" }),
    ).toBeVisible();
    await bd.getByRole("button", { name: "Usar membros actuais" }).click();
    await ap
      .getByRole("textbox", { name: "Escrever mensagem" })
      .fill("O encontro ficou combinado.");
    await expect(
      ap.getByRole("button", { name: "Enviar mensagem", exact: true }),
    ).toBeEnabled();
    await ap
      .getByRole("button", { name: "Enviar mensagem", exact: true })
      .click();
    await expect(bp.getByRole("log")).toContainText(
      "O encontro ficou combinado.",
    );
    const received = await until(
      () => b.call("state"),
      (v) =>
        v.objects.some(
          (o: any) => o.content.text === "O encontro ficou combinado.",
        ),
    );
    const message = received.objects.find(
      (o: any) => o.content.text === "O encontro ficou combinado.",
    );
    expect(message.author.id).toBe(alice.id);
    expect(message.content.groupAudience).toBe("epoch");
    await bp.setViewportSize({ width: 320, height: 844 });
    await bp.getByRole("button", { name: "Ver participantes" }).click();
    await audit(bp, "members-mobile");
    const clippedTabs = await bd
      .locator(".gm-tabs button")
      .evaluateAll((buttons) =>
        buttons.flatMap((button) => {
          const box = button.getBoundingClientRect();
          const parts = [...button.querySelectorAll("svg, span")].map(
            (element) => ({
              label: element.textContent?.trim() || element.tagName,
              rect: element.getBoundingClientRect(),
            }),
          );
          for (const node of button.childNodes) {
            if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim())
              continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            parts.push({
              label: node.textContent.trim(),
              rect: range.getBoundingClientRect(),
            });
          }
          return parts
            .filter(
              ({ rect }) =>
                rect.left < box.left - 1 || rect.right > box.right + 1,
            )
            .map(({ label, rect }) => ({
              label,
              left: rect.left,
              right: rect.right,
              buttonLeft: box.left,
              buttonRight: box.right,
            }));
        }),
      );
    expect(
      clippedTabs,
      "Tab labels, icons and notice counts must fit their mobile controls",
    ).toEqual([]);
    await bd
      .getByRole("button", { name: "Sair do grupo", exact: true })
      .click();
    await bd.getByRole("button", { name: "Confirmar saída" }).click();
    await expect(
      bd.locator(".gm-state").filter({ hasText: "Saíste do grupo" }),
    ).toBeVisible();
    await bd.getByRole("button", { name: "Fechar grupos" }).click();
    await expect(
      bp.getByRole("button", { name: "Enviar mensagem", exact: true }),
    ).toBeDisabled();
    await ap.getByRole("button", { name: "Ver participantes" }).click();
    await ad
      .getByRole("button", { name: "Encerrar grupo", exact: true })
      .click();
    await ad.getByRole("button", { name: "Confirmar encerramento" }).click();
    await expect(
      ad.locator(".gm-state").filter({ hasText: "Encerrado" }),
    ).toBeVisible();
    await ad.getByRole("button", { name: "Fechar grupos" }).click();
    await expect(
      ap.getByRole("button", { name: "Enviar mensagem", exact: true }),
    ).toBeDisabled();
  } finally {
    await ac.close();
    await bc.close();
    await a.stop();
    await b.stop();
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});
