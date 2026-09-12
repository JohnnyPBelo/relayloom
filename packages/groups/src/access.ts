import {
  canonical,
  validateIdentity,
  type PublicIdentity,
} from "../../core/src/index.js";
import {
  memberCardHash,
  type GroupEpoch,
  type GroupSnapshot,
} from "./certificates.js";
import { GroupRegistry } from "./registry.js";

export type GroupAudience = "epoch" | "target" | "historical";
export interface GroupContentBinding {
  conversation: string;
  groupAudience: GroupAudience;
  groupEpoch?: string;
  targetEpoch?: string;
}
export interface GroupContentCandidate {
  id: string;
  kind: string;
  author: PublicIdentity;
  readers: string[];
  public: boolean;
  content: Record<string, unknown>;
}
export interface AcceptedGroupContext {
  id: string;
  groupId: string;
  epochId: string;
  author: string;
  kind: string;
  readers: string[];
}
export type GroupDecision =
  | { status: "accepted"; context: AcceptedGroupContext; historical: boolean }
  | { status: "awaiting-proof" | "quarantine" | "invalid"; reason: string };
const address = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const fail = (reason: string): GroupDecision => ({ status: "invalid", reason });
const contentKinds = new Set(["message", "edit", "reaction", "comment"]);
const targetKinds = new Set(["message", "post", "alert"]);

/** Recognize tags by presence, never truthiness: malformed group metadata must
 * not fall through to the legacy DM/fixed-group authorization path. */
export function hasGroupBinding(value: Record<string, unknown>): boolean {
  return ["groupEpoch", "targetEpoch", "groupAudience"].some((key) =>
    Object.hasOwn(value, key),
  );
}
export function parseGroupBinding(
  value: Record<string, unknown>,
): GroupContentBinding {
  if (
    !address(value.conversation) ||
    typeof value.groupAudience !== "string" ||
    typeof value.type !== "string" ||
    !["epoch", "target", "historical"].includes(String(value.groupAudience))
  )
    throw new Error("Ligação de grupo inválida");
  const audience = value.groupAudience as GroupAudience;
  if (audience === "historical") {
    if (
      Object.hasOwn(value, "groupEpoch") ||
      !address(value.targetEpoch) ||
      !address(value.target) ||
      !["receipt", "delivery", "delete"].includes(String(value.type)) ||
      Object.keys(value).sort().join(",") !==
        "conversation,groupAudience,target,targetEpoch,type"
    )
      throw new Error("Evento histórico de grupo inválido");
  } else {
    if (!address(value.groupEpoch) || !contentKinds.has(String(value.type)))
      throw new Error("Época de publicação inválida");
    if (audience === "target") {
      const target = value.type === "message" ? value.replyTo : value.target;
      if (!address(target) || !address(value.targetEpoch))
        throw new Error("Alvo de grupo inválido");
    } else if (
      value.type !== "message" ||
      Object.hasOwn(value, "targetEpoch") ||
      Object.hasOwn(value, "target") ||
      Object.hasOwn(value, "replyTo")
    ) {
      throw new Error("Audiência de grupo inválida");
    }
  }
  return {
    conversation: value.conversation,
    groupAudience: audience,
    ...(value.groupEpoch !== undefined
      ? { groupEpoch: value.groupEpoch as string }
      : {}),
    ...(value.targetEpoch !== undefined
      ? { targetEpoch: value.targetEpoch as string }
      : {}),
  };
}

interface GroupChain {
  status: ReturnType<GroupRegistry["state"]>;
  epochs: GroupEpoch[];
  snapshots: Map<string, GroupSnapshot | null>;
}

/** Use only inside one caller-owned transaction. No cache crosses its boundary.
 * The caller verifies/decrypts the ordinary bundle, persists accepted contexts
 * and only then displays content or issues confirmations. */
export class GroupAccess {
  private chains = new Map<string, GroupChain>();
  private ids?: Set<string>;
  private generation = -1;
  constructor(
    private readonly registry: GroupRegistry,
    private readonly local: PublicIdentity,
  ) {
    registry.assertScope();
  }
  private chain(id: string): GroupChain | null {
    const generation = this.registry.assertScope();
    if (generation !== this.generation) {
      this.generation = generation;
      this.chains.clear();
      this.ids = undefined;
    }
    this.ids ??= new Set(this.registry.list().map((group) => group.id));
    if (!this.ids.has(id)) return null;
    let chain = this.chains.get(id);
    if (!chain) {
      const status = this.registry.state(id),
        epochs: GroupEpoch[] = [];
      for (let from = 0; status.head && from <= status.head.body.number;) {
        const page = this.registry.proofs(id, from);
        if (!page.length || page[0].body.number !== from)
          throw new Error("Cadeia de grupo incompleta");
        epochs.push(...page);
        from = page.at(-1)!.body.number + 1;
      }
      chain = { status, epochs, snapshots: new Map() };
      this.chains.set(id, chain);
    }
    return chain;
  }
  private snapshot(chain: GroupChain, id: string): GroupSnapshot | null {
    if (!chain.snapshots.has(id))
      chain.snapshots.set(id, this.registry.privateState(chain.status.id, id));
    return chain.snapshots.get(id)!;
  }
  private compatible(chain: GroupChain, original: GroupEpoch): boolean {
    let previous = original;
    for (const next of chain.epochs.filter(
      (e) => e.body.number > original.body.number,
    )) {
      if (
        next.body.previous !== previous.id ||
        next.body.number !== previous.body.number + 1 ||
        next.body.state !== "open" ||
        previous.body.members.some(
          (old) =>
            !next.body.members.some(
              (member) =>
                member.id === old.id && member.cardHash === old.cardHash,
            ),
        )
      )
        return false;
      previous = next;
    }
    return previous.id === chain.status.head?.id;
  }
  retry(
    groupId: string,
    epochId: string,
  ): { allowed: boolean; terminal: boolean; reason: string } {
    const chain = this.chain(groupId);
    if (!chain)
      return { allowed: false, terminal: false, reason: "group-not-enrolled" };
    const state = chain.status;
    const terminal = (
      {
        left: "group-left",
        closed: "group-closed",
        forked: "group-forked",
        removed: "group-epoch-changed",
        "card-changed": "group-card-changed",
      } as Record<string, string>
    )[state.status];
    if (terminal) return { allowed: false, terminal: true, reason: terminal };
    const original = chain.epochs.find((e) => e.id === epochId);
    if (
      original &&
      !original.body.members.some((member) => member.id === this.local.id)
    )
      return {
        allowed: false,
        terminal: true,
        reason: "group-invalid-original-author",
      };
    if (original && !this.compatible(chain, original))
      return { allowed: false, terminal: true, reason: "group-epoch-changed" };
    if (state.status !== "active" || !original)
      return {
        allowed: false,
        terminal: false,
        reason: "group-authority-unavailable",
      };
    return { allowed: true, terminal: false, reason: "" };
  }
  decide(
    candidate: GroupContentCandidate,
    accepted?: AcceptedGroupContext,
    target?: AcceptedGroupContext,
  ): GroupDecision {
    this.registry.assertScope();
    let binding: GroupContentBinding;
    try {
      binding = parseGroupBinding(candidate.content);
    } catch {
      return fail("invalid-group-binding");
    }
    if (
      !address(candidate.id) ||
      candidate.kind !== candidate.content.type ||
      candidate.public ||
      !validateIdentity(candidate.author) ||
      !candidate.readers.includes(this.local.id) ||
      !candidate.readers.includes(candidate.author.id) ||
      candidate.readers.length > 64 ||
      candidate.readers.some((id) => !address(id)) ||
      new Set(candidate.readers).size !== candidate.readers.length
    )
      return fail("invalid-private-group-envelope");
    const chain = this.chain(binding.conversation);
    if (!chain)
      return { status: "awaiting-proof", reason: "group-not-enrolled" };
    const epochId = binding.groupEpoch ?? binding.targetEpoch!;
    const epoch = chain.epochs.find((e) => e.id === epochId);
    if (!epoch) return { status: "awaiting-proof", reason: "unknown-epoch" };
    if (epoch.body.state !== "open") return fail("closed-publishing-epoch");
    const snapshot = this.snapshot(chain, epochId);
    if (!snapshot)
      return { status: "awaiting-proof", reason: "missing-private-snapshot" };
    let cards = snapshot.members;
    const contextual = binding.groupAudience !== "epoch";
    if (contextual) {
      const targetId =
        candidate.content.type === "message"
          ? candidate.content.replyTo
          : candidate.content.target;
      if (
        !target ||
        target.id !== targetId ||
        target.groupId !== binding.conversation ||
        target.epochId !== binding.targetEpoch ||
        !targetKinds.has(target.kind)
      )
        return fail("unaccepted-group-target");
      const targetEpoch = chain.epochs.find((e) => e.id === target.epochId);
      const originalSnapshot =
        targetEpoch && this.snapshot(chain, target.epochId);
      if (
        !originalSnapshot ||
        target.readers.some(
          (id) => !originalSnapshot.members.some((card) => card.id === id),
        )
      )
        return fail("invalid-original-readers");
      if (binding.groupAudience === "historical") {
        cards = originalSnapshot.members.filter((card) =>
          target.readers.includes(card.id),
        );
        if (
          candidate.kind === "delete"
            ? candidate.author.id !== target.author
            : candidate.author.id === target.author || target.kind !== "message"
        )
          return fail("invalid-historical-author");
      } else {
        cards = cards.filter((card) => target.readers.includes(card.id));
        if (candidate.kind === "edit" && candidate.author.id !== target.author)
          return fail("edit-does-not-own-target");
      }
    }
    const approvedAuthor = cards.find(
      (card) => card.id === candidate.author.id,
    );
    if (
      !approvedAuthor ||
      memberCardHash(approvedAuthor) !== memberCardHash(candidate.author) ||
      !same(cards.map((card) => card.id).sort(), [...candidate.readers].sort())
    )
      return fail("wrong-epoch-audience");
    if (candidate.kind === "message" && !same(candidate.content.members, cards))
      return fail("wrong-pinned-member-cards");
    const context: AcceptedGroupContext = {
      id: candidate.id,
      groupId: binding.conversation,
      epochId,
      author: candidate.author.id,
      kind: candidate.kind,
      readers: [...candidate.readers].sort(),
    };
    if (accepted) {
      if (!same(accepted, context)) return fail("accepted-context-mismatch");
      return { status: "accepted", context, historical: true };
    }
    if (binding.groupAudience === "historical")
      return { status: "accepted", context, historical: true };
    if (chain.status.status !== "active")
      return { status: "quarantine", reason: "group-" + chain.status.status };
    if (!this.compatible(chain, epoch))
      return { status: "quarantine", reason: "restrictive-successor" };
    return {
      status: "accepted",
      context,
      historical: epoch.id !== chain.status.head!.id,
    };
  }
}
