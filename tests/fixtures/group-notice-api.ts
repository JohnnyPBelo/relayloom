import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { createIdentity } from "../../packages/core/src/index.js";
import { launch, password, type Client } from "../helpers.js";

export async function groupNoticeAPI(
  first: "node" | "native",
  after: "node" | "native",
) {
  let client: Client = await launch(undefined, 0, 0, first);
  const dir = client.dir;
  try {
    await client.call("setup", { name: "Durable notice issuer", password });
    const recipient = createIdentity("Exact invited card").public;
    const command = (body: unknown) => client.call("group-command", body);
    const group = (
      await command({
        action: "create",
        operationId: randomUUID(),
        title: "Pending invitation",
      })
    ).group;
    const request = {
      action: "invite",
      operationId: randomUUID(),
      groupId: group.id,
      expected: group.head.id,
      card: recipient,
    };
    const issued = await command(request);
    assert.equal((await command({ action: "notice-list" })).notices.length, 0);
    const queued = (await command({ action: "notice-outbox" })).notices;
    assert.equal(queued.length, 1);
    assert.deepEqual(queued[0].notice.member, recipient);
    assert.equal(
      queued[0].notice.certificate.id,
      issued.operation.certificate.id,
    );
    assert.deepEqual((await client.call("state")).contacts, []);
    await client.stop();
    client = await launch(dir, 0, 0, after);
    await client.call("unlock", { password });
    const reopened = (await command({ action: "notice-outbox" })).notices;
    assert.deepEqual(
      reopened,
      queued,
      "engine takeover changed pending delivery material",
    );
    assert.deepEqual((await command(request)).operation, issued.operation);
    assert.equal(
      (await command({ action: "notice-outbox" })).notices.length,
      1,
    );
    await assert.rejects(
      () =>
        command({
          action: "notice-open",
          id: issued.operation.certificate.id,
          operationId: randomUUID(),
        }),
      /indisponível/,
    );
    assert.equal(
      (
        await command({
          action: "notice-dismiss",
          id: issued.operation.certificate.id,
        })
      ).retired,
      false,
    );
    // Outgoing capacity is bounded and an unqueued invitation must roll back
    // the matching authority operation, while closure remains available.
    for (let i = 1; i < 64; i++)
      await command({ ...request, operationId: randomUUID() });
    const overflow = randomUUID();
    await assert.rejects(
      () => command({ ...request, operationId: overflow }),
      /avisos cheia/,
    );
    assert.equal(
      (await command({ action: "operation", operationId: overflow })).operation,
      null,
    );
    assert.equal(
      (await command({ action: "notice-outbox" })).notices.length,
      64,
    );
    const closed = await command({
      action: "close",
      operationId: randomUUID(),
      groupId: group.id,
      expected: group.head.id,
    });
    assert.equal(closed.group.status, "closed");
    assert.equal(
      (await command({ action: "notice-outbox" })).notices.length,
      0,
    );
  } finally {
    await client.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}
