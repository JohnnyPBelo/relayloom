import {
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from "node:crypto";
import {
  canonical,
  hash,
  validateIdentity,
  type Identity,
  type PublicIdentity,
} from "../../core/src/index.js";

export const GROUP_LIMITS = Object.freeze({
  members: 64,
  epochs: 1024,
  certificateBytes: 2048,
  headerBytes: 16384,
  snapshotBytes: 524288,
});
export interface Certificate<T> {
  body: T;
  id: string;
  signature: string;
}
export interface AnchorBody {
  domain: "relayloom/group-anchor/1";
  creator: PublicIdentity;
  nonce: string;
  membershipAuthority: "creator-only";
}
export type GroupAnchor = Certificate<AnchorBody>;
export interface MemberCommitment {
  id: string;
  cardHash: string;
}
export interface EpochBody {
  domain: "relayloom/group-epoch/1";
  groupId: string;
  number: number;
  previous: string | null;
  state: "open" | "closed";
  members: MemberCommitment[];
  snapshotHash: string;
}
export type GroupEpoch = Certificate<EpochBody>;
export interface InvitationBody {
  domain: "relayloom/group-invitation/1";
  groupId: string;
  parentEpochId: string;
  inviteeId: string;
  inviteeCardHash: string;
  invitationNonce: string;
}
export type GroupInvitation = Certificate<InvitationBody>;
export interface ConsentBody {
  domain: "relayloom/group-consent/1";
  groupId: string;
  parentEpochId: string;
  invitationHash: string;
  cardHash: string;
  joinNonce: string;
}
export type GroupConsent = Certificate<ConsentBody>;
export interface LeaveBody {
  domain: "relayloom/group-leave/1";
  groupId: string;
  parentEpochId: string;
  memberId: string;
  cardHash: string;
  leaveNonce: string;
}
export type GroupLeave = Certificate<LeaveBody>;
export interface GroupSnapshot {
  domain: "relayloom/group-state/1";
  groupId: string;
  salt: string;
  title: string;
  members: PublicIdentity[];
  joins: GroupConsent[];
}

function requireThat(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function record(value: unknown, keys: string[]): Record<string, any> {
  requireThat(
    value &&
      typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype,
    "Registo de grupo inválido",
  );
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireThat(
    Reflect.ownKeys(value).length === keys.length &&
      keys.every(
        (key) => Object.hasOwn(descriptors, key) && "value" in descriptors[key],
      ),
    "Campos de grupo inválidos",
  );
  return value as Record<string, any>;
}
function list(value: unknown, minimum: number, maximum: number): any[] {
  requireThat(
    Array.isArray(value) &&
      Object.getPrototypeOf(value) === Array.prototype &&
      value.length >= minimum &&
      value.length <= maximum,
    "Lista de grupo fora dos limites",
  );
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireThat(
    Reflect.ownKeys(value).length === value.length + 1 &&
      Array.from(
        { length: value.length },
        (_, i) => descriptors[String(i)],
      ).every((d) => d && "value" in d),
    "Lista de grupo inválida",
  );
  return value;
}
function address(value: unknown): asserts value is string {
  requireThat(
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
    "Endereço de grupo inválido",
  );
}
function base64(value: unknown, size: number): Buffer {
  requireThat(
    typeof value === "string" && value.length === 4 * Math.ceil(size / 3),
    "Codificação de grupo inválida",
  );
  const bytes = Buffer.from(value, "base64");
  requireThat(
    bytes.length === size && bytes.toString("base64") === value,
    "Codificação de grupo não canónica",
  );
  return bytes;
}
function bounded(value: unknown, maximum: number): string {
  const text = canonical(value);
  requireThat(
    Buffer.byteLength(text) <= maximum,
    "Certificado de grupo demasiado grande",
  );
  return text;
}
export function memberCardHash(card: PublicIdentity): string {
  requireThat(validateIdentity(card), "Cartão de membro inválido");
  return hash(canonical(card));
}
function checkCertificate<T>(
  value: unknown,
  body: (value: unknown) => T,
  signer: PublicIdentity,
  maximum: number,
): Certificate<T> {
  requireThat(validateIdentity(signer), "Autoridade de grupo inválida");
  const cert = record(value, ["body", "id", "signature"]);
  const checked = body(cert.body);
  address(cert.id);
  const signature = base64(cert.signature, 64);
  const text = bounded(checked, maximum);
  bounded(cert, maximum);
  requireThat(cert.id === hash(text), "Hash do certificado não coincide");
  const key = createPublicKey({
    key: Buffer.from(signer.signKey, "base64"),
    format: "der",
    type: "spki",
  });
  requireThat(
    verify(null, Buffer.from(text), key, signature),
    "Assinatura de grupo inválida",
  );
  return structuredClone(cert) as Certificate<T>;
}
function signCertificate<T>(
  body: T,
  identity: Identity,
  maximum: number,
): Certificate<T> {
  requireThat(
    validateIdentity(identity.public),
    "Identidade de assinatura inválida",
  );
  const key = createPrivateKey({
    key: Buffer.from(identity.signSecret, "base64"),
    format: "der",
    type: "pkcs8",
  });
  requireThat(
    key.asymmetricKeyType === "ed25519" &&
      createPublicKey(key)
        .export({ format: "der", type: "spki" })
        .toString("base64") === identity.public.signKey,
    "A chave não pertence à autoridade",
  );
  const text = bounded(body, maximum);
  const cert = {
    body: structuredClone(body),
    id: hash(text),
    signature: sign(null, Buffer.from(text), key).toString("base64"),
  };
  bounded(cert, maximum);
  return cert;
}
function anchorBody(value: unknown): AnchorBody {
  const b = record(value, [
    "domain",
    "creator",
    "nonce",
    "membershipAuthority",
  ]);
  requireThat(
    b.domain === "relayloom/group-anchor/1" &&
      b.membershipAuthority === "creator-only",
    "Versão ou autoridade de grupo inválida",
  );
  memberCardHash(b.creator);
  base64(b.nonce, 32);
  return b as AnchorBody;
}
export function verifyGroupAnchor(value: unknown): GroupAnchor {
  const cert = record(value, ["body", "id", "signature"]);
  const body = anchorBody(cert.body);
  return checkCertificate(
    value,
    anchorBody,
    body.creator,
    GROUP_LIMITS.certificateBytes,
  );
}
export function createGroupAnchor(identity: Identity): GroupAnchor {
  return verifyGroupAnchor(
    signCertificate<AnchorBody>(
      {
        domain: "relayloom/group-anchor/1",
        creator: identity.public,
        nonce: randomBytes(32).toString("base64"),
        membershipAuthority: "creator-only",
      },
      identity,
      GROUP_LIMITS.certificateBytes,
    ),
  );
}
function commitments(value: unknown): MemberCommitment[] {
  let previous = "";
  return list(value, 1, GROUP_LIMITS.members).map((item) => {
    const member = record(item, ["id", "cardHash"]);
    address(member.id);
    address(member.cardHash);
    requireThat(member.id > previous, "Membros repetidos ou fora de ordem");
    previous = member.id;
    return member as MemberCommitment;
  });
}
function epochBody(value: unknown): EpochBody {
  const b = record(value, [
    "domain",
    "groupId",
    "number",
    "previous",
    "state",
    "members",
    "snapshotHash",
  ]);
  requireThat(
    b.domain === "relayloom/group-epoch/1",
    "Versão de época inválida",
  );
  address(b.groupId);
  address(b.snapshotHash);
  requireThat(
    Number.isSafeInteger(b.number) &&
      b.number >= 0 &&
      b.number < GROUP_LIMITS.epochs,
    "Número de época inválido",
  );
  if (b.number === 0)
    requireThat(b.previous === null, "Época inicial tem antecessor");
  else address(b.previous);
  requireThat(
    b.state === "open" || b.state === "closed",
    "Estado de época inválido",
  );
  requireThat(
    b.number !== GROUP_LIMITS.epochs - 1 || b.state === "closed",
    "Última época reservada ao encerramento",
  );
  commitments(b.members);
  return b as EpochBody;
}
/** Checks the signed header only. Adoption also requires the verified parent/chain. */
export function verifyGroupEpoch(
  value: unknown,
  anchorValue: GroupAnchor,
): GroupEpoch {
  const anchor = verifyGroupAnchor(anchorValue);
  const cert = checkCertificate(
    value,
    epochBody,
    anchor.body.creator,
    GROUP_LIMITS.headerBytes,
  );
  requireThat(cert.body.groupId === anchor.id, "Época pertence a outro grupo");
  requireThat(
    cert.body.members.some((m) => m.id === anchor.body.creator.id),
    "Época não conserva o criador",
  );
  if (cert.body.number === 0)
    requireThat(
      cert.body.state === "open" &&
        cert.body.members.length === 1 &&
        cert.body.members[0].cardHash === memberCardHash(anchor.body.creator),
      "Época inicial deve conter apenas o cartão original do criador",
    );
  return cert;
}

function invitationBody(value: unknown): InvitationBody {
  const b = record(value, [
    "domain",
    "groupId",
    "parentEpochId",
    "inviteeId",
    "inviteeCardHash",
    "invitationNonce",
  ]);
  requireThat(
    b.domain === "relayloom/group-invitation/1",
    "Versão de convite inválida",
  );
  for (const key of [
    "groupId",
    "parentEpochId",
    "inviteeId",
    "inviteeCardHash",
  ])
    address(b[key]);
  base64(b.invitationNonce, 32);
  return b as InvitationBody;
}
function consentBody(value: unknown): ConsentBody {
  const b = record(value, [
    "domain",
    "groupId",
    "parentEpochId",
    "invitationHash",
    "cardHash",
    "joinNonce",
  ]);
  requireThat(
    b.domain === "relayloom/group-consent/1",
    "Versão de consentimento inválida",
  );
  for (const key of ["groupId", "parentEpochId", "invitationHash", "cardHash"])
    address(b[key]);
  base64(b.joinNonce, 32);
  return b as ConsentBody;
}
function owner(identity: Identity, anchor: GroupAnchor): void {
  requireThat(
    identity.public.id === anchor.body.creator.id &&
      identity.public.signKey === anchor.body.creator.signKey,
    "Só o criador pode alterar os membros",
  );
}
export function verifyGroupInvitation(
  value: unknown,
  anchor: GroupAnchor,
  parent: GroupEpoch,
  invitee: PublicIdentity,
): GroupInvitation {
  const checkedParent = verifyGroupEpoch(parent, anchor);
  requireThat(checkedParent.body.state === "open", "Grupo encerrado");
  const cert = checkCertificate(
    value,
    invitationBody,
    anchor.body.creator,
    GROUP_LIMITS.certificateBytes,
  );
  requireThat(
    cert.body.groupId === anchor.id &&
      cert.body.parentEpochId === checkedParent.id,
    "Convite de outro grupo ou de uma época anterior",
  );
  requireThat(
    cert.body.inviteeId === invitee.id &&
      cert.body.inviteeCardHash === memberCardHash(invitee),
    "Convite não corresponde ao cartão apresentado",
  );
  return cert;
}
export function createGroupInvitation(
  identity: Identity,
  anchor: GroupAnchor,
  parent: GroupEpoch,
  invitee: PublicIdentity,
): GroupInvitation {
  verifyGroupAnchor(anchor);
  owner(identity, anchor);
  const body: InvitationBody = {
    domain: "relayloom/group-invitation/1",
    groupId: anchor.id,
    parentEpochId: parent.id,
    inviteeId: invitee.id,
    inviteeCardHash: memberCardHash(invitee),
    invitationNonce: randomBytes(32).toString("base64"),
  };
  return verifyGroupInvitation(
    signCertificate(body, identity, GROUP_LIMITS.certificateBytes),
    anchor,
    parent,
    invitee,
  );
}
export function verifyGroupConsent(
  value: unknown,
  anchor: GroupAnchor,
  parent: GroupEpoch,
  member: PublicIdentity,
): GroupConsent {
  const checkedParent = verifyGroupEpoch(parent, anchor);
  requireThat(checkedParent.body.state === "open", "Grupo encerrado");
  const cert = checkCertificate(
    value,
    consentBody,
    member,
    GROUP_LIMITS.certificateBytes,
  );
  requireThat(
    cert.body.groupId === anchor.id &&
      cert.body.parentEpochId === checkedParent.id &&
      cert.body.cardHash === memberCardHash(member),
    "Consentimento não corresponde ao grupo, época ou cartão",
  );
  return cert;
}
export function acceptGroupInvitation(
  identity: Identity,
  anchor: GroupAnchor,
  parent: GroupEpoch,
  invitation: GroupInvitation,
): GroupConsent {
  const invite = verifyGroupInvitation(
    invitation,
    anchor,
    parent,
    identity.public,
  );
  const body: ConsentBody = {
    domain: "relayloom/group-consent/1",
    groupId: anchor.id,
    parentEpochId: parent.id,
    invitationHash: invite.id,
    cardHash: memberCardHash(identity.public),
    joinNonce: randomBytes(32).toString("base64"),
  };
  return verifyGroupConsent(
    signCertificate(body, identity, GROUP_LIMITS.certificateBytes),
    anchor,
    parent,
    identity.public,
  );
}
function leaveBody(value: unknown): LeaveBody {
  const b = record(value, [
    "domain",
    "groupId",
    "parentEpochId",
    "memberId",
    "cardHash",
    "leaveNonce",
  ]);
  requireThat(
    b.domain === "relayloom/group-leave/1",
    "Versão de saída inválida",
  );
  for (const key of ["groupId", "parentEpochId", "memberId", "cardHash"])
    address(b[key]);
  base64(b.leaveNonce, 32);
  return b as LeaveBody;
}
export function verifyGroupLeave(
  value: unknown,
  anchor: GroupAnchor,
  parent: GroupEpoch,
  member: PublicIdentity,
): GroupLeave {
  const head = verifyGroupEpoch(parent, anchor);
  requireThat(
    head.body.state === "open" && member.id !== anchor.body.creator.id,
    "O criador encerra o grupo; não abandona a autoridade",
  );
  const cert = checkCertificate(
    value,
    leaveBody,
    member,
    GROUP_LIMITS.certificateBytes,
  );
  const cardHash = memberCardHash(member);
  requireThat(
    cert.body.groupId === anchor.id &&
      cert.body.parentEpochId === head.id &&
      cert.body.memberId === member.id &&
      cert.body.cardHash === cardHash &&
      head.body.members.some(
        (m) => m.id === member.id && m.cardHash === cardHash,
      ),
    "Pedido de saída não corresponde à participação actual",
  );
  return cert;
}
/** Caller must persist its local-left fence before attempting to transmit this request. */
export function createGroupLeave(
  identity: Identity,
  anchor: GroupAnchor,
  parent: GroupEpoch,
): GroupLeave {
  const body: LeaveBody = {
    domain: "relayloom/group-leave/1",
    groupId: anchor.id,
    parentEpochId: parent.id,
    memberId: identity.public.id,
    cardHash: memberCardHash(identity.public),
    leaveNonce: randomBytes(32).toString("base64"),
  };
  return verifyGroupLeave(
    signCertificate(body, identity, GROUP_LIMITS.certificateBytes),
    anchor,
    parent,
    identity.public,
  );
}
function snapshotBody(value: unknown): GroupSnapshot {
  const s = record(value, [
    "domain",
    "groupId",
    "salt",
    "title",
    "members",
    "joins",
  ]);
  requireThat(
    s.domain === "relayloom/group-state/1",
    "Versão de estado inválida",
  );
  address(s.groupId);
  base64(s.salt, 32);
  requireThat(
    typeof s.title === "string" && s.title.length <= 256,
    "Título de grupo inválido",
  );
  let previous = "";
  const cardsByHash = new Map<string, PublicIdentity>();
  for (const card of list(s.members, 1, GROUP_LIMITS.members)) {
    cardsByHash.set(memberCardHash(card), card);
    requireThat(card.id > previous, "Cartões repetidos ou fora de ordem");
    previous = card.id;
  }
  let previousConsent = "";
  for (const value of list(s.joins, 0, GROUP_LIMITS.members)) {
    const cert = record(value, ["body", "id", "signature"]),
      body = consentBody(cert.body);
    const card = cardsByHash.get(body.cardHash);
    requireThat(card, "Consentimento sem cartão correspondente");
    checkCertificate(value, consentBody, card, GROUP_LIMITS.certificateBytes);
    requireThat(
      body.groupId === s.groupId && body.cardHash > previousConsent,
      "Consentimentos repetidos, fora de ordem ou de outro grupo",
    );
    previousConsent = body.cardHash;
  }
  bounded(s, GROUP_LIMITS.snapshotBytes);
  return s as GroupSnapshot;
}
export function verifyGroupSnapshot(
  value: unknown,
  anchor: GroupAnchor,
  epoch: GroupEpoch,
): GroupSnapshot {
  const head = verifyGroupEpoch(epoch, anchor),
    snapshot = snapshotBody(value);
  requireThat(
    snapshot.groupId === anchor.id &&
      hash(canonical(snapshot)) === head.body.snapshotHash,
    "Estado não corresponde ao compromisso assinado",
  );
  const roster = snapshot.members.map((m) => ({
    id: m.id,
    // snapshotBody verified each complete card in this synchronous call.
    cardHash: hash(canonical(m)),
  }));
  requireThat(
    canonical(roster) === canonical(head.body.members),
    "Estado altera os cartões aprovados",
  );
  if (head.body.number === 0)
    requireThat(
      snapshot.joins.length === 0,
      "Época inicial contém consentimentos",
    );
  else if (head.body.state === "open")
    requireThat(
      snapshot.joins.every((c) => c.body.parentEpochId === head.body.previous),
      "Consentimento de outra transição",
    );
  return structuredClone(snapshot);
}
/** A valid link establishes neither a globally current head nor absence of a signed fork. */
export function verifyGroupEpochLink(
  anchor: GroupAnchor,
  parentValue: GroupEpoch,
  nextValue: GroupEpoch,
): "nonrestrictive" | "restrictive" {
  const parent = verifyGroupEpoch(parentValue, anchor),
    next = verifyGroupEpoch(nextValue, anchor);
  requireThat(
    parent.body.state === "open",
    "Não pode suceder a um grupo encerrado",
  );
  requireThat(
    next.body.number === parent.body.number + 1 &&
      next.body.previous === parent.id,
    "Cadeia de épocas descontínua",
  );
  if (next.body.state === "closed") {
    requireThat(
      canonical(next.body.members) === canonical(parent.body.members) &&
        next.body.snapshotHash === parent.body.snapshotHash,
      "Encerramento deve conservar o estado histórico",
    );
    return "restrictive";
  }
  return parent.body.members.every((old) =>
    next.body.members.some(
      (m) => m.id === old.id && m.cardHash === old.cardHash,
    ),
  )
    ? "nonrestrictive"
    : "restrictive";
}
export function classifyGroupEpochPath(
  anchor: GroupAnchor,
  values: GroupEpoch[],
): "nonrestrictive" | "restrictive" {
  const path = list(values, 1, GROUP_LIMITS.epochs);
  verifyGroupEpoch(path[0], anchor);
  let restrictive = false;
  for (let i = 1; i < path.length; i++)
    if (verifyGroupEpochLink(anchor, path[i - 1], path[i]) === "restrictive")
      restrictive = true;
  return restrictive ? "restrictive" : "nonrestrictive";
}
export function verifyGroupTransition(
  anchor: GroupAnchor,
  parent: GroupEpoch,
  oldState: GroupSnapshot,
  next: GroupEpoch,
  newState: GroupSnapshot,
): "nonrestrictive" | "restrictive" {
  const kind = verifyGroupEpochLink(anchor, parent, next);
  const before = verifyGroupSnapshot(oldState, anchor, parent),
    after = verifyGroupSnapshot(newState, anchor, next);
  if (next.body.state === "closed") return kind;
  const oldCards = new Map(
    before.members.map((card) => [card.id, hash(canonical(card))]),
  );
  const changed = after.members.filter(
    (card) => oldCards.get(card.id) !== hash(canonical(card)),
  );
  requireThat(
    after.joins.length === changed.length,
    "A alteração exige exactamente os consentimentos dos novos cartões",
  );
  const consents = new Map(
    after.joins.map((consent) => [consent.body.cardHash, consent]),
  );
  for (const card of changed) {
    const consent = consents.get(hash(canonical(card)));
    requireThat(consent, "Falta consentimento do membro");
    verifyGroupConsent(consent, anchor, parent, card);
  }
  return kind;
}
function makeSnapshot(
  groupId: string,
  title: string,
  members: PublicIdentity[],
  joins: GroupConsent[],
): GroupSnapshot {
  return snapshotBody({
    domain: "relayloom/group-state/1",
    groupId,
    salt: randomBytes(32).toString("base64"),
    title,
    members: [...members].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
    joins: [...joins].sort((a, b) =>
      a.body.cardHash < b.body.cardHash
        ? -1
        : a.body.cardHash > b.body.cardHash
          ? 1
          : 0,
    ),
  });
}
export function createAnchoredGroup(
  identity: Identity,
  title: string,
): { anchor: GroupAnchor; epoch: GroupEpoch; snapshot: GroupSnapshot } {
  const anchor = createGroupAnchor(identity),
    snapshot = makeSnapshot(anchor.id, title, [identity.public], []);
  const body: EpochBody = {
    domain: "relayloom/group-epoch/1",
    groupId: anchor.id,
    number: 0,
    previous: null,
    state: "open",
    members: [
      { id: identity.public.id, cardHash: memberCardHash(identity.public) },
    ],
    snapshotHash: hash(canonical(snapshot)),
  };
  const epoch = verifyGroupEpoch(
    signCertificate(body, identity, GROUP_LIMITS.headerBytes),
    anchor,
  );
  return {
    anchor,
    epoch,
    snapshot: verifyGroupSnapshot(snapshot, anchor, epoch),
  };
}
export function createGroupSuccessor(
  identity: Identity,
  anchor: GroupAnchor,
  parent: GroupEpoch,
  oldState: GroupSnapshot,
  update: { title: string; members: PublicIdentity[]; joins: GroupConsent[] },
): { epoch: GroupEpoch; snapshot: GroupSnapshot } {
  verifyGroupAnchor(anchor);
  owner(identity, anchor);
  verifyGroupSnapshot(oldState, anchor, parent);
  const snapshot = makeSnapshot(
    anchor.id,
    update.title,
    update.members,
    update.joins,
  );
  const body: EpochBody = {
    domain: "relayloom/group-epoch/1",
    groupId: anchor.id,
    number: parent.body.number + 1,
    previous: parent.id,
    state: "open",
    members: snapshot.members.map((m) => ({
      id: m.id,
      cardHash: memberCardHash(m),
    })),
    snapshotHash: hash(canonical(snapshot)),
  };
  const epoch = verifyGroupEpoch(
    signCertificate(body, identity, GROUP_LIMITS.headerBytes),
    anchor,
  );
  verifyGroupTransition(anchor, parent, oldState, epoch, snapshot);
  return { epoch, snapshot: structuredClone(snapshot) };
}
export function closeAnchoredGroup(
  identity: Identity,
  anchor: GroupAnchor,
  parent: GroupEpoch,
): GroupEpoch {
  verifyGroupAnchor(anchor);
  owner(identity, anchor);
  verifyGroupEpoch(parent, anchor);
  const body: EpochBody = {
    ...parent.body,
    number: parent.body.number + 1,
    previous: parent.id,
    state: "closed",
  };
  const epoch = verifyGroupEpoch(
    signCertificate(body, identity, GROUP_LIMITS.headerBytes),
    anchor,
  );
  verifyGroupEpochLink(anchor, parent, epoch);
  return epoch;
}
