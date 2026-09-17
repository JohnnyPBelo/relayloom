import type { Identity, PublicIdentity } from "./protocol";

/** Synchronous maintained crypto adapters for atomic certificate operations.
 * Signing must check that the secret belongs to the complete verified card. */
export interface CertificateCrypto {
  hash(text: string): string;
  validateIdentity(card: PublicIdentity): boolean;
  random(size: number): Uint8Array;
  verify(card: PublicIdentity, text: string, signature: Uint8Array): boolean;
  sign(identity: Identity, text: string): string;
}
