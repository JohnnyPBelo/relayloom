import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hash } from "../../packages/core/src/index.js";
import { messagingPair } from "../fixtures/group-send.js";
import { until } from "../helpers.js";

for (const [creator, member] of [
  ["native", "node"],
  ["node", "native"],
  ["native", "native"],
] as const)
  test(
    `actual ${creator}/${member} group send, file-only message and reply use authenticated epoch cards`,
    { timeout: 45000 },
    async () => {
      const started = Date.now(),
        f = await messagingPair(creator, member);
      try {
        for (const client of [f.a, f.b])
          assert.equal((await client.call("state")).contacts.length, 0);
        const bytes = Buffer.from(
            "File-only group content\0verified across engines",
          ),
          operationId = randomUUID();
        const request = {
          operationId,
          content: {
            type: "message",
            conversation: f.groupId,
            groupEpoch: f.epoch,
            groupAudience: "epoch",
            attachments: [
              {
                name: "partilha.txt",
                mime: "text/plain",
                data: bytes.toString("base64"),
              },
            ],
          },
          recipients: [f.bob.id],
          ttlMs: 600000,
        };
        const sent = await f.a.call("send", request);
        assert.equal(sent.accepted, true);
        assert.equal(sent.outbox.preview, "partilha.txt");
        assert.equal(sent.outbox.attempts, 0);
        assert.equal((await f.a.call("state")).storage.reserved, 1);
        assert.equal((await f.a.call("send", request)).id, sent.id);
        await f.a.call("connect", { host: "127.0.0.1", port: f.b.tcpPort });
        await until(
          () => f.b.call("state"),
          (s) => s.objects.some((o: any) => o.id === sent.id),
        );
        const received = await f.b.call("view", { id: sent.id });
        assert.equal(received.author.id, f.alice.id);
        assert.equal(received.public, false);
        assert.deepEqual(
          [...received.readers].sort(),
          [f.alice.id, f.bob.id].sort(),
        );
        const file = await f.b.call("attachment", { id: sent.id, index: 0 });
        assert.deepEqual(Buffer.from(file.data, "base64"), bytes);
        const reply = await f.b.call("send", {
          operationId: randomUUID(),
          content: {
            type: "message",
            text: "Resposta real do membro",
            conversation: f.groupId,
            groupEpoch: f.epoch,
            groupAudience: "target",
            replyTo: sent.id,
            targetEpoch: f.epoch,
          },
          recipients: [f.alice.id],
          ttlMs: 600000,
        });
        const response = await until(
          () => f.a.call("state"),
          (s) => s.objects.some((o: any) => o.id === reply.id),
        );
        assert.equal(
          response.objects.find((o: any) => o.id === reply.id).author.id,
          f.bob.id,
        );
        await f.command(f.a, {
          action: "close",
          operationId: randomUUID(),
          groupId: f.groupId,
          expected: f.epoch,
        });
        const stopped = await f.a.call("send", request);
        assert.equal(stopped.id, sent.id);
        assert.equal(stopped.outbox.status, "superseded");
        await assert.rejects(
          f.a.call("send", { ...request, operationId: randomUUID() }),
          /grupo mudou/,
        );
        assert.equal((await f.a.call("state")).storage.reserved, 0);
        mkdirSync(".cache/group-send-interop", { recursive: true });
        writeFileSync(
          `.cache/group-send-interop/${creator}-${member}.json`,
          JSON.stringify(
            {
              status: "pass",
              creator,
              member,
              elapsedMs: Date.now() - started,
              nativeBinarySha256: hash(
                readFileSync(
                  join(
                    ".cache/native-app",
                    process.platform === "win32"
                      ? "relayloom.exe"
                      : "relayloom",
                  ),
                ),
              ),
              checks: [
                "real authenticated API creation",
                "no global contacts",
                "exact attachment bytes over TCP",
                "member-authored reply",
                "immutable retry result after closure",
              ],
              limits: [
                "control proofs transferred by fixture APIs",
                "automatic group confirmations not yet enabled",
                "not mobile or radio evidence",
              ],
            },
            null,
            2,
          ) + "\n",
        );
      } finally {
        await f.close();
      }
    },
  );
