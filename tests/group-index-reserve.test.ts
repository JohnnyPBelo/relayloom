import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createIdentity } from "../packages/core/src/index.js";
import {
  ProtectedGroupStore,
  RegistryCapacityError,
} from "../packages/groups/src/storage.js";
import { populateIndex } from "./fixtures/group-index-fixture.js";
function fixture(t: any) {
  const root = resolve(".cache/index-reserve");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "case-")),
    identity = createIdentity("Synthetic index owner"),
    path = join(dir, "registry.sqlite");
  const store = new ProtectedGroupStore(path, identity, { create: true });
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}
test("an index consuming stop headroom is refused without changing existing data", (t) => {
  const store = fixture(t);
  store.transaction((tx) =>
    tx.put("head:existing", Buffer.from("retained"), "checkpoint"),
  );
  assert.throws(
    () => populateIndex(store, 4 * 1024 ** 2 - 80),
    RegistryCapacityError,
  );
  assert.equal(
    store.view((tx) => tx.get("head:existing"))!.toString(),
    "retained",
  );
  assert.equal(
    store.view((tx) => tx.keys("fill:").length),
    0,
  );
});
test("ordinary index growth stops before the protected checkpoint allocation is consumed", (t) => {
  const store = fixture(t),
    setup = populateIndex(store, 4 * 1024 ** 2 - 128 * 1024 - 1000);
  let stopped = false,
    accepted = 0;
  store.transaction((tx) => {
    for (let n = 0; n < 16; n++) {
      try {
        tx.put("growth:" + n, Buffer.alloc(0));
        accepted++;
      } catch (error) {
        assert.ok(error instanceof RegistryCapacityError);
        stopped = true;
        tx.put("checkpoint:stop", Buffer.from("left"), "checkpoint");
        break;
      }
    }
    assert.ok(
      stopped,
      "ordinary index growth consumed protected index headroom",
    );
  });
  assert.ok(accepted > 0);
  assert.equal(store.accounting().indexReserveBytes, 128 * 1024);
  assert.ok(
    store.accounting().ordinaryIndexBytes <= 4 * 1024 ** 2 - 128 * 1024,
  );
  for (const key of setup.sampleKeys)
    assert.deepEqual(
      store.view((tx) => tx.get(key)),
      setup.plain,
    );
  assert.equal(
    store.view((tx) => tx.get("checkpoint:stop"))!.toString(),
    "left",
  );
});
