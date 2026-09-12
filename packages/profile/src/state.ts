import { canonical, hash } from "../../core/src/index.js";
import {
  RegistryIntegrityError,
  type RegistryTransaction,
} from "../../groups/src/storage.js";

const MANIFEST = "application:state";
const PREFIX = MANIFEST + ":";
export const PROFILE_STATE_LIMITS = Object.freeze({
  bytes: 16 * 1024 ** 2,
  chunkBytes: 512 * 1024,
  chunks: 32,
});
interface StateManifest {
  domain: "relayloom/profile-state/1";
  bytes: number;
  chunks: number;
  digest: string;
}
export interface ProfileStateBytes {
  bytes: Buffer;
  digest: string;
}
const partKey = (i: number) => PREFIX + String(i).padStart(4, "0");
function insist(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RegistryIntegrityError(message);
}
function manifest(data: Buffer): StateManifest {
  try {
    const value = JSON.parse(data.toString("utf8"));
    insist(
      data.length <= 1024 &&
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).sort().join(",") === "bytes,chunks,digest,domain" &&
        Buffer.from(canonical(value)).equals(data),
      "Manifesto privado inválido",
    );
    insist(
      value.domain === "relayloom/profile-state/1" &&
        Number.isSafeInteger(value.bytes) &&
        value.bytes > 0 &&
        value.bytes <= PROFILE_STATE_LIMITS.bytes &&
        Number.isSafeInteger(value.chunks) &&
        value.chunks ===
          Math.ceil(value.bytes / PROFILE_STATE_LIMITS.chunkBytes) &&
        typeof value.digest === "string" &&
        /^[a-f0-9]{64}$/.test(value.digest),
      "Limites do manifesto privado inválidos",
    );
    return value;
  } catch (error) {
    if (error instanceof RegistryIntegrityError) throw error;
    throw new RegistryIntegrityError("Manifesto privado ilegível");
  }
}
/** Authenticates the complete bounded blob. Application semantic validation is
 * still required; this function never treats opaque bytes as group authority. */
export function readProfileState(
  tx: RegistryTransaction,
): ProfileStateBytes | null {
  const data = tx.get(MANIFEST),
    keys = tx.keys(PREFIX);
  if (!data) {
    insist(keys.length === 0, "Blocos privados sem manifesto");
    return null;
  }
  const m = manifest(data);
  insist(
    keys.length === m.chunks && keys.every((key, i) => key === partKey(i)),
    "Conjunto de blocos privados incompleto",
  );
  const pieces = keys.map((key, i) => {
    const piece = tx.get(key);
    insist(
      piece &&
        piece.length ===
          Math.min(
            PROFILE_STATE_LIMITS.chunkBytes,
            m.bytes - i * PROFILE_STATE_LIMITS.chunkBytes,
          ),
      "Bloco privado truncado",
    );
    return piece;
  });
  const bytes = Buffer.concat(pieces, m.bytes);
  insist(hash(bytes) === m.digest, "Hash do estado privado não coincide");
  return { bytes, digest: m.digest };
}
/** The caller's transaction commits chunks, manifest and other metadata together.
 * A returned digest is not permission to display/send before that commit returns. */
export function writeProfileState(
  tx: RegistryTransaction,
  bytes: Buffer,
  expectedDigest: string | null,
): string {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 1 ||
    bytes.length > PROFILE_STATE_LIMITS.bytes
  )
    throw new Error("Estado privado fora dos limites");
  const value = JSON.parse(bytes.toString("utf8"));
  if (!Buffer.from(canonical(value)).equals(bytes))
    throw new Error("Estado privado não canónico");
  const previous = readProfileState(tx);
  if ((previous?.digest ?? null) !== expectedDigest)
    throw new Error("O estado privado mudou; volte a lê-lo antes de guardar");
  const digest = hash(bytes);
  if (previous?.digest === digest) return digest;
  const chunks = Math.ceil(bytes.length / PROFILE_STATE_LIMITS.chunkBytes);
  for (let i = 0; i < chunks; i++)
    tx.put(
      partKey(i),
      bytes.subarray(
        i * PROFILE_STATE_LIMITS.chunkBytes,
        (i + 1) * PROFILE_STATE_LIMITS.chunkBytes,
      ),
    );
  for (const key of tx.keys(PREFIX).slice(chunks)) tx.delete(key);
  tx.put(
    MANIFEST,
    Buffer.from(
      canonical({
        domain: "relayloom/profile-state/1",
        bytes: bytes.length,
        chunks,
        digest,
      }),
    ),
  );
  return digest;
}
