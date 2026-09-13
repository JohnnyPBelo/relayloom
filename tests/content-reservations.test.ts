import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  createIdentity,
  createBundle,
  ContentStore,
  canonical,
} from "../packages/core/src/index.js";

function fixture(t: TestContext) {
  mkdirSync(".cache", { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".cache/content-reserve-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const identity = createIdentity("Reservation fixture");
  return {
    dir,
    bundle: (text: string, ttl = 60000) =>
      createBundle(
        identity,
        "message",
        { type: "message", text },
        [identity.public],
        ttl,
      ),
  };
}

test("automatic reservations survive restart and count pressure without becoming manual pins", (t) => {
  const f = fixture(t),
    a = f.bundle("held"),
    b = f.bundle("manual"),
    c = f.bundle("incoming");
  let store = new ContentStore(f.dir, 4 * 1024 * 1024, 2);
  store.putReserved(a);
  store.put(b, true);
  assert.equal(store.isPinned(a.manifest.id), false);
  assert.deepEqual(store.reservations(), [a.manifest.id]);
  assert.equal(store.stats().reservedBytes, Buffer.byteLength(canonical(a)));
  store = new ContentStore(f.dir, 4 * 1024 * 1024, 2);
  assert.throws(() => store.put(c), /reservados/);
  assert.equal(store.has(a.manifest.id), true);
  assert.equal(store.has(b.manifest.id), true);
  store.setReservations([]);
  store.put(c);
  assert.equal(store.has(a.manifest.id), false);
  assert.equal(store.isPinned(b.manifest.id), true);
  assert.equal(store.stats().reserved, 0);
});

test("byte quota refusal is atomic with a reserved payload and preserves unrelated stored bytes", (t) => {
  const f = fixture(t),
    big = f.bundle("b".repeat(900000)),
    other = f.bundle("ordinary");
  const store = new ContentStore(f.dir, 4 * 1024 * 1024);
  store.putReserved(big);
  store.put(other);
  const before = readFileSync(join(f.dir, "index.json"));
  assert.throws(() => store.setQuota(1024 * 1024), /reservados/);
  assert.deepEqual(readFileSync(join(f.dir, "index.json")), before);
  assert.equal(store.has(other.manifest.id), true);
  assert.equal(store.quota, 4 * 1024 * 1024);
  store.setReservations([]);
  store.setQuota(1024 * 1024);
  assert.ok(store.stats().bytes <= 1024 * 1024);
});

test("reservation does not extend signed expiry", (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const f = fixture(t),
    a = f.bundle("expiring", 1000);
  let store = new ContentStore(f.dir, 4 * 1024 * 1024, 1);
  store.putReserved(a, true);
  now += 2000;
  store = new ContentStore(f.dir, 4 * 1024 * 1024, 1);
  assert.equal(store.has(a.manifest.id), false);
  assert.deepEqual(store.reservations(), []);
  assert.equal(store.stats().bytes, 0);
});

test("unknown or corrupt reservation input cannot partially release a valid reservation", (t) => {
  const f = fixture(t),
    a = f.bundle("held"),
    b = f.bundle("will corrupt");
  const store = new ContentStore(f.dir, 4 * 1024 * 1024, 2);
  store.putReserved(a);
  store.put(b);
  assert.throws(() => store.setReservations([b.manifest.id, "0".repeat(64)]));
  assert.deepEqual(store.reservations(), [a.manifest.id]);
  const changed = structuredClone(b),
    key = Object.keys(changed.chunks)[0];
  changed.chunks[key] =
    (changed.chunks[key][0] === "A" ? "B" : "A") + changed.chunks[key].slice(1);
  writeFileSync(
    join(f.dir, "objects", b.manifest.id + ".json"),
    canonical(changed),
  );
  assert.throws(() => store.setReservations([b.manifest.id]));
  assert.deepEqual(store.reservations(), [a.manifest.id]);
});

test("failed reservation index write protects the union until explicit reconciliation", (t) => {
  const f = fixture(t),
    a = f.bundle("before"),
    b = f.bundle("requested"),
    c = f.bundle("pressure");
  const store = new ContentStore(f.dir, 4 * 1024 * 1024, 2);
  store.putReserved(a);
  store.put(b, true);
  const path = join(f.dir, "index.json"),
    backup = path + ".backup";
  renameSync(path, backup);
  mkdirSync(path);
  try {
    assert.throws(() => store.setReservations([b.manifest.id]));
    assert.deepEqual(
      store.reservations(),
      [a.manifest.id, b.manifest.id].sort(),
    );
    assert.equal(store.isPinned(b.manifest.id), true);
    assert.throws(() => store.put(c), /reservados/);
    assert.equal(store.has(a.manifest.id), true);
  } finally {
    rmSync(path, { recursive: true });
    renameSync(backup, path);
  }
  store.setReservations([b.manifest.id]);
  const restored = new ContentStore(f.dir, 4 * 1024 * 1024, 2);
  assert.deepEqual(restored.reservations(), [b.manifest.id]);
  assert.equal(restored.isPinned(b.manifest.id), true);
});

test("duplicate reserved insertion at the count limit preserves a manual pin and verifies stored bytes", (t) => {
  const f = fixture(t),
    a = f.bundle("one");
  const store = new ContentStore(f.dir, 4 * 1024 * 1024, 1);
  store.put(a, true);
  assert.equal(store.putReserved(a), false);
  assert.equal(store.putReserved(a), false);
  assert.equal(store.isPinned(a.manifest.id), true);
  const malformed = JSON.parse(readFileSync(join(f.dir, "index.json"), "utf8"));
  malformed[a.manifest.id].reserved = "yes";
  writeFileSync(join(f.dir, "index.json"), JSON.stringify(malformed));
  assert.throws(() => new ContentStore(f.dir, 4 * 1024 * 1024, 1), /Reserva/);
});
