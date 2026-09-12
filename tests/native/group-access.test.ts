import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  canonical,
  createBundle,
  hash,
} from "../../packages/core/src/index.js";
import { GroupRegistry } from "../../packages/groups/src/registry.js";
import {
  GroupAccess,
  type AcceptedGroupContext,
} from "../../packages/groups/src/access.js";
import {
  fixture,
  enroll,
  sync,
  candidate,
  message,
  decide,
  type Actor,
} from "../fixtures/group-access.js";
import { launchOwned } from "./process-helper.js";

test(
  "Node and Go derive identical authorization from signed bundles and the same protected authority files",
  { timeout: 120000 },
  async (t) => {
    const f = fixture(t),
      a = f.actor("Alice"),
      b = f.actor("Bruno"),
      c = f.actor("Carla");
    const root = resolve(".cache/group-access-interop");
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
      "tests/native/group-access.test.ts",
      "tests/fixtures/group-access.ts",
      "native/go.mod",
      "native/go.sum",
      ...[
        "packages/groups/src",
        "packages/core/src",
        "native/groupaccess",
        "native/groupauthority",
        "native/groups",
        "native/groupstore",
        "native/sqlitedriver",
        "native/core",
      ].flatMap((base) =>
        readdirSync(base)
          .filter((p) => /\.(ts|go)$/.test(p))
          .map((p) => base + "/" + p),
      ),
    ].sort();
    const digest = () =>
        hash(files.map((p) => p + "\0" + hash(readFileSync(p))).join("\n")),
      initial = digest();
    const start = (...args: Parameters<typeof launchOwned>) => {
      const child = launchOwned(...args);
      children.push(child);
      return child;
    };
    const complete = async (child: ReturnType<typeof launchOwned>) => {
      const result = await child.done;
      assert.equal(result.timedOut, false, result.output);
      assert.equal(result.code, 0, result.output);
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
          "./groupaccess",
        ],
        { timeout: 90000 },
      ),
    );
    type Request = {
      Bundle?: ReturnType<typeof createBundle>;
      Prior?: AcceptedGroupContext;
      Target?: AcceptedGroupContext;
      GroupID?: string;
      EpochID?: string;
    };
    let assertions = 0;
    const compare = async (actor: Actor, requests: Request[]) => {
      const path = join(dir, randomUUID() + ".json"),
        output = path + ".out";
      writeFileSync(
        path,
        JSON.stringify({
          Path: actor.path,
          StoreID: actor.storeId,
          Identity: actor.identity,
          Output: output,
          Requests: requests,
        }),
        { mode: 0o600 },
      );
      const expected = requests.map((q) => {
        if (!q.Bundle)
          return actor.store.transaction((tx) =>
            GroupRegistry.inTransaction(tx, actor.identity, (g) =>
              new GroupAccess(g, actor.identity.public).retry(
                q.GroupID!,
                q.EpochID!,
              ),
            ),
          ).value;
        let value;
        try {
          value = candidate(q.Bundle, actor.identity);
        } catch {
          return { status: "unreadable" };
        }
        return decide(actor, value, q.Prior, q.Target);
      });
      await complete(
        start(
          binary,
          ["-test.run=^TestGroupAccessProcessFixture$", "-test.v"],
          { env: { ...process.env, RELAYLOOM_ACCESS_FIXTURE: path } },
        ),
      );
      const actual = JSON.parse(readFileSync(output, "utf8"));
      assert.deepEqual(actual, JSON.parse(canonical(expected)));
      assertions += requests.length;
    };
    const id = a.registry.create(randomUUID(), "Access parity").groupId;
    enroll(a, b, id);
    const old = message(a, id),
      oldEpoch = a.registry.state(id).head!,
      oldCards = a.registry.privateState(id, oldEpoch.id)!.members;
    const previous = decide(b, candidate(old, b.identity));
    assert.equal(previous.status, "accepted");
    if (previous.status !== "accepted") throw new Error("fixture not admitted");
    await compare(b, [
      { Bundle: old },
      { GroupID: id, EpochID: oldEpoch.id },
      { Bundle: old, Prior: previous.context },
    ]);
    enroll(a, c, id);
    sync(a, b, id);
    await compare(b, [{ Bundle: old }, { GroupID: id, EpochID: oldEpoch.id }]);
    await compare(c, [{ Bundle: old }, { GroupID: id, EpochID: oldEpoch.id }]);
    const current = a.registry.state(id).head!,
      currentCards = a.registry.privateState(id, current.id)!.members;
    const edit = {
      type: "edit",
      text: "Old audience only",
      conversation: id,
      groupAudience: "target",
      groupEpoch: current.id,
      targetEpoch: oldEpoch.id,
      target: old.manifest.id,
    };
    await compare(b, [
      {
        Bundle: createBundle(a.identity, "edit", edit, oldCards),
        Target: previous.context,
      },
      {
        Bundle: createBundle(a.identity, "edit", edit, currentCards),
        Target: previous.context,
      },
      {
        Bundle: createBundle(b.identity, "edit", edit, oldCards),
        Target: previous.context,
      },
    ]);
    a.registry.commit(randomUUID(), id, current.id, {
      title: "Removed Bruno",
      members: currentCards.filter((card) => card.id !== b.identity.public.id),
      joins: [],
    });
    sync(a, b, id);
    await compare(b, [
      { Bundle: old },
      { Bundle: old, Prior: previous.context },
      { GroupID: id, EpochID: oldEpoch.id },
    ]);
    const receipt = {
      type: "receipt",
      conversation: id,
      groupAudience: "historical",
      target: old.manifest.id,
      targetEpoch: oldEpoch.id,
    };
    await compare(a, [
      {
        Bundle: createBundle(b.identity, "receipt", receipt, oldCards),
        Target: previous.context,
      },
      { Bundle: createBundle(b.identity, "receipt", receipt, oldCards) },
      {
        Bundle: createBundle(
          b.identity,
          "receipt",
          { ...receipt, text: "smuggled" },
          oldCards,
        ),
        Target: previous.context,
      },
      {
        Bundle: createBundle(
          b.identity,
          "receipt",
          { ...receipt, groupAudience: ["historical"] },
          oldCards,
        ),
        Target: previous.context,
      },
    ]);
    enroll(a, b, id);
    await compare(b, [
      { Bundle: old },
      { GroupID: id, EpochID: oldEpoch.id },
      { Bundle: message(a, id) },
    ]);
    const close = f.actor("Close scope"),
      created = close.registry.create(randomUUID(), "Close");
    const path = join(dir, "close.json"),
      output = path + ".out";
    writeFileSync(
      path,
      JSON.stringify({
        Path: close.path,
        StoreID: close.storeId,
        Identity: close.identity,
        Output: output,
        CloseGroup: created.groupId,
        CloseEpoch: created.epochId,
        CloseOperation: randomUUID(),
      }),
      { mode: 0o600 },
    );
    await complete(
      start(binary, ["-test.run=^TestGroupAccessProcessFixture$", "-test.v"], {
        env: { ...process.env, RELAYLOOM_ACCESS_FIXTURE: path },
      }),
    );
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), [
      {
        before: { allowed: true, terminal: false, reason: "" },
        after: { allowed: false, terminal: true, reason: "group-closed" },
      },
    ]);
    assert.equal(close.registry.state(created.groupId).status, "closed");
    assertions++;
    assert.equal(digest(), initial);
    writeFileSync(
      join(root, "report.json"),
      JSON.stringify(
        {
          status: "PASSED",
          comparisons: assertions,
          sourceSHA256: initial,
          workerSHA256: hash(readFileSync(binary)),
          scope:
            "actual Go process reads Node-authored encrypted authority and verifies/decrypts actual bundles; no application API/UI integration is implied",
        },
        null,
        2,
      ),
    );
  },
);
