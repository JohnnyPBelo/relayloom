import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createIdentity } from "../packages/core/src/index.js";
import { writePrivateState } from "../apps/node/src/local-state.js";
import { openPrivateProfile } from "../apps/node/src/protected-private.js";
import { ProfileOwnership } from "../packages/profile/src/ownership.js";

test("legacy semantic failures are rejected before creating a signed migration intent", (t) => {
  const root = resolve(".cache/private-migration");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "invalid-")),
    identity = createIdentity("Synthetic migration owner"),
    lease = new ProfileOwnership(dir),
    path = join(dir, "private-state.json");
  t.after(() => {
    lease.close();
    rmSync(dir, { recursive: true, force: true });
  });
  for (const state of [
    { mutations: [] },
    { mutations: { invalid: {} } },
    { mutations: {}, collections: [{ ownerId: "wrong owner" }] },
    {
      mutations: {},
      siteDraft: {
        blocks: [{ id: "script", type: "script", title: "", body: "" }],
        theme: "sand",
        savedAt: 1,
      },
    },
  ]) {
    writePrivateState(path, state as any, identity);
    const original = readFileSync(path);
    assert.throws(
      () => {
        const loaded = openPrivateProfile(dir, identity);
        loaded.database.close();
      },
      /privad|social|colec|Bloco|inválid/,
      JSON.stringify(state),
    );
    assert.equal(existsSync(join(dir, "profile-binding.json")), false);
    assert.equal(existsSync(join(dir, "profile-state.sqlite")), false);
    assert.deepEqual(readFileSync(path), original);
  }
});
