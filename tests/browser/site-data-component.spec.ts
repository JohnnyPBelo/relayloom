import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
const data = {
  domain: "relayloom/site-table/1",
  columns: [
    { id: "name", label: "Lugar", type: "text" },
    { id: "quantity", label: "Quantidade", type: "number" },
    { id: "open", label: "Aberto", type: "boolean" },
  ],
  rows: Array.from({ length: 27 }, (_, i) => ({
    id: "row-" + i,
    values: {
      name:
        i === 0
          ? "<script>window.siteDataInjected=true</script>"
          : "Local " + i,
      quantity: i === 26 ? 1e-15 : i,
      open: i % 2 === 0,
    },
  })),
};
test("standalone table component filters literal data, sorts, paginates and rejects active content without mutating the source", async ({
  page,
}, info) => {
  const built = await build({
    entryPoints: ["tests/browser/site-data-fixture.tsx"],
    outdir: ".cache/site-data-component",
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    target: "es2022",
  });
  const js = built.outputFiles.find((f) => f.path.endsWith(".js"))!,
    css = built.outputFiles.find((f) => f.path.endsWith(".css"))!;
  const requests: string[] = [];
  const browserRequests: string[] = [];
  page.on("request", (request) => browserRequests.push(request.url()));
  const server = createServer((request, response) => {
    requests.push(request.url!);
    if (request.url === "/table.js") {
      response.setHeader("content-type", "text/javascript");
      response.end(js.contents);
    } else if (request.url === "/table.css") {
      response.setHeader("content-type", "text/css");
      response.end(css.contents);
    } else if (request.url === "/") {
      response.setHeader("content-type", "text/html");
      response.end(
        '<!doctype html><html lang="pt-PT"><head><title>Table component fixture</title><link rel="stylesheet" href="/table.css"></head><body><div id="root"></div><script src="/table.js"></script></body></html>',
      );
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await page.goto(
      "http://127.0.0.1:" + (server.address() as { port: number }).port,
    );
    await page.evaluate((data) => {
      (window as any).sourceTable = data;
      (window as any).showTable(data);
    }, data);
    const table = page.getByRole("table", { name: "Pontos da comunidade" });
    await expect(table.getByRole("row")).toHaveCount(11);
    await page
      .getByLabel("Linhas por página", { exact: true })
      .selectOption("25");
    await expect(table.getByRole("row")).toHaveCount(26);
    await page
      .getByLabel("Linhas por página", { exact: true })
      .selectOption("10");
    await expect(table.getByRole("row")).toHaveCount(11);
    await expect(
      table.getByText("<script>window.siteDataInjected=true</script>", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => (window as any).siteDataInjected),
    ).toBeUndefined();
    await page
      .getByRole("button", { name: "Página seguinte", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("página 2 de 3");
    await page
      .getByLabel("Pesquisar nesta tabela", { exact: true })
      .fill("Local 26");
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(
      table.getByRole("cell", { name: "0,000000000000001", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Pesquisar nesta tabela", { exact: true }).fill(".*");
    await expect(
      page.getByText("Não há linhas para esta pesquisa.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Limpar filtros", exact: true })
      .click();
    const sort = page.getByRole("button", {
      name: "Ordenar por Quantidade",
      exact: true,
    });
    await sort.focus();
    await page.keyboard.press("Enter");
    await expect(sort.locator("..")).toHaveAttribute("aria-sort", "ascending");
    await page.keyboard.press("Enter");
    await expect(sort.locator("..")).toHaveAttribute("aria-sort", "descending");
    await expect(table.getByRole("row").nth(1)).toContainText("Local 25");
    const snapshot = await page.evaluate(() => (window as any).sourceTable);
    expect(snapshot).toEqual(data);
    await page.setViewportSize({ width: 390, height: 844 });
    const region = page.getByRole("region", {
      name: "Dados de Pontos da comunidade",
      exact: true,
    });
    await region.focus();
    await expect(region).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    const out =
      ".cache/site-data-component/" + (info.project.name || "chromium");
    mkdirSync(out, { recursive: true });
    writeFileSync(
      out + "/axe.json",
      JSON.stringify(
        { violations: axe.violations, passes: axe.passes.length },
        null,
        2,
      ),
    );
    await page.screenshot({ path: out + "/table.png", fullPage: true });
    await page.evaluate(() => {
      const original = (window as any).sourceTable;
      (window as any).showTable({
        domain: original.domain,
        columns: [{ id: "date", label: "Data", type: "date" }],
        rows: [{ id: "ancient", values: { date: "0000-02-29" } }],
      });
    });
    await expect(table.getByRole("cell")).toHaveText(
      await page.evaluate(() =>
        new Intl.DateTimeFormat("pt-PT", {
          year: "numeric",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
          era: "short",
        }).format(new Date("0000-02-29T00:00:00.000Z")),
      ),
    );
    await page.evaluate(() => {
      const invalid = {
        ...(window as any).sourceTable,
        script: "https://example.org/run.js",
      };
      (window as any).showTable(invalid);
    });
    await expect(page.getByRole("alert")).toHaveText(
      "Não foi possível verificar os dados desta tabela.",
    );
    await expect(page.getByRole("table")).toHaveCount(0);
    expect(
      requests.some(
        (path) => path.includes("example.org") || path.startsWith("/api/"),
      ),
    ).toBe(false);
    expect(
      browserRequests.every((url) => new URL(url).hostname === "127.0.0.1"),
    ).toBe(true);
    // Deterministic control of the deferred post-save focus callback. An input
    // chosen in the intervening frame belongs to the user, including AT/autofill.
    await page.evaluate(() => (window as any).showStudio());
    await expect(
      page.getByRole("button", { name: "Publicar página", exact: true }),
    ).toHaveCSS("background-color", "rgb(17, 87, 79)");
    await page
      .getByRole("button", { name: "Guardar rascunho", exact: true })
      .click();
    await page.evaluate(() => (window as any).completeSave());
    const field = page.getByLabel("Linha 1, Litros", { exact: true });
    await expect(field).toBeEnabled();
    await field.fill("1e-");
    await expect(field).toHaveValue("1e-");
    await page.evaluate(() => (window as any).releaseSaveFrames());
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("1e-");
    await expect(field).toHaveAttribute("aria-invalid", "true");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
