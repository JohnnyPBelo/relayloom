import test from "node:test";
import { groupSyncSerial } from "../fixtures/group-sync-serial.js";
test(
  "Go control publisher reaches isolated Node serial reader through opaque Node relay",
  { timeout: 100000, skip: process.platform === "win32" },
  async () => {
    await groupSyncSerial("native");
  },
);
