import { readFileSync, writeFileSync } from "node:fs";
import { GroupRegistry } from "../../packages/groups/src/registry.js";
import { ProfileDatabase } from "../../packages/profile/src/database.js";
import { ProfileOwnership } from "../../packages/profile/src/ownership.js";
import { writeProfileState } from "../../packages/profile/src/state.js";

const q = JSON.parse(readFileSync(process.argv[2], "utf8"));
const lease = new ProfileOwnership(q.directory);
const db = ProfileDatabase.open(q.directory, q.identity, () => {
  throw new Error("Fixture requires a committed database; no legacy fallback");
});
try {
  if (q.mode !== "read") {
    db.transaction((tx) =>
      GroupRegistry.inTransaction(tx, q.identity, (g) => {
        g.create(q.operationId, q.title);
        writeProfileState(tx, Buffer.from(q.next, "base64"), q.expected);
        if (q.mode === "before") {
          writeFileSync(q.marker, "group-and-private-staged", { mode: 0o600 });
          process.exit(73);
        }
      }),
    );
    if (q.mode === "after") {
      writeFileSync(q.marker, "group-and-private-committed", { mode: 0o600 });
      process.exit(74);
    }
  }
  const state = db.read(),
    registry = new GroupRegistry(db.store, q.identity);
  writeFileSync(
    q.output,
    JSON.stringify({
      bytes: state.bytes.toString("base64"),
      digest: state.digest,
      operation: registry.operationStatus(q.operationId),
      groups: registry.list(),
    }),
    { mode: 0o600 },
  );
} finally {
  db.close();
  lease.close();
}
