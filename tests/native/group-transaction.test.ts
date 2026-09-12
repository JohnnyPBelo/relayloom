import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  canonical,
  createIdentity,
  hash,
} from "../../packages/core/src/index.js";
import { ProfileDatabase } from "../../packages/profile/src/database.js";
import { ProfileOwnership } from "../../packages/profile/src/ownership.js";
import { launchOwned } from "./process-helper.js";

test(
  "real Node/Go process exits preserve group authority and the private document at one commit boundary",
  { timeout: 120000 },
  async () => {
    const root = resolve(".cache/group-profile-process");
    mkdirSync(root, { recursive: true });
    const dir = mkdtempSync(join(root, "case-")),
      directory = join(dir, "profile"),
      binary = join(
        dir,
        process.platform === "win32" ? "worker.exe" : "worker",
      ),
      identity = createIdentity("Synthetic atomic group profile"),
      original = Buffer.from(canonical({ mutations: {} }));
    mkdirSync(directory);
    const files = [
      "tests/native/group-transaction.test.ts",
      "tests/fixtures/group-transaction-worker.ts",
      "tests/native/process-helper.ts",
      "scripts/ios-simulator.mjs",
      "scripts/go.mjs",
      "native/go.mod",
      "native/go.sum",
      ...[
        "packages/core/src",
        "packages/profile/src",
        "packages/groups/src",
        "native/core",
        "native/groupauthority",
        "native/groups",
        "native/groupstore",
        "native/sqlitedriver",
        "native/profiledb",
        "native/profilebinding",
        "native/profilestate",
        "native/profilelock",
      ].flatMap((base) =>
        readdirSync(base)
          .filter((name) => /\.(ts|go)$/.test(name))
          .map((name) => base + "/" + name),
      ),
    ].sort();
    const fingerprint = () =>
      hash(
        files.map((file) => file + "\0" + hash(readFileSync(file))).join("\n"),
      );
    const before = fingerprint(),
      children: ReturnType<typeof launchOwned>[] = [];
    const start = (...args: Parameters<typeof launchOwned>) => {
      const child = launchOwned(...args);
      children.push(child);
      return child;
    };
    const complete = async (
      child: ReturnType<typeof launchOwned>,
      expected = 0,
    ) => {
      const result = await child.done;
      assert.equal(result.timedOut, false, result.output);
      assert.equal(result.code, expected, result.output);
    };
    const lease = new ProfileOwnership(directory);
    try {
      ProfileDatabase.open(directory, identity, () => ({
        bytes: original,
        sourceDigest: hash("synthetic initial source"),
      })).close();
    } finally {
      lease.close();
    }
    const invoke = async (
      runtime: "node" | "go",
      mode: string,
      operationId: string,
      next?: Buffer,
      expected?: string,
    ) => {
      const path = join(dir, randomUUID() + ".json"),
        output = path + ".out",
        marker = path + ".marker";
      writeFileSync(
        path,
        JSON.stringify({
          directory,
          identity,
          mode,
          operationId,
          title: "Transaction " + runtime,
          next: next?.toString("base64"),
          expected,
          output,
          marker,
        }),
        { mode: 0o600 },
      );
      const child =
        runtime === "go"
          ? start(
              binary,
              ["-test.run=^TestGroupProfileTransactionFixture$", "-test.v"],
              { env: { ...process.env, RELAYLOOM_GROUP_SCOPE_FIXTURE: path } },
            )
          : start(process.execPath, [
              "--import",
              "tsx",
              "tests/fixtures/group-transaction-worker.ts",
              path,
            ]);
      await complete(child, mode === "before" ? 73 : mode === "after" ? 74 : 0);
      if (mode === "before" || mode === "after") {
        assert.equal(
          readFileSync(marker, "utf8"),
          mode === "before"
            ? "group-and-private-staged"
            : "group-and-private-committed",
        );
        assert.equal(
          existsSync(output),
          false,
          "exited before returning a successful result",
        );
        return null;
      }
      return JSON.parse(readFileSync(output, "utf8"));
    };
    try {
      await complete(
        start(
          process.execPath,
          [
            "scripts/go.mjs",
            "test",
            "-c",
            "-race",
            "-p=1",
            "-o",
            binary,
            "./groupauthority",
          ],
          { timeout: 90000 },
        ),
      );
      let current = original,
        groups = 0;
      for (const runtime of ["node", "go"] as const) {
        const reader = runtime === "node" ? "go" : "node",
          operation = randomUUID(),
          next = Buffer.from(
            canonical({
              mutations: {},
              siteDraft: {
                blocks: [],
                theme: runtime === "node" ? "forest" : "ink",
                savedAt: groups + 1,
              },
            }),
          );
        await invoke(runtime, "before", operation, next, hash(current));
        const rolledBack = await invoke(reader, "read", operation);
        assert.equal(rolledBack.bytes, current.toString("base64"));
        assert.equal(rolledBack.operation, null);
        assert.equal(rolledBack.groups.length, groups);
        await invoke(runtime, "after", operation, next, hash(current));
        const committed = await invoke(reader, "read", operation);
        assert.equal(committed.bytes, next.toString("base64"));
        assert.equal(committed.digest, hash(next));
        assert.equal(committed.groups.length, ++groups);
        assert.equal(
          committed.groups.find(
            (g: any) => g.id === committed.operation.groupId,
          ).status,
          "active",
        );
        // The same writer retries using authenticated current state after a lost response.
        const retried = await invoke(
          runtime,
          "write",
          operation,
          next,
          committed.digest,
        );
        assert.deepEqual(retried.operation, committed.operation);
        assert.equal(retried.groups.length, groups);
        current = next;
      }
      assert.equal(fingerprint(), before, "scope inputs stayed unchanged");
      writeFileSync(
        join(root, "report.json"),
        JSON.stringify(
          {
            status: "PASSED",
            sourceSHA256: before,
            binarySHA256: hash(readFileSync(binary)),
            checks: [
              "Node pre-commit process exit rolls back authority and private state, observed by Go",
              "Node post-commit lost response preserves both, observed by Go",
              "Go pre/post-commit process exits recover both fields in Node",
              "idempotent operation retry creates no duplicate group",
            ],
            limitations: [
              "actual host processes, not physical power loss",
              "transaction library/factory integration; dynamic-group API, transport admission and UI are still pending",
            ],
          },
          null,
          2,
        ),
      );
    } finally {
      for (const child of children) {
        await child.stop();
        await child.done;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
