import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createIdentity,
  createBundle,
  decryptBundle,
  verifyBundle,
  canonical,
} from "../packages/core/src/index";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
import { browserCertificateCrypto } from "../packages/browser/src/certificate-crypto";
import { createSiteContentProtocol } from "../packages/sites/src/content";
const sites = createSiteContentProtocol(nodeCertificateCrypto);
const portable = createSiteContentProtocol(browserCertificateCrypto);
const payload = () => ({
  type: "site",
  blocks: [],
  theme: "sand",
  site: {
    version: 1,
    title: "A real site",
    description: "Signed snapshot",
    home: "home",
    design: {
      font: "sans",
      width: "standard",
      radius: "soft",
      accent: "#207a70",
    },
    pages: [
      {
        id: "home",
        slug: "inicio",
        title: "Início",
        blocks: [
          {
            id: "text",
            type: "text",
            title: "Content",
            body: "Keep the author's words",
          },
        ],
      },
    ],
  },
});

test("complete declarative snapshots bind a signed revision to the payload and envelope signing owner", () => {
  const owner = createIdentity("Site owner"),
    reader = createIdentity("Reader"),
    data = payload();
  const content = sites.create(owner, "profile", 1, [], data);
  const bundle = createBundle(owner, "site", content, "public");
  verifyBundle(bundle);
  const opened = sites.verify(
    decryptBundle(bundle),
    bundle.manifest.author,
    "profile",
  );
  assert.equal(opened.revision.body.number, 1);
  assert.equal(opened.revision.body.previous.length, 0);
  assert.equal(canonical(opened.content), canonical(content));
  assert.equal(
    canonical(portable.verify(content, owner.public).content),
    canonical(content),
  );
  assert.equal(
    canonical(
      sites.verify(portable.create(owner, "profile", 1, [], data), owner.public)
        .content,
    ),
    canonical(content),
  );
  const counterfeit = createBundle(reader, "site", content, "public");
  verifyBundle(counterfeit);
  assert.throws(() =>
    sites.verify(decryptBundle(counterfeit), counterfeit.manifest.author),
  );
  const readOnly = createBundle(owner, "site", content, [reader.public]);
  assert.deepEqual(
    sites.verify(decryptBundle(readOnly, reader), readOnly.manifest.author)
      .content,
    content,
  );
  assert.throws(() =>
    sites.create(
      { ...owner, signSecret: reader.signSecret },
      "profile",
      2,
      [content.siteRevision.id],
      data,
    ),
  );
});

test("snapshots reject unsigned additions, malformed declarative documents and changed signed payloads", () => {
  const owner = createIdentity("Strict sites"),
    data = payload(),
    content = sites.create(owner, "profile", 1, [], data);
  assert.throws(() =>
    sites.verify({ ...content, unknown: "unsigned extension" }, owner.public),
  );
  assert.throws(() => sites.verify({ ...content, theme: "ink" }, owner.public));
  assert.throws(() => sites.verify(content, owner.public, "other-site"));
  assert.throws(() =>
    sites.create(owner, "profile", 1, [], { ...data, script: "alert(1)" }),
  );
  const malformed = payload();
  malformed.site.pages[0].blocks[0].type = "script";
  assert.throws(() => sites.create(owner, "profile", 1, [], malformed));
  assert.throws(() =>
    sites.create(owner, "profile", 1, [], { ...data, site: undefined }),
  );
  data.site.title = "Changed after signing";
  assert.equal(content.site.title, "A real site");
  const first = sites.verify(content, owner.public);
  first.content.site.title = "Changed after verification";
  assert.equal(content.site.title, "A real site");
});
