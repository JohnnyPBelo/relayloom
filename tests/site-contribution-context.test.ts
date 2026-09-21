import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import {
  ContentStore,
  createIdentity,
  createBundle,
  decryptBundle,
  canonical,
} from "../packages/core/src/index";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
import { browserCertificateCrypto } from "../packages/browser/src/certificate-crypto";
import { createSiteContentProtocol } from "../packages/sites/src/content";
import {
  createContributionContextResolver,
  parseContributionFormLookup,
} from "../packages/sites/src/contribution-context";
import { readContributionForm } from "../apps/node/src/contribution-read";
import { formPayload, formRowSentinel } from "./fixtures/site-form";
import { projectTemp } from "./project-temp";
const sites = createSiteContentProtocol(nodeCertificateCrypto);

test("form query is a copied closed locator, never executable input or caller-supplied permission", () => {
  const q = {
    action: "form",
    snapshotId: "a".repeat(64),
    pageId: "entry",
    formId: "form",
  };
  const owned = parseContributionFormLookup(q);
  q.formId = "changed";
  assert.equal(owned.formId, "form");
  for (const value of [
    { ...q, context: {} },
    { ...q, form: {} },
    { ...q, contributors: "readers" },
    { ...q, action: "submit" },
    { ...q, snapshotId: "bad" },
    { ...q, pageId: "../entry" },
  ])
    assert.throws(() => parseContributionFormLookup(value));
  let called = false;
  const accessor = { ...q };
  Object.defineProperty(accessor, "formId", {
    enumerable: true,
    get() {
      called = true;
      return "form";
    },
  });
  assert.throws(() => parseContributionFormLookup(accessor));
  assert.equal(called, false);
});

test("real snapshot lookup authenticates author, reader access and visitor policy without returning table rows", () => {
  const owner = createIdentity("Dona"),
    visitor = createIdentity("Visitante"),
    stranger = createIdentity("Outra pessoa"),
    folder = projectTemp("form-context-"),
    store = new ContentStore(folder);
  try {
    const content = sites.create(
      owner,
      "profile",
      1,
      [],
      formPayload([visitor.public.id]),
    );
    const publicBundle = createBundle(owner, "site", content, "public"),
      privateBundle = createBundle(owner, "site", content, [visitor.public]);
    store.put(publicBundle);
    store.put(privateBundle);
    const lookup = {
      action: "form",
      snapshotId: publicBundle.manifest.id,
      pageId: "entry",
      formId: "form",
    };
    let blocked: string[] = [],
      withdrawn = false;
    const context = {
      identity: visitor,
      store,
      blocked: () => blocked,
      withdrawn: () => withdrawn,
    };
    const view = readContributionForm(lookup, context);
    assert.equal(view.owner.id, owner.public.id);
    assert.equal(view.target.revisionId, content.siteRevision.id);
    assert.deepEqual(
      view.fields.map((f) => [f.id, f.type, f.required]),
      [
        ["name", "text", true],
        ["count", "number", false],
        ["open", "boolean", true],
      ],
    );
    assert.equal(JSON.stringify(view).includes(formRowSentinel), false);
    assert.equal(Object.hasOwn(view, "table"), false);
    assert.deepEqual(
      readContributionForm(
        { ...lookup, snapshotId: privateBundle.manifest.id },
        context,
      ).siteScope,
      [owner.public.id, visitor.public.id].sort(),
    );
    assert.throws(() =>
      readContributionForm(
        { ...lookup, snapshotId: privateBundle.manifest.id },
        { ...context, identity: stranger },
      ),
    );
    assert.throws(() =>
      readContributionForm(lookup, { ...context, identity: stranger }),
    );
    assert.throws(() =>
      readContributionForm({ ...lookup, pageId: "directory" }, context),
    );
    blocked = [owner.public.id];
    assert.throws(() => readContributionForm(lookup, context));
    blocked = [];
    withdrawn = true;
    assert.throws(() => readContributionForm(lookup, context));
    withdrawn = false;
    const forged = createBundle(stranger, "site", content, "public");
    store.put(forged);
    assert.throws(() =>
      readContributionForm(
        { ...lookup, snapshotId: forged.manifest.id },
        context,
      ),
    );
    const unsigned = createBundle(owner, "site", formPayload(), "public");
    store.put(unsigned);
    assert.throws(() =>
      readContributionForm(
        { ...lookup, snapshotId: unsigned.manifest.id },
        context,
      ),
    );
    const a = createContributionContextResolver(nodeCertificateCrypto),
      b = createContributionContextResolver(browserCertificateCrypto);
    const plain = decryptBundle(privateBundle, visitor),
      request = { ...lookup, snapshotId: privateBundle.manifest.id };
    assert.equal(
      canonical(
        a.describe(
          a.resolve(
            request,
            privateBundle,
            plain,
            visitor.public.id,
            Date.now(),
          ),
        ),
      ),
      canonical(
        b.describe(
          b.resolve(
            request,
            privateBundle,
            plain,
            visitor.public.id,
            Date.now(),
          ),
        ),
      ),
    );
    assert.throws(() =>
      a.resolve(
        { ...request, snapshotId: publicBundle.manifest.id },
        privateBundle,
        plain,
        visitor.public.id,
        Date.now(),
      ),
    );
    assert.throws(() =>
      a.resolve(
        request,
        privateBundle,
        plain,
        visitor.public.id,
        privateBundle.manifest.expires,
      ),
    );
    view.fields[0].label = "local mutation";
    assert.equal(readContributionForm(lookup, context).fields[0].label, "Nome");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
