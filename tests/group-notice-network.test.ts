import test from "node:test";
import { groupNoticeNetwork } from "./fixtures/group-notice-network.js";
test(
  "real Node notices deliver invitation, explicit consent and leave without automatic group admission",
  { timeout: 65000 },
  async () => {
    await groupNoticeNetwork("node", "node");
  },
);
