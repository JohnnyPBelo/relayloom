// Parent-owned crash fixture. Identities remain in project-local 0600 files.
import { readFileSync, writeFileSync } from "node:fs";
import { ProtectedGroupStore } from "../../packages/groups/src/storage";
import { NodeContributionInbox } from "../../packages/sites/src/contribution-inbox-catalog";
const path = process.env.RELAYLOOM_NODE_INBOX_CONTROL;
if (!path) throw Error("parent-owned inbox fixture required");
const raw = readFileSync(path);
if (raw.length > 16 * 1024 * 1024) throw Error("oversized fixture");
const input = JSON.parse(raw.toString("utf8"));
if (input.started)
  writeFileSync(input.started, "owned Node writer started", { mode: 0o600 });
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
  let result: unknown;
  switch (input.action ?? "dismiss") {
    case "reject":
      result = inbox.reject(input.id, input.revision, input.reason, () => {});
      break;
    case "dismiss":
      result = inbox.dismiss(input.id, input.revision);
      break;
    case "source":
      result = inbox.attachSource(input.id, input.source, () => {});
      break;
    case "sign-receipt":
      result = inbox.signReceipt(input.id, () => {});
      break;
    case "seal-receipt":
      result = inbox.sealReceipt(input.id, () => {});
      break;
    case "copy-receipt":
      result = inbox.copyReceipt(input.id, input.envelope, () => {});
      break;
    case "sign-rejection":
      result = inbox.signRejection(input.id, () => {});
      break;
    case "seal-rejection":
      result = inbox.sealRejection(input.id, () => {});
      break;
    case "copy-rejection":
      result = inbox.copyRejection(input.id, input.envelope, () => {});
      break;
    default:
      throw Error("unknown parent-owned action");
  }
  if (input.crash === "after-command") process.exit(83);
  writeFileSync(input.output, JSON.stringify(result), { mode: 0o600 });
} finally {
  store.close();
}
