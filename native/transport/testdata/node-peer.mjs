import { createInterface } from "node:readline";
import { Router } from "../../../packages/transport/src/index.ts";
const router = new Router({ id: "node-peer" });
const output = (value) => process.stdout.write(JSON.stringify(value) + "\n");
router.on("payload", (payload, route) =>
  output({ event: "payload", payload, route }),
);
const port = await router.listen();
output({ event: "ready", port, pid: process.pid });
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  const command = JSON.parse(line);
  if (command.type === "broadcast")
    output({
      event: "sent",
      id: router.broadcast(
        command.payload,
        command.priority ?? "normal",
        30000,
      ),
    });
});
input.on("close", async () => {
  await router.stop();
  process.exit(0);
});
