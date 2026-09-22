import { canonical, exactShape } from "../../core/src/protocol";
import type { Packet, Priority } from "../../transport/src/protocol";
import { hash, utf8 } from "./crypto";
import type { RtcCodec } from "./rtc";
export type { Packet, Priority } from "../../transport/src/protocol";
export const ROUTER_LIMITS = Object.freeze({
  maxPacket: 6 * 1024 * 1024,
  pendingBytes: 16 * 1024 * 1024,
  retained: 64,
  seen: 4096,
  links: 24,
  ttl: 3600_000,
  maxHops: 12,
});
const ident = (s: unknown) =>
  typeof s === "string" && s.length > 0 && s.length <= 128;
export async function verifiedPacket(value: Packet): Promise<Packet> {
  if (
    !exactShape(value, [
      "id",
      "source",
      "created",
      "expires",
      "maxHops",
      "hops",
      "priority",
      "payload",
    ])
  )
    throw new Error("Pacote inválido");
  const encoded = canonical(value);
  if (utf8(encoded).length > ROUTER_LIMITS.maxPacket)
    throw new Error("Pacote demasiado grande");
  const packet = JSON.parse(encoded) as Packet,
    now = Date.now(),
    { id, hops, ...body } = packet;
  if (
    !ident(packet.source) ||
    !["sos", "normal", "bulk"].includes(packet.priority) ||
    !Number.isSafeInteger(packet.created) ||
    !Number.isSafeInteger(packet.expires) ||
    packet.created > now + 300_000 ||
    packet.expires <= now ||
    packet.expires <= packet.created ||
    packet.expires - packet.created > ROUTER_LIMITS.ttl ||
    !Number.isInteger(packet.maxHops) ||
    packet.maxHops < 1 ||
    packet.maxHops > ROUTER_LIMITS.maxHops ||
    !Array.isArray(hops) ||
    hops.length < 1 ||
    hops.length > packet.maxHops ||
    hops[0] !== packet.source ||
    hops.some((h) => !ident(h)) ||
    new Set(hops).size !== hops.length ||
    id !== (await hash(canonical(body)))
  )
    throw new Error("Pacote inválido ou expirado");
  return packet;
}
export async function createPacket(
  source: string,
  payload: unknown,
  priority: Priority = "normal",
  ttl = 120_000,
  deadline?: number,
): Promise<Packet> {
  if (
    !ident(source) ||
    !["sos", "normal", "bulk"].includes(priority) ||
    !Number.isSafeInteger(ttl) ||
    ttl < 1 ||
    ttl > ROUTER_LIMITS.ttl
  )
    throw new Error("Prazo ou prioridade inválidos");
  const owned = JSON.parse(canonical(payload)),
    now = Date.now();
  if (
    deadline !== undefined &&
    (!Number.isSafeInteger(deadline) || deadline <= now)
  )
    throw new Error("Prazo de autorização expirado");
  const body = {
    source,
    created: now,
    expires: Math.min(now + ttl, deadline ?? Number.MAX_SAFE_INTEGER),
    maxHops: ROUTER_LIMITS.maxHops,
    priority,
    payload: owned,
  };
  return verifiedPacket({
    ...body,
    id: await hash(canonical(body)),
    hops: [source],
  });
}
export const packetCodec: RtcCodec<Packet> = {
  protocol: "relayloom-packets-v1",
  verified: verifiedPacket,
  id: (p) => p.id,
  expires: (p) => p.expires,
};
