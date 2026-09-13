import test from "node:test";
import { groupRequestReplay } from "../fixtures/group-request-replay.js";
test(
  "Go control requests recover lost responses and revalidate authority on identical retries",
  { timeout: 40000 },
  async () => {
    await groupRequestReplay("native");
  },
);
