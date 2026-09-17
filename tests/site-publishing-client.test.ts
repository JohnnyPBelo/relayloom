import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { launch, password, until, type Client } from "./helpers";
import { createIdentity } from "../packages/core/src/index";
import { siteAddress } from "../packages/sites/src/protocol";
import {
  SitePublisher,
  contextFor,
  draftBody,
  type PublishingSession,
} from "../apps/web/src/site/publishing";
import type { StudioValue } from "../apps/web/src/site/model";
import type { API } from "../apps/web/src/api";
const value = (title: string): StudioValue => ({
  theme: "sand",
  attachments: [],
  site: {
    version: 1,
    title,
    description: "Actual application storage",
    home: "home",
    design: {
      font: "sans",
      width: "standard",
      radius: "soft",
      accent: "#207a70",
    },
    pages: [
      {
        id: "home",
        slug: "inicio",
        title: "Início",
        blocks: [{ id: "body", type: "text", title: "Texto", body: title }],
      },
    ],
  },
});
async function fixture(backend: "node" | "native") {
  const clients: Client[] = [],
    publishers: SitePublisher[] = [];
  let client = await launch(undefined, 0, 0, backend);
  clients.push(client);
  const owner = await client.call("setup", {
      name: "Site editor owner",
      password,
    }),
    address = siteAddress(owner.id, "profile");
  let nextRequest = 0;
  // These controllers can otherwise make more than 60 artificial user actions
  // per second. Pace the fixture; never retry mutations or weaken the server limit.
  const api: API = async (path, body) => {
    const now = Date.now(),
      start = Math.max(now, nextRequest);
    nextRequest = start + 25;
    if (start > now)
      await new Promise((resolve) => setTimeout(resolve, start - now));
    return client.call(path, body);
  };
  async function publisher(
    override: API = api,
    stored = false,
    active = () => true,
  ) {
    const catalog = await api("site-command", { action: "state", address }),
      draft = stored ? await api("site-draft-load", {}) : null;
    let session: PublishingSession = {
      catalog,
      editing: draft?.editing ?? contextFor(owner.id, catalog),
    };
    const p = new SitePublisher(override, owner.id, session, active, (next) => {
      session = next;
    });
    publishers.push(p);
    return p;
  }
  return {
    owner,
    address,
    api,
    publisher,
    get client() {
      return client;
    },
    async restart() {
      await client.stop();
      client = await launch(client.dir, 0, 0, backend);
      clients.push(client);
      await client.call("unlock", { password });
    },
    async close() {
      for (const p of publishers) p.close();
      for (const c of clients) await c.stop();
      for (const dir of new Set(clients.map((c) => c.dir)))
        rmSync(dir, { recursive: true, force: true });
    },
  };
}
for (const backend of ["node", "native"] as const) {
  test(
    `${backend} editor keeps one publication after a lost response and process restart; private version recovery preserves readers`,
    { timeout: 60000 },
    async () => {
      const f = await fixture(backend);
      try {
        const reader = createIdentity("Private page reader");
        await f.api("contact", { contact: reader.public });
        let lose = true,
          publishCalls = 0;
        const unreliable: API = async (path, body: any) => {
          const result = await f.api(path, body);
          if (path === "site-command" && body?.action === "publish") {
            publishCalls++;
            if (lose) {
              lose = false;
              throw Error("fixture: lost publication response after commit");
            }
          }
          return result;
        };
        const p = await f.publisher(unreliable);
        p.configure([reader.public.id], 86400_000);
        await p.save(value("Private first edition"));
        await assert.rejects(() => p.publish(value("Private first edition")));
        const saved = await f.api("site-draft-load", {}),
          handle = saved.editing.pending;
        assert.ok(handle?.operationId);
        assert.deepEqual(saved.editing.recipients, [reader.public.id]);
        assert.equal(saved.editing.ttlMs, 86400_000);
        assert.throws(() => p.configure("public", 86400_000));
        const first = await f.api("site-command", {
          action: "resolve",
          address: f.address,
        });
        assert.equal(first.status, "available");
        assert.equal(first.object.public, false);
        await f.restart();
        const recovered = await f.publisher(unreliable, true);
        const replay = await recovered.publish(value("Private first edition"));
        assert.equal(replay.operation.bundleId, first.object.id);
        assert.equal(publishCalls, 1);
        assert.equal(
          (
            await f.api("site-command", {
              action: "history",
              address: f.address,
            })
          ).revisions.length,
          1,
        );
        const readyDraft = await f.api("site-draft-load", {});
        assert.equal(readyDraft.editing.pending, undefined);
        assert.equal(readyDraft.editing.sequence, 2);
        recovered.configure("public", 86400_000);
        await recovered.publish(value("Public second edition"));
        assert.equal(publishCalls, 2);
        const current = await f.api("site-command", {
          action: "state",
          address: f.address,
        });
        const restored = await recovered.recoveryValue(
          first.object,
          current.base,
        );
        assert.equal(restored.site.title, "Private first edition");
        assert.deepEqual(recovered.snapshot().editing!.recipients, [
          reader.public.id,
        ]);
        assert.equal(
          (await f.api("site-command", { action: "state", address: f.address }))
            .number,
          2,
        );
        await recovered.publish(restored);
        const final = await f.api("site-command", {
          action: "resolve",
          address: f.address,
        });
        assert.equal(final.state.number, 3);
        assert.equal(final.object.public, false);
        assert.equal(final.object.content.site.title, "Private first edition");
        assert.equal(final.object.author.id, f.owner.id);
        const protectedDraft = await f.api("site-draft-load", {});
        await assert.rejects(() =>
          f.api("site-draft", {
            ...draftBody(restored),
            editing: {
              ...protectedDraft.editing,
              address: siteAddress(reader.public.id, "profile"),
            },
          }),
        );
        assert.deepEqual(await f.api("site-draft-load", {}), protectedDraft);
      } finally {
        await f.close();
      }
    },
  );
  test(
    `${backend} editor rejects stale and changed review bases, and can close a consumed competing attempt without claiming cancellation`,
    { timeout: 60000 },
    async () => {
      const f = await fixture(backend);
      try {
        const a = await f.publisher(),
          b = await f.publisher(),
          initial = b.snapshot().catalog.base;
        await a.publish(value("A first"));
        await assert.rejects(() => b.publish(value("B unsaved")));
        assert.equal(
          (await f.api("site-draft-load", {})).site.title,
          "A first",
        );
        await assert.rejects(() => b.adopt(value("B unsaved"), initial));
        const reviewed = b.snapshot().catalog.base,
          c = await f.publisher();
        await c.publish(value("C newer"));
        await assert.rejects(() => b.adopt(value("B unsaved"), reviewed));
        assert.equal(
          (await f.api("site-draft-load", {})).site.title,
          "C newer",
        );
        await b.adopt(value("B rebased"), b.snapshot().catalog.base);
        await b.publish(value("B rebased"));
        assert.equal(
          (await f.api("site-command", { action: "state", address: f.address }))
            .number,
          3,
        );
        const competitor = await f.publisher();
        let intercept = true;
        const racing: API = async (path, body: any) => {
          if (
            intercept &&
            path === "site-command" &&
            body?.action === "publish"
          ) {
            intercept = false;
            await competitor.publish(value("Other control window"));
          }
          return f.api(path, body);
        };
        const loser = await f.publisher(racing);
        await assert.rejects(() => loser.publish(value("Preserve this draft")));
        assert.ok(loser.snapshot().editing?.pending);
        await assert.rejects(() => loser.sync());
        await loser.clearTerminal(value("Preserve this draft"));
        assert.equal(loser.snapshot().editing?.pending, undefined);
        assert.equal(
          (await f.api("site-draft-load", {})).site.title,
          "Preserve this draft",
        );
        const observed = await f.api("site-command", {
          action: "resolve",
          address: f.address,
        });
        assert.equal(observed.state.number, 4);
        assert.equal(
          observed.object.content.site.title,
          "Other control window",
        );
        await assert.rejects(() => loser.publish(value("Preserve this draft")));
        await loser.adopt(
          value("Preserve this draft"),
          loser.snapshot().catalog.base,
        );
        await loser.publish(value("Preserve this draft"));
        assert.equal(
          (await f.api("site-command", { action: "state", address: f.address }))
            .number,
          5,
        );
      } finally {
        await f.close();
      }
    },
  );
  test(
    `${backend} editor never sends before durable draft acknowledgement, keeps unknown submissions frozen, and fences a locked session`,
    { timeout: 60000 },
    async () => {
      const f = await fixture(backend);
      try {
        let failSave = true,
          publishes = 0;
        const lostDraft: API = async (path, body: any) => {
          if (path === "site-command" && body?.action === "publish")
            publishes++;
          const result = await f.api(path, body);
          if (path === "site-draft" && failSave) {
            failSave = false;
            throw Error("fixture: draft reply lost before any site command");
          }
          return result;
        };
        const p = await f.publisher(lostDraft);
        await assert.rejects(() => p.publish(value("Draft one")));
        assert.equal(publishes, 0);
        assert.equal(p.snapshot().editing?.pending, undefined);
        p.configure("public", 86400_000);
        await p.save(value("Draft can still change"));
        let failSubmit = true;
        const blockedSubmit: API = async (path, body: any) => {
          if (
            failSubmit &&
            path === "site-command" &&
            body?.action === "publish"
          ) {
            failSubmit = false;
            throw Error("fixture: submission outcome unknown");
          }
          return f.api(path, body);
        };
        const q = await f.publisher(blockedSubmit, true);
        await assert.rejects(() => q.publish(value("Draft can still change")));
        const id = q.snapshot().editing!.pending!.operationId;
        await assert.rejects(() =>
          q.clearTerminal(value("Draft can still change")),
        );
        await assert.rejects(() => q.publish(value("Changed after intent")));
        assert.equal(q.snapshot().editing!.pending!.operationId, id);
        await q.publish(value("Draft can still change"));
        assert.equal(
          (await f.api("site-command", { action: "state", address: f.address }))
            .number,
          1,
        );
        let active = true,
          afterSave = false,
          afterLockPublishes = 0;
        const locked: API = async (path, body: any) => {
          if (path === "site-command" && body?.action === "publish")
            afterLockPublishes++;
          const result = await f.api(path, body);
          if (path === "site-draft" && !afterSave) {
            afterSave = true;
            active = false;
          }
          return result;
        };
        const stale = await f.publisher(locked, false, () => active);
        await assert.rejects(() =>
          stale.publish(value("Must not publish after lock")),
        );
        assert.equal(afterLockPublishes, 0);
        assert.equal(
          (await f.api("site-command", { action: "state", address: f.address }))
            .number,
          1,
        );
      } finally {
        await f.close();
      }
    },
  );
}

for (const backend of ["node", "native"] as const) {
  test(
    `${backend} editor can close an unadmitted request after a late fork changes only its base`,
    { timeout: 60000 },
    async () => {
      const f = await fixture(backend);
      let other: Client | undefined, remote: SitePublisher | undefined;
      try {
        const vault = (await f.api("export", { password })).vault;
        other = await launch(
          undefined,
          0,
          0,
          backend === "node" ? "native" : "node",
        );
        const identity = await other.call("setup", {
          recovery: vault,
          password,
        });
        assert.equal(identity.id, f.owner.id);
        const remoteAPI: API = (path, body) => other!.call(path, body);
        const remoteState = await remoteAPI("site-command", {
          action: "state",
          address: f.address,
        });
        remote = new SitePublisher(
          remoteAPI,
          f.owner.id,
          {
            catalog: remoteState,
            editing: contextFor(f.owner.id, remoteState),
          },
          () => true,
          () => {},
        );
        const first = await f.publisher();
        await first.publish(value("Local branch one"));
        await remote.publish(value("Remote branch one"));
        const ownHead = await f.api("site-command", {
          action: "resolve",
          address: f.address,
        });
        const foreignHead = await remoteAPI("site-command", {
          action: "resolve",
          address: f.address,
        });
        assert.notEqual(ownHead.revisionId, foreignHead.revisionId);
        let race = true;
        const lateFork: API = async (path, body: any) => {
          if (race && path === "site-command" && body?.action === "publish") {
            race = false;
            await f.api("connect", { host: "127.0.0.1", port: other!.tcpPort });
            await until(
              () =>
                f.api("site-command", { action: "state", address: f.address }),
              (s) => s.status === "conflict",
            );
          }
          return f.api(path, body);
        };
        const p = await f.publisher(lateFork);
        await assert.rejects(() =>
          p.publish(value("Keep my unpublished work")),
        );
        const pending = p.snapshot().editing!;
        assert.ok(pending.pending);
        await p.sync();
        const after = p.snapshot().catalog;
        assert.equal(after.nextSequence, 2);
        assert.equal(pending.sequence, 2);
        assert.notEqual(after.base, pending.base);
        assert.deepEqual(
          after.heads.map((h) => h.id).sort(),
          [ownHead.revisionId, foreignHead.revisionId].sort(),
        );
        assert.equal(p.snapshot().operation, null);
        await p.clearTerminal(value("Keep my unpublished work"));
        assert.equal(p.snapshot().editing?.pending, undefined);
        assert.equal(
          (await f.api("site-draft-load", {})).site.title,
          "Keep my unpublished work",
        );
        assert.equal(
          (await f.api("site-command", { action: "state", address: f.address }))
            .nextSequence,
          2,
        );
        await p.adopt(value("Keep my unpublished work"), after.base);
        await p.publish(
          value("Keep my unpublished work"),
          after.heads.map((h) => h.id).sort(),
        );
        const published = await f.api("site-command", {
          action: "resolve",
          address: f.address,
        });
        assert.equal(published.status, "available");
        assert.equal(published.state.number, 2);
        assert.equal(
          published.object.content.site.title,
          "Keep my unpublished work",
        );
      } finally {
        remote?.close();
        if (other) {
          await other.stop();
          rmSync(other.dir, { recursive: true, force: true });
        }
        await f.close();
      }
    },
  );
}

for (const backend of ["node", "native"] as const)
  test(
    `${backend} editor can resume an earlier authorized copy without replacing the current draft`,
    { timeout: 60000 },
    async () => {
      const f = await fixture(backend);
      try {
        const p = await f.publisher();
        await p.save(value("Keep this draft"));
        await f.api("settings", { quota: 1024 * 1024 });
        // A valid one-pixel GIF with bounded comment blocks exceeds the native
        // 1MiB minimum quota without large image dimensions or external data.
        const pixel = Buffer.from(
          "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
          "base64",
        );
        const comments: Buffer[] = [
          pixel.subarray(0, pixel.length - 1),
          Buffer.from([0x21, 0xfe]),
        ];
        for (let remaining = 1100000; remaining > 0;) {
          const size = Math.min(255, remaining);
          comments.push(Buffer.from([size]), Buffer.alloc(size, 65));
          remaining -= size;
        }
        comments.push(Buffer.from([0, 0x3b]));
        const earlier = value("Earlier authorized page");
        earlier.attachments = [
          {
            name: "quota-comments.gif",
            mime: "image/gif",
            data: Buffer.concat(comments).toString("base64"),
          },
        ];
        const state = await f.api("site-command", {
          action: "state",
          address: f.address,
        });
        const previous = await f.api("site-command", {
          action: "publish",
          name: "profile",
          sequence: state.nextSequence,
          operationId: crypto.randomUUID(),
          expectedBase: state.base,
          payload: {
            type: "site",
            ...draftBody(earlier),
          },
          recipients: "public",
          ttlMs: 3600000,
        });
        assert.equal(previous.operation.phase, "committed");
        await p.sync();
        await assert.rejects(() => p.publish(value("Keep this draft")));
        assert.equal(p.snapshot().editing?.pending, undefined);
        await f.api("settings", { quota: 8 * 1024 * 1024 });
        await p.settleRetained("resume");
        const current = await f.api("site-command", {
          action: "resolve",
          address: f.address,
        });
        assert.equal(current.object.id, previous.operation.bundleId);
        assert.equal(
          current.object.content.site.title,
          "Earlier authorized page",
        );
        assert.equal(
          (await f.api("site-draft-load", {})).site.title,
          "Keep this draft",
        );
      } finally {
        await f.close();
      }
    },
  );
