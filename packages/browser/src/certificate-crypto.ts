import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { equalBytes } from "@noble/curves/utils.js";
import {
  canonical,
  exactShape,
  type PublicIdentity,
} from "../../core/src/protocol";
import type { CertificateCrypto } from "../../core/src/certificate-types";
import { b64, un64, utf8, random } from "./crypto";
import { admittedSigningKey } from "../../core/src/signing-key";

// The v1 identity format emits these canonical RFC 8410 DER wrappers. This
// decoder accepts exactly that format; it is not a permissive ASN.1 parser.
const edPublicPrefix = Uint8Array.of(
  0x30,
  0x2a,
  0x30,
  0x05,
  0x06,
  0x03,
  0x2b,
  0x65,
  0x70,
  0x03,
  0x21,
  0x00,
);
const boxPublicPrefix = Uint8Array.of(
  0x30,
  0x2a,
  0x30,
  0x05,
  0x06,
  0x03,
  0x2b,
  0x65,
  0x6e,
  0x03,
  0x21,
  0x00,
);
const edSecretPrefix = Uint8Array.of(
  0x30,
  0x2e,
  0x02,
  0x01,
  0x00,
  0x30,
  0x05,
  0x06,
  0x03,
  0x2b,
  0x65,
  0x70,
  0x04,
  0x22,
  0x04,
  0x20,
);
function rawKey(encoded: string, prefix: Uint8Array) {
  const bytes = un64(encoded, 256);
  if (
    bytes.length !== prefix.length + 32 ||
    !equalBytes(bytes.subarray(0, prefix.length), prefix)
  )
    throw new Error("Chave de grupo fora do formato canónico");
  return bytes.slice(prefix.length);
}
function validCard(card: PublicIdentity): boolean {
  try {
    if (
      !exactShape(card, ["id", "name", "signKey", "boxKey", "proof"]) ||
      typeof card.name !== "string" ||
      card.name.length < 1 ||
      card.name.length > 64 ||
      !admittedSigningKey(un64(card.signKey, 256)) ||
      card.id !== bytesToHex(sha256(un64(card.signKey, 256)))
    )
      return false;
    const signing = rawKey(card.signKey, edPublicPrefix);
    rawKey(card.boxKey, boxPublicPrefix);
    const proof = un64(card.proof, 128);
    return (
      proof.length === 64 &&
      ed25519.verify(
        proof,
        utf8(
          canonical({
            id: card.id,
            name: card.name,
            signKey: card.signKey,
            boxKey: card.boxKey,
          }),
        ),
        signing,
        { zip215: false },
      )
    );
  } catch {
    return false;
  }
}

/** Crypto adapter only; authority adoption, storage and UI are separate gates. */
export const browserCertificateCrypto: CertificateCrypto = {
  hash: (text) => bytesToHex(sha256(utf8(text))),
  validateIdentity: validCard,
  random,
  verify(card, text, signature) {
    return ed25519.verify(
      signature,
      utf8(text),
      rawKey(card.signKey, edPublicPrefix),
      { zip215: false },
    );
  },
  sign(identity, text) {
    const seed = rawKey(identity.signSecret, edSecretPrefix);
    try {
      if (
        !equalBytes(
          ed25519.getPublicKey(seed),
          rawKey(identity.public.signKey, edPublicPrefix),
        )
      )
        throw new Error("A chave não pertence à autoridade");
      return b64(ed25519.sign(utf8(text), seed));
    } finally {
      seed.fill(0);
    }
  },
};
