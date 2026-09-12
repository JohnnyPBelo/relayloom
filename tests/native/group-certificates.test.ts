import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  createHash,
} from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
  canonical,
  hash,
  createIdentity,
  createBundle,
  decryptBundle,
  type Identity,
} from "../../packages/core/src/index.js";
import {
  createAnchoredGroup,
  createGroupInvitation,
  acceptGroupInvitation,
  createGroupSuccessor,
  verifyGroupAnchor,
  verifyGroupEpoch,
  verifyGroupInvitation,
  verifyGroupConsent,
  verifyGroupLeave,
  verifyGroupSnapshot,
  verifyGroupTransition,
  verifyGroupEpochLink,
} from "../../packages/groups/src/certificates.js";

test(
  "Node and Go verify each other's signed group epochs, consent, reader scope and exact Unicode bytes",
  { timeout: 90000 },
  async () => {
    mkdirSync(".cache", { recursive: true });
    const directory = mkdtempSync(resolve(".cache/group-vectors-")),
      inputPath = join(directory, "node-input.json");
    const sourceHash = () => {
      const files = [
        "packages/groups/src/certificates.ts",
        "packages/core/src/index.ts",
        "native/core/crypto.go",
        "native/core/canonical.go",
        "tests/native/group-certificates.test.ts",
        ...readdirSync("native/groups")
          .filter((p) => p.endsWith(".go"))
          .map((p) => "native/groups/" + p),
      ];
      const sum = createHash("sha256");
      for (const file of files.sort())
        sum.update(file).update("\0").update(readFileSync(file));
      return sum.digest("hex");
    };
    const before = sourceHash(),
      started = new Date().toISOString();
    try {
      const a = createIdentity("Alice vetorial"),
        b = createIdentity("Bruno vetorial"),
        c = createIdentity("Clara vetorial");
      const group = createAnchoredGroup(a, "Grupo Node"),
        invitation = createGroupInvitation(
          a,
          group.anchor,
          group.epoch,
          b.public,
        ),
        consent = acceptGroupInvitation(
          b,
          group.anchor,
          group.epoch,
          invitation,
        );
      const joined = createGroupSuccessor(
        a,
        group.anchor,
        group.epoch,
        group.snapshot,
        { title: "Com Bruno", members: [a.public, b.public], joins: [consent] },
      );
      const signed = (identity: Identity, body: unknown) => {
        const bytes = canonical(body);
        return {
          body,
          id: hash(bytes),
          signature: sign(
            null,
            Buffer.from(bytes),
            createPrivateKey({
              key: Buffer.from(identity.signSecret, "base64"),
              format: "der",
              type: "pkcs8",
            }),
          ).toString("base64"),
        };
      };
      const input = {
        identities: [a, b, c],
        group,
        joined,
        invitation,
        consent,
        message: createBundle(
          a,
          "message",
          { text: "Node original history", groupEpoch: joined.epoch.id },
          joined.snapshot.members,
        ),
        badEpochs: [
          signed(b, joined.epoch.body),
          signed(a, { ...joined.epoch.body, previous: "0".repeat(64) }),
        ],
        unicodeGroup: createAnchoredGroup(a, "Node \ud800 <rede> 😀"),
      };
      writeFileSync(inputPath, canonical(input), { mode: 0o600 });
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
      child.stdout.on("data", (data) => {
        output = (output + data).slice(-65536);
      });
      child.stderr.on("data", (data) => {
        output = (output + data).slice(-65536);
      });
      const code = await new Promise<number | null>((done, fail) => {
        let timedOut = false;
        let escalation: ReturnType<typeof setTimeout> | undefined;
        const stop = (signal: NodeJS.Signals) => {
          if (!child.pid) return;
          if (process.platform === "win32") {
            spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
              stdio: "ignore",
              timeout: 5000,
            });
          } else {
            try {
              process.kill(-child.pid, signal);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ESRCH")
                throw error;
            }
          }
        };
        const timer = setTimeout(() => {
          timedOut = true;
          stop("SIGTERM");
          escalation = setTimeout(() => stop("SIGKILL"), 3000);
        }, 60000);
        child.once("error", (error) => {
          clearTimeout(timer);
          clearTimeout(escalation);
          fail(error);
        });
        // Wait for owned descendants/stdio too, before deleting private fixtures.
        child.once("close", (status) => {
          clearTimeout(timer);
          clearTimeout(escalation);
          if (timedOut)
            fail(new Error("Go group vector fixture exceeded 60 seconds"));
          else done(status);
        });
      });
      assert.equal(code, 0, output);
      const got = JSON.parse(
        readFileSync(join(directory, "go-output.json"), "utf8"),
      );
      assert.equal(got.result, "pass");
      assert.equal(got.nodeGroupID, group.anchor.id);
      assert.equal(
        got.nodeUnicodeSnapshotHash,
        input.unicodeGroup.epoch.body.snapshotHash,
      );
      assert.equal(got.nodeNegativeEpochsRejected, 2);
      assert.equal(got.originalReaderDecryption, true);
      assert.equal(got.newcomerHistoryDenied, true);
      verifyGroupAnchor(got.goGroup.anchor);
      verifyGroupEpoch(got.goGroup.epoch, got.goGroup.anchor);
      assert.equal(
        verifyGroupSnapshot(
          got.goGroup.snapshot,
          got.goGroup.anchor,
          got.goGroup.epoch,
        ).title,
        "Go \ud800 <rede> 😀",
      );
      verifyGroupInvitation(
        got.invitation,
        group.anchor,
        joined.epoch,
        c.public,
      );
      verifyGroupConsent(got.consent, group.anchor, joined.epoch, c.public);
      assert.equal(
        verifyGroupTransition(
          group.anchor,
          joined.epoch,
          joined.snapshot,
          got.added.epoch,
          got.added.snapshot,
        ),
        "nonrestrictive",
      );
      assert.equal(
        verifyGroupTransition(
          group.anchor,
          got.added.epoch,
          got.added.snapshot,
          got.removed.epoch,
          got.removed.snapshot,
        ),
        "restrictive",
      );
      verifyGroupLeave(got.leave, group.anchor, got.added.epoch, c.public);
      assert.throws(() =>
        verifyGroupLeave(got.leave, group.anchor, got.removed.epoch, c.public),
      );
      assert.equal(
        verifyGroupEpochLink(group.anchor, got.removed.epoch, got.closed),
        "restrictive",
      );
      verifyGroupSnapshot(got.removed.snapshot, group.anchor, got.closed);
      assert.equal(got.wrongCreator.id, hash(canonical(got.wrongCreator.body)));
      assert.equal(
        verify(
          null,
          Buffer.from(canonical(got.wrongCreator.body)),
          createPublicKey({
            key: Buffer.from(b.public.signKey, "base64"),
            format: "der",
            type: "spki",
          }),
          Buffer.from(got.wrongCreator.signature, "base64"),
        ),
        true,
        "unauthorized-creator control is a real valid signature by B",
      );
      assert.throws(() => verifyGroupEpoch(got.wrongCreator, group.anchor));
      assert.equal(
        (decryptBundle(got.future, c) as any).text,
        "Go after removal",
      );
      assert.throws(() => decryptBundle(got.future, b));
      assert.equal(
        sourceHash(),
        before,
        "certificate sources changed during vector execution",
      );
      mkdirSync("docs/evidence/group-certificates", { recursive: true });
      writeFileSync(
        "docs/evidence/group-certificates/interoperability.json",
        JSON.stringify(
          {
            result: "pass",
            started,
            finished: new Date().toISOString(),
            sourceSha256: before,
            actualRuntimes: ["Node", "Go"],
            nodeAndGoSignaturesVerified: true,
            exactUnicodeSurrogatesPreserved: true,
            creatorAuthorityAndPinnedReadersChecked: true,
            invalidSignedInputsRejectedBothWays: true,
            ciphertextReaderPositiveAndNegativeControls: true,
            privateKeysInEvidence: false,
            groupNetworkOrUIImplemented: false,
          },
          null,
          2,
        ),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
