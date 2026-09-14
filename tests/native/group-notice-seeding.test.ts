import test from "node:test";
import { groupNoticeSeeding } from "../fixtures/group-notice-seeding.js";
for (const [issuer, reader] of [
  ["native", "node"],
  ["node", "native"],
] as const)
  test(
    `opaque relay serves ${issuer}/${reader} invitation and consent with each author offline`,
    { timeout: 90000 },
    async () => {
      await groupNoticeSeeding(issuer, reader);
    },
  );
