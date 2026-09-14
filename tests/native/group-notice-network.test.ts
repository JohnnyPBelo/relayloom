import test from "node:test";
import { groupNoticeNetwork } from "../fixtures/group-notice-network.js";
for (const [first, second] of [
  ["native", "node"],
  ["node", "native"],
  ["native", "native"],
] as const)
  test(
    `real ${first}/${second} invitations, consent, group message and leave use P2P notices`,
    { timeout: 65000 },
    async () => {
      await groupNoticeNetwork(first, second);
    },
  );
