// Encoding/admission policy, not an Ed25519 implementation. Signatures remain
// verified by the platform crypto library. The five y encodings cover both
// signs of all eight points in @noble/curves 2.4.0 ED25519_TORSION_SUBGROUP.
// See docs/SIGNING-KEY-PROFILE.md for provenance and compatibility boundaries.
const prefix = Uint8Array.of(
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
const smallOrderY = new Set([
  "0100000000000000000000000000000000000000000000000000000000000000",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
  "0000000000000000000000000000000000000000000000000000000000000000",
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
]);
export function admittedSigningKey(der: Uint8Array): boolean {
  if (der.length !== 44 || prefix.some((byte, index) => der[index] !== byte))
    return false;
  const y = new Uint8Array(der.subarray(12));
  y[31] &= 0x7f;
  // A compressed Edwards y must be below 2^255 - 19. These are the only
  // out-of-range encodings after removing the x sign bit.
  if (
    y[31] === 0x7f &&
    y[0] >= 0xed &&
    y.subarray(1, 31).every((byte) => byte === 0xff)
  )
    return false;
  const encoded = Array.from(y, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return !smallOrderY.has(encoded);
}
