import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { LoomNode } from "../../apps/node/src/node.js";
import {
  canonical,
  createBundle,
  createIdentity,
  hash,
} from "../../packages/core/src/index.js";
import { acceptGroupInvitation } from "../../packages/groups/src/certificates.js";
import { GroupLedger } from "../../packages/groups/src/ledger.js";
import type { OutboxEntry } from "../../apps/node/src/outbox.js";
import { admitOutbox } from "../../apps/node/src/outbox.js";
import { writeProfileState } from "../../packages/profile/src/state.js";
import assert from "node:assert/strict";
import { password } from "../helpers.js";

// A genuine signed/admitted group message is installed with an intent by the
// fixture. These tests exercise the runtime's stop/recovery boundary; they do
// not claim that dynamic publication or control-carrier transport is enabled.
export function groupOutboxFixture(t: {
  after: (cleanup: () => void | Promise<void>) => void;
}) {
  mkdirSync(".cache", { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".cache/group-outbox-"));
  const node = new LoomNode(dir),
    internals = node as any;
  clearInterval(internals.syncTimer);
  t.after(async () => {
    await node.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  node.setup("Sender", password);
  const identity = node.identity!,
    reader = createIdentity("Reader");
  const command = (body: any) => node.groupCommand(body) as any;
  const created = command({
    action: "create",
    operationId: randomUUID(),
    title: "Outbox",
  }).group;
  const anchor = command({
    action: "proofs",
    groupId: created.id,
    from: 0,
  }).anchor;
  const invitation = command({
    action: "invite",
    operationId: randomUUID(),
    groupId: created.id,
    expected: created.head.id,
    card: reader.public,
  }).operation.certificate;
  const consent = acceptGroupInvitation(
    reader,
    anchor,
    created.head,
    invitation,
  );
  const group = command({
    action: "commit",
    operationId: randomUUID(),
    groupId: created.id,
    expected: created.head.id,
    title: "Outbox",
    members: [identity.public, reader.public],
    joins: [consent],
  }).group;
  const snapshot = command({
    action: "private-state",
    groupId: group.id,
    epochId: group.head.id,
  }).snapshot;
  const content = {
    type: "message",
    text: "Original audience",
    conversation: group.id,
    groupEpoch: group.head.id,
    groupAudience: "epoch",
    members: snapshot.members,
  };
  const bundle = createBundle(
    identity,
    "message",
    content,
    snapshot.members,
    600_000,
  );
  node.store.putReserved(bundle);
  node.objects();
  const entry: OutboxEntry = {
    operationId: randomUUID(),
    fingerprint: hash("fixture intent"),
    id: bundle.manifest.id,
    author: identity.public.id,
    conversation: group.id,
    preview: content.text,
    created: bundle.manifest.created,
    expires: bundle.manifest.expires,
    priority: "normal",
    bytes: Buffer.byteLength(canonical(bundle)),
    phase: "ready",
    attempts: 0,
    lastAttemptAt: 0,
    nextAttemptAt: 0,
    lastError: "",
    manualPin: false,
    confirmations: { [reader.public.id]: {} },
    groupEpoch: group.head.id,
    groupStopped: false,
  };
  internals.persistPrivate({
    ...internals.privateState,
    outbox: { [entry.operationId]: entry },
  });
  node.state();
  const stopped = () =>
    internals.privateDatabase.transaction(
      (tx: any) =>
        GroupLedger.run(tx, identity, (l) => l.stop(entry.operationId)).value,
    );
  const item = () =>
    node.state().outbox.find((e) => e.operationId === entry.operationId)!;
  const close = () =>
    command({
      action: "close",
      operationId: randomUUID(),
      groupId: group.id,
      expected: group.head.id,
    });
  return {
    node,
    internals,
    command,
    group,
    entry,
    bundle,
    content,
    identity,
    reader,
    stopped,
    item,
    close,
  };
}

/** Populate actual encrypted bundles/admissions at the documented bounds.
 * This is fixture installation, not the unfinished dynamic send API. */
export function addFixtureGroupIntents(
  f: ReturnType<typeof groupOutboxFixture>,
  groupId: string,
  epochId: string,
  count: number,
) {
  const snapshot = f.command({
    action: "private-state",
    groupId,
    epochId,
  }).snapshot;
  const next = structuredClone(f.internals.privateState);
  const pending: {
    bundle: ReturnType<typeof createBundle>;
    content: any;
    entry: OutboxEntry;
  }[] = [];
  for (let index = 0; index < count; index++) {
    const content = {
      type: "message",
      text: "Bounded fixture " + randomUUID(),
      conversation: groupId,
      groupEpoch: epochId,
      groupAudience: "epoch",
      members: snapshot.members,
    };
    const bundle = createBundle(
      f.identity,
      "message",
      content,
      snapshot.members,
      600_000,
    );
    const entry = {
      ...structuredClone(f.entry),
      operationId: randomUUID(),
      id: bundle.manifest.id,
      fingerprint: hash(canonical(content)),
      conversation: groupId,
      groupEpoch: epochId,
      groupStopped: false,
      preview: content.text,
      created: bundle.manifest.created,
      expires: bundle.manifest.expires,
      bytes: Buffer.byteLength(canonical(bundle)),
    };
    next.outbox = admitOutbox(next.outbox, entry, Date.now());
    pending.push({ bundle, content, entry });
  }
  for (const p of pending) f.node.store.putReserved(p.bundle);
  const digest = f.internals.privateDatabase.transaction(
    (tx: any) =>
      GroupLedger.run(tx, f.identity, (l) => {
        const protectedIds = new Set<string>(
          Object.values(next.outbox).map((e: any) => e.id),
        );
        for (const p of pending) {
          const result = l.consider(
            {
              id: p.entry.id,
              kind: "message",
              author: f.identity.public,
              readers: p.bundle.manifest.keys.map((k) => k.reader),
              public: false,
              content: p.content,
            },
            p.entry.expires,
            p.entry.bytes,
            protectedIds,
          );
          assert.equal(result.decision.status, "accepted");
        }
        return writeProfileState(
          tx,
          Buffer.from(canonical(next)),
          f.internals.privateDigest,
        );
      }).value,
  );
  f.internals.privateState = next;
  f.internals.privateDigest = digest;
  return pending.map((p) => p.entry);
}

export function createFixtureSuccessorGroup(
  f: ReturnType<typeof groupOutboxFixture>,
) {
  const group = f.command({
    action: "create",
    operationId: randomUUID(),
    title: "Fresh audience review",
  }).group;
  const anchor = f.command({
    action: "proofs",
    groupId: group.id,
    from: 0,
  }).anchor;
  const invitation = f.command({
    action: "invite",
    operationId: randomUUID(),
    groupId: group.id,
    expected: group.head.id,
    card: f.reader.public,
  }).operation.certificate;
  const consent = acceptGroupInvitation(
    f.reader,
    anchor,
    group.head,
    invitation,
  );
  return f.command({
    action: "commit",
    operationId: randomUUID(),
    groupId: group.id,
    expected: group.head.id,
    title: "Fresh audience review",
    members: [f.identity.public, f.reader.public],
    joins: [consent],
  }).group;
}
