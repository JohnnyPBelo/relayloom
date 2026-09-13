import test from "node:test";
import { groupEventsJourney } from "./fixtures/group-events.js";

test(
  "real Node group reactions/comments/author edits and historical deletion preserve signing ownership",
  { timeout: 45000 },
  async () => {
    await groupEventsJourney("node", "node");
  },
);
