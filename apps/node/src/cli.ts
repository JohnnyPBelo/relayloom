import { resolve, join } from "node:path";
import { mkdirSync, statfsSync } from "node:fs";
import { LoomNode } from "./node.js";
import { serve } from "./server.js";
import { atomic } from "../../../packages/core/src/index.js";
const args = process.argv.slice(2);
const arg = (key: string, fallback: string) => {
  const i = args.indexOf(key);
  return i >= 0 ? args[i + 1] : fallback;
};
const dir = resolve(arg("--data", ".runtime/default"));
mkdirSync(dir, { recursive: true, mode: 0o700 });
const disk = statfsSync(dir);
if (disk.bavail * disk.bsize < 15 * 1024 ** 3)
  throw new Error(
    "RelayLoom requer uma reserva de 15 GiB livres neste ambiente",
  );
const node = new LoomNode(dir);
await node.start(
  Number(arg("--tcp-port", "0")),
  arg("--tcp-host", "127.0.0.1"),
);
const api = await serve(node, Number(arg("--http-port", "4173")));
const info = {
  url: api.url,
  token: api.token,
  tcpPort: node.tcpPort,
  pid: process.pid,
};
atomic(join(dir, "runtime.json"), JSON.stringify(info));
console.log(
  JSON.stringify({
    ready: true,
    url: `${api.url}/#token=${api.token}`,
    tcpPort: node.tcpPort,
    data: dir,
  }),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await api.close();
  await node.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
