import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  createIdentity,
  createBundleAt,
  decryptStoredBundle,
  verifyBundle,
  verifyStoredBundle,
  canonical,
} from "../packages/core/src/index";
import * as portable from "../packages/browser/src/crypto";
import { projectTemp } from "./project-temp";

test("fixed envelope time preserves the saved deadline while nonce identity still requires durable retention", async () => {
  const author = createIdentity("Fixed author"),
    reader = createIdentity("Reader"),
    outsider = createIdentity("No read key"),
    payload = { text: "SIGNED_INTENT_FIXED_DEADLINE" };
  for (const created of [
    0,
    Date.now() - 10000,
    Number.MAX_SAFE_INTEGER - 1000,
  ]) {
    const node = createBundleAt(
        author,
        "site-contribution",
        payload,
        [reader.public],
        1000,
        created,
      ),
      browser = await portable.createBundleAt(
        author,
        "site-contribution",
        payload,
        [reader.public],
        1000,
        created,
      );
    for (const bundle of [node, browser]) {
      assert.equal(bundle.manifest.created, created);
      assert.equal(bundle.manifest.expires, created + 1000);
      verifyStoredBundle(bundle);
      assert.deepEqual(decryptStoredBundle(bundle, reader), payload);
      assert.deepEqual(
        await portable.decryptStoredBundle(bundle, reader),
        payload,
      );
      assert.throws(() => verifyBundle(bundle));
      await assert.rejects(portable.verifyBundle(bundle));
      assert.throws(() => decryptStoredBundle(bundle, outsider));
    }
    assert.notEqual(
      node.manifest.id,
      browser.manifest.id,
      "fixed clock is not a replacement for persisting the actual random envelope",
    );
  }
});

test("Node and portable fixed clocks reject invalid/overflowing dates and unrelated secrets before producing a bundle", async () => {
  const author = createIdentity("Owner"),
    other = createIdentity("Other");
  for (const [ttl, created] of [
    [999, 0],
    [1000, -1],
    [1000, 0.5],
    [1000, Number.MAX_SAFE_INTEGER - 999],
    [Infinity, 0],
    [1000, NaN],
    [1000, Infinity],
    [1.5, 0],
    [365 * 86400000 + 1, 0],
  ]) {
    assert.throws(() =>
      createBundleAt(author, "post", {}, "public", ttl, created),
    );
    await assert.rejects(
      portable.createBundleAt(author, "post", {}, "public", ttl, created),
    );
  }
  for (const identity of [
    { ...author, signSecret: other.signSecret },
    { ...author, boxSecret: other.boxSecret },
  ]) {
    assert.throws(() =>
      createBundleAt(identity, "post", {}, "public", 1000, 0),
    );
    await assert.rejects(
      portable.createBundleAt(identity, "post", {}, "public", 1000, 0),
    );
  }
});

test("Node and portable fixed envelopes verify in a real Go process; Go ciphertext decrypts in both adapters", async () => {
  const author = createIdentity("Node fixed"),
    reader = createIdentity("Shared reader"),
    created = Date.now() - 10000,
    payload = { test: "FIXED_ENVELOPE_INTEROP", number: 0, flag: false };
  const bundles = [
    createBundleAt(
      author,
      "site-contribution",
      payload,
      [reader.public],
      1000,
      created,
    ),
    await portable.createBundleAt(
      author,
      "site-contribution",
      payload,
      [reader.public],
      1000,
      created,
    ),
  ];
  const directory = projectTemp("fixed-envelope-interop-"),
    path = join(directory, "input.json");
  try {
    writeFileSync(path, JSON.stringify({ reader, created, payload, bundles }), {
      mode: 0o600,
    });
    const result = spawnSync(
      process.execPath,
      [
        "scripts/go.mjs",
        "test",
        "-p=1",
        "./core",
        "-run",
        "^TestFixedEnvelopeInteropWorker$",
        "-count=1",
      ],
      {
        encoding: "utf8",
        timeout: 30000,
        env: { ...process.env, RELAYLOOM_FIXED_ENVELOPE_INPUT: path },
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const fromGo = JSON.parse(readFileSync(path + ".bundle.json", "utf8"));
    assert.equal(fromGo.manifest.created, created);
    assert.equal(fromGo.manifest.expires, created + 1000);
    assert.equal(
      canonical(decryptStoredBundle(fromGo, reader)),
      canonical(payload),
    );
    assert.equal(
      canonical(await portable.decryptStoredBundle(fromGo, reader)),
      canonical(payload),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
