import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  BrowserGroupRecovery,
  GROUP_RECOVERY_LIMITS,
  type GroupRecoveryCandidate,
} from "../packages/browser/src/group-recovery";
const id = (n: number) => n.toString(16).padStart(64, "0");
const candidate = (n: number): GroupRecoveryCandidate => ({
  id: id(n),
  action: "reconsider",
});
const clock = (t: TestContext) =>
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
async function advance(t: TestContext, ms = 0) {
  t.mock.timers.tick(ms);
  for (let i = 0; i < 40; i++) {
    await Promise.resolve();
    t.mock.timers.tick(0);
  }
}

test("group recovery coalesces wakeups, serializes work and does not starve later candidates behind failures", async (t) => {
  clock(t);
  let scans = 0,
    active = 0,
    maximum = 0;
  const remaining = new Map([1, 2, 3, 4, 5].map((n) => [id(n), candidate(n)]));
  const seen: string[] = [];
  const recovery = new BrowserGroupRecovery({
    ready: () => true,
    authorityRevision: () => 0,
    scan: async () => {
      scans++;
      return [...remaining.values()];
    },
    recover: async (value) => {
      maximum = Math.max(maximum, ++active);
      seen.push(value.id);
      try {
        await Promise.resolve();
        if (value.id === id(1)) throw Error("Unreadable first payload");
        if (value.id === id(2)) return false;
        remaining.delete(value.id);
        return true;
      } finally {
        active--;
      }
    },
  });
  try {
    for (let n = 0; n < 100; n++) recovery.wake();
    await advance(t);
    assert.equal(scans, 1);
    assert.equal(maximum, 1);
    assert.deepEqual(seen, [1, 2, 3, 4, 5].map(id));
    assert.equal(recovery.status.queued, 2);
    for (let n = 0; n < 100; n++) recovery.tick();
    await advance(t, 1999);
    assert.equal(seen.length, 5);
    await advance(t, 1);
    assert.deepEqual(seen.slice(5), [id(1), id(2)]);
  } finally {
    recovery.close();
  }
});

test("group recovery stops a delayed scan after the session closes", async (t) => {
  clock(t);
  let release!: (values: GroupRecoveryCandidate[]) => void,
    scans = 0,
    attempts = 0;
  const gate = new Promise<GroupRecoveryCandidate[]>((resolve) => {
    release = resolve;
  });
  const recovery = new BrowserGroupRecovery({
    ready: () => true,
    authorityRevision: () => 0,
    scan: () => {
      scans++;
      return gate;
    },
    recover: async () => {
      attempts++;
      return true;
    },
  });
  recovery.wake();
  await advance(t);
  assert.equal(scans, 1);
  recovery.close();
  release([candidate(1)]);
  await advance(t, 30000);
  assert.equal(attempts, 0);
  assert.equal(recovery.status.queued, 0);
});

test("group recovery rejects excessive or duplicate scans without running any candidate", async (t) => {
  clock(t);
  let attempts = 0,
    scans = 0,
    duplicate = false;
  const recovery = new BrowserGroupRecovery({
    ready: () => true,
    authorityRevision: () => 0,
    scan: async () => {
      scans++;
      return duplicate
        ? [candidate(1), candidate(1)]
        : Array.from({ length: GROUP_RECOVERY_LIMITS.candidates + 1 }, (_, n) =>
            candidate(n),
          );
    },
    recover: async () => {
      attempts++;
      return true;
    },
  });
  try {
    recovery.wake();
    await advance(t);
    assert.equal(attempts, 0);
    assert.equal(scans, 1);
    assert.match(recovery.status.error, /Limite/);
    await advance(t, 1000);
    assert.equal(scans, 1);
    duplicate = true;
    recovery.wake();
    await advance(t);
    assert.equal(attempts, 0);
    assert.equal(scans, 2);
    assert.match(recovery.status.error, /Referência/);
  } finally {
    recovery.close();
  }
});

test("group recovery waits for a fresh successful scan after read failure instead of reusing old work", async (t) => {
  clock(t);
  let fail = false,
    scans = 0,
    attempts = 0;
  const recovery = new BrowserGroupRecovery({
    ready: () => true,
    authorityRevision: () => 0,
    scan: async () => {
      scans++;
      if (fail) throw Error("Storage unavailable");
      return [candidate(1)];
    },
    recover: async () => {
      attempts++;
      return false;
    },
  });
  try {
    recovery.wake();
    await advance(t);
    assert.equal(attempts, 1);
    fail = true;
    recovery.wake();
    await advance(t);
    assert.equal(scans, 2);
    assert.equal(attempts, 1);
    await advance(t, 1000);
    assert.equal(attempts, 1);
    assert.equal(scans, 2);
    fail = false;
    await advance(t, 1000);
    assert.equal(scans, 3);
    assert.equal(attempts, 2);
  } finally {
    recovery.close();
  }
});

test("group recovery restarts hints after an authority change and passes a new descriptor to each check", async (t) => {
  clock(t);
  let revision = 0,
    scans = 0;
  const value = candidate(1),
    checked: string[] = [];
  const recovery = new BrowserGroupRecovery({
    ready: () => true,
    authorityRevision: () => revision,
    scan: async () => {
      scans++;
      return [value];
    },
    recover: async (hint) => {
      checked.push(hint.id);
      hint.id = id(99);
      return false;
    },
  });
  try {
    recovery.wake();
    await advance(t);
    await advance(t, 2000);
    assert.deepEqual(checked, [id(1), id(1)]);
    value.id = id(2);
    revision++;
    recovery.tick();
    await advance(t);
    assert.equal(scans, 2);
    assert.deepEqual(checked, [id(1), id(1), id(2)]);
  } finally {
    recovery.close();
  }
});

test("group recovery does no new protected-page scan for control-only changes after an empty scan, but input and pending work still wake it", async (t) => {
  clock(t);
  let revision = 0,
    scans = 0,
    attempts = 0,
    hasIncoming = false;
  const recovery = new BrowserGroupRecovery({
    ready: () => true,
    authorityRevision: () => revision,
    scan: async () => {
      scans++;
      return hasIncoming ? [candidate(1)] : [];
    },
    recover: async () => {
      attempts++;
      return false;
    },
  });
  try {
    recovery.wake();
    await advance(t);
    assert.equal(scans, 1);
    for (let n = 0; n < 8; n++) {
      revision++;
      recovery.tick();
      await advance(t);
    }
    assert.equal(scans, 1);
    assert.equal(attempts, 0);
    hasIncoming = true;
    recovery.wake();
    await advance(t);
    assert.equal(scans, 2);
    assert.equal(attempts, 1);
    revision++;
    recovery.tick();
    await advance(t);
    assert.equal(scans, 3);
    assert.equal(attempts, 2);
  } finally {
    recovery.close();
  }
});

test("group recovery preserves a new-input wake that arrives while an empty scan is unfinished", async (t) => {
  clock(t);
  let release!: (values: GroupRecoveryCandidate[]) => void,
    scans = 0,
    attempts = 0,
    revision = 0;
  const gate = new Promise<GroupRecoveryCandidate[]>((resolve) => {
    release = resolve;
  });
  const recovery = new BrowserGroupRecovery({
    ready: () => true,
    authorityRevision: () => revision,
    scan: async () => {
      scans++;
      return scans === 1 ? gate : [candidate(1)];
    },
    recover: async () => {
      attempts++;
      return true;
    },
  });
  try {
    recovery.wake();
    await advance(t);
    assert.equal(scans, 1);
    revision++;
    recovery.wake();
    release([]);
    await advance(t);
    assert.equal(scans, 2);
    assert.equal(attempts, 1);
    assert.equal(recovery.status.queued, 0);
  } finally {
    recovery.close();
  }
});
