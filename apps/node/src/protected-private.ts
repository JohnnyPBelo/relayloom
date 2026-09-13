import { GroupLedger } from "../../../packages/groups/src/ledger.js";
import { reconcileGroupOutbox } from "./group-outbox.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  canonical,
  hash,
  type Identity,
} from "../../../packages/core/src/index.js";
import { ProfileDatabase } from "../../../packages/profile/src/database.js";
import {
  decodePrivateState,
  parsePrivateState,
  readPrivateSource,
} from "./local-state.js";

export function openPrivateProfile(directory: string, identity: Identity) {
  const path = join(directory, "private-state.json");
  const database = ProfileDatabase.open(directory, identity, () => {
    if (!existsSync(path))
      return {
        bytes: Buffer.from(canonical({ mutations: {} })),
        sourceDigest: hash("relayloom/absent-legacy-private-state/1"),
      };
    const source = readPrivateSource(path),
      state = decodePrivateState(source, identity);
    return { bytes: Buffer.from(canonical(state)), sourceDigest: hash(source) };
  });
  try {
    const { bytes, digest } = database.read();
    const state = parsePrivateState(bytes, identity);
    database.transaction((tx) =>
      GroupLedger.run(tx, identity, (ledger) => {
        const decisions = reconcileGroupOutbox(ledger, state.outbox);
        if (
          ledger.accounting().stops !==
          [...decisions.values()].filter((d) => d.stop).length
        )
          throw new Error("Paragem sem intenção de envio retida");
      }),
    );
    return { database, state, digest };
  } catch (error) {
    database.close();
    throw error;
  }
}
