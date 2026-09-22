import { readFileSync, writeSync } from "node:fs";
import { ProtectedGroupStore } from "../../packages/groups/src/storage";
import { NodeContributionCatalog } from "../../packages/sites/src/contribution-catalog";
const f = JSON.parse(readFileSync(process.argv[2], "utf8"));
const db = new ProtectedGroupStore(f.path, f.identity, {
  expectedStoreId: f.storeId,
});
const exit = () => {
  writeSync(1, f.mode + "\n");
  // Windows has no POSIX SIGKILL status; force an immediate exit without JS cleanup.
  if (process.platform === "win32") process.exit(86);
  process.kill(process.pid, "SIGKILL");
  throw Error("SIGKILL did not terminate owned fixture");
};
const database =
  f.mode === "before-intent-commit"
    ? {
        transaction<T>(fn: (tx: any) => T): T {
          return db.transaction((tx) => {
            fn(tx);
            return exit();
          });
        },
      }
    : db;
const catalog = new NodeContributionCatalog(database, f.identity),
  op = catalog.prepare(
    f.request,
    () => f.source,
    () => {},
  );
if (f.mode === "after-signature") catalog.sign(op, () => {});
exit();
