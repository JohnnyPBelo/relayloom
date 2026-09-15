import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { directConversationId } from "../apps/web/src/conversation-id";

test("contact rows use the established Node/Go DM reader-address wire format before the first send", () => {
  const first = "f".repeat(64),
    second = "1".repeat(64);
  const expected =
    "dm:" +
    createHash("sha256")
      .update(second + ":" + first)
      .digest("hex");
  assert.equal(directConversationId(first, second), expected);
  assert.equal(directConversationId(second, first), expected);
  assert.notEqual(directConversationId(first, "2".repeat(64)), expected);
});

test("a repeated own reader remains one reader in the DM address", () => {
  const own = "a".repeat(64);
  assert.equal(
    directConversationId(own, own),
    "dm:" + createHash("sha256").update(own).digest("hex"),
  );
});
