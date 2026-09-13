import test from "node:test";
import { groupSyncSerial } from "./fixtures/group-sync-serial.js";
test(
  "Node control proofs traverse TCP and serial PTYs, with partition, relay-off and offline opaque seeder controls",
  { timeout: 100000, skip: process.platform === "win32" },
  async () => {
    await groupSyncSerial("node");
  },
);
