import test from "node:test";
import { groupEventSeeding } from "./fixtures/group-event-seeding.js";

test(
  "real Node group newcomer cannot read earlier audiences; peer serves author's edit while author is offline",
  { timeout: 65000 },
  async (t) => {
    await groupEventSeeding("node", "node", "node", t.signal);
  },
);
