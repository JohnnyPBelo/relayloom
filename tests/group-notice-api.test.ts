import test from "node:test";
import { groupNoticeAPI } from "./fixtures/group-notice-api.js";
test(
  "Node invitation API retains exact delivery material, bounds pending notices and preserves closure",
  { timeout: 90000 },
  async () => {
    await groupNoticeAPI("node", "node");
  },
);
