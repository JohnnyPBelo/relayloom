import { readFileSync, writeFileSync } from "node:fs";
import { ProtectedGroupStore } from "../../packages/groups/src/storage.js";
import { GroupRegistry } from "../../packages/groups/src/registry.js";

const [
  mode,
  path,
  identityPath,
  groupId,
  expected,
  operationId,
  title,
  marker,
] = process.argv.slice(2);
const identity = JSON.parse(readFileSync(identityPath, "utf8"));
const store = new ProtectedGroupStore(path, identity),
  registry = new GroupRegistry(store, identity);
const before = registry.privateState(groupId, expected)!;
if (mode === "crash-before-commit") {
  const original = store.transaction.bind(store);
  store.transaction = (callback) =>
    original((tx) => {
      const result = callback(tx);
      writeFileSync(marker, "authority-and-operation-staged", { mode: 0o600 });
      process.exit(73);
      return result;
    });
}
process.send?.({ ready: true });
process.once("message", () => {
  try {
    const result = registry.commit(operationId, groupId, expected, {
      title,
      members: before.members,
      joins: [],
    });
    if (mode === "lost-response") {
      writeFileSync(
        marker,
        JSON.stringify({
          stage: "committed-before-response",
          epochId: result.epochId,
        }),
        { mode: 0o600 },
      );
      process.exit(74);
    }
    process.send?.({ result });
  } catch (error) {
    process.send?.({ error: (error as Error).message });
  } finally {
    store.close();
    process.disconnect();
  }
});
