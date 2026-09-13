import { readFileSync, writeFileSync } from "node:fs";
import {
  ContentStore,
  decryptBundle,
  type Bundle,
} from "../../packages/core/src/index.js";
const q: {
  storeDir: string;
  action: string;
  output: string;
  bundles: Bundle[];
  reservations?: string[];
} = JSON.parse(readFileSync(process.argv[2], "utf8"));
const store = new ContentStore(q.storeDir, 4 * 1024 * 1024, 2);
let admitted: boolean | null = null;
if (q.action === "seed") {
  store.putReserved(q.bundles[0]);
  store.put(q.bundles[1], true);
} else if (q.action === "reserve" || q.action === "reserve-exit")
  store.setReservations(q.reservations ?? []);
else if (q.action === "pressure") {
  try {
    admitted = store.put(q.bundles[2]);
  } catch {
    admitted = false;
  }
} else if (q.action !== "inspect") throw new Error("Unknown fixture action");
if (q.action === "reserve-exit") process.exit(78);
let canDecrypt = false;
try {
  decryptBundle(store.get(q.bundles[0].manifest.id, false));
  canDecrypt = true;
} catch {
  /* Exact encrypted seeding needs no decryption key. */
}
writeFileSync(
  q.output,
  JSON.stringify({
    reservations: store.reservations(),
    stats: store.stats(),
    aPresent: store.has(q.bundles[0].manifest.id),
    bPinned: store.isPinned(q.bundles[1].manifest.id),
    admitted,
    canDecrypt,
  }),
);
