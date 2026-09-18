import test from "node:test";
import assert from "node:assert/strict";
import {
  createBundle,
  createIdentity,
  verifyBundle,
} from "../packages/core/src/index";

test("Node bundle creation derives expiry from one clock observation even when the clock advances between reads", () => {
  const owner = createIdentity("Autora"),
    reader = createIdentity("Leitor"),
    clock = Date.now,
    now = clock();
  for (const readers of ["public" as const, [reader.public]]) {
    let ticks = 0;
    try {
      Date.now = () => now + ticks++ * 17;
      const bundle = createBundle(
        owner,
        "site-resource",
        {
          type: "site-resource",
          domain: "relayloom/site-resource/1",
          kind: "file",
          name: "Guia.txt",
          mime: "text/plain",
          data: "Zg==",
        },
        readers,
        3600000,
      );
      assert.equal(bundle.manifest.expires - bundle.manifest.created, 3600000);
      assert.equal(
        ticks,
        1,
        "one creation time determines both signed timestamps",
      );
      Date.now = clock;
      verifyBundle(bundle);
    } finally {
      Date.now = clock;
    }
  }
});
