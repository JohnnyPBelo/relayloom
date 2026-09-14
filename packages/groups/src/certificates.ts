import {
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from "node:crypto";
import { hash, validateIdentity } from "../../core/src/index.js";
import { createGroupCertificateProtocol } from "./certificate-protocol.js";
export * from "./certificate-protocol.js";

export const {
  memberCardHash,
  verifyGroupAnchor,
  createGroupAnchor,
  verifyGroupEpoch,
  verifyGroupInvitation,
  createGroupInvitation,
  verifyGroupConsent,
  acceptGroupInvitation,
  verifyGroupLeave,
  createGroupLeave,
  verifyGroupSnapshot,
  verifyGroupEpochLink,
  classifyGroupEpochPath,
  verifyGroupTransition,
  verifyGroupSnapshotTransition,
  createAnchoredGroup,
  createGroupSuccessor,
  closeAnchoredGroup,
} = createGroupCertificateProtocol({
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
});
