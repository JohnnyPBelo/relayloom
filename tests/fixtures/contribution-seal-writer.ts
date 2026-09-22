import { readFileSync, writeFileSync, writeSync } from "node:fs";
import { ProtectedGroupStore } from "../../packages/groups/src/storage";
import { NodeContributionCatalog } from "../../packages/sites/src/contribution-catalog";
const path = process.argv[2],
  f = JSON.parse(readFileSync(path, "utf8")),
  db = new ProtectedGroupStore(f.database, f.identity, {
    expectedStoreId: f.storeId,
  });
try {
  const catalog = new NodeContributionCatalog(db, f.identity, () => f.now);
  writeSync(1, "SEALING\n");
  const result = catalog.seal(f.handle, () => {});
  writeFileSync(path + ".node-result.json", JSON.stringify(result), {
    mode: 0o600,
  });
} finally {
  db.close();
}
