import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { groupOutboxFixture } from "../fixtures/group-outbox";
import { createGroupSuccessor } from "../../packages/groups/src/certificates";
import { launch, password, type Client } from "../helpers";

test("real runtime group outbox shows proof pause and terminal stop with accessible recovery guidance", async ({
  page,
}) => {
  const cleanups: (() => void | Promise<void>)[] = [];
  const f = groupOutboxFixture({
    after: (cleanup) => {
      cleanups.push(cleanup);
    },
  });
  const anchor = f.command({
    action: "proofs",
    groupId: f.group.id,
    from: 0,
  }).anchor;
  const snapshot = f.command({
    action: "private-state",
    groupId: f.group.id,
    epochId: f.group.head.id,
  }).snapshot;
  const successor = createGroupSuccessor(
    f.identity,
    anchor,
    f.group.head,
    snapshot,
    {
      title: "Waiting for private proof",
      members: snapshot.members,
      joins: [],
    },
  );
  await f.node.stop();
  let client: Client | undefined;
  try {
    client = await launch(f.node.dir);
    await client.call("unlock", { password });
    await client.call("group-command", {
      action: "headers",
      groupId: f.group.id,
      headers: [successor.epoch],
    });
    await page.goto(client.url + "/#token=" + client.token);
    await page.getByRole("button", { name: "Estado dos envios" }).click();
    const card = page.getByRole("article", {
      name: "Envio: Original audience",
    });
    await expect(
      card.getByText("A confirmar o grupo", { exact: true }),
    ).toBeVisible();
    await card.getByRole("button", { name: /Original audience/ }).click();
    await expect(
      card.getByRole("button", { name: "Tentar novamente" }),
    ).toBeDisabled();
    await expect(
      card.getByText(/À espera de confirmar o estado do grupo/),
    ).toBeVisible();
    expect((await client.call("state")).outbox[0].attempts).toBe(0);
    await client.call("group-command", {
      action: "snapshot",
      groupId: f.group.id,
      epochId: successor.epoch.id,
      snapshot: successor.snapshot,
    });
    await expect(
      card.getByRole("button", { name: "Tentar novamente" }),
    ).toBeEnabled();
    await client.call("group-command", {
      action: "close",
      operationId: randomUUID(),
      groupId: f.group.id,
      expected: successor.epoch.id,
    });
    await expect(
      card.getByText("Envio interrompido", { exact: true }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Tentar novamente" }),
    ).toHaveCount(0);
    await expect(card.getByText(/reveja os destinatários/)).toBeVisible();
    await page.getByLabel("Filtrar envios").focus();
    await expect(page.getByLabel("Filtrar envios")).toBeFocused();
    await page.getByLabel("Filtrar envios").selectOption("pending");
    await expect(page.getByText("Não há envios neste estado.")).toBeVisible();
    await page.getByLabel("Filtrar envios").selectOption("all");
    const runtime =
      process.env.RELAYLOOM_TEST_BACKEND === "native" ? "go" : "node";
    const directory = `docs/evidence/group-outbox/ui-${runtime}`;
    mkdirSync(directory, { recursive: true });
    for (const [name, width, height] of [
      ["desktop", 1440, 1000],
      ["mobile", 390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expect(card.getByText(/reveja os destinatários/)).toBeVisible();
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      writeFileSync(
        `${directory}/${name}-axe.json`,
        JSON.stringify(
          {
            at: new Date().toISOString(),
            violations: audit.violations,
            passed: audit.passes.length,
          },
          null,
          2,
        ) + "\n",
      );
      expect(
        audit.violations.map((v) => ({
          id: v.id,
          targets: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
      await page.screenshot({
        path: `${directory}/${name}.png`,
        fullPage: true,
      });
    }
    writeFileSync(
      `${directory}/scope.json`,
      JSON.stringify(
        {
          runtime,
          interface: "real browser and authenticated application process",
          fixture:
            "installs a valid signed/admitted message and initial intent",
          checks: [
            "proof pause disables retry",
            "proof recovery enables retry",
            "group closure renders terminal stop",
            "terminal pending filter",
            "keyboard filter focus",
            "desktop/mobile Axe",
          ],
          limits: [
            "not dynamic composition UI coverage",
            "not a physical mobile test",
          ],
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    if (client) await client.stop();
    for (const cleanup of cleanups) await cleanup();
  }
});
