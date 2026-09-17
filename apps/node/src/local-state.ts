import { validateSiteEditingContext } from "../../../packages/sites/src/editing";
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import {
  atomic,
  canonical,
  type Identity,
} from "../../../packages/core/src/index.js";
import { validateCollections, type Collection } from "./social.js";
import { validateContent } from "./content-validation.js";
import type { Content } from "./node.js";
import { validateOutbox, type Outbox } from "./outbox.js";
export interface PrivateState {
  outbox?: Outbox;
  collections?: Collection[];
  siteDraft?: Omit<
    import("../../../packages/content/src/site").SiteDraft,
    "blocks"
  > & { blocks: unknown[] };
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
export function readPrivateSource(path: string): Buffer {
  const fd = openSync(path, "r"),
    maximum = LIMIT * 1.5;
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > maximum)
      throw new Error("Estado privado excede limite");
    const bytes = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length !== info.size)
      throw new Error("Estado privado mudou durante a leitura");
    return bytes.subarray(0, length);
  } finally {
    closeSync(fd);
  }
}
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
  return decodePrivateState(readPrivateSource(path), identity);
}
export function decodePrivateState(
  source: Buffer,
  identity: Identity,
): PrivateState {
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
  return parsePrivateState(
    Buffer.concat([
      decipher.update(Buffer.from(value.data, "base64")),
      decipher.final(),
    ]),
    identity,
  );
}
export function parsePrivateState(
  plain: Buffer,
  identity: Identity,
): PrivateState {
  if (plain.length > LIMIT) throw new Error("Estado privado excede limite");
  const state: PrivateState = JSON.parse(plain.toString("utf8"));
  const record = (value: unknown) =>
    !!value && typeof value === "object" && !Array.isArray(value);
  const address = (value: unknown) =>
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  if (!record(state) || !record(state.mutations))
    throw new Error("Estado privado inválido");
  for (const [id, mutation] of Object.entries(state.mutations)) {
    if (
      !address(id) ||
      !record(mutation) ||
      !address(mutation.author) ||
      (mutation.eventId !== "" && !address(mutation.eventId)) ||
      !Number.isSafeInteger(mutation.created) ||
      !Number.isSafeInteger(mutation.expires) ||
      (mutation.deleted !== undefined &&
        typeof mutation.deleted !== "boolean") ||
      (mutation.text !== undefined &&
        (typeof mutation.text !== "string" || mutation.text.length > 12000))
    )
      throw new Error("Mutação privada inválida");
  }
  if (state.collections !== undefined)
    state.collections = validateCollections(
      state.collections,
      identity.public.id,
    );
  if (state.siteDraft !== undefined) {
    if (
      !record(state.siteDraft) ||
      !Number.isSafeInteger(state.siteDraft.savedAt)
    )
      throw new Error("Rascunho privado inválido");
    if (state.siteDraft.editing !== undefined)
      validateSiteEditingContext(state.siteDraft.editing, identity.public.id);
    validateContent({
      type: "site",
      blocks: state.siteDraft.blocks,
      theme: state.siteDraft.theme,
      ...(state.siteDraft.site !== undefined
        ? { site: state.siteDraft.site }
        : {}),
      ...(state.siteDraft.attachments !== undefined
        ? { attachments: state.siteDraft.attachments }
        : {}),
    } as Content);
  }
  if (state.outbox !== undefined)
    state.outbox = validateOutbox(state.outbox, identity.public.id);
  return state;
}
