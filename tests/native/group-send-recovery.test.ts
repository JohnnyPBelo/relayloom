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
import { setTimeout as delay } from "node:timers/promises";
import { canonical, hash } from "../../packages/core/src/index.js";
import { Router } from "../../packages/transport/src/index.js";
import { messagingPair } from "../fixtures/group-send.js";
import { launch, password, until, type Client } from "../helpers.js";
import { launchOwned } from "./process-helper.js";

function sourceDigest() {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(ts|go|mjs)$/.test(path)) files.push(path);
    }
  };
  for (const path of [
    "apps/node/src",
    "packages",
    "native",
    "tests/fixtures",
    "tests/native",
  ])
    visit(path);
  return hash(
    files
      .sort()
      .map((path) => path + "\0" + hash(readFileSync(path)))
      .join("\n"),
  );
}

test(
  "actual group creation/send survives eight Node/Go process deaths at intent and ready commits",
  { timeout: 180000 },
  async () => {
    mkdirSync(".cache/group-send-recovery", { recursive: true });
    const work = mkdtempSync(resolve(".cache/group-send-recovery/case-"));
    const binary = join(
      work,
      process.platform === "win32" ? "worker.exe" : "worker",
    );
    const sources = sourceDigest(),
      started = Date.now(),
      cases: any[] = [];
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
    try {
      await run(
        process.execPath,
        ["scripts/go.mjs", "test", "-c", "-o", binary, "./app"],
        0,
      );
      for (const runtime of ["node", "native"] as const)
        for (const phase of ["preparing", "ready"] as const)
          for (const mode of ["before", "after"] as const) {
            console.log(JSON.stringify({ runtime, phase, mode }));
            const f = await messagingPair(),
              sink = new Router({ relay: false }),
              packets: any[] = [];
            let recovered: Client | undefined;
            sink.on("payload", (payload: any) => {
              packets.push(payload);
              if (payload.witness)
                sink.broadcast({
                  type: "request",
                  ids: [hash(payload.witness)],
                });
            });
            try {
              const port = await sink.listen(),
                witness = randomUUID(),
                operationId = randomUUID();
              const body = {
                operationId,
                content: {
                  type: "message",
                  text: "x".repeat(159) + "🧶 Group process death " + witness,
                  conversation: f.groupId,
                  groupEpoch: f.epoch,
                  groupAudience: "epoch",
                },
                recipients: [f.bob.id],
                ttlMs: 600000,
              };
              await f.a.stop();
              const requestPath = join(
                  work,
                  `${runtime}-${phase}-${mode}.json`,
                ),
                marker = requestPath + ".marker";
              writeFileSync(
                requestPath,
                JSON.stringify({
                  directory: f.a.dir,
                  marker,
                  mode,
                  phase,
                  port,
                  witness,
                  body,
                }),
                { mode: 0o600 },
              );
              if (runtime === "node")
                await run(
                  process.execPath,
                  [
                    "--import",
                    "tsx",
                    "tests/fixtures/group-send-worker.ts",
                    requestPath,
                  ],
                  mode === "before" ? 83 : 84,
                );
              else
                await run(
                  binary,
                  ["-test.run=^TestGroupSendProcessExitFixture$", "-test.v"],
                  mode === "before" ? 83 : 84,
                  {
                    ...process.env,
                    RELAYLOOM_GROUP_SEND_FIXTURE: requestPath,
                    RELAYLOOM_GROUP_SEND_ROOT: process.cwd(),
                  },
                );
              const observed = JSON.parse(readFileSync(marker, "utf8"));
              assert.equal(observed.mode, mode);
              assert.equal(observed.phase, phase);
              await until(
                async () => packets,
                (all) => all.some((p) => p.witness === witness),
              );
              await delay(120);
              assert.equal(
                packets.some((p) => p.bundle?.manifest.id === observed.id),
                false,
              );
              const reader = runtime === "node" ? "native" : "node";
              recovered = await launch(f.a.dir, 0, 0, reader);
              await recovered.call("unlock", { password });
              const state = await recovered.call("state"),
                item = state.outbox.find(
                  (e: any) => e.operationId === operationId,
                );
              const stored = phase === "ready",
                retained = stored || mode === "after";
              assert.equal(!!item, retained);
              if (retained) {
                assert.equal(item.id, observed.id);
                assert.equal(item.status, stored ? "pending" : "unavailable");
                assert.equal(item.attempts, 0);
                assert.equal(
                  (await recovered.call("send", body)).id,
                  observed.id,
                );
              }
              assert.equal(state.storage.reserved, stored ? 1 : 0);
              if (stored) {
                assert.equal(
                  hash(
                    canonical(
                      JSON.parse(
                        readFileSync(
                          join(
                            f.a.dir,
                            "store",
                            "objects",
                            observed.id + ".json",
                          ),
                          "utf8",
                        ),
                      ),
                    ),
                  ),
                  observed.bundleHash,
                );
              }
              await recovered.call("connect", { host: "127.0.0.1", port });
              await recovered.call("connect", {
                host: "127.0.0.1",
                port: f.b.tcpPort,
              });
              if (retained && !stored) {
                const retry = await recovered.call("outbox-retry", {
                  operationId,
                });
                assert.equal(retry.outbox.status, "unavailable");
                assert.equal(retry.outbox.attempts, 0);
                // Public traffic witnesses the healed application path too.
                const publicControl = await recovered.call("publish", {
                  content: { type: "post", text: witness },
                  recipients: "public",
                });
                await until(
                  () => f.b.call("state"),
                  (s) => s.objects.some((o: any) => o.id === publicControl.id),
                );
                assert.equal(
                  (await f.b.call("state")).objects.some(
                    (o: any) => o.id === observed.id,
                  ),
                  false,
                );
                assert.equal(
                  packets.some((p) => p.bundle?.manifest.id === observed.id),
                  false,
                );
              } else {
                const sent = stored
                  ? await recovered.call("outbox-retry", { operationId })
                  : await recovered.call("send", body);
                if (!stored) assert.notEqual(sent.id, observed.id);
                await until(
                  () => f.b.call("state"),
                  (s) => s.objects.some((o: any) => o.id === sent.id),
                );
                const viewed = await f.b.call("view", { id: sent.id });
                assert.equal(viewed.content.text, body.content.text);
                assert.equal(viewed.author.id, f.alice.id);
                assert.deepEqual(
                  [...viewed.readers].sort(),
                  [f.alice.id, f.bob.id].sort(),
                );
                if (stored) {
                  await until(
                    async () => packets,
                    (all) => all.some((p) => p.bundle?.manifest.id === sent.id),
                  );
                  assert.equal(
                    hash(
                      canonical(
                        packets.find((p) => p.bundle?.manifest.id === sent.id)
                          .bundle,
                      ),
                    ),
                    observed.bundleHash,
                  );
                }
              }
              await recovered.stop();
              recovered = await launch(f.a.dir, 0, 0, runtime);
              await recovered.call("unlock", { password });
              const returned = await recovered.call("send", body);
              if (retained) assert.equal(returned.id, observed.id);
              cases.push({
                runtime,
                phase,
                mode,
                recoveredBy: reader,
                returnedTo: runtime,
                retained,
                payloadRecovered: stored,
                exit: mode === "before" ? 83 : 84,
              });
            } finally {
              if (recovered) await recovered.stop();
              await sink.stop();
              await f.close();
            }
          }
      assert.equal(
        sourceDigest(),
        sources,
        "sources changed during recovery gate",
      );
      writeFileSync(
        ".cache/group-send-recovery/report.json",
        JSON.stringify(
          {
            status: "pass",
            elapsedMs: Date.now() - started,
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
            cases,
            limits: [
              "control proofs explicitly transferred through APIs",
              "no automatic carriers or mobile/radio evidence",
            ],
          },
          null,
          2,
        ) + "\n",
      );
    } finally {
      for (const child of children) await child.stop();
      rmSync(work, { recursive: true, force: true });
    }
  },
);
