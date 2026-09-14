import {
  canonical,
  createBundle,
  decryptBundle,
  verifyBundle,
  type Bundle,
  type Identity,
  type PublicIdentity,
  type Manifest,
} from "../../core/src/index.js";
import {
  memberCardHash,
  verifyGroupEpoch,
  verifyGroupInvitation,
  verifyGroupSnapshot,
  type GroupEpoch,
  type GroupInvitation,
  type GroupSnapshot,
} from "./certificates.js";
import type { GroupRegistry } from "./registry.js";

export const CONTROL_LIMITS = Object.freeze({
  plaintext: 1024 * 1024,
  bundle: 2 * 1024 * 1024,
  page: 16,
  pageBytes: 256 * 1024,
  ttl: 3600_000,
});
export class GroupControlError extends Error {}
export type ControlAuthorization = {
  number: number;
  id: string;
  invitation?: GroupInvitation;
};
type Common = { type: "group-control"; version: 1; groupId: string };
export type GroupControl =
  | (Common & {
      action: "headers-request";
      to: string;
      from: number;
      count: number;
      authorization: ControlAuthorization;
    })
  | (Common & {
      action: "snapshot-request";
      to: string;
      number: number;
      epochId: string;
    })
  | (Common & {
      action: "headers";
      to: string;
      from: number;
      headers: unknown[];
      head: unknown;
    })
  | (Common & {
      action: "snapshot";
      epoch: unknown;
      snapshot: unknown;
      to?: string;
    });

const address = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const number = (v: unknown): v is number =>
  Number.isInteger(v) && Number(v) >= 0 && Number(v) < 1024;
function insist(
  value: unknown,
  message = "Carrier de grupo inválido",
): asserts value {
  if (!value) throw new GroupControlError(message);
}
function input<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw new GroupControlError((error as Error).message);
  }
}
function exact(value: any, keys: string[]) {
  insist(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join(",") === [...keys].sort().join(","),
  );
}
function size(value: unknown, limit: number) {
  insist(
    Buffer.byteLength(canonical(value)) <= limit,
    "Carrier excede o limite",
  );
}

/** Shape/resource validation only. In particular, do not reject a whole page
 * for a bad trailing certificate before the registry commits its valid fence. */
export function parseGroupControl(value: unknown): GroupControl {
  size(value, CONTROL_LIMITS.plaintext);
  const v = value as any;
  insist(v?.type === "group-control" && v.version === 1 && address(v.groupId));
  const common = ["type", "version", "groupId", "action"];
  switch (v.action) {
    case "headers-request":
      exact(v, [...common, "to", "from", "count", "authorization"]);
      insist(
        address(v.to) &&
          number(v.from) &&
          Number.isInteger(v.count) &&
          v.count >= 1 &&
          v.count <= CONTROL_LIMITS.page,
      );
      exact(v.authorization, [
        "number",
        "id",
        ...(Object.hasOwn(v.authorization ?? {}, "invitation")
          ? ["invitation"]
          : []),
      ]);
      insist(number(v.authorization.number) && address(v.authorization.id));
      if (v.authorization.invitation !== undefined)
        size(v.authorization.invitation, 2048);
      break;
    case "snapshot-request":
      exact(v, [...common, "to", "number", "epochId"]);
      insist(address(v.to) && number(v.number) && address(v.epochId));
      break;
    case "headers":
      exact(v, [...common, "to", "from", "headers", "head"]);
      insist(
        address(v.to) &&
          number(v.from) &&
          Array.isArray(v.headers) &&
          v.headers.length <= CONTROL_LIMITS.page,
      );
      size(v.headers, CONTROL_LIMITS.pageBytes);
      size(v.head, 16384);
      for (const header of v.headers) size(header, 16384);
      break;
    case "snapshot":
      exact(v, [
        ...common,
        "epoch",
        "snapshot",
        ...(Object.hasOwn(v, "to") ? ["to"] : []),
      ]);
      if (Object.hasOwn(v, "to")) insist(address(v.to));
      size(v.epoch, 16384);
      size(v.snapshot, 524288);
      break;
    default:
      throw new Error("Acção de controlo desconhecida");
  }
  return structuredClone(v);
}

export function openGroupControl(
  bundle: Bundle,
  identity: Identity,
): GroupControl {
  verifyGroupControlEnvelope(bundle);
  const payload = parseGroupControl(decryptBundle(bundle, identity));
  const readers = bundle.manifest.keys.map((k) => k.reader).sort();
  if ("to" in payload) {
    insist(
      payload.to === identity.public.id ||
        bundle.manifest.author.id === identity.public.id,
      "Carrier dirigido a outra identidade",
    );
    insist(
      canonical(readers) ===
        canonical([...new Set([payload.to, bundle.manifest.author.id])].sort()),
      "Envelope de controlo alarga a audiência",
    );
  }
  return payload;
}

/** Policy over an already signature-verified manifest, usable by an opaque
 * seeder. AES-GCM stores its tag separately, so chunk bytes bound plaintext. */
export function groupControlPolicy(manifest: Manifest): boolean {
  return (
    manifest.kind === "group-control" &&
    !manifest.publicKey &&
    manifest.expires - manifest.created <= CONTROL_LIMITS.ttl + 10 &&
    manifest.chunks.reduce((n, c) => n + c.size, 0) <= CONTROL_LIMITS.plaintext
  );
}

/** Reject at the routing validation boundary, before opaque forwarding/store. */
export function verifyGroupControlEnvelope(bundle: Bundle): void {
  size(bundle, CONTROL_LIMITS.bundle);
  verifyBundle(bundle);
  insist(
    bundle.manifest.kind === "group-control" && !bundle.manifest.publicKey,
    "Controlo exige um envelope privado",
  );
  insist(bundle.manifest.expires > Date.now(), "Carrier expirado");
  insist(
    groupControlPolicy(bundle.manifest),
    "Envelope de controlo excede duração ou tamanho",
  );
}

/** Low-level sealing is not membership authority. Runtime callers must first
 * derive recipients/proofs from the authenticated registry transaction. */
export function sealGroupControl(
  identity: Identity,
  value: GroupControl,
  recipients: PublicIdentity[],
): Bundle {
  const payload = parseGroupControl(value);
  const bundle = createBundle(
    identity,
    "group-control",
    payload,
    recipients,
    CONTROL_LIMITS.ttl,
  );
  size(bundle, CONTROL_LIMITS.bundle);
  verifyBundle(bundle);
  insist(
    canonical(openGroupControl(bundle, identity)) === canonical(payload),
    "Controlo assinado incoerente",
  );
  return bundle;
}

function hasCard(epoch: GroupEpoch, card: PublicIdentity) {
  return epoch.body.members.some(
    (m) => m.id === card.id && m.cardHash === memberCardHash(card),
  );
}
function retainedEpoch(
  g: GroupRegistry,
  groupId: string,
  n: number,
  id: string,
  allowFork = false,
) {
  g.assertScope();
  let epoch = g.proofs(groupId, n, 1)[0];
  if (allowFork && epoch?.id !== id) {
    const evidence = g.stopEvidence(groupId);
    if (evidence?.reason === "forked")
      epoch = [evidence.first, evidence.second].find(
        (e) => e.body.number === n && e.id === id,
      )!;
  }
  insist(epoch && epoch.id === id, "Época de autorização indisponível");
  return epoch;
}

/** A removed member can learn the boundary that removed its committed card,
 * but not use an ancient membership to enumerate all later memberships. */
export function requestedHeaders(
  g: GroupRegistry,
  request: Extract<GroupControl, { action: "headers-request" }>,
  requester: PublicIdentity,
) {
  parseGroupControl(request);
  const anchor = g.anchor(request.groupId);
  const auth = retainedEpoch(
    g,
    request.groupId,
    request.authorization.number,
    request.authorization.id,
    true,
  );
  let end = auth;
  if (Object.hasOwn(request.authorization, "invitation")) {
    input(() =>
      verifyGroupInvitation(
        request.authorization.invitation,
        anchor,
        auth,
        requester,
      ),
    );
    end =
      g.proofs(request.groupId, Math.min(1023, auth.body.number + 1), 1)[0] ??
      auth;
  } else {
    insist(hasCard(auth, requester), "Solicitante não pertence à época");
    let cursor = auth.body.number + 1,
      stopped = auth.body.state === "closed";
    while (!stopped && cursor < 1024) {
      const page = g.proofs(request.groupId, cursor, CONTROL_LIMITS.page);
      if (!page.length) break;
      for (const header of page) {
        end = header;
        cursor = header.body.number + 1;
        if (header.body.state === "closed" || !hasCard(header, requester)) {
          stopped = true;
          break;
        }
      }
    }
  }
  const headers =
    request.from > end.body.number
      ? []
      : g.proofs(
          request.groupId,
          request.from,
          Math.min(request.count, end.body.number - request.from + 1),
        );
  const conflict = g.stopEvidence(request.groupId);
  if (
    conflict?.reason === "forked" &&
    conflict.first.body.number <= end.body.number
  ) {
    const alternatives = [conflict.first, conflict.second].sort(
      (a, b) => Number(a.id === auth.id) - Number(b.id === auth.id),
    );
    for (const header of alternatives) {
      if (headers.some((h) => h.id === header.id)) continue;
      if (
        headers.length >= request.count ||
        Buffer.byteLength(canonical([...headers, header])) >
          CONTROL_LIMITS.pageBytes
      )
        break;
      headers.push(header);
    }
  }
  return { headers, head: end };
}

function privateEpoch(g: GroupRegistry, epoch: GroupEpoch) {
  const evidence = g.stopEvidence(epoch.body.groupId);
  insist(
    evidence?.reason !== "forked" ||
      epoch.body.number < evidence.first.body.number,
    "Snapshot de uma época em conflito não pode ser redistribuído",
  );
}

export function requestedSnapshot(
  g: GroupRegistry,
  request: Extract<GroupControl, { action: "snapshot-request" }>,
  requester: PublicIdentity,
  producer: PublicIdentity,
) {
  parseGroupControl(request);
  const epoch = retainedEpoch(
    g,
    request.groupId,
    request.number,
    request.epochId,
  );
  insist(
    hasCard(epoch, requester) && hasCard(epoch, producer),
    "Snapshot não autoriza estes cartões",
  );
  privateEpoch(g, epoch);
  const snapshot = g.privateState(request.groupId, epoch.id);
  insist(snapshot, "Snapshot privado indisponível");
  verifyGroupSnapshot(snapshot, g.anchor(request.groupId), epoch);
  return { epoch, snapshot };
}

export function snapshotCarrier(
  g: GroupRegistry,
  identity: Identity,
  epoch: GroupEpoch,
  snapshot: GroupSnapshot,
) {
  const material = snapshotMaterial(g, identity.public, epoch, snapshot);
  return sealGroupControl(identity, material.payload, material.readers);
}

export function snapshotMaterial(
  g: GroupRegistry,
  producer: PublicIdentity,
  epoch: GroupEpoch,
  snapshot: GroupSnapshot,
  recipient?: PublicIdentity,
) {
  g.assertScope();
  const anchor = g.anchor(epoch.body.groupId);
  const header = verifyGroupEpoch(epoch, anchor),
    checked = verifyGroupSnapshot(snapshot, anchor, header);
  privateEpoch(g, header);
  insist(
    retainedEpoch(g, anchor.id, header.body.number, header.id).id ===
      header.id && hasCard(header, producer),
    "Só um leitor autorizado pode transportar este snapshot",
  );
  if (recipient)
    insist(hasCard(header, recipient), "Destinatário fora do snapshot");
  return {
    payload: {
      type: "group-control",
      version: 1,
      action: "snapshot",
      groupId: anchor.id,
      epoch: header,
      snapshot: checked,
      ...(recipient ? { to: recipient.id } : {}),
    } as Extract<GroupControl, { action: "snapshot" }>,
    readers: recipient ? [recipient] : checked.members,
  };
}

/** Called only after the epoch header has crossed the runtime's normal
 * authority/stop commit. The carrier signature cannot replace creator proof. */
export function checkedSnapshot(
  g: GroupRegistry,
  bundle: Bundle,
  payload: Extract<GroupControl, { action: "snapshot" }>,
) {
  g.assertScope();
  const { epoch, snapshot } = snapshotPreview(
    bundle,
    payload,
    g.anchor(payload.groupId),
  );
  retainedEpoch(g, payload.groupId, epoch.body.number, epoch.id);
  privateEpoch(g, epoch);
  return { epoch, snapshot };
}

/** Called after openGroupControl. A no-op is proven inside one authenticated
 * scope, never inferred from the carrier ID or a cached UI projection. */
export function alreadyAppliedSnapshot(
  g: GroupRegistry,
  bundle: Bundle,
  payload: Extract<GroupControl, { action: "snapshot" }>,
) {
  const info = g.syncState(payload.groupId);
  if (
    info.view.status !== "active" ||
    !info.admitted ||
    info.checkedThrough === null
  )
    return null;
  let checked: ReturnType<typeof snapshotPreview>;
  try {
    checked = snapshotPreview(bundle, payload, info.anchor);
  } catch {
    return null;
  } // The normal path must still apply any valid safety header.
  if (
    checked.epoch.body.number > info.checkedThrough ||
    g.proofs(payload.groupId, checked.epoch.body.number, 1)[0]?.id !==
      checked.epoch.id
  )
    return null;
  const saved = g.privateState(payload.groupId, checked.epoch.id);
  return saved && canonical(saved) === canonical(checked.snapshot)
    ? checked
    : null;
}

/** Cryptographic preview is not adoption. It can identify a potential proof
 * holder without granting keys or letting an unanchored head win. */
export function snapshotPreview(
  bundle: Bundle,
  payload: Extract<GroupControl, { action: "snapshot" }>,
  anchor: import("./certificates.js").GroupAnchor,
) {
  const epoch = input(() => verifyGroupEpoch(payload.epoch, anchor));
  const snapshot = input(() =>
    verifyGroupSnapshot(payload.snapshot, anchor, epoch),
  );
  insist(
    hasCard(epoch, bundle.manifest.author),
    "Assinante exterior não é leitor do snapshot",
  );
  const expected = payload.to
    ? [...new Set([payload.to, bundle.manifest.author.id])].sort()
    : snapshot.members.map((m) => m.id).sort();
  insist(
    (!payload.to || epoch.body.members.some((m) => m.id === payload.to)) &&
      canonical(bundle.manifest.keys.map((k) => k.reader).sort()) ===
        canonical(expected),
    "Carrier de snapshot alarga leitores",
  );
  return { epoch, snapshot };
}
