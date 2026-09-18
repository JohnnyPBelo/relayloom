import { projectTemp } from "./project-temp";
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createDecipheriv, hkdfSync } from "node:crypto";
import { createIdentity, canonical, hash } from "../packages/core/src/index";
import {
  ProtectedGroupStore,
  RegistryCapacityError,
} from "../packages/groups/src/storage";
import { SitePrivateRecords } from "../packages/sites/src/private-storage";
const key = "site:" + hash("site key") + ":stage";
const other = "site:" + hash("other key") + ":stage";

for (const namespace of ["site", "resource"] as const)
  test(`private ${namespace} staging survives SQLite restart and does not expose signatures to the reading secret`, () => {
    const runPrivate =
      namespace === "site"
        ? SitePrivateRecords.run.bind(SitePrivateRecords)
        : SitePrivateRecords.runResource.bind(SitePrivateRecords);
    const domain =
      namespace === "site"
        ? "relayloom/site-private/1"
        : "relayloom/site-resource-private/1";
    const key = namespace + ":" + hash("private staging key") + ":stage";
    const dir = projectTemp("site-private-"),
      owner = createIdentity("Staging owner"),
      file = join(dir, "profile.sqlite");
    let store = new ProtectedGroupStore(file, owner, { create: true });
    try {
      const data = {
        preparedSignature: "PRIVATE_SITE_SIGNATURE_CANARY",
        content: "x".repeat(2 * 1024 * 1024),
      };
      store.transaction((tx) =>
        runPrivate(tx, owner, (r) => r.write(key, data)),
      );
      const storageID = store.storeId();
      store.close();
      store = new ProtectedGroupStore(file, owner, {
        expectedStoreId: storageID,
      });
      assert.deepEqual(
        store.view((tx) => runPrivate(tx, owner, (r) => r.read(key))),
        data,
      );
      const encrypted = store.view((tx) =>
        Buffer.concat(tx.keys(key + ":").map((k) => tx.get(k)!)),
      );
      const aad = Buffer.from(
        canonical([domain, owner.public.id, storageID, key]),
      );
      const decrypt = (secret: string) => {
        const derived = Buffer.from(
          hkdfSync(
            "sha256",
            Buffer.from(secret, "base64"),
            encrypted.subarray(1, 33),
            domain,
            32,
          ),
        );
        try {
          const c = createDecipheriv(
            "aes-256-gcm",
            derived,
            encrypted.subarray(33, 45),
          );
          c.setAAD(aad);
          c.setAuthTag(encrypted.subarray(45, 61));
          return Buffer.concat([c.update(encrypted.subarray(61)), c.final()]);
        } finally {
          derived.fill(0);
        }
      };
      assert.throws(() => decrypt(owner.boxSecret));
      assert.equal(decrypt(owner.signSecret).toString("utf8"), canonical(data));
      assert.equal(
        encrypted.includes(Buffer.from(data.preparedSignature)),
        false,
      );
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

test("private staging quota failure aborts all record changes even when its error is caught", () => {
  const dir = projectTemp("site-private-quota-"),
    owner = createIdentity("Staging quota"),
    file = join(dir, "profile.sqlite");
  const store = new ProtectedGroupStore(file, owner, {
    create: true,
    limits: { totalBytes: 128 * 1024, reserveBytes: 8192 },
  });
  try {
    store.transaction((tx) =>
      SitePrivateRecords.run(tx, owner, (r) =>
        r.write(key, { text: "original" }),
      ),
    );
    assert.throws(() =>
      store.transaction((tx) => {
        try {
          SitePrivateRecords.run(tx, owner, (r) => {
            r.write(other, { n: 1 });
            r.write(key, { text: "x".repeat(150 * 1024) });
          });
        } catch (error) {
          assert.ok(error instanceof RegistryCapacityError);
        }
      }),
    );
    assert.deepEqual(
      store.view((tx) => SitePrivateRecords.run(tx, owner, (r) => r.read(key))),
      { text: "original" },
    );
    assert.equal(
      store.view((tx) =>
        SitePrivateRecords.run(tx, owner, (r) => r.read(other)),
      ),
      null,
    );
    store.transaction((tx) =>
      SitePrivateRecords.run(tx, owner, (r) =>
        r.write(key, { text: "valid successor" }),
      ),
    );
    assert.deepEqual(
      store.view((tx) => SitePrivateRecords.run(tx, owner, (r) => r.read(key))),
      { text: "valid successor" },
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("private record handles expire at the synchronous transaction boundary", () => {
  const dir = projectTemp("site-private-handle-"),
    owner = createIdentity("Staging handle"),
    file = join(dir, "profile.sqlite");
  const store = new ProtectedGroupStore(file, owner, { create: true });
  try {
    store.transaction((tx) => {
      const handle = SitePrivateRecords.run(tx, owner, (r) => r);
      assert.throws(() => handle.write(key, { invalid: true }), /terminada/);
      assert.throws(() => handle.read(key), /terminada/);
    });
    assert.throws(
      () =>
        store.transaction((tx) =>
          SitePrivateRecords.run(tx, owner, async () => {}),
        ),
      /síncrona/,
    );
    assert.equal(
      store.view((tx) => SitePrivateRecords.run(tx, owner, (r) => r.read(key))),
      null,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing and transposed ciphertext are rejected even inside an otherwise authentic outer database", () => {
  for (const mode of ["missing", "swap"]) {
    const dir = projectTemp("site-private-corrupt-"),
      owner = createIdentity("Staging integrity"),
      file = join(dir, "profile.sqlite");
    const store = new ProtectedGroupStore(file, owner, { create: true });
    try {
      store.transaction((tx) =>
        SitePrivateRecords.run(tx, owner, (r) => {
          r.write(key, { n: 1 });
          r.write(other, { n: 2 });
        }),
      );
      store.transaction((tx) => {
        if (mode === "missing") tx.delete(key + ":00");
        else {
          // Move the complete opaque value, including its authenticated length
          // and digest, so only the inner key binding can reject this swap.
          const first = tx.get(key)!,
            second = tx.get(other)!,
            a = tx.get(key + ":00")!,
            b = tx.get(other + ":00")!;
          tx.put(key, second);
          tx.put(other, first);
          tx.put(key + ":00", b);
          tx.put(other + ":00", a);
        }
      });
      assert.throws(() =>
        store.view((tx) =>
          SitePrivateRecords.run(tx, owner, (r) => r.read(key)),
        ),
      );
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
