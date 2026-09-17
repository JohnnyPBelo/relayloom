import { projectTemp } from "./project-temp";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createIdentity,
  createBundle,
  verifyBundle,
  decryptBundle,
  verifyStoredBundle,
  decryptStoredBundle,
  ContentStore,
} from "../packages/core/src/index";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";

test("authenticated historical decoding does not make expired content admissible or decryptable by another identity", () => {
  const original = Date.now;
  let now = original();
  Date.now = () => now;
  const dir = projectTemp("stored-bundle-");
  try {
    const owner = createIdentity("Archive author"),
      reader = createIdentity("Archive reader"),
      other = createIdentity("Unauthorized reader");
    const payload = { text: "Retained private operation" },
      bundle = createBundle(owner, "message", payload, [reader.public], 1000);
    verifyBundle(bundle);
    assert.deepEqual(decryptBundle(bundle, reader), payload);
    now = bundle.manifest.expires + 1;
    assert.throws(() => verifyBundle(bundle));
    assert.throws(() => decryptBundle(bundle, reader));
    assert.throws(() => new ContentStore(join(dir, "content")).put(bundle));
    verifyStoredBundle(bundle);
    assert.deepEqual(decryptStoredBundle(bundle, reader), payload);
    assert.throws(() => decryptStoredBundle(bundle, other));
    const corrupt = structuredClone(bundle),
      key = Object.keys(corrupt.chunks)[0];
    corrupt.chunks[key] =
      (corrupt.chunks[key][0] === "A" ? "B" : "A") +
      corrupt.chunks[key].slice(1);
    assert.throws(() => verifyStoredBundle(corrupt));
    assert.throws(() => decryptStoredBundle(corrupt, reader));
  } finally {
    Date.now = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("historical time extraction rejects accessors without invoking them", () => {
  let called = false;
  const bundle: any = { manifest: {}, chunks: {} };
  Object.defineProperty(bundle.manifest, "created", {
    enumerable: true,
    get() {
      called = true;
      return Date.now();
    },
  });
  assert.throws(() => verifyStoredBundle(bundle));
  assert.throws(() => decryptStoredBundle(bundle));
  assert.equal(called, false);
});
