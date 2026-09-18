// Owned crash fixture; it never broadcasts staged bytes or writes outside .cache.
import { readFileSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { ProtectedGroupStore } from "../../packages/groups/src/storage";
import { NodeResourceCatalog } from "../../packages/sites/src/resource-catalog";
import { ContentStore } from "../../packages/core/src/index";
const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (
  !resolve(input.directory).startsWith(resolve(".cache") + sep) ||
  !["before-commit", "after-commit", "after-copy", "after-ready"].includes(
    input.mode,
  )
)
  throw Error("Invalid fixture scope");
const database = new ProtectedGroupStore(
  join(input.directory, "profile.sqlite"),
  input.identity,
  { expectedStoreId: input.storeId },
);
if (input.mode === "before-commit") {
  const transaction = database.transaction.bind(database);
  database.transaction = (callback: any) =>
    transaction((tx) => {
      const result = callback(tx);
      process.exit(71);
      return result;
    });
}
const catalog = new NodeResourceCatalog(database, input.identity);
const operation = catalog.prepare(input.request, () => "public");
if (input.mode === "after-commit") process.exit(72);
const bundle = catalog.authorizedBundle(operation)!;
const store = new ContentStore(join(input.directory, "store"));
store.put(bundle);
if (input.mode === "after-copy") process.exit(73);
catalog.ready(operation, store.get(bundle.manifest.id, false));
process.exit(74);
