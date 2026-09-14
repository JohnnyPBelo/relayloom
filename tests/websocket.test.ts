import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import {
  listenWebSocket,
  webOrigin,
} from "../packages/transport/src/websocket.js";
import { Router } from "../packages/transport/src/index.js";

function dial(
  endpoint: string,
  origin: string,
  token: string,
): Promise<{ socket: WebSocket; status: number }> {
  return new Promise((resolve) => {
    const socket = new WebSocket(
      endpoint,
      ["relayloom-stream-v1", "invite-" + token],
      { origin, handshakeTimeout: 1500 },
    );
    let done = false;
    const finish = (status: number) => {
      if (done) return;
      done = true;
      resolve({ socket, status });
    };
    socket.on("error", () => finish(0));
    socket.once("open", () => finish(101));
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      finish(response.statusCode ?? 0);
      socket.terminate();
    });
  });
}
test(
  "websocket invitations require exact origin/capability, preserve eight slots, and carry no control API",
  { timeout: 10000 },
  async () => {
    const router = new Router(),
      server = await listenWebSocket(router, {
        origin: "https://relayloom.test",
      }),
      clients: WebSocket[] = [];
    try {
      assert.equal(
        webOrigin("https://relayloom.test"),
        "https://relayloom.test",
      );
      for (const origin of [
        "null",
        "https://*.test",
        "file://host",
        "https://example.test/path",
        "https://user@example.test",
        "https://EXAMPLE.test",
        "https://relayloom.test:443",
        "http://localhost:65536",
        "https://relayloom.test?",
        "https://relayloom.test#",
      ])
        assert.throws(() => webOrigin(origin));
      assert.equal(
        (
          await dial(
            server.invitation.endpoint,
            "https://evil.test",
            server.invitation.token,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await dial(
            server.invitation.endpoint,
            server.invitation.origin,
            "0".repeat(64),
          )
        ).status,
        403,
      );
      const response = await fetch(
        server.invitation.endpoint.replace("ws://", "http://") + "/api/state",
      );
      assert.equal(response.status, 404);
      await response.arrayBuffer();
      for (let i = 0; i < 8; i++) {
        const peer = await dial(
          server.invitation.endpoint,
          server.invitation.origin,
          server.invitation.token,
        );
        assert.equal(peer.status, 101, `valid slot${i + 1}`);
        clients.push(peer.socket);
      }
      assert.equal(server.state().connections, 8);
      assert.equal(
        (
          await dial(
            server.invitation.endpoint,
            server.invitation.origin,
            server.invitation.token,
          )
        ).status,
        403,
      );
      const pong = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("heartbeat timeout")),
          1500,
        );
        clients[0].once("message", (data) => {
          clearTimeout(timer);
          resolve(data.toString());
        });
      });
      const nonce = "11111111-1111-1111-1111-111111111111";
      clients[0].send(JSON.stringify({ t: "ping", nonce }) + "\n");
      assert.deepEqual(JSON.parse(await pong), { t: "pong", nonce });
    } finally {
      for (const client of clients) client.terminate();
      await server.close();
      await router.stop();
    }
  },
);
test(
  "websocket expiry closes active connections and non-loopback cleartext listeners are refused",
  { timeout: 10000 },
  async () => {
    const router = new Router();
    let server: Awaited<ReturnType<typeof listenWebSocket>> | undefined;
    try {
      await assert.rejects(
        listenWebSocket(router, {
          origin: "https://relayloom.test",
          host: "0.0.0.0",
        }),
      );
      server = await listenWebSocket(router, {
        origin: "https://relayloom.test",
        ttlMs: 1000,
      });
      const peer = await dial(
        server.invitation.endpoint,
        server.invitation.origin,
        server.invitation.token,
      );
      assert.equal(peer.status, 101);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("expiry did not close peer")),
          2500,
        );
        peer.socket.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      assert.equal(server.state().active, false);
      assert.equal(
        (
          await dial(
            server.invitation.endpoint,
            server.invitation.origin,
            server.invitation.token,
          )
        ).status,
        403,
      );
    } finally {
      await server?.close();
      await router.stop();
    }
  },
);
