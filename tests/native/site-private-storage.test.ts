import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { projectTemp } from "../project-temp";
import { canonical, createIdentity, hash } from "../../packages/core/src/index";
import { ProtectedGroupStore } from "../../packages/groups/src/storage";
import { SitePrivateRecords } from "../../packages/sites/src/private-storage";

let executable: string;
function binary() {
  if (executable) return executable;
  const root = resolve(".cache/site-private-interop");
  mkdirSync(root, { recursive: true });
  executable = join(
    root,
    process.platform === "win32" ? "sites.test.exe" : "sites.test",
  );
  const build = spawnSync(
    process.execPath,
    [
      "scripts/go.mjs",
      "test",
      "-c",
      "-race",
      "-p=1",
      "-o",
      executable,
      "./sites",
    ],
    { encoding: "utf8", timeout: 120000, maxBuffer: 128 * 1024 },
  );
  assert.equal(build.status, 0, build.stdout + build.stderr);
  return executable;
}
function run(control: string) {
  return spawnSync(
    binary(),
    ["-test.run=^TestPrivateRecordsInteropWorker$", "-test.v"],
    {
      cwd: resolve("native/sites"),
      env: { ...process.env, RELAYLOOM_SITE_PRIVATE_CONTROL: control },
      encoding: "utf8",
      timeout: 20000,
      maxBuffer: 128 * 1024,
    },
  );
}

for (const [source, target] of [
  ["site", "resource"],
  ["resource", "site"],
  ["site", "contribution"],
  ["contribution", "site"],
  ["resource", "contribution"],
  ["contribution", "resource"],
  ["site", "contribution-inbox"],
  ["contribution-inbox", "site"],
  ["resource", "contribution-inbox"],
  ["contribution-inbox", "resource"],
  ["contribution", "contribution-inbox"],
  ["contribution-inbox", "contribution"],
  ["contribution-receipt", "site"],
  ["site", "contribution-receipt"],
  ["contribution-receipt", "resource"],
  ["resource", "contribution-receipt"],
  ["contribution-receipt", "contribution"],
  ["contribution", "contribution-receipt"],
  ["contribution-receipt", "contribution-inbox"],
  ["contribution-inbox", "contribution-receipt"],
  ["contribution-rejection", "site"],
  ["site", "contribution-rejection"],
  ["contribution-rejection", "resource"],
  ["resource", "contribution-rejection"],
  ["contribution-rejection", "contribution"],
  ["contribution", "contribution-rejection"],
  ["contribution-rejection", "contribution-inbox"],
  ["contribution-inbox", "contribution-rejection"],
  ["contribution-rejection", "contribution-receipt"],
  ["contribution-receipt", "contribution-rejection"],
] as const)
  test(`an authenticated outer SQLite database cannot transpose unpublished signatures from ${source} into the ${target} namespace`, () => {
    const directory = projectTemp("publication-namespace-"),
      owner = createIdentity("Namespace owner"),
      path = join(directory, "profile.sqlite");
    const store = new ProtectedGroupStore(path, owner, { create: true });
    const slot = hash("same logical slot"),
      from = source + ":" + slot + ":stage",
      to = target + ":" + slot + ":stage";
    const value = {
      signature: "UNPUBLISHED_SIGNATURE",
      body: "Kept under the signing secret",
    };
    const writer =
      source === "site"
        ? SitePrivateRecords.run.bind(SitePrivateRecords)
        : source === "resource"
          ? SitePrivateRecords.runResource.bind(SitePrivateRecords)
          : source === "contribution"
            ? SitePrivateRecords.runContribution.bind(SitePrivateRecords)
            : source === "contribution-inbox"
              ? SitePrivateRecords.runContributionInbox.bind(SitePrivateRecords)
              : source === "contribution-rejection"
                ? SitePrivateRecords.runContributionRejection.bind(
                    SitePrivateRecords,
                  )
                : SitePrivateRecords.runContributionReceipt.bind(
                    SitePrivateRecords,
                  );
    try {
      store.transaction((tx) => writer(tx, owner, (r) => r.write(from, value)));
      store.transaction((tx) => {
        const descriptor = JSON.parse(tx.get(from)!.toString("utf8"));
        descriptor.domain =
          target === "site"
            ? "relayloom/site-private/1"
            : target === "resource"
              ? "relayloom/site-resource-private/1"
              : target === "contribution"
                ? "relayloom/site-contribution-private/1"
                : target === "contribution-inbox"
                  ? "relayloom/site-contribution-inbox-private/1"
                  : target === "contribution-rejection"
                    ? "relayloom/site-contribution-rejection-private/1"
                    : "relayloom/site-contribution-receipt-private/1";
        for (const key of tx.keys(from + ":"))
          tx.put(to + key.slice(from.length), tx.get(key)!);
        tx.put(to, Buffer.from(canonical(descriptor)));
      });
      const storeId = store.storeId();
      store.close();
      const control = join(directory, "control.json");
      writeFileSync(
        control,
        JSON.stringify({
          namespace: target,
          database: path,
          storeId,
          identity: owner,
          key: to,
          expected: value,
          output: join(directory, "must-not-pass.json"),
        }),
        { mode: 0o600 },
      );
      const result = run(control);
      assert.equal(result.status, 1);
      assert.match(result.stdout + result.stderr, /autentica/i);
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

for (const namespace of [
  "site",
  "resource",
  "contribution",
  "contribution-inbox",
  "contribution-receipt",
  "contribution-rejection",
] as const)
  test(`Node and a real Go process exchange signing-protected ${namespace} records in the same SQLite database`, () => {
    const runPrivate =
      namespace === "site"
        ? SitePrivateRecords.run.bind(SitePrivateRecords)
        : namespace === "resource"
          ? SitePrivateRecords.runResource.bind(SitePrivateRecords)
          : namespace === "contribution"
            ? SitePrivateRecords.runContribution.bind(SitePrivateRecords)
            : namespace === "contribution-inbox"
              ? SitePrivateRecords.runContributionInbox.bind(SitePrivateRecords)
              : namespace === "contribution-rejection"
                ? SitePrivateRecords.runContributionRejection.bind(
                    SitePrivateRecords,
                  )
                : SitePrivateRecords.runContributionReceipt.bind(
                    SitePrivateRecords,
                  );
    const directory = projectTemp("site-private-interop-"),
      owner = createIdentity("Shared site storage owner"),
      path = join(directory, "profile.sqlite");
    let store = new ProtectedGroupStore(path, owner, { create: true });
    try {
      const key =
          namespace +
          ":" +
          hash("node-site-value") +
          (["contribution-receipt", "contribution-rejection"].includes(
            namespace,
          )
            ? ":stage"
            : ":record"),
        writeKey = namespace + ":" + hash("go-site-value") + ":stage";
      const value = {
          title: "Exact private record 😀 \ud800",
          body: "x".repeat(2 * 1024 * 1024),
          values: [null, true, 23],
        },
        written = { label: "From Go", sequence: 2, body: "🧶" };
      store.transaction((tx) =>
        runPrivate(tx, owner, (r) => r.write(key, value)),
      );
      const id = store.storeId();
      store.close();
      const output = join(directory, "result.json"),
        control = join(directory, "control.json");
      writeFileSync(
        control,
        JSON.stringify({
          namespace,
          database: path,
          storeId: id,
          identity: owner,
          key,
          expected: value,
          writeKey,
          writeValue: written,
          output,
        }),
        { mode: 0o600 },
      );
      const result = run(control);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(
        JSON.parse(readFileSync(output, "utf8")).readSHA256,
        hash(canonical(value)),
      );
      store = new ProtectedGroupStore(path, owner, { expectedStoreId: id });
      assert.deepEqual(
        store.view((tx) => runPrivate(tx, owner, (r) => r.read(key))),
        value,
      );
      assert.deepEqual(
        store.view((tx) => runPrivate(tx, owner, (r) => r.read(writeKey))),
        written,
      );
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

for (const namespace of [
  "site",
  "resource",
  "contribution",
  "contribution-inbox",
  "contribution-receipt",
  "contribution-rejection",
] as const)
  test(`Go rejects a Node encrypted ${namespace} value transplanted into another authenticated store`, () => {
    const runPrivate =
      namespace === "site"
        ? SitePrivateRecords.run.bind(SitePrivateRecords)
        : namespace === "resource"
          ? SitePrivateRecords.runResource.bind(SitePrivateRecords)
          : namespace === "contribution"
            ? SitePrivateRecords.runContribution.bind(SitePrivateRecords)
            : namespace === "contribution-inbox"
              ? SitePrivateRecords.runContributionInbox.bind(SitePrivateRecords)
              : namespace === "contribution-rejection"
                ? SitePrivateRecords.runContributionRejection.bind(
                    SitePrivateRecords,
                  )
                : SitePrivateRecords.runContributionReceipt.bind(
                    SitePrivateRecords,
                  );
    const directory = projectTemp("site-private-context-"),
      owner = createIdentity("Context-bound owner"),
      a = join(directory, "a.sqlite"),
      b = join(directory, "b.sqlite");
    const first = new ProtectedGroupStore(a, owner, { create: true }),
      second = new ProtectedGroupStore(b, owner, { create: true });
    try {
      const key = namespace + ":" + hash("same-logical-name") + ":stage",
        value = { text: "Bound to the original store" };
      first.transaction((tx) =>
        runPrivate(tx, owner, (r) => r.write(key, value)),
      );
      const rows = first.view((tx) =>
        tx.keys(namespace + ":").map((key) => ({ key, bytes: tx.get(key)! })),
      );
      second.transaction((tx) => {
        for (const row of rows) tx.put(row.key, row.bytes);
      });
      const id = second.storeId();
      second.close();
      const control = join(directory, "control.json");
      writeFileSync(
        control,
        JSON.stringify({
          namespace,
          database: b,
          storeId: id,
          identity: owner,
          key,
          expected: value,
          output: join(directory, "must-not-pass.json"),
        }),
        { mode: 0o600 },
      );
      const result = run(control);
      assert.equal(result.status, 1);
      assert.match(result.stdout + result.stderr, /autentica/);
    } finally {
      first.close();
      second.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
