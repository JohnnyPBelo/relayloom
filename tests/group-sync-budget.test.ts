import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  canonical,
  createIdentity,
  ContentStore,
  verifyBundle,
} from "../packages/core/src/index.js";
import { createAnchoredGroup } from "../packages/groups/src/certificates.js";
import { sealGroupControl } from "../packages/groups/src/carriers.js";
import {
  GroupSynchronizer,
  type GroupSyncHost,
} from "../apps/node/src/group-sync.js";

for (const failure of ["store", "transport"] as const)
  test(`control ${failure} failures still consume the bounded publication budget`, () => {
    mkdirSync(".cache/group-carriers", { recursive: true });
    const dir = mkdtempSync(
      join(process.cwd(), ".cache/group-carriers/budget-"),
    );
    const identity = createIdentity("Control publisher"),
      reader = createIdentity("Invited reader"),
      group = createAnchoredGroup(identity, "Budget control"),
      store = new ContentStore(dir, 16 * 1024 * 1024);
    let attempts = 0;
    const host: GroupSyncHost = {
      identity: () => identity,
      registry: () => {
        throw new Error("unused authority callback");
      },
      apply: () => {
        throw new Error("unused mutation callback");
      },
      store,
      connected: () => true,
      relay: () => true,
      blocked: () => [],
      pauseGroups: () => {},
      needs: () => [],
      send: (bundle) => {
        verifyBundle(bundle);
        attempts++;
        if (failure === "transport")
          throw new Error("fixture transport failure");
      },
    };
    const sync = new GroupSynchronizer(host) as any;
    const put = store.put.bind(store);
    if (failure === "store")
      store.put = ((bundle: any) => {
        attempts++;
        put(bundle);
        throw new Error("fixture failure after content write");
      }) as any;
    try {
      for (let i = 0; i < 80; i++) {
        const payload = {
          type: "group-control",
          version: 1,
          action: "headers",
          groupId: group.anchor.id,
          to: reader.public.id,
          from: i,
          headers: i ? [] : [group.epoch],
          head: group.epoch,
        } as const;
        try {
          sync.output(`distinct-${i}`, () =>
            sealGroupControl(identity, JSON.parse(JSON.stringify(payload)), [
              reader.public,
            ]),
          );
        } catch (error) {
          assert.match(String(error), /fixture/);
        }
      }
      assert.equal(
        attempts,
        64,
        "failed side effects bypassed the per-minute bound",
      );
      assert.equal(sync.budget, 64);
      assert.equal(sync.counts.sent, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

test("network responses obey the producer cache quota without evicting pinned controls", () => {
  const root = join(process.cwd(), ".cache/group-carriers");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "response-quota-"));
  const identity = createIdentity("Producer"),
    reader = createIdentity("Reader"),
    group = createAnchoredGroup(identity, "Quota");
  const store = new ContentStore(dir, 2 * 1024 * 1024);
  const sent: string[] = [];
  const host: GroupSyncHost = {
    identity: () => identity,
    registry: () => {
      throw new Error("unused");
    },
    apply: () => {
      throw new Error("unused");
    },
    store,
    connected: () => true,
    relay: () => true,
    blocked: () => [],
    pauseGroups: () => {},
    needs: () => [],
    send: (bundle) => {
      verifyBundle(bundle);
      sent.push(bundle.manifest.id);
    },
  };
  const sync = new GroupSynchronizer(host) as any;
  try {
    for (let i = 0; i < 16; i++) {
      sync.output(`response-${i}`, () =>
        sealGroupControl(
          identity,
          {
            type: "group-control",
            version: 1,
            action: "headers",
            groupId: group.anchor.id,
            to: reader.public.id,
            from: i,
            headers: Array(16).fill({ unverifiedTail: "x".repeat(15000) }),
            head: group.epoch,
          },
          [reader.public],
        ),
      );
      if (i === 0) store.pin(sent[0], true);
      const bytes = store
        .list()
        .filter(
          (m) =>
            m.kind === "group-control" && m.author.id === identity.public.id,
        )
        .reduce(
          (n, m) => n + Buffer.byteLength(canonical(store.get(m.id, false))),
          0,
        );
      assert.ok(
        bytes <= store.quota / 4,
        `responses occupied ${bytes} bytes; producer limit ${store.quota / 4}`,
      );
    }
    assert.equal(
      sent.length,
      1,
      "capacity must defer new responses, not retransmit unretained bytes",
    );
    assert.ok(store.isPinned(sent[0]));
    assert.ok(store.has(sent[0]));
    // An impossible replacement must not delete an unrelated cached proof
    // before discovering that the pinned object prevents admission anyway.
    const small = sealGroupControl(
      identity,
      {
        type: "group-control",
        version: 1,
        action: "headers",
        groupId: group.anchor.id,
        to: reader.public.id,
        from: 0,
        headers: [{ tail: "x".repeat(15000) }],
        head: group.epoch,
      },
      [reader.public],
    );
    store.put(small);
    const replacement = sealGroupControl(
      identity,
      {
        type: "group-control",
        version: 1,
        action: "headers",
        groupId: group.anchor.id,
        to: reader.public.id,
        from: 1,
        headers: Array(16).fill({ tail: "y".repeat(15000) }),
        head: group.epoch,
      },
      [reader.public],
    );
    assert.equal(sync.retain(replacement, true), false);
    assert.ok(
      store.has(small.manifest.id),
      "failed admission discarded an earlier control",
    );
    assert.ok(store.has(sent[0]));
    store.pin(sent[0], false);
    const originalPut = store.put.bind(store);
    store.put = () => {
      throw new Error("fixture failed cache write");
    };
    assert.throws(
      () => sync.retain(replacement, true),
      /fixture failed cache write/,
    );
    assert.ok(store.has(small.manifest.id));
    assert.ok(
      store.has(sent[0]),
      "cache write failed after deleting previous proofs",
    );
    store.put = originalPut;
    assert.equal(sync.retain(replacement, true), true);
    assert.ok(store.has(replacement.manifest.id));
    assert.ok(store.stats().bytes <= store.quota / 4);
    // With storage pressure removed, the independent wire byte limit wins.
    store.setQuota(64 * 1024 * 1024);
    const before = sent.length,
      wireBudget = new GroupSynchronizer(host) as any;
    for (let i = 0; i < 20; i++)
      wireBudget.output(`large-${i}`, () =>
        sealGroupControl(
          identity,
          {
            type: "group-control",
            version: 1,
            action: "headers",
            groupId: group.anchor.id,
            to: reader.public.id,
            from: i,
            headers: Array(16).fill({ tail: "z".repeat(15000) }),
            head: group.epoch,
          },
          [reader.public],
        ),
      );
    const bytesSent = sent
      .slice(before)
      .reduce(
        (bytes, id) =>
          bytes + Buffer.byteLength(canonical(store.get(id, false))),
        0,
      );
    assert.ok(
      bytesSent > 3 * 1024 * 1024,
      "positive throughput control never exercised the byte budget",
    );
    assert.ok(
      bytesSent <= 4 * 1024 * 1024,
      "actual transmitted bundles bypassed the byte budget",
    );
    assert.ok(sent.length - before < 20);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
