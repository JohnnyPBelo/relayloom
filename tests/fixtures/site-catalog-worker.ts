import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ProtectedGroupStore,
  type RegistryTransaction,
} from "../../packages/groups/src/storage";
import { NodeSiteCatalog } from "../../packages/sites/src/catalog";
import { ContentStore } from "../../packages/core/src/index";
const input = JSON.parse(readFileSync(process.argv[2], "utf8")),
  mode = process.argv[3];
if (
  ![
    "prepare-before",
    "prepare-after",
    "commit-before",
    "commit-after",
    "copy",
  ].includes(mode)
)
  throw Error("Unknown owned fixture mode");
const store = new ProtectedGroupStore(
  join(input.directory, "private.sqlite"),
  input.owner,
  { expectedStoreId: input.storeId },
);
if (mode === "copy") {
  const catalog = new NodeSiteCatalog(store, input.owner),
    bundle = catalog.authorizedBundle("profile", input.handle);
  new ContentStore(join(input.directory, "public-copy")).put(bundle, true);
  process.exit(75); // The public copy exists; its ready checkpoint is deliberately absent.
}
const database = {
  transaction<T>(run: (tx: RegistryTransaction) => T): T {
    if (mode.endsWith("-before"))
      return store.transaction((tx) => {
        run(tx);
        process.exit(73);
      });
    const value = store.transaction(run);
    process.exit(74); // Commit is durable; there is deliberately no response.
    return value;
  },
};
const catalog = new NodeSiteCatalog(database, input.owner);
if (mode.startsWith("prepare")) catalog.prepare("profile", input.request);
else catalog.commit("profile", input.handle);
throw Error("Interruption fixture unexpectedly returned");
