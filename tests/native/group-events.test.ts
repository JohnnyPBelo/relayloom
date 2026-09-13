import test from "node:test";
import { groupEventsJourney } from "../fixtures/group-events.js";

for (const [creator, reader] of [
  ["native", "node"],
  ["node", "native"],
  ["native", "native"],
] as const) {
  test(
    `real ${creator}/${reader} group events preserve signing ownership and historical deletion`,
    { timeout: 60000 },
    async () => {
      await groupEventsJourney(creator, reader);
    },
  );
}
