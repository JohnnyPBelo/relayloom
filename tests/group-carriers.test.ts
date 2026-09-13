import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  canonical,
  createBundle,
  decryptBundle,
  verifyBundle,
} from "../packages/core/src/index.js";
import {
  createGroupSuccessor,
  type GroupInvitation,
} from "../packages/groups/src/certificates.js";
import { GroupRegistry } from "../packages/groups/src/registry.js";
import {
  checkedSnapshot,
  openGroupControl,
  parseGroupControl,
  requestedHeaders,
  requestedSnapshot,
  sealGroupControl,
  snapshotCarrier,
  verifyGroupControlEnvelope,
  type GroupControl,
} from "../packages/groups/src/carriers.js";
import { fixture, enroll, sync, type Actor } from "./fixtures/group-access.js";

test("control expiry rejects replay while the signed authority checkpoint survives", (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const f = fixture(t),
    a = f.actor("Expiry owner");
  const id = a.registry.create(randomUUID(), "Durable authority").groupId,
    head = a.registry.state(id).head!;
  const bundle = sealGroupControl(
    a.identity,
    {
      type: "group-control",
      version: 1,
      action: "headers",
      groupId: id,
      to: a.identity.public.id,
      from: 0,
      headers: [head],
      head,
    },
    [],
  );
  now = bundle.manifest.expires - 1;
  verifyGroupControlEnvelope(bundle);
  assert.equal(openGroupControl(bundle, a.identity).action, "headers");
  now++;
  assert.throws(() => verifyGroupControlEnvelope(bundle));
  assert.throws(() => openGroupControl(bundle, a.identity));
  assert.equal(a.registry.state(id).head!.id, head.id);
});

function scoped<T>(a: Actor, fn: (g: GroupRegistry) => T): T {
  return a.store.transaction((tx) =>
    GroupRegistry.inTransaction(tx, a.identity, fn),
  ).value;
}
function headers(
  groupId: string,
  to: string,
  number: number,
  id: string,
  from = 0,
): Extract<GroupControl, { action: "headers-request" }> {
  return {
    type: "group-control",
    version: 1,
    action: "headers-request",
    groupId,
    to,
    from,
    count: 16,
    authorization: { number, id },
  };
}

test("a reader may seal a creator snapshot for its exact original roster without gaining authority", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    b = f.actor("Bruno"),
    c = f.actor("Carla");
  const id = a.registry.create(randomUUID(), "Private roster").groupId;
  enroll(a, b, id);
  const epoch = a.registry.state(id).head!,
    snapshot = a.registry.privateState(id, epoch.id)!;
  const carrier = scoped(b, (g) =>
    snapshotCarrier(g, b.identity, epoch, snapshot),
  );
  verifyBundle(carrier);
  assert.equal(carrier.manifest.author.id, b.identity.public.id);
  const content = openGroupControl(carrier, a.identity);
  assert.equal(content.action, "snapshot");
  if (content.action !== "snapshot") throw new Error("wrong action");
  const checked = scoped(a, (g) => checkedSnapshot(g, carrier, content));
  assert.equal(checked.epoch.signature, epoch.signature);
  assert.equal(a.registry.anchor(id).body.creator.id, a.identity.public.id);
  assert.deepEqual(checked.snapshot, snapshot);
  assert.throws(() => decryptBundle(carrier, c.identity));
  const forged = sealGroupControl(
    b.identity,
    {
      ...content,
      snapshot: { ...snapshot, title: "Reader rewrote the creator's roster" },
    },
    snapshot.members,
  );
  assert.throws(() =>
    scoped(a, (g) =>
      checkedSnapshot(
        g,
        forged,
        openGroupControl(forged, a.identity) as typeof content,
      ),
    ),
  );
  const widened = createBundle(
    b.identity,
    "group-control",
    content,
    [...snapshot.members, c.identity.public],
    3600000,
  );
  assert.throws(() =>
    scoped(a, (g) =>
      checkedSnapshot(
        g,
        widened,
        openGroupControl(widened, a.identity) as typeof content,
      ),
    ),
  );
  assert.throws(
    () => snapshotCarrier(a.registry, a.identity, epoch, snapshot),
    /transacção/,
  );
});

test("removed readers receive their removal boundary but cannot enumerate future membership or request future snapshots", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    b = f.actor("Bruno"),
    c = f.actor("Carla");
  const id = a.registry.create(randomUUID(), "Group").groupId;
  enroll(a, b, id);
  const original = a.registry.state(id).head!;
  a.registry.commit(randomUUID(), id, original.id, {
    title: "Removed Bruno",
    members: [a.identity.public],
    joins: [],
  });
  const boundary = a.registry.state(id).head!;
  enroll(a, c, id);
  const future = a.registry.state(id).head!;
  const result = scoped(a, (g) =>
    requestedHeaders(
      g,
      headers(id, a.identity.public.id, original.body.number, original.id),
      b.identity.public,
    ),
  );
  assert.throws(() =>
    scoped(a, (g) =>
      requestedHeaders(
        g,
        {
          ...headers(
            id,
            a.identity.public.id,
            original.body.number,
            original.id,
          ),
          authorization: {
            number: original.body.number,
            id: original.id,
            invitation: null as any,
          },
        },
        b.identity.public,
      ),
    ),
  );
  assert.equal(result.head.id, boundary.id);
  assert.ok(result.headers.some((e) => e.id === boundary.id));
  assert.ok(result.headers.every((e) => e.body.number <= boundary.body.number));
  assert.equal(
    scoped(a, (g) =>
      requestedHeaders(
        g,
        headers(
          id,
          a.identity.public.id,
          original.body.number,
          original.id,
          future.body.number,
        ),
        b.identity.public,
      ),
    ).headers.length,
    0,
  );
  const request = {
    type: "group-control",
    version: 1,
    action: "snapshot-request",
    groupId: id,
    to: a.identity.public.id,
    number: original.body.number,
    epochId: original.id,
  } as const;
  assert.ok(
    scoped(a, (g) =>
      requestedSnapshot(g, request, b.identity.public, a.identity.public),
    ).snapshot,
  );
  assert.throws(() =>
    scoped(a, (g) =>
      requestedSnapshot(g, request, c.identity.public, a.identity.public),
    ),
  );
  assert.throws(() =>
    scoped(a, (g) =>
      requestedSnapshot(
        g,
        { ...request, number: future.body.number, epochId: future.id },
        b.identity.public,
        a.identity.public,
      ),
    ),
  );
  assert.throws(() =>
    scoped(a, (g) =>
      requestedHeaders(
        g,
        headers(id, a.identity.public.id, original.body.number, original.id),
        c.identity.public,
      ),
    ),
  );
});

test("invitation authorizes bounded public ancestry, never a private snapshot before membership", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    b = f.actor("Bruno");
  const id = a.registry.create(randomUUID(), "Group").groupId,
    parent = a.registry.state(id).head!;
  const invitation = a.registry.invite(
    randomUUID(),
    id,
    parent.id,
    b.identity.public,
  ).certificate as GroupInvitation;
  const request = headers(
    id,
    a.identity.public.id,
    parent.body.number,
    parent.id,
  );
  request.authorization.invitation = invitation;
  assert.equal(
    scoped(a, (g) => requestedHeaders(g, request, b.identity.public)).headers
      .length,
    1,
  );
  assert.throws(() =>
    scoped(a, (g) =>
      requestedSnapshot(
        g,
        {
          type: "group-control",
          version: 1,
          action: "snapshot-request",
          groupId: id,
          to: a.identity.public.id,
          number: parent.body.number,
          epochId: parent.id,
        },
        b.identity.public,
        a.identity.public,
      ),
    ),
  );
  const carrier = sealGroupControl(b.identity, request, [a.identity.public]);
  assert.equal(openGroupControl(carrier, a.identity).action, "headers-request");
  const publicCarrier = createBundle(
    b.identity,
    "group-control",
    request,
    "public",
  );
  assert.throws(() => openGroupControl(publicCarrier, a.identity), /privado/);
});

test("carrier schema keeps malformed proof tails for the transactional verifier while bounding inputs", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    b = f.actor("Bruno");
  const id = a.registry.create(randomUUID(), "Group").groupId;
  enroll(a, b, id);
  const closed = a.registry.close(
    randomUUID(),
    id,
    a.registry.state(id).head!.id,
  );
  const head = a.registry.state(id).head!;
  const payload = {
    type: "group-control",
    version: 1,
    action: "headers",
    groupId: id,
    to: b.identity.public.id,
    from: head.body.number,
    headers: [head, { bad: "tail" }],
    head,
  } as const;
  const parsed = parseGroupControl(JSON.parse(JSON.stringify(payload)));
  assert.equal(parsed.action, "headers");
  const body = sealGroupControl(a.identity, parsed, [b.identity.public]);
  const received = openGroupControl(body, b.identity);
  assert.equal(received.action, "headers");
  if (received.action !== "headers") throw new Error("wrong action");
  assert.throws(() => b.registry.observeHeaders(id, received.headers as any));
  assert.equal(b.registry.state(id).status, "closed");
  assert.equal(b.registry.state(id).head!.id, closed.epochId);
  assert.throws(() =>
    parseGroupControl({ ...payload, headers: Array(17).fill(head) }),
  );
  assert.throws(() => parseGroupControl({ ...payload, extra: true }));
  assert.throws(() =>
    parseGroupControl({ ...payload, headers: [{ bad: "x".repeat(16385) }] }),
  );
  const c = f.actor("Outside"),
    widened = createBundle(
      a.identity,
      "group-control",
      parsed,
      [b.identity.public, c.identity.public],
      3600000,
    );
  assert.throws(() => openGroupControl(widened, b.identity), /audiência/);
});

test("fork proofs are served together and private snapshots at the fork are not re-encrypted", (t) => {
  const f = fixture(t),
    a = f.actor("Alice"),
    b = f.actor("Bruno");
  const id = a.registry.create(randomUUID(), "Group").groupId;
  enroll(a, b, id);
  const parent = a.registry.state(id).head!,
    snapshot = a.registry.privateState(id, parent.id)!,
    anchor = a.registry.anchor(id);
  const one = createGroupSuccessor(a.identity, anchor, parent, snapshot, {
    title: "One",
    members: snapshot.members,
    joins: [],
  });
  const two = createGroupSuccessor(a.identity, anchor, parent, snapshot, {
    title: "Two",
    members: snapshot.members,
    joins: [],
  });
  a.registry.observeHeaders(id, [one.epoch]);
  a.registry.observeSnapshot(id, one.epoch.id, one.snapshot);
  a.registry.observeHeaders(id, [two.epoch]);
  assert.equal(a.registry.state(id).status, "forked");
  const response = scoped(a, (g) =>
    requestedHeaders(
      g,
      headers(
        id,
        a.identity.public.id,
        parent.body.number,
        parent.id,
        one.epoch.body.number,
      ),
      b.identity.public,
    ),
  );
  assert.deepEqual(
    new Set(response.headers.map((h) => h.id)),
    new Set([one.epoch.id, two.epoch.id]),
  );
  assert.throws(
    () =>
      scoped(a, (g) => snapshotCarrier(g, a.identity, one.epoch, one.snapshot)),
    /conflito/,
  );
  assert.equal(
    canonical(
      scoped(a, (g) => snapshotCarrier(g, a.identity, parent, snapshot))
        .manifest.keys.map((k) => k.reader)
        .sort(),
    ),
    canonical(snapshot.members.map((m) => m.id).sort()),
  );
});
