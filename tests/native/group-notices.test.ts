import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { canonical, createBundle } from "../../packages/core/src/index.js";
import {
  acceptGroupInvitation,
  createGroupInvitation,
} from "../../packages/groups/src/certificates.js";
import {
  GroupNotices,
  NOTICE_LIMITS,
  openGroupNotice,
  sealGroupNotice,
  type GroupNotice,
} from "../../packages/groups/src/notices.js";
import { fixture, type Actor } from "../fixtures/group-access.js";
import { launchOwned } from "./process-helper.js";

test(
  "Node and Go share encrypted notice rows, retirement and envelopes through real processes",
  { timeout: 120000 },
  async (t) => {
    const f = fixture(t),
      a = f.actor("Ana do C2"),
      b = f.actor("Bruno do C2"),
      c = f.actor("Exterior");
    mkdirSync(".cache/group-notices", { recursive: true });
    const dir = mkdtempSync(resolve(".cache/group-notices/interop-"));
    const binary = join(
      dir,
      process.platform === "win32" ? "notice-worker.exe" : "notice-worker",
    );
    const owned: ReturnType<typeof launchOwned>[] = [];
    const run = async (
      command: string,
      args: string[],
      env?: NodeJS.ProcessEnv,
    ) => {
      const child = launchOwned(command, args, {
        timeout: 60000,
        ...(env ? { env } : {}),
      });
      owned.push(child);
      const result = await child.done;
      assert.equal(result.timedOut, false, result.output);
      assert.equal(result.code, 0, result.output);
    };
    const go = async (
      actor: Actor,
      action: string,
      extra: Record<string, unknown> = {},
    ) => {
      const path = join(dir, randomUUID() + ".json");
      writeFileSync(
        path,
        canonical({
          identity: actor.identity,
          path: actor.path,
          storeId: actor.storeId,
          action,
          ...extra,
        }),
        { mode: 0o600 },
      );
      await run(binary, ["-test.run=^TestNoticeInteropFixture$"], {
        ...process.env,
        RELAYLOOM_NOTICE_FIXTURE: path,
      });
      return JSON.parse(readFileSync(path + ".out", "utf8"));
    };
    const journal = <T>(actor: Actor, fn: (n: GroupNotices) => T) =>
      actor.store.transaction((tx) =>
        fn(new GroupNotices(tx, actor.identity.public)),
      );
    try {
      await run(process.execPath, [
        "scripts/go.mjs",
        "test",
        "-c",
        "-race",
        "-p=1",
        "-o",
        binary,
        "./groupnotice",
      ]);
      const id = a.registry.create(randomUUID(), "Interoperável").groupId;
      const anchor = a.registry.anchor(id),
        parent = a.registry.state(id).head!;
      const make = (): Extract<GroupNotice, { kind: "invitation" }> => ({
        type: "group-notice",
        version: 1,
        kind: "invitation",
        anchor,
        parent,
        member: b.identity.public,
        certificate: createGroupInvitation(
          a.identity,
          anchor,
          parent,
          b.identity.public,
        ),
      });
      const first = make(),
        second = make();
      assert.equal(
        journal(a, (n) => n.save("out", first)),
        "stored",
      );
      const listed = await go(a, "list", { direction: "out" });
      assert.equal(listed.error, undefined);
      assert.equal(listed.entries.length, 1);
      assert.deepEqual(listed.entries[0].notice, first);
      const resealed = await go(a, "seal", { notice: first });
      assert.equal(resealed.error, undefined);
      assert.deepEqual(openGroupNotice(resealed.bundle, b.identity), first);
      const opened = await go(b, "open", {
        bundle: sealGroupNotice(a.identity, first),
      });
      assert.deepEqual(opened.opened, first);
      assert.equal(
        (await go(a, "save", { direction: "out", notice: second })).result,
        "stored",
      );
      assert.deepEqual(
        new Set(
          journal(a, (n) => n.list("out")).map((e) => e.notice.certificate.id),
        ),
        new Set([first.certificate.id, second.certificate.id]),
      );
      assert.equal(
        journal(b, (n) => n.save("in", first)),
        "stored",
      );
      assert.equal(
        (await go(b, "retire", { direction: "in", id: first.certificate.id }))
          .retired,
        true,
      );
      assert.deepEqual(
        journal(b, (n) => n.list("in")),
        [],
      );
      assert.equal(
        journal(b, (n) => n.save("in", first)),
        "retired",
      );
      assert.equal(
        (await go(b, "save", { direction: "in", notice: first })).result,
        "retired",
      );
      assert.equal(
        (await go(b, "save", { direction: "in", notice: second })).result,
        "stored",
      );
      assert.equal(
        journal(b, (n) => n.retire("in", second.certificate.id)),
        true,
      );
      assert.equal(
        (await go(b, "save", { direction: "in", notice: second })).result,
        "retired",
      );
      const consent: GroupNotice = {
        ...second,
        kind: "consent",
        invitation: second.certificate,
        certificate: acceptGroupInvitation(
          b.identity,
          anchor,
          parent,
          second.certificate,
        ),
      };
      const answer = await go(b, "seal", { notice: consent });
      assert.equal(answer.error, undefined);
      assert.deepEqual(openGroupNotice(answer.bundle, a.identity), consent);
      assert.deepEqual(
        b.registry.list(),
        [],
        "a globally signed consent is not local group admission",
      );
      const widened = createBundle(
        a.identity,
        "group-notice",
        first,
        [b.identity.public, c.identity.public],
        NOTICE_LIMITS.ttl,
      );
      assert.match(
        (await go(b, "open", { bundle: widened })).error,
        /destinatários/,
      );
      assert.match(
        (await go(c, "open", { bundle: sealGroupNotice(a.identity, first) }))
          .error,
        /./,
      );
      assert.match(
        (await go(a, "save", { direction: "in", notice: first })).error,
        /outro perfil/,
      );
      const corrupt = journal(a, (n) => n.list("out"))[0];
      a.store.transaction((tx) => {
        const key = "group-notice:out:" + corrupt.notice.certificate.id;
        tx.put(
          key,
          Buffer.from(
            canonical({
              ...corrupt,
              sequence: tx.indexBody().revision + 1,
              direction: "in",
            }),
          ),
        );
      });
      const before = a.store.transaction((tx) => tx.indexBody().revision);
      assert.match((await go(a, "list", { direction: "out" })).error, /aviso/);
      assert.equal(
        a.store.transaction((tx) => tx.indexBody().revision),
        before,
        "rejected corrupt state changed the stored revision",
      );
    } finally {
      for (const child of owned) await child.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
