import {
  canonical,
  createBundle,
  decryptBundle,
  validateIdentity,
  verifyBundle,
  type Bundle,
  type Identity,
  type PublicIdentity,
  type Manifest,
} from "../../core/src/index.js";
import {
  memberCardHash,
  verifyGroupAnchor,
  verifyGroupConsent,
  verifyGroupEpoch,
  verifyGroupInvitation,
  verifyGroupLeave,
  type GroupAnchor,
  type GroupConsent,
  type GroupEpoch,
  type GroupInvitation,
  type GroupLeave,
} from "./certificates.js";
import { RegistryIntegrityError, type RegistryTransaction } from "./storage.js";

export const NOTICE_LIMITS = Object.freeze({
  plaintext: 32 * 1024,
  bundle: 64 * 1024,
  ttl: 3600000,
  inbox: 64,
  outbox: 64,
  perIssuer: 8,
  retired: 256,
});
export class GroupNoticeError extends Error {}
type Common = {
  type: "group-notice";
  version: 1;
  anchor: GroupAnchor;
  parent: GroupEpoch;
  member: PublicIdentity;
};
export type GroupNotice = Common &
  (
    | { kind: "invitation"; certificate: GroupInvitation }
    | {
        kind: "consent";
        certificate: GroupConsent;
        invitation: GroupInvitation;
      }
    | { kind: "leave"; certificate: GroupLeave }
  );
export type NoticeDirection = "in" | "out";
export type NoticeEntry = {
  version: 1;
  direction: NoticeDirection;
  sequence: number;
  notice: GroupNotice;
};
type Retired = {
  version: 1;
  items: { id: string; direction: NoticeDirection; sequence: number }[];
};
const retiredKey = "group-notice:retired";
const prefix = (direction: NoticeDirection) => `group-notice:${direction}:`;
const address = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function insist(value: unknown, message: string): asserts value {
  if (!value) throw new GroupNoticeError(message);
}
function exact(value: any, keys: string[]) {
  insist(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join(",") === [...keys].sort().join(","),
    "Campos de aviso inválidos",
  );
}

/** A verified notice proves its certificates, not current membership, ancestry
 * completeness, consent on this installation, or permission to change a group. */
export function verifyGroupNotice(value: unknown): GroupNotice {
  try {
    const bytes = canonical(value);
    insist(
      Buffer.byteLength(bytes) <= NOTICE_LIMITS.plaintext,
      "Aviso excede o limite",
    );
    const v = JSON.parse(bytes);
    exact(v, [
      "type",
      "version",
      "kind",
      "anchor",
      "parent",
      "member",
      "certificate",
      ...(v?.kind === "consent" ? ["invitation"] : []),
    ]);
    insist(
      v.type === "group-notice" &&
        v.version === 1 &&
        validateIdentity(v.member),
      "Aviso de grupo inválido",
    );
    const anchor = verifyGroupAnchor(v.anchor),
      parent = verifyGroupEpoch(v.parent, anchor);
    insist(
      v.member.id !== anchor.body.creator.id,
      "Aviso dirigido a um membro distinto do criador",
    );
    switch (v.kind) {
      case "invitation":
        verifyGroupInvitation(v.certificate, anchor, parent, v.member);
        break;
      case "consent": {
        const invitation = verifyGroupInvitation(
          v.invitation,
          anchor,
          parent,
          v.member,
        );
        const consent = verifyGroupConsent(
          v.certificate,
          anchor,
          parent,
          v.member,
        );
        insist(
          consent.body.invitationHash === invitation.id,
          "Consentimento não corresponde ao convite",
        );
        break;
      }
      case "leave":
        verifyGroupLeave(v.certificate, anchor, parent, v.member);
        break;
      default:
        throw new GroupNoticeError("Tipo de aviso desconhecido");
    }
    return structuredClone(v);
  } catch (error) {
    throw new GroupNoticeError((error as Error).message);
  }
}
export function noticeParties(notice: GroupNotice) {
  return notice.kind === "invitation"
    ? { issuer: notice.anchor.body.creator, recipient: notice.member }
    : { issuer: notice.member, recipient: notice.anchor.body.creator };
}
export function verifyNoticeEnvelope(bundle: Bundle) {
  insist(
    Buffer.byteLength(canonical(bundle)) <= NOTICE_LIMITS.bundle,
    "Envelope de aviso excede o limite",
  );
  verifyBundle(bundle);
  insist(
    noticeManifestPolicy(bundle.manifest),
    "Aviso exige envelope privado limitado",
  );
}
/** Policy only; the caller must already have verified the manifest signature. */
export function noticeManifestPolicy(m: Manifest): boolean {
  return (
    m.kind === "group-notice" &&
    !m.publicKey &&
    m.expires - m.created <= NOTICE_LIMITS.ttl + 10 &&
    m.chunks.reduce((n, c) => n + c.size, 0) <= NOTICE_LIMITS.plaintext
  );
}
export function openGroupNotice(
  bundle: Bundle,
  identity: Identity,
): GroupNotice {
  verifyNoticeEnvelope(bundle);
  const notice = verifyGroupNotice(decryptBundle(bundle, identity));
  const { issuer, recipient } = noticeParties(notice);
  insist(
    memberCardHash(bundle.manifest.author) === memberCardHash(issuer),
    "Assinante exterior não é o emissor do aviso",
  );
  insist(
    canonical(bundle.manifest.keys.map((k) => k.reader).sort()) ===
      canonical([issuer.id, recipient.id].sort()),
    "Aviso alarga os destinatários",
  );
  return notice;
}
export function sealGroupNotice(
  identity: Identity,
  value: GroupNotice,
): Bundle {
  const notice = verifyGroupNotice(value),
    { issuer, recipient } = noticeParties(notice);
  insist(
    memberCardHash(identity.public) === memberCardHash(issuer),
    "Só o emissor pode assinar o aviso",
  );
  const bundle = createBundle(
    identity,
    "group-notice",
    notice,
    [recipient],
    NOTICE_LIMITS.ttl,
  );
  openGroupNotice(bundle, identity);
  return bundle;
}

/** Transaction-scoped encrypted metadata. Does not enrol, consent, sign,
 * transmit, choose an authority head, or make an incoming notice actionable. */
export class GroupNotices {
  constructor(
    private readonly tx: RegistryTransaction,
    private readonly owner: PublicIdentity,
  ) {
    insist(
      validateIdentity(owner) && tx.indexBody().owner === owner.id,
      "Avisos de outro perfil",
    );
  }
  private guard() {
    insist(
      this.tx.indexBody().owner === this.owner.id,
      "Avisos de outro perfil",
    );
  }
  /** Authenticated index count only. Opening the inbox still verifies each notice. */
  count(direction: NoticeDirection): number {
    this.guard();
    insist(direction === "in" || direction === "out", "Direcção inválida");
    const count = this.tx.keys(prefix(direction)).length;
    return this.persisted(() => {
      insist(
        count <=
          (direction === "in" ? NOTICE_LIMITS.inbox : NOTICE_LIMITS.outbox),
        "Demasiados avisos persistidos",
      );
      return count;
    });
  }
  private persisted<T>(read: () => T): T {
    try {
      return read();
    } catch (error) {
      return this.tx.abort(
        new RegistryIntegrityError(
          "Registo de aviso inválido: " + (error as Error).message,
        ),
      );
    }
  }
  private decode(bytes: Buffer): any {
    const value = JSON.parse(bytes.toString("utf8"));
    insist(
      Buffer.from(canonical(value)).equals(bytes),
      "Aviso persistido não canónico",
    );
    return value;
  }
  private retired(): Retired {
    this.guard();
    const bytes = this.tx.get(retiredKey);
    if (!bytes) return { version: 1, items: [] };
    return this.persisted(() => {
      insist(bytes.length <= 48 * 1024, "Histórico de avisos excedido");
      const value = this.decode(bytes);
      exact(value, ["version", "items"]);
      insist(
        value.version === 1 &&
          Array.isArray(value.items) &&
          value.items.length <= NOTICE_LIMITS.retired,
        "Histórico de avisos inválido",
      );
      const seen = new Set<string>();
      for (const item of value.items) {
        exact(item, ["id", "direction", "sequence"]);
        insist(
          address(item.id) &&
            ["in", "out"].includes(item.direction) &&
            Number.isSafeInteger(item.sequence) &&
            item.sequence > 0 &&
            item.sequence <=
              this.tx.indexBody().entries.find((e) => e.key === retiredKey)!
                .revision,
          "Entrada retirada inválida",
        );
        const key = item.direction + ":" + item.id;
        insist(!seen.has(key), "Histórico de avisos duplicado");
        seen.add(key);
      }
      return value;
    });
  }
  list(direction: NoticeDirection): NoticeEntry[] {
    this.guard();
    insist(direction === "in" || direction === "out", "Direcção inválida");
    const keys = this.tx.keys(prefix(direction));
    const retired = new Set(
      this.retired()
        .items.filter((i) => i.direction === direction)
        .map((i) => i.id),
    );
    return this.persisted(() => {
      insist(
        keys.length <=
          (direction === "in" ? NOTICE_LIMITS.inbox : NOTICE_LIMITS.outbox),
        "Demasiados avisos persistidos",
      );
      const issuers = new Map<string, number>();
      return keys
        .map((key) => {
          const bytes = this.tx.get(key)!;
          insist(
            bytes.length <= NOTICE_LIMITS.plaintext + 256,
            "Registo de aviso excedido",
          );
          const entry = this.decode(bytes) as NoticeEntry;
          exact(entry, ["version", "direction", "sequence", "notice"]);
          const notice = verifyGroupNotice(entry.notice),
            { issuer, recipient } = noticeParties(notice);
          insist(
            !retired.has(notice.certificate.id),
            "Aviso retirado ainda está activo",
          );
          issuers.set(issuer.id, (issuers.get(issuer.id) ?? 0) + 1);
          if (direction === "in")
            insist(
              issuers.get(issuer.id)! <= NOTICE_LIMITS.perIssuer,
              "Limite persistido por emissor excedido",
            );
          insist(
            entry.version === 1 &&
              entry.direction === direction &&
              key === prefix(direction) + notice.certificate.id &&
              (direction === "in" ? recipient.id : issuer.id) ===
                this.owner.id &&
              entry.sequence ===
                this.tx.indexBody().entries.find((e) => e.key === key)!
                  .revision,
            "Aviso persistido de outro contexto",
          );
          return structuredClone(entry);
        })
        .sort(
          (a, b) =>
            a.sequence - b.sequence ||
            a.notice.certificate.id.localeCompare(b.notice.certificate.id),
        );
    });
  }
  save(
    direction: NoticeDirection,
    value: GroupNotice,
  ): "stored" | "duplicate" | "retired" {
    this.guard();
    insist(direction === "in" || direction === "out", "Direcção inválida");
    const notice = verifyGroupNotice(value),
      { issuer, recipient } = noticeParties(notice),
      id = notice.certificate.id;
    insist(
      (direction === "in" ? recipient.id : issuer.id) === this.owner.id,
      "Aviso destinado a outro perfil",
    );
    if (
      this.retired().items.some((i) => i.direction === direction && i.id === id)
    )
      return "retired";
    const entries = this.list(direction),
      old = entries.find((e) => e.notice.certificate.id === id);
    if (old) {
      insist(
        canonical(old.notice) === canonical(notice),
        "Mesmo certificado com material diferente",
      );
      return "duplicate";
    }
    insist(
      entries.length <
        (direction === "in" ? NOTICE_LIMITS.inbox : NOTICE_LIMITS.outbox),
      "Caixa de avisos cheia",
    );
    if (direction === "in")
      insist(
        entries.filter((e) => noticeParties(e.notice).issuer.id === issuer.id)
          .length < NOTICE_LIMITS.perIssuer,
        "Limite de avisos por emissor",
      );
    const entry: NoticeEntry = {
      version: 1,
      direction,
      sequence: this.tx.indexBody().revision + 1,
      notice,
    };
    this.tx.put(prefix(direction) + id, Buffer.from(canonical(entry)));
    return "stored";
  }
  retire(direction: NoticeDirection, id: string): boolean {
    this.guard();
    insist(address(id), "Identificador de aviso inválido");
    const entry = this.list(direction).find(
      (e) => e.notice.certificate.id === id,
    );
    if (!entry) return false;
    const history = this.retired();
    history.items = history.items.filter(
      (i) => i.id !== id || i.direction !== direction,
    );
    history.items.push({
      id,
      direction,
      sequence: this.tx.indexBody().revision + 1,
    });
    history.items = history.items.slice(-NOTICE_LIMITS.retired);
    // Deletion and replay memory commit together; refusal rolls both back.
    try {
      this.tx.delete(prefix(direction) + id);
      this.tx.put(retiredKey, Buffer.from(canonical(history)));
    } catch (error) {
      return this.tx.abort(error as Error);
    }
    return true;
  }
}
