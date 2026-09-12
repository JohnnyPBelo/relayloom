import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { LoomNode } from "../apps/node/src/node.js";
import {
  admitOutbox,
  isPending,
  OUTBOX_LIMITS,
  validateOutbox,
} from "../apps/node/src/outbox.js";
import {
  canonical,
  createBundle,
  createIdentity,
} from "../packages/core/src/index.js";

const password = "durable outbox integration passphrase";
function fixture(t: any, name = "Sender") {
  mkdirSync(".cache", { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".cache/outbox-"));
  const node = new LoomNode(dir);
  const owned = [node];
  const track = (next: LoomNode) => {
    owned.push(next);
    return next;
  };
  node.setup(name, password);
  t.after(async () => {
    for (const current of owned) await current.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const b = createIdentity("Recipient B"),
    c = createIdentity("Recipient C");
  node.addContact(b.public);
  node.addContact(c.public);
  return { node, b, c, dir, track };
}

test("offline send is encrypted, pinned, idempotent and recovers the same operation after restart", async (t) => {
  const { node, b, dir, track } = fixture(t),
    operationId = randomUUID(),
    content = { type: "message", text: "Pending private message" };
  node.settings({ relay: false });
  const sent = node.send(operationId, content, [b.public.id]);
  assert.equal(sent.accepted, true);
  assert.equal(sent.outbox.status, "pending");
  assert.equal(sent.outbox.attempts, 0);
  assert.equal(node.store.isPinned(sent.id), true);
  assert.deepEqual(node.send(operationId, content, [b.public.id]), sent);
  assert.throws(
    () =>
      node.send(operationId, { ...content, text: "Different message" }, [
        b.public.id,
      ]),
    /outro envio/,
  );
  assert.equal(node.store.stats().count, 1);
  assert.throws(() => node.localAction("pin", sent.id, false), /reservado/);
  const local = readFileSync(join(dir, "private-state.json"), "utf8");
  assert.equal(local.includes(content.text), false);
  assert.equal(local.includes(operationId), false);
  node.lock();
  assert.deepEqual(node.state().outbox, []);
  assert.throws(() => node.retryOutbox(operationId));
  await node.stop();
  const resumed = track(new LoomNode(dir));
  assert.deepEqual(resumed.state().outbox, []);
  resumed.unlock(password);
  assert.equal(resumed.config.relay, false);
  assert.equal(resumed.send(operationId, content, [b.public.id]).id, sent.id);
  assert.equal(resumed.store.stats().count, 1);
  assert.equal(resumed.state().outbox[0].status, "pending");
});

test("preparing journal reconciles surviving exact bytes and never regenerates missing content", async (t) => {
  const { node, b, dir, track } = fixture(t),
    content = { type: "message", text: "Atomic interval" };
  const persist = (node as any).persistPrivate.bind(node);
  let writes = 0;
  (node as any).persistPrivate = (next: unknown) => {
    if (++writes === 2) throw new Error("injected second journal failure");
    persist(next);
  };
  const op = randomUUID();
  assert.throws(() => node.send(op, content, [b.public.id]), /injected/);
  assert.equal(node.store.stats().count, 1);
  (node as any).persistPrivate = persist;
  const recovered = node.send(op, content, [b.public.id]);
  assert.equal(recovered.accepted, true);
  assert.equal(recovered.outbox.attempts, 0);
  const put = node.store.put.bind(node.store);
  node.store.put = () => {
    throw new Error("injected storage failure");
  };
  const missingOp = randomUUID();
  assert.throws(() => node.send(missingOp, content, [b.public.id]), /injected/);
  node.store.put = put;
  const unavailable = node.send(missingOp, content, [b.public.id]);
  assert.equal(unavailable.accepted, false);
  assert.equal(unavailable.outbox.status, "unavailable");
  assert.equal(node.retryOutbox(missingOp).id, unavailable.id);
  assert.equal(node.store.stats().count, 1);
  assert.equal(
    readdirSync(dir).some((f) => f.endsWith(".tmp")),
    false,
  );
});

test("transport rejection after local acceptance stays pending and cannot crash periodic sync", async (t) => {
  const { node, b } = fixture(t);
  // Only the failure boundary is injected here; actual network/ACK controls live in the process suite.
  Object.defineProperty(node.router, "peers", {
    configurable: true,
    get: () => [{ connected: true }],
  });
  node.router.broadcast = () => {
    throw new Error("injected retention capacity");
  };
  const sent = node.send(
    randomUUID(),
    { type: "message", text: "Capacity pressure" },
    [b.public.id],
  );
  assert.equal(sent.accepted, true);
  assert.equal(sent.outbox.status, "pending");
  assert.equal(sent.outbox.attempts, 1);
  assert.ok(sent.outbox.lastError.length);
  assert.doesNotThrow(() => node.sync());
  assert.equal(node.state().outbox[0].attempts, 1);
});

test("per-reader signed delivery/read confirmations survive paging, replay, eviction and restart", async (t) => {
  const { node, b, c, dir, track } = fixture(t),
    owner = node.identity!;
  const sent = node.send(
    randomUUID(),
    { type: "message", text: "Three readers" },
    [b.public.id, c.public.id],
  );
  const cards = [owner.public, b.public, c.public];
  const deliveryB = createBundle(
    b,
    "delivery",
    { type: "delivery", target: sent.id },
    cards,
  );
  node.store.put(deliveryB);
  let item = node.state().outbox[0];
  assert.equal(item.receivedCount, 1);
  assert.equal(item.readCount, 0);
  assert.equal(item.status, "pending");
  const observed = item.recipients.find(
    (r) => r.id === b.public.id,
  )!.receivedAt;
  node.store.put(deliveryB);
  node.state();
  node.store.put(
    createBundle(b, "delivery", { type: "delivery", target: sent.id }, cards),
  );
  assert.equal(
    node.state().outbox[0].recipients.find((r) => r.id === b.public.id)!
      .receivedAt,
    observed,
  );
  node.store.put(
    createBundle(c, "receipt", { type: "receipt", target: sent.id }, cards),
  );
  item = node.state().outbox[0];
  assert.equal(item.status, "received");
  assert.equal(item.readCount, 1);
  assert.equal(node.store.isPinned(sent.id), false);
  node.store.put(
    createBundle(b, "receipt", { type: "receipt", target: sent.id }, cards),
  );
  for (let i = 0; i < 105; i++)
    node.publish({ type: "post", text: `Unrelated ${i}` }, "public");
  assert.equal(
    node.state().objects.some((o) => o.id === sent.id),
    false,
  );
  item = node.state().outbox[0];
  assert.equal(item.status, "read");
  assert.equal(item.readCount, 2);
  for (const manifest of node.store
    .list()
    .filter((m) => ["receipt", "delivery"].includes(m.kind)))
    node.store.remove(manifest.id);
  await node.stop();
  const resumed = track(new LoomNode(dir));
  resumed.unlock(password);
  assert.deepEqual(resumed.state().outbox[0], item);
});

test("public, foreign-author and wrong-reader confirmations cannot advance a durable send", async (t) => {
  const { node, b, c } = fixture(t),
    owner = node.identity!;
  const sent = node.send(
    randomUUID(),
    { type: "message", text: "Actual target" },
    [b.public.id],
  );
  const fixtures = [
    createBundle(
      b,
      "delivery",
      { type: "delivery", target: sent.id },
      "public",
    ),
    createBundle(c, "delivery", { type: "delivery", target: sent.id }, [
      owner.public,
      b.public,
      c.public,
    ]),
    createBundle(owner, "receipt", { type: "receipt", target: sent.id }, [
      owner.public,
      b.public,
    ]),
    createBundle(b, "delivery", { type: "delivery", target: "f".repeat(64) }, [
      owner.public,
      b.public,
    ]),
  ];
  for (const bundle of fixtures) node.store.put(bundle);
  assert.equal(node.state().outbox[0].receivedCount, 0);
  assert.equal(node.state().outbox[0].status, "pending");
  const valid = createBundle(
    b,
    "delivery",
    { type: "delivery", target: sent.id },
    [owner.public, b.public],
  );
  const damaged = structuredClone(valid);
  damaged.manifest.signature = "AAAA";
  assert.throws(() => node.store.put(damaged));
  node.store.put(valid);
  assert.equal(node.state().outbox[0].status, "received");
});

test("expiry remains visible after payload removal and explicit user pin is preserved", async (t) => {
  const { node, b } = fixture(t);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const sent = node.send(
    randomUUID(),
    { type: "message", text: "Short lifetime" },
    [b.public.id],
    1000,
  );
  const manual = node.send(
    randomUUID(),
    { type: "message", text: "Explicitly retained" },
    [b.public.id],
    1000,
  );
  node.localAction("pin", manual.id, true);
  t.mock.timers.tick(1100);
  const item = node.state().outbox[0];
  assert.equal(item.status, "expired");
  assert.equal(item.retained, false);
  assert.equal(node.store.isPinned(sent.id), false);
  assert.equal(node.store.isPinned(manual.id), true);
  assert.equal(node.store.stats().count, 1);
  node.lock();
  node.unlock(password);
  assert.equal(node.state().outbox[0].status, "expired");
});

test("corrupted reserved bytes become unavailable without a new signed publication", async (t) => {
  const { node, b, dir, track } = fixture(t),
    op = randomUUID(),
    content = { type: "message", text: "Original bytes" };
  const sent = node.send(op, content, [b.public.id]);
  const file = join(dir, "store", "objects", sent.id + ".json");
  const bundle = JSON.parse(readFileSync(file, "utf8"));
  bundle.manifest.signature = "AAAA";
  writeFileSync(file, canonical(bundle));
  assert.equal(node.state().outbox[0].status, "unavailable");
  assert.equal(node.send(op, content, [b.public.id]).id, sent.id);
  assert.equal(node.store.stats().count, 0);
});

test("blocked incomplete sends retain bounded reservation; blocked group readers do not break viewing", async (t) => {
  const { node, b, c } = fixture(t),
    owner = node.identity!;
  const group = node.publish({ type: "group", title: "Fixed group" }, [
    b.public.id,
    c.public.id,
  ]);
  const sent = node.send(
    randomUUID(),
    {
      type: "message",
      conversation: group.id,
      text: "Group bytes",
      attachments: [
        {
          name: "group.txt",
          mime: "text/plain",
          data: Buffer.from("group payload").toString("base64"),
        },
      ],
    },
    [b.public.id, c.public.id],
  );
  node.localAction("block", c.public.id, true);
  assert.equal(node.state().outbox[0].status, "blocked");
  assert.equal(node.state().outbox[0].retained, true);
  assert.throws(() => node.localAction("pin", sent.id, false), /reservado/);
  const receiver = fixture(t, "Receiver").node;
  // A fresh, separately encrypted receiver identity is included in a valid group.
  node.localAction("block", c.public.id, false);
  node.addContact(receiver.identity!.public);
  const groupReaders = [
    node.identity!.public,
    receiver.identity!.public,
    c.public,
  ];
  const foreignGroup = createBundle(
    c,
    "group",
    {
      type: "group",
      title: "Read despite suppressed receipts",
      members: groupReaders,
    },
    groupReaders,
  );
  node.store.put(foreignGroup);
  const rg = { id: foreignGroup.manifest.id };
  const msg = node.publish(
    {
      type: "message",
      conversation: rg.id,
      text: "Allowed author",
      attachments: [
        {
          name: "group.txt",
          mime: "text/plain",
          data: Buffer.from("group payload").toString("base64"),
        },
      ],
    },
    [receiver.identity!.public.id, c.public.id],
  );
  receiver.store.put(node.store.get(rg.id));
  receiver.store.put(node.store.get(msg.id));
  receiver.localAction("block", c.public.id, true);
  assert.equal(
    receiver.objects().some((o) => o.id === rg.id),
    false,
  );
  assert.equal(
    receiver.objects().some((o) => o.id === msg.id),
    true,
  );
  assert.throws(() => receiver.view(rg.id));
  assert.equal(
    Buffer.from(receiver.attachment(msg.id, 0).data, "base64").toString(),
    "group payload",
  );
  receiver.sync();
  assert.equal(
    receiver
      .objects()
      .some(
        (o) =>
          ["delivery", "receipt"].includes(o.kind) &&
          o.author.id === receiver.identity!.public.id,
      ),
    false,
  );
});

test("pending count/byte reservations and restored metadata ownership are bounded", async (t) => {
  const { node, b } = fixture(t),
    sent = node.send(randomUUID(), { type: "message", text: "Bounded" }, [
      b.public.id,
    ]);
  const first = (node as any).privateState.outbox[sent.outbox.operationId];
  let records = {};
  for (let i = 0; i < OUTBOX_LIMITS.pending; i++) {
    const entry = {
      ...structuredClone(first),
      operationId: randomUUID(),
      id: i.toString(16).padStart(64, "0"),
    };
    records = admitOutbox(records, entry, Date.now());
  }
  assert.throws(() => admitOutbox(records, first, Date.now()), /cheia/);
  assert.equal(
    Object.values(validateOutbox(records, node.identity!.public.id)).length,
    128,
  );
  assert.throws(() => validateOutbox(records, b.public.id));
  const oversized = structuredClone(records) as any;
  for (const e of Object.values(oversized) as any[]) e.bytes = 6 * 1024 * 1024;
  assert.throws(
    () => validateOutbox(oversized, node.identity!.public.id),
    /Reserva/,
  );
  assert.equal(isPending(first, Date.now()), true);
});

test(
  "an error after journal rename reads back the operation instead of signing a replacement",
  {
    skip:
      process.platform === "win32"
        ? "Directory fsync is not portable on Node Windows; process recovery is tested separately."
        : false,
  },
  async (t) => {
    const { node, b } = fixture(t),
      operationId = randomUUID(),
      content = { type: "message", text: "Uncertain rename" };
    const originalSync = fs.fsyncSync;
    let injected = false;
    const mocked = t.mock.method(fs, "fsyncSync", (fd: number) => {
      if (!injected && fs.fstatSync(fd).isDirectory()) {
        injected = true;
        throw new Error("injected failure after rename");
      }
      originalSync(fd);
    });
    syncBuiltinESMExports();
    try {
      assert.throws(
        () => node.send(operationId, content, [b.public.id]),
        /after rename/,
      );
      assert.equal(injected, true);
      const storedId = (node as any).privateState.outbox[operationId].id;
      const retry = node.send(operationId, content, [b.public.id]);
      assert.equal(retry.id, storedId);
      assert.equal(retry.accepted, false);
      assert.equal(retry.outbox.status, "unavailable");
      assert.equal(node.store.stats().count, 0);
    } finally {
      mocked.mock.restore();
      syncBuiltinESMExports();
    }
  },
);

test("incoming read confirmation is journalled before its admission evicts the original", async (t) => {
  const { node, b } = fixture(t),
    owner = node.identity!;
  const sent = node.send(
    randomUUID(),
    { type: "message", text: "x".repeat(5000) },
    [b.public.id],
  );
  const cards = [owner.public, b.public];
  (node as any).receive(
    {
      type: "bundle",
      bundle: createBundle(
        b,
        "delivery",
        { type: "delivery", target: sent.id },
        cards,
      ),
    },
    { medium: "fixture" },
  );
  assert.equal(node.state().outbox[0].status, "received");
  assert.equal(node.store.isPinned(sent.id), false);
  node.store.quota = node.store.stats().bytes;
  (node as any).receive(
    {
      type: "bundle",
      bundle: createBundle(
        b,
        "receipt",
        { type: "receipt", target: sent.id },
        cards,
      ),
    },
    { medium: "fixture" },
  );
  assert.equal(node.store.has(sent.id), false);
  const item = node.state().outbox[0];
  assert.equal(item.readCount, 1);
  assert.equal(item.status, "read");
  assert.equal(item.accepted, false);
  assert.equal(item.retained, false);
});

test("read confirmation uses the signed roster when contact learning fails and can be reissued after eviction", async (t) => {
  const receiver = fixture(t, "Reader").node,
    sender = createIdentity("Unknown sender");
  const me = receiver.identity!.public,
    members = [sender.public, me];
  const message = createBundle(
    sender,
    "message",
    {
      type: "message",
      text: "Read without address-book write",
      members,
      conversation:
        "dm:" +
        (await import("../packages/core/src/index.js")).hash(
          members
            .map((c) => c.id)
            .sort()
            .join(":"),
        ),
      attachments: [
        {
          name: "bytes.txt",
          mime: "text/plain",
          data: Buffer.from("readable").toString("base64"),
        },
      ],
    },
    members,
  );
  receiver.store.put(message);
  (receiver as any).saveConfig = () => {
    throw new Error("injected address-book storage failure");
  };
  assert.equal(
    Buffer.from(
      receiver.attachment(message.manifest.id, 0).data,
      "base64",
    ).toString(),
    "readable",
  );
  let receipts = receiver
    .objects()
    .filter(
      (o) => o.kind === "receipt" && o.content.target === message.manifest.id,
    );
  assert.equal(receipts.length, 1);
  receiver.store.remove(receipts[0].id);
  receiver.view(message.manifest.id);
  receipts = receiver
    .objects()
    .filter(
      (o) => o.kind === "receipt" && o.content.target === message.manifest.id,
    );
  assert.equal(receipts.length, 1);
});

test("saved peer connection remains idempotent at capacity without opening another connection", async (t) => {
  const { node } = fixture(t);
  node.config.peers = Array.from({ length: 16 }, (_, i) => ({
    host: "127.0.0.1",
    port: 20000 + i,
  }));
  node.router.connectTcp = () => {
    throw new Error("No sockets should open in this capacity fixture");
  };
  assert.doesNotThrow(() => node.connect("127.0.0.1", 20000));
  assert.throws(() => node.connect("127.0.0.1", 21000), /Limite/);
  assert.equal(node.config.peers.length, 16);
});

for (const responseKind of ["state", "send", "retry"] as const) {
  test(`snapshot crossing expiry during journal persistence keeps ${responseKind} and reservation consistent`, (t) => {
    const { node, b } = fixture(t);
    const operationId = randomUUID();
    const content = { type: "message", text: "Expiry at snapshot boundary" };
    const sent = node.send(operationId, content, [b.public.id], 1500);
    const persist = (node as any).persistPrivate.bind(node);
    const preparing = structuredClone((node as any).privateState);
    preparing.outbox[operationId].phase = "preparing";
    persist(preparing);
    const expires = preparing.outbox[operationId].expires;
    assert.ok(
      Date.now() < expires,
      "fixture remains unexpired at snapshot entry",
    );
    let crossedDeadline = false;
    (node as any).persistPrivate = (next: any) => {
      if (next.outbox[operationId].phase === "ready" && !crossedDeadline) {
        Atomics.wait(
          new Int32Array(new SharedArrayBuffer(4)),
          0,
          0,
          Math.max(0, expires - Date.now() + 25),
        );
        crossedDeadline = true;
      }
      persist(next);
    };
    try {
      const entry =
        responseKind === "state"
          ? node.state().outbox[0]
          : responseKind === "send"
            ? node.send(operationId, content, [b.public.id], 1500).outbox
            : node.retryOutbox(operationId).outbox;
      assert.ok(
        crossedDeadline && Date.now() > expires,
        "real journal transition crossed the content expiry",
      );
      assert.equal(
        entry.status === "expired" && node.store.isPinned(sent.id),
        false,
        "response must release automatic reservation before advertising expiry",
      );
    } finally {
      (node as any).persistPrivate = persist;
    }
    const current = node.state();
    assert.equal(current.outbox[0].status, "expired");
    assert.equal(node.store.isPinned(sent.id), false);
    assert.equal(current.outbox[0].id, sent.id);
    assert.equal(current.outbox[0].receivedCount, 0);
  });
}
