import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { password, until } from "../helpers";
import { appHost } from "../browser/app-host";
import { webRnsNetwork } from "./web-network";

async function enter(page: Page, url: string, name: string) {
  await page.goto(url);
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
async function contact(page: Page, card: unknown) {
  await page.getByRole("button", { name: "Conversas", exact: true }).click();
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
  await page.getByRole("button", { name: "A rede", exact: true }).click();
  await page.getByRole("button", { name: "Ligar um par", exact: true }).click();
}

for (const throughBrowserRelay of [false, true])
  test(`autonomous web UI ${throughBrowserRelay ? "through another consenting RTC browser" : "direct WS peer"} reaches native reader through reference RNS TCP and serial; partition, private reply and restarted seeder with browser author offline`, async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const f = await webRnsNetwork(),
      host = await appHost(),
      ac = await browser.newContext({ locale: "pt-PT" }),
      bc = await browser.newContext({ locale: "pt-PT" }),
      cc = await browser.newContext({ locale: "pt-PT" }),
      dc = throughBrowserRelay ? await browser.newContext({ locale: "pt-PT" }) : undefined,
      a = await ac.newPage(),
      bp = await bc.newPage(),
      c = await cc.newPage(),
      d = dc ? await dc.newPage() : undefined;
    const errors: string[] = [],
      controls: string[] = [],
      started = new Date().toISOString();
    for (const page of [a, bp, c, ...(d ? [d] : [])])
      page.on("pageerror", (e) => errors.push(e.message));
    const evidence = throughBrowserRelay
      ? ".cache/reticulum-web-rtc"
      : ".cache/reticulum-web";
    mkdirSync(evidence, { recursive: true });
    let b = f.b;
    try {
      await b.call("setup", { name: "Relay da comunidade", password });
      await enter(c, f.c.url + "/#token=" + f.c.token, "Clara da biblioteca");
      await enter(a, host.url + "/browser/index.html", "Alice no navegador");
      await a.getByRole("button", { name: "Definições", exact: true }).click();
      const alice = JSON.parse(
        await a.getByLabel("Cartão público da identidade").inputValue(),
      );
      await contact(a, (await f.c.call("state")).identity);
      await contact(c, alice);
      if (d) {
        await enter(d, host.url + "/browser/index.html", "Par web sem leitura");
        await d
          .getByRole("button", { name: "Definições", exact: true })
          .click();
        await expect(
          d.getByRole("checkbox", { name: /Retransmitir conteúdo/ }),
        ).not.toBeChecked();
        // The checked state reflects confirmation from the worker transaction.
        await d
          .getByRole("checkbox", { name: /Retransmitir conteúdo/ })
          .click();
        await expect(
          d.getByRole("checkbox", { name: /Retransmitir conteúdo/ }),
        ).toBeChecked();
        await network(a);
        await a
          .getByRole("button", { name: "Criar código de ligação" })
          .click();
        const offer = await a.getByLabel("Código para partilhar").inputValue();
        await network(d);
        await d.getByRole("tab", { name: "Receber código" }).click();
        await d.getByLabel("Código de ligação recebido").fill(offer);
        await d
          .getByRole("button", { name: "Criar resposta", exact: true })
          .click();
        const answer = await d.getByLabel("Código para partilhar").inputValue();
        await a.getByLabel("Resposta do outro dispositivo").fill(answer);
        await a.getByRole("button", { name: "Concluir ligação" }).click();
        await expect(
          a.getByText("Ligação estabelecida. Já podem trocar conteúdo.", {
            exact: true,
          }),
        ).toBeVisible();
        for (const page of [a, d])
          await page
            .getByRole("button", { name: "Fechar", exact: true })
            .click();
      }
      await bp.goto(b.url + "/#token=" + b.token);
      await network(bp);
      await bp
        .getByText("Usar a versão web neste dispositivo", { exact: true })
        .click();
      await bp
        .getByLabel("Endereço da versão web")
        .fill(host.url + "/browser/index.html");
      await bp
        .getByRole("button", { name: "Criar convite", exact: true })
        .click();
      await expect(bp.getByLabel("Convite para a versão web")).toBeVisible();
      const invitation = await bp
        .getByLabel("Convite para a versão web")
        .inputValue();
      await bp.getByRole("button", { name: "Fechar", exact: true }).click();
      const entry = d ?? a;
      await network(entry);
      await entry.getByRole("tab", { name: "App instalada" }).click();
      await entry.getByLabel("Convite da aplicação instalada").fill(invitation);
      await entry
        .getByRole("button", { name: "Ligar ao nó", exact: true })
        .click();
      await expect(
        entry.getByText("Ligação ao nó estabelecida.", { exact: true }),
      ).toBeVisible();
      await entry.getByRole("button", { name: "Fechar", exact: true }).click();
      const destination = (await f.c.call("state")).reticulum.destination;
      await b.call("reticulum-connect", { destination });
      const path = await until(
        () => b.call("state"),
        (s) =>
          s.reticulum.paths.some(
            (p: any) => p.destination === destination && p.hops === 2,
          ),
        30_000,
      );
      await until(
        () => f.c.call("state"),
        (s) => s.peers.length === 1 && s.peers[0].medium === "reticulum",
        20_000,
      );
      expect(path.tcpPort).toBe(-1);
      expect((await f.c.call("state")).tcpPort).toBe(-1);
      expect(path.peers.map((p: any) => p.medium).sort()).toEqual([
        "reticulum",
        "websocket",
      ]);
      controls.push(
        "Browser identity/worker and local storage are autonomous; its static host receives no /api calls. B and C have no RelayLoom TCP listeners; C has only RNS and B has WS/RNS. Reference RNS path has two hops.",
      );

      if (d) {
        await expect(a.getByText("WebRTC", { exact: true })).toBeVisible();
        await expect(a.getByText("WebSocket", { exact: true })).toHaveCount(0);
        await expect(d.getByText("WebRTC", { exact: true })).toBeVisible();
        await expect(d.getByText("WebSocket", { exact: true })).toBeVisible();
        controls.push(
          "The sender has only a WebRTC peer and no native/control/WS endpoint. A separate consenting browser bridges RTC to WS; the native RNS bridge is only that intermediary's peer.",
        );
      }
      f.partition();
      await delay(100);
      await a.getByRole("button", { name: "Conversas", exact: true }).click();
      await a
        .getByRole("button", { name: "Nova conversa", exact: true })
        .click();
      await a
        .getByRole("dialog")
        .getByRole("button", { name: /Clara da biblioteca/ })
        .click();
      const text = "Cheguei à biblioteca. A mensagem saiu do navegador.",
        payload = Buffer.from("caminho-reticulum-web-".repeat(1000));
      await a.getByLabel("Escrever mensagem").fill(text);
      await a.locator("input[type=file]").setInputFiles({
        name: "caminho.txt",
        mimeType: "text/plain",
        buffer: payload,
      });
      await a
        .getByRole("button", { name: "Enviar mensagem", exact: true })
        .click();
      await expect(
        a.locator(".bubble").getByText(text, { exact: true }),
      ).toBeVisible();
      await until(
        () => b.call("state"),
        (s) => s.storage.count > 0,
      );
      await delay(3000);
      expect((await f.c.call("state")).objects).toHaveLength(0);
      await expect(
        a.getByRole("button", { name: "Estado do envio: Em espera" }),
      ).toBeVisible();
      controls.push(
        "Partition negative control: B retained ciphertext while C remained empty and web outbox pending.",
      );
      f.partition();
      await expect(
        c.getByRole("button", { name: /Alice no navegador.*Cheguei/ }),
      ).toBeVisible({ timeout: 35_000 });
      await c
        .getByRole("button", { name: /Alice no navegador.*Cheguei/ })
        .click();
      await expect(
        c.locator(".bubble").getByText(text, { exact: true }),
      ).toBeVisible();
      const received = (await f.c.call("state")).objects.find(
        (o: any) => o.kind === "message" && o.content.text === text,
      );
      expect(received.author.id).toBe(alice.id);
      expect(
        Buffer.from(
          (await f.c.call("attachment", { id: received.id, index: 0 })).data,
          "base64",
        ),
      ).toEqual(payload);
      await expect(b.call("view", { id: received.id })).rejects.toThrow();
      await expect(
        b.call("publish", {
          content: {
            type: "edit",
            target: received.id,
            text: "Alteração sem autoria",
          },
          recipients: "public",
        }),
      ).rejects.toThrow();
      controls.push(
        `Heal positive control: exact ${payload.length} attachment bytes and original author verified. Relay cannot decrypt or edit the private message.`,
      );
      if (d) {
        await d.getByRole("button", { name: "A praça", exact: true }).click();
        await d
          .getByRole("button", {
            name: "Obter conteúdo por endereço",
            exact: true,
          })
          .click();
        await d.getByLabel("Endereço do conteúdo").fill(received.id);
        await d
          .getByRole("button", { name: "Pedir aos pares", exact: true })
          .click();
        await expect(d.getByRole("dialog").getByRole("alert")).toContainText(
          "não tem autorização para o ler",
        );
        await d.getByRole("button", { name: "Fechar", exact: true }).click();
        controls.push(
          "The intermediary browser also refuses a direct UI request to read the private message it forwarded.",
        );
      }

      await c
        .getByLabel("Escrever mensagem")
        .fill("Recebido, Alice. O caminho está aberto.");
      await c
        .getByRole("button", { name: "Enviar mensagem", exact: true })
        .click();
      await expect(
        a
          .locator(".bubble")
          .getByText("Recebido, Alice. O caminho está aberto.", {
            exact: true,
          }),
      ).toBeVisible({ timeout: 30_000 });
      for (const [name, page] of [
        ["web-sender", a],
        ["native-reader", c],
      ] as const) {
        const audit = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(audit.violations).toEqual([]);
        writeFileSync(
          `${evidence}/${name}-axe.json`,
          JSON.stringify(
            { violations: audit.violations, passes: audit.passes.length },
            null,
            2,
          ),
        );
        await page.screenshot({
          path: `${evidence}/${name}.png`,
          fullPage: true,
        });
      }
      controls.push(
        "Both people composed, received and replied in the shared UI without choosing any communication medium.",
      );

      await b.call("settings", { relay: false });
      const postText =
        "A biblioteca reabriu. Esta cópia fica com a comunidade.";
      await a.getByRole("button", { name: "A praça", exact: true }).click();
      await a
        .getByRole("button", { name: "Partilhar algo", exact: true })
        .click();
      await a.getByLabel("A tua publicação").fill(postText);
      await a.getByRole("button", { name: "Publicar", exact: true }).click();
      const stored = await until(
        () => b.call("state"),
        (s) => s.objects.some((o: any) => o.content.text === postText),
      );
      const post = stored.objects.find((o: any) => o.content.text === postText);
      await b.call("view", { id: post.id });
      await delay(3000);
      expect(
        (await f.c.call("state")).objects.some((o: any) => o.id === post.id),
      ).toBe(false);
      controls.push(
        "Relay consent negative control: B reads the public post while relay is paused, and C cannot obtain it.",
      );
      await ac.close();
      await dc?.close();
      await bc.close();
      await b.stop();
      b = await f.startB();
      await b.call("unlock", { password });
      await b.call("reticulum-connect", { destination });
      await b.call("settings", { relay: true });
      await until(
        () => f.c.call("state"),
        (s) => s.objects.some((o: any) => o.id === post.id),
        35_000,
      );
      expect((await f.c.call("view", { id: post.id })).author.id).toBe(
        alice.id,
      );
      await c.getByRole("button", { name: "A praça", exact: true }).click();
      await expect(c.getByText(postText, { exact: true })).toBeVisible();
      const stats = await f.stats();
      expect(
        stats.interfaces.some(
          (i: any) =>
            i.type === "SerialInterface" && i.tx > payload.length && i.rx > 0,
        ),
      ).toBe(true);
      expect(
        stats.interfaces.some(
          (i: any) => i.type === "TCPClientInterface" && i.tx > 0 && i.rx > 0,
        ),
      ).toBe(true);
      expect(host.requests.some((p) => p.startsWith("/api/"))).toBe(false);
      expect(errors).toEqual([]);
      controls.push(
        "Browser author closed; B restarted with existing storage and subsequently seeded the unseen public post to C with Alice's authorship intact. Reference TCP and serial interface byte counters both moved.",
      );
      writeFileSync(
        evidence + "/report.json",
        JSON.stringify(
          {
            status: "PASSED",
            throughBrowserRelay,
            started,
            finished: new Date().toISOString(),
            controls,
            rns: "1.5.4",
            stats,
            limits: `${browser.browserType().name()}/${process.platform} with actual RNS and serial PTY; no physical radio, WAN/WSS, Safari/device or dynamic-group browser parity claim.`,
          },
          null,
          2,
        ),
      );
    } finally {
      await ac.close();
      await bc.close();
      await cc.close();
      await dc?.close();
      await f.close();
      await host.close();
    }
  });
