import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Router } from "../packages/transport/src/index.js";
import {
  preservePollerInterests,
  serialWriteDeadline,
} from "../packages/transport/src/serial.js";

class InterestPoller extends EventEmitter {
  armed = 0;
  poll(flags = 0) {
    this.armed = flags;
  }
  wait(event: "readable" | "writable", callback: () => void) {
    this.poll(event === "readable" ? 1 : 2);
    this.once(event, callback);
  }
  nativeReady(event: "readable" | "writable") {
    if (this.armed & (event === "readable" ? 1 : 2)) this.emit(event);
  }
}

test("POSIX poller regression: read rearm must preserve an outstanding write watch", () => {
  const broken = new InterestPoller();
  let brokenWrite = false;
  broken.wait("writable", () => {
    brokenWrite = true;
  });
  broken.wait("readable", () => {});
  broken.nativeReady("writable");
  assert.equal(
    brokenWrite,
    false,
    "negative control reproduces latest-interest replacement",
  );
  const fixed = new InterestPoller();
  let wrote = false,
    read = false;
  preservePollerInterests(fixed);
  preservePollerInterests(fixed);
  fixed.wait("writable", () => {
    wrote = true;
  });
  fixed.wait("readable", () => {
    read = true;
  });
  assert.equal(fixed.armed, 3);
  fixed.nativeReady("writable");
  fixed.nativeReady("readable");
  assert.ok(
    wrote && read,
    "both outstanding operations retain readiness delivery",
  );
  const reverse = new InterestPoller();
  preservePollerInterests(reverse);
  reverse.wait("readable", () => {});
  reverse.wait("writable", () => {});
  assert.equal(reverse.armed, 3);
});

test("serial write deadline covers one frame at configured baud while bounding a stalled writer", () => {
  assert.equal(serialWriteDeadline(2849, 115200), 5000);
  assert.ok(serialWriteDeadline(2849, 1200) > ((2849 * 10) / 1200) * 1000);
  assert.ok(serialWriteDeadline(4096, 1200) <= 120_000);
});

async function until(check: () => boolean, timeout = 12000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() >= end)
      throw new Error("serial recovery condition timed out");
    await delay(20);
  }
}

test(
  "real serial PTY recovers an injected stuck write through bounded reconnect and exact replay",
  { skip: process.platform === "win32", timeout: 20000 },
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
          reject(new Error("PTY bridge exited " + code)),
        );
      },
    );
    const sender = new Router(),
      receiver = new Router(),
      deliveries: any[] = [];
    receiver.on("payload", (payload) => deliveries.push(payload));
    try {
      sender.connectSerial(paths.left);
      receiver.connectSerial(paths.right);
      await until(
        () => sender.peers.length === 1 && receiver.peers.length === 1,
      );
      const first = [...sender.links][0],
        original = first.io.write;
      let writes = 0,
        injected = false;
      // Fault injection targets only this fixture's stream: emulate the unresolved
      // native write callback diagnosed in macOS CI, after a partial JSON frame.
      Object.defineProperty(first.io, "write", {
        configurable: true,
        value(...args: unknown[]) {
          if (++writes === 3) {
            injected = true;
            Reflect.apply(original, first.io, [
              String(args[0]).slice(0, 100),
              () => {},
            ]);
            return true;
          }
          return Reflect.apply(original, first.io, args);
        },
      });
      const bulk = {
        kind: "bulk",
        bytes: "exact serial recovery ".repeat(1800),
      };
      sender.broadcast(bulk, "bulk", 30_000);
      await until(() => injected && [...receiver.links][0].buffer.length > 0);
      assert.equal(deliveries.length, 0);
      sender.broadcast({ kind: "sos" }, "sos", 30_000);
      await until(() => deliveries.length === 2);
      assert.deepEqual(deliveries, [{ kind: "sos" }, bulk]);
      assert.ok(!first.active);
      assert.equal(first.pendingBytes, 0);
      assert.ok(
        sender.counters.dropped >= 1,
        "stalled frame hit its bounded deadline",
      );
      assert.ok(
        sender.peers.some(
          (peer) => peer.connected && peer.id !== first.state.id,
        ),
      );
      assert.equal(receiver.counters.received, 2);
    } finally {
      const exited =
        bridge.exitCode !== null || bridge.signalCode !== null
          ? Promise.resolve()
          : new Promise<void>((resolve) =>
              bridge.once("exit", () => resolve()),
            );
      const force = setTimeout(() => bridge.kill("SIGKILL"), 1000);
      bridge.kill("SIGTERM");
      try {
        await Promise.all([sender.stop(), receiver.stop(), exited]);
      } finally {
        clearTimeout(force);
      }
    }
  },
);
