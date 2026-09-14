import { test } from "node:test";
import assert from "node:assert/strict";
import { Duplex } from "node:stream";
import { Router } from "../packages/transport/src/index.js";

test(
  "new small-message arrivals cannot repeatedly take the bulk fairness turn",
  { timeout: 5000 },
  async () => {
    const router = new Router();
    const observed: { id: string; index: number; count: number }[] = [];
    let finish!: () => void;
    const completed = new Promise<void>((resolve) => (finish = resolve));
    const stream = new Duplex({
      read() {},
      write(data, _encoding, callback) {
        const frame = JSON.parse(data.toString());
        if (frame.t === "part") {
          observed.push(frame);
          if (frame.index === frame.count - 1)
            this.push(JSON.stringify({ t: "ack", id: frame.id }) + "\n");
          if (observed.length < 120)
            router.broadcast({ arriving: observed.length }, "normal");
          else finish();
        }
        setImmediate(callback);
      },
    });
    router.attachStream(stream, "websocket", "fixture");
    try {
      const bulk = router.broadcast({ bytes: "x".repeat(80_000) }, "bulk");
      await completed;
      const bulkTurns = observed.slice(0, 120).filter((f) => f.id === bulk);
      assert.ok(
        bulkTurns.length >= 29,
        `bulk received ${bulkTurns.length} of 120 turns`,
      );
      assert.ok(
        observed.some((f) => f.id !== bulk),
        "the small-message stream also progresses",
      );
    } finally {
      await router.stop();
    }
  },
);
