// Parent-owned crash fixture. Identities remain in project-local 0600 files.
import { readFileSync, writeFileSync } from "node:fs";
import { ProtectedGroupStore } from "../../packages/groups/src/storage";
import { NodeContributionInbox } from "../../packages/sites/src/contribution-inbox-catalog";
const path = process.env.RELAYLOOM_NODE_INBOX_CONTROL;
if (!path) throw Error("parent-owned inbox fixture required");
const raw = readFileSync(path);
if (raw.length > 16 * 1024 * 1024) throw Error("oversized fixture");
const input = JSON.parse(raw.toString("utf8"));
const store = new ProtectedGroupStore(input.database, input.identity, {
  expectedStoreId: input.storeId,
});
try {
  const database = {
    transaction<T>(fn: Parameters<ProtectedGroupStore["transaction"]>[0]): T {
      return store.transaction((tx) => {
        const result = fn(tx);
        if (input.crash === "before-commit") process.exit(83);
        return result as T;
      });
    },
  };
  const inbox = new NodeContributionInbox(
    database,
    input.identity,
    () => input.now,
  );
  const result = inbox.dismiss(input.id, input.revision);
  if (input.crash === "after-command") process.exit(83);
  writeFileSync(input.output, JSON.stringify(result), { mode: 0o600 });
} finally {
  store.close();
}
