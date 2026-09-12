import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { launch, password, type Client } from "../helpers.js";

export async function groupMembershipJourney(
  creatorBackend: "node" | "native",
  memberBackend: "node" | "native",
  restartBackend: "node" | "native" = memberBackend,
) {
  const a = await launch(undefined, 0, 0, creatorBackend),
    b = await launch(undefined, 0, 0, memberBackend);
  let restored: Client | undefined;
  const call = (client: Client, body: unknown) =>
    client.call("group-command", body);
  try {
    const unauthorized = await fetch(a.url + "/api/group-command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list" }),
    });

    assert.equal(unauthorized.status, 401);
    await unauthorized.arrayBuffer();
    const alice = await a.call("setup", { name: "Alice", password }),
      bruno = await b.call("setup", { name: "Bruno", password });
    const operation = randomUUID(),
      created = await call(a, {
        action: "create",
        operationId: operation,
        title: "Private runtime group",
      });
    assert.equal(created.group.status, "active");
    assert.equal(created.group.creator.id, alice.id);
    assert.deepEqual(
      (
        await call(a, {
          action: "create",
          operationId: operation,
          title: "Private runtime group",
        })
      ).operation,
      created.operation,
    );
    const id = created.group.id,
      parent = created.group.head;
    const invitation = (
      await call(a, {
        action: "invite",
        operationId: randomUUID(),
        groupId: id,
        expected: parent.id,
        card: bruno,
      })
    ).operation.certificate;
    const proof = await call(a, {
      action: "proofs",
      groupId: id,
      from: 0,
      count: 1,
    });
    await assert.rejects(
      call(b, { action: "headers", groupId: id, headers: proof.headers }),
    );
    assert.equal(
      (await call(b, { action: "list" })).groups.length,
      0,
      "unknown hints do not enroll groups",
    );
    await assert.rejects(
      call(b, {
        action: "remember",
        operationId: randomUUID(),
        anchor: proof.anchor,
        parent,
        invitation: { ...invitation, ignored: true },
      }),
    );
    assert.equal((await call(b, { action: "list" })).groups.length, 0);
    await call(b, {
      action: "remember",
      operationId: randomUUID(),
      anchor: proof.anchor,
      parent,
      invitation,
    });
    await call(b, { action: "headers", groupId: id, headers: proof.headers });
    const consent = (
      await call(b, {
        action: "accept",
        operationId: randomUUID(),
        groupId: id,
        expected: parent.id,
      })
    ).operation.certificate;
    assert.notEqual(
      (await call(b, { action: "state", groupId: id })).group.status,
      "active",
    );
    await assert.rejects(
      call(b, {
        action: "close",
        operationId: randomUUID(),
        groupId: id,
        expected: parent.id,
      }),
    );
    const commit = {
      action: "commit",
      operationId: randomUUID(),
      groupId: id,
      expected: parent.id,
      title: "Joined runtime group",
      members: [alice, bruno],
      joins: [consent],
    };
    await assert.rejects(
      call(a, {
        ...commit,
        joins: [{ ...consent, signature: Buffer.alloc(64).toString("base64") }],
      }),
    );
    await assert.rejects(call(a, { ...commit, joins: [] }));
    const joined = await call(a, commit);
    assert.deepEqual(
      (await call(a, commit)).operation,
      joined.operation,
      "replay uses original operation even after the head advanced",
    );
    await assert.rejects(call(a, { ...commit, title: "Mismatched repeat" }));
    await call(b, {
      action: "headers",
      groupId: id,
      headers: [joined.group.head],
    });
    assert.notEqual(
      (await call(b, { action: "state", groupId: id })).group.status,
      "active",
    );
    const snapshot = (
      await call(a, {
        action: "private-state",
        groupId: id,
        epochId: joined.group.head.id,
      })
    ).snapshot;
    await assert.rejects(
      call(b, {
        action: "snapshot",
        groupId: id,
        epochId: joined.group.head.id,
        snapshot: { ...snapshot, title: "Altered snapshot" },
      }),
    );
    await assert.rejects(
      call(b, {
        action: "snapshot",
        groupId: id,
        epochId: joined.group.head.id,
        snapshot: { ...snapshot, ignored: true },
      }),
    );
    await call(b, {
      action: "snapshot",
      groupId: id,
      epochId: joined.group.head.id,
      snapshot,
    });
    assert.equal(
      (await call(b, { action: "state", groupId: id })).group.status,
      "active",
    );
    assert.equal(
      readFileSync(join(b.dir, "profile-state.sqlite")).includes(
        Buffer.from("Joined runtime group"),
      ),
      false,
    );
    await assert.rejects(
      call(b, { action: "resume", groupId: id }),
      /capacidade/,
    );
    assert.equal(
      (await call(b, { action: "state", groupId: id })).group.status,
      "active",
    );
    const leaving = { action: "leave", groupId: id, operationId: randomUUID() };
    const left = await call(b, leaving);
    assert.equal(left.group.status, "left");
    assert.deepEqual((await call(b, leaving)).operation, left.operation);
    const removed = await call(a, {
      action: "commit",
      groupId: id,
      operationId: randomUUID(),
      expected: joined.group.head.id,
      title: "Removed",
      members: [alice],
      joins: [],
    });
    await call(b, {
      action: "headers",
      groupId: id,
      headers: [removed.group.head],
    });
    assert.equal(
      (await call(b, { action: "state", groupId: id })).group.status,
      "left",
    );
    const reInvitation = (
      await call(a, {
        action: "invite",
        groupId: id,
        operationId: randomUUID(),
        expected: removed.group.head.id,
        card: bruno,
      })
    ).operation.certificate;
    await call(b, {
      action: "remember",
      operationId: randomUUID(),
      anchor: proof.anchor,
      parent: removed.group.head,
      invitation: reInvitation,
    });
    const reConsent = (
      await call(b, {
        action: "accept",
        operationId: randomUUID(),
        groupId: id,
        expected: removed.group.head.id,
      })
    ).operation.certificate;
    assert.notEqual(reConsent.body.joinNonce, consent.body.joinNonce);
    const reCommit = {
      action: "commit",
      groupId: id,
      operationId: randomUUID(),
      expected: removed.group.head.id,
      title: "Rejoined",
      members: [alice, bruno],
      joins: [reConsent],
    };
    await assert.rejects(call(a, { ...reCommit, joins: [consent] }));
    const rejoined = await call(a, reCommit);
    await call(b, {
      action: "headers",
      groupId: id,
      headers: [rejoined.group.head],
    });
    const reSnapshot = (
      await call(a, {
        action: "private-state",
        groupId: id,
        epochId: rejoined.group.head.id,
      })
    ).snapshot;
    await call(b, {
      action: "snapshot",
      groupId: id,
      epochId: rejoined.group.head.id,
      snapshot: reSnapshot,
    });
    assert.equal(
      (await call(b, { action: "state", groupId: id })).group.status,
      "active",
    );
    const closed = await call(a, {
      action: "close",
      operationId: randomUUID(),
      groupId: id,
      expected: rejoined.group.head.id,
    });
    const invalid = {
      ...closed.group.head,
      signature: Buffer.alloc(64).toString("base64"),
    };
    await assert.rejects(
      call(b, {
        action: "headers",
        groupId: id,
        headers: Array(17).fill(closed.group.head),
      }),
    );
    assert.equal(
      (await call(b, { action: "state", groupId: id })).group.status,
      "active",
      "an oversized page adopts no prefix",
    );
    for (const tail of [
      invalid,
      { ...closed.group.head, ignored: true },
      {
        ...closed.group.head,
        body: { ...closed.group.head.body, number: "2" },
      },
      null,
    ]) {
      const refused = await call(b, {
        action: "headers",
        groupId: id,
        headers: [tail, closed.group.head],
      });
      assert.equal(refused.observation.accepted, 0);
      assert.ok(refused.observation.rejected);
      assert.equal(
        refused.observation.status.status,
        "active",
        "invalid first item must not jump to a later restriction",
      );
    }
    const partial = await call(b, {
      action: "headers",
      groupId: id,
      headers: [closed.group.head, invalid],
    });
    assert.equal(partial.observation.status.status, "closed");
    assert.equal(partial.observation.accepted, 1);
    assert.ok(partial.observation.rejected);
    await b.stop();
    restored = await launch(b.dir, 0, 0, restartBackend);
    await assert.rejects(call(restored, { action: "list" }));
    await restored.call("unlock", { password });
    assert.equal(
      (await call(restored, { action: "state", groupId: id })).group.status,
      "closed",
    );
    assert.equal(
      (await call(restored, { action: "list" })).messaging,
      false,
      "management is not advertised as completed dynamic messaging",
    );
  } finally {
    await a.stop();
    await b.stop();
    await restored?.stop();
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
}
