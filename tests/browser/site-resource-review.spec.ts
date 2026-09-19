import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { appHost } from "./app-host";
const password = "resource UI account fixture passphrase";
let host: Awaited<ReturnType<typeof appHost>>;
test.beforeAll(async () => {
  host = await appHost();
});
test.afterAll(async () => {
  await host.close();
  expect(host.requests.some((path) => path.startsWith("/api/"))).toBe(false);
});
async function enter(page: Page, name: string) {
  await page.goto(host.url + "/browser/index.html");
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
async function nav(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  if (!(await button.isVisible()))
    await page
      .getByRole("button", { name: "Abrir navegação", exact: true })
      .click();
  await button.click();
}
async function card(page: Page) {
  await nav(page, "Definições");
  return JSON.parse(
    await page.getByLabel("Cartão público da identidade").inputValue(),
  );
}
async function addContact(page: Page, contact: unknown) {
  await nav(page, "Conversas");
  await page
    .getByRole("button", { name: "Adicionar contacto", exact: true })
    .click();
  await page
    .getByLabel("Cartão público do contacto")
    .fill(JSON.stringify(contact));
  await page.getByRole("button", { name: "Verificar e adicionar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function relay(page: Page, enabled: boolean) {
  await nav(page, "A rede");
  await page
    .getByLabel("Permitir retransmissão", { exact: true })
    .setChecked(enabled);
}
async function connect(a: Page, b: Page) {
  for (const p of [a, b]) {
    await nav(p, "A rede");
    await p.getByRole("button", { name: "Ligar um par", exact: true }).click();
  }
  await a
    .getByRole("button", { name: "Criar código de ligação", exact: true })
    .click();
  const offer = await a.getByLabel("Código para partilhar").inputValue();
  await b.getByRole("tab", { name: "Receber código", exact: true }).click();
  await b.getByLabel("Código de ligação recebido").fill(offer);
  await b.getByRole("button", { name: "Criar resposta", exact: true }).click();
  const answer = await b.getByLabel("Código para partilhar").inputValue();
  await a.getByLabel("Resposta do outro dispositivo").fill(answer);
  await a
    .getByRole("button", { name: "Concluir ligação", exact: true })
    .click();
  await expect(
    a.getByText("Ligação estabelecida. Já podem trocar conteúdo.", {
      exact: true,
    }),
  ).toBeVisible();
  for (const p of [a, b])
    await p
      .getByRole("dialog")
      .getByRole("button", { name: "Fechar", exact: true })
      .click();
}
async function siteOf(page: Page, name: string) {
  await nav(page, "A praça");
  await page
    .getByRole("button", { name: "Ver página de " + name, exact: true })
    .click();
  return page.getByRole("dialog", { name: "Página de " + name, exact: true });
}
async function studioOf(page: Page) {
  await nav(page, "A minha página");
  return page.getByRole("region", { name: "Estúdio do site", exact: true });
}
async function newFile(
  library: Locator,
  name: string,
  mimeType: string,
  buffer: Buffer,
) {
  await library
    .getByRole("button", { name: "Novo ficheiro", exact: true })
    .click();
  await library
    .getByLabel("Ficheiro do recurso", { exact: true })
    .setInputFiles({ name, mimeType, buffer });
  await library
    .getByRole("button", { name: "Guardar recurso", exact: true })
    .click();
  await expect(
    library.getByRole("heading", { name, exact: true }),
  ).toBeVisible();
}
async function withFile(page: Page, name: string, bytes: Buffer) {
  const studio = await studioOf(page);
  await studio.getByRole("button", { name: /Opções de publicação:/ }).click();
  await studio
    .getByLabel("Quem pode ler o site", { exact: true })
    .selectOption("public");
  await studio.getByRole("button", { name: "Recursos", exact: true }).click();
  const library = page.getByRole("dialog", {
    name: "Biblioteca de recursos",
    exact: true,
  });
  await newFile(library, name, "text/plain", bytes);
  await library
    .getByRole("button", { name: "Inserir no site", exact: true })
    .click();
  // Insertion verifies the local resource asynchronously. selectOption can
  // otherwise mutate an inert background select before that operation finishes.
  await expect(library).toHaveCount(0);
  await expect(studio.locator("[data-resource-id]")).toHaveCount(1);
  await expect(
    studio.getByRole("heading", { name, exact: true }),
  ).toBeVisible();
  return studio;
}
async function publish(studio: Locator, expectedVersion = 1) {
  await studio
    .getByRole("button", { name: "Guardar rascunho", exact: true })
    .click();
  await studio
    .getByRole("button", { name: "Publicar página", exact: true })
    .click();
  await expect(
    studio.getByRole("status", {
      name: "Estado da publicação do site",
      exact: true,
    }),
  ).toContainText("Página assinada");
  await expect(
    studio.getByRole("button", { name: "Publicar página", exact: true }),
  ).toBeEnabled();
  await expect(
    studio.getByText(`Versão ${expectedVersion} conhecida`, { exact: true }),
  ).toBeVisible();
}

test("resource polling keeps the obtain action busy until its own real Worker reply arrives", async ({
  browser,
}, info) => {
  const out = `.cache/resource-review/${info.project.name}/overlap${info.repeatEachIndex ? "-repeat" + info.repeatEachIndex : ""}`;
  mkdirSync(out, { recursive: true });
  const contexts = [await browser.newContext(), await browser.newContext()];
  const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
  await b.addInitScript(() => {
    const Original = Worker,
      w = window as any;
    w.resourceReadControl = {
      requested: false,
      inspected: false,
      held: false,
      released: false,
      obtainRequests: 0,
    };
    class Observed extends Original {
      actions = new Map<number, string>();
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event) => {
          const action = this.actions.get(event.data?.id),
            result = event.data?.value;
          if (event.data?.type !== "result" || !action) return;
          const control = w.resourceReadControl;
          if (action === "obtain" && result?.status === "requested")
            control.requested = true;
          if (
            action === "inspect" &&
            result?.status === "available" &&
            control.requested
          )
            control.inspected = true;
          if (
            action === "obtain" &&
            result?.content &&
            control.inspected &&
            !control.held
          ) {
            control.held = true;
            event.stopImmediatePropagation();
            w.releaseResourceRead = () => {
              control.released = true;
              this.dispatchEvent(
                new MessageEvent("message", { data: event.data }),
              );
            };
          }
        });
      }
      override postMessage(value: any, ...rest: any[]) {
        if (
          value?.type === "request" &&
          value.operation === "resource-command" &&
          ["inspect", "obtain"].includes(value.body?.action)
        ) {
          this.actions.set(value.id, value.body.action);
          if (value.body.action === "obtain")
            w.resourceReadControl.obtainRequests++;
        }
        return super.postMessage(value, ...(rest as [any]));
      }
    }
    w.Worker = Observed;
  });
  const bytes = Buffer.from(
    "Delayed reply retains its owner and exact verified bytes\n".repeat(64),
  );
  try {
    await enter(a, "Autora da leitura");
    await enter(b, "Leitor da leitura");
    const author = await card(a);
    await addContact(b, author);
    await relay(a, true);
    await relay(b, true);
    await connect(a, b);
    const studio = await withFile(a, "Resposta verificada.txt", bytes);
    await publish(studio);
    const visit = await siteOf(b, author.name),
      obtain = visit.getByRole("button", {
        name: "Obter ficheiro",
        exact: true,
      });
    await expect(
      visit.getByText("Ainda não guardado neste dispositivo", { exact: true }),
    ).toBeVisible();
    await obtain.click();
    await expect
      .poll(() => b.evaluate(() => (window as any).resourceReadControl.held))
      .toBe(true);
    const control = await b.evaluate(() => (window as any).resourceReadControl);
    const busy = await obtain.isDisabled();
    writeFileSync(
      out + "/control.json",
      JSON.stringify({ control, busy }, null, 2),
    );
    expect(control.requested).toBe(true);
    expect(control.inspected).toBe(true);
    expect
      .soft(busy, "inspect finally must not clear a later obtain's busy state")
      .toBe(true);
    await b.evaluate(() => (window as any).releaseResourceRead());
    const link = visit.getByRole("link", { name: /Guardar ficheiro/ });
    await expect(link).toBeVisible();
    const download = b.waitForEvent("download");
    await link.click();
    await (await download).saveAs(out + "/received.txt");
    expect(readFileSync(out + "/received.txt")).toEqual(bytes);
    await expect(visit.locator(".resource-credit")).toContainText(author.name);
  } finally {
    for (const c of contexts) await c.close();
  }
});

test("signed resource reader follows all site palettes independently of the application theme", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const out = `.cache/resource-review/${info.project.name}/palettes${info.repeatEachIndex ? "-repeat" + info.repeatEachIndex : ""}`;
  mkdirSync(out, { recursive: true });
  const contexts = [
    await browser.newContext(),
    await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    }),
  ];
  const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
  await b.addInitScript(() => {
    const w = window as any,
      ids = new WeakMap<object, number>();
    let next = 0,
      last = "";
    w.resourceFocusDiagnostics = [];
    const node = (el: Element | null) => {
      if (!el) return null;
      if (!ids.has(el)) ids.set(el, ++next);
      return {
        id: ids.get(el),
        tag: el.tagName,
        name: el.getAttribute("aria-label") || el.textContent?.slice(0, 70),
        connected: el.isConnected,
      };
    };
    const record = (value: any) => {
      if (w.resourceFocusDiagnostics.length < 5000)
        w.resourceFocusDiagnostics.push({ at: performance.now(), ...value });
    };
    for (const type of ["focusin", "focusout"])
      document.addEventListener(type, (event) =>
        record({
          type,
          target: node(event.target as Element),
          active: node(document.activeElement),
        }),
      );
    new MutationObserver(() => {
      const view = {
        resource: node(document.querySelector("dialog .site-resource")),
        active: node(document.activeElement),
        version: document.querySelector(".site-visit-state span")?.textContent,
      };
      const key = JSON.stringify(view);
      if (key !== last) {
        last = key;
        record({ type: "dom", ...view });
      }
    }).observe(document, { subtree: true, childList: true, attributes: true });
    const Original = Worker;
    class Observed extends Original {
      resolves = new Set<number>();
      override postMessage(value: any, ...rest: any[]) {
        if (
          value?.type === "request" &&
          value.operation === "site-command" &&
          value.body?.action === "resolve"
        ) {
          this.resolves.add(value.id);
          record({ type: "resolve-request", id: value.id });
        }
        return super.postMessage(value, ...(rest as [any]));
      }
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event) => {
          if (event.data?.type === "result" && this.resolves.has(event.data.id))
            record({
              type: "resolve-reply",
              id: event.data.id,
              snapshot: event.data.value?.object?.id,
            });
        });
      }
    }
    w.Worker = Observed;
  });
  try {
    await enter(a, "Autora das cores");
    await enter(b, "Leitor das cores");
    const author = await card(a);
    await addContact(b, author);
    await relay(a, true);
    await relay(b, true);
    await connect(a, b);
    const studio = await withFile(
      a,
      "Paletas legíveis.txt",
      Buffer.from("Legível em todas as paletas."),
    );
    const records: any[] = [];
    let revision = 0;
    for (const theme of ["light", "dark"]) {
      if ((await b.locator("html").getAttribute("data-theme")) !== theme)
        await b
          .getByRole("button", { name: "Alternar tema", exact: true })
          .click();
      await expect(b.locator("html")).toHaveAttribute("data-theme", theme);
      for (const palette of ["sand", "forest", "ink"]) {
        await studio.getByLabel("Paleta da página").selectOption(palette);
        await publish(studio, ++revision);
        const visit = await siteOf(b, author.name);
        await expect(
          visit.getByText(`A ler a versão ${revision}`, { exact: true }),
        ).toBeVisible();
        const resource = visit.locator(".site-resource");
        await expect(async () => {
          await resource.scrollIntoViewIfNeeded();
        }).toPass({ timeout: 15000 });
        const colors = await resource.evaluate((el) => ({
          card: getComputedStyle(el).backgroundColor,
          paper: getComputedStyle(el.closest(".studio-surface")!)
            .backgroundColor,
        }));
        expect
          .soft(
            colors.card,
            theme + "/" + palette + " card uses the site's paper",
          )
          .toBe(colors.paper);
        const button = visit.getByRole("button", {
          name: "Obter ficheiro",
          exact: true,
        });
        await button.focus();
        // Stay inside the dialog: Tab from its last control can enter browser chrome.
        await b.keyboard.press("Shift+Tab");
        await b.keyboard.press("Tab");
        await expect(button).toBeFocused();
        const focus = await button.evaluate((el) => {
          const s = getComputedStyle(el);
          return {
            style: s.outlineStyle,
            width: s.outlineWidth,
            color: s.outlineColor,
            text: s.color,
            parentText: getComputedStyle(el.parentElement!).color,
            colorRules: [...document.styleSheets].flatMap((sheet) => {
              const scan = (rules: CSSRuleList): any[] =>
                [...rules].flatMap((rule) => {
                  if (
                    rule instanceof CSSStyleRule &&
                    rule.style.color &&
                    el.matches(rule.selectorText)
                  )
                    return [
                      {
                        selector: rule.selectorText,
                        color: rule.style.color,
                        priority: rule.style.getPropertyPriority("color"),
                      },
                    ];
                  return "cssRules" in rule
                    ? scan((rule as CSSGroupingRule).cssRules)
                    : [];
                });
              return scan(sheet.cssRules);
            }),
          };
        });
        expect(focus.style).not.toBe("none");
        expect(parseFloat(focus.width)).toBeGreaterThanOrEqual(2);
        const before = await new AxeBuilder({ page: b })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        await b.screenshot({ path: out + `/${theme}-${palette}-before.png` });
        await button.click();
        await expect(
          visit.getByRole("link", { name: /Guardar ficheiro/ }),
        ).toBeVisible();
        await expect(async () => {
          await resource.scrollIntoViewIfNeeded();
        }).toPass({ timeout: 15000 });
        const after = await new AxeBuilder({ page: b })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        await b.screenshot({ path: out + `/${theme}-${palette}-after.png` });
        records.push({
          theme,
          palette,
          colors,
          focus,
          before: before.violations,
          after: after.violations,
        });
        writeFileSync(out + "/result.json", JSON.stringify(records, null, 2));
        expect
          .soft(before.violations, theme + "/" + palette + " before")
          .toEqual([]);
        expect
          .soft(after.violations, theme + "/" + palette + " after")
          .toEqual([]);
        await visit
          .getByRole("button", { name: "Fechar", exact: true })
          .click();
      }
    }
  } finally {
    writeFileSync(
      out + "/focus-diagnostics.json",
      JSON.stringify(
        await b.evaluate(() => (window as any).resourceFocusDiagnostics),
        null,
        2,
      ),
    );
    for (const c of contexts) await c.close();
  }
});

test("switching resource previews never associates a new filename or MIME with the previous file URL", async ({
  page,
}, info) => {
  const out = `.cache/resource-review/${info.project.name}/preview${info.repeatEachIndex ? "-repeat" + info.repeatEachIndex : ""}`;
  mkdirSync(out, { recursive: true });
  await page.addInitScript(() => {
    const w = window as any,
      create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    w.previewURLs = new Map();
    w.previewBoundaries = [];
    w.revokedPreviewURLs = [];
    const snapshot = (boundary: string) => {
      for (const link of document.querySelectorAll<HTMLAnchorElement>(
        ".resource-library-preview a[download]",
      ))
        w.previewBoundaries.push({
          boundary,
          href: link.href,
          name: link.download,
          src: link.closest("section")?.querySelector("img")?.src,
        });
    };
    URL.createObjectURL = (object) => {
      const url = create(object);
      if (object instanceof Blob) w.previewURLs.set(url, object);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      snapshot("cleanup");
      w.revokedPreviewURLs.push(url);
      revoke(url);
    };
    new MutationObserver(() => snapshot("mutation")).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
    });
  });
  await enter(page, "Autora das pré-visualizações");
  const studio = await studioOf(page);
  await studio.getByRole("button", { name: "Recursos", exact: true }).click();
  const library = page.getByRole("dialog", {
    name: "Biblioteca de recursos",
    exact: true,
  });
  const files = [
    {
      name: "Primeiro.txt",
      mime: "text/plain",
      bytes: Buffer.from("FIRST_FILE_DISTINCT_BYTES"),
    },
    {
      name: "Segundo.json",
      mime: "application/json",
      bytes: Buffer.from('{"second":"distinct JSON bytes"}'),
    },
  ];
  for (const file of files)
    await newFile(library, file.name, file.mime, file.bytes);
  for (const file of [files[0], files[1], files[0]]) {
    await library
      .locator(".resource-card")
      .filter({
        has: page.getByRole("heading", { name: file.name, exact: true }),
      })
      .getByRole("button", { name: "Abrir recurso", exact: true })
      .click();
    await expect(
      library.locator(".resource-library-preview a[download]"),
    ).toHaveAttribute("download", file.name);
    const download = page.waitForEvent("download");
    await library.locator(".resource-library-preview a[download]").click();
    const received = await download;
    expect(received.suggestedFilename()).toBe(file.name);
    await received.saveAs(out + "/" + file.name);
    expect(readFileSync(out + "/" + file.name)).toEqual(file.bytes);
  }
  const result = await page.evaluate(async () => {
    const w = window as any;
    const sources = Object.fromEntries(
      await Promise.all(
        [...w.previewURLs.entries()].map(async ([url, blob]: any) => [
          url,
          { mime: blob.type, text: await blob.text() },
        ]),
      ),
    );
    return {
      sources,
      boundaries: w.previewBoundaries,
      revoked: w.revokedPreviewURLs,
    };
  });
  writeFileSync(out + "/result.json", JSON.stringify(result, null, 2));
  expect(result.revoked.length).toBeGreaterThanOrEqual(2);
  expect(result.boundaries.length).toBeGreaterThan(0);
  const bad = result.boundaries.filter((entry: any) => {
    const file = files.find((file) => file.name === entry.name),
      source = result.sources[entry.href];
    return (
      !file ||
      !source ||
      source.mime !== file.mime ||
      source.text !== file.bytes.toString()
    );
  });
  expect(
    bad,
    "every observable DOM/cleanup boundary keeps URL, filename, MIME and bytes together",
  ).toEqual([]);
  await library
    .getByRole("button", { name: "Fechar pré-visualização", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).revokedPreviewURLs.length))
    .toBe(3);
});

test("late site inventory preserves an already verified reader and focus; failed refresh clears the old view", async ({
  browser,
}, info) => {
  const out = `.cache/resource-review/${info.project.name}/stable-reader${info.repeatEachIndex ? "-repeat" + info.repeatEachIndex : ""}`;
  mkdirSync(out, { recursive: true });
  const contexts = [await browser.newContext(), await browser.newContext()];
  const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
  await b.addInitScript(() => {
    const Original = Worker,
      w = window as any;
    w.siteStateControl = {
      hold: false,
      versions: [] as number[],
      snapshots: [] as string[],
      dropResolve: false,
      dropped: false,
      forwardedBeforeTarget: 0,
      heldReplies: 0,
    };
    const held: (() => void)[] = [];
    w.releaseSiteState = () => {
      w.siteStateControl.hold = false;
      for (const release of held.splice(0)) release();
    };
    class Observed extends Original {
      requests = new Map<number, string>();
      override postMessage(value: any, ...rest: any[]) {
        if (value?.type === "request" && value.domain === "api") {
          if (value.operation === "state") this.requests.set(value.id, "state");
          if (
            value.operation === "site-command" &&
            value.body?.action === "resolve"
          )
            this.requests.set(value.id, "resolve");
        }
        return super.postMessage(value, ...(rest as [any]));
      }
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event) => {
          if (event.data?.type !== "result") return;
          const request = this.requests.get(event.data.id),
            control = w.siteStateControl;
          if (request === "state" && control.hold) {
            control.versions = (event.data.value?.objects ?? [])
              .filter((o: any) => o.kind === "site")
              .map((o: any) => o.content?.siteRevision?.body?.number);
            // State polling admits only one in-flight refresh. Withholding a
            // pre-version-2 reply would prevent the observation we are awaiting.
            if (!control.versions.includes(2)) {
              control.forwardedBeforeTarget++;
              return;
            }
            control.heldReplies++;
            event.stopImmediatePropagation();
            held.push(() =>
              this.dispatchEvent(
                new MessageEvent("message", { data: event.data }),
              ),
            );
          }
          if (request === "resolve") {
            control.snapshots.push(
              event.data.value?.object?.id ?? "unavailable",
            );
            if (control.dropResolve && !control.dropped) {
              control.dropped = true;
              event.stopImmediatePropagation();
            }
          }
        });
      }
    }
    w.Worker = Observed;
  });
  try {
    await enter(a, "Autora do leitor estável");
    await enter(b, "Leitor com teclado");
    const author = await card(a);
    await addContact(b, author);
    await relay(a, true);
    await relay(b, true);
    await connect(a, b);
    const studio = await withFile(
      a,
      "Leitura estável.txt",
      Buffer.from("Focus belongs to the reader"),
    );
    await publish(studio);
    let visit = await siteOf(b, author.name);
    await expect(
      visit.getByText("A ler a versão 1", { exact: true }),
    ).toBeVisible();
    await visit.getByRole("button", { name: "Fechar", exact: true }).click();
    await b.evaluate(() => {
      (window as any).siteStateControl.hold = true;
    });
    await studio.getByLabel("Paleta da página").selectOption("forest");
    await publish(studio, 2);
    await expect
      .poll(() =>
        b.evaluate(() => (window as any).siteStateControl.versions.includes(2)),
      )
      .toBe(true);
    visit = await siteOf(b, author.name);
    await expect(
      visit.getByText("A ler a versão 2", { exact: true }),
    ).toBeVisible();
    const button = visit.getByRole("button", {
      name: "Obter ficheiro",
      exact: true,
    });
    await button.focus();
    await expect(button).toBeFocused();
    const original = await button.elementHandle();
    const before = await b.evaluate(
      () => (window as any).siteStateControl.snapshots.length,
    );
    await b.evaluate(() => (window as any).releaseSiteState());
    await expect
      .poll(() =>
        b.evaluate(() => (window as any).siteStateControl.snapshots.length),
      )
      .toBeGreaterThan(before);
    await expect(visit.locator(".site-resource")).toBeVisible();
    await b.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const control = await b.evaluate(() => (window as any).siteStateControl);
    expect(control.heldReplies).toBeGreaterThan(0);
    expect(control.snapshots.at(-1)).toBe(control.snapshots.at(-2));
    const retained = await original!.evaluate((el) => ({
      connected: el.isConnected,
      focused: document.activeElement === el,
    }));
    writeFileSync(
      out + "/same-head.json",
      JSON.stringify({ control, retained }, null, 2),
    );
    expect
      .soft(
        retained,
        "metadata about the same verified snapshot must not replace the reader",
      )
      .toEqual({ connected: true, focused: true });
    // The next real resolve reply is lost. A failed refresh must stop showing the
    // previous snapshot instead of silently presenting it as the current head.
    await b.evaluate(() => {
      (window as any).siteStateControl.dropResolve = true;
    });
    await studio.getByLabel("Paleta da página").selectOption("ink");
    await publish(studio, 3);
    await expect
      .poll(() => b.evaluate(() => (window as any).siteStateControl.dropped))
      .toBe(true);
    await expect(visit.getByRole("alert")).toContainText(
      "O motor demorou demasiado",
      { timeout: 25000 },
    );
    await expect(visit.locator(".site-resource")).toHaveCount(0);
    writeFileSync(
      out + "/failed-refresh.json",
      JSON.stringify(
        { realWorkerReplyDropped: true, oldReaderAbsent: true },
        null,
        2,
      ),
    );
  } finally {
    for (const c of contexts) await c.close();
  }
});
