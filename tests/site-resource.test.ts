import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createBundle,
  createIdentity,
  decryptBundle,
  verifyBundle,
} from "../packages/core/src/index";
import { canonical } from "../packages/core/src/protocol";
import { authoredTable } from "./fixtures/site-table";
import {
  describeSiteResource,
  matchSiteResource,
  parseSiteResource,
  parseSiteResourceReference,
  resourceScopeCoversSite,
  SITE_RESOURCE_LIMITS,
  summarizeSiteResource,
} from "../packages/content/src/site-resource";
const table = () => ({
  type: "site-resource",
  domain: "relayloom/site-resource/1",
  name: "Locais da comunidade",
  kind: "table",
  table: authoredTable(),
});
const file = (data = "Zg==") => ({
  type: "site-resource",
  domain: "relayloom/site-resource/1",
  name: "Guia.txt",
  kind: "file",
  mime: "text/plain",
  data,
});
const envelope = {
  id: "a".repeat(64),
  authorId: "b".repeat(64),
  kind: "site-resource",
};
test("a table descriptor pins its complete canonical payload and returns owned data", () => {
  const source = table(),
    before = canonical(source),
    ref = describeSiteResource(source, envelope);
  assert.equal(ref.mime, "application/vnd.relayloom.table+json");
  assert.equal(ref.bytes, Buffer.byteLength(canonical(source.table)));
  assert.deepEqual(matchSiteResource(ref, source, envelope), source);
  const summary = summarizeSiteResource(source);
  assert.equal(summary.payloadHash, ref.payloadHash);
  assert.equal(Object.hasOwn(summary, "table"), false);
  assert.equal(Object.hasOwn(summary, "data"), false);
  assert.throws(
    () => parseSiteResource(summary),
    "summary must never become publishable input",
  );
  const opened = matchSiteResource(ref, source, envelope);
  assert.equal(opened.kind, "table");
  if (opened.kind === "table") opened.table.rows[0].values.water = 0;
  assert.equal(canonical(source), before);
  for (const field of ["bundleId", "authorId", "payloadHash"] as const)
    assert.throws(() =>
      matchSiteResource({ ...ref, [field]: "c".repeat(64) }, source, envelope),
    );
  assert.throws(() =>
    matchSiteResource({ ...ref, name: "Outro nome" }, source, envelope),
  );
  assert.throws(() =>
    matchSiteResource({ ...ref, bytes: ref.bytes + 1 }, source, envelope),
  );
  const changed = table();
  changed.table.rows[0].values.water = 900;
  assert.throws(() => matchSiteResource(ref, changed, envelope));
});
test("verification of real encrypted envelopes precedes descriptor matching; a reader's valid signature cannot replace the referenced author", () => {
  const author = createIdentity("Autora do recurso"),
    reader = createIdentity("Leitor"),
    stranger = createIdentity("Sem acesso");
  const value = table(),
    bundle = createBundle(author, "site-resource", value, [
      author.public,
      reader.public,
    ]);
  verifyBundle(bundle);
  const metadata = {
    id: bundle.manifest.id,
    authorId: bundle.manifest.author.id,
    kind: bundle.manifest.kind,
  };
  const ref = describeSiteResource(decryptBundle(bundle, author), metadata);
  assert.deepEqual(
    matchSiteResource(ref, decryptBundle(bundle, reader), metadata),
    value,
  );
  assert.throws(() => decryptBundle(bundle, stranger));
  const copy = createBundle(reader, "site-resource", value, "public");
  verifyBundle(copy);
  assert.throws(() =>
    matchSiteResource(ref, decryptBundle(copy), {
      id: copy.manifest.id,
      authorId: copy.manifest.author.id,
      kind: copy.manifest.kind,
    }),
  );
  const damaged = structuredClone(bundle),
    hash = damaged.manifest.chunks[0].hash;
  damaged.chunks[hash] =
    (damaged.chunks[hash][0] === "A" ? "B" : "A") +
    damaged.chunks[hash].slice(1);
  assert.throws(() => verifyBundle(damaged));
});
test("files have canonical base64, exact decoded boundaries and no executable rendering type", () => {
  assert.equal(describeSiteResource(file(), envelope).bytes, 1);
  assert.equal(describeSiteResource(file(""), envelope).bytes, 0);
  const maximum = file(
    Buffer.alloc(SITE_RESOURCE_LIMITS.fileBytes, 0x78).toString("base64"),
  );
  assert.equal(
    describeSiteResource(maximum, envelope).bytes,
    SITE_RESOURCE_LIMITS.fileBytes,
  );
  assert.throws(() =>
    parseSiteResource(
      file(Buffer.alloc(SITE_RESOURCE_LIMITS.fileBytes + 1).toString("base64")),
    ),
  );
  for (const data of ["Zh==", "Zg", "Zg==\n", "Z==g", "🎒", "----"])
    assert.throws(() => parseSiteResource(file(data)), data);
  for (const mime of [
    "text/html",
    "image/svg+xml",
    "application/javascript",
    "application/xhtml+xml",
    "TEXT/PLAIN",
    "text/plain;charset=utf-8",
  ])
    assert.throws(() => parseSiteResource({ ...file(), mime }), mime);
  for (const name of [
    "",
    " ",
    ".",
    "..",
    "../Guia.txt",
    "folder\\file",
    "file\0x",
    "x".repeat(151),
  ])
    assert.throws(() => parseSiteResource({ ...file(), name }));
  for (const value of [
    { ...file(), script: "run()" },
    { ...table(), data: "Zg==" },
    { ...file(), kind: "table" },
    { ...table(), domain: "another-protocol/1" },
  ])
    assert.throws(() => parseSiteResource(value));
});
test("a private resource never becomes public by reference and reader sets cannot silently expand", () => {
  const alice = "a".repeat(64),
    bob = "b".repeat(64),
    carol = "c".repeat(64);
  assert.equal(resourceScopeCoversSite("public", "public"), true);
  assert.equal(resourceScopeCoversSite([alice], "public"), true);
  assert.equal(resourceScopeCoversSite([alice, bob], [alice, bob]), true);
  assert.equal(resourceScopeCoversSite([alice], [alice, bob]), true);
  assert.equal(resourceScopeCoversSite("public", [alice, bob]), false);
  assert.equal(
    resourceScopeCoversSite([alice, bob, carol], [alice, bob]),
    false,
  );
  for (const invalid of [
    [],
    [bob, alice],
    [alice, alice],
    ["user"],
    { public: true },
    new Array(2),
  ]) {
    assert.throws(() => resourceScopeCoversSite(invalid, "public"));
    assert.throws(() => resourceScopeCoversSite("public", invalid));
  }
});
test("descriptor and nested data getters are refused without access, including reader arrays", () => {
  let calls = 0;
  const getter = () => {
    calls++;
    return "value";
  };
  const resource = file();
  Object.defineProperty(resource, "data", { get: getter });
  assert.throws(() => parseSiteResource(resource));
  const reference = describeSiteResource(table(), envelope);
  Object.defineProperty(reference, "payloadHash", { get: getter });
  assert.throws(() => parseSiteResourceReference(reference));
  const badEnvelope = { ...envelope };
  Object.defineProperty(badEnvelope, "authorId", { get: getter });
  assert.throws(() => describeSiteResource(table(), badEnvelope));
  const readers = ["a".repeat(64)];
  Object.defineProperty(readers, "0", { get: getter });
  assert.throws(() => resourceScopeCoversSite(readers, "public"));
  assert.equal(calls, 0);
});
