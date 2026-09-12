import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createIdentity, hash } from "../../packages/core/src/index.js";
import { ProtectedGroupStore } from "../../packages/groups/src/storage.js";
import { populateIndex } from "../fixtures/group-index-fixture.js";
import { launchOwned } from "./process-helper.js";

test(
  "real Node/Go near-limit index preserves stop headroom and the disabled-guard control fails",
  { timeout: 180000 },
  async () => {
    const root = resolve(".cache/group-index-interop");
    mkdirSync(root, { recursive: true });
    const directory = mkdtempSync(join(root, "case-")),
      identity = createIdentity("Synthetic near-index owner"),
      path = join(directory, "registry.sqlite"),
      secret = join(directory, "identity.json"),
      marker = join(directory, "result.json");
    const store = new ProtectedGroupStore(path, identity, { create: true }),
      storeId = store.storeId(),
      owned: ReturnType<typeof launchOwned>[] = [];
    const start = (...args: Parameters<typeof launchOwned>) => {
      const process = launchOwned(...args);
      owned.push(process);
      return process;
    };
    const passed = async (process: ReturnType<typeof launchOwned>) => {
      const result = await process.done;
      assert.equal(result.timedOut, false, result.output);
      assert.equal(result.code, 0, result.output);
      return result;
    };
    const sourcePath = resolve("native/groupstore/format.go"),
      source = readFileSync(sourcePath, "utf8"),
      startedAt = new Date().toISOString();
    try {
      const setup = populateIndex(store, 4 * 1024 ** 2 - 128 * 1024 - 1000);
      assert.ok(setup.count > 10000);
      const revision = store.accounting().revision;
      writeFileSync(secret, JSON.stringify(identity), { mode: 0o600 });
      const disabled = join(directory, "disabled.go"),
        overlay = join(directory, "overlay.json"),
        guard =
          /result\.OrdinaryIndexBytes > maxIndex\s*-\s*result\.IndexReserveBytes \|\| /g;
      assert.equal(
        [...source.matchAll(guard)].length,
        1,
        "negative control must disable exactly the index reserve check",
      );
      writeFileSync(disabled, source.replace(guard, ""));
      writeFileSync(
        overlay,
        JSON.stringify({ Replace: { [sourcePath]: disabled } }),
      );
      const binaries = {
        disabled: join(
          directory,
          process.platform === "win32" ? "disabled.exe" : "disabled",
        ),
        guarded: join(
          directory,
          process.platform === "win32" ? "guarded.exe" : "guarded",
        ),
      };
      const controls: Record<string, unknown> = {};
      for (const mode of ["disabled", "guarded"] as const) {
        await passed(
          start(
            process.execPath,
            [
              "scripts/go.mjs",
              "test",
              "-c",
              "-p=1",
              ...(mode === "disabled" ? ["-overlay", overlay] : []),
              "-o",
              binaries[mode],
              "./groupstore",
            ],
            { timeout: 90000 },
          ),
        );
        const worker = start(
          binaries[mode],
          ["-test.run=^TestStoreProcessWorker$", "-test.v"],
          {
            timeout: 60000,
            env: {
              ...process.env,
              RELAYLOOM_STORE_WORKER: JSON.stringify({
                Mode: "index-reserve",
                Path: path,
                IdentityPath: secret,
                Marker: marker,
                StoreID: storeId,
              }),
            },
          },
        );
        const result = await worker.done;
        assert.equal(result.timedOut, false, result.output);
        if (mode === "disabled") {
          assert.notEqual(result.code, 0);
          assert.match(
            result.output,
            /ordinary index growth consumed protected index headroom/,
          );
          assert.equal(
            store.accounting().revision,
            revision,
            "negative transaction rolled back",
          );
        } else {
          assert.equal(result.code, 0, result.output);
          assert.equal(
            store.view((tx) => tx.get("checkpoint:go-stop"))!.toString(),
            "left",
          );
          const accounting = JSON.parse(readFileSync(marker, "utf8"));
          assert.equal(accounting.indexReserveBytes, 128 * 1024);
          assert.equal(
            accounting.ordinaryIndexBytes,
            store.accounting().ordinaryIndexBytes,
          );
          assert.ok(accounting.indexBytes <= 4 * 1024 ** 2);
        }
        controls[mode] = {
          exitCode: result.code,
          binarySHA256: hash(readFileSync(binaries[mode])),
          output: result.output,
        };
      }
      for (const key of setup.sampleKeys)
        assert.deepEqual(
          store.view((tx) => tx.get(key)),
          setup.plain,
        );
      assert.equal(
        readFileSync(sourcePath, "utf8"),
        source,
        "production guard was never changed",
      );
      writeFileSync(
        resolve(".cache/group-registry-evidence/index-interoperability.json"),
        JSON.stringify(
          {
            startedAt,
            completedAt: new Date().toISOString(),
            rows: setup.count,
            initialIndexBytes: setup.indexBytes,
            sourceSHA256: hash(source),
            controls,
            limitations: [
              "Linux local storage processes; this fixture was compiled without race instrumentation",
              "the negative binary uses a temporary Go overlay disabling only ordinary-index headroom; production source stays intact",
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
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
