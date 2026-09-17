import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { LoomNode } from "../../apps/node/src/node";
import { serve } from "../../apps/node/src/server";
const directory = process.argv[2];
if (!directory) throw new Error("Owned fixture directory required");
const node = new LoomNode(directory);
await node.start();
const original = node.store.put.bind(node.store);
node.store.put = (bundle, pin) => {
  if (bundle.manifest.kind === "site") {
    writeFileSync(
      join(directory, "site-crash.json"),
      JSON.stringify({ bundleId: bundle.manifest.id }),
      { mode: 0o600 },
    );
    process.exit(81);
  }
  return original(bundle, pin);
};
const server = await serve(node);
let closing = false;
const stop = async () => {
  if (closing) return;
  closing = true;
  await server.close();
  await node.stop();
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("disconnect", () => void stop());
process.send?.({
  ready: true,
  url: server.url,
  token: server.token,
  tcpPort: node.tcpPort,
});
