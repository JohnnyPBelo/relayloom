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
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { canonical, hash } from "../../packages/core/src/index.js";
import { GroupLedger } from "../../packages/groups/src/ledger.js";
import {
  fixture,
  enroll,
  sync,
  message,
  candidate,
  type Actor,
} from "../fixtures/group-access.js";
import { launchOwned } from "./process-helper.js";

test(
  "Node and Go share durable admission, quarantine and stops across real commit-boundary process exits",
  { timeout: 180000 },
  async (t) => {
    const f = fixture(t),
      a = f.actor("Alice"),
      b = f.actor("Bruno");
    const root = resolve(".cache/group-ledger-interop");
    mkdirSync(root, { recursive: true });
    const dir = mkdtempSync(join(root, "case-")),
      binary = join(
        dir,
        process.platform === "win32" ? "worker.exe" : "worker",
      );
    const children: ReturnType<typeof launchOwned>[] = [];
    t.after(async () => {
      for (const child of children) {
        await child.stop();
        await child.done;
      }
      rmSync(dir, { recursive: true, force: true });
    });
    const files = [
      "tests/native/group-ledger.test.ts",
      "tests/fixtures/group-ledger-worker.ts",
      "tests/fixtures/group-access.ts",
      "native/go.mod",
      "native/go.sum",
      ...[
        "native/groupledger",
        "native/groupaccess",
        "native/groupauthority",
        "native/groupstore",
        "native/sqlitedriver",
        "native/groups",
        "native/core",
        "packages/groups/src",
        "packages/core/src",
      ].flatMap((base) =>
        readdirSync(base)
          .filter((p) => /\.(go|ts)$/.test(p))
          .map((p) => base + "/" + p),
      ),
    ].sort();
    const digest = () =>
        hash(files.map((p) => p + "\0" + hash(readFileSync(p))).join("\n")),
      before = digest();
    const start = (...args: Parameters<typeof launchOwned>) => {
      const child = launchOwned(...args);
      children.push(child);
      return child;
    };
    const complete = async (
      child: ReturnType<typeof launchOwned>,
      code = 0,
    ) => {
      const result = await child.done;
      assert.equal(result.timedOut, false, result.output);
      assert.equal(result.code, code, result.output);
    };
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
          "./groupledger",
        ],
        { timeout: 90000 },
      ),
    );
    const run = <T>(
      actor: Actor,
      callback: Parameters<typeof GroupLedger.run<T>>[2],
    ) =>
      actor.store.transaction((tx) =>
        GroupLedger.run(tx, actor.identity, callback),
      ).value;
    const invoke = async (
      actor: Actor,
      runtime: "node" | "go",
      requests: any[],
      crash = "",
      expected = 0,
    ) => {
      const path = join(dir, randomUUID() + ".json"),
        output = path + ".out",
        marker = path + ".marker";
      writeFileSync(
        path,
        JSON.stringify({
          Path: actor.path,
          StoreID: actor.storeId,
          Identity: actor.identity,
          Output: output,
          Marker: marker,
          Crash: crash,
          Requests: requests,
        }),
        { mode: 0o600 },
      );
      const child =
        runtime === "go"
          ? start(
              binary,
              ["-test.run=^TestGroupLedgerProcessFixture$", "-test.v"],
              { env: { ...process.env, RELAYLOOM_LEDGER_FIXTURE: path } },
            )
          : start(process.execPath, [
              "--import",
              "tsx",
              "tests/fixtures/group-ledger-worker.ts",
              path,
            ]);
      await complete(child, expected);
      if (crash) {
        assert.equal(existsSync(output), false);
        assert.equal(
          readFileSync(marker, "utf8"),
          crash === "before"
            ? "staged-before-commit"
            : "committed-before-response",
        );
        return null;
      }
      return JSON.parse(readFileSync(output, "utf8"));
    };
    const id = a.registry.create(randomUUID(), "Ledger interop").groupId;
    enroll(a, b, id);
    const old = message(a, id),
      later = message(a, id),
      unseen = message(a, id),
      epoch = a.registry.state(id).head!.id;
    run(b, (l) =>
      l.consider(
        candidate(old, b.identity),
        old.manifest.expires,
        Buffer.byteLength(canonical(old)),
        new Set(),
      ),
    );
    assert.deepEqual(
      await invoke(b, "go", [
        { Kind: "accepted", ID: old.manifest.id },
        { Kind: "losses" },
      ]),
      [run(b, (l) => l.accepted(old.manifest.id)), run(b, (l) => l.losses())],
    );
    const result = await invoke(b, "go", [{ Kind: "consider", Bundle: later }]);
    assert.equal(result[0].decision.status, "accepted");
    assert.deepEqual(
      run(b, (l) => l.accepted(later.manifest.id))!.context,
      result[0].decision.context,
    );
    a.registry.commit(randomUUID(), id, epoch, {
      title: "Removed",
      members: [a.identity.public],
      joins: [],
    });
    sync(a, b, id);
    const held = await invoke(b, "go", [
      { Kind: "consider", Bundle: unseen },
      { Kind: "held" },
    ]);
    assert.equal(held[0].decision.status, "quarantine");
    assert.equal(held[0].held, true);
    assert.deepEqual(
      run(b, (l) => l.held()),
      held[1],
    );
    b.store.transaction((tx) => {
      const key = "group-held:" + unseen.manifest.id,
        value = JSON.parse(tx.get(key)!.toString());
      value.reason = "\ud800".repeat(10) + "á".repeat(40) + "🌊".repeat(25); // exactly100 UTF-16 code units
      tx.put(key, Buffer.from(canonical(value)));
    });
    assert.deepEqual(await invoke(b, "go", [{ Kind: "held" }]), [
      run(b, (l) => l.held()),
    ]);
    const entry = {
      operationId: randomUUID(),
      id: old.manifest.id,
      groupId: id,
      epochId: epoch,
    };
    const stopped = run(b, (l) => l.reconcileRetry(entry, true));
    assert.deepEqual(await invoke(b, "go", [{ Kind: "stop", Entry: entry }]), [
      stopped.stop,
    ]);
    await invoke(b, "go", [{ Kind: "retire", Retained: [] }]);
    assert.equal(
      run(b, (l) => l.stop(entry.operationId)),
      null,
    );
    assert.equal(run(b, (l) => l.losses()).stopRetired, 1);
    assert.deepEqual(await invoke(b, "go", [{ Kind: "losses" }]), [
      run(b, (l) => l.losses()),
    ]);
    for (const runtime of ["node", "go"] as const) {
      const x = f.actor("Crash-" + runtime),
        y = f.actor("Peer-" + runtime),
        group = x.registry.create(randomUUID(), "Crash group").groupId;
      enroll(x, y, group);
      const bundle = message(x, group),
        head = x.registry.state(group).head!.id,
        op = randomUUID(),
        intent = {
          operationId: randomUUID(),
          id: bundle.manifest.id,
          groupId: group,
          epochId: head,
        };
      const requests = [
        { Kind: "consider", Bundle: bundle },
        { Kind: "close", GroupID: group, EpochID: head, OperationID: op },
        { Kind: "retry", Entry: intent, Unfinished: true },
      ];
      const reader = runtime === "node" ? "go" : "node";
      await invoke(x, runtime, requests, "before", 73);
      assert.deepEqual(
        await invoke(x, reader, [
          { Kind: "accepted", ID: bundle.manifest.id },
          { Kind: "stop", Entry: intent },
        ]),
        [null, null],
      );
      assert.equal(x.registry.state(group).status, "active");
      await invoke(x, runtime, requests, "after", 74);
      const committed = await invoke(x, reader, [
        { Kind: "accepted", ID: bundle.manifest.id },
        { Kind: "stop", Entry: intent },
      ]);
      assert.equal(committed[0].context.id, bundle.manifest.id);
      assert.equal(committed[1].id, bundle.manifest.id);
      assert.equal(committed[1].reason, "group-closed");
      assert.equal(x.registry.state(group).status, "closed");
      const repeated = await invoke(x, runtime, [
        { Kind: "consider", Bundle: bundle },
        { Kind: "retry", Entry: intent, Unfinished: false },
      ]);
      assert.equal(repeated[0].decision.status, "accepted");
      assert.deepEqual(repeated[1].stop, committed[1]);
      assert.deepEqual(
        run(x, (l) => l.accepted(bundle.manifest.id)),
        committed[0],
      );
    }
    assert.equal(digest(), before);
    writeFileSync(
      join(root, "report.json"),
      JSON.stringify(
        {
          status: "PASSED",
          sourceSHA256: before,
          workerSHA256: hash(readFileSync(binary)),
          checks: [
            "Go reads Node admission and Node reads Go admission",
            "Go persists quarantine readable in Node",
            "Node retry stop and Go retirement preserve matching loss counters",
            "both runtimes exit before commit without partial authority/admission/stop",
            "both runtimes lose response after commit and recover all three together",
            "retained replay preserves exact historical context and terminal stop",
          ],
          limits: [
            "actual host processes and signed/encrypted state; no application API or network integration claimed",
          ],
        },
        null,
        2,
      ),
    );
  },
);
