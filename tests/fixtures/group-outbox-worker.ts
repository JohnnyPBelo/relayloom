import { readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { LoomNode } from "../../apps/node/src/node.js";
import { password } from "../helpers.js";

const request = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (
  !resolve(request.directory).startsWith(resolve(".cache") + sep) ||
  !["before", "after"].includes(request.mode)
)
  throw new Error("invalid fixture scope");
const node = new LoomNode(request.directory);
node.unlock(password);
clearInterval((node as any).syncTimer);
const database = (node as any).privateDatabase,
  transaction = database.transaction.bind(database);
database.transaction = (callback: any) => {
  if (request.mode === "before")
    return transaction((tx: any) => {
      callback(tx);
      writeFileSync(request.marker, "before");
      process.exit(81);
    });
  transaction(callback);
  writeFileSync(request.marker, "after");
  process.exit(82);
};
node.groupCommand({
  action: "close",
  operationId: request.operationId,
  groupId: request.groupId,
  expected: request.epochId,
});
throw new Error("process exit fixture did not reach its commit boundary");
