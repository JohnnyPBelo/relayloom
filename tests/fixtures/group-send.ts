import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { launch, password, type Client } from "../helpers.js";

/** Every identity, invitation, consent and snapshot uses a production API.
 * The fixture transfers control proofs explicitly; automatic carriers remain
 * a separate requirement. No signing key or prebuilt intent is injected. */
export async function messagingPair(
  creator: "node" | "native" = "node",
  member: "node" | "native" = "node",
) {
  const clients: Client[] = [];
  const close = async () => {
    for (const client of clients) await client.stop();
    for (const client of clients)
      rmSync(client.dir, { recursive: true, force: true });
  };
  try {
    const a = await launch(undefined, 0, 0, creator);
    clients.push(a);
    const b = await launch(undefined, 0, 0, member);
    clients.push(b);
    const alice = await a.call("setup", { name: "Group sender", password });
    const bob = await b.call("setup", { name: "Group reader", password });
    const command = (client: Client, body: unknown) =>
      client.call("group-command", body);
    const created = await command(a, {
      action: "create",
      operationId: randomUUID(),
      title: "Actual group messages",
    });
    const groupId = created.group.id,
      parent = created.group.head;
    const proof = await command(a, { action: "proofs", groupId, from: 0 });
    const invitation = (
      await command(a, {
        action: "invite",
        operationId: randomUUID(),
        groupId,
        expected: parent.id,
        card: bob,
      })
    ).operation.certificate;
    await command(b, {
      action: "remember",
      operationId: randomUUID(),
      anchor: proof.anchor,
      parent,
      invitation,
    });
    await command(b, { action: "headers", groupId, headers: proof.headers });
    const consent = (
      await command(b, {
        action: "accept",
        operationId: randomUUID(),
        groupId,
        expected: parent.id,
      })
    ).operation.certificate;
    const joined = await command(a, {
      action: "commit",
      operationId: randomUUID(),
      groupId,
      expected: parent.id,
      title: "Actual group messages",
      members: [alice, bob],
      joins: [consent],
    });
    const epoch = joined.group.head.id;
    const snapshot = (
      await command(a, { action: "private-state", groupId, epochId: epoch })
    ).snapshot;
    await command(b, {
      action: "headers",
      groupId,
      headers: [joined.group.head],
    });
    await command(b, { action: "snapshot", groupId, epochId: epoch, snapshot });
    return { a, b, alice, bob, groupId, epoch, snapshot, command, close };
  } catch (error) {
    await close();
    throw error;
  }
}
