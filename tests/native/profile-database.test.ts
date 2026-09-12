import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
import {
  readPrivateState,
  writePrivateState,
} from "../../apps/node/src/local-state.js";
import { ProfileDatabase } from "../../packages/profile/src/database.js";
import { ProfileOwnership } from "../../packages/profile/src/ownership.js";
import { launchOwned } from "./process-helper.js";

test(
  "Node and Go share initialized private state and recover staged and committed process deaths",
  { timeout: 120000 },
  async () => {
    const root = resolve(".cache/profile-database-interop");
    mkdirSync(root, { recursive: true });
    const dir = mkdtempSync(join(root, "case-")),
      identity = createIdentity("Synthetic shared private state"),
      legacyFile = join(dir, "private-state.json"),
      binary = join(
        dir,
        process.platform === "win32" ? "worker.exe" : "worker",
      );
    writePrivateState(legacyFile, { mutations: {} }, identity);
    const originalCipher = readFileSync(legacyFile),
      legacy = Buffer.from(canonical(readPrivateState(legacyFile, identity))),
      sourceDigest = hash(originalCipher);
    const load = () => ({ bytes: legacy, sourceDigest }),
      owned: ReturnType<typeof launchOwned>[] = [];
    let database: ProfileDatabase | undefined,
      lease: ProfileOwnership | undefined;
    const start = (...args: Parameters<typeof launchOwned>) => {
      const child = launchOwned(...args);
      owned.push(child);
      return child;
    };
    const passed = async (child: ReturnType<typeof launchOwned>) => {
      const r = await child.done;
      assert.equal(r.timedOut, false, r.output);
      assert.equal(r.code, 0, r.output);
      return r;
    };
    const open = () => {
      lease = new ProfileOwnership(dir);
      database = ProfileDatabase.open(dir, identity, load);
      return database;
    };
    const close = () => {
      database?.close();
      lease?.close();
      database = undefined;
      lease = undefined;
    };
    const go = (mode: string, next?: Buffer, expected?: string) => {
      const path = join(dir, randomUUID() + ".json"),
        output = path + ".out",
        marker = path + ".marker";
      writeFileSync(
        path,
        JSON.stringify({
          Directory: dir,
          Identity: identity,
          Legacy: legacy.toString("base64"),
          SourceDigest: sourceDigest,
          Mode: mode,
          Next: next?.toString("base64") ?? "",
          Expected: expected ?? "",
          Output: output,
          Marker: marker,
        }),
        { mode: 0o600 },
      );
      const child = start(
        binary,
        ["-test.run=^TestProfileDatabaseInteropFixture$", "-test.v"],
        { env: { ...process.env, RELAYLOOM_PROFILE_DB_FIXTURE: path } },
      );
      return {
        ...child,
        marker,
        read: () => JSON.parse(readFileSync(output, "utf8")),
      };
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
            "-p=1",
            "-o",
            binary,
            "./profiledb",
          ],
          { timeout: 90000 },
        ),
      );
      const initialized = go("read");
      await passed(initialized);
      assert.equal(initialized.read().bytes, legacy.toString("base64"));
      const node = open();
      assert.deepEqual(node.binding, initialized.read().binding);
      assert.deepEqual(node.read().bytes, legacy);
      const next = Buffer.from(
        canonical({
          mutations: {},
          private: "Node → Go 🌊 \ud800".repeat(40000),
        }),
      );
      node.write(next, node.read().digest);
      close();
      const native = go("read");
      await passed(native);
      assert.equal(native.read().bytes, next.toString("base64"));
      assert.equal(native.read().digest, hash(next));
      const after = Buffer.from(
        canonical({ mutations: {}, private: "Go committed private document" }),
      );
      const crashed = go("before-commit", after, hash(next)),
        stopped = await crashed.done;
      assert.equal(stopped.code, 76, stopped.output);
      assert.equal(stopped.timedOut, false);
      assert.equal(
        readFileSync(crashed.marker, "utf8"),
        "private-and-fence-staged",
      );
      assert.ok(existsSync(join(dir, "profile-state.sqlite-journal")));
      assert.deepEqual(open().read().bytes, next);
      assert.equal(
        database!.store.view((tx) => tx.get("fence:interop")),
        undefined,
      );
      close();
      const lost = go("after-commit", after, hash(next)),
        finished = await lost.done;
      assert.equal(finished.code, 77, finished.output);
      assert.equal(finished.timedOut, false);
      const recovered = open();
      assert.deepEqual(recovered.read().bytes, after);
      assert.equal(recovered.read().digest, lost.read().digest);
      assert.equal(
        recovered.write(after, recovered.read().digest),
        hash(after),
      );
      close();
      const secret = join(dir, "identity.json");
      writeFileSync(secret, JSON.stringify(identity), { mode: 0o600 });
      const secondDir = join(dir, "second-profile");
      mkdirSync(secondDir);
      writePrivateState(
        join(secondDir, "private-state.json"),
        { mutations: {} },
        identity,
      );
      // A real Node factory dies after importing state but before committing its binding.
      const marker = join(dir, "node-imported.txt"),
        child = start(process.execPath, [
          "--import",
          "tsx",
          "tests/fixtures/profile-database-worker.ts",
          secondDir,
          secret,
          "imported",
          marker,
        ]);
      const dead = await child.done;
      assert.equal(dead.code, 74, dead.output);
      assert.equal(dead.timedOut, false);
      assert.equal(
        readFileSync(marker, "utf8"),
        "private-state-import-committed",
      );
      const request = join(dir, "resume-go.json"),
        output = join(dir, "resume-go-output.json");
      writeFileSync(
        request,
        JSON.stringify({
          Directory: secondDir,
          Identity: identity,
          Legacy: legacy.toString("base64"),
          SourceDigest: hash(
            readFileSync(join(secondDir, "private-state.json")),
          ),
          Mode: "read",
          Output: output,
        }),
        { mode: 0o600 },
      );
      await passed(
        start(
          binary,
          ["-test.run=^TestProfileDatabaseInteropFixture$", "-test.v"],
          { env: { ...process.env, RELAYLOOM_PROFILE_DB_FIXTURE: request } },
        ),
      );
      const resumed = JSON.parse(readFileSync(output, "utf8"));
      assert.equal(resumed.binding.body.phase, "committed");
      assert.equal(resumed.bytes, legacy.toString("base64"));
      assert.deepEqual(readFileSync(legacyFile), originalCipher);
    } finally {
      close();
      for (const child of owned) {
        await child.stop();
        await child.done.catch(() => {});
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
