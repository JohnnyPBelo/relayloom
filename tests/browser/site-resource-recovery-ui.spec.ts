import { test, expect } from "@playwright/test";
import { appHost } from "./app-host";
import { mkdirSync, writeFileSync } from "node:fs";
let host: Awaited<ReturnType<typeof appHost>>;
test.beforeAll(async () => {
  host = await appHost();
});
test.afterAll(async () => {
  await host.close();
  expect(host.requests.some((path) => path.startsWith("/api/"))).toBe(false);
});
const password = "resource recovery UI passphrase";

for (const mode of ["reply", "request"] as const)
  test(`resource UI recovers a lost ${mode} with one operation identity and no silent duplicate`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      const Original = Worker,
        w = window as any;
      w.resourceAttempts = [];
      w.resourceFaultHit = false;
      class Observed extends Original {
        private chosen?: number;
        override postMessage(value: any, ...rest: any[]) {
          if (
            value?.type === "request" &&
            value.domain === "api" &&
            value.operation === "resource-command" &&
            value.body?.action === "create"
          ) {
            w.resourceAttempts.push({
              sequence: value.body.sequence,
              operationId: value.body.operationId,
            });
            if (!w.resourceFaultHit) {
              if (mode === "request") {
                w.resourceFaultHit = true;
                return;
              }
              this.chosen = value.id;
            }
          }
          return super.postMessage(value, ...(rest as [any]));
        }
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.addEventListener("message", (event) => {
            if (
              mode === "reply" &&
              event.data?.type === "result" &&
              event.data.id === this.chosen &&
              !w.resourceFaultHit
            ) {
              w.resourceFaultHit = true;
              event.stopImmediatePropagation();
            }
          });
        }
      }
      w.Worker = Observed;
    }, mode);
    await page.goto(host.url + "/browser/index.html");
    await page.getByRole("button", { name: "Começar", exact: true }).click();
    await page
      .getByLabel("Como te chamas?")
      .fill("Autora com falha controlada");
    await page.getByLabel("Frase-passe", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Criar identidade", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "As tuas conversas" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "A minha página", exact: true })
      .click();
    const studio = page.getByRole("region", {
      name: "Estúdio do site",
      exact: true,
    });
    await studio.getByRole("button", { name: "Recursos", exact: true }).click();
    let library = page.getByRole("dialog", {
      name: "Biblioteca de recursos",
      exact: true,
    });
    await library
      .getByRole("button", { name: "Novo ficheiro", exact: true })
      .click();
    await library
      .getByLabel("Ficheiro do recurso", { exact: true })
      .setInputFiles({
        name: "Uma única cópia.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("ONE_RESOURCE_WITH_LOST_" + mode),
      });
    await library
      .getByRole("button", { name: "Guardar recurso", exact: true })
      .click();
    if (mode === "request") {
      await expect(library.getByRole("alert")).toContainText(
        "O motor demorou demasiado",
        { timeout: 25000 },
      );
      await expect(
        library.getByRole("button", { name: "Guardar recurso", exact: true }),
      ).toBeDisabled();
      await library
        .getByRole("button", {
          name: "Confirmar a mesma tentativa",
          exact: true,
        })
        .click();
    }
    await expect(
      library.getByRole("heading", {
        name: "Uma única cópia.txt",
        exact: true,
      }),
    ).toHaveCount(1, { timeout: 25000 });
    const control = await page.evaluate(() => ({
      hit: (window as any).resourceFaultHit,
      attempts: (window as any).resourceAttempts,
    }));
    expect(control.hit).toBe(true);
    expect(control.attempts).toHaveLength(mode === "request" ? 2 : 1);
    if (mode === "request")
      expect(control.attempts[1]).toEqual(control.attempts[0]);
    await library.getByRole("button", { name: "Fechar", exact: true }).click();
    await page.reload();
    await page.getByLabel("Frase-passe", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Entrar na minha rede", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "As tuas conversas" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "A minha página", exact: true })
      .click();
    await studio.getByRole("button", { name: "Recursos", exact: true }).click();
    library = page.getByRole("dialog", {
      name: "Biblioteca de recursos",
      exact: true,
    });
    await expect(
      library.getByRole("heading", {
        name: "Uma única cópia.txt",
        exact: true,
      }),
    ).toHaveCount(1);
    expect(await page.evaluate(() => (window as any).resourceAttempts)).toEqual(
      [],
    );
    const output = `.cache/resource-ui-recovery/${info.project.name || "chromium"}`;
    mkdirSync(output, { recursive: true });
    writeFileSync(
      output + "/" + mode + ".json",
      JSON.stringify(
        {
          status: "PASS",
          controlledFault: mode,
          ...control,
          oneResourceAfterReload: true,
          noAutomaticCreateAfterReload: true,
          scope:
            "Real compiled worker/UI/storage, with only the indicated message dropped at the transport boundary.",
        },
        null,
        2,
      ),
    );
  });
