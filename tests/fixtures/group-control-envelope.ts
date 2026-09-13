import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  canonical,
  createBundle,
  createIdentity,
  decryptBundle,
  verifyBundle,
  type Bundle,
} from "../../packages/core/src/index.js";
import { createAnchoredGroup } from "../../packages/groups/src/certificates.js";
import {
  CONTROL_LIMITS,
  sealGroupControl,
} from "../../packages/groups/src/carriers.js";
import { Router } from "../../packages/transport/src/index.js";
import { launch, password, until } from "../helpers.js";

export async function groupControlEnvelope(backend: "node" | "native") {
  const relay = await launch(undefined, 0, 0, backend);
  const source = new Router({ relay: false }),
    sink = new Router({ relay: false });
  const received = new Map<string, Bundle>();
  sink.on("payload", (p: any) => {
    if (p.type === "bundle") received.set(p.bundle.manifest.id, p.bundle);
  });
  try {
    await relay.call("setup", { name: "Opaque forwarder", password });
    const a = createIdentity("Control author"),
      b = createIdentity("Destination"),
      group = createAnchoredGroup(a, "Private group");
    source.connectTcp("127.0.0.1", relay.tcpPort);
    sink.connectTcp("127.0.0.1", relay.tcpPort);
    await until(
      async () => [...source.peers, ...sink.peers],
      (peers) => peers.length === 2 && peers.every((p) => p.connected),
    );
    const payload = {
      type: "group-control",
      version: 1,
      action: "headers",
      groupId: group.anchor.id,
      to: b.public.id,
      from: 0,
      headers: [group.epoch],
      head: group.epoch,
    } as const;
    const good = () =>
      sealGroupControl(a, { ...payload, headers: [...payload.headers] }, [
        b.public,
      ]);
    const sendGood = async () => {
      const bundle = good();
      source.broadcast({ type: "bundle", bundle });
      await until(async () => received.get(bundle.manifest.id), Boolean);
      assert.equal(
        canonical(received.get(bundle.manifest.id)),
        canonical(bundle),
      );
      verifyBundle(received.get(bundle.manifest.id)!);
      assert.equal((decryptBundle(bundle, b) as any).groupId, group.anchor.id);
      assert.ok(
        existsSync(
          join(relay.dir, "store", "objects", bundle.manifest.id + ".json"),
        ),
      );
    };
    await sendGood();
    const bad = [
      {
        name: "public",
        bundle: createBundle(
          a,
          "group-control",
          payload,
          "public",
          CONTROL_LIMITS.ttl,
        ),
      },
      {
        name: "excessive lifetime",
        bundle: createBundle(
          a,
          "group-control",
          payload,
          [b.public],
          CONTROL_LIMITS.ttl + 60000,
        ),
      },
      {
        name: "oversized opaque ciphertext",
        bundle: createBundle(
          a,
          "group-control",
          { ...payload, ignoredByOpaqueRelay: "x".repeat(1600000) },
          [b.public],
          CONTROL_LIMITS.ttl,
        ),
      },
    ];
    assert.ok(
      Buffer.byteLength(canonical(bad[2].bundle)) > CONTROL_LIMITS.bundle,
    );
    for (const { name, bundle } of bad) {
      verifyBundle(bundle); // Signed, decryptable input; policy must reject it.
      const before = (await relay.call("state")).counters.rejected;
      source.broadcast({ type: "bundle", bundle });
      await until(
        async () => ({
          forwarded: received.has(bundle.manifest.id),
          state: await relay.call("state"),
        }),
        ({ forwarded, state }) => forwarded || state.counters.rejected > before,
      );
      assert.equal(
        received.has(bundle.manifest.id),
        false,
        `${name} control crossed the opaque relay`,
      );
      assert.equal(
        existsSync(
          join(relay.dir, "store", "objects", bundle.manifest.id + ".json"),
        ),
        false,
        `${name} control persisted in relay cache`,
      );
      // Rejected packets have no success ACK. Cancel this fixture's retry so
      // its later rejection cannot satisfy the next case's negative control.
      source.cancelLocal(
        (p: any) =>
          p.type === "bundle" && p.bundle?.manifest.id === bundle.manifest.id,
      );
      await until(
        async () => source.peers,
        (peers) => peers.every((p) => p.queued === 0),
      );
      await sendGood(); // Each rejection preserves actual forwarding capability.
    }
    assert.deepEqual(
      (await relay.call("group-command", { action: "list" })).groups,
      [],
    );
    assert.equal(
      (await relay.call("state")).objects.some(
        (o: any) => o.kind === "group-control",
      ),
      false,
    );
  } finally {
    await source.stop();
    await sink.stop();
    await relay.stop();
    rmSync(relay.dir, { recursive: true, force: true });
  }
}
