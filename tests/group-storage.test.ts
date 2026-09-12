import test from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  randomBytes,
  sign,
  verify,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  canonical,
  createIdentity,
  hash,
  type Identity,
} from "../packages/core/src/index.js";
import {
  ProtectedGroupStore,
  RegistryCapacityError,
  RegistryIntegrityError,
  type RegistryTransaction,
} from "../packages/groups/src/storage.js";

const DOMAIN = "relayloom/local-group-registry/1";
function fixture(t: any) {
  const cache = resolve(".cache/group-storage");
  mkdirSync(cache, { recursive: true });
  const directory = mkdtempSync(join(cache, "case-"));
  const identity = createIdentity("Synthetic registry owner");
  const path = join(directory, "registry.sqlite"),
    secret = join(directory, "identity.json");
  writeFileSync(secret, JSON.stringify(identity), { mode: 0o600 });
  const handles: ProtectedGroupStore[] = [],
    children: ChildProcess[] = [];
  t.after(async () => {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) {
        const closed = new Promise<void>((resolve) =>
          child.once("close", () => resolve()),
        );
        child.kill("SIGKILL");
        await closed;
      }
    for (const store of handles) store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const open = (options = {}) => {
    const store = new ProtectedGroupStore(path, identity, options);
    handles.push(store);
    return store;
  };
  const worker = (mode: string, marker = "") => {
    const child = fork(
      resolve("tests/fixtures/group-storage-worker.ts"),
      [mode, path, secret, marker],
      {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    children.push(child);
    let stderr = "";
    child.stderr!.on("data", (data) => {
      stderr = (stderr + data).slice(-8192);
    });
    const result = new Promise<{
      code: number | null;
      signal: string | null;
      stderr: string;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal, stderr }));
    });
    const ready = new Promise<void>((resolve, reject) => {
      child.once("message", (value) =>
        (value as any).ready
          ? resolve()
          : reject(new Error("Unexpected worker response")),
      );
      child.once("error", reject);
      child.once("close", (code) =>
        reject(
          new Error("Worker exited before readiness: " + code + " " + stderr),
        ),
      );
    });
    // Crash workers intentionally never send readiness.
    if (mode === "crash") void ready.catch(() => {});
    return { child, result, ready };
  };
  return { path, directory, identity, open, worker };
}
function withDB(path: string, fn: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(path);
  try {
    fn(db);
  } finally {
    db.close();
  }
}
function checkpoint(db: DatabaseSync, identity: Identity) {
  const row = db
    .prepare("SELECT store_id,payload FROM checkpoint WHERE id=1")
    .get()!;
  const envelope = Buffer.from(row.payload as Uint8Array);
  const aad = Buffer.from(
    canonical([DOMAIN, identity.public.id, row.store_id, "@index", 0]),
  );
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(identity.boxSecret, "base64"),
      envelope.subarray(1, 33),
      Buffer.from(DOMAIN),
      32,
    ),
  );
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    envelope.subarray(33, 45),
  );
  decipher.setAAD(aad);
  decipher.setAuthTag(envelope.subarray(45, 61));
  const value = JSON.parse(
    Buffer.concat([
      decipher.update(envelope.subarray(61)),
      decipher.final(),
    ]).toString(),
  );
  return { value, aad, storeId: row.store_id };
}
function replaceCheckpoint(
  db: DatabaseSync,
  identity: Identity,
  body: any,
  signer: Identity,
) {
  const signature = sign(
    null,
    Buffer.from(canonical(body)),
    createPrivateKey({
      key: Buffer.from(signer.signSecret, "base64"),
      format: "der",
      type: "pkcs8",
    }),
  );
  // Negative controls carry genuine signatures under the supplied key.
  assert.equal(
    verify(
      null,
      Buffer.from(canonical(body)),
      createPublicKey({
        key: Buffer.from(signer.public.signKey, "base64"),
        format: "der",
        type: "spki",
      }),
      signature,
    ),
    true,
  );
  const salt = randomBytes(32),
    nonce = randomBytes(12);
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(identity.boxSecret, "base64"),
      salt,
      Buffer.from(DOMAIN),
      32,
    ),
  );
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(
    Buffer.from(
      canonical([DOMAIN, identity.public.id, body.storeId, "@index", 0]),
    ),
  );
  const ciphertext = Buffer.concat([
    cipher.update(
      Buffer.from(canonical({ body, signature: signature.toString("base64") })),
    ),
    cipher.final(),
  ]);
  const envelope = Buffer.concat([
    Buffer.from([1]),
    salt,
    nonce,
    cipher.getAuthTag(),
    ciphertext,
  ]);
  db.prepare("UPDATE checkpoint SET payload=? WHERE id=1").run(envelope);
}

test("encrypted metadata survives close/reopen; uncommitted work and transaction handles cannot escape", (t) => {
  const f = fixture(t),
    store = f.open({ create: true });
  const value = Buffer.from(
    "Private group title and local left fence — não publicar",
  );
  let expired: RegistryTransaction;
  store.transaction((tx) => {
    expired = tx;
    tx.put("head:group-a", value, "checkpoint");
    tx.put("proof:a", Buffer.from("proof"));
  });
  const id = store.storeId();
  assert.equal(store.accounting().revision, 1);
  assert.throws(() => expired!.get("head:group-a"), /terminada/);
  assert.throws(
    () => store.view((tx) => tx.put("bad", Buffer.from("bad"))),
    /leitura/,
  );
  assert.throws(
    () =>
      store.transaction((tx) => {
        tx.put("head:group-a", Buffer.from("lost"));
        tx.delete("proof:a");
        throw new Error("abort");
      }),
    /abort/,
  );
  assert.throws(
    () => store.transaction(() => store.transaction(() => {})),
    /transacção/,
  );
  assert.throws(() => store.transaction(() => Promise.resolve()), /síncrona/);
  store.close();
  assert.equal(readFileSync(f.path).includes(value), false);
  assert.equal(
    readFileSync(f.path).includes(Buffer.from("head:group-a")),
    false,
  );
  const again = f.open({ expectedStoreId: id });
  assert.deepEqual(
    again.view((tx) => tx.keys()),
    ["head:group-a", "proof:a"],
  );
  assert.deepEqual(
    again.view((tx) => tx.get("head:group-a")),
    value,
  );
  assert.equal(again.accounting().revision, 1);
  assert.throws(
    () => f.open({ expectedStoreId: "0".repeat(64) }),
    /outro registo/,
  );
});

test("absence, truncation, wrong identity, wrong signing authority and extra SQL schema fail closed", (t) => {
  const f = fixture(t);
  assert.throws(() => f.open(), /ENOENT/);
  const store = f.open({ create: true });
  store.close();
  const bytes = readFileSync(f.path);
  const other = createIdentity("Different synthetic identity");
  assert.throws(
    () => new ProtectedGroupStore(f.path, other),
    RegistryIntegrityError,
  );
  assert.throws(
    () =>
      new ProtectedGroupStore(f.path, {
        ...f.identity,
        signSecret: other.signSecret,
      }),
    /assinatura/,
  );
  assert.throws(() => f.open({ create: true }), /EEXIST/);
  assert.deepEqual(readFileSync(f.path), bytes);
  withDB(f.path, (db) => db.exec("CREATE TABLE extra (value TEXT)"));
  assert.throws(() => f.open(), /Esquema/);
  writeFileSync(f.path, Buffer.alloc(0));
  assert.throws(() => f.open(), /Esquema/);
  assert.equal(readFileSync(f.path).length, 0);
});

test("unknown schema cannot hide behind a similar SQLite prefix", (t) => {
  const f = fixture(t),
    store = f.open({ create: true });
  store.close();
  withDB(f.path, (db) => db.exec("CREATE TABLE sqliteXconcealed (value TEXT)"));
  assert.throws(() => f.open(), /Esquema/);
});

test("valid encryption with only the reading key cannot forge a locally signed fence", (t) => {
  const f = fixture(t),
    store = f.open({ create: true });
  store.transaction((tx) =>
    tx.put("left:group", Buffer.from("left"), "checkpoint"),
  );
  store.close();
  withDB(f.path, (db) => {
    const { value } = checkpoint(db, f.identity);
    value.body.entries = [];
    value.body.revision++;
    replaceCheckpoint(
      db,
      f.identity,
      value.body,
      createIdentity("Unauthorized reader signer"),
    );
    db.exec("DELETE FROM records"); // Count and schema match the forged index.
    // Authentication of the rewritten AES envelope really succeeds. Rejection
    // must be the owner's signature check, not malformed ciphertext.
    assert.deepEqual(checkpoint(db, f.identity).value.body, value.body);
  });
  assert.throws(() => f.open(), /Assinatura local/);
});

test("checkpoint corruption, deletion, wrong SQL type and oversize are rejected before trusting state", (t) => {
  const f = fixture(t),
    store = f.open({ create: true });
  store.close();
  const original = readFileSync(f.path);
  for (const mutate of [
    (db: DatabaseSync) => {
      const bytes = Buffer.from(
        db.prepare("SELECT payload FROM checkpoint").get()!
          .payload as Uint8Array,
      );
      bytes[bytes.length - 1] ^= 1;
      db.prepare("UPDATE checkpoint SET payload=?").run(bytes);
    },
    (db: DatabaseSync) => {
      db.exec("DELETE FROM checkpoint");
    },
    (db: DatabaseSync) => {
      db.prepare("UPDATE checkpoint SET payload=?").run("x".repeat(200));
    },
    (db: DatabaseSync) => {
      db.prepare("UPDATE checkpoint SET payload=?").run(
        Buffer.alloc(4 * 1024 ** 2 + 1),
      );
    },
  ]) {
    writeFileSync(f.path, original);
    withDB(f.path, mutate);
    assert.throws(() => f.open(), RegistryIntegrityError);
  }
});

test("complete valid backup rollback is an explicit limitation; a pinned different registry is rejected", (t) => {
  const f = fixture(t),
    store = f.open({ create: true });
  store.transaction((tx) =>
    tx.put("head:group", Buffer.from("before-removal"), "checkpoint"),
  );
  const id = store.storeId(),
    backup = readFileSync(f.path);
  store.transaction((tx) =>
    tx.put("head:group", Buffer.from("after-removal"), "checkpoint"),
  );
  store.close();
  writeFileSync(f.path, backup);
  const restored = f.open({ expectedStoreId: id });
  assert.equal(
    restored.view((tx) => tx.get("head:group"))!.toString(),
    "before-removal",
  );
  restored.close();
  const otherPath = join(f.directory, "other.sqlite");
  const other = new ProtectedGroupStore(otherPath, f.identity, {
    create: true,
  });
  assert.notEqual(other.storeId(), id);
  other.close();
  writeFileSync(f.path, readFileSync(otherPath));
  assert.throws(() => f.open({ expectedStoreId: id }), /outro registo/);
});

test("ciphertext substitution, swallowed integrity errors and stale index replay cannot change a committed record", (t) => {
  const f = fixture(t),
    store = f.open({ create: true });
  store.transaction((tx) => {
    tx.put("head:a", Buffer.from("head-a"));
    tx.put("head:b", Buffer.from("head-b"));
  });
  const before = readFileSync(f.path);
  withDB(f.path, (db) => {
    const rows = db
      .prepare("SELECT slot,payload FROM records ORDER BY slot")
      .all();
    db.prepare("UPDATE records SET payload=? WHERE slot=?").run(
      rows[1].payload!,
      rows[0].slot!,
    );
  });
  assert.throws(
    () =>
      store.transaction((tx) => {
        for (const key of tx.keys()) {
          try {
            tx.get(key);
          } catch {
            /* must still poison this transaction */
          }
        }
      }),
    /trocado|corrompido/,
  );
  assert.throws(() => store.transaction(() => {}), /incerto/);
  store.close();
  writeFileSync(f.path, before);
  const again = f.open();
  let oldIndex: Uint8Array;
  withDB(f.path, (db) => {
    oldIndex = db.prepare("SELECT payload FROM checkpoint").get()!
      .payload as Uint8Array;
  });
  again.transaction((tx) => tx.put("head:a", Buffer.from("new-head")));
  again.close();
  withDB(f.path, (db) =>
    db.prepare("UPDATE checkpoint SET payload=?").run(oldIndex!),
  );
  const replayed = f.open();
  assert.throws(() => replayed.view((tx) => tx.get("head:a")), /ausente/);
});

test("a replacement callback error cannot erase an observed integrity failure", (t) => {
  const f = fixture(t),
    store = f.open({ create: true });
  store.transaction((tx) =>
    tx.put("left:group", Buffer.from("left"), "checkpoint"),
  );
  withDB(f.path, (db) => {
    const bytes = Buffer.from(
      db.prepare("SELECT payload FROM records").get()!.payload as Uint8Array,
    );
    bytes[bytes.length - 1] ^= 1;
    db.prepare("UPDATE records SET payload=?").run(bytes);
  });
  assert.throws(
    () =>
      store.transaction((tx) => {
        try {
          tx.get("left:group");
        } catch {
          throw new Error("replacement callback error");
        }
      }),
    /replacement callback/,
  );
  assert.throws(() => store.view(() => {}), /incerto/);
});

test("record AAD binds logical key and revision even beneath a freshly signed index", (t) => {
  const f = fixture(t),
    store = f.open({ create: true });
  store.transaction((tx) => {
    tx.put("head:a", Buffer.from("same-length-a"));
    tx.put("head:b", Buffer.from("same-length-b"));
  });
  store.close();
  withDB(f.path, (db) => {
    const { value } = checkpoint(db, f.identity);
    const [a, b] = value.body.entries;
    const bytes = db
      .prepare("SELECT payload FROM records WHERE slot=?")
      .get(b.slot)!.payload as Uint8Array;
    db.prepare("UPDATE records SET payload=? WHERE slot=?").run(bytes, a.slot);
    a.digest = hash(Buffer.from(bytes));
    a.bytes = bytes.length;
    replaceCheckpoint(db, f.identity, value.body, f.identity);
  });
  const again = f.open();
  assert.throws(() => again.view((tx) => tx.get("head:a")), /Autenticação/);
});

test("ordinary metadata cannot consume the checkpoint reserve; capacity failure is atomic", (t) => {
  const f = fixture(t),
    store = f.open({
      create: true,
      limits: { totalBytes: 32768, reserveBytes: 8192 },
    });
  store.transaction((tx) => tx.put("ordinary", Buffer.alloc(22500, 7)));
  const before = store.accounting();
  assert.throws(
    () => store.transaction((tx) => tx.put("overflow", Buffer.alloc(2200, 8))),
    RegistryCapacityError,
  );
  assert.equal(store.accounting().revision, before.revision);
  assert.equal(
    store.view((tx) => tx.get("overflow")),
    undefined,
  );
  store.transaction((tx) => {
    assert.throws(
      () => tx.put("ordinary", Buffer.alloc(25000, 8)),
      RegistryCapacityError,
    );
    assert.equal(tx.get("ordinary")![0], 7); // The rejected replacement changed no SQL rows.
    tx.put("frozen:group", Buffer.alloc(4000, 9), "checkpoint");
  });
  const after = store.accounting();
  assert.equal(after.ordinaryBytes, before.ordinaryBytes);
  assert.ok(after.serializedBytes < after.totalBytes);
  assert.throws(
    () =>
      store.transaction((tx) =>
        tx.put("too-large-stop", Buffer.alloc(8000, 10), "checkpoint"),
      ),
    RegistryCapacityError,
  );
  assert.equal(store.view((tx) => tx.get("frozen:group"))!.length, 4000);
  store.close();
  assert.deepEqual(f.open().accounting(), after);
});

test(
  "abrupt writer process death rolls back staged SQL and preserves the last authenticated checkpoint",
  { timeout: 20000 },
  async (t) => {
    const f = fixture(t),
      store = f.open({ create: true });
    store.transaction((tx) => tx.put("counter", Buffer.from("7")));
    store.close();
    const marker = join(f.directory, "crash-stage.txt"),
      child = f.worker("crash", marker);
    const result = await child.result;
    assert.equal(result.code, 73, result.stderr);
    assert.equal(readFileSync(marker, "utf8"), "writes-staged-before-commit");
    assert.equal(existsSync(f.path + "-journal"), true);
    const recovered = f.open();
    assert.equal(recovered.view((tx) => tx.get("counter"))!.toString(), "7");
    assert.equal(
      recovered.view((tx) => tx.get("uncommitted")),
      undefined,
    );
    assert.equal(recovered.accounting().revision, 1);
  },
);

test(
  "two actual writer processes serialize read-modify-write without losing updates",
  { timeout: 20000 },
  async (t) => {
    const f = fixture(t),
      store = f.open({ create: true });
    store.transaction((tx) => tx.put("counter", Buffer.from("0")));
    store.close();
    const a = f.worker("increment"),
      b = f.worker("increment");
    await Promise.all([a.ready, b.ready]);
    a.child.send({ go: true });
    b.child.send({ go: true });
    const results = await Promise.all([a.result, b.result]);
    for (const result of results) assert.equal(result.code, 0, result.stderr);
    const recovered = f.open();
    assert.equal(recovered.view((tx) => tx.get("counter"))!.toString(), "24");
    assert.equal(recovered.accounting().revision, 25);
  },
);
