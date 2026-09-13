import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  canonical,
  createBundle,
  createIdentity,
  verifyBundle,
  type Bundle,
} from "../../packages/core/src/index.js";
import {
  createAnchoredGroup,
  createGroupInvitation,
  acceptGroupInvitation,
  createGroupSuccessor,
} from "../../packages/groups/src/certificates.js";
import {
  CONTROL_LIMITS,
  openGroupControl,
  snapshotPreview,
} from "../../packages/groups/src/carriers.js";
import { launchOwned } from "./process-helper.js";

test(
  "Node and Go independently seal and reject the same private group-control vectors",
  { timeout: 90000 },
  async () => {
    mkdirSync(".cache/group-carriers", { recursive: true });
    const dir = mkdtempSync(resolve(".cache/group-carriers/vectors-"));
    const identities = [
      createIdentity("Criador"),
      createIdentity("Leitor"),
      createIdentity("Exterior"),
    ];
    const [a, b, c] = identities;
    const birth = createAnchoredGroup(a, "Node \ud800 vidro 😀");
    const invitation = createGroupInvitation(
      a,
      birth.anchor,
      birth.epoch,
      b.public,
    );
    const consent = acceptGroupInvitation(
      b,
      birth.anchor,
      birth.epoch,
      invitation,
    );
    const joined = createGroupSuccessor(
      a,
      birth.anchor,
      birth.epoch,
      birth.snapshot,
      {
        title: "Cadeia \ud800 e vidro 😀",
        members: [a.public, b.public],
        joins: [consent],
      },
    );
    const common = {
      type: "group-control",
      version: 1,
      groupId: birth.anchor.id,
    };
    const snapshot = {
      ...common,
      action: "snapshot",
      epoch: joined.epoch,
      snapshot: joined.snapshot,
    };
    const headers = {
      ...common,
      action: "headers",
      to: a.public.id,
      from: 0,
      headers: [birth.epoch, joined.epoch],
      head: joined.epoch,
    };
    type Vector = {
      name: string;
      payload: any;
      signer: number;
      readers: number[];
      viewer: number;
      accepted: boolean;
      public?: boolean;
      kind?: string;
      ttl?: number;
      corrupt?: boolean;
      stage?: "snapshot";
    };
    const base = { signer: 1, readers: [0], viewer: 0 };
    const vectors: Vector[] = [
      {
        ...base,
        name: "reader-transports-creator-proof",
        payload: snapshot,
        accepted: true,
        stage: "snapshot",
      },
      {
        ...base,
        name: "directed-snapshot",
        payload: { ...snapshot, to: a.public.id },
        accepted: true,
        stage: "snapshot",
      },
      { ...base, name: "header-page", payload: headers, accepted: true },
      {
        ...base,
        name: "bad-tail-preserved-for-fence",
        payload: { ...headers, headers: [birth.epoch, { bad: "tail" }] },
        accepted: true,
      },
      {
        ...base,
        name: "invitation-request",
        payload: {
          ...common,
          action: "headers-request",
          to: a.public.id,
          from: 0,
          count: 16,
          authorization: { number: 0, id: birth.epoch.id, invitation },
        },
        accepted: true,
      },
      {
        ...base,
        name: "snapshot-request",
        payload: {
          ...common,
          action: "snapshot-request",
          to: a.public.id,
          number: 1,
          epochId: joined.epoch.id,
        },
        accepted: true,
      },
      {
        ...base,
        name: "reader-forges-roster",
        payload: {
          ...snapshot,
          snapshot: { ...joined.snapshot, title: "Forjado" },
        },
        accepted: false,
        stage: "snapshot",
      },
      {
        ...base,
        name: "extra-snapshot-reader",
        payload: snapshot,
        readers: [0, 2],
        accepted: false,
        stage: "snapshot",
      },
      {
        ...base,
        name: "extra-directed-reader",
        payload: headers,
        readers: [0, 2],
        accepted: false,
      },
      {
        ...base,
        name: "outsider-signature-is-not-membership",
        payload: snapshot,
        signer: 2,
        readers: [0, 1],
        accepted: false,
        stage: "snapshot",
      },
      {
        ...base,
        name: "public-control",
        payload: headers,
        public: true,
        accepted: false,
      },
      {
        ...base,
        name: "wrong-kind",
        payload: headers,
        kind: "message",
        accepted: false,
      },
      {
        ...base,
        name: "seventeenth-header",
        payload: { ...headers, headers: Array(17).fill(birth.epoch) },
        accepted: false,
      },
      {
        ...base,
        name: "oversized-snapshot",
        payload: { ...snapshot, snapshot: { text: "x".repeat(524289) } },
        accepted: false,
        stage: "snapshot",
      },
      {
        ...base,
        name: "fractional-request",
        payload: {
          ...common,
          action: "snapshot-request",
          to: a.public.id,
          number: 1.5,
          epochId: joined.epoch.id,
        },
        accepted: false,
      },
      {
        ...base,
        name: "unknown-field",
        payload: { ...headers, script: "no" },
        accepted: false,
      },
      {
        ...base,
        name: "null-destination",
        payload: { ...snapshot, to: null },
        accepted: false,
        stage: "snapshot",
      },
      {
        ...base,
        name: "corrupt-ciphertext",
        payload: headers,
        corrupt: true,
        accepted: false,
      },
    ];
    const accepts = (bundle: Bundle, v: Vector) => {
      try {
        const payload = openGroupControl(bundle, identities[v.viewer]);
        if (v.stage === "snapshot") {
          assert.equal(payload.action, "snapshot");
          if (payload.action !== "snapshot") return false;
          const checked = snapshotPreview(bundle, payload, birth.anchor);
          assert.equal(checked.epoch.signature, joined.epoch.signature);
          assert.equal(canonical(checked.snapshot), canonical(joined.snapshot));
        }
        return true;
      } catch {
        return false;
      }
    };
    try {
      const cases = vectors.map((v) => {
        const bundle = createBundle(
          identities[v.signer],
          v.kind ?? "group-control",
          v.payload,
          v.public ? "public" : v.readers.map((i) => identities[i].public),
          v.ttl ?? CONTROL_LIMITS.ttl,
        );
        verifyBundle(bundle); // Negative inputs start as real signed ciphertext.
        if (v.corrupt) {
          const id = Object.keys(bundle.chunks)[0];
          const bytes = Buffer.from(bundle.chunks[id], "base64");
          bytes[0] ^= 1;
          bundle.chunks[id] = bytes.toString("base64");
        }
        assert.equal(accepts(bundle, v), v.accepted, `Node: ${v.name}`);
        return {
          ...v,
          public: v.public ?? false,
          kind: v.kind ?? "group-control",
          ttl: v.ttl ?? CONTROL_LIMITS.ttl,
          corrupt: v.corrupt ?? false,
          stage: v.stage ?? "open",
          bundle,
        };
      });
      const input = join(dir, "input.json");
      writeFileSync(
        input,
        canonical({ identities, anchor: birth.anchor, cases }),
        { mode: 0o600 },
      );
      const child = launchOwned(
        process.execPath,
        [
          "scripts/go.mjs",
          "test",
          "-race",
          "-count=1",
          "-timeout=45s",
          "-p=1",
          "./groupcontrol",
          "-run",
          "^TestControlInteropFixture$",
        ],
        {
          env: { ...process.env, RELAYLOOM_CONTROL_VECTORS: input },
        },
      );
      const result = await child.done;
      assert.equal(result.timedOut, false, result.output);
      assert.equal(result.code, 0, result.output);
      const output = JSON.parse(readFileSync(join(dir, "output.json"), "utf8"));
      assert.equal(output.length, vectors.length);
      for (let i = 0; i < vectors.length; i++) {
        assert.equal(output[i].name, vectors[i].name);
        assert.equal(
          output[i].nodeAccepted,
          vectors[i].accepted,
          `Go opening Node: ${vectors[i].name}`,
        );
        assert.equal(
          output[i].goAccepted,
          vectors[i].accepted,
          `Go self: ${vectors[i].name}`,
        );
        assert.equal(
          accepts(output[i].bundle, vectors[i]),
          vectors[i].accepted,
          `Node opening Go: ${vectors[i].name}`,
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
