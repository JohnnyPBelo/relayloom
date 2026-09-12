import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import {
  canonical,
  hash,
  createIdentity,
  createBundle,
  decryptBundle,
  validateIdentity,
  verifyManifest,
  type Identity,
} from "../packages/core/src/index.js";
import {
  acceptGroupInvitation,
  classifyGroupEpochPath,
  closeAnchoredGroup,
  createAnchoredGroup,
  createGroupAnchor,
  createGroupInvitation,
  createGroupLeave,
  createGroupSuccessor,
  memberCardHash,
  verifyGroupAnchor,
  verifyGroupConsent,
  verifyGroupEpoch,
  verifyGroupEpochLink,
  verifyGroupInvitation,
  verifyGroupLeave,
  verifyGroupSnapshot,
  verifyGroupTransition,
  type Certificate,
  type GroupEpoch,
} from "../packages/groups/src/certificates.js";

const alice = createIdentity("Alice criadora"),
  bob = createIdentity("Bruno membro"),
  clara = createIdentity("Clara futura"),
  outsider = createIdentity("Duarte relay");
function signed<T>(identity: Identity, body: T): Certificate<T> {
  const data = canonical(body);
  return {
    body: structuredClone(body),
    id: hash(data),
    signature: sign(
      null,
      Buffer.from(data),
      createPrivateKey({
        key: Buffer.from(identity.signSecret, "base64"),
        format: "der",
        type: "pkcs8",
      }),
    ).toString("base64"),
  };
}
function initial() {
  return createAnchoredGroup(alice, "Vizinhança da ribeira");
}
function withBob() {
  const group = initial(),
    invite = createGroupInvitation(
      alice,
      group.anchor,
      group.epoch,
      bob.public,
    );
  const consent = acceptGroupInvitation(bob, group.anchor, group.epoch, invite);
  return {
    ...group,
    first: group.epoch,
    firstState: group.snapshot,
    consent,
    ...createGroupSuccessor(alice, group.anchor, group.epoch, group.snapshot, {
      title: group.snapshot.title,
      members: [bob.public, alice.public],
      joins: [consent],
    }),
  };
}
function readingCard(identity: Identity): Identity {
  const fresh = createIdentity(identity.public.name),
    { proof: _, ...body } = { ...identity.public, boxKey: fresh.public.boxKey };
  const key = createPrivateKey({
    key: Buffer.from(identity.signSecret, "base64"),
    format: "der",
    type: "pkcs8",
  });
  return {
    public: {
      ...body,
      proof: sign(null, Buffer.from(canonical(body)), key).toString("base64"),
    },
    signSecret: identity.signSecret,
    boxSecret: fresh.boxSecret,
  };
}

test("permanent group anchor has real creator signature, exact schema and separate carrier identity", () => {
  const anchor = createGroupAnchor(alice);
  assert.deepEqual(verifyGroupAnchor(anchor), anchor);
  assert.notEqual(createGroupAnchor(alice).id, anchor.id);
  assert.throws(() =>
    verifyGroupAnchor({
      ...anchor,
      signature: signed(bob, anchor.body).signature,
    }),
  );
  assert.throws(() =>
    verifyGroupAnchor(
      signed(alice, { ...anchor.body, membershipAuthority: "reader" }),
    ),
  );
  assert.throws(() =>
    verifyGroupAnchor(signed(alice, { ...anchor.body, creator: bob.public })),
  );
  assert.throws(() =>
    verifyGroupAnchor(signed(alice, { ...anchor.body, nonce: "AA==" })),
  );
  const carrier = createBundle(
    bob,
    "group-control",
    { anchor },
    "public",
    1000,
  );
  verifyManifest(carrier.manifest, carrier.manifest.created);
  assert.throws(() =>
    verifyManifest(carrier.manifest, carrier.manifest.expires + 1),
  );
  assert.equal(verifyGroupAnchor(anchor).body.creator.id, alice.public.id);
  const refreshed = createBundle(
    outsider,
    "group-control",
    { anchor },
    "public",
  );
  assert.notEqual(refreshed.manifest.id, carrier.manifest.id);
  assert.equal((decryptBundle(refreshed) as any).anchor.id, anchor.id);
  assert.equal(
    verifyGroupAnchor((decryptBundle(refreshed) as any).anchor).body.creator.id,
    alice.public.id,
  );
});

test("invitation and signed consent do not alter roster until the creator commits the exact parent", () => {
  const group = initial();
  const invite = createGroupInvitation(
    alice,
    group.anchor,
    group.epoch,
    bob.public,
  );
  assert.deepEqual(
    verifyGroupInvitation(invite, group.anchor, group.epoch, bob.public),
    invite,
  );
  const consent = acceptGroupInvitation(bob, group.anchor, group.epoch, invite);
  assert.equal(consent.body.invitationHash, invite.id);
  assert.equal(group.epoch.body.members.length, 1);
  assert.throws(() =>
    acceptGroupInvitation(clara, group.anchor, group.epoch, invite),
  );
  assert.throws(() =>
    createGroupInvitation(bob, group.anchor, group.epoch, clara.public),
  );
  const update = {
    title: group.snapshot.title,
    members: [alice.public, bob.public],
    joins: [consent],
  };
  assert.throws(() =>
    createGroupSuccessor(
      bob,
      group.anchor,
      group.epoch,
      group.snapshot,
      update,
    ),
  );
  const joined = createGroupSuccessor(
    alice,
    group.anchor,
    group.epoch,
    group.snapshot,
    update,
  );
  assert.equal(
    verifyGroupTransition(
      group.anchor,
      group.epoch,
      group.snapshot,
      joined.epoch,
      joined.snapshot,
    ),
    "nonrestrictive",
  );
  assert.equal(joined.epoch.body.number, 1);
  assert.equal(joined.epoch.body.previous, group.epoch.id);
  assert.equal(joined.epoch.body.members.length, 2);
  assert.equal(group.epoch.body.members.length, 1);
});

test("newcomer reads real new ciphertext without obtaining historical keys; removed reader cannot read new content", () => {
  const group = withBob();
  const original = createBundle(
    bob,
    "message",
    {
      conversation: group.anchor.id,
      groupEpoch: group.epoch.id,
      text: "Só os leitores originais",
    },
    group.snapshot.members,
  );
  assert.equal(
    (decryptBundle(original, alice) as any).text,
    "Só os leitores originais",
  );
  assert.throws(() => decryptBundle(original, clara));
  const consent = acceptGroupInvitation(
    clara,
    group.anchor,
    group.epoch,
    createGroupInvitation(alice, group.anchor, group.epoch, clara.public),
  );
  const added = createGroupSuccessor(
    alice,
    group.anchor,
    group.epoch,
    group.snapshot,
    {
      title: "Com Clara",
      members: [...group.snapshot.members, clara.public],
      joins: [consent],
    },
  );
  const current = createBundle(
    alice,
    "message",
    { groupEpoch: added.epoch.id, text: "Para todos os membros actuais" },
    added.snapshot.members,
  );
  assert.equal(
    (decryptBundle(current, clara) as any).text,
    "Para todos os membros actuais",
  );
  assert.throws(() => decryptBundle(original, clara));
  const removed = createGroupSuccessor(
    alice,
    group.anchor,
    added.epoch,
    added.snapshot,
    {
      title: "Depois da saída",
      members: [alice.public, clara.public],
      joins: [],
    },
  );
  assert.equal(
    verifyGroupEpochLink(group.anchor, added.epoch, removed.epoch),
    "restrictive",
  );
  const future = createBundle(
    clara,
    "message",
    { groupEpoch: removed.epoch.id, text: "Novo conteúdo" },
    removed.snapshot.members,
  );
  assert.throws(() => decryptBundle(future, bob));
  assert.equal(
    (decryptBundle(original, bob) as any).text,
    "Só os leitores originais",
  );
});

test("stale, substituted, missing or extra member consents cannot commit a roster", () => {
  const group = withBob();
  const stale = acceptGroupInvitation(
    clara,
    group.anchor,
    group.first,
    createGroupInvitation(alice, group.anchor, group.first, clara.public),
  );
  assert.throws(() =>
    verifyGroupConsent(stale, group.anchor, group.epoch, clara.public),
  );
  const update = {
    title: "Mudança",
    members: [...group.snapshot.members, clara.public],
    joins: [stale],
  };
  assert.throws(() =>
    createGroupSuccessor(
      alice,
      group.anchor,
      group.epoch,
      group.snapshot,
      update,
    ),
  );
  assert.throws(() =>
    createGroupSuccessor(alice, group.anchor, group.epoch, group.snapshot, {
      ...update,
      joins: [],
    }),
  );
  const invitation = createGroupInvitation(
      alice,
      group.anchor,
      group.epoch,
      clara.public,
    ),
    consent = acceptGroupInvitation(
      clara,
      group.anchor,
      group.epoch,
      invitation,
    );
  assert.throws(() =>
    verifyGroupConsent(
      signed(outsider, consent.body),
      group.anchor,
      group.epoch,
      clara.public,
    ),
  );
  assert.throws(() =>
    createGroupSuccessor(alice, group.anchor, group.epoch, group.snapshot, {
      ...update,
      joins: [consent, consent],
    }),
  );
  assert.throws(() =>
    createGroupSuccessor(alice, group.anchor, group.epoch, group.snapshot, {
      title: "Texto",
      members: group.snapshot.members,
      joins: [consent],
    }),
  );
  const other = initial();
  assert.throws(() =>
    verifyGroupInvitation(invitation, other.anchor, other.epoch, clara.public),
  );
});

test("removal and rejoin remain restrictive across the complete path even with identical final cards", () => {
  const group = withBob();
  const removed = createGroupSuccessor(
    alice,
    group.anchor,
    group.epoch,
    group.snapshot,
    { title: "Só criadora", members: [alice.public], joins: [] },
  );
  const consent = acceptGroupInvitation(
    bob,
    group.anchor,
    removed.epoch,
    createGroupInvitation(alice, group.anchor, removed.epoch, bob.public),
  );
  const rejoined = createGroupSuccessor(
    alice,
    group.anchor,
    removed.epoch,
    removed.snapshot,
    { title: "Regresso", members: group.snapshot.members, joins: [consent] },
  );
  assert.deepEqual(rejoined.epoch.body.members, group.epoch.body.members);
  assert.equal(
    verifyGroupEpochLink(group.anchor, removed.epoch, rejoined.epoch),
    "nonrestrictive",
  );
  assert.equal(
    classifyGroupEpochPath(group.anchor, [
      group.epoch,
      removed.epoch,
      rejoined.epoch,
    ]),
    "restrictive",
  );
  assert.throws(() =>
    classifyGroupEpochPath(group.anchor, [group.epoch, rejoined.epoch]),
  );
  assert.throws(() =>
    createGroupSuccessor(alice, group.anchor, removed.epoch, removed.snapshot, {
      title: "Replay",
      members: group.snapshot.members,
      joins: [group.consent],
    }),
  );
});

test("creator reading-card replacement preserves signing authority but requires fresh signed consent", () => {
  const group = withBob(),
    renewed = readingCard(alice);
  assert.ok(validateIdentity(renewed.public));
  assert.equal(renewed.public.id, alice.public.id);
  assert.notEqual(memberCardHash(renewed.public), memberCardHash(alice.public));
  const invite = createGroupInvitation(
    alice,
    group.anchor,
    group.epoch,
    renewed.public,
  );
  assert.throws(() =>
    acceptGroupInvitation(alice, group.anchor, group.epoch, invite),
  );
  const consent = acceptGroupInvitation(
    renewed,
    group.anchor,
    group.epoch,
    invite,
  );
  const next = createGroupSuccessor(
    renewed,
    group.anchor,
    group.epoch,
    group.snapshot,
    {
      title: "Nova chave de leitura",
      members: [renewed.public, bob.public],
      joins: [consent],
    },
  );
  assert.equal(
    verifyGroupEpochLink(group.anchor, group.epoch, next.epoch),
    "restrictive",
  );
  assert.equal(
    verifyGroupAnchor(group.anchor).body.creator.signKey,
    renewed.public.signKey,
  );
  const bundle = createBundle(
    bob,
    "message",
    { text: "Para a nova chave" },
    next.snapshot.members,
  );
  assert.equal(
    (decryptBundle(bundle, renewed) as any).text,
    "Para a nova chave",
  );
  assert.throws(() => decryptBundle(bundle, alice));
  assert.throws(() =>
    createGroupAnchor({ ...renewed, signSecret: bob.signSecret }),
  );
});

test("signed schema tampering, roster duplication, invalid order and snapshot substitution fail", () => {
  const group = withBob(),
    body = group.epoch.body;
  for (const change of [
    { ...body, extra: true },
    { ...body, domain: "relayloom/group-anchor/1" },
    { ...body, number: 1.5 },
    { ...body, previous: null },
    { ...body, members: [...body.members].reverse() },
    { ...body, members: [body.members[0], body.members[0]] },
    { ...body, members: [] },
  ])
    assert.throws(() => verifyGroupEpoch(signed(alice, change), group.anchor));
  assert.throws(() => verifyGroupEpoch(signed(bob, body), group.anchor));
  assert.throws(() =>
    verifyGroupEpoch(
      { ...group.epoch, signature: group.epoch.signature.slice(0, -1) },
      group.anchor,
    ),
  );
  assert.throws(() =>
    verifyGroupSnapshot(
      { ...group.snapshot, title: "Alterado pelo seeder" },
      group.anchor,
      group.epoch,
    ),
  );
  assert.throws(() =>
    verifyGroupSnapshot(
      { ...group.snapshot, privateKey: "injection" },
      group.anchor,
      group.epoch,
    ),
  );
  let invoked = false;
  const hostile = {
    ...group.anchor,
    get body() {
      invoked = true;
      return group.anchor.body;
    },
  };
  assert.throws(() => verifyGroupAnchor(hostile));
  assert.equal(invoked, false);
  const copy = verifyGroupEpoch(group.epoch, group.anchor);
  copy.body.members.pop();
  assert.equal(group.epoch.body.members.length, 2);
});

test("closure preserves the committed historical state and reserves the final epoch", () => {
  const group = withBob(),
    closed = closeAnchoredGroup(alice, group.anchor, group.epoch);
  assert.equal(closed.body.snapshotHash, group.epoch.body.snapshotHash);
  assert.deepEqual(
    verifyGroupSnapshot(group.snapshot, group.anchor, closed),
    group.snapshot,
  );
  assert.equal(
    verifyGroupTransition(
      group.anchor,
      group.epoch,
      group.snapshot,
      closed,
      group.snapshot,
    ),
    "restrictive",
  );
  assert.throws(() => closeAnchoredGroup(bob, group.anchor, group.epoch));
  assert.throws(() => closeAnchoredGroup(alice, group.anchor, closed));
  assert.throws(() =>
    createGroupInvitation(alice, group.anchor, closed, clara.public),
  );
  // Signed high-number header fixture exercises header bounds, not complete ancestry admission.
  const finalOpen = signed(alice, {
    ...group.epoch.body,
    number: 1022,
  }) as GroupEpoch;
  verifyGroupEpoch(finalOpen, group.anchor);
  assert.equal(
    closeAnchoredGroup(alice, group.anchor, finalOpen).body.number,
    1023,
  );
  assert.throws(() =>
    verifyGroupEpoch(
      signed(alice, { ...finalOpen.body, number: 1023 }),
      group.anchor,
    ),
  );
  assert.throws(() =>
    verifyGroupEpoch(
      signed(alice, { ...closed.body, number: 1024 }),
      group.anchor,
    ),
  );
  assert.throws(() =>
    verifyGroupEpochLink(
      group.anchor,
      group.epoch,
      signed(alice, { ...closed.body, snapshotHash: "a".repeat(64) }),
    ),
  );
});

test("a valid creator fork cannot masquerade as a contiguous successor or grant reader authority", () => {
  const group = withBob();
  const left = createGroupSuccessor(
    alice,
    group.anchor,
    group.epoch,
    group.snapshot,
    { title: "Ramo A", members: group.snapshot.members, joins: [] },
  );
  const right = createGroupSuccessor(
    alice,
    group.anchor,
    group.epoch,
    group.snapshot,
    { title: "Ramo B", members: group.snapshot.members, joins: [] },
  );
  assert.notEqual(left.epoch.id, right.epoch.id);
  assert.equal(
    verifyGroupEpochLink(group.anchor, group.epoch, left.epoch),
    "nonrestrictive",
  );
  assert.equal(
    verifyGroupEpochLink(group.anchor, group.epoch, right.epoch),
    "nonrestrictive",
  );
  assert.throws(() =>
    verifyGroupEpochLink(group.anchor, left.epoch, right.epoch),
  );
  assert.throws(() =>
    createGroupSuccessor(bob, group.anchor, left.epoch, left.snapshot, {
      title: "Forjado",
      members: left.snapshot.members,
      joins: [],
    }),
  );
});

test("full 64-member roster is bounded; capacity and title failures do not mutate its parent", () => {
  const group = initial(),
    members = Array.from({ length: 63 }, (_, n) =>
      createIdentity("Membro " + n),
    );
  const joins = members.map((member) =>
    acceptGroupInvitation(
      member,
      group.anchor,
      group.epoch,
      createGroupInvitation(alice, group.anchor, group.epoch, member.public),
    ),
  );
  const update = {
    title: "😀".repeat(128),
    members: [alice.public, ...members.map((m) => m.public)],
    joins,
  };
  const full = createGroupSuccessor(
    alice,
    group.anchor,
    group.epoch,
    group.snapshot,
    update,
  );
  assert.equal(
    verifyGroupSnapshot(full.snapshot, group.anchor, full.epoch).members.length,
    64,
  );
  assert.equal(full.snapshot.joins.length, 63);
  assert.throws(() =>
    createGroupSuccessor(alice, group.anchor, group.epoch, group.snapshot, {
      ...update,
      title: "😀".repeat(128) + "x",
    }),
  );
  assert.throws(() =>
    createGroupSuccessor(alice, group.anchor, group.epoch, group.snapshot, {
      ...update,
      members: [...update.members, outsider.public],
    }),
  );
  assert.throws(() =>
    createGroupSuccessor(alice, group.anchor, group.epoch, group.snapshot, {
      ...update,
      joins: [...joins, joins[0], joins[0]],
    }),
  );
  assert.equal(group.epoch.body.number, 0);
  assert.equal(group.snapshot.members.length, 1);
});

test("member leave is a signed request with no direct roster effect and cannot replace creator closure", () => {
  const group = withBob(),
    leave = createGroupLeave(bob, group.anchor, group.epoch);
  assert.deepEqual(
    verifyGroupLeave(leave, group.anchor, group.epoch, bob.public),
    leave,
  );
  assert.equal(group.epoch.body.members.length, 2);
  assert.throws(() => createGroupLeave(alice, group.anchor, group.epoch));
  assert.throws(() => createGroupLeave(outsider, group.anchor, group.epoch));
  assert.throws(() =>
    verifyGroupLeave(
      signed(outsider, leave.body),
      group.anchor,
      group.epoch,
      bob.public,
    ),
  );
  const changed = createGroupSuccessor(
    alice,
    group.anchor,
    group.epoch,
    group.snapshot,
    { title: "Título seguinte", members: group.snapshot.members, joins: [] },
  );
  assert.throws(() =>
    verifyGroupLeave(leave, group.anchor, changed.epoch, bob.public),
  );
  const renewed = createGroupLeave(bob, group.anchor, changed.epoch);
  assert.notEqual(renewed.id, leave.id);
  assert.equal(
    verifyGroupLeave(renewed, group.anchor, changed.epoch, bob.public).body
      .parentEpochId,
    changed.epoch.id,
  );
});
