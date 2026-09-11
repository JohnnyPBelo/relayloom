import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCollectionCommand,
  followedFeed,
  requireContentId,
  SOCIAL_LIMITS,
  validateCollections,
  validateFollowing,
  type Collection,
  type CollectionCommand,
} from "../apps/node/src/social.js";
import {
  createBundle,
  createIdentity,
  decryptBundle,
  verifyBundle,
} from "../packages/core/src/index.js";

const owner = "a".repeat(64),
  other = "b".repeat(64);
const uuid = (n: number) =>
  `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
const contentId = (n: number) => n.toString(16).padStart(64, "0");
const collection = (n: number, objectIds: string[] = []): Collection => ({
  id: uuid(n),
  ownerId: owner,
  title: `Collection ${n}`,
  objectIds,
  createdAt: 10,
  updatedAt: 10,
});

test("collection create, rename, add, remove and delete are immutable local transitions", () => {
  const initial = Object.freeze([] as Collection[]);
  const created = applyCollectionCommand(
    initial,
    owner,
    { action: "create", id: uuid(1), title: "  Abrigos  " },
    10,
  );
  assert.equal(initial.length, 0);
  assert.equal(created[0].title, "Abrigos");
  assert.equal(created[0].ownerId, owner);
  Object.freeze(created[0].objectIds);
  Object.freeze(created[0]);
  Object.freeze(created);
  const added = applyCollectionCommand(
    created,
    owner,
    { action: "add", id: uuid(1), objectId: contentId(1) },
    20,
  );
  assert.deepEqual(created[0].objectIds, []);
  assert.deepEqual(added[0].objectIds, [contentId(1)]);
  assert.equal(added[0].createdAt, 10);
  assert.equal(added[0].updatedAt, 20);
  const renamed = applyCollectionCommand(
    added,
    owner,
    { action: "rename", id: uuid(1), title: "Pontos seguros" },
    30,
  );
  assert.equal(added[0].title, "Abrigos");
  assert.equal(renamed[0].title, "Pontos seguros");
  const removed = applyCollectionCommand(
    renamed,
    owner,
    { action: "remove", id: uuid(1), objectId: contentId(1) },
    40,
  );
  assert.deepEqual(removed[0].objectIds, []);
  assert.deepEqual(renamed[0].objectIds, [contentId(1)]);
  assert.deepEqual(
    applyCollectionCommand(
      removed,
      owner,
      { action: "delete", id: uuid(1) },
      50,
    ),
    [],
  );
  assert.equal(removed.length, 1);
});

test("collection identity, title and timestamp rules reject ambiguous metadata", () => {
  const base = [collection(1)];
  for (const id of [
    "../../private-state.json",
    "__proto__",
    "constructor",
    contentId(1),
    uuid(1).toUpperCase().replace("4000", "F000"),
  ]) {
    assert.throws(() =>
      applyCollectionCommand(
        base,
        owner,
        { action: "rename", id, title: "Valid" },
        20,
      ),
    );
  }
  for (const name of [
    "",
    " \t ",
    "a".repeat(65),
    "first\nsecond",
    "nul\u0000value",
  ]) {
    assert.throws(() =>
      applyCollectionCommand(
        base,
        owner,
        { action: "rename", id: uuid(1), title: name },
        20,
      ),
    );
  }
  for (const now of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() =>
      applyCollectionCommand(
        base,
        owner,
        { action: "delete", id: uuid(1) },
        now,
      ),
    );
  }
  const renamed = applyCollectionCommand(
    base,
    owner,
    { action: "rename", id: uuid(1), title: "Clock moved back" },
    5,
  );
  assert.equal(renamed[0].updatedAt, 10);
  const accent = applyCollectionCommand(
    [],
    owner,
    { action: "create", id: uuid(1), title: "Café" },
    10,
  );
  assert.throws(
    () =>
      applyCollectionCommand(
        accent,
        owner,
        { action: "create", id: uuid(2), title: " CAFE\u0301 " },
        10,
      ),
    /existe/,
  );
  assert.throws(
    () => validateCollections([{ ...collection(1), updatedAt: 0 }], owner),
    /Datas/,
  );
  assert.throws(
    () =>
      applyCollectionCommand(
        base,
        owner,
        { action: "remove", id: uuid(2), objectId: contentId(1) },
        20,
      ),
    /indisponível/,
  );
});

test("prototype, accessor, unknown field and sparse-array inputs fail without executing metadata", () => {
  let reads = 0;
  const inherited = Object.create({
    action: "delete",
    id: uuid(1),
  }) as CollectionCommand;
  const accessor = Object.defineProperty({ id: uuid(1) }, "action", {
    enumerable: true,
    get: () => {
      reads++;
      return "delete";
    },
  }) as CollectionCommand;
  const pollution = JSON.parse(
    `{"action":"delete","id":"${uuid(1)}","__proto__":{"socialPollution":true}}`,
  );
  for (const command of [
    inherited,
    accessor,
    pollution,
    { action: "delete", id: uuid(1), ownerId: other },
    { action: "rename", id: uuid(1), title: "Valid", constructor: "override" },
  ]) {
    assert.throws(() =>
      applyCollectionCommand(
        [collection(1)],
        owner,
        command as CollectionCommand,
        20,
      ),
    );
  }
  const item = Object.defineProperty(collection(1), "title", {
    enumerable: true,
    get: () => {
      reads++;
      return "Invalid";
    },
  });
  const ids = [contentId(1)];
  Object.defineProperty(ids, "0", {
    get: () => {
      reads++;
      return contentId(1);
    },
  });
  const sparse = new Array<string>(1),
    extended = [contentId(1)];
  Object.defineProperty(extended, "__proto__", { value: {}, enumerable: true });
  for (const input of [
    [item],
    [{ ...collection(1), objectIds: ids }],
    [{ ...collection(1), objectIds: sparse }],
    [{ ...collection(1), objectIds: extended }],
    Object.create([collection(1)]),
  ]) {
    assert.throws(() => validateCollections(input, owner));
  }
  assert.equal(reads, 0);
  assert.equal((Object.prototype as any).socialPollution, undefined);
});

test("collection ownership cannot be transferred by a command or mixed across identity vaults", () => {
  const base = [collection(1)],
    before = structuredClone(base);
  for (const command of [
    { action: "rename", id: uuid(1), title: "Other owner" },
    { action: "delete", id: uuid(1) },
    { action: "add", id: uuid(1), objectId: contentId(1) },
  ] as CollectionCommand[])
    assert.throws(
      () => applyCollectionCommand(base, other, command, 20),
      /identidade/,
    );
  assert.throws(
    () =>
      validateCollections(
        [collection(1), { ...collection(2), ownerId: other }],
        owner,
      ),
    /identidade/,
  );
  assert.throws(() =>
    applyCollectionCommand(
      base,
      owner,
      {
        action: "rename",
        id: uuid(1),
        title: "Valid",
        ownerId: other,
      } as CollectionCommand,
      20,
    ),
  );
  assert.deepEqual(base, before);
});

test("collection and membership quotas reject atomically while allowing idempotent operations", () => {
  const fullCollections = Array.from(
    { length: SOCIAL_LIMITS.collections },
    (_, i) => collection(i + 1),
  );
  const before = structuredClone(fullCollections);
  assert.throws(
    () =>
      applyCollectionCommand(
        fullCollections,
        owner,
        { action: "create", id: uuid(33), title: "Overflow" },
        20,
      ),
    /Limite/,
  );
  assert.deepEqual(fullCollections, before);
  const fullItems = [
    collection(
      1,
      Array.from({ length: SOCIAL_LIMITS.collectionItems }, (_, i) =>
        contentId(i),
      ),
    ),
  ];
  assert.throws(
    () =>
      applyCollectionCommand(
        fullItems,
        owner,
        { action: "add", id: uuid(1), objectId: contentId(257) },
        20,
      ),
    /Limite/,
  );
  assert.deepEqual(
    applyCollectionCommand(
      fullItems,
      owner,
      { action: "add", id: uuid(1), objectId: contentId(0) },
      20,
    ),
    fullItems,
  );
  assert.deepEqual(
    applyCollectionCommand(
      fullItems,
      owner,
      { action: "remove", id: uuid(1), objectId: contentId(300) },
      20,
    ),
    fullItems,
  );
  const total = Array.from({ length: 8 }, (_, c) =>
    collection(
      c + 1,
      Array.from({ length: 256 }, (_, i) => contentId(c * 256 + i)),
    ),
  );
  total.push(collection(9));
  assert.throws(
    () =>
      applyCollectionCommand(
        total,
        owner,
        { action: "add", id: uuid(9), objectId: contentId(0) },
        20,
      ),
    /total/,
  );
  const released = applyCollectionCommand(
    total,
    owner,
    { action: "remove", id: uuid(1), objectId: contentId(0) },
    20,
  );
  const added = applyCollectionCommand(
    released,
    owner,
    { action: "add", id: uuid(9), objectId: contentId(1) },
    30,
  );
  assert.equal(
    added.reduce((sum, c) => sum + c.objectIds.length, 0),
    SOCIAL_LIMITS.totalCollectionItems,
  );
  assert.equal(total[0].objectIds.length, 256);
  assert.deepEqual(total[8].objectIds, []);
});

test("recovered collections reject duplicate identifiers, titles, members and excessive total memberships", () => {
  assert.throws(() =>
    validateCollections(
      [collection(1), { ...collection(2), id: uuid(1) }],
      owner,
    ),
  );
  assert.throws(() =>
    validateCollections(
      [collection(1), { ...collection(2), title: " COLLECTION 1 " }],
      owner,
    ),
  );
  assert.throws(() =>
    validateCollections([collection(1, [contentId(1), contentId(1)])], owner),
  );
  const tooMany = Array.from({ length: 9 }, (_, c) =>
    collection(
      c + 1,
      Array.from({ length: 256 }, (_, i) => contentId(i)),
    ),
  );
  assert.throws(() => validateCollections(tooMany, owner), /total/);
  const original = [collection(1, [contentId(1)])],
    validated = validateCollections(original, owner);
  validated[0].objectIds.push(contentId(2));
  assert.deepEqual(original[0].objectIds, [contentId(1)]);
});

test("content references remain canonical hashes and convey neither reader access nor authorship", () => {
  for (const value of [
    "../../vault",
    "__proto__",
    "https://example.org/" + contentId(1),
    contentId(1) + "\n",
    "A".repeat(64),
    1,
    null,
    new String(contentId(1)),
  ]) {
    assert.throws(() => requireContentId(value));
  }
  const alice = createIdentity("Author"),
    bob = createIdentity("Authorized reader"),
    eve = createIdentity("Reference holder");
  const bundle = createBundle(
      alice,
      "post",
      { type: "post", text: "Private original" },
      [bob.public],
    ),
    original = structuredClone(bundle);
  let metadata = applyCollectionCommand(
    [],
    eve.public.id,
    { action: "create", id: uuid(1), title: "References" },
    10,
  );
  metadata = applyCollectionCommand(
    metadata,
    eve.public.id,
    {
      action: "add",
      id: uuid(1),
      objectId: requireContentId(bundle.manifest.id),
    },
    20,
  );
  assert.equal(metadata[0].ownerId, eve.public.id);
  assert.equal(bundle.manifest.author.id, alice.public.id);
  assert.deepEqual(bundle, original);
  verifyBundle(bundle);
  assert.deepEqual(decryptBundle(bundle, bob), {
    type: "post",
    text: "Private original",
  });
  assert.throws(() => decryptBundle(bundle, eve), /autorização/);
});

test("followed feed selects posts and alerts from followed authors without changing caller order or access", () => {
  const objects = [
    {
      id: "private-authorized",
      kind: "post",
      author: { id: owner },
      public: false,
    },
    { id: "other", kind: "post", author: { id: other }, public: true },
    { id: "message", kind: "message", author: { id: owner }, public: false },
    { id: "alert", kind: "alert", author: { id: owner }, public: true },
  ];
  const before = structuredClone(objects);
  assert.deepEqual(
    followedFeed(objects, [owner]).map((o) => o.id),
    ["private-authorized", "alert"],
  );
  assert.deepEqual(followedFeed(objects, []), []);
  assert.deepEqual(objects, before);
  assert.throws(() => validateFollowing([owner, owner]), /repetidas/);
  assert.throws(() => validateFollowing(["../../identity.vault"]));
  assert.throws(
    () =>
      validateFollowing(
        Array.from({ length: SOCIAL_LIMITS.following + 1 }, (_, i) =>
          contentId(i),
        ),
      ),
    /Limite/,
  );
  assert.deepEqual(validateFollowing([owner, other]), [owner, other]);
});
