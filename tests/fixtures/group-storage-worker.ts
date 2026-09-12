// Owned process fixture. Identity input exists only in a private project cache.
import { readFileSync, writeFileSync } from "node:fs";
import { ProtectedGroupStore } from "../../packages/groups/src/storage.js";
const [mode, path, identityPath, checkpoint] = process.argv.slice(2);
const identity = JSON.parse(readFileSync(identityPath, "utf8"));
const store = new ProtectedGroupStore(path, identity);
if (mode === "crash") {
  store.transaction((tx) => {
    tx.put("counter", Buffer.from("999"));
    tx.put("uncommitted", Buffer.alloc(256 * 1024, 42));
    writeFileSync(checkpoint, "writes-staged-before-commit", { mode: 0o600 });
    process.exit(73); // Deliberately omit transaction completion and close.
  });
} else if (mode === "increment") {
  process.send?.({ ready: true });
  process.once("message", () => {
    for (let i = 0; i < 12; i++)
      store.transaction((tx) => {
        const previous = Number(tx.get("counter")!.toString());
        tx.put("counter", Buffer.from(String(previous + 1)));
      });
    store.close();
    process.disconnect();
  });
} else throw new Error("Unknown fixture mode");
