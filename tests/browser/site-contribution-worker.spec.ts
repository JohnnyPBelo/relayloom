import { test, expect, type Page } from "@playwright/test";
import { appHost } from "./app-host";
import { formPayload, formRowSentinel } from "../fixtures/site-form";

async function captureWorker(page: Page) {
  await page.addInitScript(() => {
    const Original = Worker,
      w = window as any;
    w.formSecretLeak = false;
    const secret = (value: any): boolean =>
      !!value &&
      typeof value === "object" &&
      (Object.keys(value).some((k) =>
        ["signSecret", "boxSecret"].includes(k),
      ) ||
        Object.values(value).some(secret));
    w.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        w.formWorker = this;
        this.addEventListener("message", (e) => {
          if (secret(e.data)) w.formSecretLeak = true;
        });
      }
    };
    let id = 150000;
    w.formRPC = (operation: string, body?: unknown, domain = "api") =>
      new Promise((resolve, reject) => {
        const worker = w.formWorker,
          current = ++id;
        const listener = (e: MessageEvent) => {
          if (e.data?.type !== "result" || e.data.id !== current) return;
          clearTimeout(timer);
          worker.removeEventListener("message", listener);
          e.data.error ? reject(Error(e.data.error)) : resolve(e.data.value);
        };
        const timer = setTimeout(() => {
          worker.removeEventListener("message", listener);
          reject(Error("fixture form worker reply timed out"));
        }, 5000);
        worker.addEventListener("message", listener);
        worker.postMessage({
          type: "request",
          id: current,
          domain,
          operation,
          body,
        });
      });
  });
}

test("production worker describes an authenticated form after UI setup and unlock without exposing keys or accepting caller authority", async ({
  page,
}) => {
  const host = await appHost(),
    password = "production form context passphrase";
  try {
    await captureWorker(page);
    await page.goto(host.url + "/browser/index.html");
    await page.getByRole("button", { name: "Começar", exact: true }).click();
    await page
      .getByLabel("Como te chamas?")
      .fill("Dona do formulário no worker");
    await page.getByLabel("Frase-passe", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Criar identidade", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "As tuas conversas" }),
    ).toBeVisible();
    const saved = await page.evaluate(async (payload) => {
      const w = window as any,
        state = await w.formRPC("state"),
        address = "relayloom:site:" + state.identity.id + "/profile";
      const catalog = await w.formRPC("site-command", {
        action: "state",
        address,
      });
      const op = (
        await w.formRPC("site-command", {
          action: "publish",
          name: "profile",
          sequence: catalog.nextSequence,
          operationId: crypto.randomUUID(),
          expectedBase: catalog.base,
          payload,
          recipients: "public",
          ttlMs: 3600000,
        })
      ).operation;
      const query = {
        action: "form",
        snapshotId: op.bundleId,
        pageId: "entry",
        formId: "form",
      };
      const description = await w.formRPC("contribution-command", query);
      let rejected = false;
      try {
        await w.formRPC("contribution-command", {
          ...query,
          context: { contributors: "readers" },
        });
      } catch {
        rejected = true;
      }
      return {
        query,
        description,
        rejected,
        owner: state.identity.id,
        leak: w.formSecretLeak,
      };
    }, formPayload());
    expect(saved.rejected).toBe(true);
    expect(saved.leak).toBe(false);
    expect(saved.description.owner.id).toBe(saved.owner);
    expect(JSON.stringify(saved.description)).not.toContain(formRowSentinel);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Bom ter-te de volta." }),
    ).toBeVisible();
    await page.getByLabel("Frase-passe", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Entrar na minha rede", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "As tuas conversas" }),
    ).toBeVisible();
    const reopened = await page.evaluate(async (query) => {
      const w = window as any;
      return {
        description: await w.formRPC("contribution-command", query),
        leak: w.formSecretLeak,
      };
    }, saved.query);
    expect(reopened.description).toEqual(saved.description);
    expect(reopened.leak).toBe(false);
    expect(host.requests.some((p) => p.startsWith("/api/"))).toBe(false);
  } finally {
    await host.close();
  }
});

test("production workers recover queued proposals offline and send through the UI-established RTC link without reviving cancellation", async ({
  browser,
}) => {
  const host = await appHost(),
    password = "production proposal recovery passphrase",
    contexts = [await browser.newContext(), await browser.newContext()],
    pages = [await contexts[0].newPage(), await contexts[1].newPage()],
    [owner, sender] = pages,
    errors: string[] = [];
  const rpc = (
    page: Page,
    operation: string,
    body?: unknown,
    domain = "api",
  ): Promise<any> =>
    page.evaluate(
      ({ operation, body, domain }) =>
        (window as any).formRPC(operation, body, domain),
      { operation, body, domain },
    );
  const unlock = async (page: Page) => {
    await expect(
      page.getByRole("heading", { name: "Bom ter-te de volta." }),
    ).toBeVisible();
    await page.getByLabel("Frase-passe", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Entrar na minha rede", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "As tuas conversas" }),
    ).toBeVisible();
  };
  const connect = async () => {
    for (const page of pages) {
      await page.getByRole("button", { name: "A rede", exact: true }).click();
      await page
        .getByRole("button", { name: "Ligar um par", exact: true })
        .click();
    }
    await owner
      .getByRole("button", { name: "Criar código de ligação" })
      .click();
    const offer = await owner.getByLabel("Código para partilhar").inputValue();
    await sender.getByRole("tab", { name: "Receber código" }).click();
    await sender.getByLabel("Código de ligação recebido").fill(offer);
    await sender
      .getByRole("button", { name: "Criar resposta", exact: true })
      .click();
    const answer = await sender
      .getByLabel("Código para partilhar")
      .inputValue();
    await owner.getByLabel("Resposta do outro dispositivo").fill(answer);
    await owner.getByRole("button", { name: "Concluir ligação" }).click();
    await expect(
      owner.getByText("Ligação estabelecida. Já podem trocar conteúdo."),
    ).toBeVisible();
    for (const page of pages)
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Fechar", exact: true })
        .click();
  };
  try {
    for (const [index, page] of pages.entries()) {
      page.on("pageerror", (e) => errors.push(e.message));
      await captureWorker(page);
      await page.goto(host.url + "/browser/index.html");
      await page.getByRole("button", { name: "Começar", exact: true }).click();
      await page
        .getByLabel("Como te chamas?")
        .fill(index ? "Visitante worker" : "Dona worker");
      await page.getByLabel("Frase-passe", { exact: true }).fill(password);
      await page
        .getByRole("button", { name: "Criar identidade", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "As tuas conversas" }),
      ).toBeVisible();
    }
    const a = (await rpc(owner, "state")).identity,
      b = (await rpc(sender, "state")).identity,
      address = "relayloom:site:" + a.id + "/profile",
      state = await rpc(owner, "site-command", { action: "state", address }),
      site = (
        await rpc(owner, "site-command", {
          action: "publish",
          name: "profile",
          sequence: state.nextSequence,
          operationId: crypto.randomUUID(),
          expectedBase: state.base,
          payload: formPayload([b.id]),
          recipients: "public",
          ttlMs: 3600000,
        })
      ).operation;
    await connect();
    await expect
      .poll(() => rpc(sender, "ids", undefined, "profile"))
      .toContain(site.bundleId);
    // Reload ends the actual RTC channel; subsequent proposals have no path.
    await sender.reload();
    await unlock(sender);
    await expect
      .poll(async () => (await rpc(owner, "state")).peers.length)
      .toBe(0);
    await rpc(sender, "settings", { relay: false });
    const request = {
      action: "submit",
      sequence: 1,
      operationId: crypto.randomUUID(),
      snapshotId: site.bundleId,
      pageId: "entry",
      formId: "form",
      values: {
        name: "PRIVATE_PRODUCTION_WORKER_PROPOSAL",
        count: 0,
        open: false,
      },
      publicationScope: [a.id, b.id].sort(),
      ttlMs: 180000,
    };
    expect(
      await rpc(
        sender,
        "contribution-source",
        { id: site.bundleId },
        "profile",
      ),
    ).toBeNull();
    const sent = await rpc(sender, "contribution-command", request);
    expect(sent.error).toBeUndefined();
    expect(sent.operation.phase).toBe("queued");
    expect(sent.operation.transport.copied).toBe(true);
    const sourceLease = await rpc(
      sender,
      "contribution-source",
      { id: site.bundleId },
      "profile",
    );
    expect(sourceLease.operationId).toBe(request.operationId);
    expect(sourceLease.expires).toBe(sent.operation.expires);
    expect(sourceLease.bundle.manifest.id).toBe(site.bundleId);
    expect(sourceLease.bundle.manifest.author.id).toBe(a.id);
    await expect(
      rpc(
        sender,
        "contribution-source",
        { id: site.bundleId, operationId: request.operationId },
        "profile",
      ),
    ).rejects.toThrow();
    const original = await rpc(
      sender,
      "get-bundle",
      { id: sent.operation.transport.bundleId },
      "profile",
    );
    expect(original.manifest.publicKey).toBeNull();
    expect(JSON.stringify(original)).not.toContain(request.values.name);
    expect(
      (await rpc(owner, "contribution-command", { action: "inbox" })).items,
    ).toEqual([]);
    const cancelled = (
      await rpc(sender, "contribution-command", {
        ...request,
        sequence: 2,
        operationId: crypto.randomUUID(),
        values: {
          ...request.values,
          name: "CANCELLED_PRODUCTION_WORKER_PROPOSAL",
        },
      })
    ).operation;
    await rpc(sender, "contribution-command", {
      action: "cancel",
      sequence: 2,
      operationId: cancelled.operationId,
    });
    // Use the installed offline shell, not a new fixture bundle or daemon.
    await sender.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    host.setUnavailable(true);
    await sender.reload();
    await unlock(sender);
    const resumed = await rpc(sender, "contribution-command", {
      action: "resume",
      sequence: 1,
      operationId: request.operationId,
    });
    expect(resumed.operation).toEqual(sent.operation);
    expect(
      await rpc(
        sender,
        "get-bundle",
        { id: sent.operation.transport.bundleId },
        "profile",
      ),
    ).toEqual(original);
    await expect(
      rpc(
        sender,
        "get-bundle",
        { id: cancelled.transport.bundleId },
        "profile",
      ),
    ).rejects.toThrow();
    host.setUnavailable(false);
    await connect();
    await expect
      .poll(async () => {
        const inbox = await rpc(owner, "contribution-command", {
          action: "inbox",
        });
        return inbox.items.find(
          (i: any) => i.id === sent.operation.certificateId,
        )?.values;
      })
      .toEqual(request.values);
    const items = (
      await rpc(owner, "contribution-command", { action: "inbox" })
    ).items;
    expect(items).toHaveLength(1);
    expect(items[0].contributor.id).toBe(b.id);
    expect(items[0].status).toBe("verified-candidate");
    expect(await rpc(owner, "ids", undefined, "profile")).not.toContain(
      cancelled.transport.bundleId,
    );
    await rpc(sender, "contribution-command", {
      action: "cancel",
      sequence: 1,
      operationId: request.operationId,
    });
    expect(
      await rpc(
        sender,
        "contribution-source",
        { id: site.bundleId },
        "profile",
      ),
    ).toBeNull();
    for (const page of pages) {
      expect(await page.evaluate(() => (window as any).formSecretLeak)).toBe(
        false,
      );
      expect(JSON.stringify(await rpc(page, "state"))).not.toContain(
        request.values.name,
      );
    }
    expect(host.requests.some((p) => p.startsWith("/api/"))).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
    await host.close();
  }
});
