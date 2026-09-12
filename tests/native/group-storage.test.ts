import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createIdentity } from "../../packages/core/src/index.js";
import {
  ProtectedGroupStore,
  RegistryIntegrityError,
} from "../../packages/groups/src/storage.js";
import { stopOwnedProcessGroup } from "../../scripts/ios-simulator.mjs";

test(
  "Node and Go share encrypted SQLite files, serialize real writers and recover each other's crashed transactions",
  { timeout: 120000 },
  async () => {
    const cache = resolve(".cache/group-storage-interop");
    mkdirSync(cache, { recursive: true });
    const dir = mkdtempSync(join(cache, "case-")),
      path = join(dir, "registry.sqlite"),
      identityPath = join(dir, "identity.json");
    const binary = join(
      dir,
      process.platform === "win32" ? "store-worker.exe" : "store-worker",
    );
    const sourceDigest = () => {
      const digest = createHash("sha256");
      const files = [
        "packages/groups/src/storage.ts",
        "packages/core/src/index.ts",
        "native/go.mod",
        "native/go.sum",
        "native/core/canonical.go",
        "native/core/crypto.go",
        "tests/native/group-storage.test.ts",
        "tests/fixtures/group-storage-worker.ts",
        "scripts/ios-simulator.mjs",
        ...readdirSync("native/groupstore")
          .filter((p) => p.endsWith(".go"))
          .map((p) => "native/groupstore/" + p),
        ...readdirSync("native/sqlitedriver")
          .filter((p) => p.endsWith(".go"))
          .map((p) => "native/sqlitedriver/" + p),
      ];
      for (const file of files.sort())
        digest.update(file).update("\0").update(readFileSync(file));
      return digest.digest("hex");
    };
    const before = sourceDigest(),
      startedAt = new Date().toISOString();
    const owned: {
      child: ChildProcess;
      done: Promise<{ code: number | null; output: string; timedOut: boolean }>;
      stop: () => Promise<void>;
    }[] = [];
    const stores: ProtectedGroupStore[] = [];
    const start = (
      command: string,
      args: string[],
      options: {
        env?: NodeJS.ProcessEnv;
        ipc?: boolean;
        timeout?: number;
      } = {},
    ) => {
      const child = spawn(command, args, {
        cwd: process.cwd(),
        env: options.env ?? process.env,
        detached: process.platform !== "win32",
        stdio: options.ipc
          ? ["pipe", "pipe", "pipe", "ipc"]
          : ["pipe", "pipe", "pipe"],
      });
      let output = "",
        timedOut = false,
        stopPromise: Promise<void> | undefined;
      const stop = () =>
        (stopPromise ??= (async () => {
          if (!child.pid) return;
          if (process.platform === "win32") {
            if (child.exitCode === null && child.signalCode === null)
              spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
                timeout: 6000,
                stdio: "ignore",
              });
          } else await stopOwnedProcessGroup(child.pid);
        })());
      let acceptReady!: () => void, rejectReady!: (reason: Error) => void;
      const ready = new Promise<void>((resolve, reject) => {
        acceptReady = resolve;
        rejectReady = reject;
      });
      void ready.catch(() => {});
      const collect = (data: Buffer) => {
        output += data.toString();
        if (output.includes("STORE_WORKER_READY")) acceptReady();
        if (Buffer.byteLength(output) > 65536) {
          output = output.slice(-8192);
          timedOut = true;
          void stop();
        }
      };
      child.stdout!.on("data", collect);
      child.stderr!.on("data", collect);
      child.on("message", (value) => {
        if ((value as any).ready === true) acceptReady();
      });
      const timer = setTimeout(() => {
        timedOut = true;
        void stop();
      }, options.timeout ?? 15000);
      const done = new Promise<{
        code: number | null;
        output: string;
        timedOut: boolean;
      }>((resolve, reject) => {
        child.once("error", (error) => {
          clearTimeout(timer);
          rejectReady(error);
          reject(error);
        });
        child.once("close", (code) => {
          clearTimeout(timer);
          rejectReady(new Error("Worker ended before readiness: " + output));
          resolve({ code, output, timedOut });
        });
      });
      owned.push({ child, done, stop });
      return { child, done, ready };
    };
    const go = (mode: string, marker = "") =>
      start(
        binary,
        ["-test.run=^TestStoreProcessWorker$", "-test.timeout=20s"],
        {
          env: {
            ...process.env,
            RELAYLOOM_STORE_WORKER: JSON.stringify({
              Mode: mode,
              Path: path,
              IdentityPath: identityPath,
              Marker: marker,
            }),
          },
        },
      );
    const node = (mode: string, marker = "") =>
      start(
        process.execPath,
        [
          "--import",
          "tsx",
          "tests/fixtures/group-storage-worker.ts",
          mode,
          path,
          identityPath,
          marker,
        ],
        { ipc: true },
      );
    const passed = async (process: ReturnType<typeof start>) => {
      const result = await process.done;
      assert.equal(result.timedOut, false, result.output);
      assert.equal(result.code, 0, result.output);
      return result;
    };
    const open = (
      identity: ReturnType<typeof createIdentity>,
      expectedStoreId?: string,
    ) => {
      const store = new ProtectedGroupStore(path, identity, {
        expectedStoreId,
      });
      stores.push(store);
      return store;
    };
    try {
      const identity = createIdentity("Synthetic cross-runtime registry owner");
      writeFileSync(identityPath, JSON.stringify(identity), { mode: 0o600 });
      await passed(
        start(
          process.execPath,
          [
            "scripts/go.mjs",
            "test",
            "-c",
            "-p=2",
            "-o",
            binary,
            "./groupstore",
          ],
          { timeout: 90000 },
        ),
      );
      const binarySHA256 = createHash("sha256")
        .update(readFileSync(binary))
        .digest("hex");
      await passed(go("create"));
      let store = open(identity);
      assert.equal(
        store.view((tx) => tx.get("head:go"))!.toString(),
        "Go → Node — ficheiro cifrado",
      );
      const storeId = store.storeId();
      store.transaction((tx) =>
        tx.put(
          "head:node",
          Buffer.from("Node → Go — propriedade de assinatura"),
          "checkpoint",
        ),
      );
      store.close();
      await passed(go("exchange"));
      store = open(identity, storeId);
      assert.equal(
        store.view((tx) => tx.get("head:go"))!.toString(),
        "Go confirmou bytes Node",
      );
      assert.equal(store.accounting().revision, 3);
      store.close();
      const nativeWriter = go("increment"),
        nodeWriter = node("increment");
      await Promise.all([nativeWriter.ready, nodeWriter.ready]);
      nativeWriter.child.stdin!.end("go\n");
      nodeWriter.child.send!({ go: true });
      await Promise.all([passed(nativeWriter), passed(nodeWriter)]);
      store = open(identity, storeId);
      assert.equal(store.view((tx) => tx.get("counter"))!.toString(), "24");
      assert.equal(store.accounting().revision, 27);
      store.close();

      const goMarker = join(dir, "go-staged.txt"),
        crashedGo = await go("crash", goMarker).done;
      assert.equal(crashedGo.code, 73, crashedGo.output);
      assert.equal(crashedGo.timedOut, false);
      assert.equal(
        readFileSync(goMarker, "utf8"),
        "writes-staged-before-commit",
      );
      assert.equal(existsSync(path + "-journal"), true);
      store = open(identity, storeId);
      assert.equal(store.view((tx) => tx.get("counter"))!.toString(), "24");
      assert.equal(
        store.view((tx) => tx.get("uncommitted")),
        undefined,
      );
      store.close();

      const nodeMarker = join(dir, "node-staged.txt"),
        crashedNode = await node("crash", nodeMarker).done;
      assert.equal(crashedNode.code, 73, crashedNode.output);
      assert.equal(crashedNode.timedOut, false);
      assert.equal(
        readFileSync(nodeMarker, "utf8"),
        "writes-staged-before-commit",
      );
      assert.equal(existsSync(path + "-journal"), true);
      await passed(go("recover"));
      await passed(go("read"));
      store = open(identity, storeId);
      const accounting = store.accounting();
      assert.equal(accounting.revision, 27);
      const slot = store.view(
        (tx) => tx.indexBody().entries.find((e) => e.key === "head:go")!.slot,
      );
      store.close();
      const db = new DatabaseSync(path);
      try {
        const bytes = Buffer.from(
          db.prepare("SELECT payload FROM records WHERE slot=?").get(slot)!
            .payload as Uint8Array,
        );
        bytes[bytes.length - 1] ^= 1;
        db.prepare("UPDATE records SET payload=? WHERE slot=?").run(
          bytes,
          slot,
        );
      } finally {
        db.close();
      }
      store = open(identity, storeId);
      assert.throws(
        () => store.view((tx) => tx.get("head:go")),
        RegistryIntegrityError,
      );
      store.close();
      const rejectedGo = await go("read").done;
      assert.equal(rejectedGo.timedOut, false);
      assert.equal(rejectedGo.code, 1);
      assert.match(rejectedGo.output, /corrompido/);
      assert.equal(
        sourceDigest(),
        before,
        "source changed during interoperability gate",
      );
      writeFileSync(
        join(cache, "interoperability.json"),
        JSON.stringify(
          {
            kind: "REAL_NODE_GO_SQLITE_STORAGE",
            status: "PASSED",
            startedAt,
            completedAt: new Date().toISOString(),
            sourceSHA256: before,
            binarySHA256,
            goReadsNodeEncryptedBytes: true,
            nodeReadsGoEncryptedBytes: true,
            simultaneousWritersPreserve24Updates: true,
            committedRevision: 27,
            nodeRecoversGoAbruptExit: true,
            goRecoversNodeAbruptExit: true,
            bothRejectTamperedCommittedRow: true,
            accounting,
            applicationIntegration: false,
            mobileRuntimeExecuted: false,
          },
          null,
          2,
        ) + "\n",
      );
    } finally {
      for (const store of stores) store.close();
      for (const process of owned) {
        await process.stop();
        await process.done.catch(() => {});
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
