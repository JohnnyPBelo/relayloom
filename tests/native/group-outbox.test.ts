import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  groupOutboxFixture,
  addFixtureGroupIntents,
  createFixtureSuccessorGroup,
} from "../fixtures/group-outbox.js";
import { launch, password, type Client } from "../helpers.js";
import { launchOwned } from "./process-helper.js";
import { hash } from "../../packages/core/src/index.js";
import { admitOutbox } from "../../apps/node/src/outbox.js";

function sourceDigest() {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(ts|go|mjs)$/.test(path)) files.push(path);
    }
  };
  for (const dir of ["apps/node/src", "packages", "native", "tests/fixtures"])
    visit(dir);
  files.push(
    "tests/native/group-outbox.test.ts",
    "package-lock.json",
    "native/go.mod",
    "native/go.sum",
  );
  return hash(
    files
      .sort()
      .map((f) => f + "\0" + hash(readFileSync(f)))
      .join("\n"),
  );
}

test(
  "real Node/Go application deaths preserve an outbox stop at the same commit as group closure",
  { timeout: 120000 },
  async (t) => {
    mkdirSync(".cache/group-outbox-process", { recursive: true });
    const work = mkdtempSync(resolve(".cache/group-outbox-process/case-"));
    t.after(() => rmSync(work, { recursive: true, force: true }));
    const binary = join(
      work,
      process.platform === "win32" ? "worker.exe" : "worker",
    );
    const sources = sourceDigest(),
      started = Date.now();
    const children: ReturnType<typeof launchOwned>[] = [];
    const run = async (
      command: string,
      args: string[],
      expected: number,
      env = process.env,
    ) => {
      const child = launchOwned(command, args, { env, timeout: 45000 });
      children.push(child);
      const result = await child.done;
      assert.equal(result.timedOut, false, result.output);
      assert.equal(result.code, expected, result.output);
    };
    const cases: any[] = [];
    let client: Client | undefined;
    try {
      await run(
        process.execPath,
        ["scripts/go.mjs", "test", "-c", "-o", binary, "./app"],
        0,
      );
      for (const runtime of ["node", "go"] as const)
        for (const mode of ["before", "after"] as const) {
          const f = groupOutboxFixture(t),
            directory = f.node.dir;
          await f.node.stop();
          const requestPath = join(work, runtime + "-" + mode + ".json"),
            marker = requestPath + ".marker";
          writeFileSync(
            requestPath,
            JSON.stringify({
              directory,
              mode,
              marker,
              operationId: randomUUID(),
              groupId: f.group.id,
              epochId: f.group.head.id,
            }),
            { mode: 0o600 },
          );
          if (runtime === "node")
            await run(
              process.execPath,
              [
                "--import",
                "tsx",
                "tests/fixtures/group-outbox-worker.ts",
                requestPath,
              ],
              mode === "before" ? 81 : 82,
            );
          else
            await run(
              binary,
              ["-test.run=^TestGroupOutboxProcessExitFixture$", "-test.v"],
              mode === "before" ? 81 : 82,
              {
                ...process.env,
                RELAYLOOM_GROUP_OUTBOX_FIXTURE: requestPath,
                RELAYLOOM_GROUP_OUTBOX_ROOT: process.cwd(),
              },
            );
          assert.equal(readFileSync(marker, "utf8"), mode);
          const reader = runtime === "node" ? "native" : "node";
          client = await launch(directory, 0, 0, reader);
          await client.call("unlock", { password });
          const state = await client.call("state"),
            item = state.outbox.find(
              (e: any) => e.operationId === f.entry.operationId,
            );
          assert.equal(item.id, f.entry.id);
          assert.equal(item.groupEpoch, f.entry.groupEpoch);
          assert.deepEqual(
            item.recipients.map((c: any) => c.id),
            [f.reader.public.id],
          );
          assert.equal(
            item.status,
            mode === "after" ? "superseded" : "pending",
          );
          assert.equal(state.storage.reserved, mode === "after" ? 0 : 1);
          assert.equal(
            (
              await client.call("group-command", {
                action: "state",
                groupId: f.group.id,
              })
            ).group.status,
            mode === "after" ? "closed" : "active",
          );
          if (mode === "after") {
            assert.equal(item.groupAuthority.stop.reason, "group-closed");
            assert.equal(
              (
                await client.call("outbox-retry", {
                  operationId: f.entry.operationId,
                })
              ).outbox.attempts,
              0,
            );
            // A legitimate later private write serializes the normalized mirror
            // using the other engine, then the original engine reopens it too.
            await client.call("site-draft", { blocks: [], theme: "sand" });
          }
          await client.stop();
          client = undefined;
          const returning = runtime === "go" ? "native" : "node";
          client = await launch(directory, 0, 0, returning);
          await client.call("unlock", { password });
          assert.equal(
            (await client.call("state")).outbox[0].status,
            item.status,
          );
          await client.stop();
          client = undefined;
          cases.push({
            runtime,
            mode,
            recoveredBy: reader,
            returnedTo: returning,
            exit: mode === "before" ? 81 : 82,
            status: item.status,
          });
        }
      assert.equal(
        sourceDigest(),
        sources,
        "source changed during cross-runtime gate",
      );
      writeFileSync(
        ".cache/group-outbox-process/report.json",
        JSON.stringify(
          {
            status: "pass",
            sourceDigest: sources,
            workerSha256: hash(readFileSync(binary)),
            nativeBinarySha256: hash(
              readFileSync(
                join(
                  ".cache/native-app",
                  process.platform === "win32" ? "relayloom.exe" : "relayloom",
                ),
              ),
            ),
            elapsedMs: Date.now() - started,
            cases,
            limits: [
              "fixture installs the signed/admitted message and initial intent; dynamic sending still disabled",
              "application death and authenticated recovery are real",
              "no hardware or mobile evidence",
            ],
          },
          null,
          2,
        ) + "\n",
      );
    } finally {
      if (client) await client.stop();
      for (const child of children) await child.stop();
    }
  },
);

test(
  "128 real stopped intents and 128 pending reserved payloads reopen across Node and Go without reopening old retries",
  { timeout: 120000 },
  async (t) => {
    const sources = sourceDigest(),
      f = groupOutboxFixture(t),
      started = Date.now();
    const phases: { phase: string; elapsedMs: number }[] = [];
    let last = Date.now();
    const mark = (phase: string) => {
      const now = Date.now();
      phases.push({ phase, elapsedMs: now - last });
      last = now;
      console.log(JSON.stringify(phases.at(-1)));
    };
    addFixtureGroupIntents(f, f.group.id, f.group.head.id, 127);
    mark("node-install-first-128");
    assert.equal(f.node.state().storage.reserved, 128);
    mark("node-observe-first-128");
    f.close();
    mark("node-stop-first-128");
    assert.equal(
      f.node.state().outbox.filter((e) => e.status === "superseded").length,
      128,
    );
    mark("node-observe-stops");
    const group = createFixtureSuccessorGroup(f);
    mark("node-create-next-group");
    addFixtureGroupIntents(f, group.id, group.head.id, 128);
    mark("node-install-next-128");
    const state = f.node.state();
    mark("node-observe-256");
    assert.equal(state.outbox.length, 256);
    assert.equal(
      state.outbox.filter((e) => e.status === "pending").length,
      128,
    );
    assert.equal(state.storage.reserved, 128);
    assert.throws(
      () =>
        admitOutbox(
          f.internals.privateState.outbox,
          { ...f.entry, operationId: randomUUID() },
          Date.now(),
        ),
      /cheia/,
    );
    await f.node.stop();
    let client: Client | undefined;
    try {
      client = await launch(f.node.dir, 0, 0, "native");
      await client.call("unlock", { password });
      mark("go-open-256");
      const native = await client.call("state");
      mark("go-observe-256");
      assert.equal(
        native.outbox.filter((e: any) => e.status === "pending").length,
        128,
      );
      assert.equal(
        native.outbox.filter((e: any) => e.status === "superseded").length,
        128,
      );
      assert.equal(native.storage.reserved, 128);
      await client.call("group-command", {
        action: "close",
        operationId: randomUUID(),
        groupId: group.id,
        expected: group.head.id,
      });
      mark("go-stop-next-128");
      const stopped = await client.call("state");
      mark("go-observe-256-stops");
      assert.equal(
        stopped.outbox.filter((e: any) => e.status === "superseded").length,
        256,
      );
      assert.equal(stopped.storage.reserved, 0);
      await client.call("site-draft", { blocks: [], theme: "sand" });
      await client.stop();
      client = undefined;
      client = await launch(f.node.dir, 0, 0, "node");
      await client.call("unlock", { password });
      assert.equal(
        (await client.call("state")).outbox.filter(
          (e: any) => e.status === "superseded",
        ).length,
        256,
      );
      await client.stop();
      client = undefined;
    } finally {
      if (client) await client.stop();
    }
    assert.equal(sourceDigest(), sources);
    mkdirSync(".cache/group-outbox-process", { recursive: true });
    writeFileSync(
      ".cache/group-outbox-process/bounds.json",
      JSON.stringify(
        {
          status: "pass",
          sourceDigest: sources,
          elapsedMs: Date.now() - started,
          phases,
          actualBundles: 256,
          stoppedThenPending: [128, 128],
          finalStopped: 256,
          engines: ["node", "native", "node"],
          limit:
            "fixture installs initial intents; this is not dynamic send API coverage",
        },
        null,
        2,
      ) + "\n",
    );
  },
);
