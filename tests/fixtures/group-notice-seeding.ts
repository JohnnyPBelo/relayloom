import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { importVault } from "../../packages/core/src/index.js";
import { openGroupNotice } from "../../packages/groups/src/notices.js";
import { launch, password, until, type Client } from "../helpers.js";
import { assertOffline, tcpOutcome } from "./offline-process.js";

export async function groupNoticeSeeding(
  issuer: "node" | "native",
  reader: "node" | "native",
) {
  const clients: Client[] = [];
  const start = async (backend: "node" | "native", dir?: string) => {
    const c = await launch(dir, 0, 0, backend);
    clients.push(c);
    return c;
  };
  const command = (c: Client, body: unknown) => c.call("group-command", body);
  const storedNotices = (c: Client) =>
    readdirSync(join(c.dir, "store", "objects"))
      .filter((name) => name.endsWith(".json"))
      .map((name) =>
        JSON.parse(readFileSync(join(c.dir, "store", "objects", name), "utf8")),
      )
      .filter((b) => b.manifest.kind === "group-notice");
  try {
    let a = await start(issuer);
    const relay = await start("node");
    let c = await start(reader);
    const alice = await a.call("setup", {
      name: "Offline invitation author",
      password,
    });
    await relay.call("setup", { name: "Opaque invitation seeder", password });
    const carla = await c.call("setup", {
      name: "Offline consent author",
      password,
    });
    await a.call("connect", { host: "127.0.0.1", port: relay.tcpPort });
    const group = (
      await command(a, {
        action: "create",
        operationId: randomUUID(),
        title: "Offline notice route",
      })
    ).group;
    const issued = await command(a, {
      action: "invite",
      operationId: randomUUID(),
      groupId: group.id,
      expected: group.head.id,
      card: carla,
    });
    await until(
      async () => storedNotices(relay),
      (values) => values.some((v) => v.manifest.author.id === alice.id),
    );
    assert.deepEqual(
      (await command(c, { action: "notice-list" })).notices,
      [],
      "isolated invitee received without a path",
    );
    assert.equal(await tcpOutcome(a.tcpPort), "CONNECTED");
    await a.stop();
    await assertOffline(a);
    await c.call("connect", { host: "127.0.0.1", port: relay.tcpPort });
    const inbox = await until(
      () => command(c, { action: "notice-list" }),
      (result) =>
        result.notices.some(
          (e: any) =>
            e.notice.certificate.id === issued.operation.certificate.id,
        ),
    );
    assert.equal(inbox.notices[0].notice.anchor.body.creator.id, alice.id);
    assert.deepEqual((await command(c, { action: "list" })).groups, []);
    const opened = await command(c, {
      action: "notice-open",
      operationId: randomUUID(),
      id: issued.operation.certificate.id,
    });
    assert.equal(
      opened.group.head?.id,
      group.head.id,
      "the invitation already contains the complete birth header",
    );
    const accepted = await command(c, {
      action: "accept",
      operationId: randomUUID(),
      groupId: group.id,
      expected: group.head.id,
    });
    await until(
      async () => storedNotices(relay),
      (values) => values.some((v) => v.manifest.author.id === carla.id),
    );
    assert.equal(await tcpOutcome(c.tcpPort), "CONNECTED");
    await c.stop();
    await assertOffline(c);
    a = await start(issuer, a.dir);
    await a.call("unlock", { password });
    await a.call("connect", { host: "127.0.0.1", port: relay.tcpPort });
    const replies = await until(
      () => command(a, { action: "notice-list" }),
      (result) =>
        result.notices.some(
          (e: any) =>
            e.notice.certificate.id === accepted.operation.certificate.id,
        ),
    );
    const consent = replies.notices.find(
      (e: any) => e.notice.kind === "consent",
    ).notice.certificate;
    const joined = await command(a, {
      action: "commit",
      operationId: randomUUID(),
      groupId: group.id,
      expected: group.head.id,
      title: "Both authors recovered",
      members: [alice, carla],
      joins: [consent],
    });
    c = await start(reader, c.dir);
    await c.call("unlock", { password });
    await c.call("connect", { host: "127.0.0.1", port: relay.tcpPort });
    await until(
      () => command(c, { action: "state", groupId: group.id }),
      (result) =>
        result.group.status === "active" &&
        result.group.head.id === joined.group.head.id,
      25000,
    );
    const sent = await c.call("send", {
      operationId: randomUUID(),
      content: {
        type: "message",
        text: "After both offline notice takeovers",
        conversation: group.id,
        groupEpoch: joined.group.head.id,
        groupAudience: "epoch",
      },
      recipients: [alice.id],
    });
    await until(
      () => a.call("state"),
      (result) => result.objects.some((o: any) => o.id === sent.id),
    );
    assert.deepEqual((await command(relay, { action: "list" })).groups, []);
    const relayIdentity = importVault(
      (await relay.call("export", { password })).vault,
      password,
    );
    for (const bundle of storedNotices(relay))
      assert.throws(
        () => openGroupNotice(bundle, relayIdentity),
        "opaque relay acquired notice plaintext",
      );
  } finally {
    for (const client of clients) await client.stop();
    for (const dir of new Set(clients.map((c) => c.dir)))
      rmSync(dir, { recursive: true, force: true });
  }
}
