import test from "node:test";
import { groupConfirmationJourney } from "./fixtures/group-confirmations.js";

test(
  "real Node group automatic delivery and historical read after closure retain original audience",
  { timeout: 45000 },
  async () => {
    await groupConfirmationJourney("node", "node");
  },
);
