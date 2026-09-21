import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { staticHarness } from "./static-harness";
let host: Awaited<ReturnType<typeof staticHarness>>;
test.beforeAll(async () => {
  host = await staticHarness();
});
test.afterAll(async () => {
  await host.close();
  expect(host.requests.some((p) => p.startsWith("/api/"))).toBe(false);
});
test("v4 forms require the site catalogue before signing; schema binding survives a real encrypted browser snapshot", async ({
  page,
}, info) => {
  await page.goto(host.url);
  const result = await page.evaluate(async () => {
    const r = (window as any).rl,
      p = await r.BrowserProfile.connect("v4-forms-" + crypto.randomUUID()),
      published: any[] = [];
    const app = new r.BrowserApplication(p, {
      publish: (b: any) => published.push(b),
      command: async () => {},
      state: () => ({ peers: [], counters: {}, error: "" }),
      context: () => {},
    });
    try {
      await app.call("setup", {
        name: "Dona v4",
        password: "passphrase for v4 document fixture",
      });
      const payload = {
        type: "site",
        theme: "sand",
        blocks: [],
        site: {
          version: 4,
          title: "Comunidade",
          description: "Propostas para revisão",
          home: "home",
          design: {
            font: "sans",
            width: "standard",
            radius: "soft",
            accent: "#207a70",
          },
          pages: [
            {
              id: "home",
              slug: "inicio",
              title: "Início",
              blocks: [
                {
                  id: "form",
                  type: "form",
                  title: "Participar",
                  body: "",
                  form: {
                    domain: "relayloom/site-form/1",
                    table: { pageId: "home", blockId: "table" },
                    fields: [{ column: "name", required: true }],
                    contributors: "readers",
                  },
                },
                {
                  id: "table",
                  type: "table",
                  title: "Lugares",
                  body: "",
                  data: {
                    domain: "relayloom/site-table/1",
                    columns: [{ id: "name", label: "Nome", type: "text" }],
                    rows: [],
                  },
                },
              ],
            },
          ],
        },
      };
      const sign = p.signContent.bind(p);
      let signatures = 0;
      p.signContent = async (...args: any[]) => {
        signatures++;
        return sign(...args);
      };
      let unsignedFailure = "";
      try {
        await app.call("publish", { content: payload, recipients: "public" });
      } catch (error) {
        unsignedFailure = (error as Error).message;
      }
      const unsignedSignatures = signatures,
        unpublished = published.length === 0;
      const address = "relayloom:site:" + p.identity.id + "/profile";
      const state = await app.call("site-command", {
        action: "state",
        address,
      });
      const request = {
        action: "publish",
        name: "profile",
        sequence: state.nextSequence,
        operationId: crypto.randomUUID(),
        expectedBase: state.base,
        payload,
        recipients: "public",
        ttlMs: 3600000,
      };
      const operation = (await app.call("site-command", request)).operation;
      const content = await p.view(operation.bundleId);
      const repeated = (await app.call("site-command", request)).operation;
      const invalid = structuredClone(payload);
      invalid.site.pages[0].blocks[0].form!.table.blockId = "absent";
      const next = await app.call("site-command", { action: "state", address });
      let invalidDenied = false;
      try {
        await app.call("site-command", {
          ...request,
          payload: invalid,
          sequence: next.nextSequence,
          expectedBase: next.base,
          operationId: crypto.randomUUID(),
        });
      } catch {
        invalidDenied = true;
      }
      return {
        unsignedFailure,
        unsignedSignatures,
        unpublished,
        phase: operation.phase,
        sameResult: operation.bundleId === repeated.bundleId,
        ownerBound: content.siteRevision.body.owner.id === p.identity.id,
        form: content.site.pages[0].blocks[0].form,
        invalidDenied,
      };
    } finally {
      app.close();
    }
  });
  const out = ".cache/site-form-document-browser";
  mkdirSync(out, { recursive: true });
  writeFileSync(
    out + "/" + info.project.name + ".json",
    JSON.stringify(result, null, 2) + "\n",
  );
  expect(result.unsignedFailure).toBe(
    "Publica revisões através do comando de site",
  );
  expect(result.unsignedSignatures).toBe(0);
  expect(result.unpublished).toBe(true);
  expect(result.phase).toBe("ready");
  expect(result.sameResult).toBe(true);
  expect(result.ownerBound).toBe(true);
  expect(result.form.table.blockId).toBe("table");
  expect(result.invalidDenied).toBe(true);
});
