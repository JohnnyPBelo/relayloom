import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { staticHarness } from "./static-harness";
import { canonical, createIdentity } from "../../packages/core/src/index";
import * as nodeGroups from "../../packages/groups/src/certificates";
const keyVectors: { smallOrder: string[]; noncanonical: string[] } = JSON.parse(
  readFileSync("tests/fixtures/signing-key-profile.json", "utf8"),
);

async function goFixture(inputPath: string) {
  const child = spawn(
    process.execPath,
    [
      "scripts/go.mjs",
      "test",
      "-count=1",
      "-timeout=45s",
      "-p=2",
      "./groups",
      "-run",
      "^TestGroupCertificateInteropFixture$",
    ],
    {
      env: { ...process.env, RELAYLOOM_GROUP_VECTOR_INPUT: inputPath },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    },
  );
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (b) => {
      output = (output + b).slice(-65536);
    });
  return new Promise<void>((accept, reject) => {
    let timedOut = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const signal = (value: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") child.kill(value);
        else process.kill(-child.pid, value);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      signal("SIGTERM");
      escalation = setTimeout(() => signal("SIGKILL"), 3000);
    }, 60_000);
    child.once("error", (e) => {
      clearTimeout(timer);
      clearTimeout(escalation);
      reject(e);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      clearTimeout(escalation);
      if (code === 0 && !timedOut) accept();
      else
        reject(
          new Error(
            `Go group fixture ${timedOut ? "timeout" : code}: ${output}`,
          ),
        );
    });
  });
}

test("browser identity and group authority refuse all small-order reference keys and noncanonical aliases", async ({
  page,
}) => {
  const host = await staticHarness();
  try {
    await page.goto(host.url);
    const result = await page.evaluate(async (vectors) => {
      const r = (window as any).rl,
        good = await r.createIdentity("Browser key control"),
        signature = new Uint8Array(64),
        prefix = Uint8Array.of(
          0x30,
          0x2a,
          0x30,
          5,
          6,
          3,
          0x2b,
          0x65,
          0x70,
          3,
          0x21,
          0,
        );
      signature[0] = 1;
      let identitiesDenied = 0,
        groupsDenied = 0;
      for (const hex of [...vectors.smallOrder, ...vectors.noncanonical]) {
        const der = new Uint8Array(44);
        der.set(prefix);
        der.set(
          Uint8Array.from(hex.match(/../g)!, (s) => parseInt(s, 16)),
          12,
        );
        const card = {
          id: await r.hash(der),
          name: "Synthetic weak key",
          signKey: r.b64(der),
          boxKey: good.public.boxKey,
          proof: r.b64(signature),
        };
        if (!(await r.validateIdentity(card))) identitiesDenied++;
        try {
          r.groups.memberCardHash(card);
        } catch {
          groupsDenied++;
        }
      }
      return {
        identitiesDenied,
        groupsDenied,
        valid: await r.validateIdentity(good.public),
        hash: r.groups.memberCardHash(good.public),
        expected: await r.hash(r.canonical(good.public)),
      };
    }, keyVectors);
    expect(result.identitiesDenied).toBe(48);
    expect(result.groupsDenied).toBe(48);
    expect(result.valid).toBe(true);
    expect(result.hash).toBe(result.expected);
  } finally {
    await host.close();
  }
});

test("browser, Node and Go verify shared group certificates, fresh consents, removal and strict signing ownership", async ({
  page,
}) => {
  test.setTimeout(90_000);
  mkdirSync(".cache", { recursive: true });
  const dir = mkdtempSync(resolve(".cache/browser-group-")),
    host = await staticHarness();
  try {
    await page.goto(host.url);
    const nativeGroup = nodeGroups.createAnchoredGroup(
      createIdentity("Autor Node"),
      "Node \ud800 <rede> 😀",
    );
    const input = await page.evaluate(async (nativeGroup) => {
      const r = (window as any).rl,
        g = r.groups;
      g.verifyGroupAnchor(nativeGroup.anchor);
      g.verifyGroupSnapshot(
        nativeGroup.snapshot,
        nativeGroup.anchor,
        nativeGroup.epoch,
      );
      const a = await r.createIdentity("Criadora browser"),
        b = await r.createIdentity("Membro browser"),
        c = await r.createIdentity("Novo membro browser");
      const group = g.createAnchoredGroup(a, "Grupo browser"),
        invitation = g.createGroupInvitation(
          a,
          group.anchor,
          group.epoch,
          b.public,
        ),
        consent = g.acceptGroupInvitation(
          b,
          group.anchor,
          group.epoch,
          invitation,
        ),
        joined = g.createGroupSuccessor(
          a,
          group.anchor,
          group.epoch,
          group.snapshot,
          {
            title: "Com Bruno",
            members: [a.public, b.public],
            joins: [consent],
          },
        );
      const signed = async (who: any, body: any) => {
        const bytes = r.utf8(r.canonical(body)),
          key = await crypto.subtle.importKey(
            "pkcs8",
            r.un64(who.signSecret),
            "Ed25519",
            false,
            ["sign"],
          );
        return {
          body,
          id: await r.hash(bytes),
          signature: r.b64(await crypto.subtle.sign("Ed25519", key, bytes)),
        };
      };
      const value = {
        identities: [a, b, c],
        group,
        invitation,
        consent,
        joined,
        message: await r.createBundle(
          a,
          "message",
          {
            type: "message",
            text: "Browser original history",
            groupEpoch: joined.epoch.id,
          },
          joined.snapshot.members,
        ),
        badEpochs: [
          await signed(b, joined.epoch.body),
          await signed(a, { ...joined.epoch.body, previous: "0".repeat(64) }),
        ],
        unicodeGroup: g.createAnchoredGroup(a, "Browser \ud800 <rede> 😀"),
      };
      (window as any).groupFixture = value;
      return value;
    }, nativeGroup);
    nodeGroups.verifyGroupAnchor(input.group.anchor);
    nodeGroups.verifyGroupInvitation(
      input.invitation,
      input.group.anchor,
      input.group.epoch,
      input.identities[1].public,
    );
    nodeGroups.verifyGroupConsent(
      input.consent,
      input.group.anchor,
      input.group.epoch,
      input.identities[1].public,
    );
    expect(
      nodeGroups.verifyGroupTransition(
        input.group.anchor,
        input.group.epoch,
        input.group.snapshot,
        input.joined.epoch,
        input.joined.snapshot,
      ),
    ).toBe("nonrestrictive");
    const path = join(dir, "browser-input.json");
    writeFileSync(path, canonical(input), { mode: 0o600 });
    await goFixture(path);
    const fromGo = JSON.parse(
      readFileSync(join(dir, "go-output.json"), "utf8"),
    );
    expect(fromGo.result).toBe("pass");
    expect(fromGo.nodeGroupID).toBe(input.group.anchor.id);
    expect(fromGo.nodeNegativeEpochsRejected).toBe(2);
    expect(fromGo.originalReaderDecryption).toBe(true);
    expect(fromGo.newcomerHistoryDenied).toBe(true);
    const result = await page.evaluate(async (fromGo) => {
      const r = (window as any).rl,
        g = r.groups,
        input = (window as any).groupFixture,
        [a, b, c] = input.identities,
        { anchor } = input.group;
      const rejected: string[] = [];
      const deny = (name: string, action: () => void) => {
        try {
          action();
        } catch {
          rejected.push(name);
        }
      };
      g.verifyGroupAnchor(fromGo.goGroup.anchor);
      const unicode = g.verifyGroupSnapshot(
        fromGo.goGroup.snapshot,
        fromGo.goGroup.anchor,
        fromGo.goGroup.epoch,
      ).title;
      g.verifyGroupInvitation(
        fromGo.invitation,
        anchor,
        input.joined.epoch,
        c.public,
      );
      g.verifyGroupConsent(
        fromGo.consent,
        anchor,
        input.joined.epoch,
        c.public,
      );
      const added = g.verifyGroupTransition(
          anchor,
          input.joined.epoch,
          input.joined.snapshot,
          fromGo.added.epoch,
          fromGo.added.snapshot,
        ),
        removed = g.verifyGroupTransition(
          anchor,
          fromGo.added.epoch,
          fromGo.added.snapshot,
          fromGo.removed.epoch,
          fromGo.removed.snapshot,
        ),
        closed = g.verifyGroupEpochLink(
          anchor,
          fromGo.removed.epoch,
          fromGo.closed,
        );
      g.verifyGroupLeave(fromGo.leave, anchor, fromGo.added.epoch, c.public);
      const reentry = g.createGroupInvitation(
          a,
          anchor,
          fromGo.removed.epoch,
          b.public,
        ),
        fresh = g.acceptGroupInvitation(
          b,
          anchor,
          fromGo.removed.epoch,
          reentry,
        ),
        rejoined = g.createGroupSuccessor(
          a,
          anchor,
          fromGo.removed.epoch,
          fromGo.removed.snapshot,
          {
            title: "Reentrada com consentimento novo",
            members: [a.public, b.public, c.public],
            joins: [fresh],
          },
        );
      deny("wrong signing private key", () =>
        g.createGroupAnchor({ ...a, signSecret: b.signSecret }),
      );
      deny("box private key is not signing authority", () =>
        g.createGroupAnchor({ ...a, signSecret: a.boxSecret }),
      );
      deny("wrong creator", () =>
        g.verifyGroupEpoch(fromGo.wrongCreator, anchor),
      );
      deny("replayed old consent", () =>
        g.createGroupSuccessor(
          a,
          anchor,
          fromGo.removed.epoch,
          fromGo.removed.snapshot,
          {
            title: "Replay",
            members: [a.public, b.public, c.public],
            joins: [input.consent],
          },
        ),
      );
      deny("wrong invitation reader", () =>
        g.acceptGroupInvitation(c, anchor, fromGo.removed.epoch, reentry),
      );
      deny("changed signed body", () =>
        g.verifyGroupEpoch(
          {
            ...fromGo.removed.epoch,
            body: { ...fromGo.removed.epoch.body, number: 100 },
          },
          anchor,
        ),
      );
      deny("truncated signature", () =>
        g.verifyGroupEpoch(
          { ...fromGo.removed.epoch, signature: "AA==" },
          anchor,
        ),
      );
      deny("unknown field", () =>
        g.verifyGroupAnchor({ ...anchor, unauthorised: true }),
      );
      deny("oversized title", () =>
        g.createAnchoredGroup(a, "a".repeat(10000)),
      );
      deny("noncanonical DER", () =>
        g.createGroupAnchor({ ...a, signSecret: a.signSecret + "AAAA" }),
      );
      let historyDenied = false;
      try {
        await r.decryptBundle(fromGo.future, b);
      } catch {
        historyDenied = true;
      }
      const future = await r.decryptBundle(fromGo.future, c);
      return {
        unicode,
        added,
        removed,
        closed,
        rejoined,
        rejected,
        historyDenied,
        future: future.text,
      };
    }, fromGo);
    expect(result.unicode).toBe("Go \ud800 <rede> 😀");
    expect([result.added, result.removed, result.closed]).toEqual([
      "nonrestrictive",
      "restrictive",
      "restrictive",
    ]);
    expect(result.rejected).toHaveLength(10);
    expect(result.historyDenied).toBe(true);
    expect(result.future).toBe("Go after removal");
    expect(
      nodeGroups.verifyGroupTransition(
        input.group.anchor,
        fromGo.removed.epoch,
        fromGo.removed.snapshot,
        result.rejoined.epoch,
        result.rejoined.snapshot,
      ),
    ).toBe("nonrestrictive");
    mkdirSync(".cache/browser-groups", { recursive: true });
    writeFileSync(
      ".cache/browser-groups/certificates.json",
      JSON.stringify(
        {
          status: "PASSED",
          at: new Date().toISOString(),
          scope: `Actual ${page.context().browser()!.browserType().name()} sync group protocol, Node crypto and Go fixture; not dynamic group application/storage/UI`,
          engines: [
            `${page.context().browser()!.browserType().name()} portable identity + noble/curves 2.4.0 strict Ed25519`,
            "Node OpenSSL",
            "Go crypto/ed25519",
          ],
          controls: result.rejected,
          consentRemovalReentry: true,
          unicodePreserved: true,
          removedReaderDenied: result.historyDenied,
          privateKeysInEvidence: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
