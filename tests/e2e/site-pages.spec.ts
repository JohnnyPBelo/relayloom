import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { launch, password, until } from "../helpers";
import { inspectOrganisedSite, organisePages } from "../site-pages-journey";

test("copied and reordered pages preserve home and source through native persistence and author-offline viewing", async ({
  browser,
}) => {
  const a = await launch(),
    b = await launch();
  const ca = await browser.newContext({ locale: "pt-PT" }),
    cb = await browser.newContext({ locale: "pt-PT" });
  const owner = "Autora de páginas organizadas";
  try {
    const alice = await a.call("setup", { name: owner, password });
    await b.call("setup", { name: "Leitor do arquivo", password });
    await b.call("contact", { contact: alice });
    await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
    const pa = await ca.newPage(),
      pb = await cb.newPage();
    await pa.goto(a.url + "/#token=" + a.token);
    await pa
      .getByRole("button", { name: "A minha página", exact: true })
      .click();
    const output = `.cache/page-organisation/${process.env.RELAYLOOM_TEST_BACKEND ?? "node"}`;
    const value = await organisePages(pa, output);
    expect((await a.call("site-draft-load", {})).site).toEqual(value.site);
    await pa.reload();
    await pa
      .getByRole("button", { name: "A minha página", exact: true })
      .click();
    const studio = pa.getByRole("region", { name: "Estúdio do site" });
    await expect(
      studio.locator(".studio-pages > button").first(),
    ).toContainText("Arquivo de campo");
    await studio
      .getByRole("button", { name: "Publicar página", exact: true })
      .click();
    await expect(studio.getByRole("status")).toContainText("Página assinada");
    const state = await until(
      () => b.call("state"),
      (state) => state.objects.some((o: any) => o.kind === "site"),
    );
    const received = state.objects.find((o: any) => o.kind === "site");
    expect(received.author.id).toBe(alice.id);
    expect(received.content.site).toEqual(value.site);
    await ca.close();
    await a.stop();
    await pb.goto(b.url + "/#token=" + b.token);
    await inspectOrganisedSite(pb, owner);
    mkdirSync(output, { recursive: true });
    writeFileSync(
      output + "/report.json",
      JSON.stringify(
        {
          status: "PASS",
          backend: process.env.RELAYLOOM_TEST_BACKEND ?? "node",
          pages: 3,
          authorProcessStopped: true,
          sourceUnchanged: true,
          copiedSelfLinkVerified: true,
          exactDraftAndSignedSite: true,
          homePreservedAfterReorder: true,
          physicalDevice: false,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await ca.close();
    await cb.close();
    await a.stop();
    await b.stop();
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});
