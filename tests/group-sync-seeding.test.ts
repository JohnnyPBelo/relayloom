import test from "node:test";
import { groupSyncSeeding } from "./fixtures/group-sync-seeding.js";

test(
  "real Node control proofs heal a partition from another member after creator stops",
  { timeout: 100000 },
  async () => {
    await groupSyncSeeding("node", "node", "node");
  },
);
