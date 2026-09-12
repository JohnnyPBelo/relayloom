import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchOwned } from "./process-helper.js";
import { ProfileOwnership } from "../../packages/profile/src/ownership.js";

test(
  "real Node and Go processes exclude the same profile and recover after owner death",
  { timeout: 120000 },
  async () => {
    const root = resolve(".cache/profile-ownership-interop");
    mkdirSync(root, { recursive: true });
    const directory = mkdtempSync(join(root, "case-")),
      dir = join(directory, "profile");
    mkdirSync(dir);
    const binary = join(
        directory,
        process.platform === "win32" ? "owner-worker.exe" : "owner-worker",
      ),
      owned: ReturnType<typeof launchOwned>[] = [];
    const start = (...args: Parameters<typeof launchOwned>) => {
      const process = launchOwned(...args);
      owned.push(process);
      return process;
    };
    const passed = async (process: ReturnType<typeof launchOwned>) => {
      const result = await process.done;
      assert.equal(result.code, 0, result.output);
      assert.equal(result.timedOut, false);
      return result;
    };
    const node = () =>
      start(
        process.execPath,
        ["--import", "tsx", "tests/fixtures/profile-owner-worker.ts", dir],
        { ipc: true },
      );
    const go = () => {
      const output = join(directory, randomUUID() + ".json");
      const child = start(
        binary,
        ["-test.run=^TestProfileOwnershipInteropFixture$", "-test.v"],
        {
          env: {
            ...process.env,
            RELAYLOOM_PROFILE_FIXTURE_DIR: dir,
            RELAYLOOM_PROFILE_FIXTURE_OUTPUT: output,
          },
        },
      );
      return { ...child, read: () => JSON.parse(readFileSync(output, "utf8")) };
    };
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
            "./profilelock",
          ],
          { timeout: 90000 },
        ),
      );
      const first = node();
      await first.ready;
      const blockedGo = go();
      await passed(blockedGo);
      assert.match(blockedGo.read().error, /perfil.*aberto/);
      assert.throws(() => new ProfileOwnership(dir), /perfil.*aberto/);
      first.child.send!({ release: true });
      await passed(first);
      const native = go();
      await native.ready;
      assert.equal(native.read().acquired, true);
      const blockedNode = await passed(node());
      assert.match(blockedNode.message.error, /perfil.*aberto/);
      native.child.stdin!.end("crash\n");
      const goCrash = await native.done;
      assert.equal(goCrash.code, 75, goCrash.output);
      assert.equal(goCrash.timedOut, false);
      const next = node();
      await next.ready;
      const blockedAgain = go();
      await passed(blockedAgain);
      assert.match(blockedAgain.read().error, /perfil.*aberto/);
      next.child.send!({ crash: true });
      const nodeCrash = await next.done;
      assert.equal(nodeCrash.code, 75, nodeCrash.output);
      assert.equal(nodeCrash.timedOut, false);
      const final = go();
      await final.ready;
      assert.equal(final.read().acquired, true);
      final.child.stdin!.end("release\n");
      await passed(final);
      const reopened = new ProfileOwnership(dir);
      reopened.close();
    } finally {
      for (const process of owned) {
        await process.stop();
        await process.done.catch(() => {});
      }
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
