import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
import {
  canonical,
  createIdentity,
  hash,
  type Identity,
} from "../../packages/core/src/index.js";
import {
  createGroupSuccessor,
  type GroupConsent,
  type GroupInvitation,
} from "../../packages/groups/src/certificates.js";
import { ProtectedGroupStore } from "../../packages/groups/src/storage.js";
import { GroupRegistry } from "../../packages/groups/src/registry.js";
import { launchOwned } from "./process-helper.js";

test(
  "real Node/Go authority files preserve heads, cursors, fences, CAS and crash idempotence",
  { timeout: 180000 },
  async () => {
    const root = resolve(".cache/group-authority-interop");
    mkdirSync(root, { recursive: true });
    const dir = mkdtempSync(join(root, "case-")),
      binary = join(
        dir,
        process.platform === "win32"
          ? "authority-worker.exe"
          : "authority-worker",
      );
    const owned: ReturnType<typeof launchOwned>[] = [],
      stores: ProtectedGroupStore[] = [];
    const files = [
      "tests/native/group-authority.test.ts",
      "tests/native/process-helper.ts",
      "tests/fixtures/group-registry-worker.ts",
      "packages/core/src/index.ts",
      "native/go.mod",
      "native/go.sum",
      ...[
        "native/core",
        "native/groups",
        "native/groupstore",
        "native/sqlitedriver",
        "native/groupauthority",
        "packages/groups/src",
      ].flatMap((directory) =>
        readdirSync(directory)
          .filter((name) => /\.(go|ts)$/.test(name))
          .map((name) => directory + "/" + name),
      ),
    ].sort();
    const digest = () =>
      hash(
        files.map((file) => file + "\0" + hash(readFileSync(file))).join("\n"),
      );
    const sourceSHA256 = digest(),
      startedAt = new Date().toISOString(),
      assertions: string[] = [];
    const start = (
      command: string,
      args: string[],
      options: Parameters<typeof launchOwned>[2] = {},
    ) => {
      const process = launchOwned(command, args, options);
      owned.push(process);
      return process;
    };
    const passed = async (process: ReturnType<typeof launchOwned>) => {
      const result = await process.done;
      assert.equal(result.timedOut, false, result.output);
      assert.equal(result.code, 0, result.output);
      return result;
    };
    const open = (
      path: string,
      identity: Identity,
      storeId?: string,
      limits?: { totalBytes: number; reserveBytes: number },
    ) => {
      const store = new ProtectedGroupStore(
        path,
        identity,
        storeId
          ? { expectedStoreId: storeId }
          : { create: true, ...(limits ? { limits } : {}) },
      );
      stores.push(store);
      return {
        store,
        registry: new GroupRegistry(store, identity),
        path,
        identity,
        storeId: store.storeId(),
      };
    };
    type Actor = ReturnType<typeof open>;
    const go = (
      a: Pick<Actor, "identity" | "path"> & { storeId?: string },
      command: string,
      extra: Record<string, unknown> = {},
    ) => {
      const request = join(dir, randomUUID() + ".json"),
        output = request + ".out";
      writeFileSync(
        request,
        JSON.stringify({
          identity: a.identity,
          path: a.path,
          storeId: a.storeId ?? "",
          command,
          output,
          ...extra,
        }),
        { mode: 0o600 },
      );
      const process = start(
        binary,
        ["-test.run=^TestGroupAuthorityInteropFixture$", "-test.v"],
        {
          env: {
            ...globalThis.process.env,
            RELAYLOOM_AUTHORITY_FIXTURE: request,
          },
        },
      );
      return {
        ...process,
        read: () => JSON.parse(readFileSync(output, "utf8")),
      };
    };
    const run = async (
      a: Parameters<typeof go>[0],
      command: string,
      extra: Record<string, unknown> = {},
    ) => {
      const process = go(a, command, extra);
      await passed(process);
      const report = process.read();
      assert.equal(report.error, undefined);
      return report;
    };
    const node = (
      a: Actor,
      groupId: string,
      expected: string,
      operation: string,
      title: string,
      mode = "commit",
      marker = "",
    ) => {
      const identity = join(dir, randomUUID() + ".identity.json");
      writeFileSync(identity, JSON.stringify(a.identity), { mode: 0o600 });
      return start(
        process.execPath,
        [
          "--import",
          "tsx",
          "tests/fixtures/group-registry-worker.ts",
          mode,
          a.path,
          identity,
          groupId,
          expected,
          operation,
          title,
          marker,
        ],
        { ipc: true },
      );
    };
    const fill = (a: Actor) =>
      a.store.transaction((tx) =>
        tx.put(
          "capacity-fill",
          Buffer.alloc(65536 - tx.accounting().ordinaryBytes - 400),
        ),
      );
    try {
      await passed(
        start(
          process.execPath,
          [
            "scripts/go.mjs",
            "test",
            "-c",
            "-race",
            "-p=2",
            "-o",
            binary,
            "./groupauthority",
          ],
          { timeout: 90000 },
        ),
      );
      const identity = createIdentity("Synthetic Alice"),
        path = join(dir, "alice.sqlite"),
        createOp = randomUUID();
      const creation = await run({ identity, path }, "create", {
        create: true,
        operationId: createOp,
        args: { title: "Go → Node 🌍 \ud800" },
      });
      let a = open(path, identity, creation.storeId);
      const id = creation.result.groupId;
      assert.equal(a.registry.state(id).status, "active");
      assert.equal(a.registry.state(id).title, "Go → Node 🌍 \ud800");
      assert.deepEqual(
        a.registry.create(createOp, "Go → Node 🌍 \ud800"),
        creation.result,
      );
      let expected = a.registry.state(id).head!.id;
      const first = a.registry.commit(randomUUID(), id, expected, {
        title: "Node → Go 🌊 \udfff",
        members: [identity.public],
        joins: [],
      });
      const inspection = await run(a, "inspect", {
        groupId: id,
        expected: first.epochId,
      });
      assert.deepEqual(inspection.result.state, a.registry.state(id));
      assert.deepEqual(
        inspection.result.snapshot,
        a.registry.privateState(id, first.epochId!),
      );
      assertions.push(
        "both engines read identical persisted authority and retained operations, including lone UTF-16 surrogates",
      );

      expected = a.registry.state(id).head!.id;
      const native = go(a, "commit", {
          groupId: id,
          expected,
          operationId: randomUUID(),
          barrier: true,
          args: { title: "Go CAS" },
        }),
        js = node(a, id, expected, randomUUID(), "Node CAS");
      await Promise.all([native.ready, js.ready]);
      native.child.stdin!.end("go\n");
      js.child.send!({ go: true });
      const [, jsResult] = await Promise.all([passed(native), passed(js)]),
        nativeResult = native.read();
      assert.equal(
        [nativeResult.result, jsResult.message?.result].filter(Boolean).length,
        1,
      );
      assert.match(
        String(nativeResult.error ?? jsResult.message?.error),
        /desactualizada/,
      );
      assert.equal(a.registry.state(id).head!.body.number, 2);
      assertions.push(
        "one Node and one Go process racing the same parent commit exactly one successor",
      );

      expected = a.registry.state(id).head!.id;
      const operationId = randomUUID(),
        marker = join(dir, "go-staged.txt"),
        title = "Recovered Go operation";
      const before = go(a, "commit", {
        groupId: id,
        expected,
        operationId,
        crash: "before",
        marker,
        args: { title },
      });
      const stopped = await before.done;
      assert.equal(stopped.code, 73, stopped.output);
      assert.equal(stopped.timedOut, false);
      assert.equal(
        readFileSync(marker, "utf8"),
        "authority-and-operation-staged",
      );
      assert.ok(existsSync(path + "-journal"));
      a.store.close();
      a = open(path, identity, creation.storeId);
      assert.equal(a.registry.state(id).head!.id, expected);
      assert.equal(a.registry.operationStatus(operationId), null);
      const after = go(a, "commit", {
        groupId: id,
        expected,
        operationId,
        crash: "after",
        args: { title },
      });
      const lost = await after.done;
      assert.equal(lost.code, 74, lost.output);
      assert.equal(lost.timedOut, false);
      const reply = after.read().result;
      a.store.close();
      a = open(path, identity, creation.storeId);
      assert.deepEqual(
        a.registry.commit(operationId, id, expected, {
          title,
          members: [identity.public],
          joins: [],
        }),
        reply,
      );
      assert.equal(a.registry.state(id).head!.body.number, 3);
      assertions.push(
        "Node recovers a Go pre-commit process death and deduplicates its committed lost response",
      );

      expected = a.registry.state(id).head!.id;
      const jsMarker = join(dir, "node-staged.txt"),
        jsCrash = node(
          a,
          id,
          expected,
          randomUUID(),
          "Uncommitted Node",
          "crash-before-commit",
          jsMarker,
        );
      await jsCrash.ready;
      jsCrash.child.send!({ go: true });
      const dead = await jsCrash.done;
      assert.equal(dead.code, 73, dead.output);
      assert.equal(dead.timedOut, false);
      assert.equal(
        readFileSync(jsMarker, "utf8"),
        "authority-and-operation-staged",
      );
      const recovered = await run(a, "inspect", { groupId: id, expected });
      assert.equal(recovered.result.state.head.id, expected);
      assertions.push(
        "Go recovers a Node pre-commit authority crash without advancing the head",
      );

      const b = open(
        join(dir, "bruno.sqlite"),
        createIdentity("Synthetic Bruno"),
      );
      const enroll = () => {
        const parent = a.registry.state(id).head!,
          invitation = a.registry.invite(
            randomUUID(),
            id,
            parent.id,
            b.identity.public,
          ).certificate as GroupInvitation;
        b.registry.rememberInvitation(
          randomUUID(),
          a.registry.anchor(id),
          parent,
          invitation,
        );
        for (let n = 0; n <= parent.body.number; n += 16)
          b.registry.observeHeaders(id, a.registry.proofs(id, n));
        const consent = b.registry.accept(randomUUID(), id, parent.id)
          .certificate as GroupConsent;
        const next = a.registry.commit(randomUUID(), id, parent.id, {
          title: "Joined",
          members: [identity.public, b.identity.public],
          joins: [consent],
        });
        return {
          epoch: a.registry.state(id).head!,
          snapshot: a.registry.privateState(id, next.epochId!)!,
        };
      };
      const joined = enroll();
      b.registry.observeHeaders(id, [joined.epoch]);
      b.registry.observeSnapshot(id, joined.epoch.id, joined.snapshot);
      await run(b, "leave", { groupId: id, operationId: randomUUID() });
      assert.equal(b.registry.state(id).status, "left");
      const removed = a.registry.commit(randomUUID(), id, joined.epoch.id, {
        title: "Removed",
        members: [identity.public],
        joins: [],
      });
      b.registry.observeHeaders(id, [a.registry.state(id).head!]);
      assert.equal(b.registry.state(id).status, "left");
      const rejoined = enroll();
      await run(b, "headers", {
        groupId: id,
        args: { headers: [rejoined.epoch] },
      });
      const pending = await run(b, "inspect", {
        groupId: id,
        expected: removed.epochId,
      });
      assert.equal(pending.result.state.locallyLeft, true);
      await run(b, "snapshot", {
        groupId: id,
        args: { epoch: rejoined.epoch, snapshot: rejoined.snapshot },
      });
      assert.equal(b.registry.state(id).status, "active");
      assert.equal(b.registry.state(id).locallyLeft, false);
      assertions.push(
        "Go persists a local-left fence; fresh Node consent is consumed by Go without restoring historical keys",
      );

      const second = a.registry.commit(randomUUID(), id, rejoined.epoch.id, {
          title: "Second",
          members: rejoined.snapshot.members,
          joins: [],
        }),
        e2 = a.registry.state(id).head!,
        s2 = a.registry.privateState(id, second.epochId!)!;
      const third = a.registry.commit(randomUUID(), id, second.epochId!, {
          title: "Third",
          members: rejoined.snapshot.members,
          joins: [],
        }),
        e3 = a.registry.state(id).head!,
        s3 = a.registry.privateState(id, third.epochId!)!;
      await run(b, "headers", { groupId: id, args: { headers: [e2, e3] } });
      await run(b, "snapshot", {
        groupId: id,
        args: { epoch: e3, snapshot: s3 },
      });
      assert.equal(b.registry.state(id).status, "awaiting-snapshot");
      b.registry.observeSnapshot(id, e2.id, s2);
      assert.equal(b.registry.state(id).status, "active");
      const sibling = createGroupSuccessor(
        identity,
        a.registry.anchor(id),
        e2,
        s2,
        { title: "Other device", members: s2.members, joins: [] },
      );
      await run(b, "headers", {
        groupId: id,
        args: { headers: [sibling.epoch] },
      });
      assert.equal(b.registry.state(id).status, "forked");
      const conflict = await run(b, "inspect", {
        groupId: id,
        expected: e3.id,
      });
      assert.deepEqual(conflict.result.stop, b.registry.stopEvidence(id));
      assertions.push(
        "cross-runtime cursor waits for the missing snapshot and signed equivocation preserves both branches",
      );

      const c = open(
        join(dir, "capacity.sqlite"),
        createIdentity("Capacity"),
        undefined,
        { totalBytes: 4 * 1024 ** 2 + 65536, reserveBytes: 4 * 1024 ** 2 },
      );
      const cg = c.registry.create(randomUUID(), "Before"),
        parent = c.registry.state(cg.groupId).head!,
        snapshot = c.registry.privateState(cg.groupId, parent.id)!;
      const next = createGroupSuccessor(
        c.identity,
        c.registry.anchor(cg.groupId),
        parent,
        snapshot,
        { title: "Next", members: snapshot.members, joins: [] },
      );
      fill(c);
      assert.equal(
        c.registry.observeHeaders(cg.groupId, [next.epoch]).status.status,
        "capacity",
      );
      const stop = await run(c, "inspect", {
        groupId: cg.groupId,
        expected: parent.id,
      });
      assert.deepEqual(stop.result.stop, c.registry.stopEvidence(cg.groupId));
      c.store.transaction((tx) => tx.delete("capacity-fill"));
      await run(c, "resume", { groupId: cg.groupId });
      assert.equal(c.registry.state(cg.groupId).status, "awaiting-snapshot");
      c.registry.observeSnapshot(cg.groupId, next.epoch.id, next.snapshot);
      fill(c);
      await run(c, "close", {
        groupId: cg.groupId,
        expected: next.epoch.id,
        operationId: randomUUID(),
      });
      assert.equal(c.registry.state(cg.groupId).status, "closed");
      assert.equal(c.registry.proofs(cg.groupId, 0).length, 3);
      assertions.push(
        "capacity evidence and exact recovery are shared; Go closure succeeds with ordinary space exhausted",
      );

      b.store.transaction((tx) => {
        const key = "group:" + id,
          r = JSON.parse(tx.get(key)!.toString());
        r.admitted = false;
        r.checkedThrough = null;
        tx.put(key, Buffer.from(canonical(r)), "checkpoint");
      });
      const bad = go(b, "inspect", { groupId: id, expected: e3.id });
      await passed(bad);
      assert.match(bad.read().error, /autoridade/);
      assert.throws(() => b.registry.state(id), /autoridade/);
      assertions.push(
        "both engines reject an authenticated but malformed checkpoint",
      );
      assert.equal(
        digest(),
        sourceSHA256,
        "tested sources changed during execution",
      );
      mkdirSync(resolve(".cache/group-registry-evidence"), { recursive: true });
      writeFileSync(
        resolve(".cache/group-registry-evidence/interoperability.json"),
        JSON.stringify(
          {
            startedAt,
            completedAt: new Date().toISOString(),
            command:
              "node_modules/.bin/tsx --test tests/native/group-authority.test.ts",
            sourceSHA256,
            sourcesUnchanged: true,
            binarySHA256: hash(readFileSync(binary)),
            assertions,
            limitations: [
              "local Linux process and SQLite behavior; no group transport/application/UI integration",
              "no physical radios or mobile execution",
              "full valid backup rollback remains undetectable",
            ],
          },
          null,
          2,
        ) + "\n",
      );
    } finally {
      for (const process of owned) {
        await process.stop();
        await process.done.catch(() => {});
      }
      for (const store of stores) store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
