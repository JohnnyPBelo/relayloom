import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createIdentity,
  createBundle,
  decryptBundle,
  canonical,
  validateIdentity,
} from "../packages/core/src/index";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
import {
  siteRevisions as node,
  siteAddress,
  parseSiteAddress,
  SITE_REVISION_LIMITS,
} from "../packages/sites/src/index";
import { browserSiteRevisions as portable } from "../packages/browser/src/site-revisions";
import type { createSiteRevisionProtocol } from "../packages/sites/src/protocol";
type Protocol = ReturnType<typeof createSiteRevisionProtocol>;
const payload = {
  title: "Um lugar na rede",
  pages: [{ title: "Início", body: "Texto da autora." }],
  attachments: [],
};

test("site addresses are stable under display/read-card changes and reject ambiguous input", () => {
  const owner = createIdentity("Alice");
  const address = siteAddress(owner.public.id, "profile");
  assert.deepEqual(parseSiteAddress(address), {
    ownerId: owner.public.id,
    name: "profile",
  });
  assert.equal(siteAddress(owner.public.id, "profile"), address);
  const newReadingKeys = createIdentity("Novas chaves de leitura");
  const card = {
    id: owner.public.id,
    name: "Nome actualizado",
    signKey: owner.public.signKey,
    boxKey: newReadingKeys.public.boxKey,
  };
  const updated = {
    ...owner,
    boxSecret: newReadingKeys.boxSecret,
    public: {
      ...card,
      proof: nodeCertificateCrypto.sign(owner, canonical(card)),
    },
  };
  assert.equal(validateIdentity(updated.public), true);
  assert.equal(siteAddress(updated.public.id, "profile"), address);
  const before = node.createSuccessor(
    owner,
    "profile",
    [],
    node.documentHash(payload),
  );
  const after = node.createSuccessor(
    updated,
    "profile",
    [before],
    node.documentHash(payload),
  );
  portable.verifyHistoryLink(after, before);
  assert.notEqual(
    siteAddress(createIdentity("Alice").public.id, "profile"),
    address,
  );
  assert.notEqual(siteAddress(owner.public.id, "other"), address);
  for (const name of [
    "",
    "../x",
    "Profile",
    "a/b",
    "a".repeat(41),
    "a?x",
    "a#x",
  ])
    assert.throws(() => siteAddress(owner.public.id, name));
  for (const value of [
    address + "/",
    address + "?v=1",
    address.toUpperCase(),
    address.replace("profile", "%70rofile"),
    null,
  ])
    assert.throws(() => parseSiteAddress(value));
});

for (const [label, protocol] of [
  ["node", node],
  ["portable", portable],
] as [string, Protocol][]) {
  test(`${label} signed snapshots bind the exact content and retain ownership when another reader can decrypt`, () => {
    const owner = createIdentity("Autora"),
      reader = createIdentity("Leitor");
    const hash = protocol.documentHash(payload);
    const revision = protocol.createRevision(owner, "profile", 1, [], hash);
    protocol.verifySnapshot(revision, payload, owner.public.id, "profile");
    const envelope = createBundle(owner, "site", { payload, revision }, [
      owner.public,
      reader.public,
    ]);
    const read = decryptBundle(envelope, reader) as {
      payload: typeof payload;
      revision: typeof revision;
    };
    assert.deepEqual(read.payload, payload);
    protocol.verifySnapshot(
      read.revision,
      read.payload,
      owner.public.id,
      "profile",
    );
    assert.throws(() =>
      protocol.verifySnapshot(
        revision,
        { ...payload, title: "forged" },
        owner.public.id,
        "profile",
      ),
    );
    assert.throws(() =>
      protocol.verifySnapshot(revision, payload, reader.public.id, "profile"),
    );
    assert.throws(() =>
      protocol.verifySnapshot(revision, payload, owner.public.id, "other"),
    );
    assert.throws(() =>
      protocol.createRevision(
        { ...owner, signSecret: owner.boxSecret },
        "profile",
        2,
        [revision.id],
        hash,
      ),
    );
    assert.throws(() =>
      protocol.createRevision(
        { ...owner, signSecret: reader.signSecret },
        "profile",
        2,
        [revision.id],
        hash,
      ),
    );
    const own = protocol.createRevision(
      reader,
      "profile",
      2,
      [revision.id],
      hash,
    );
    assert.throws(() =>
      protocol.verifySnapshot(own, payload, owner.public.id, "profile"),
    );
    owner.public.name = "Nome alterado depois da assinatura";
    assert.equal(revision.body.owner.name, "Autora");
    protocol.verifyRevision(revision);
  });

  test(`${label} orders revisions by signed sequence, reports forks and does not let replay replace a known head`, () => {
    const owner = createIdentity("Histórico");
    const first = protocol.createSuccessor(
      owner,
      "profile",
      [],
      protocol.documentHash(payload),
    );
    const a = protocol.createSuccessor(
      owner,
      "profile",
      [first],
      protocol.documentHash({ title: "Ramo A" }),
    );
    const b = protocol.createSuccessor(
      owner,
      "profile",
      [first],
      protocol.documentHash({ title: "Ramo B" }),
    );
    assert.notEqual(a.id, b.id);
    const conflict = protocol.classifyRevisions(owner.public.id, "profile", [
      a,
      first,
      b,
      a,
    ]);
    assert.equal(conflict.status, "conflict");
    assert.equal(conflict.number, 2);
    assert.equal(conflict.heads.length, 2);
    const resolution = protocol.createSuccessor(
      owner,
      "profile",
      conflict.heads,
      protocol.documentHash({ title: "Escolha da autora" }),
    );
    protocol.verifyHistoryLink(resolution, a);
    protocol.verifyHistoryLink(resolution, b);
    const current = protocol.classifyRevisions(owner.public.id, "profile", [
      resolution,
      b,
      a,
      first,
      first,
    ]);
    assert.equal(current.status, "head");
    assert.equal(current.number, 3);
    assert.equal(current.heads[0].id, resolution.id);
    assert.deepEqual(current.missingHistory, []);
    // A retained, authenticated header pins the known revision even when older
    // content is replayed or its predecessors' payloads have been evicted.
    const partial = protocol.classifyRevisions(owner.public.id, "profile", [
      first,
      resolution,
    ]);
    assert.equal(partial.heads[0].id, resolution.id);
    assert.deepEqual(partial.missingHistory, [a.id, b.id].sort());
    const foreign = protocol.createSuccessor(
      createIdentity("Outra pessoa"),
      "profile",
      [],
      protocol.documentHash(payload),
    );
    assert.throws(() => protocol.verifyHistoryLink(a, foreign));
    assert.throws(() =>
      protocol.createSuccessor(
        owner,
        "other",
        [a],
        protocol.documentHash(payload),
      ),
    );
    const reverse = protocol.createRevision(
      owner,
      "profile",
      2,
      [resolution.id],
      protocol.documentHash(payload),
    );
    assert.throws(() =>
      protocol.classifyRevisions(owner.public.id, "profile", [
        resolution,
        reverse,
      ]),
    );
  });

  test(`${label} rejects malformed certificates without invoking getters and enforces finite history/signature bounds`, () => {
    const owner = createIdentity("Limites"),
      hash = protocol.documentHash(payload);
    const valid = protocol.createRevision(owner, "profile", 1, [], hash);
    for (const change of [
      (r: any) => (r.body.number = 0),
      (r: any) => (r.body.domain = "relayloom/group-epoch/1"),
      (r: any) => (r.body.extra = true),
      (r: any) => (r.signature = r.signature.slice(0, -1) + " "),
      (r: any) => (r.id = "0".repeat(64)),
      (r: any) => (r.body.previous = Array(2)),
    ]) {
      const candidate = structuredClone(valid);
      change(candidate);
      assert.throws(() => protocol.verifyRevision(candidate));
    }
    let called = false;
    const getter = { ...valid, body: { ...valid.body } };
    Object.defineProperty(getter.body, "owner", {
      enumerable: true,
      get() {
        called = true;
        return owner.public;
      },
    });
    assert.throws(() => protocol.verifyRevision(getter));
    assert.equal(called, false);
    const ids = Array.from({ length: 16 }, (_, index) =>
      index.toString(16).padStart(64, "0"),
    );
    protocol.verifyRevision(
      protocol.createRevision(owner, "profile", 2, ids, hash),
    );
    assert.throws(() =>
      protocol.createRevision(
        owner,
        "profile",
        2,
        [...ids, "f".repeat(64)],
        hash,
      ),
    );
    assert.throws(() =>
      protocol.createRevision(owner, "profile", 2, [...ids].reverse(), hash),
    );
    assert.throws(() =>
      protocol.createRevision(owner, "profile", 2, [ids[0], ids[0]], hash),
    );
    assert.throws(() =>
      protocol.classifyRevisions(
        owner.public.id,
        "profile",
        Array(SITE_REVISION_LIMITS.headers + 1).fill(valid),
      ),
    );
    assert.throws(() =>
      protocol.documentHash("x".repeat(SITE_REVISION_LIMITS.payloadBytes + 1)),
    );
    const last = protocol.createRevision(
      owner,
      "profile",
      SITE_REVISION_LIMITS.sequence,
      [],
      hash,
    );
    assert.throws(() =>
      protocol.createSuccessor(owner, "profile", [last], hash),
    );
  });
}

test("Node and portable crypto produce identical snapshot bytes/signatures and verify each other", () => {
  const owner = createIdentity("Interop — 🌿");
  assert.equal(node.documentHash(payload), portable.documentHash(payload));
  const a = node.createRevision(
    owner,
    "profile",
    1,
    [],
    node.documentHash(payload),
  );
  const b = portable.createRevision(
    owner,
    "profile",
    1,
    [],
    portable.documentHash(payload),
  );
  assert.deepEqual(a, b);
  node.verifySnapshot(b, payload, owner.public.id, "profile");
  portable.verifySnapshot(a, payload, owner.public.id, "profile");
});
