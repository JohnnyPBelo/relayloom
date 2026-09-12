import fs, { readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { canonical, hash } from "../../packages/core/src/index.js";
import { readPrivateState } from "../../apps/node/src/local-state.js";
import { ProtectedGroupStore } from "../../packages/groups/src/storage.js";
import { ProfileOwnership } from "../../packages/profile/src/ownership.js";
import { ProfileDatabase } from "../../packages/profile/src/database.js";

const [directory, identityFile, mode, marker] = process.argv.slice(2),
  identity = JSON.parse(readFileSync(identityFile, "utf8"));
const ownership = new ProfileOwnership(directory);
if (mode === "prepared" || mode === "committed") {
  const original = fs.renameSync;
  fs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
    original(from, to);
    if (
      String(to) === join(directory, "profile-binding.json") &&
      JSON.parse(readFileSync(to, "utf8")).body.phase === mode
    ) {
      writeFileSync(marker, mode + "-binding-renamed");
      process.exit(mode === "prepared" ? 73 : 75);
    }
  }) as typeof fs.renameSync;
  syncBuiltinESMExports();
}
if (mode === "imported") {
  const original = ProtectedGroupStore.prototype.transaction;
  ProtectedGroupStore.prototype.transaction = function (callback: any): any {
    const result = original.call(this, callback);
    writeFileSync(marker, "private-state-import-committed");
    process.exit(74);
    return result;
  };
}
const database = ProfileDatabase.open(directory, identity, () => ({
  bytes: Buffer.from(
    canonical(
      readPrivateState(join(directory, "private-state.json"), identity),
    ),
  ),
  sourceDigest: hash(readFileSync(join(directory, "private-state.json"))),
}));
database.close();
ownership.close();
