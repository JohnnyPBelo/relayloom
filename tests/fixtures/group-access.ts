import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createIdentity,
  createBundle,
  decryptBundle,
  verifyBundle,
  type Identity,
} from "../../packages/core/src/index.js";
import {
  ProtectedGroupStore,
  type RegistryLimits,
} from "../../packages/groups/src/storage.js";
import { GroupRegistry } from "../../packages/groups/src/registry.js";
import {
  GroupAccess,
  hasGroupBinding,
  parseGroupBinding,
  type AcceptedGroupContext,
  type GroupContentCandidate,
} from "../../packages/groups/src/access.js";
import type {
  GroupConsent,
  GroupInvitation,
} from "../../packages/groups/src/certificates.js";

export function fixture(t: any) {
  const root = resolve(".cache/group-access");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "case-")),
    stores: ProtectedGroupStore[] = [];
  t.after(() => {
    for (const store of stores) store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const actor = (name: string, limits?: RegistryLimits) => {
    const identity = createIdentity(name),
      store = new ProtectedGroupStore(join(dir, name + ".sqlite"), identity, {
        create: true,
        ...(limits ? { limits } : {}),
      });
    stores.push(store);
    return {
      identity,
      store,
      path: join(dir, name + ".sqlite"),
      storeId: store.storeId(),
      registry: new GroupRegistry(store, identity),
    };
  };
  return { actor };
}
export type Actor = ReturnType<ReturnType<typeof fixture>["actor"]>;
export function enroll(a: Actor, b: Actor, id: string) {
  const parent = a.registry.state(id).head!,
    invitation = a.registry.invite(
      randomUUID(),
      id,
      parent.id,
      b.identity.public,
    ).certificate as GroupInvitation;
  b.registry.rememberInvitation(
    randomUUID(),
    a.registry.anchor(id),
    parent,
    invitation,
  );
  for (let n = 0; n <= parent.body.number; n += 16)
    b.registry.observeHeaders(id, a.registry.proofs(id, n));
  const consent = b.registry.accept(randomUUID(), id, parent.id)
    .certificate as GroupConsent;
  const before = a.registry.privateState(id, parent.id)!;
  const committed = a.registry.commit(randomUUID(), id, parent.id, {
    title: before.title,
    members: [...before.members, b.identity.public],
    joins: [consent],
  });
  sync(a, b, id);
  return committed;
}
export function sync(a: Actor, b: Actor, id: string) {
  const last = b.registry.state(id).head?.body.number ?? -1,
    head = a.registry.state(id).head!;
  for (let n = last + 1; n <= head.body.number; n += 16)
    b.registry.observeHeaders(id, a.registry.proofs(id, n));
  if (head.body.members.some((member) => member.id === b.identity.public.id))
    b.registry.observeSnapshot(
      id,
      head.id,
      a.registry.privateState(id, head.id)!,
    );
}
export function candidate(
  bundle: ReturnType<typeof createBundle>,
  viewer: Identity,
): GroupContentCandidate {
  verifyBundle(bundle);
  return {
    id: bundle.manifest.id,
    kind: bundle.manifest.kind,
    author: bundle.manifest.author,
    readers: bundle.manifest.keys.map((key) => key.reader),
    public: !!bundle.manifest.publicKey,
    content: decryptBundle(bundle, viewer) as Record<string, unknown>,
  };
}
export function message(a: Actor, id: string) {
  const head = a.registry.state(id).head!,
    snapshot = a.registry.privateState(id, head.id)!;
  return createBundle(
    a.identity,
    "message",
    {
      type: "message",
      text: "Exact epoch-bound private message",
      conversation: id,
      groupEpoch: head.id,
      groupAudience: "epoch",
      members: snapshot.members,
    },
    snapshot.members,
  );
}
export function decide(
  a: Actor,
  value: GroupContentCandidate,
  accepted?: AcceptedGroupContext,
  target?: AcceptedGroupContext,
) {
  return a.store.transaction((tx) =>
    GroupRegistry.inTransaction(tx, a.identity, (g) =>
      new GroupAccess(g, a.identity.public).decide(value, accepted, target),
    ),
  ).value;
}
