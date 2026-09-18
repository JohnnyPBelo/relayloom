import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { parseSiteTable } from "../packages/content/src/site-data";
const table = (kind: string, value: unknown) => ({
  domain: "relayloom/site-table/1",
  columns: [{ id: "field", label: "Campo", type: kind }],
  rows: [{ id: "record", values: { field: value } }],
});
test("Node and a real Go process agree on bounded declarative table vectors", () => {
  const cases: unknown[] = [
    ...["text", "number", "boolean", "date", "link"].map((kind) =>
      table(kind, null),
    ),
    table("text", "texto😀"),
    table("text", "\ud800"),
    table("number", -1.25),
    table("number", Number.MAX_SAFE_INTEGER),
    table("boolean", false),
    table("date", "0000-02-29"),
    table("date", "2024-02-29"),
    table("date", "2023-02-29"),
    table("date", "2026-04-31"),
  ];
  for (const link of [
    "https://example.org",
    "https://user:password@example.org",
    "javascript:alert(1)",
    "https://127.0.0.1:443/a",
    "https://127.1/a",
    "https://example.org/%FF",
    "https://example.org/%",
    "https://example.org\\evil",
    "https://example.org/é",
    "https://EXAMPLE.org/x",
    "HTTPS://example.org",
    "https://[::1]/",
    "https://example.org:65536",
    "https://example.org/\ufeff",
  ])
    cases.push(table("link", link));
  for (const [kind, value] of [
    ["text", 1],
    ["text", true],
    ["text", "x".repeat(1001)],
    ["number", "1"],
    ["number", true],
    ["boolean", 1],
    ["date", 20260917],
    ["text", { script: "1" }],
    ["unknown", "text"],
  ])
    cases.push(table(String(kind), value));
  cases.push(
    { ...table("text", "value"), extra: true },
    { ...table("text", "value"), columns: [] },
    {
      ...table("text", "value"),
      rows: [{ id: "record", values: { field: "value", extra: "bad" } }],
    },
  );
  const valid = cases.map((value) => {
    try {
      parseSiteTable(value);
      return true;
    } catch {
      return false;
    }
  });
  assert.ok(valid.includes(true) && valid.includes(false));
  const temp = resolve(".cache/data-vectors");
  mkdirSync(temp, { recursive: true });
  const directory = mkdtempSync(join(temp, "run-")),
    input = join(directory, "vectors.json");
  try {
    writeFileSync(input, JSON.stringify(cases));
    const result = spawnSync(
      process.execPath,
      [
        "scripts/go.mjs",
        "test",
        "-p=1",
        "./sites",
        "-run",
        "^TestDataTableVectorWorker$",
        "-count=1",
      ],
      {
        env: { ...process.env, RELAYLOOM_DATA_VECTOR_INPUT: input },
        encoding: "utf8",
        timeout: 30000,
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const go = JSON.parse(readFileSync(input + ".result", "utf8"));
    assert.deepEqual(go, valid);
    writeFileSync(
      ".cache/site-data-vectors.json",
      JSON.stringify(
        {
          status: "PASS",
          vectors: cases.length,
          accepted: valid.filter(Boolean).length,
          rejected: valid.filter((x) => !x).length,
          scope:
            "Only table validation; this vector test does not exercise the editor, signing, transport or native apps.",
        },
        null,
        2,
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
