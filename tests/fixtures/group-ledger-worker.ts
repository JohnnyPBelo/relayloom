import { readFileSync, writeFileSync } from "node:fs";
import {
  canonical,
  decryptBundle,
  verifyBundle,
} from "../../packages/core/src/index.js";
import { ProtectedGroupStore } from "../../packages/groups/src/storage.js";
import { GroupLedger } from "../../packages/groups/src/ledger.js";

const q = JSON.parse(readFileSync(process.argv[2], "utf8"));
const store = new ProtectedGroupStore(q.Path, q.Identity, {
  expectedStoreId: q.StoreID,
});
try {
  const results: any[] = [];
  store.transaction((tx) => {
    GroupLedger.run(tx, q.Identity, (l, g) => {
      for (const r of q.Requests) {
        if (r.Kind === "consider") {
          const b = r.Bundle;
          verifyBundle(b);
          results.push(
            l.consider(
              {
                id: b.manifest.id,
                kind: b.manifest.kind,
                author: b.manifest.author,
                readers: b.manifest.keys.map((key: any) => key.reader),
                public: !!b.manifest.publicKey,
                content: decryptBundle(b, q.Identity) as Record<
                  string,
                  unknown
                >,
              },
              b.manifest.expires,
              Buffer.byteLength(canonical(b)),
              new Set(),
            ),
          );
        } else if (r.Kind === "close")
          results.push(g.close(r.OperationID, r.GroupID, r.EpochID));
        else if (r.Kind === "retry")
          results.push(l.reconcileRetry(r.Entry, r.Unfinished));
        else if (r.Kind === "accepted") results.push(l.accepted(r.ID));
        else if (r.Kind === "held") results.push(l.held());
        else if (r.Kind === "stop") results.push(l.stop(r.Entry.operationId));
        else if (r.Kind === "losses") results.push(l.losses());
        else if (r.Kind === "retire") {
          l.retireStops(new Set(r.Retained));
          results.push(true);
        } else throw new Error("Unknown fixture command");
      }
    });
    if (q.Crash === "before") {
      writeFileSync(q.Marker, "staged-before-commit", { mode: 0o600 });
      process.exit(73);
    }
  });
  if (q.Crash === "after") {
    writeFileSync(q.Marker, "committed-before-response", { mode: 0o600 });
    process.exit(74);
  }
  writeFileSync(q.Output, canonical(results), { mode: 0o600 });
} finally {
  store.close();
}
