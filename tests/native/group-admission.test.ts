import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hash } from "../../packages/core/src/index.js";
import { groupAdmissionJourney } from "../fixtures/group-admission.js";

function sourceDigest() {
  const paths = [
    "package-lock.json",
    "native/go.mod",
    "native/go.sum",
    "tests/fixtures/group-admission.ts",
    "tests/native/group-admission.test.ts",
  ];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
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
    "native/profiledb",
    "native/profilestate",
    "native/profilebinding",
    "native/profilelock",
    "native/sqlitedriver",
    "native/transport",
    "native/cmd/relayloom",
  ])
    visit(dir);
  return hash(
    paths
      .sort()
      .map((p) => p + "\0" + hash(readFileSync(p)))
      .join("\n"),
  );
}

for (const [creator, member, restart] of [
  ["node", "native", "node"],
  ["native", "node", "native"],
  ["native", "native", "native"],
] as const) {
  test(
    `actual ${creator}/${member} group admission preserves quarantine and history through ${restart} restart`,
    { timeout: 45000 },
    async () => {
      const before = sourceDigest(),
        started = Date.now();
      await groupAdmissionJourney(creator, member, restart);
      assert.equal(sourceDigest(), before);
      const dir = ".cache/group-admission-interop";
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `${creator}-${member}.json`),
        JSON.stringify(
          {
            result: "pass",
            sourceDigest: before,
            elapsedMs: Date.now() - started,
            creator,
            member,
            restart,
            tested: [
              "actual authenticated HTTP APIs",
              "actual TCP encrypted bundle injection",
              "snapshot required before acceptance",
              "physical quarantine reserve",
              "previously accepted history after closure",
              "unknown old ciphertext quarantined",
              "state shared across real engine restart",
              "minimal historical receipt vs forbidden text extension",
              "valid DM vs falsy group-tag bypass",
            ],
            limits: [
              "fixture signs the test bundles; dynamic outbound API/outbox is unfinished",
              "control certificates are transferred by the fixture; automatic carrier synchronization is unfinished",
              "no mobile/hardware evidence",
            ],
          },
          null,
          2,
        ) + "\n",
      );
    },
  );
}
