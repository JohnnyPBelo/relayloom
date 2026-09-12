import test from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, randomUUID, sign } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { fork, type ChildProcess } from "node:child_process";
import { join, resolve } from "node:path";
import {
  canonical,
  createBundle,
  createIdentity,
  decryptBundle,
  hash,
  type Identity,
} from "../packages/core/src/index.js";
import {
  createGroupSuccessor,
  verifyGroupEpoch,
  type GroupConsent,
  type GroupEpoch,
  type GroupInvitation,
} from "../packages/groups/src/certificates.js";
import {
  ProtectedGroupStore,
  type RegistryLimits,
} from "../packages/groups/src/storage.js";
import {
  AUTHORITY_LIMITS,
  GroupRegistry,
} from "../packages/groups/src/registry.js";

function fixture(t: any) {
  const root = resolve(".cache/group-registry");
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "case-")),
    stores: ProtectedGroupStore[] = [];
  const children: { child: ChildProcess; done: Promise<unknown> }[] = [];
  t.after(async () => {
    for (const owned of children) {
      if (owned.child.exitCode === null && owned.child.signalCode === null)
        owned.child.kill("SIGKILL");
      await owned.done.catch(() => {});
    }
    for (const s of stores) s.close();
    rmSync(directory, { recursive: true, force: true });
  });
  function actor(name: string, limits?: RegistryLimits) {
    const identity = createIdentity(name),
      path = join(directory, name + ".sqlite");
    let store = new ProtectedGroupStore(path, identity, {
      create: true,
      ...(limits ? { limits } : {}),
    });
    stores.push(store);
    const pinnedStoreId = store.storeId();
    let registry = new GroupRegistry(store, identity);
    return {
      identity,
      path,
      track(child: ChildProcess, done: Promise<unknown>) {
        children.push({ child, done });
      },
      get store() {
        return store;
      },
      get registry() {
        return registry;
      },
      reopen() {
        store.close();
        store = new ProtectedGroupStore(path, identity, {
          expectedStoreId: pinnedStoreId,
        });
        stores.push(store);
        registry = new GroupRegistry(store, identity);
      },
    };
  }
  return { actor, directory };
}
type Actor = ReturnType<ReturnType<typeof fixture>["actor"]>;
function head(actor: Actor, id: string) {
  return actor.registry.state(id).head!;
}
function prepare(a: Actor, b: Actor, id: string) {
  const parent = head(a, id),
    invitation = a.registry.invite(
      randomUUID(),
      id,
      parent.id,
      b.identity.public,
    ).certificate as GroupInvitation;
  b.registry.rememberInvitation(
    randomUUID(),
    a.registry.anchor(id),
    parent,
    invitation,
  );
  for (let from = 0; from <= parent.body.number; from += 16)
    b.registry.observeHeaders(id, a.registry.proofs(id, from));
  const operation = randomUUID(),
    consent = b.registry.accept(operation, id, parent.id)
      .certificate as GroupConsent;
  return { parent, invitation, consent, operation };
}
function joinMember(a: Actor, b: Actor, id: string) {
  const p = prepare(a, b, id),
    before = a.registry.privateState(id, p.parent.id)!;
  const result = a.registry.commit(randomUUID(), id, p.parent.id, {
    title: before.title,
    members: [...before.members, b.identity.public],
    joins: [p.consent],
  });
  b.registry.observeHeaders(id, [head(a, id)]);
  b.registry.observeSnapshot(
    id,
    result.epochId!,
    a.registry.privateState(id, result.epochId!)!,
  );
  return { ...p, epoch: head(a, id) };
}
function signed(identity: Identity, body: GroupEpoch["body"]): GroupEpoch {
  const text = canonical(body);
  return {
    body,
    id: hash(text),
    signature: sign(
      null,
      Buffer.from(text),
      createPrivateKey({
        key: Buffer.from(identity.signSecret, "base64"),
        format: "der",
        type: "pkcs8",
      }),
    ).toString("base64"),
  };
}

test("creator state is encrypted, permanent and idempotent while its operation is retained", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    op = randomUUID();
  const created = a.registry.create(op, "Private river neighbourhood");
  assert.equal(a.registry.state(created.groupId).status, "active");
  const revision = a.store.accounting().revision;
  assert.deepEqual(
    a.registry.create(op, "Private river neighbourhood"),
    created,
  );
  assert.equal(a.store.accounting().revision, revision);
  assert.throws(
    () => a.registry.create(op, "Another operation"),
    /outro pedido/,
  );
  a.reopen();
  assert.deepEqual(
    a.registry.create(op, "Private river neighbourhood"),
    created,
  );
  assert.equal(
    a.registry.anchor(created.groupId).body.creator.id,
    a.identity.public.id,
  );
  assert.equal(a.registry.proofs(created.groupId, 0)[0].id, created.epochId);
  assert.equal(
    readFileSync(a.path).includes(Buffer.from("Private river neighbourhood")),
    false,
  );
});

test("explicit invitation needs complete ancestry and fresh consent before local membership", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    b = f.actor("Bruno"),
    id = a.registry.create(randomUUID(), "Ribeira").groupId;
  const parent = head(a, id),
    invitation = a.registry.invite(
      randomUUID(),
      id,
      parent.id,
      b.identity.public,
    ).certificate as GroupInvitation;
  b.registry.rememberInvitation(
    randomUUID(),
    a.registry.anchor(id),
    parent,
    invitation,
  );
  assert.equal(b.registry.state(id).status, "awaiting-proof");
  assert.throws(() => b.registry.accept(randomUUID(), id, parent.id), /cadeia/);
  b.registry.observeHeaders(id, [parent]);
  const consent = b.registry.accept(randomUUID(), id, parent.id)
    .certificate as GroupConsent;
  assert.equal(b.registry.state(id).status, "joining");
  const oldSnapshot = a.registry.privateState(id, parent.id)!;
  const historical = createBundle(
    a.identity,
    "group-snapshot",
    oldSnapshot,
    oldSnapshot.members,
  );
  assert.throws(() => decryptBundle(historical, b.identity));
  const next = a.registry.commit(randomUUID(), id, parent.id, {
    title: "Com Bruno",
    members: [a.identity.public, b.identity.public],
    joins: [consent],
  });
  b.registry.observeHeaders(id, [head(a, id)]);
  assert.equal(b.registry.state(id).status, "joining");
  const current = a.registry.privateState(id, next.epochId!)!;
  b.registry.observeSnapshot(id, next.epochId!, current);
  assert.equal(b.registry.state(id).status, "active");
  assert.equal(b.registry.state(id).title, "Com Bruno");
  assert.equal(b.registry.privateState(id, parent.id), null);
  b.reopen();
  assert.equal(b.registry.state(id).status, "active");
  assert.throws(
    () =>
      b.registry.commit(randomUUID(), id, next.epochId!, {
        title: "Takeover",
        members: [b.identity.public],
        joins: [],
      }),
    /Só o criador/,
  );
});

test("unknown groups, invalid signer and signed orphan hints cannot allocate, advance or freeze authority", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    outsider = f.actor("Outsider"),
    id = a.registry.create(randomUUID(), "Ribeira").groupId;
  const parent = head(a, id),
    snapshot = a.registry.privateState(id, parent.id)!,
    anchor = a.registry.anchor(id);
  const next = createGroupSuccessor(a.identity, anchor, parent, snapshot, {
    title: "Next",
    members: snapshot.members,
    joins: [],
  }).epoch;
  assert.throws(
    () => outsider.registry.observeHeaders(id, [parent]),
    /não está registado/,
  );
  assert.equal(outsider.registry.list().length, 0);
  const forged = signed(outsider.identity, next.body),
    orphan = signed(a.identity, {
      ...next.body,
      number: 9,
      previous: "f".repeat(64),
    });
  assert.deepEqual(verifyGroupEpoch(orphan, anchor), orphan); // Genuine creator signature, unanchored path.
  const revision = a.store.accounting().revision;
  assert.throws(() => a.registry.observeHeaders(id, [forged]), /Assinatura/);
  assert.equal(a.registry.observeHeaders(id, [orphan]).missingProof, true);
  assert.equal(a.registry.observeHeaders(id, [parent, parent]).accepted, 0);
  assert.equal(a.store.accounting().revision, revision);
  assert.equal(a.registry.state(id).status, "active");
  assert.equal(head(a, id).id, parent.id);
});

test("an incumbent cannot skip an invalid intermediate membership snapshot", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    b = f.actor("Bruno"),
    id = a.registry.create(randomUUID(), "Before").groupId;
  const p = prepare(a, b, id),
    anchor = a.registry.anchor(id),
    before = a.registry.privateState(id, p.parent.id)!;
  const joined = createGroupSuccessor(a.identity, anchor, p.parent, before, {
    title: "Invalid intermediate",
    members: [a.identity.public, b.identity.public],
    joins: [p.consent],
  });
  const missing = { ...joined.snapshot, joins: [] };
  const bad = signed(a.identity, {
    ...joined.epoch.body,
    snapshotHash: hash(canonical(missing)),
  });
  const later = createGroupSuccessor(a.identity, anchor, bad, missing, {
    title: "Apparently valid later state",
    members: missing.members,
    joins: [],
  });
  a.registry.observeHeaders(id, [bad, later.epoch]);
  assert.throws(
    () => a.registry.observeSnapshot(id, bad.id, missing),
    /consentimentos/,
  );
  a.registry.observeSnapshot(id, later.epoch.id, later.snapshot);
  assert.equal(a.registry.state(id).status, "awaiting-snapshot");
  assert.throws(
    () =>
      a.registry.invite(
        randomUUID(),
        id,
        later.epoch.id,
        createIdentity("Clara").public,
      ),
    /verificar/,
  );
});

test("creator equivocation freezes durably; stale hints do not choose or erase a branch", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    id = a.registry.create(randomUUID(), "Ribeira").groupId;
  const anchor = a.registry.anchor(id),
    parent = head(a, id),
    snapshot = a.registry.privateState(id, parent.id)!;
  const alternative = createGroupSuccessor(
    a.identity,
    anchor,
    parent,
    snapshot,
    { title: "Other device", members: snapshot.members, joins: [] },
  ).epoch;
  const result = a.registry.commit(randomUUID(), id, parent.id, {
    title: "This device",
    members: snapshot.members,
    joins: [],
  });
  const adopted = head(a, id),
    frozen = a.registry.observeHeaders(id, [alternative]).status;
  assert.equal(frozen.status, "forked");
  assert.equal(frozen.head!.id, adopted.id);
  assert.deepEqual(
    new Set(frozen.stopEvidence.map((e) => e.id)),
    new Set([adopted.id, alternative.id]),
  );
  a.reopen();
  assert.equal(a.registry.state(id).status, "forked");
  assert.throws(
    () => a.registry.close(randomUUID(), id, result.epochId!),
    /suspenso/,
  );
  const revision = a.store.accounting().revision;
  assert.equal(a.registry.observeHeaders(id, [parent]).status.status, "forked");
  assert.equal(a.store.accounting().revision, revision);
});

test("local leave survives restart and old consent replay; reentry requires a new committed nonce", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    b = f.actor("Bruno"),
    id = a.registry.create(randomUUID(), "Ribeira").groupId;
  const joined = joinMember(a, b, id),
    oldSnapshot = a.registry.privateState(id, joined.epoch.id)!;
  const left = b.registry.leave(randomUUID(), id);
  assert.ok(left.certificate);
  assert.equal(b.registry.state(id).status, "left");
  assert.equal(head(b, id).body.members.length, 2);
  b.reopen();
  assert.equal(
    (
      b.registry.accept(joined.operation, id, joined.parent.id)
        .certificate as GroupConsent
    ).id,
    joined.consent.id,
  );
  assert.throws(
    () => b.registry.observeSnapshot(id, joined.epoch.id, oldSnapshot),
    /adesão local/,
  );
  assert.equal(b.registry.state(id).status, "left");
  assert.throws(
    () =>
      a.registry.invite(randomUUID(), id, joined.epoch.id, b.identity.public),
    /já faz parte/,
  );
  const removed = a.registry.commit(randomUUID(), id, joined.epoch.id, {
    title: "Ribeira",
    members: [a.identity.public],
    joins: [],
  });
  b.registry.observeHeaders(id, [head(a, id)]);
  const p = prepare(a, b, id);
  assert.notEqual(p.consent.body.joinNonce, joined.consent.body.joinNonce);
  const next = a.registry.commit(randomUUID(), id, removed.epochId!, {
    title: "Reentrada",
    members: [a.identity.public, b.identity.public],
    joins: [p.consent],
  });
  b.registry.observeHeaders(id, [head(a, id)]);
  b.registry.observeSnapshot(id, joined.epoch.id, oldSnapshot);
  assert.equal(b.registry.state(id).status, "left");
  b.registry.observeSnapshot(
    id,
    next.epochId!,
    a.registry.privateState(id, next.epochId!)!,
  );
  assert.equal(b.registry.state(id).status, "active");
  assert.equal(b.registry.state(id).locallyLeft, false);
});

test("a late join response cannot restore membership across a subsequent removal", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    b = f.actor("Bruno"),
    id = a.registry.create(randomUUID(), "Ribeira").groupId;
  const p = prepare(a, b, id);
  const joined = a.registry.commit(randomUUID(), id, p.parent.id, {
      title: "Ribeira",
      members: [a.identity.public, b.identity.public],
      joins: [p.consent],
    }),
    joinEpoch = head(a, id),
    joinSnapshot = a.registry.privateState(id, joined.epochId!)!;
  a.registry.commit(randomUUID(), id, joined.epochId!, {
    title: "After removal",
    members: [a.identity.public],
    joins: [],
  });
  b.registry.observeHeaders(id, [joinEpoch, head(a, id)]);
  b.registry.observeSnapshot(id, joined.epochId!, joinSnapshot);
  assert.notEqual(b.registry.state(id).status, "active");
  assert.equal(b.registry.state(id).pendingConsent, p.consent.id);
});

test("storage pressure persists a stop checkpoint instead of using an obsolete roster", (t) => {
  const f = fixture(t),
    a = f.actor("Alice", {
      totalBytes: 4 * 1024 ** 2 + 65536,
      reserveBytes: 4 * 1024 ** 2,
    }),
    id = a.registry.create(randomUUID(), "Ribeira").groupId;
  const parent = head(a, id),
    old = a.registry.privateState(id, parent.id)!,
    anchor = a.registry.anchor(id);
  const next = createGroupSuccessor(a.identity, anchor, parent, old, {
    title: "Verified next epoch",
    members: old.members,
    joins: [],
  }).epoch;
  // Fill only ordinary metadata; the four MiB checkpoint reserve stays intact.
  const available = 65536 - a.store.accounting().ordinaryBytes;
  a.store.transaction((tx) =>
    tx.put("capacity-fill", Buffer.alloc(available - 400)),
  );
  const result = a.registry.observeHeaders(id, [next]);
  assert.equal(result.status.status, "capacity");
  assert.equal(result.status.stopEvidence[0].id, next.id);
  assert.equal(head(a, id).id, parent.id);
  a.reopen();
  assert.equal(a.registry.state(id).status, "capacity");
  assert.throws(
    () =>
      a.registry.invite(
        randomUUID(),
        id,
        parent.id,
        createIdentity("New person").public,
      ),
    /suspenso/,
  );
});

test("closure and a stale expected parent cannot create a successor or bypass idempotency", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    id = a.registry.create(randomUUID(), "Ribeira").groupId,
    parent = head(a, id),
    before = a.registry.privateState(id, parent.id)!;
  const op = randomUUID(),
    next = a.registry.commit(op, id, parent.id, {
      title: "Next",
      members: before.members,
      joins: [],
    });
  assert.deepEqual(
    a.registry.commit(op, id, parent.id, {
      title: "Next",
      members: before.members,
      joins: [],
    }),
    next,
  );
  assert.throws(
    () =>
      a.registry.commit(randomUUID(), id, parent.id, {
        title: "Stale",
        members: before.members,
        joins: [],
      }),
    /desactualizada/,
  );
  a.registry.close(randomUUID(), id, next.epochId!);
  assert.equal(a.registry.state(id).status, "closed");
  a.reopen();
  assert.equal(a.registry.state(id).status, "closed");
  assert.throws(
    () =>
      a.registry.invite(
        randomUUID(),
        id,
        head(a, id).id,
        createIdentity("Bruno").public,
      ),
    /encerrado/,
  );
});

test("64 remembered groups are retained; capacity is not reset by closing them", (t) => {
  const f = fixture(t),
    a = f.actor("Alice");
  for (let i = 0; i < 64; i++) a.registry.create(randomUUID(), "Group " + i);
  const first = a.registry.list()[0];
  a.registry.close(randomUUID(), first.id, first.head!.id);
  assert.throws(() => a.registry.create(randomUUID(), "Overflow"), /64 grupos/);
  a.reopen();
  assert.equal(a.registry.list().length, 64);
  assert.equal(a.registry.state(first.id).status, "closed");
});

function worker(
  t: any,
  a: Actor,
  groupId: string,
  expected: string,
  operation: string,
  title: string,
  mode = "commit",
  marker = "",
) {
  const secret = a.path + ".worker-" + randomUUID() + ".json";
  writeFileSync(secret, JSON.stringify(a.identity), { mode: 0o600 });
  const child: ChildProcess = fork(
    resolve("tests/fixtures/group-registry-worker.ts"),
    [mode, a.path, secret, groupId, expected, operation, title, marker],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  let stderr = "",
    message: any;
  child.stderr!.on("data", (data) => {
    stderr = (stderr + data).slice(-8192);
  });
  let accept!: () => void, reject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, rejectReady) => {
    accept = resolve;
    reject = rejectReady;
  });
  void ready.catch(() => {});
  child.on("message", (value) => {
    if ((value as any).ready) accept();
    else message = value;
  });
  const done = new Promise<{
    code: number | null;
    message: any;
    stderr: string;
  }>((resolve, rejectDone) => {
    child.once("error", (error) => {
      reject(error);
      rejectDone(error);
    });
    child.once("close", (code) => {
      reject(new Error("worker ended before readiness"));
      resolve({ code, message, stderr });
    });
  });
  a.track(child, done);
  return { child, ready, done };
}

test(
  "two real creator processes use compare-and-set and cannot commit siblings in one registry",
  { timeout: 20000 },
  async (t) => {
    const f = fixture(t),
      a = f.actor("Alice"),
      id = a.registry.create(randomUUID(), "Initial").groupId,
      expected = head(a, id).id;
    const first = worker(t, a, id, expected, randomUUID(), "First"),
      second = worker(t, a, id, expected, randomUUID(), "Second");
    await Promise.all([first.ready, second.ready]);
    first.child.send({ go: true });
    second.child.send({ go: true });
    const results = await Promise.all([first.done, second.done]);
    for (const result of results) assert.equal(result.code, 0, result.stderr);
    assert.equal(results.filter((r) => r.message?.result).length, 1);
    assert.match(
      results.find((r) => r.message?.error)!.message.error,
      /desactualizada/,
    );
    a.reopen();
    assert.equal(head(a, id).body.number, 1);
    assert.equal(a.registry.state(id).status, "active");
  },
);

test(
  "real process crashes preserve atomic authority and the original operation after a lost response",
  { timeout: 20000 },
  async (t) => {
    const f = fixture(t),
      a = f.actor("Alice"),
      id = a.registry.create(randomUUID(), "Initial").groupId,
      expected = head(a, id).id;
    const operation = randomUUID(),
      marker = join(f.directory, "staged.txt");
    const before = worker(
      t,
      a,
      id,
      expected,
      operation,
      "After crash",
      "crash-before-commit",
      marker,
    );
    await before.ready;
    before.child.send({ go: true });
    const stopped = await before.done;
    assert.equal(stopped.code, 73, stopped.stderr);
    assert.equal(
      readFileSync(marker, "utf8"),
      "authority-and-operation-staged",
    );
    assert.equal(existsSync(a.path + "-journal"), true);
    a.reopen();
    assert.equal(head(a, id).id, expected);
    const lost = worker(
      t,
      a,
      id,
      expected,
      operation,
      "After crash",
      "lost-response",
      marker,
    );
    await lost.ready;
    lost.child.send({ go: true });
    const result = await lost.done;
    assert.equal(result.code, 74, result.stderr);
    const proof = JSON.parse(readFileSync(marker, "utf8"));
    assert.equal(proof.stage, "committed-before-response");
    a.reopen();
    const snapshot = a.registry.privateState(id, expected)!;
    const retried = a.registry.commit(operation, id, expected, {
      title: "After crash",
      members: snapshot.members,
      joins: [],
    });
    assert.equal(retried.epochId, proof.epochId);
    assert.equal(head(a, id).id, retried.epochId);
    assert.equal(head(a, id).body.number, 1);
  },
);

test("later snapshots wait for a missing intermediate state and activate after its verified arrival", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    b = f.actor("Bruno"),
    id = a.registry.create(randomUUID(), "Initial").groupId;
  const joined = joinMember(a, b, id),
    before = a.registry.privateState(id, joined.epoch.id)!;
  const second = a.registry.commit(randomUUID(), id, joined.epoch.id, {
      title: "Second",
      members: before.members,
      joins: [],
    }),
    e2 = head(a, id),
    s2 = a.registry.privateState(id, second.epochId!)!;
  const third = a.registry.commit(randomUUID(), id, second.epochId!, {
    title: "Third",
    members: before.members,
    joins: [],
  });
  b.registry.observeHeaders(id, [e2, head(a, id)]);
  b.registry.observeSnapshot(
    id,
    third.epochId!,
    a.registry.privateState(id, third.epochId!)!,
  );
  assert.equal(b.registry.state(id).status, "awaiting-snapshot");
  b.reopen();
  assert.equal(b.registry.state(id).status, "awaiting-snapshot");
  b.registry.observeSnapshot(id, e2.id, s2);
  assert.equal(b.registry.state(id).status, "active");
  assert.equal(b.registry.state(id).title, "Third");
});

test("capacity recovery adopts the exact stopped header and still needs its private state", (t) => {
  const f = fixture(t),
    a = f.actor("Alice", {
      totalBytes: 4 * 1024 ** 2 + 65536,
      reserveBytes: 4 * 1024 ** 2,
    }),
    id = a.registry.create(randomUUID(), "Before").groupId;
  const parent = head(a, id),
    before = a.registry.privateState(id, parent.id)!;
  const next = createGroupSuccessor(
    a.identity,
    a.registry.anchor(id),
    parent,
    before,
    {
      title: "After",
      members: before.members,
      joins: [],
    },
  );
  a.store.transaction((tx) =>
    tx.put(
      "capacity-fill",
      Buffer.alloc(65536 - tx.accounting().ordinaryBytes - 400),
    ),
  );
  assert.equal(
    a.registry.observeHeaders(id, [next.epoch]).status.status,
    "capacity",
  );
  const stopped = a.store.accounting().revision;
  assert.equal(a.registry.resumeCapacity(id).status, "capacity");
  assert.equal(a.store.accounting().revision, stopped);
  a.reopen();
  a.store.transaction((tx) => tx.delete("capacity-fill"));
  assert.equal(a.registry.resumeCapacity(id).status, "awaiting-snapshot");
  assert.equal(head(a, id).id, next.epoch.id);
  assert.equal(a.registry.stopEvidence(id), null);
  assert.equal(
    a.registry.observeSnapshot(id, next.epoch.id, next.snapshot).status,
    "active",
  );
  const revision = a.store.accounting().revision;
  a.registry.observeSnapshot(id, next.epoch.id, next.snapshot);
  assert.equal(
    a.store.accounting().revision,
    revision,
    "duplicate snapshots do not rewrite metadata",
  );
});

test("snapshot capacity stops survive restart; freeing space alone cannot reactivate membership", (t) => {
  const f = fixture(t),
    a = f.actor("Alice", {
      totalBytes: 4 * 1024 ** 2 + 65536,
      reserveBytes: 4 * 1024 ** 2,
    }),
    id = a.registry.create(randomUUID(), "Before").groupId;
  const parent = head(a, id),
    before = a.registry.privateState(id, parent.id)!;
  const next = createGroupSuccessor(
    a.identity,
    a.registry.anchor(id),
    parent,
    before,
    {
      title: "After",
      members: before.members,
      joins: [],
    },
  );
  a.registry.observeHeaders(id, [next.epoch]);
  a.store.transaction((tx) =>
    tx.put(
      "capacity-fill",
      Buffer.alloc(65536 - tx.accounting().ordinaryBytes - 400),
    ),
  );
  assert.equal(
    a.registry.observeSnapshot(id, next.epoch.id, next.snapshot).status,
    "capacity",
  );
  assert.equal(a.registry.stopEvidence(id)?.reason, "capacity");
  a.reopen();
  a.store.transaction((tx) => tx.delete("capacity-fill"));
  assert.equal(a.registry.resumeCapacity(id).status, "capacity");
  assert.throws(() =>
    a.registry.observeSnapshot(id, next.epoch.id, {
      ...next.snapshot,
      title: "tampered",
    }),
  );
  assert.equal(a.registry.state(id).status, "capacity");
  assert.equal(
    a.registry.observeSnapshot(id, next.epoch.id, next.snapshot).status,
    "active",
  );
});

test("a real sibling proof during capacity suspension freezes permanently and is retrievable", (t) => {
  const f = fixture(t),
    a = f.actor("Alice", {
      totalBytes: 4 * 1024 ** 2 + 65536,
      reserveBytes: 4 * 1024 ** 2,
    }),
    id = a.registry.create(randomUUID(), "Before").groupId;
  const parent = head(a, id),
    before = a.registry.privateState(id, parent.id)!,
    anchor = a.registry.anchor(id);
  const next = createGroupSuccessor(a.identity, anchor, parent, before, {
      title: "First",
      members: before.members,
      joins: [],
    }),
    sibling = createGroupSuccessor(a.identity, anchor, parent, before, {
      title: "Second",
      members: before.members,
      joins: [],
    });
  a.store.transaction((tx) =>
    tx.put(
      "capacity-fill",
      Buffer.alloc(65536 - tx.accounting().ordinaryBytes - 400),
    ),
  );
  a.registry.observeHeaders(id, [next.epoch]);
  assert.equal(
    a.registry.observeHeaders(id, [sibling.epoch]).status.status,
    "forked",
  );
  a.reopen();
  a.store.transaction((tx) => tx.delete("capacity-fill"));
  assert.throws(() => a.registry.resumeCapacity(id), /capacidade/);
  assert.deepEqual(a.registry.stopEvidence(id), {
    reason: "forked",
    first: next.epoch,
    second: sibling.epoch,
  });
  assert.equal(a.registry.state(id).status, "forked");
});

test("finite operation retention follows authenticated revisions and leaves group proofs intact", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    outsider = createIdentity("Bruno"),
    createOp = randomUUID();
  const created = a.registry.create(createOp, "Retained group"),
    id = created.groupId;
  const inviteOps: string[] = [];
  for (let n = 0; n < 256; n++) {
    const op = randomUUID();
    inviteOps.push(op);
    a.registry.invite(op, id, created.epochId!, outsider.public);
  }
  assert.equal(a.registry.operationStatus(createOp), null);
  assert.equal(
    a.store.view((tx) => tx.keys("operation:").length),
    256,
  );
  const retained = a.registry.operationStatus(inviteOps[0]);
  assert.ok(retained);
  a.reopen();
  const revision = a.store.accounting().revision;
  assert.deepEqual(
    a.registry.invite(inviteOps[0], id, created.epochId!, outsider.public),
    retained,
  );
  assert.equal(a.store.accounting().revision, revision);
  a.registry.invite(randomUUID(), id, created.epochId!, outsider.public);
  assert.equal(
    a.registry.operationStatus(inviteOps[0]),
    null,
    "reading/repeating does not renew retention",
  );
  assert.equal(a.registry.state(id).status, "active");
  assert.equal(a.registry.proofs(id, 0)[0].id, created.epochId);
});

test("authenticated but malformed authority records fail closed instead of trusting falsy fields or cursors", (t) => {
  const f = fixture(t);
  for (const [i, mutate] of [
    (r: any) => {
      r.admitted = false;
      r.checkedThrough = null;
    },
    (r: any) => {
      r.head = false;
    },
    (r: any) => {
      r.checkedThrough = 1;
    },
    (r: any) => {
      r.left = {
        epochId: null,
        nonce: Buffer.alloc(32).toString("base64"),
        request: false,
        card: null,
      };
    },
  ].entries()) {
    const a = f.actor("Malformed" + i),
      id = a.registry.create(randomUUID(), "Before").groupId;
    a.store.transaction((tx) => {
      const r = JSON.parse(tx.get("group:" + id)!.toString());
      mutate(r);
      tx.put("group:" + id, Buffer.from(canonical(r)), "checkpoint");
    });
    assert.throws(
      () => a.registry.state(id),
      /Checkpoint de autoridade inválido/,
    );
    assert.throws(() => a.registry.list(), /incerto/, "handle stays poisoned");
  }
});

test("corrupt retained operation cannot fabricate a successful response", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    operation = randomUUID();
  a.registry.create(operation, "Before");
  a.store.transaction((tx) => {
    const key = "operation:" + operation,
      op = JSON.parse(tx.get(key)!.toString());
    op.result.epochId = "fabricated";
    op.sequence = tx.indexBody().revision + 1;
    tx.put(key, Buffer.from(canonical(op)));
  });
  assert.throws(
    () => a.registry.create(operation, "Before"),
    /Operação de autoridade inválida/,
  );
});

test("local leave and creator closure remain durable under full ordinary metadata capacity", (t) => {
  const f = fixture(t),
    limits = { totalBytes: 4 * 1024 ** 2 + 65536, reserveBytes: 4 * 1024 ** 2 },
    a = f.actor("Alice", limits),
    b = f.actor("Bruno", limits),
    id = a.registry.create(randomUUID(), "Before").groupId;
  joinMember(a, b, id);
  for (const actor of [a, b])
    actor.store.transaction((tx) =>
      tx.put(
        "capacity-fill",
        Buffer.alloc(65536 - tx.accounting().ordinaryBytes - 400),
      ),
    );
  const leaveOp = randomUUID(),
    closeOp = randomUUID(),
    expected = head(a, id).id;
  const leave = b.registry.leave(leaveOp, id);
  const close = a.registry.close(closeOp, id, expected);
  a.reopen();
  b.reopen();
  assert.equal(b.registry.state(id).status, "left");
  assert.equal(a.registry.state(id).status, "closed");
  assert.deepEqual(b.registry.leave(leaveOp, id), leave);
  assert.deepEqual(a.registry.close(closeOp, id, expected), close);
});

test("a malformed trailing proof cannot roll back an already verified removal in the same page", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    b = f.actor("Bruno"),
    id = a.registry.create(randomUUID(), "Before").groupId;
  joinMember(a, b, id);
  a.registry.commit(randomUUID(), id, head(a, id).id, {
    title: "Removed",
    members: [a.identity.public],
    joins: [],
  });
  const removal = head(a, id),
    invalid = { ...removal, signature: Buffer.alloc(64).toString("base64") };
  assert.throws(
    () => b.registry.observeHeaders(id, [removal, invalid]),
    /Assinatura/,
  );
  b.reopen();
  assert.equal(b.registry.state(id).status, "removed");
  assert.equal(head(b, id).id, removal.id);
});

test("the declared maximum checkpoints and stop receipts fit the reserved SQLite budget", (t) => {
  const f = fixture(t),
    ordinaryLimit = 65536,
    a = f.actor("Reservation", {
      totalBytes: 4 * 1024 ** 2 + ordinaryLimit,
      reserveBytes: 4 * 1024 ** 2,
    });
  a.store.transaction((tx) => {
    tx.put("ordinary-fill", Buffer.alloc(ordinaryLimit - 420));
    for (let n = 0; n < AUTHORITY_LIMITS.groups; n++)
      tx.put(
        "group:" + hash(String(n)),
        Buffer.alloc(AUTHORITY_LIMITS.checkpointBytes),
        "checkpoint",
      );
    for (let n = 0; n < AUTHORITY_LIMITS.operations; n++)
      tx.put(
        "operation:" + randomUUID(),
        Buffer.alloc(AUTHORITY_LIMITS.operationBytes),
        "checkpoint",
      );
  });
  const budget = a.store.accounting();
  assert.equal(
    budget.records,
    1 + AUTHORITY_LIMITS.groups + AUTHORITY_LIMITS.operations,
  );
  assert.ok(budget.ordinaryBytes > ordinaryLimit - 100);
  assert.ok(budget.serializedBytes <= budget.totalBytes);
  assert.throws(
    () =>
      a.store.transaction((tx) =>
        tx.put("ordinary-overflow", Buffer.alloc(100)),
      ),
    /Capacidade/,
  );
});

test("retirement rechecks every operation signature after caching a group in the same transaction", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    outsider = createIdentity("Bruno"),
    createOp = randomUUID();
  const created = a.registry.create(createOp, "Before"),
    invalidOp = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  for (let n = 0; n < 255; n++)
    a.registry.invite(
      n === 254 ? invalidOp : randomUUID(),
      created.groupId,
      created.epochId!,
      outsider.public,
    );
  a.store.transaction((tx) => {
    const key = "operation:" + invalidOp,
      value = JSON.parse(tx.get(key)!.toString());
    value.sequence = tx.indexBody().revision + 1;
    value.result.certificate.signature = Buffer.alloc(64).toString("base64");
    tx.put(key, Buffer.from(canonical(value)));
  });
  const nextOp = randomUUID();
  assert.throws(
    () =>
      a.registry.invite(
        nextOp,
        created.groupId,
        created.epochId!,
        outsider.public,
      ),
    /Certificado de operação inválido/,
  );
  a.reopen();
  assert.ok(
    a.registry.operationStatus(createOp),
    "a failed scan cannot retire the oldest good operation",
  );
  assert.equal(a.registry.operationStatus(nextOp), null);
  assert.equal(
    a.store.view((tx) => tx.keys("operation:").length),
    256,
  );
});
