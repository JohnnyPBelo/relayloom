import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { launch, password, until, type Client } from "../helpers.js";

export async function groupNoticeNetwork(
  first: "node" | "native",
  second: "node" | "native",
) {
  const a = await launch(undefined, 0, 0, first),
    b = await launch(undefined, 0, 0, second);
  const command = (client: Client, body: unknown) =>
    client.call("group-command", body);
  try {
    const alice = await a.call("setup", { name: "Notice issuer", password });
    const bob = await b.call("setup", { name: "Notice recipient", password });
    await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
    const group = (
      await command(a, {
        action: "create",
        operationId: randomUUID(),
        title: "Real notice group",
      })
    ).group;
    const invited = await command(a, {
      action: "invite",
      operationId: randomUUID(),
      groupId: group.id,
      expected: group.head.id,
      card: bob,
    });
    const inbox = await until(
      () => command(b, { action: "notice-list" }),
      (v) =>
        v.notices.some(
          (e: any) =>
            e.notice.certificate.id === invited.operation.certificate.id,
        ),
    );
    assert.equal((await command(b, { action: "list" })).groups.length, 0);
    const notice = inbox.notices[0].notice;
    assert.equal(notice.member.id, bob.id);
    assert.equal(notice.anchor.body.creator.id, alice.id);
    const openOperation = randomUUID();
    const opened = await command(b, {
      action: "notice-open",
      operationId: openOperation,
      id: notice.certificate.id,
    });
    await until(
      () => command(b, { action: "state", groupId: group.id }),
      (v) => v.group.head?.id === group.head.id,
    );
    assert.equal(
      (await command(b, { action: "state", groupId: group.id })).group
        .pendingConsent,
      null,
    );
    const accepted = await command(b, {
      action: "accept",
      operationId: randomUUID(),
      groupId: group.id,
      expected: group.head.id,
    });
    const replies = await until(
      () => command(a, { action: "notice-list" }),
      (v) =>
        v.notices.some(
          (e: any) =>
            e.notice.certificate.id === accepted.operation.certificate.id,
        ),
    );
    const consent = replies.notices.find(
      (e: any) => e.notice.kind === "consent",
    ).notice.certificate;
    assert.equal(consent.body.invitationHash, notice.certificate.id);
    await assert.rejects(
      () =>
        command(b, {
          action: "notice-open",
          operationId: randomUUID(),
          id: notice.certificate.id,
        }),
      /aceite|participa/,
    );
    assert.equal(
      (await command(b, { action: "state", groupId: group.id })).group
        .pendingConsent,
      accepted.operation.certificate.id,
    );
    assert.equal(
      (await command(b, { action: "state", groupId: group.id })).group.status,
      "joining",
    );
    const joined = await command(a, {
      action: "commit",
      operationId: randomUUID(),
      groupId: group.id,
      expected: group.head.id,
      title: "Explicitly joined",
      members: [alice, bob],
      joins: [consent],
    });
    await until(
      () => command(b, { action: "state", groupId: group.id }),
      (v) =>
        v.group.status === "active" && v.group.head.id === joined.group.head.id,
    );
    assert.deepEqual(
      (
        await command(b, {
          action: "notice-open",
          operationId: openOperation,
          id: notice.certificate.id,
        })
      ).operation,
      opened.operation,
      "retained open operation must recover even after group admission advances the head",
    );
    const sent = await b.call("send", {
      operationId: randomUUID(),
      content: {
        type: "message",
        text: "After real consent transport",
        conversation: group.id,
        groupEpoch: joined.group.head.id,
        groupAudience: "epoch",
      },
      recipients: [alice.id],
    });
    await until(
      () => a.call("state"),
      (v) => v.objects.some((o: any) => o.id === sent.id),
    );
    const left = await command(b, {
      action: "leave",
      operationId: randomUUID(),
      groupId: group.id,
    });
    assert.equal(left.group.locallyLeft, true);
    await until(
      () => command(a, { action: "notice-list" }),
      (v) =>
        v.notices.some(
          (e: any) =>
            e.notice.kind === "leave" &&
            e.notice.certificate.id === left.operation.certificate.id,
        ),
    );
    await assert.rejects(() =>
      b.call("send", {
        operationId: randomUUID(),
        content: {
          type: "message",
          text: "Must not send after leaving",
          conversation: group.id,
          groupEpoch: joined.group.head.id,
          groupAudience: "epoch",
        },
        recipients: [alice.id],
      }),
    );
    assert.equal(
      (await command(a, { action: "notice-outbox" })).notices.length,
      0,
      "membership change did not retire obsolete outgoing invitations",
    );
    for (const client of [a, b])
      assert.equal(
        (await client.call("state")).objects.some(
          (o: any) => o.kind === "group-notice",
        ),
        false,
      );
  } finally {
    await a.stop();
    await b.stop();
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
}
