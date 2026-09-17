import {
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from "node:crypto";
import { hash, validateIdentity } from "./index";
import type { CertificateCrypto } from "./certificate-types";

export const nodeCertificateCrypto: CertificateCrypto = {
  hash,
  validateIdentity,
  random: randomBytes,
  verify(card, text, signature) {
    const key = createPublicKey({
      key: Buffer.from(card.signKey, "base64"),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(text), key, signature);
  },
  sign(identity, text) {
    const key = createPrivateKey({
      key: Buffer.from(identity.signSecret, "base64"),
      format: "der",
      type: "pkcs8",
    });
    if (
      key.asymmetricKeyType !== "ed25519" ||
      createPublicKey(key)
        .export({ format: "der", type: "spki" })
        .toString("base64") !== identity.public.signKey
    )
      throw new Error("A chave não pertence à autoridade");
    return sign(null, Buffer.from(text), key).toString("base64");
  },
};
