import test from "node:test";
import { groupNoticeReplay } from "../fixtures/group-notice-replay.js";
for (const blocked of [false, true])
  test(
    `Go replays notice safety headers before sending, blocked source=${blocked}`,
    { timeout: 60000 },
    async () => {
      await groupNoticeReplay("native", blocked);
    },
  );
