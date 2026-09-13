import test from "node:test";
import { groupEventSeeding } from "../fixtures/group-event-seeding.js";

for (const path of [
  ["native", "node", "native"],
  ["node", "native", "node"],
] as const)
  test(
    `real ${path.join("/")} group event seed takeover and new-reader exclusion`,
    { timeout: 65000 },
    async (t) => {
      await groupEventSeeding(path[0], path[1], path[2], t.signal);
    },
  );
