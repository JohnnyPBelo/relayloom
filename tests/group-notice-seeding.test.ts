import test from "node:test";
import { groupNoticeSeeding } from "./fixtures/group-notice-seeding.js";
test(
  "opaque Node seeder delivers invitation and consent after each original author stops",
  { timeout: 90000 },
  async () => {
    await groupNoticeSeeding("node", "node");
  },
);
