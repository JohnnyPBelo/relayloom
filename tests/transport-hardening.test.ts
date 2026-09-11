import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createConnection, createServer, type Socket } from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { SerialPort } from "serialport";
import { Router } from "../packages/transport/src/index.js";
import { canonical, hash } from "../packages/core/src/index.js";

const FRAGMENT = 2048,
  MAX_PENDING = 16 * 1024 * 1024;
async function until(check: () => boolean, timeout = 6000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() >= end) throw new Error("transport condition timed out");
    await delay(10);
  }
}
function packet(payload: unknown, changes: Record<string, unknown> = {}) {
  const now = Date.now(),
    body = {
      source: "raw-peer",
      created: now,
      expires: now + 30_000,
      maxHops: 12,
      priority: "normal",
      payload,
      ...changes,
    };
  return { ...body, id: hash(canonical(body)), hops: ["raw-peer"] };
}
function frames(value: ReturnType<typeof packet>) {
  const data = Buffer.from(canonical(value)),
    count = Math.ceil(data.length / FRAGMENT);
  return Array.from(
    { length: count },
    (_, index) =>
      JSON.stringify({
        t: "part",
        id: value.id,
        index,
        count,
        data: data
          .subarray(index * FRAGMENT, (index + 1) * FRAGMENT)
          .toString("base64"),
      }) + "\n",
  );
}
async function connect(router: Router) {
  const socket = createConnection({
    host: "127.0.0.1",
    port: await router.listen(),
  });
  socket.on("error", () => {});
  await once(socket, "connect");
  await until(() => router.peers.length === 1);
  return socket;
}
function parse(io: Socket | SerialPort, receive: (frame: any) => void) {
  let buffer = "";
  io.on("data", (data) => {
    buffer += data.toString();
    let at: number;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      receive(JSON.parse(line));
    }
  });
}
async function closeSerial(port: SerialPort) {
  if (port.isOpen)
    await new Promise<void>((resolve) => port.close(() => resolve()));
}

test("TCP parser handles split/coalesced frames, rejects tamper and replays only once", async () => {
  const router = new Router(),
    socket = await connect(router),
    got: unknown[] = [],
    acknowledgements: string[] = [];
  router.on("payload", (payload) => got.push(payload));
  parse(socket, (frame) => {
    if (frame.t === "ack") acknowledgements.push(frame.id);
  });
  try {
    const value = packet({ text: "valid ".repeat(3000) }),
      wire = frames(value);
    socket.write(wire[0].slice(0, 27));
    await delay(20);
    assert.equal(got.length, 0);
    socket.write(wire[0].slice(27) + wire.slice(1).join(""));
    await until(() => got.length === 1 && acknowledgements.includes(value.id));
    socket.write(wire.join(""));
    await until(() => router.counters.duplicates === wire.length);
    assert.equal(got.length, 1);
    const altered = {
      ...packet({ text: "signed bytes substitute" }),
      id: "f".repeat(64),
    };
    socket.write(frames(altered).join(""));
    await until(() => router.counters.rejected > 0);
    assert.equal(got.length, 1);
    assert.ok(!acknowledgements.includes(altered.id));
    const link = [...router.links][0];
    assert.equal(link.assemblies.size, 0);
    assert.equal(link.assemblyBytes, 0);
  } finally {
    socket.destroy();
    await router.stop();
  }
});

test("non-reading TCP duplicate flood coalesces and bounds control output", async () => {
  const router = new Router(),
    socket = await connect(router);
  socket.pause();
  try {
    const value = packet({ replay: true }),
      wire = frames(value)[0];
    socket.write(wire);
    await until(() => router.counters.received === 1);
    const link = [...router.links][0],
      before = link.state.sent;
    socket.write(wire.repeat(5000));
    await until(() => router.counters.duplicates >= 5000);
    assert.equal(router.counters.received, 1);
    assert.ok(link.controls.size <= 1);
    assert.ok(
      link.state.sent - before <= 90,
      "one replay ID cannot generate a write for every duplicate",
    );
    assert.ok(link.io.writableLength <= 4096);
    assert.ok(link.pendingBytes <= MAX_PENDING);
    assert.equal(link.assemblies.size, 0);
    socket.write(wire.repeat(4000));
    await until(() => !link.active);
    assert.ok(router.counters.rateLimited > 0);
    assert.equal(link.controls.size, 0);
    assert.equal(link.state.queued, 0);
  } finally {
    socket.destroy();
    await router.stop();
  }
});

test("TCP malformed frame and unfinished-line floods disconnect and release state", async () => {
  for (const attack of ["{bad json}\n".repeat(40), "x".repeat(4097)]) {
    const router = new Router(),
      socket = await connect(router),
      link = [...router.links][0];
    try {
      socket.write(attack);
      await until(() => !link.active);
      assert.ok(router.counters.rejected > 0);
      assert.equal(link.buffer.length, 0);
      assert.equal(link.assemblies.size, 0);
      assert.equal(link.pendingBytes, 0);
    } finally {
      socket.destroy();
      await router.stop();
    }
  }
});

test("distinct TCP packets cannot grow the ACK queue or exceed its output rate", async () => {
  const router = new Router(),
    socket = await connect(router);
  socket.pause();
  const link = [...router.links][0];
  try {
    const input = Array.from(
      { length: 1000 },
      (_, n) => frames(packet({ n }))[0],
    ).join("");
    socket.write(input);
    await until(() => router.counters.received === 1000);
    await delay(100);
    const ackBytes = Buffer.byteLength(
      JSON.stringify({ t: "ack", id: "0".repeat(64) }) + "\n",
    );
    assert.ok(link.controls.size <= 64);
    assert.ok(link.state.sent <= 64 * ackBytes);
    assert.ok(link.io.writableLength <= 4096);
    assert.equal(link.assemblyBytes, 0);
  } finally {
    socket.destroy();
    await router.stop();
  }
});

test("TCP incomplete assemblies have count and aggregate memory bounds", async () => {
  const router = new Router(),
    socket = await connect(router),
    link = [...router.links][0];
  try {
    const part = Buffer.alloc(FRAGMENT, 97).toString("base64");
    for (let id = 0; id < 9; id++)
      socket.write(
        JSON.stringify({
          t: "part",
          id: hash("assembly" + id),
          index: 0,
          count: 3072,
          data: part,
        }) + "\n",
      );
    await until(() => router.counters.rejected > 0);
    assert.equal(link.assemblies.size, 8);
    assert.equal(link.assemblyBytes, 8 * FRAGMENT);
    // Fill three existing assemblies without completing any; the third hits the shared 16 MiB cap.
    for (let id = 0; id < 3; id++) {
      for (let index = 1; index < 2900; index++) {
        const line =
          JSON.stringify({
            t: "part",
            id: hash("assembly" + id),
            index,
            count: 3072,
            data: part,
          }) + "\n";
        if (!socket.write(line)) await once(socket, "drain");
      }
      await until(
        () =>
          link.assemblyBytes >=
            Math.min((id + 1) * 2900 * FRAGMENT, MAX_PENDING - 100_000) ||
          router.counters.rejected > 1,
      );
      if (id < 2) await delay(1050); // Respect the independent input byte/frame rate limits.
    }
    await until(() => router.counters.rejected > 1);
    assert.ok(link.active);
    assert.ok(link.assemblies.size <= 8);
    assert.ok(link.assemblyBytes <= MAX_PENDING);
    socket.destroy();
    await until(() => !link.active);
    assert.equal(link.assemblyBytes, 0);
    assert.equal(link.assemblies.size, 0);
  } finally {
    socket.destroy();
    await router.stop();
  }
});

test("expired packets, invalid TTLs and exhausted hop limits never relay", async () => {
  const middle = new Router(),
    destination = new Router(),
    socket = await connect(middle);
  let received = 0;
  destination.on("payload", () => received++);
  try {
    middle.connectTcp("127.0.0.1", await destination.listen());
    await until(() => middle.peers.length === 2);
    socket.write(
      frames(
        packet(
          { expired: true },
          { created: Date.now() - 1000, expires: Date.now() - 1 },
        ),
      ).join(""),
    );
    socket.write(
      frames(
        packet(
          { future: true },
          { created: Date.now() + 400_000, expires: Date.now() + 401_000 },
        ),
      ).join(""),
    );
    socket.write(frames(packet({ hopLimit: true }, { maxHops: 1 })).join(""));
    await until(
      () => middle.counters.rejected === 2 && middle.counters.received === 1,
    );
    await delay(100);
    assert.equal(received, 0);
    assert.equal(middle.counters.forwarded, 0);
    for (const ttl of [0, -1, NaN, Infinity, 3600_001, 1.5])
      assert.throws(() => middle.broadcast({}, "normal", ttl));
    socket.write(frames(packet({ control: true })).join(""));
    await until(() => received === 1);
  } finally {
    socket.destroy();
    await Promise.all([middle.stop(), destination.stop()]);
  }
});

test("queued expiry and stopped sockets release bounded output under backpressure", async () => {
  const router = new Router(),
    socket = await connect(router);
  socket.pause();
  const link = [...router.links][0];
  try {
    router.lowPower = true;
    for (let n = 0; n < 80; n++)
      router.broadcast({ n, payload: "x".repeat(2000) }, "bulk", 100);
    assert.ok(link.pending.size <= 62);
    assert.ok(link.pendingBytes <= MAX_PENDING);
    assert.ok(router.counters.dropped > 0);
    await until(() => link.pending.size === 0);
    assert.equal(link.state.queued, 0);
    assert.equal(link.pendingBytes, 0);
    router.lowPower = false;
    for (let n = 0; n < 4; n++)
      router.broadcast(
        { n, payload: "x".repeat(5 * 1024 * 1024) },
        "bulk",
        30000,
      );
    await until(() => link.io.writableLength > 0);
    assert.ok(
      link.io.writableLength <= 4096,
      "at most one framed write can wait for drain",
    );
    assert.ok(link.pendingBytes <= MAX_PENDING);
    await router.stop();
    await until(() => !link.writing);
    assert.equal(link.pendingBytes, 0);
    assert.equal(link.state.queued, 0);
    assert.equal(link.controls.size, 0);
  } finally {
    socket.destroy();
    await router.stop();
  }
});

test("partial TCP loss retries exact bytes and missing ACK retries without duplicate delivery", async () => {
  const sender = new Router(),
    receiver = new Router(),
    sockets = new Set<Socket>();
  let droppedPart = false,
    droppedAck = false,
    received = 0;
  const wanted = { message: "recover ".repeat(5000) };
  receiver.on("payload", (payload) => {
    assert.deepEqual(payload, wanted);
    received++;
  });
  const target = await receiver.listen();
  const proxy = createServer((front) => {
    const back = createConnection({ host: "127.0.0.1", port: target });
    sockets.add(front);
    sockets.add(back);
    front.on("error", () => {});
    back.on("error", () => {});
    front.on("close", () => back.destroy());
    back.on("close", () => front.destroy());
    parse(front, (frame) => {
      if (frame.t === "part" && frame.index === 1 && !droppedPart) {
        droppedPart = true;
        return;
      }
      back.write(JSON.stringify(frame) + "\n");
    });
    parse(back, (frame) => {
      if (frame.t === "ack" && !droppedAck) {
        droppedAck = true;
        return;
      }
      front.write(JSON.stringify(frame) + "\n");
    });
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  try {
    sender.connectTcp("127.0.0.1", (proxy.address() as { port: number }).port);
    await until(() => sender.peers.length === 1 && receiver.peers.length === 1);
    sender.broadcast(wanted);
    await until(() => received === 1 && sender.peers[0].queued === 0, 8000);
    assert.ok(droppedPart && droppedAck);
    assert.equal(received, 1);
    assert.ok(sender.counters.retransmits >= 2);
    assert.ok(receiver.counters.duplicates > 0);
    assert.equal([...receiver.links][0].assemblyBytes, 0);
  } finally {
    for (const socket of sockets) socket.destroy();
    await Promise.all([sender.stop(), receiver.stop()]);
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});

test("TCP reconnect delivers a partial transfer and packets created during the partition", async () => {
  const sender = new Router();
  let receiver = new Router(),
    cancelled = () => {};
  const received: string[] = [];
  try {
    const port = await receiver.listen();
    cancelled = sender.connectTcp("127.0.0.1", port);
    await until(() => sender.peers.length === 1);
    const firstLink = [...sender.links][0];
    sender.broadcast(
      { name: "partial", payload: "z".repeat(600_000) },
      "bulk",
      30_000,
    );
    await until(() => [...receiver.links][0]?.assemblyBytes > 0);
    await receiver.stop();
    receiver = new Router();
    sender.broadcast({ name: "during partition" }, "sos", 30_000);
    sender.broadcast({ name: "expired during partition" }, "normal", 30);
    await delay(80);
    receiver.on("payload", (payload: any) => received.push(payload.name));
    await receiver.listen(port);
    await until(
      () =>
        received.includes("partial") && received.includes("during partition"),
      8000,
    );
    assert.ok(!received.includes("expired during partition"));
    assert.ok(!firstLink.active);
    assert.equal(firstLink.pendingBytes, 0);
    assert.equal(received[0], "during partition");
  } finally {
    cancelled();
    await Promise.all([sender.stop(), receiver.stop()]);
  }
});

test("turning relay off cancels queued forwarded fragments and keeps local SOS available", async () => {
  const origin = new Router(),
    relay = new Router(),
    peer = await connect(relay);
  let forwarded = 0,
    forwardedComplete = false,
    local = "";
  const completed: string[] = [];
  parse(peer, (frame) => {
    if (frame.t !== "part") return;
    if (frame.id !== local) {
      forwarded++;
      relay.relay = false;
      forwardedComplete ||= frame.index === frame.count - 1;
    }
    if (frame.index === frame.count - 1) {
      completed.push(frame.id);
      peer.write(JSON.stringify({ t: "ack", id: frame.id }) + "\n");
    }
  });
  try {
    origin.connectTcp("127.0.0.1", peer.remotePort!);
    await until(() => relay.peers.length === 2);
    origin.broadcast({ large: "f".repeat(600_000) }, "bulk");
    await until(() => forwarded > 0);
    await delay(50);
    assert.ok(!forwardedComplete);
    assert.ok(
      [...relay.links].every((link) =>
        [...link.pending.values()].every((t) => t.packet.source === relay.id),
      ),
    );
    local = relay.broadcast({ help: true }, "sos");
    await until(() => completed.includes(local));
    assert.ok(!forwardedComplete);
  } finally {
    peer.destroy();
    await Promise.all([origin.stop(), relay.stop()]);
  }
});

test("relay pause cancels queued local seeding and prevents retained offline replay", async () => {
  const sender = new Router(),
    receiver = new Router(),
    delivered: string[] = [];
  try {
    sender.lowPower = true;
    const port = await receiver.listen();
    sender.connectTcp("127.0.0.1", port);
    await until(() => sender.peers.length === 1);
    receiver.on("payload", (payload: any) => delivered.push(payload.name));
    sender.broadcast({ name: "queued seed" }, "bulk", 30_000, true);
    await until(() => sender.peers[0].queued === 1);
    sender.relay = false;
    assert.equal(sender.peers[0].queued, 0);
    sender.lowPower = false;
    sender.broadcast({ name: "seed while paused" }, "normal", 30_000, true);
    sender.broadcast({ name: "authored while paused" }, "sos");
    await until(() => delivered.includes("authored while paused"));
    assert.deepEqual(delivered, ["authored while paused"]);
  } finally {
    await Promise.all([sender.stop(), receiver.stop()]);
  }

  const offline = new Router(),
    destination = new Router(),
    afterConnect: string[] = [];
  try {
    offline.broadcast({ name: "retained seed" }, "normal", 30_000, true);
    offline.broadcast({ name: "retained authored" }, "normal", 30_000);
    offline.relay = false;
    offline.relay = true;
    destination.on("payload", (payload: any) =>
      afterConnect.push(payload.name),
    );
    offline.connectTcp("127.0.0.1", await destination.listen());
    await until(() => afterConnect.includes("retained authored"));
    await delay(100);
    assert.deepEqual(afterConnect, ["retained authored"]);
  } finally {
    await Promise.all([offline.stop(), destination.stop()]);
  }
});

async function priorityControl(
  router: Router,
  peer: Socket | SerialPort,
  options: {
    payloadBytes?: number;
    timeoutMs?: number;
    minBulkTurns?: number;
    fixtureErrors?: () => string;
  } = {},
) {
  const payloadBytes = options.payloadBytes ?? 600_000,
    timeoutMs = options.timeoutMs ?? 12_000;
  const observed: { id: string; index: number; count: number; data: string }[] =
    [];
  const started = Date.now(),
    ioErrors: string[] = [];
  peer.on("error", (error) => ioErrors.push(error.message));
  let sos = "",
    bulk = "";
  let sosEnqueuedAtTurn = 0;
  parse(peer, (frame) => {
    if (frame.t !== "part") return;
    observed.push(frame);
    if (!sos) {
      sosEnqueuedAtTurn = [...router.links][0].turn;
      sos = router.broadcast(
        { label: "emergency", data: "s".repeat(payloadBytes) },
        "sos",
        timeoutMs + 15_000,
      );
    }
    if (frame.index === frame.count - 1)
      peer.write(JSON.stringify({ t: "ack", id: frame.id }) + "\n");
  });
  bulk = router.broadcast(
    { label: "bulk", data: "b".repeat(payloadBytes) },
    "bulk",
    timeoutMs + 15_000,
  );
  try {
    await until(
      () =>
        observed.some((f) => f.id === sos && f.index === f.count - 1) &&
        observed.some((f) => f.id === bulk && f.index === f.count - 1),
      timeoutMs,
    );
  } catch (error) {
    const progress = (id: string) => {
      const seen = observed.filter((frame) => frame.id === id),
        indexes = new Set(seen.map((frame) => frame.index));
      return {
        frames: seen.length,
        unique: indexes.size,
        expected: seen[0]?.count ?? null,
        first: seen[0]?.index ?? null,
        last: seen.at(-1)?.index ?? null,
      };
    };
    throw new Error(
      "Priority transfer timed out: " +
        JSON.stringify({
          platform: process.platform,
          elapsedMs: Date.now() - started,
          payloadBytes,
          sos: progress(sos),
          bulk: progress(bulk),
          ioErrors,
          fixtureErrors: options.fixtureErrors?.(),
          peers: router.peers,
          counters: router.counters,
          links: [...router.links].map((link) => ({
            active: link.active,
            writing: link.writing,
            turn: link.turn,
            writableLength: link.io.writableLength,
            pendingBytes: link.pendingBytes,
            pending: [...link.pending.values()].map((transfer) => ({
              priority: transfer.packet.priority,
              next: transfer.next,
              count: Math.ceil(transfer.bytes / FRAGMENT),
              attempts: transfer.attempts,
              inFlight: transfer.inFlight,
            })),
          })),
        }),
      { cause: error },
    );
  }
  const firstSos = observed.findIndex((f) => f.id === sos),
    lastSos = observed.findIndex(
      (f) => f.id === sos && f.index === f.count - 1,
    ),
    lastBulk = observed.findIndex(
      (f) => f.id === bulk && f.index === f.count - 1,
    );
  assert.ok(
    firstSos > 0 && firstSos - sosEnqueuedAtTurn <= 4,
    "SOS starts within one scheduling round of enqueue; bytes already written cannot be preempted",
  );
  assert.ok(
    lastSos < lastBulk,
    "SOS finishes before the in-progress bulk object",
  );
  const duringSos = observed.slice(firstSos, lastSos),
    bulkPositions = duringSos.flatMap((frame, index) =>
      frame.id === bulk ? [index] : [],
    );
  assert.ok(
    bulkPositions.length >= (options.minBulkTurns ?? 50),
    "bulk continues progressing while SOS is active",
  );
  for (let i = 1; i < bulkPositions.length; i++)
    assert.ok(
      bulkPositions[i] - bulkPositions[i - 1] <= 4,
      "bulk gets every fourth fragment while competing with SOS",
    );
  for (const [id, label, letter] of [
    [sos, "emergency", "s"],
    [bulk, "bulk", "b"],
  ]) {
    const parts = new Map(
      observed
        .filter((frame) => frame.id === id)
        .map((frame) => [frame.index, frame]),
    );
    assert.equal(parts.size, parts.get(0)!.count, "every fragment arrived");
    const received = JSON.parse(
      Buffer.concat(
        [...parts.values()]
          .sort((a, b) => a.index - b.index)
          .map((frame) => Buffer.from(frame.data, "base64")),
      ).toString(),
    );
    assert.deepEqual(received.payload, {
      label,
      data: letter.repeat(payloadBytes),
    });
    const { id: packetId, hops: _hops, ...body } = received;
    assert.equal(
      packetId,
      hash(canonical(body)),
      "assembled packet retains its exact content hash",
    );
  }
}

test("real TCP fragments preempt bulk for SOS while preserving bulk fairness", async () => {
  const router = new Router(),
    socket = await connect(router);
  try {
    await priorityControl(router, socket);
  } finally {
    socket.destroy();
    await router.stop();
  }
});

test("many in-progress SOS transfers leave admission capacity for bulk fairness", async () => {
  const router = new Router(),
    peer = await connect(router),
    started = new Set<string>();
  let bulk = "",
    bulkSeen = false,
    sosCompleted = false;
  parse(peer, (frame) => {
    if (frame.t !== "part") return;
    if (frame.id === bulk) bulkSeen = true;
    else {
      started.add(frame.id);
      sosCompleted ||= frame.index === frame.count - 1;
      if (started.size === 7 && !bulk)
        bulk = router.broadcast({ fair: true }, "bulk");
    }
  });
  try {
    for (let n = 0; n < 9; n++)
      router.broadcast({ n, data: "s".repeat(600_000) }, "sos");
    await until(() => bulkSeen);
    assert.ok(
      !sosCompleted,
      "bulk gets an assembly slot while SOS objects remain unfinished",
    );
  } finally {
    peer.destroy();
    await router.stop();
  }
});

test(
  "real serialport PTY fragments preempt bulk for SOS with the same fairness",
  { skip: process.platform === "win32", timeout: 60_000 },
  async () => {
    const bridge = spawn("python3", ["scripts/pty-bridge.py"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const paths: { left: string; right: string } = await new Promise(
      (resolve, reject) => {
        let output = "";
        bridge.stdout.on("data", (data) => {
          output += data;
          if (output.includes("\n")) resolve(JSON.parse(output.split("\n")[0]));
        });
        bridge.on("error", reject);
        bridge.once("exit", (code) =>
          reject(new Error("PTY bridge exited: " + code)),
        );
      },
    );
    let fixtureErrors = "";
    bridge.stderr.on("data", (data) => {
      fixtureErrors = (fixtureErrors + data.toString()).slice(-2000);
    });
    const router = new Router(),
      peer = new SerialPort({ path: paths.right, baudRate: 115200 });
    peer.on("error", () => {});
    try {
      if (!peer.isOpen) await once(peer, "open");
      router.connectSerial(paths.left);
      await until(() => router.peers.some((p) => p.medium === "serial"));
      // Two 64 KiB objects require about 16 seconds at 115200 baud, including
      // base64 and 8N1 overhead. Keep 2.5x headroom for host scheduling and PTYs.
      const payloadBytes = 64 * 1024;
      const estimatedWireBytes =
        2 *
        (Math.ceil((payloadBytes + 1024) / FRAGMENT) * 160 +
          Math.ceil(((payloadBytes + 1024) * 4) / 3));
      const timeoutMs = Math.max(
        30_000,
        Math.ceil(((estimatedWireBytes * 10) / 115200) * 2500),
      );
      await priorityControl(router, peer, {
        payloadBytes,
        timeoutMs,
        minBulkTurns: 8,
        fixtureErrors: () => fixtureErrors,
      });
    } finally {
      await closeSerial(peer);
      await router.stop();
      bridge.kill("SIGTERM");
      if (bridge.exitCode === null) await once(bridge, "exit");
    }
  },
);
