import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { ED25519_TORSION_SUBGROUP, ed25519 } from "@noble/curves/ed25519.js";
import vectors from "./fixtures/signing-key-profile.json";
import { admittedSigningKey } from "../packages/core/src/signing-key";
import {
  createIdentity,
  hash,
  canonical,
  validateIdentity,
} from "../packages/core/src/index";

test("identity proof rejects small-order signing keys even when the underlying verifier accepts the equation", () => {
  const good = createIdentity("Positive identity control");
  assert.equal(validateIdentity(good.public), true);
  const signature = Buffer.alloc(64);
  signature[0] = 1;
  let opensslAccepted = 0;
  for (const encoded of ED25519_TORSION_SUBGROUP) {
    const raw = Buffer.from(encoded, "hex"),
      der = Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        raw,
      ]);
    const body = {
      id: hash(der),
      name: "Synthetic weak key",
      signKey: der.toString("base64"),
      boxKey: good.public.boxKey,
    };
    const bytes = Buffer.from(canonical(body));
    assert.equal(
      ed25519.verify(signature, bytes, raw, { zip215: true }),
      true,
      "the permissive verifier is a real positive control",
    );
    if (
      verify(
        null,
        bytes,
        createPublicKey({ key: der, format: "der", type: "spki" }),
        signature,
      )
    )
      opensslAccepted++;
    assert.equal(
      validateIdentity({ ...body, proof: signature.toString("base64") }),
      false,
      encoded,
    );
  }
  assert.ok(
    opensslAccepted > 0,
    "negative control must exercise the previous acceptance path",
  );
});

test("the signing-key profile rejects all reference torsion points and noncanonical aliases without changing its input", () => {
  assert.deepEqual(vectors.smallOrder, ED25519_TORSION_SUBGROUP);
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  for (const value of [...vectors.smallOrder, ...vectors.noncanonical]) {
    const der = Buffer.concat([prefix, Buffer.from(value, "hex")]),
      before = Buffer.from(der);
    assert.equal(admittedSigningKey(der), false, value);
    assert.deepEqual(der, before);
  }
  for (let i = 0; i < 32; i++) {
    const valid = createIdentity("Generated key " + i),
      der = Buffer.from(valid.public.signKey, "base64"),
      before = Buffer.from(der);
    assert.equal(admittedSigningKey(der), true);
    assert.deepEqual(der, before);
    assert.equal(
      admittedSigningKey(Buffer.concat([der, Buffer.from([0])])),
      false,
    );
    assert.equal(
      admittedSigningKey(Buffer.from(valid.public.boxKey, "base64")),
      false,
    );
    assert.equal(validateIdentity(valid.public), true);
  }
});
