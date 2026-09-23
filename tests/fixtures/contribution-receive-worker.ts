// Synthetic, parent-owned cross-process commit boundary fixture.
import { readFileSync, writeFileSync } from "node:fs";
import { ProtectedGroupStore } from "../../packages/groups/src/storage";
import { NodeContributionCatalog } from "../../packages/sites/src/contribution-catalog";
const raw = readFileSync(process.argv[2]);
if (raw.length > 8 * 1024 * 1024)
  throw Error("bounded receipt fixture required");
const f = JSON.parse(raw.toString("utf8"));
if (f.started)
  writeFileSync(f.started, "owned Node receipt receiver started", {
    mode: 0o600,
  });
const store = new ProtectedGroupStore(f.database, f.identity, {
  expectedStoreId: f.storeId,
});
try {
  const database = {
    transaction<T>(fn: (tx: any) => T): T {
      return store.transaction((tx) => {
        const result = fn(tx);
        if (f.mode === "before-receipt-commit") process.exit(93);
        return result;
      });
    },
  };
  const catalog = new NodeContributionCatalog(
      database,
      f.identity,
      () => f.now,
    ),
    result = catalog.receiveReceipt(f.bundle, () => {});
  if (f.mode === "after-receipt") process.exit(94);
  writeFileSync(f.output, JSON.stringify(result), { mode: 0o600 });
} finally {
  store.close();
}
