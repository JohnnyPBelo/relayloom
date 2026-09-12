import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { LoomNode } from "../apps/node/src/node.js";
import { createIdentity } from "../packages/core/src/index.js";
import { randomUUID } from "node:crypto";

function fixture(t: any) {
  const root = resolve(".cache/profile-runtime");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, "case-"));
  const nodes: LoomNode[] = [];
  t.after(async () => {
    for (const node of nodes) await node.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir,
    open: () => {
      const node = new LoomNode(dir);
      nodes.push(node);
      return node;
    },
  };
}
test("runtime owns the profile through transport shutdown and rejects stale writes after recovery", async (t) => {
  const f = fixture(t),
    first = f.open(),
    password = "profile ownership recovery passphrase";
  first.setup("Alice", password);
  await first.start();
  const recipient = createIdentity("Bruno");
  first.addContact(recipient.public);
  const operation = randomUUID(),
    original = first.send(
      operation,
      { type: "message", text: "Durable pending message" },
      [recipient.public.id],
    );
  assert.throws(() => f.open(), /perfil.*aberto/);
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
      release = resolve;
    }),
    stopRouter = first.router.stop.bind(first.router);
  first.router.stop = async () => {
    await waiting;
    await stopRouter();
  };
  const closing = first.stop();
  try {
    assert.equal(
      first.stop(),
      closing,
      "concurrent stop callers await the same completion",
    );
    assert.throws(() => f.open(), /perfil.*aberto/);
  } finally {
    release();
  }
  await closing;
  const second = f.open();
  second.unlock(password);
  assert.equal(
    second.send(
      operation,
      { type: "message", text: "Durable pending message" },
      [recipient.public.id],
    ).id,
    original.id,
  );
  const privateBefore = readFileSync(join(f.dir, "private-state.json"));
  assert.throws(() => first.unlock(password), /encerrado/);
  assert.throws(() => first.setup("Stale", password), /encerrado/);
  assert.throws(() => first.settings({ relay: false }), /encerrado/);
  assert.throws(() => first.state(), /encerrado/);
  await assert.rejects(first.start(), /encerrado/);
  first.sync();
  assert.deepEqual(
    readFileSync(join(f.dir, "private-state.json")),
    privateBefore,
  );
});
test("constructor failure releases ownership without resetting the existing profile", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.dir, "config.json"), "invalid-json");
  assert.throws(() => f.open());
  assert.equal(
    readFileSync(join(f.dir, "config.json"), "utf8"),
    "invalid-json",
  );
  rmSync(join(f.dir, "config.json"));
  const node = f.open();
  await node.stop();
});
