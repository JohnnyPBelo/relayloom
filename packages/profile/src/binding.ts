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

export interface ProfileBindingBody {
  domain: "relayloom/profile-binding/1";
  owner: string;
  storeId: string;
  nonce: string;
  /** Digest of the legacy ciphertext, never an exposed plaintext-state digest. */
  sourceDigest: string;
  phase: "prepared" | "committed";
}
export interface ProfileBinding {
  body: ProfileBindingBody;
  id: string;
  signature: string;
}
function insist(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
export function decodeProfileBinding(
  bytes: Buffer,
  identity: PublicIdentity,
): ProfileBinding {
  insist(
    bytes.length <= 2048 && validateIdentity(identity),
    "Ligação do perfil fora dos limites",
  );
  const value = JSON.parse(bytes.toString("utf8"));
  insist(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join(",") === "body,id,signature" &&
      Buffer.from(canonical(value)).equals(bytes),
    "Formato da ligação do perfil inválido",
  );
  const b = value.body;
  insist(
    b &&
      typeof b === "object" &&
      !Array.isArray(b) &&
      Object.keys(b).sort().join(",") ===
        "domain,nonce,owner,phase,sourceDigest,storeId" &&
      b.domain === "relayloom/profile-binding/1" &&
      b.owner === identity.id &&
      ["prepared", "committed"].includes(b.phase),
    "Contexto da ligação do perfil inválido",
  );
  for (const field of ["owner", "storeId", "nonce", "sourceDigest"])
    insist(
      typeof b[field] === "string" && /^[a-f0-9]{64}$/.test(b[field]),
      "Identificador da ligação do perfil inválido",
    );
  const body = Buffer.from(canonical(b));
  insist(
    value.id === hash(body) &&
      typeof value.signature === "string" &&
      value.signature.length === 88,
    "Assinatura da ligação do perfil inválida",
  );
  const signature = Buffer.from(value.signature, "base64");
  insist(
    signature.length === 64 &&
      signature.toString("base64") === value.signature &&
      verify(
        null,
        body,
        createPublicKey({
          key: Buffer.from(identity.signKey, "base64"),
          format: "der",
          type: "spki",
        }),
        signature,
      ),
    "Assinatura da ligação do perfil inválida",
  );
  return value;
}
function signed(body: ProfileBindingBody, identity: Identity): ProfileBinding {
  const bytes = Buffer.from(canonical(body));
  const signature = sign(
    null,
    bytes,
    createPrivateKey({
      key: Buffer.from(identity.signSecret, "base64"),
      format: "der",
      type: "pkcs8",
    }),
  ).toString("base64");
  return decodeProfileBinding(
    Buffer.from(canonical({ body, id: hash(bytes), signature })),
    identity.public,
  );
}
export function prepareProfileBinding(
  identity: Identity,
  storeId: string,
  sourceDigest: string,
): ProfileBinding {
  return signed(
    {
      domain: "relayloom/profile-binding/1",
      owner: identity.public.id,
      storeId,
      sourceDigest,
      nonce: randomBytes(32).toString("hex"),
      phase: "prepared",
    },
    identity,
  );
}
export function commitProfileBinding(
  identity: Identity,
  prepared: ProfileBinding,
): ProfileBinding {
  const checked = decodeProfileBinding(
    Buffer.from(canonical(prepared)),
    identity.public,
  );
  insist(
    checked.body.phase === "prepared",
    "A ligação do perfil já foi concluída",
  );
  return signed({ ...checked.body, phase: "committed" }, identity);
}
