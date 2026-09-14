import {
  type Bundle,
  type Identity,
} from "../../../packages/core/src/index.js";
import {
  memberCardHash,
  type GroupEpoch,
} from "../../../packages/groups/src/certificates.js";
import type {
  GroupRegistry,
  GroupAuthorityView,
} from "../../../packages/groups/src/registry.js";
import {
  GroupNotices,
  openGroupNotice,
  type GroupNotice,
} from "../../../packages/groups/src/notices.js";
import type { GroupCommand } from "./group-commands.js";

interface NoticeHost {
  identity(): Identity | undefined;
  registry<T>(fn: (g: GroupRegistry, notices: GroupNotices) => T): T;
  apply(command: GroupCommand): unknown;
  publish(value: GroupNotice): void;
  blocked(): readonly string[];
  ready(): boolean;
  connected(): boolean;
}
const contains = (epoch: GroupEpoch, card: GroupNotice["member"]) =>
  epoch.body.members.some(
    (m) => m.id === card.id && m.cardHash === memberCardHash(card),
  );

/** Schedules immutable notices and records explicit inbox items. It never
 * accepts an invitation or commits a membership change for the user. */
export class NoticeSynchronizer {
  private seen = new Set<string>();
  private processing = false;
  private outgoingCursor = 0;
  private groupCursor = 0;
  private turn = 0;
  private parents = new Map<string, { cursor: number; found?: number }>();
  readonly counts = { received: 0, stored: 0, rejected: 0 };
  constructor(private readonly host: NoticeHost) {}
  reset() {
    this.seen.clear();
    this.parents.clear();
    this.processing = false;
  }
  /** Revalidate locally authored cached/queued bytes against current intent. */
  mayPublish(notice: GroupNotice): boolean {
    const identity = this.host.identity();
    if (!identity) return false;
    return this.host.registry((g, notices) => {
      const view = g.list().find((v) => v.id === notice.anchor.id);
      if (!view || ["closed", "forked", "capacity"].includes(view.status))
        return false;
      if (notice.kind === "invitation")
        return (
          view.creator.id === identity.public.id &&
          view.status === "active" &&
          view.head?.id === notice.parent.id &&
          notices
            .list("out")
            .some((e) => e.notice.certificate.id === notice.certificate.id)
        );
      const info = g.syncState(view.id);
      if (notice.kind === "consent")
        return (
          !info.admitted &&
          !view.locallyLeft &&
          info.consent?.id === notice.certificate.id &&
          view.head?.id === notice.parent.id
        );
      return (
        view.locallyLeft &&
        info.leave?.id === notice.certificate.id &&
        !!view.head &&
        contains(view.head, notice.member)
      );
    });
  }
  receive(bundle: Bundle) {
    const identity = this.host.identity();
    if (
      !identity ||
      this.processing ||
      this.seen.has(bundle.manifest.id) ||
      !bundle.manifest.keys.some((k) => k.reader === identity.public.id)
    )
      return;
    this.processing = true;
    this.counts.received++;
    try {
      const notice = openGroupNotice(bundle, identity);
      const recipient =
        notice.kind === "invitation"
          ? notice.member
          : notice.anchor.body.creator;
      if (recipient.id !== identity.public.id) return;
      const known = this.host.registry((g) =>
        g.list().some((v) => v.id === notice.anchor.id),
      );
      // Even a blocked source cannot hide a verified safety header inside an
      // otherwise valid notice. The existing authority/outbox commit owns it.
      if (known)
        this.host.apply({
          action: "headers",
          groupId: notice.anchor.id,
          headers: [notice.parent],
        });
      if (this.host.blocked().includes(bundle.manifest.author.id)) return;
      if (notice.kind !== "invitation" && !known) return;
      const result = this.host.registry((g, notices) => {
        const view = g.list().find((v) => v.id === notice.anchor.id);
        if (
          view &&
          (["closed", "forked"].includes(view.status) ||
            (view.head &&
              view.head.body.number >= notice.parent.body.number &&
              view.head.id !== notice.parent.id))
        )
          return "stale";
        return notices.save("in", notice);
      });
      if (result === "stored") this.counts.stored++;
    } catch {
      this.counts.rejected++;
    } finally {
      if (this.seen.size >= 512)
        this.seen.delete(this.seen.values().next().value!);
      this.seen.add(bundle.manifest.id);
      this.processing = false;
    }
  }
  record(command: GroupCommand, result: any) {
    if (this.processing) return;
    try {
      if (
        ["commit", "close"].includes(command.action) &&
        result?.operation?.groupId
      ) {
        this.host.registry((g, notices) => {
          const view = g.state(result.operation.groupId);
          for (const entry of notices.list("out"))
            if (
              entry.notice.anchor.id === view.id &&
              (view.status !== "active" ||
                entry.notice.parent.id !== view.head?.id)
            )
              notices.retire("out", entry.notice.certificate.id);
        });
      }
      if (["invite", "accept", "leave", "notice-open"].includes(command.action))
        this.tick();
    } catch {
      this.counts.rejected++;
    }
  }
  private parent(
    g: GroupRegistry,
    view: GroupAuthorityView,
    id: string,
  ): GroupEpoch | undefined {
    if (!view.head) return;
    if (view.head.id === id) return view.head;
    const key = `${view.id}:${id}`;
    const progress = this.parents.get(key) ?? { cursor: view.head.body.number };
    if (progress.found !== undefined) {
      const header = g.proofs(view.id, progress.found, 1)[0];
      return header?.id === id ? header : undefined;
    }
    if (progress.cursor < 0) return;
    const start = Math.max(0, progress.cursor - 15);
    const found = g
      .proofs(view.id, start, Math.min(16, progress.cursor + 1))
      .find((e) => e.id === id);
    progress.cursor = start - 1;
    if (found) progress.found = found.body.number;
    if (this.parents.size >= 128 && !this.parents.has(key))
      this.parents.delete(this.parents.keys().next().value!);
    this.parents.set(key, progress);
    return found;
  }
  tick() {
    const identity = this.host.identity();
    if (
      !identity ||
      this.processing ||
      !this.host.ready() ||
      !this.host.connected()
    )
      return;
    const candidates = this.host
      .registry((g, notices) => {
        const groups = g.list(),
          out = notices.list("out"),
          result: GroupNotice[] = [];
        const item = out[this.outgoingCursor++ % Math.max(1, out.length)];
        if (item) {
          const view = groups.find((v) => v.id === item.notice.anchor.id);
          if (
            item.notice.kind === "invitation" &&
            view?.status === "active" &&
            view.head?.id === item.notice.parent.id
          )
            result.push(item.notice);
          else notices.retire("out", item.notice.certificate.id);
        }
        const view = groups[this.groupCursor++ % Math.max(1, groups.length)];
        if (
          !view ||
          view.creator.id === identity.public.id ||
          ["closed", "forked", "capacity"].includes(view.status)
        )
          return result;
        const info = g.syncState(view.id);
        if (
          info.consent &&
          info.invitation &&
          info.invitationCard &&
          info.invitationParent &&
          !info.admitted &&
          !view.locallyLeft &&
          view.head?.id === info.invitationParent.id
        )
          result.push({
            type: "group-notice",
            version: 1,
            kind: "consent",
            anchor: info.anchor,
            parent: info.invitationParent,
            member: info.invitationCard,
            certificate: info.consent,
            invitation: info.invitation,
          });
        if (
          info.leave &&
          info.leaveCard &&
          view.locallyLeft &&
          view.head?.body.state === "open" &&
          contains(view.head, info.leaveCard)
        ) {
          const parent = this.parent(g, view, info.leave.body.parentEpochId);
          if (parent)
            result.push({
              type: "group-notice",
              version: 1,
              kind: "leave",
              anchor: info.anchor,
              parent,
              member: info.leaveCard,
              certificate: info.leave,
            });
        }
        return result;
      })
      .filter(
        (n) =>
          !this.host
            .blocked()
            .includes(
              n.kind === "invitation" ? n.member.id : n.anchor.body.creator.id,
            ),
      );
    if (candidates.length)
      this.host.publish(candidates[this.turn++ % candidates.length]);
  }
}
