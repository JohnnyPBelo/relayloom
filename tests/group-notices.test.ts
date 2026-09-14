import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  canonical,
  createBundle,
  verifyBundle,
} from "../packages/core/src/index.js";
import {
  acceptGroupInvitation,
  createGroupInvitation,
  createGroupLeave,
  type GroupInvitation,
} from "../packages/groups/src/certificates.js";
import { GroupRegistry } from "../packages/groups/src/registry.js";
import { ProtectedGroupStore } from "../packages/groups/src/storage.js";
import {
  GroupNotices,
  NOTICE_LIMITS,
  openGroupNotice,
  sealGroupNotice,
  verifyGroupNotice,
  type GroupNotice,
} from "../packages/groups/src/notices.js";
import { enroll, fixture, type Actor } from "./fixtures/group-access.js";

function invitation(
  a: Actor,
  b: Actor,
  groupId: string,
): Extract<GroupNotice, { kind: "invitation" }> {
  const anchor = a.registry.anchor(groupId),
    parent = a.registry.state(groupId).head!;
  return {
    type: "group-notice",
    version: 1,
    kind: "invitation",
    anchor,
    parent,
    member: b.identity.public,
    certificate: createGroupInvitation(
      a.identity,
      anchor,
      parent,
      b.identity.public,
    ),
  };
}
function journal<T>(a: Actor, fn: (n: GroupNotices) => T) {
  return a.store.transaction((tx) =>
    fn(new GroupNotices(tx, a.identity.public)),
  );
}

test("private notices bind invitation, consent and leave without conferring signing ownership or local admission", (t) => {
  const f = fixture(t),
    a = f.actor("Issuer"),
    b = f.actor("Invited"),
    c = f.actor("Outside");
  const id = a.registry.create(randomUUID(), "C2 notice proof").groupId,
    value = invitation(a, b, id);
  const bundle = sealGroupNotice(a.identity, value);
  assert.deepEqual(openGroupNotice(bundle, b.identity), value);
  assert.throws(() => openGroupNotice(bundle, c.identity));
  const widened = createBundle(
    a.identity,
    "group-notice",
    value,
    [b.identity.public, c.identity.public],
    NOTICE_LIMITS.ttl,
  );
  verifyBundle(widened);
  assert.throws(() => openGroupNotice(widened, b.identity), /destinatários/);
  const impostor = createBundle(
    c.identity,
    "group-notice",
    value,
    [a.identity.public, b.identity.public],
    NOTICE_LIMITS.ttl,
  );
  verifyBundle(impostor);
  assert.throws(() => openGroupNotice(impostor, b.identity), /emissor/);
  assert.throws(() => sealGroupNotice(b.identity, value), /emissor/);
  const consent: GroupNotice = {
    ...value,
    kind: "consent",
    invitation: value.certificate,
    certificate: acceptGroupInvitation(
      b.identity,
      value.anchor,
      value.parent,
      value.certificate,
    ),
  };
  const reply = sealGroupNotice(b.identity, consent);
  assert.deepEqual(openGroupNotice(reply, a.identity), consent);
  assert.throws(
    () =>
      verifyGroupNotice({
        ...consent,
        invitation: invitation(a, b, id).certificate,
      }),
    /corresponde/,
  );
  assert.equal(
    journal(b, (n) => n.save("in", value)),
    "stored",
  );
  assert.equal(
    b.registry.list().length,
    0,
    "inbox silently enrolled the recipient",
  );
  assert.throws(() => journal(c, (n) => n.save("in", value)), /outro perfil/);
  enroll(a, b, id);
  const parent = b.registry.state(id).head!;
  const leave: GroupNotice = {
    ...value,
    parent,
    kind: "leave",
    certificate: createGroupLeave(b.identity, value.anchor, parent),
  };
  assert.equal(
    openGroupNotice(sealGroupNotice(b.identity, leave), a.identity).kind,
    "leave",
  );
  assert.equal(
    b.registry.state(id).status,
    "active",
    "sealing a notice must not silently leave or mutate authority",
  );
});

test("invitation result and exact delivery card commit together and survive reopening encrypted SQLite", (t) => {
  const f = fixture(t),
    a = f.actor("C2-owner-sensitive-name"),
    b = f.actor("C2-private-recipient-name");
  const id = a.registry.create(randomUUID(), "Durable invitation").groupId,
    operation = randomUUID();
  const issue = (fail = false) =>
    a.store.transaction((tx) =>
      GroupRegistry.inTransaction(tx, a.identity, (g) => {
        const anchor = g.anchor(id),
          parent = g.state(id).head!;
        const result = g.invite(operation, id, parent.id, b.identity.public);
        const notice: GroupNotice = {
          type: "group-notice",
          version: 1,
          kind: "invitation",
          anchor,
          parent,
          member: b.identity.public,
          certificate: result.certificate as GroupInvitation,
        };
        const saved = new GroupNotices(tx, a.identity.public).save(
          "out",
          notice,
        );
        if (fail) throw new Error("fixture crash boundary before outer commit");
        return { result, notice, saved };
      }),
    ).value;
  assert.throws(() => issue(true), /fixture crash boundary/);
  assert.equal(a.registry.operationStatus(operation), null);
  assert.deepEqual(
    journal(a, (n) => n.list("out")),
    [],
  );
  const committed = issue(),
    repeated = issue();
  assert.equal(committed.saved, "stored");
  assert.equal(repeated.saved, "duplicate");
  assert.deepEqual(committed.result, repeated.result);
  const key = a.store.storeId();
  a.store.close();
  const reopened = new ProtectedGroupStore(a.path, a.identity, {
    expectedStoreId: key,
  });
  try {
    const pending = reopened.transaction((tx) =>
      new GroupNotices(tx, a.identity.public).list("out"),
    );
    assert.equal(pending.length, 1);
    assert.deepEqual(pending[0].notice.member, b.identity.public);
    assert.deepEqual(
      openGroupNotice(
        sealGroupNotice(a.identity, pending[0].notice),
        b.identity,
      ),
      committed.notice,
    );
    for (const secret of [
      a.identity.public.name,
      b.identity.public.name,
      committed.notice.certificate.id,
    ])
      assert.equal(
        readFileSync(a.path).includes(Buffer.from(secret)),
        false,
        "private notice material leaked in SQLite",
      );
  } finally {
    // The fixture's earlier after-hook removes the directory. Windows requires
    // this reopened SQLite handle to be closed before that hook runs.
    reopened.close();
  }
});

test("issuer quota, duplicate reads and dismissal replay memory stay bounded without changing group state", (t) => {
  const f = fixture(t),
    a = f.actor("Inviter"),
    b = f.actor("Recipient");
  const id = a.registry.create(randomUUID(), "Bounded inbox").groupId;
  const values = Array.from({ length: NOTICE_LIMITS.perIssuer + 1 }, () =>
    invitation(a, b, id),
  );
  for (const value of values.slice(0, -1))
    assert.equal(
      journal(b, (n) => n.save("in", value)),
      "stored",
    );
  assert.throws(
    () => journal(b, (n) => n.save("in", values.at(-1)!)),
    /emissor/,
  );
  const before = b.store.transaction((tx) => tx.indexBody().revision);
  assert.equal(
    journal(b, (n) => n.save("in", values[0])),
    "duplicate",
  );
  assert.equal(
    b.store.transaction((tx) => tx.indexBody().revision),
    before,
  );
  b.store.transaction((tx) => {
    const n = new GroupNotices(tx, b.identity.public);
    assert.equal(n.retire("in", values[0].certificate.id), true);
    assert.equal(n.save("in", values[0]), "retired");
    assert.equal(n.save("in", values.at(-1)!), "stored");
    assert.equal(n.list("in").length, NOTICE_LIMITS.perIssuer);
  });
  assert.equal(b.registry.list().length, 0);
  let escaped: GroupNotices;
  b.store.transaction((tx) => {
    escaped = new GroupNotices(tx, b.identity.public);
  });
  assert.throws(() => escaped!.list("in"), /terminada/);
});

test("finite notice history retires oldest entries without making a replay local consent", (t) => {
  const f = fixture(t),
    a = f.actor("History inviter"),
    b = f.actor("History recipient");
  const id = a.registry.create(randomUUID(), "Finite history").groupId;
  const values = Array.from({ length: NOTICE_LIMITS.retired + 1 }, () =>
    invitation(a, b, id),
  );
  b.store.transaction((tx) => {
    const n = new GroupNotices(tx, b.identity.public);
    for (const value of values) {
      assert.equal(n.save("in", value), "stored");
      assert.equal(n.retire("in", value.certificate.id), true);
    }
    assert.deepEqual(n.list("in"), []);
    const retired = JSON.parse(tx.get("group-notice:retired")!.toString());
    assert.equal(retired.items.length, NOTICE_LIMITS.retired);
    assert.equal(n.save("in", values.at(-1)!), "retired");
    assert.equal(
      n.save("in", values[0]),
      "stored",
      "retirement is finite, not a permanent blacklist",
    );
  });
  assert.equal(b.registry.list().length, 0);
});

test("authenticated malformed notice metadata aborts the outer transaction even if its error is caught", (t) => {
  const f = fixture(t),
    a = f.actor("Corruption owner"),
    b = f.actor("Corruption recipient");
  const id = a.registry.create(randomUUID(), "Integrity").groupId,
    value = invitation(a, b, id);
  journal(b, (n) => n.save("in", value));
  const storeId = b.store.storeId();
  assert.throws(
    () =>
      b.store.transaction((tx) => {
        const key = "group-notice:in:" + value.certificate.id;
        const entry = JSON.parse(tx.get(key)!.toString());
        entry.direction = "out";
        tx.put(key, Buffer.from(canonical(entry)));
        try {
          new GroupNotices(tx, b.identity.public).list("in");
        } catch {}
        tx.put("must-not-commit", Buffer.from("unsafe swallowed error"));
      }),
    /aviso inválido/,
  );
  b.store.close();
  const reopened = new ProtectedGroupStore(b.path, b.identity, {
    expectedStoreId: storeId,
  });
  try {
    reopened.transaction((tx) => {
      assert.equal(tx.get("must-not-commit"), undefined);
      assert.equal(
        new GroupNotices(tx, b.identity.public).list("in").length,
        1,
      );
    });
  } finally {
    reopened.close();
  }
});

test("failed dismissal cannot lose an invitation when the caller swallows the write error", (t) => {
  const f = fixture(t),
    a = f.actor("Dismissal issuer"),
    b = f.actor("Dismissal reader");
  const id = a.registry.create(randomUUID(), "Dismissal").groupId,
    value = invitation(a, b, id);
  journal(b, (n) => n.save("in", value));
  assert.throws(
    () =>
      b.store.transaction((tx) => {
        const original = tx.put.bind(tx);
        tx.put = (key, bytes, storageClass) => {
          if (key === "group-notice:retired")
            throw new Error("fixture dismissal write failed");
          return original(key, bytes, storageClass);
        };
        try {
          new GroupNotices(tx, b.identity.public).retire(
            "in",
            value.certificate.id,
          );
        } catch {}
        tx.put("unsafe-dismissal", Buffer.from("must roll back"));
      }),
    /fixture dismissal write failed/,
  );
  b.store.transaction((tx) => {
    assert.equal(tx.get("unsafe-dismissal"), undefined);
    assert.equal(tx.get("group-notice:retired"), undefined);
    assert.equal(new GroupNotices(tx, b.identity.public).list("in").length, 1);
  });
});
