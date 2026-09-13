import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { groupConfirmationJourney } from "../fixtures/group-confirmations.js";

for (const [creator, reader] of [
  ["native", "node"],
  ["node", "native"],
  ["native", "native"],
] as const)
  test(
    `real ${creator}/${reader} automatic group confirmations preserve historical original readers`,
    { timeout: 45000 },
    async () => {
      const started = Date.now(),
        result = await groupConfirmationJourney(creator, reader);
      mkdirSync(".cache/group-confirmations", { recursive: true });
      writeFileSync(
        `.cache/group-confirmations/${creator}-${reader}.json`,
        JSON.stringify(
          {
            status: "pass",
            elapsedMs: Date.now() - started,
            ...result,
            limits: [
              "control proofs transferred through fixture APIs",
              "no mobile/radio evidence",
            ],
          },
          null,
          2,
        ) + "\n",
      );
    },
  );
