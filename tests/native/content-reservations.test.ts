import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  cpSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import {
  createBundle,
  createIdentity,
  hash,
  canonical,
} from "../../packages/core/src/index.js";
import { launchOwned } from "./process-helper.js";

test(
  "real Node and Go processes preserve encrypted reservations after process exit, with an eviction negative control",
  { timeout: 120000 },
  async (t) => {
    const out = ".cache/content-reservation-interop";
    mkdirSync(out, { recursive: true });
    const dir = mkdtempSync(join(process.cwd(), out, "case-")),
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
      "native/go.mod",
      "native/go.sum",
      "tests/native/content-reservations.test.ts",
      "tests/fixtures/content-reservation-worker.ts",
      ...readdirSync("native/core")
        .filter((p) => p.endsWith(".go"))
        .map((p) => "native/core/" + p),
      "packages/core/src/index.ts",
    ].sort();
    const digest = () =>
        hash(files.map((p) => p + "\0" + hash(readFileSync(p))).join("\n")),
      before = digest();
    const execute = async (
      command: string,
      args: string[],
      env?: NodeJS.ProcessEnv,
      expected = 0,
    ) => {
      const child = launchOwned(command, args, { env, timeout: 60000 });
      children.push(child);
      const result = await child.done;
      assert.equal(result.timedOut, false, result.output);
      assert.equal(result.code, expected, result.output);
    };
    await execute(process.execPath, [
      "scripts/go.mjs",
      "test",
      "-c",
      "-race",
      "-o",
      binary,
      "./core",
    ]);
    const author = createIdentity("Original author"),
      bundles = ["held bytes", "manual pin", "pressure"].map((text) =>
        createBundle(
          author,
          "message",
          { type: "message", text },
          [author.public],
          60000,
        ),
      );
    const storeDir = join(dir, "store");
    let sequence = 0;
    const call = async (
      engine: "node" | "go",
      action: string,
      reservations?: string[],
      path = storeDir,
    ) => {
      const input = join(dir, `input-${sequence++}.json`),
        output = input + ".out";
      writeFileSync(
        input,
        JSON.stringify({
          storeDir: path,
          action,
          reservations,
          bundles,
          output,
        }),
        { mode: 0o600 },
      );
      const exit = action === "reserve-exit" ? 78 : 0;
      if (engine === "node")
        await execute(
          process.execPath,
          [
            "--import",
            "tsx",
            "tests/fixtures/content-reservation-worker.ts",
            input,
          ],
          undefined,
          exit,
        );
      else
        await execute(
          binary,
          ["-test.run=^TestContentReservationProcessFixture$"],
          { ...process.env, RELAYLOOM_RESERVATION_FIXTURE: input },
          exit,
        );
      return exit === 0 ? JSON.parse(readFileSync(output, "utf8")) : undefined;
    };
    await call("node", "seed");
    const positive = await call("go", "pressure");
    assert.equal(positive.admitted, false);
    assert.equal(positive.aPresent, true);
    assert.equal(positive.canDecrypt, false);
    assert.equal(positive.bPinned, true);
    assert.deepEqual(positive.reservations, [bundles[0].manifest.id]);
    assert.equal(
      positive.stats.reservedBytes,
      Buffer.byteLength(canonical(bundles[0])),
    );
    const control = join(dir, "control");
    cpSync(storeDir, control, { recursive: true });
    const index = JSON.parse(readFileSync(join(control, "index.json"), "utf8"));
    delete index[bundles[0].manifest.id].reserved;
    writeFileSync(join(control, "index.json"), JSON.stringify(index));
    const negative = await call("go", "pressure", undefined, control);
    assert.equal(negative.admitted, true);
    assert.equal(
      negative.aPresent,
      false,
      "the same pressure must evict when only the reservation is removed",
    );
    await call("go", "reserve-exit", [bundles[1].manifest.id]);
    const afterGo = await call("node", "inspect");
    assert.deepEqual(afterGo.reservations, [bundles[1].manifest.id]);
    assert.equal(afterGo.bPinned, true);
    await call("node", "reserve-exit", [bundles[0].manifest.id]);
    const afterNode = await call("go", "inspect");
    assert.deepEqual(afterNode.reservations, [bundles[0].manifest.id]);
    assert.equal(afterNode.bPinned, true);
    await call("node", "reserve", []);
    const released = await call("go", "pressure");
    assert.equal(released.admitted, true);
    assert.equal(released.aPresent, false);
    assert.equal(released.bPinned, true);
    assert.equal(digest(), before);
    writeFileSync(
      join(out, "report.json"),
      JSON.stringify(
        {
          result: "pass",
          sourceDigest: before,
          realProcesses: true,
          encryptedPayloadRetainedWithoutDecryption: true,
          negativeControlRemovesOnlyReservation: true,
          bothEnginesExitAfterReservationCommit: 78,
          manualPinPreservedOnRelease: true,
          notTested: [
            "application ledger coordination",
            "physical power failure",
            "mobile runtime",
          ],
        },
        null,
        2,
      ) + "\n",
    );
  },
);
