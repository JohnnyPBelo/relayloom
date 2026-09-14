import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { WebSocket } from "ws";
import { launch, password } from "../helpers.js";

function dial(endpoint: string, origin: string, token: string) {
  return new Promise<{ socket: WebSocket; status: number }>((resolve) => {
    const socket = new WebSocket(
      endpoint,
      ["relayloom-stream-v1", "invite-" + token],
      { origin, handshakeTimeout: 2000 },
    );
    let done = false;
    const finish = (status: number) => {
      if (done) return;
      done = true;
      resolve({ socket, status });
    };
    socket.once("open", () => finish(101));
    socket.on("error", () => finish(0));
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      finish(response.statusCode ?? 0);
      socket.terminate();
    });
  });
}
function closed(socket: WebSocket) {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("The owned web connection did not close")),
      4000,
    );
    socket.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

/** Real control API and separate data listener. No simulated endpoint or browser claim. */
export async function webPeerAPI(backend: "node" | "native") {
  const client = await launch(undefined, 0, 0, backend);
  const sockets: WebSocket[] = [];
  const origin = "https://relayloom.test";
  try {
    await assert.rejects(client.call("web-peer", { origin }), /desbloque/i);
    await client.call("setup", { name: "Web link owner", password });
    const owner = (await client.call("state")).identity.id;
    const invitation = await client.call("web-peer", { origin });
    const privatePost = await client.call("publish", {
      content: { type: "post", text: "Private content before identity lock" },
      recipients: [],
    });
    assert.equal(invitation.version, 1);
    const peer = await dial(invitation.endpoint, origin, invitation.token);
    sockets.push(peer.socket);
    assert.equal(
      peer.status,
      101,
      "positive control: the issued invitation must open a real socket",
    );

    await assert.rejects(
      client.call("web-peer", { origin: origin + "/path" }),
      /origem/i,
    );
    const state = await client.call("state");
    assert.equal(state.webPeer.origin, origin);
    assert.equal(state.webPeer.expires, invitation.expires);
    assert.equal(
      peer.socket.readyState,
      WebSocket.OPEN,
      "invalid input revoked a valid invitation",
    );
    assert.equal(
      JSON.stringify(state).includes(invitation.token),
      false,
      "ordinary state exposed the transport capability",
    );
    const unauthorized = await fetch(client.url + "/api/state", {
      headers: { Authorization: "Bearer " + invitation.token },
    });
    assert.equal(
      unauthorized.status,
      401,
      "transport capability was accepted as control authority",
    );
    await unauthorized.arrayBuffer();

    await client.call("lock", {});
    assert.equal((await client.call("state")).locked, true);
    assert.equal(
      peer.socket.readyState,
      WebSocket.OPEN,
      "locking keys silently withdrew the separate opaque-relay consent",
    );
    await assert.rejects(client.call("web-peer", { origin }), /desbloque/i);
    await assert.rejects(client.call("view", { id: privatePost.id }));
    await assert.rejects(
      client.call("publish", {
        content: { type: "post", text: "Must not sign while locked" },
        recipients: [],
      }),
    );
    await Promise.all([closed(peer.socket), client.call("web-peer-stop", {})]);
    await client.call("unlock", { password });
    assert.equal(
      (await client.call("state")).webPeer,
      null,
      "unlock silently renewed a revoked invitation",
    );
    const next = await client.call("web-peer", { origin });
    assert.ok(
      next.token !== invitation.token,
      "unlock/reissue reused the old capability",
    );
    const old = await dial(next.endpoint, origin, invitation.token);
    sockets.push(old.socket);
    assert.equal(old.status, 403, "old capability opened the new listener");
    const current = await dial(next.endpoint, origin, next.token);
    sockets.push(current.socket);
    assert.equal(current.status, 101);
    await Promise.all([
      closed(current.socket),
      client.call("web-peer-stop", {}),
    ]);
    const after = await client.call("state");
    assert.equal(
      after.locked,
      false,
      "stopping web data transport locked the whole application",
    );
    assert.equal(after.identity.id, owner);
    assert.equal(after.webPeer, null);
    const post = await client.call("publish", {
      content: { type: "post", text: "Still usable after web transport stop" },
      recipients: [],
    });
    assert.equal(post.author.id, owner);
  } finally {
    for (const socket of sockets) socket.terminate();
    await client.stop();
    rmSync(client.dir, { recursive: true, force: true });
  }
}
