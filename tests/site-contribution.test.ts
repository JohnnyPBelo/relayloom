import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createIdentity,
  createBundle,
  decryptBundle,
  verifyBundle,
  canonical,
} from "../packages/core/src/index";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
import { browserCertificateCrypto } from "../packages/browser/src/certificate-crypto";
import {
  createSiteContributionProtocol,
  SITE_CONTRIBUTION_LIMITS,
  type ContributionFormContext,
  type ContributionRequest,
} from "../packages/sites/src/contribution-protocol";
import {
  siteAddress,
  createSiteRevisionProtocol,
} from "../packages/sites/src/protocol";
import {
  parseSiteForm,
  parseContributionValues,
  bindSiteForm,
  matchContributionValues,
  type SiteForm,
} from "../packages/content/src/site-form";
import type { SiteTable } from "../packages/content/src/site-data";

const node = createSiteContributionProtocol(nodeCertificateCrypto);
const portable = createSiteContributionProtocol(browserCertificateCrypto);
const owner = createIdentity("Dona da página"),
  visitor = createIdentity("Visitante 🧶"),
  outsider = createIdentity("Outro leitor");
const now = Date.now();
const form: SiteForm = {
  domain: "relayloom/site-form/1",
  table: { pageId: "home", blockId: "directory" },
  fields: [
    { column: "name", required: true },
    { column: "vacancies", required: true },
    { column: "accessible", required: true },
    { column: "date", required: false },
    { column: "website", required: false },
  ],
  contributors: [visitor.public.id],
};
const table: SiteTable = {
  domain: "relayloom/site-table/1",
  columns: [
    { id: "name", label: "Nome", type: "text" },
    { id: "vacancies", label: "Vagas", type: "number" },
    { id: "accessible", label: "Acessível", type: "boolean" },
    { id: "date", label: "Data", type: "date" },
    { id: "website", label: "Site", type: "link" },
  ],
  rows: [],
};
const values = {
  name: "Centro comunitário",
  vacancies: 0,
  accessible: false,
  date: null,
  website: "https://example.org/local",
};
const privateScope = [owner.public.id, visitor.public.id].sort();
function context(): ContributionFormContext {
  return {
    target: {
      site: siteAddress(owner.public.id, "profile"),
      snapshotId: "a".repeat(64),
      revisionId: "b".repeat(64),
      pageId: "home",
      formId: "visitor-entry",
    },
    form: structuredClone(form),
    table: structuredClone(table),
    siteScope: [...privateScope],
    snapshotExpires: now + 60_000,
  };
}
function request(c = context()): ContributionRequest {
  return {
    target: c.target,
    schemaHash: node.schemaHash(c.form, c.table),
    operationId: randomUUID(),
    created: now - 1_000,
    expires: now + 30_000,
    values: structuredClone(values),
    publicationScope: [...privateScope],
  };
}
test("declarative form binds all typed columns, preserves zero/false and never executes values", () => {
  assert.deepEqual(matchContributionValues(form, table, values), values);
  assert.equal(
    matchContributionValues(form, table, {
      ...values,
      name: "<script>not executable</script>",
    }).name,
    "<script>not executable</script>",
  );
  for (const edit of [
    (v: any) => (v.name = null),
    (v: any) => (v.name = " \n"),
    (v: any) => (v.vacancies = "0"),
    (v: any) => (v.accessible = 0),
    (v: any) => (v.date = "2026-02-30"),
    (v: any) => (v.website = "javascript:alert(1)"),
    (v: any) => (v.extra = "unknown"),
    (v: any) => delete v.date,
  ]) {
    const v: any = structuredClone(values);
    edit(v);
    assert.throws(() => matchContributionValues(form, table, v));
  }
  const wrong = structuredClone(form);
  wrong.fields.reverse();
  assert.throws(() => bindSiteForm(wrong, table));
  const returned = parseSiteForm(form);
  returned.fields[0].required = false;
  assert.equal(form.fields[0].required, true);
  const rows = structuredClone(table);
  rows.rows.push({ id: "existing", values });
  assert.equal(
    node.schemaHash(form, table),
    node.schemaHash(form, rows),
    "rows are part of the snapshot, not the form schema",
  );
  for (const mutate of [
    (f: any) => (f.fields[0].required = false),
    (f: any) => (f.table.blockId = "elsewhere"),
    (f: any) => (f.contributors = "readers"),
  ]) {
    const changed = structuredClone(form);
    mutate(changed);
    assert.notEqual(
      node.schemaHash(form, table),
      node.schemaHash(changed, table),
    );
  }
});
test("form and value parsing reject active accessors, sparse lists, unknown fields and oversized inputs", () => {
  let invoked = false;
  const getter = { ...form };
  Object.defineProperty(getter, "fields", {
    get() {
      invoked = true;
      throw Error("getter executed");
    },
    enumerable: true,
  });
  assert.throws(() => parseSiteForm(getter));
  assert.equal(invoked, false);
  const sparse = structuredClone(form);
  delete (sparse.fields as any)[1];
  assert.throws(() => parseSiteForm(sparse));
  const arrayGetter = structuredClone(form);
  Object.defineProperty(arrayGetter.fields, "0", {
    get() {
      invoked = true;
      return form.fields[0];
    },
    enumerable: true,
  });
  assert.throws(() => parseSiteForm(arrayGetter));
  assert.equal(invoked, false);
  for (const change of [
    (f: any) => (f.script = "remote"),
    (f: any) => (f.table.url = "https://example.org"),
    (f: any) => (f.fields[0].column = "../bad"),
    (f: any) => f.fields.push(f.fields[0]),
    (f: any) => (f.fields = Array(13).fill(f.fields[0])),
    (f: any) => (f.contributors = []),
    (f: any) => (f.contributors = [visitor.public.id, visitor.public.id]),
    (f: any) => (f.contributors = "public"),
  ]) {
    const f = structuredClone(form);
    change(f);
    assert.throws(() => parseSiteForm(f));
  }
  const cells = { ...values };
  Object.defineProperty(cells, "name", {
    get() {
      invoked = true;
      return "x";
    },
    enumerable: true,
  });
  assert.throws(() => parseContributionValues(cells));
  assert.equal(invoked, false);
  for (const v of [
    { x: "x".repeat(1001) },
    { x: Number.NaN },
    { x: Infinity },
    { x: Number.MAX_SAFE_INTEGER + 1 },
    { x: {} },
    { x: undefined },
    [],
    Object.create(null),
  ])
    assert.throws(() => parseContributionValues(v));
  const symbol = { name: "x", [Symbol("hidden")]: 1 };
  assert.throws(() => parseContributionValues(symbol));
});
for (const [label, protocol] of [
  ["Node", node],
  ["portable", portable],
] as const) {
  test(`${label} visitor signatures verify across adapters but cannot become owner revisions`, () => {
    const c = context(),
      input = request(c),
      signed = protocol.create(visitor, input);
    assert.deepEqual(node.verifyForForm(signed, c, now), signed);
    assert.deepEqual(portable.verifyForForm(signed, c, now), signed);
    assert.deepEqual(
      node.create(visitor, input),
      portable.create(visitor, input),
    );
    assert.equal(signed.body.contributor.id, visitor.public.id);
    assert.throws(() =>
      createSiteRevisionProtocol(nodeCertificateCrypto).verifyRevision(signed),
    );
    assert.throws(() =>
      protocol.create({ ...visitor, signSecret: owner.signSecret }, input),
    );
    assert.throws(() =>
      protocol.create({ ...visitor, signSecret: visitor.boxSecret }, input),
    );
    const inspected = protocol.verify(signed);
    inspected.body.values.name = "Changed only copy";
    assert.equal(signed.body.values.name, values.name);
    input.values.name = "After signing";
    assert.equal(signed.body.values.name, values.name);
    for (const mutate of [
      (v: any) => (v.body.values.name = "Forged"),
      (v: any) => (v.body.publicationScope = "public"),
      (v: any) =>
        (v.body.target.site = siteAddress(outsider.public.id, "profile")),
      (v: any) => (v.body.operationId = randomUUID()),
      (v: any) => (v.body.schemaHash = "c".repeat(64)),
      (v: any) => (v.body.contributor = owner.public),
      (v: any) => (v.body.domain = "relayloom/site-snapshot/1"),
    ]) {
      const forged = structuredClone(signed);
      mutate(forged);
      forged.id = nodeCertificateCrypto.hash(canonical(forged.body));
      assert.throws(() => protocol.verify(forged));
    }
    const extra = { ...signed, approved: true };
    assert.throws(() => protocol.verify(extra));
    const noProof = structuredClone(signed);
    noProof.body.contributor.proof = "";
    assert.throws(() => protocol.verify(noProof));
  });
}
test("site/form/schema/base and the visitor's maximum publication audience are bound independently", () => {
  const c = context(),
    signed = node.create(visitor, request(c));
  for (const mutate of [
    (v: any) => (v.target.snapshotId = "c".repeat(64)),
    (v: any) => (v.target.revisionId = "c".repeat(64)),
    (v: any) => (v.target.pageId = "other"),
    (v: any) => (v.target.formId = "other"),
    (v: any) => (v.form.table.blockId = "other"),
    (v: any) => (v.table.columns[0].type = "number"),
    (v: any) => (v.siteScope = "public"),
    (v: any) => (v.snapshotExpires = now + 1),
  ]) {
    const changed = structuredClone(c);
    mutate(changed);
    assert.throws(() => node.verifyForForm(signed, changed, now));
  }
  const publicContext = { ...c, siteScope: "public" as const };
  const publicConsent = node.create(visitor, {
    ...request(publicContext),
    publicationScope: "public",
  });
  assert.doesNotThrow(() =>
    node.verifyForForm(publicConsent, publicContext, now),
  );
  const denied = {
    ...c,
    form: { ...c.form, contributors: [outsider.public.id] },
  };
  assert.throws(() =>
    node.verifyForForm(node.create(visitor, request(denied)), denied, now),
  );
  const readerForm = {
    ...c,
    form: { ...c.form, contributors: "readers" as const },
  };
  const byReader = node.create(visitor, request(readerForm));
  assert.doesNotThrow(() => node.verifyForForm(byReader, readerForm, now));
  assert.throws(() =>
    node.verifyForForm(
      byReader,
      { ...readerForm, siteScope: [owner.public.id] },
      now,
    ),
  );
  const requested = request(c);
  requested.publicationScope = [owner.public.id];
  assert.throws(() => node.create(visitor, requested));
});
test("expiry and clock checks apply to admission, while historical signatures stay verifiable", () => {
  const c = context(),
    q = request(c),
    cert = node.create(visitor, q);
  assert.doesNotThrow(() => node.verify(cert));
  assert.throws(() => node.verifyForForm(cert, c, q.expires));
  assert.throws(() =>
    node.verifyForForm(
      cert,
      c,
      q.created - SITE_CONTRIBUTION_LIMITS.clockSkewMs - 1,
    ),
  );
  for (const protocol of [node, portable]) {
    for (const skew of [1, 60_000, SITE_CONTRIBUTION_LIMITS.clockSkewMs])
      assert.doesNotThrow(() =>
        protocol.verifyForForm(cert, c, q.created - skew),
      );
    assert.throws(() => protocol.verifyForForm(cert, c, q.expires));
  }
  for (const edit of [
    (v: any) => (v.expires = v.created),
    (v: any) => (v.created = -1),
    (v: any) => (v.expires = Number.MAX_SAFE_INTEGER + 1),
    (v: any) =>
      (v.expires = v.created + SITE_CONTRIBUTION_LIMITS.lifetimeMs + 1),
    (v: any) => (v.operationId = "00000000-0000-0000-0000-000000000000"),
  ]) {
    const input = request(c);
    edit(input);
    assert.throws(() => node.create(visitor, input));
  }
});
test("private submission remains encrypted even when the visitor consents to later public adoption", () => {
  const c = context(),
    signed = node.create(visitor, {
      ...request(c),
      publicationScope: "public",
    });
  const bundle = createBundle(visitor, "site-contribution", signed, [
    owner.public,
  ]);
  verifyBundle(bundle);
  assert.equal(bundle.manifest.publicKey, null);
  assert.deepEqual(
    bundle.manifest.keys.map((k) => k.reader).sort(),
    privateScope,
  );
  const decoded = decryptBundle(bundle, owner);
  assert.deepEqual(node.verify(decoded), signed);
  assert.deepEqual(portable.verify(decryptBundle(bundle, visitor)), signed);
  assert.throws(() => decryptBundle(bundle, outsider));
  assert.equal(JSON.stringify(bundle).includes(values.name), false);
});
