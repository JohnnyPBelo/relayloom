import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

// The same public reader-address derivation verified by Node, Go and browser
// prepare/send. An empty contact row has its final DM address from the start.
export function directConversationId(first: string, second: string): string {
  return (
    "dm:" +
    bytesToHex(
      sha256(utf8ToBytes([...new Set([first, second])].sort().join(":"))),
    )
  );
}
