package core

import (
	"bytes"
	"encoding/hex"
)

// This is an encoding/admission filter; crypto/ed25519 still verifies proofs.
// Same profile and reference points as packages/core/src/signing-key.ts.
var signingKeyPrefix = []byte{0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00}
var smallOrderSigningY = map[string]bool{
	"0100000000000000000000000000000000000000000000000000000000000000": true,
	"c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a": true,
	"0000000000000000000000000000000000000000000000000000000000000000": true,
	"26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05": true,
	"ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f": true,
}

func admittedSigningKey(der []byte) bool {
	if len(der) != 44 || !bytes.Equal(der[:12], signingKeyPrefix) {
		return false
	}
	var y [32]byte
	copy(y[:], der[12:])
	y[31] &= 0x7f
	outOfRange := y[31] == 0x7f && y[0] >= 0xed
	for _, value := range y[1:31] {
		outOfRange = outOfRange && value == 0xff
	}
	if outOfRange {
		return false
	}
	return !smallOrderSigningY[hex.EncodeToString(y[:])]
}
