import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { groupMembershipJourney } from "../fixtures/group-runtime.js";

function sourceDigest() {
  const paths = [
    "package-lock.json",
    "native/go.mod",
    "native/go.sum",
    "tests/fixtures/group-runtime.ts",
    "tests/native/group-runtime.test.ts",
  ];
  const collect = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) collect(path);
      else if (/\.(ts|go)$/.test(path) && !path.endsWith("_test.go"))
        paths.push(path);
    }
  };
  for (const dir of [
    "apps/node/src",
    "packages",
    "native/app",
    "native/core",
    "native/groups",
    "native/groupauthority",
    "native/groupaccess",
    "native/groupledger",
    "native/groupstore",
    "native/profilebinding",
    "native/profiledb",
    "native/profilelock",
    "native/profilestate",
    "native/sqlitedriver",
    "native/transport",
    "native/cmd/relayloom",
  ])
    collect(dir);
  const digest = createHash("sha256");
  for (const path of paths.sort())
    digest.update(path).update("\0").update(readFileSync(path));
  return digest.digest("hex");
}

for (const [creator, member] of [
  ["node", "native"],
  ["native", "node"],
] as const) {
  test(
    `actual ${creator} creator and ${member} member APIs preserve authority across engine takeover`,
    { timeout: 45000 },
    async () => {
      const before = sourceDigest(),
        started = Date.now();
      const binary = join(
        ".cache/native-app",
        process.platform === "win32" ? "relayloom.exe" : "relayloom",
      );
      const binaryHash = createHash("sha256")
        .update(readFileSync(binary))
        .digest("hex");
      await groupMembershipJourney(creator, member, creator);
      assert.equal(
        sourceDigest(),
        before,
        "production sources changed during API gate",
      );
      const directory = ".cache/group-runtime-interop";
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, `${creator}-to-${member}.json`),
        JSON.stringify(
          {
            result: "pass",
            sourceDigest: before,
            binarySha256: binaryHash,
            creator,
            member,
            restart: creator,
            elapsedMs: Date.now() - started,
            verified: [
              "authenticated HTTP processes",
              "explicit enrollment",
              "signed invitation and consent",
              "creator-only membership",
              "changed-operation refusal",
              "committed-operation replay",
              "snapshot tamper and unknown fields",
              "invalid first header blocks suffix",
              "valid restrictive prefix survives invalid tail",
              "encrypted SQLite",
              "real process restart into opposite engine",
            ],
            notTested: [
              "automatic P2P control carriers",
              "dynamic message delivery",
              "mobile runtime",
              "radio hardware",
            ],
          },
          null,
          2,
        ) + "\n",
      );
    },
  );
}
