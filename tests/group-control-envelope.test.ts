import test from "node:test";
import { groupControlEnvelope } from "./fixtures/group-control-envelope.js";
test(
  "opaque Node relay rejects public, oversized and excessive-lifetime controls before storage and forwarding",
  { timeout: 60000 },
  async () => {
    await groupControlEnvelope("node");
  },
);
