import { test, expect, type Page } from "@playwright/test";
import { password } from "../helpers";
import { messagingPair } from "../fixtures/group-send";

const engine = () =>
  process.env.RELAYLOOM_TEST_BACKEND === "native" ? "native" : "node";
const groupDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Grupos e convites" });
async function createWithLostResponse(page: Page, title: string) {
  await page
    .getByRole("button", { name: "Grupos e convites", exact: true })
    .click();
  const dialog = groupDialog(page);
  await dialog
    .getByRole("button", { name: "Criar grupo", exact: true })
    .click();
  await dialog.getByLabel("Nome do novo grupo").fill(title);
  await dialog.getByRole("button", { name: "Criar e convidar" }).click();
  await expect(dialog.getByText("Vamos confirmar o resultado")).toBeVisible();
  return dialog;
}

test("a committed group operation with a lost response survives dialog closure and recovers without a second mutation", async ({
  page,
}) => {
  const f = await messagingPair(engine(), engine());
  const creates: string[] = [];
  let operation: any;
  try {
    await page.goto(f.a.url + "/#token=" + f.a.token);
    await page.route("**/api/group-command", async (route) => {
      const body = route.request().postDataJSON();
      if (body.action === "create") {
        creates.push(body.operationId);
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        operation = (await response.json()).operation;
        await route.abort("failed"); // The real transaction already committed.
      } else await route.continue();
    });
    const dialog = await createWithLostResponse(
      page,
      "Grupo com resposta recuperada",
    );
    expect(creates).toHaveLength(1);
    expect(
      (
        await f.a.call("group-command", {
          action: "operation",
          operationId: creates[0],
        })
      ).operation,
    ).toEqual(operation);
    await dialog.getByRole("button", { name: "Fechar grupos" }).click();
    await page
      .getByRole("button", { name: "Grupos e convites", exact: true })
      .click();
    await expect(dialog.getByText("Vamos confirmar o resultado")).toBeVisible();
    await dialog.getByRole("button", { name: "Verificar alteração" }).click();
    await expect(dialog.getByText("Vamos confirmar o resultado")).toHaveCount(
      0,
    );
    await expect(
      dialog.getByRole("heading", {
        name: "Grupo com resposta recuperada",
        exact: true,
      }),
    ).toBeVisible();
    expect(creates).toHaveLength(1);
    const groups = (await f.a.call("group-command", { action: "list" })).groups;
    expect(
      groups.filter((g: any) => g.title === "Grupo com resposta recuperada"),
    ).toHaveLength(1);
    expect(
      groups.find((g: any) => g.title === "Grupo com resposta recuperada").id,
    ).toBe(operation.groupId);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await f.close();
  }
});

test("a late recovered group state cannot restore the pre-lock conversation draft", async ({
  page,
}) => {
  const f = await messagingPair(engine(), engine());
  let release = () => {};
  let intercepted!: () => void;
  const held = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let delivered!: () => void;
  const finished = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  let recoverGroup = "";
  try {
    await page.goto(f.a.url + "/#token=" + f.a.token);
    await page.getByRole("button", { name: /^Actual group messages/ }).click();
    await page
      .getByRole("textbox", { name: "Escrever mensagem" })
      .fill("Rascunho privado anterior ao bloqueio");
    await page.route("**/api/group-command", async (route) => {
      const body = route.request().postDataJSON();
      if (body.action === "create") {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        recoverGroup = (await response.json()).group.id;
        await route.abort("failed");
      } else if (body.action === "state" && body.groupId === recoverGroup) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        const stale = await response.body();
        intercepted();
        await waiting;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: stale,
        });
        delivered();
      } else await route.continue();
    });
    const dialog = await createWithLostResponse(
      page,
      "Recuperação interrompida pelo bloqueio",
    );
    await dialog.getByRole("button", { name: "Verificar alteração" }).click();
    await held;
    await dialog.getByRole("button", { name: "Fechar grupos" }).click();
    await page.getByRole("button", { name: "Bloquear identidade" }).click();
    await expect(
      page.getByRole("heading", { name: "Bom ter-te de volta." }),
    ).toBeVisible();
    await expect(dialog).toHaveCount(0);
    release();
    await finished;
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await expect(
      page.getByText("Rascunho privado anterior ao bloqueio"),
    ).toHaveCount(0);
    await page.getByLabel("Frase-passe", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Entrar na minha rede", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "As tuas conversas" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Actual group messages/ }).click();
    await expect(
      page.getByRole("textbox", { name: "Escrever mensagem" }),
    ).toHaveValue("");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
    await f.close();
  }
});
