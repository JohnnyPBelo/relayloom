import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createIdentity,
  createBundle,
  decryptBundle,
  verifyBundle,
  type Identity,
} from "../packages/core/src/index.js";
import { ProtectedGroupStore } from "../packages/groups/src/storage.js";
import { GroupRegistry } from "../packages/groups/src/registry.js";
import {
  GroupAccess,
  hasGroupBinding,
  parseGroupBinding,
  type AcceptedGroupContext,
  type GroupContentCandidate,
} from "../packages/groups/src/access.js";
import type {
  GroupConsent,
  GroupInvitation,
} from "../packages/groups/src/certificates.js";

import {
  fixture,
  enroll,
  sync,
  candidate,
  message,
  decide,
} from "./fixtures/group-access.js";

test("current and additions-only delayed messages preserve exact old readers without granting newcomer history", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    b = f.actor("Bruno"),
    c = f.actor("Carla"),
    id = a.registry.create(randomUUID(), "Group").groupId;
  enroll(a, b, id);
  const bundle = message(a, id),
    value = candidate(bundle, b.identity);
  assert.equal(decide(b, value).status, "accepted");
  enroll(a, c, id);
  sync(a, b, id);
  const late = decide(b, value);
  assert.equal(late.status, "accepted");
  if (late.status === "accepted") assert.equal(late.historical, true);
  assert.throws(() => decryptBundle(bundle, c.identity));
  const newcomerRetry = c.store.transaction((tx) =>
    GroupRegistry.inTransaction(tx, c.identity, (g) =>
      new GroupAccess(g, c.identity.public).retry(
        id,
        value.content.groupEpoch as string,
      ),
    ),
  ).value;
  assert.deepEqual(newcomerRetry, {
    allowed: false,
    terminal: true,
    reason: "group-invalid-original-author",
  });
  const widened = {
    ...value,
    readers: [...value.readers, c.identity.public.id],
  };
  assert.equal(decide(b, widened).status, "invalid");
});

test("removal and rejoin quarantine unseen old content while retaining only exact accepted history", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    b = f.actor("Bruno"),
    id = a.registry.create(randomUUID(), "Group").groupId;
  enroll(a, b, id);
  const value = candidate(message(a, id), b.identity),
    prior = decide(b, value);
  assert.equal(prior.status, "accepted");
  const original = a.registry.state(id).head!;
  a.registry.commit(randomUUID(), id, original.id, {
    title: "Removed",
    members: [a.identity.public],
    joins: [],
  });
  sync(a, b, id);
  assert.equal(decide(b, value).status, "quarantine");
  if (prior.status === "accepted") {
    assert.equal(decide(b, value, prior.context).status, "accepted");
    assert.equal(
      decide(b, value, { ...prior.context, author: b.identity.public.id })
        .status,
      "invalid",
    );
  }
  enroll(a, b, id);
  assert.equal(decide(b, value).status, "quarantine");
  const retry = b.store.transaction((tx) =>
    GroupRegistry.inTransaction(tx, b.identity, (g) =>
      new GroupAccess(g, b.identity.public).retry(id, original.id),
    ),
  ).value;
  assert.deepEqual(retry, {
    allowed: false,
    terminal: true,
    reason: "group-epoch-changed",
  });
});

test("historical receipts from a removed original reader are minimal and cannot admit an unknown target", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    b = f.actor("Bruno"),
    id = a.registry.create(randomUUID(), "Group").groupId;
  enroll(a, b, id);
  const head = a.registry.state(id).head!,
    cards = a.registry.privateState(id, head.id)!.members;
  const value = candidate(message(a, id), a.identity),
    prior = decide(a, value);
  assert.equal(prior.status, "accepted");
  a.registry.commit(randomUUID(), id, head.id, {
    title: "Removed",
    members: [a.identity.public],
    joins: [],
  });
  const content = {
    type: "receipt",
    conversation: id,
    target: value.id,
    targetEpoch: head.id,
    groupAudience: "historical",
  };
  const receipt = candidate(
    createBundle(b.identity, "receipt", content, cards),
    a.identity,
  );
  if (prior.status === "accepted") {
    assert.equal(
      decide(a, receipt, undefined, prior.context).status,
      "accepted",
    );
    assert.equal(decide(a, receipt).status, "invalid");
    const smuggled = candidate(
      createBundle(
        b.identity,
        "receipt",
        { ...content, text: "new content" },
        cards,
      ),
      a.identity,
    );
    assert.equal(
      decide(a, smuggled, undefined, prior.context).status,
      "invalid",
    );
  }
});

test("group tags cannot hide as falsy legacy fields and cached policy cannot escape its transaction", (t) => {
  for (const value of [
    { groupEpoch: null },
    { groupAudience: "" },
    { targetEpoch: false },
    {
      conversation: "a".repeat(64),
      groupAudience: ["epoch"],
      groupEpoch: "b".repeat(64),
      type: "message",
    },
    {
      conversation: "a".repeat(64),
      groupAudience: "epoch",
      groupEpoch: "b".repeat(64),
      type: ["message"],
    },
  ]) {
    assert.equal(hasGroupBinding(value), true);
    assert.throws(() => parseGroupBinding(value));
  }
  const f = fixture(t),
    a = f.actor("Alice"),
    id = a.registry.create(randomUUID(), "Group").groupId;
  assert.throws(
    () => new GroupAccess(a.registry, a.identity.public),
    /transacção/,
  );
  let escaped!: GroupAccess;
  a.store.transaction((tx) =>
    GroupRegistry.inTransaction(tx, a.identity, (g) => {
      escaped = new GroupAccess(g, a.identity.public);
      assert.equal(escaped.retry(id, g.state(id).head!.id).allowed, true);
    }),
  );
  assert.throws(
    () => escaped.retry(id, a.registry.state(id).head!.id),
    /encerrado/,
  );
});

test("a closure within the same transaction invalidates earlier cached permission", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    id = a.registry.create(randomUUID(), "Group").groupId;
  a.store.transaction((tx) =>
    GroupRegistry.inTransaction(tx, a.identity, (g) => {
      const access = new GroupAccess(g, a.identity.public),
        epoch = g.state(id).head!.id;
      assert.equal(access.retry(id, epoch).allowed, true);
      g.close(randomUUID(), id, epoch);
      assert.deepEqual(access.retry(id, epoch), {
        allowed: false,
        terminal: true,
        reason: "group-closed",
      });
    }),
  );
});

test("a new edit to old content uses only the original/current reader intersection", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    b = f.actor("Bruno"),
    c = f.actor("Carla"),
    id = a.registry.create(randomUUID(), "Group").groupId;
  enroll(a, b, id);
  const oldEpoch = a.registry.state(id).head!,
    oldCards = a.registry.privateState(id, oldEpoch.id)!.members;
  const original = message(a, id),
    target = decide(b, candidate(original, b.identity));
  assert.equal(target.status, "accepted");
  enroll(a, c, id);
  sync(a, b, id);
  const head = a.registry.state(id).head!,
    current = a.registry.privateState(id, head.id)!.members;
  const content = {
    type: "edit",
    text: "Only old readers may see this edit",
    conversation: id,
    groupAudience: "target",
    groupEpoch: head.id,
    targetEpoch: oldEpoch.id,
    target: original.manifest.id,
  };
  const edit = createBundle(a.identity, "edit", content, oldCards);
  if (target.status === "accepted") {
    assert.equal(
      decide(b, candidate(edit, b.identity), undefined, target.context).status,
      "accepted",
    );
    assert.throws(() => decryptBundle(edit, c.identity));
    const widened = createBundle(a.identity, "edit", content, current);
    assert.equal(
      decide(b, candidate(widened, b.identity), undefined, target.context)
        .status,
      "invalid",
    );
    const forgedAuthor = createBundle(b.identity, "edit", content, oldCards);
    assert.equal(
      decide(a, candidate(forgedAuthor, a.identity), undefined, target.context)
        .status,
      "invalid",
    );
  }
});
