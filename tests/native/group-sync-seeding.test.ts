import test from "node:test";
import { groupSyncSeeding } from "../fixtures/group-sync-seeding.js";

for (const [creator, relay, reader] of [
  ["native", "node", "native"],
  ["node", "native", "node"],
] as const)
  test(
    `real ${creator}/${relay}/${reader} proof sync heals from offline creator through a seeder`,
    { timeout: 100000 },
    async () => {
      await groupSyncSeeding(creator, relay, reader);
    },
  );
