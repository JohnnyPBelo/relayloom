import { readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { LoomNode } from "../../apps/node/src/node.js";
import { readProfileState } from "../../packages/profile/src/state.js";
import { canonical, hash } from "../../packages/core/src/index.js";
import { password, until } from "../helpers.js";

const request = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (
  !resolve(request.directory).startsWith(resolve(".cache") + sep) ||
  !resolve(request.marker).startsWith(resolve(".cache") + sep) ||
  !["before", "after"].includes(request.mode) ||
  !["preparing", "ready"].includes(request.phase)
)
  throw new Error("invalid fixture scope");
const node = new LoomNode(request.directory);
node.unlock(password);
clearInterval((node as any).syncTimer);
node.router.connectTcp("127.0.0.1", request.port);
await until(
  async () => node.router.peers,
  (peers) => peers.some((p) => p.connected),
);
let acknowledged = false;
node.router.on("payload", (payload: any) => {
  if (payload.type === "request" && payload.ids?.[0] === hash(request.witness))
    acknowledged = true;
});
node.router.broadcast({ witness: request.witness });
await until(async () => acknowledged, Boolean);
// The driver waits for this actual TCP witness; no durable peer setting is added.
const database = (node as any).privateDatabase,
  transaction = database.transaction.bind(database);
const record = (tx: any) =>
  JSON.parse(readProfileState(tx)!.bytes.toString()).outbox?.[
    request.body.operationId
  ];
const exit = (entry: any) => {
  writeFileSync(
    request.marker,
    JSON.stringify({
      mode: request.mode,
      phase: request.phase,
      id: entry.id,
      bundleHash:
        request.phase === "ready"
          ? hash(canonical(node.store.get(entry.id, false)))
          : null,
    }),
    { mode: 0o600 },
  );
  process.exit(request.mode === "before" ? 83 : 84);
};
database.transaction = (callback: any) => {
  let boundary: any;
  const result = transaction((tx: any) => {
    const before = record(tx),
      value = callback(tx),
      after = record(tx);
    if (after?.phase === request.phase && before?.phase !== request.phase) {
      boundary = after;
      if (request.mode === "before") exit(after);
    }
    return value;
  });
  if (boundary) exit(boundary);
  return result;
};
node.send(
  request.body.operationId,
  request.body.content,
  request.body.recipients,
  request.body.ttlMs,
);
throw new Error("process exit fixture missed its send boundary");
