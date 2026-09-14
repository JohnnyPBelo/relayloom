import test from "node:test";
import { webPeerAPI } from "./fixtures/web-peer-api.js";

test(
  "Node web-peer API separates keys, relay consent and control authority, and enforces explicit revocation",
  { timeout: 30000 },
  async () => {
    await webPeerAPI("node");
  },
);
