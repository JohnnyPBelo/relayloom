import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createIdentity,
  decryptBundle,
  verifyBundle,
} from "../../packages/core/src/index.js";
import { messagingPair } from "./group-send.js";
import { until } from "../helpers.js";

export async function groupEventsJourney(
  creator: "node" | "native",
  reader: "node" | "native",
) {
  const f = await messagingPair(creator, reader);
  try {
    const sent = await f.a.call("send", {
      operationId: randomUUID(),
      content: {
        type: "message",
        text: "Original group message",
        conversation: f.groupId,
        groupEpoch: f.epoch,
        groupAudience: "epoch",
      },
      recipients: [f.bob.id],
      ttlMs: 600000,
    });
    await f.a.call("connect", { host: "127.0.0.1", port: f.b.tcpPort });
    await until(
      () => f.b.call("state"),
      (s) => s.objects.some((o: any) => o.id === sent.id),
    );
    const content = {
      conversation: f.groupId,
      groupEpoch: f.epoch,
      targetEpoch: f.epoch,
      target: sent.id,
      groupAudience: "target",
    };
    for (const payload of [
      { type: "edit", text: "Forged owner edit" },
      {
        type: "reaction",
        emoji: "heart",
        value: true,
        members: [f.alice, f.bob],
      },
      { type: "reaction", emoji: "heart", value: true, attachments: [] },
    ])
      await assert.rejects(() =>
        f.b.call("publish", {
          content: { ...content, ...payload },
          recipients: [f.alice.id],
        }),
      );
    await assert.rejects(() =>
      f.b.call("publish", {
        content: { ...content, type: "reaction", emoji: "heart", value: true },
        recipients: "public",
      }),
    );
    const reaction = await f.b.call("publish", {
      content: { ...content, type: "reaction", emoji: "heart", value: true },
      recipients: [f.alice.id],
    });
    const comment = await f.b.call("publish", {
      content: {
        ...content,
        type: "comment",
        text: "A reader can comment without becoming the author.",
      },
      recipients: [f.alice.id],
    });
    const edit = await f.a.call("publish", {
      content: {
        ...content,
        type: "edit",
        text: "The owner's corrected message",
      },
      recipients: [f.bob.id],
    });
    await until(
      () => f.a.call("state"),
      (s) =>
        [reaction.id, comment.id].every((id) =>
          s.objects.some((o: any) => o.id === id),
        ),
    );
    const edited = await until(
      () => f.b.call("state"),
      (s) =>
        s.objects.some(
          (o: any) =>
            o.id === sent.id &&
            o.editedText === "The owner's corrected message",
        ),
    );
    assert.equal(
      edited.objects.find((o: any) => o.id === sent.id).author.id,
      f.alice.id,
    );
    for (const event of [reaction, comment, edit]) {
      const full = await f.a.call("view", { id: event.id });
      assert.equal(full.content.groupEpoch, f.epoch);
      assert.deepEqual([...full.readers].sort(), [f.alice.id, f.bob.id].sort());
      const bundle = JSON.parse(
        readFileSync(
          join(f.a.dir, "store", "objects", event.id + ".json"),
          "utf8",
        ),
      );
      verifyBundle(bundle);
      assert.throws(() =>
        decryptBundle(bundle, createIdentity("Outside the group")),
      );
    }
    const closed = await f.command(f.a, {
      action: "close",
      operationId: randomUUID(),
      groupId: f.groupId,
      expected: f.epoch,
    });
    await f.command(f.b, {
      action: "headers",
      groupId: f.groupId,
      headers: [closed.group.head],
    });
    await assert.rejects(() =>
      f.a.call("publish", {
        content: {
          ...content,
          type: "edit",
          text: "Cannot send new content after closure",
        },
        recipients: [f.bob.id],
      }),
    );
    await assert.rejects(() =>
      f.b.call("publish", {
        content: { ...content, type: "reaction", emoji: "heart", value: false },
        recipients: [f.alice.id],
      }),
    );
    const removal = {
      type: "delete",
      target: sent.id,
      conversation: f.groupId,
      targetEpoch: f.epoch,
      groupAudience: "historical",
    };
    await assert.rejects(() =>
      f.b.call("publish", { content: removal, recipients: [f.alice.id] }),
    );
    await assert.rejects(() =>
      f.a.call("publish", {
        content: { ...removal, text: "Smuggled new text" },
        recipients: [f.bob.id],
      }),
    );
    const deleted = await f.a.call("publish", {
      content: removal,
      recipients: [f.bob.id],
    });
    await until(
      () => f.b.call("state"),
      (s) => s.objects.some((o: any) => o.id === sent.id && o.deleted),
    );
    assert.deepEqual(
      (await f.b.call("view", { id: deleted.id })).content,
      removal,
    );
    assert.equal((await f.a.call("state")).contacts.length, 0);
    assert.equal((await f.b.call("state")).contacts.length, 0);
    return {
      creator,
      reader,
      events: 4,
      readerCannotEditOrDelete: true,
      newContentDeniedAfterClose: true,
      historicalDelete: true,
    };
  } finally {
    await f.close();
  }
}
