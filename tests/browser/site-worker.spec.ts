import { test, expect } from "@playwright/test";
import { appHost } from "./app-host";
import { createIdentity, createBundle } from "../../packages/core/src/index";
import { createSiteContentProtocol } from "../../packages/sites/src/content";
import { nodeCertificateCrypto } from "../../packages/core/src/certificate-crypto";
const password = "production site worker fixture passphrase";
const payload = {
  type: "site",
  blocks: [],
  theme: "sand",
  site: {
    version: 1,
    title: "Publicação no worker real",
    description: "Identidade fica no motor",
    home: "home",
    design: {
      font: "sans",
      width: "standard",
      radius: "soft",
      accent: "#207a70",
    },
    pages: [{ id: "home", slug: "inicio", title: "Início", blocks: [] }],
  },
};

test("production worker publishes and recovers exact site requests, refuses forged snapshots and does not export signing helpers", async ({
  page,
}) => {
  const host = await appHost();
  try {
    await page.addInitScript(() => {
      const Original = Worker,
        w = window as any;
      w.secretLeak = false;
      const secret = (value: any): boolean =>
        !!value &&
        typeof value === "object" &&
        (Object.keys(value).some((k) =>
          ["signSecret", "boxSecret"].includes(k),
        ) ||
          Object.values(value).some(secret));
      class Observed extends Original {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          w.fixtureWorker = this;
          this.addEventListener("message", (e) => {
            if (secret(e.data)) w.secretLeak = true;
          });
        }
      }
      w.Worker = Observed;
      let next = 100000;
      w.siteRPC = (domain: string, operation: string, body?: unknown) =>
        new Promise((resolve, reject) => {
          const worker = w.fixtureWorker,
            id = ++next;
          const listener = (e: MessageEvent) => {
            if (e.data?.type !== "result" || e.data.id !== id) return;
            clearTimeout(timer);
            worker.removeEventListener("message", listener);
            e.data.error ? reject(Error(e.data.error)) : resolve(e.data.value);
          };
          const timer = setTimeout(() => {
            worker.removeEventListener("message", listener);
            reject(Error("fixture worker reply timed out"));
          }, 5000);
          worker.addEventListener("message", listener);
          worker.postMessage({ type: "request", id, domain, operation, body });
        });
    });
    await page.goto(host.url + "/browser/index.html");
    await page.getByRole("button", { name: "Começar", exact: true }).click();
    await page.getByLabel("Como te chamas?").fill("Worker site owner");
    await page.getByLabel("Frase-passe", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Criar identidade", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "As tuas conversas" }),
    ).toBeVisible();
    const initial = await page.evaluate(async (payload) => {
      const w = window as any,
        state = await w.siteRPC("api", "state"),
        address = "relayloom:site:" + state.identity.id + "/profile",
        site = await w.siteRPC("api", "site-command", {
          action: "state",
          address,
        });
      const request = {
        action: "publish",
        name: "profile",
        sequence: site.nextSequence,
        operationId: crypto.randomUUID(),
        expectedBase: site.base,
        payload,
        recipients: "public",
        ttlMs: 3600000,
      };
      const result = await w.siteRPC("api", "site-command", request);
      return { address, request, result };
    }, payload);
    expect(initial.result.operation.phase).toBe("ready");
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
    const recovered = await page.evaluate(async (initial) => {
      const w = window as any,
        repeat = await w.siteRPC("api", "site-command", initial.request),
        resolved = await w.siteRPC("api", "site-command", {
          action: "resolve",
          address: initial.address,
        });
      const denied = [];
      for (const operation of [
        "signSiteBundle",
        "decryptStaging",
        "transactValues",
      ]) {
        try {
          await w.siteRPC("profile", operation, {});
          denied.push(false);
        } catch {
          denied.push(true);
        }
      }
      return {
        id: repeat.operation.bundleId,
        title: resolved.object.content.site.title,
        count: (
          await w.siteRPC("api", "site-command", {
            action: "history",
            address: initial.address,
          })
        ).revisions.length,
        denied,
        secretLeak: w.secretLeak,
      };
    }, initial);
    expect(recovered).toEqual({
      id: initial.result.operation.bundleId,
      title: payload.site.title,
      count: 1,
      denied: [true, true, true],
      secretLeak: false,
    });
    const author = createIdentity("True snapshot owner"),
      attacker = createIdentity("Outer signature attacker"),
      content = createSiteContentProtocol(nodeCertificateCrypto).create(
        author,
        "profile",
        1,
        [],
        payload,
      ),
      forged = createBundle(attacker, "site", content, "public");
    const refused = await page.evaluate(async (bundle) => {
      const w = window as any;
      let denied = false;
      try {
        await w.siteRPC("profile", "put-bundle", { bundle });
      } catch {
        denied = true;
      }
      return {
        denied,
        stored: (await w.siteRPC("profile", "ids")).includes(
          bundle.manifest.id,
        ),
      };
    }, forged);
    expect(refused).toEqual({ denied: true, stored: false });
    await page
      .getByRole("button", { name: "Bloquear identidade", exact: true })
      .click();
    const locked = await page.evaluate(() =>
      (window as any).siteRPC("api", "state"),
    );
    expect(locked.sitePublishing).toBeNull();
    expect(locked.objects).toEqual([]);
    expect(host.requests.some((p) => p.startsWith("/api/"))).toBe(false);
  } finally {
    await host.close();
  }
});
