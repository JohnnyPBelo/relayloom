import { test, expect } from "@playwright/test";
import { appHost } from "./app-host";
import { formPayload, formRowSentinel } from "../fixtures/site-form";

test("production worker describes an authenticated form after UI setup and unlock without exposing keys or accepting caller authority", async ({
  page,
}) => {
  const host = await appHost(),
    password = "production form context passphrase";
  try {
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
      w.formRPC = (operation: string, body?: unknown) =>
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
            domain: "api",
            operation,
            body,
          });
        });
    });
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
