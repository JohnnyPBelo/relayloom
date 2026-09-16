import { test, expect } from "@playwright/test";
import { launch, password, until } from "../helpers";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";

test("group approval uses verified group state with an English creator and Spanish member", async ({
  browser,
}) => {
  const a = await launch(),
    b = await launch();
  const ac = await browser.newContext({ locale: "en-GB" }),
    bc = await browser.newContext({ locale: "es-ES" });
  const ap = await ac.newPage(),
    bp = await bc.newPage();
  try {
    for (const [client, page, name, words] of [
      [
        a,
        ap,
        "Alice original",
        {
          start: "Get started",
          name: "What is your name?",
          password: "Passphrase",
          create: "Create identity",
          heading: "Your conversations",
        },
      ],
      [
        b,
        bp,
        "Bruno original",
        {
          start: "Empezar",
          name: "¿Cómo te llamas?",
          password: "Frase de contraseña",
          create: "Crear identidad",
          heading: "Tus conversaciones",
        },
      ],
    ] as const) {
      await page.goto(client.url + "/#token=" + client.token);
      await page
        .getByRole("button", { name: words.start, exact: true })
        .click();
      await page.getByLabel(words.name, { exact: true }).fill(name);
      await page.getByLabel(words.password, { exact: true }).fill(password);
      await page
        .getByRole("button", { name: words.create, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: words.heading, exact: true }),
      ).toBeVisible();
    }
    const alice = (await a.call("state")).identity,
      bob = (await b.call("state")).identity;
    await bp.getByRole("button", { name: "Ajustes", exact: true }).click();
    const card = await bp
      .getByLabel("Tarjeta pública de identidad", { exact: true })
      .inputValue();
    await bp
      .getByRole("button", { name: "Conversaciones", exact: true })
      .click();
    await ap.getByRole("button", { name: "Add contact", exact: true }).click();
    await ap.getByLabel("Contact's public card", { exact: true }).fill(card);
    await ap
      .getByRole("button", { name: "Verify and add", exact: true })
      .click();
    await ap.getByRole("button", { name: "Network", exact: true }).click();
    await ap
      .getByRole("button", { name: "Connect a peer", exact: true })
      .click();
    await ap
      .getByLabel("TCP transport port", { exact: true })
      .fill(String(b.tcpPort));
    await ap
      .getByRole("button", { name: "Connect via TCP", exact: true })
      .click();
    await expect(
      ap.getByText("1 active connection", { exact: true }),
    ).toBeVisible();
    await ap
      .getByRole("button", { name: "Conversations", exact: true })
      .click();
    await ap
      .getByRole("button", { name: "Groups and invitations", exact: true })
      .click();
    const ad = ap.getByRole("dialog", {
      name: "Groups and invitations",
      exact: true,
    });
    await ad.getByRole("button", { name: "Create group", exact: true }).click();
    await ad
      .getByLabel("New group name", { exact: true })
      .fill("Guardar — grupo do autor");
    await ad
      .getByRole("button", { name: "Create and invite", exact: true })
      .click();
    await ad.getByLabel("Invite a person").selectOption(bob.id);
    await ad
      .getByRole("button", { name: "Send invitation", exact: true })
      .click();
    await expect(
      ad.getByText("1 invitation awaiting a reply in this version.", {
        exact: true,
      }),
    ).toBeVisible();
    await bp
      .getByRole("button", { name: "Grupos e invitaciones", exact: true })
      .click();
    const bd = bp.getByRole("dialog", {
      name: "Grupos e invitaciones",
      exact: true,
    });
    await bd.getByRole("button", { name: /^Invitaciones/ }).click();
    await expect(
      bd.getByRole("heading", {
        name: "Invitación de Alice original",
        exact: true,
      }),
    ).toBeVisible();
    expect((await b.call("group-command", { action: "list" })).groups).toEqual(
      [],
    );
    await bd
      .getByRole("button", { name: "Verificar invitación", exact: true })
      .click();
    await bd
      .getByRole("button", { name: "Aceptar invitación", exact: true })
      .click();
    await expect(
      bd.getByText("Esperando aprobación", { exact: true }),
    ).toBeVisible();
    await expect(
      ad.getByRole("heading", { name: "People who accepted", exact: true }),
    ).toBeVisible();
    await ad
      .getByRole("checkbox", { name: "Bruno original", exact: true })
      .check();
    await ad
      .getByRole("button", { name: "Approve admissions", exact: true })
      .click();
    await expect(
      bd.getByText("Entrada aprobada. Ya puedes conversar con los miembros.", {
        exact: true,
      }),
    ).toBeVisible();
    await ad
      .getByRole("button", { name: "Use current members", exact: true })
      .click();
    await bd.getByRole("button", { name: "Ver grupo", exact: true }).click();
    await expect(
      bd.getByRole("heading", {
        name: "Guardar — grupo do autor",
        exact: true,
      }),
    ).toBeVisible();
    await bd
      .getByRole("button", { name: "Usar miembros actuales", exact: true })
      .click();
    const text = "Texto original do grupo, sem tradução do conteúdo.";
    await ap.getByLabel("Write a message", { exact: true }).fill(text);
    await ap.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(bp.getByRole("log")).toContainText(text);
    const state = await until(
      () => b.call("state"),
      (s) => s.objects.some((o: any) => o.content.text === text),
    );
    const message = state.objects.find((o: any) => o.content.text === text);
    expect(message.author.id).toBe(alice.id);
    expect(message.content.groupAudience).toBe("epoch");
    const runtime =
        process.env.RELAYLOOM_TEST_BACKEND === "native" ? "go" : "node",
      out = `.cache/onboarding-i18n/groups-${runtime}`;
    mkdirSync(out, { recursive: true });
    await bp.screenshot({ path: out + "/spanish-member.png", fullPage: true });
    writeFileSync(
      out + "/report.json",
      JSON.stringify(
        {
          status: "PASS",
          runtime,
          languages: ["en-GB", "es-ES"],
          membershipBeforeConsent: false,
          verifiedApprovalFeedback: true,
          epochMessage: true,
          authorPreserved: true,
          physicalDevices: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await ac.close();
    await bc.close();
    await a.stop();
    await b.stop();
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});
