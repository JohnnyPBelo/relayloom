import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  atomic,
  canonical,
  type Identity,
} from "../../../packages/core/src/index.js";
export interface PrivateState {
  siteDraft?: { blocks: unknown[]; theme: string; savedAt: number };
  mutations: Record<
    string,
    {
      author: string;
      expires: number;
      created: number;
      eventId: string;
      deleted?: boolean;
      text?: string;
    }
  >;
}
const LIMIT = 16 * 1024 * 1024;
function key(identity: Identity, salt: Buffer) {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(identity.boxSecret, "base64"),
      salt,
      Buffer.from("relayloom-local-state-v1"),
      32,
    ),
  );
}
export function writePrivateState(
  path: string,
  state: PrivateState,
  identity: Identity,
) {
  const plain = Buffer.from(canonical(state));
  if (plain.length > LIMIT)
    throw new Error("Limite de estado privado atingido");
  const salt = randomBytes(32),
    nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(identity, salt), nonce);
  cipher.setAAD(Buffer.from(identity.public.id));
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  atomic(
    path,
    JSON.stringify({
      version: 1,
      salt: salt.toString("base64"),
      nonce: nonce.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    }),
  );
}
export function readPrivateState(
  path: string,
  identity: Identity,
): PrivateState {
  if (!existsSync(path)) return { mutations: {} };
  const source = readFileSync(path);
  if (source.length > LIMIT * 1.5)
    throw new Error("Estado privado excede limite");
  const value = JSON.parse(source.toString());
  if (value.version !== 1) throw new Error("Estado privado inválido");
  const salt = Buffer.from(value.salt, "base64"),
    nonce = Buffer.from(value.nonce, "base64"),
    tag = Buffer.from(value.tag, "base64");
  if (salt.length !== 32 || nonce.length !== 12 || tag.length !== 16)
    throw new Error("Estado privado inválido");
  const decipher = createDecipheriv("aes-256-gcm", key(identity, salt), nonce);
  decipher.setAAD(Buffer.from(identity.public.id));
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(value.data, "base64")),
      decipher.final(),
    ]).toString(),
  );
}
