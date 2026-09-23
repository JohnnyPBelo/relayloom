import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { canonical } from "../packages/core/src/index";
import { projectTemp } from "./project-temp";

test("large ASCII runs retain exact Node canonical bytes around Unicode, escaped text, surrogate keys and numeric boundaries", () => {
  const values: unknown[] = [
    "",
    "QUJD+/09=".repeat(163000),
    {
      z: "A".repeat(20000) + '"\\\n\0山🚀\ud800',
      a: [1e-7, 1e-6, 1e21, -0, Number.MAX_VALUE, Number.MIN_VALUE],
    },
    { "\ue000": 1, "🚀": 2, "\ud800": 3, "\udc00": 4 },
  ];
  const fragments = [
    "alpha+/09=",
    '"',
    "\\",
    "\b\f\n\r\t",
    "\0\x01\x1f\x7f",
    "<>&",
    "á山🚀",
    "\u2028\u2029",
    "\ud800",
    "\udfff",
  ];
  let seed = 6032026;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let i = 0; i < 256; i++) {
    let text = "A".repeat(i % 97);
    for (let j = 0; j < 8; j++)
      text += fragments[next() % fragments.length] + "Z".repeat(next() % 80);
    values.push({
      ["k" + i]: [text, { "🚀": i / 10, "\ud800": text.slice(0, 17) }],
      a: i % 2 === 0,
      empty: null,
    });
  }
  const dir = projectTemp("canonical-runs-"),
    path = join(dir, "vectors.json");
  try {
    writeFileSync(
      path,
      JSON.stringify(
        values.map((value) => ({ value, expected: canonical(value) })),
      ),
      { mode: 0o600 },
    );
    const result = spawnSync(
      process.execPath,
      [
        "scripts/go.mjs",
        "test",
        "-race",
        "-p=1",
        "./core",
        "-run",
        "^TestCanonicalNodeRunVectorsWorker$",
        "-count=1",
      ],
      {
        encoding: "utf8",
        timeout: 60000,
        env: { ...process.env, RELAYLOOM_CANONICAL_RUN_VECTORS: path },
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
