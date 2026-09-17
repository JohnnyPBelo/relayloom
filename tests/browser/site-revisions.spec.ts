import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { siteRevisions } from "../../packages/sites/src/index";
import { staticHarness } from "./static-harness";
const vectors = JSON.parse(
  readFileSync("tests/fixtures/site-revisions.json", "utf8"),
);

async function goFixture(input: string) {
  const child = spawn(
    process.execPath,
    [
      "scripts/go.mjs",
      "test",
      "-count=1",
      "-timeout=45s",
      "-p=1",
      "./sites",
      "-run",
      "^TestSiteRevisionInteropFixture$",
    ],
    {
      env: { ...process.env, RELAYLOOM_SITE_VECTOR_INPUT: input },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    },
  );
  let output = "",
    expired = false;
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      output = (output + data).slice(-65536);
    });
  const signal = (value: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      if (process.platform === "win32") child.kill(value);
      else process.kill(-child.pid, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    expired = true;
    signal("SIGTERM");
    escalation = setTimeout(() => signal("SIGKILL"), 3000);
  }, 60_000);
  try {
    const code = await new Promise<number | null>((done, fail) => {
      child.on("error", fail);
      child.on("close", done);
    });
    if (code !== 0 || expired)
      throw new Error("Go site fixture failed: " + output);
  } finally {
    clearTimeout(timer);
    clearTimeout(escalation);
  }
}

test("real browser, Node and Go agree on signed site snapshots while reading keys cannot edit them", async ({
  page,
}, info) => {
  const host = await staticHarness();
  mkdirSync(".cache/site-revisions", { recursive: true });
  const directory = mkdtempSync(
    resolve(".cache/site-revisions", "browser-vector-"),
  );
  try {
    await page.goto(host.url);
    const result = await page.evaluate(async (fixture) => {
      const r = (window as any).rl;
      r.sites.verifySnapshot(
        fixture.first,
        fixture.payload,
        fixture.owner.id,
        "profile",
      );
      for (const test of fixture.invalid) {
        let rejected = false;
        try {
          r.sites.verifyRevision(test.revision);
        } catch {
          rejected = true;
        }
        if (!rejected)
          throw Error("invalid certificate accepted: " + test.name);
      }
      const owner = await r.createIdentity("Browser site owner"),
        reader = await r.createIdentity("Browser reading owner");
      const header = r.sites.createSuccessor(
        owner,
        "profile",
        [],
        r.sites.documentHash(fixture.payload),
      );
      const encrypted = await r.createBundle(
        owner,
        "site",
        { payload: fixture.payload, header },
        [owner.public, reader.public],
      );
      const opened = await r.decryptBundle(encrypted, reader);
      r.sites.verifySnapshot(
        opened.header,
        opened.payload,
        owner.public.id,
        "profile",
      );
      let denied = false;
      try {
        r.sites.createSuccessor(
          { ...owner, signSecret: owner.boxSecret },
          "profile",
          [header],
          r.sites.documentHash({ title: "forged" }),
        );
      } catch {
        denied = true;
      }
      if (!denied) throw Error("reading key gained signing authority");
      const next = r.sites.createSuccessor(
        owner,
        "profile",
        [header],
        r.sites.documentHash({ title: "newer" }),
      );
      const observed = r.sites.classifyRevisions(owner.public.id, "profile", [
        next,
        header,
        header,
      ]);
      if (observed.number !== 2 || observed.heads[0].id !== next.id)
        throw Error("old snapshot replaced newer header");
      return {
        ownerId: owner.public.id,
        name: "profile",
        payload: fixture.payload,
        revision: header,
      };
    }, vectors);
    siteRevisions.verifySnapshot(
      result.revision,
      result.payload,
      result.ownerId,
      result.name,
    );
    const input = join(directory, "public-input.json");
    writeFileSync(input, JSON.stringify(result), { mode: 0o600 });
    await goFixture(input);
    const go = JSON.parse(readFileSync(input + ".out.json", "utf8"));
    expect(go.browserSignatureVerified).toBe(true);
    expect(go.tamperedPayloadRejected).toBe(true);
    expect(go.documentHash).toBe(siteRevisions.documentHash(result.payload));
    siteRevisions.verifySnapshot(
      go.revision,
      result.payload,
      go.owner.id,
      "profile",
    );
    await page.evaluate(
      ({ go, payload }) => {
        (window as any).rl.sites.verifySnapshot(
          go.revision,
          payload,
          go.owner.id,
          "profile",
        );
      },
      { go, payload: result.payload },
    );
    const out = `.cache/site-revisions/${info.project.name || "chromium"}`;
    mkdirSync(out, { recursive: true });
    writeFileSync(
      out + "/report.json",
      JSON.stringify(
        {
          status: "PASS",
          nodeToBrowser: true,
          browserToNodeAndGo: true,
          goToNodeAndBrowser: true,
          readingKeyDenied: true,
          oldHeaderCannotReplaceNewer: true,
          invalidNodeVectorsRejected: vectors.invalid.length,
          scope:
            "Real browser cryptography and Go process certificate interop; no application persistence, site transport or physical-device claim.",
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await host.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
