// Signing/transport fixture only. This is a real child process, not a product
// creation API; application resource creation and editor UI are separate gates.
import {
  createIdentity,
  createBundle,
  canonical,
  hash,
} from "../../packages/core/src/index";
import { Router } from "../../packages/transport/src/index";
import { until } from "../helpers";
const target = Number(process.argv[2]);
if (!Number.isInteger(target) || target < 1 || target > 65535 || !process.send)
  throw Error("Use an owned peer port and private fixture IPC");
const identity = createIdentity("Autora do recurso opcional");
const resource = createBundle(
  identity,
  "site-resource",
  {
    type: "site-resource",
    domain: "relayloom/site-resource/1",
    kind: "file",
    name: "Guia.txt",
    mime: "text/plain",
    data: Buffer.from(
      "Recurso opcional: conteúdo exacto.\n".repeat(2048),
    ).toString("base64"),
  },
  "public",
  3600000,
);
const witness = createBundle(
  identity,
  "post",
  { type: "post", text: "Inventário normal alcançável" },
  "public",
  3600000,
);
const router = new Router(),
  port = await router.listen(0);
router.on("payload", (payload: any) => {
  if (payload?.type === "inventory")
    process.send?.({ kind: "inventory", ids: payload.ids });
});
router.connectTcp("127.0.0.1", target);
let stopped = false;
const stop = async () => {
  if (stopped) return;
  stopped = true;
  await router.stop();
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("disconnect", () => void stop());
await until(
  async () => router.peers,
  (peers) => peers.some((p) => p.connected),
);
router.broadcast({ type: "bundle", bundle: resource }, "bulk");
router.broadcast({ type: "bundle", bundle: witness });
process.send({
  kind: "ready",
  port,
  authorId: identity.public.id,
  resourceId: resource.manifest.id,
  witnessId: witness.manifest.id,
  resourceHash: hash(canonical(resource)),
});
