import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { authoredTable } from "./fixtures/site-table";
import {
  describeSiteResource,
  resourceScopeCoversSite,
  summarizeSiteResource,
} from "../packages/content/src/site-resource";

test("TypeScript and a real Go process agree on resource identity, canonical hashes, boundaries and reading scope", () => {
  const envelope = {
    id: "a".repeat(64),
    authorId: "b".repeat(64),
    kind: "site-resource",
  };
  const file = (data = "Zg==") => ({
    type: "site-resource",
    domain: "relayloom/site-resource/1",
    kind: "file",
    name: "Guia.txt",
    mime: "text/plain",
    data,
  });
  const table = {
    type: "site-resource",
    domain: "relayloom/site-resource/1",
    kind: "table",
    name: "Dados 🧶",
    table: authoredTable(),
  };
  const resources: unknown[] = [
    table,
    file(),
    file(""),
    { ...table, name: "Lone \ud800" },
    { ...file(), name: "Emoji 🧶.txt" },
  ];
  for (const mime of [
    "application/pdf",
    "text/csv",
    "image/webp",
    "image/svg+xml",
    "text/html",
    "text/plain;charset=utf-8",
    "TEXT/PLAIN",
    "application/javascript",
  ])
    resources.push({ ...file(), mime });
  for (const name of [
    "",
    " ",
    "\ufeff",
    "..",
    ".",
    "dir/file",
    "dir\\file",
    "zero\0byte",
    "a".repeat(150),
    "a".repeat(151),
    "🧶".repeat(75),
    "🧶".repeat(76),
  ])
    resources.push({ ...file(), name });
  for (const data of [
    "Zh==",
    "Zg",
    "Zg==\n",
    "AA==",
    "AAAA",
    "----",
    "=",
    "====",
    true,
    4,
    null,
  ])
    resources.push({ ...file(), data });
  resources.push(
    { ...file(), script: "run()" },
    { ...table, data: "Zg==" },
    { ...file(), type: "post" },
    { ...file(), domain: "other/1" },
    file(Buffer.alloc(2 * 1024 * 1024).toString("base64")),
    file(Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64")),
  );
  const a = "a".repeat(64),
    b = "b".repeat(64);
  const scopes: unknown[][] = [
    ["public", "public"],
    [[a], "public"],
    ["public", [a]],
    [[a], [a, b]],
    [[a, b], [a]],
    [
      [a, b],
      [a, b],
    ],
    [[], "public"],
    ["public", []],
    [[b, a], "public"],
    ["public", [b, a]],
    [[a, a], "public"],
    [["person"], [a]],
    [null, "public"],
  ];
  const output = {
    summaries: resources.map((value) => {
      try {
        return summarizeSiteResource(value);
      } catch {
        return null;
      }
    }),
    resources: resources.map((value) => {
      try {
        return describeSiteResource(value, envelope);
      } catch {
        return null;
      }
    }),
    scopes: scopes.map(([site, resource]) => {
      try {
        return resourceScopeCoversSite(site, resource);
      } catch {
        return null;
      }
    }),
  };
  assert.ok(
    output.resources.some(Boolean) &&
      output.resources.some((value) => value === null),
  );
  assert.ok(
    output.scopes.includes(true) &&
      output.scopes.includes(false) &&
      output.scopes.includes(null),
  );
  mkdirSync(".cache", { recursive: true });
  const directory = mkdtempSync(resolve(".cache/site-resource-vectors-")),
    input = join(directory, "input.json");
  try {
    writeFileSync(input, JSON.stringify({ resources, scopes, envelope }));
    const result = spawnSync(
      process.execPath,
      [
        "scripts/go.mjs",
        "test",
        "-p=1",
        "./sites",
        "-run",
        "^TestResourceVectorWorker$",
        "-count=1",
      ],
      {
        env: { ...process.env, RELAYLOOM_SITE_RESOURCE_VECTORS: input },
        encoding: "utf8",
        timeout: 30000,
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const actual = JSON.parse(readFileSync(input + ".result", "utf8"));
    assert.deepEqual(actual, output);
    writeFileSync(
      ".cache/site-resource-vectors.json",
      JSON.stringify(
        {
          status: "PASS",
          resources: resources.length,
          accepted: output.resources.filter(Boolean).length,
          rejected: output.resources.filter((value) => value === null).length,
          scopeVectors: scopes.length,
          scope:
            "Schema/digest/audience conformance only. No application API/UI/storage integration or physical transport claim.",
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
