import test from "node:test";
import { groupNoticeAPI } from "../fixtures/group-notice-api.js";
for (const [first, after] of [
  ["node", "native"],
  ["native", "node"],
] as const)
  test(
    `real ${first}→${after} invitation API preserves exact card, capacity rollback and closure`,
    { timeout: 90000 },
    async () => {
      await groupNoticeAPI(first, after);
    },
  );
