import { test, expect } from "@playwright/test";
import { staticHarness } from "./static-harness";
let host: Awaited<ReturnType<typeof staticHarness>>;
test.beforeAll(async () => {
  host = await staticHarness();
});
test.afterAll(async () => {
  await host.close();
  expect(host.requests.some((p) => p.startsWith("/api/"))).toBe(false);
});

test("browser application creates resources once, keeps copy failures recoverable and checks blocking in the actual copy transaction", async ({
  page,
}) => {
  await page.goto(host.url);
  const result = await page.evaluate(async () => {
    const r = (window as any).rl,
      name = "resource-api-" + crypto.randomUUID(),
      password = "resource API fixture passphrase",
      published: any[] = [];
    let p: any, app: any;
    const open = async (existing = false) => {
      p = await r.BrowserProfile.connect(name);
      app = new r.BrowserApplication(p, {
        publish: (b: any) => published.push(b.manifest.id),
        command: async (op: string, body: any) => {
          if (op !== "block") throw Error("unexpected network command");
          await p.updateValue("mesh-settings", (old: any) => {
            const blocked = new Set<string>(old?.blocked ?? []);
            if (body.value) blocked.add(body.id);
            else blocked.delete(body.id);
            return { ...old, blocked: [...blocked] };
          });
        },
        state: () => ({ peers: [], counters: {}, error: "" }),
        context: () => {},
      });
      await app.call(existing ? "unlock" : "setup", {
        name: "Autora",
        password,
      });
    };
    const denied = async (fn: () => Promise<any>) => {
      try {
        await fn();
        return false;
      } catch {
        return true;
      }
    };
    const cmd = (value: any) => app.call("resource-command", value);
    const peer = await r.BrowserProfile.connect(name + "-peer");
    await peer.setup("Leitor", password);
    try {
      await open();
      await app.call("contact", { contact: peer.identity });
      const q = {
        action: "create",
        sequence: 1,
        operationId: crypto.randomUUID(),
        ttlMs: 3600000,
        recipients: "public",
        content: {
          type: "site-resource",
          domain: "relayloom/site-resource/1",
          kind: "file",
          name: "Primeiro.txt",
          mime: "text/plain",
          data: btoa("Primeiro recurso"),
        },
      };
      const invalidShape = await denied(() => cmd({ ...q, arbitrary: true })),
        genericRejected = await denied(() =>
          app.call("publish", { content: q.content, recipients: "public" }),
        );
      const race = await Promise.allSettled([
        cmd(q),
        cmd({ ...q, operationId: crypto.randomUUID() }),
      ]);
      if (race[0].status !== "fulfilled") throw race[0].reason;
      const first = race[0].value.operation,
        same = (await cmd(q)).operation;
      const changedRejected = await denied(() => cmd({ ...q, ttlMs: 2000 }));
      await app.call("settings", { quota: 1024 * 1024 });
      const big = {
        ...q,
        sequence: 2,
        operationId: crypto.randomUUID(),
        recipients: [p.identity.id, peer.identity.id].sort(),
        content: {
          ...q.content,
          name: "Recurso grande.txt",
          data: btoa("A".repeat(900000)),
        },
      };
      const pending = await cmd(big);
      const absentOnFailure = !(await p.ids()).includes(
        pending.operation.reference.bundleId,
      );
      await app.call("settings", { quota: 16 * 1024 * 1024 });
      // Inject a real settings update after the caller's snapshot and before
      // putBundle's atomic transaction. This must prevent the copy itself.
      const put = p.putBundle.bind(p);
      p.putBundle = async (...args: any[]) => {
        await p.updateValue("mesh-settings", () => ({
          blocked: [peer.identity.id],
        }));
        return put(...args);
      };
      const paused = await cmd({
        action: "resume",
        sequence: 2,
        operationId: big.operationId,
      });
      p.putBundle = put;
      const absentWhenBlocked = !(await p.ids()).includes(
        pending.operation.reference.bundleId,
      );
      app.close();
      await open(true);
      const retained = await cmd(big);
      const whileBlockedNewRejected = await denied(() =>
        cmd({ ...big, sequence: 3, operationId: crypto.randomUUID() }),
      );
      await app.call("action", {
        action: "block",
        target: peer.identity.id,
        value: false,
      });
      const ready = await cmd({
        action: "resume",
        sequence: 2,
        operationId: big.operationId,
      });
      const view = await app.call("view", {
        id: ready.operation.reference.bundleId,
      });
      const exactHash = await r.hash(
        r.canonical(await p.getBundle(ready.operation.reference.bundleId)),
      );
      await app.call("lock");
      const lockedRejected = await denied(() => cmd({ action: "state" }));
      await app.call("unlock", { password });
      const afterUnlock = await cmd(big);
      return {
        invalidShape,
        genericRejected,
        changedRejected,
        race: race.map((x) => x.status),
        same: r.canonical(first) === r.canonical(same),
        initialPhase: first.phase,
        pendingPhase: pending.operation.phase,
        quotaError: !!pending.error,
        absentOnFailure,
        absentWhenBlocked,
        pausedPhase: paused.operation.phase,
        blockedError: /bloqueado/i.test(paused.error),
        retained:
          r.canonical(retained.operation) === r.canonical(pending.operation),
        whileBlockedNewRejected,
        readyPhase: ready.operation.phase,
        exactHash: exactHash === pending.operation.bundleHash,
        exactPayload: r.canonical(view.content) === r.canonical(big.content),
        sameAfterUnlock:
          r.canonical(afterUnlock.operation) === r.canonical(ready.operation),
        lockedRejected,
        published,
        count: (await p.ids()).length,
        next: (await cmd({ action: "state" })).nextSequence,
      };
    } finally {
      app?.close();
      peer.close();
      indexedDB.deleteDatabase(name);
      indexedDB.deleteDatabase(name + "-peer");
    }
  });
  expect(result).toEqual({
    invalidShape: true,
    genericRejected: true,
    changedRejected: true,
    race: ["fulfilled", "rejected"],
    same: true,
    initialPhase: "ready",
    pendingPhase: "copy-pending",
    quotaError: true,
    absentOnFailure: true,
    absentWhenBlocked: true,
    pausedPhase: "copy-pending",
    blockedError: true,
    retained: true,
    whileBlockedNewRejected: true,
    readyPhase: "ready",
    exactHash: true,
    exactPayload: true,
    sameAfterUnlock: true,
    lockedRejected: true,
    published: [],
    count: 2,
    next: 3,
  });
});

test("browser application leaves a failed read-back pending and recovers its exact signature after reopening", async ({
  page,
}) => {
  await page.goto(host.url);
  const result = await page.evaluate(async () => {
    const r = (window as any).rl,
      name = "resource-copy-" + crypto.randomUUID(),
      password = "copy failure browser passphrase";
    let p = await r.BrowserProfile.connect(name);
    const make = () =>
      new r.BrowserApplication(p, {
        publish: () => {
          throw Error("resource must not broadcast");
        },
        command: async () => {},
        state: () => ({ peers: [], counters: {}, error: "" }),
        context: () => {},
      });
    let app = make();
    try {
      await app.call("setup", { name: "Autora", password });
      const q = {
        action: "create",
        sequence: 1,
        operationId: crypto.randomUUID(),
        recipients: "public",
        ttlMs: 3600000,
        content: {
          type: "site-resource",
          domain: "relayloom/site-resource/1",
          kind: "file",
          name: "Nota.txt",
          mime: "text/plain",
          data: "Zg==",
        },
      };
      const get = p.getBundle.bind(p);
      p.getBundle = async () => {
        throw Error("injected read-back failure after actual storage");
      };
      const pending = await app.call("resource-command", q);
      p.getBundle = get;
      const present = (await p.ids()).includes(
          pending.operation.reference.bundleId,
        ),
        bundle = await p.getBundle(pending.operation.reference.bundleId);
      app.close();
      p = await r.BrowserProfile.connect(name);
      app = make();
      await app.call("unlock", { password });
      const ready = await app.call("resource-command", q);
      return {
        pendingPhase: pending.operation.phase,
        error: pending.error,
        present,
        readyPhase: ready.operation.phase,
        same:
          ready.operation.bundleHash === pending.operation.bundleHash &&
          r.canonical(bundle) ===
            r.canonical(await p.getBundle(ready.operation.reference.bundleId)),
        count: (await p.ids()).length,
      };
    } finally {
      app.close();
      indexedDB.deleteDatabase(name);
    }
  });
  expect(result).toEqual({
    pendingPhase: "copy-pending",
    error: "injected read-back failure after actual storage",
    present: true,
    readyPhase: "ready",
    same: true,
    count: 1,
  });
});

test("expired browser resource intent keeps its result and requires a new explicit creation", async ({
  page,
}) => {
  await page.goto(host.url);
  const result = await page.evaluate(async () => {
    const r = (window as any).rl,
      name = "resource-expiry-" + crypto.randomUUID(),
      p = await r.BrowserProfile.connect(name),
      app = new r.BrowserApplication(p, {
        publish: () => {
          throw Error("must not broadcast");
        },
        command: async () => {},
        state: () => ({ peers: [], counters: {}, error: "" }),
        context: () => {},
      });
    try {
      await app.call("setup", {
        name: "Expiração",
        password: "expiry browser test passphrase",
      });
      await app.call("settings", { quota: 1024 * 1024 });
      const q = {
        action: "create",
        sequence: 1,
        operationId: crypto.randomUUID(),
        recipients: "public",
        ttlMs: 4000,
        content: {
          type: "site-resource",
          domain: "relayloom/site-resource/1",
          kind: "file",
          name: "Temporário.txt",
          mime: "text/plain",
          data: btoa("B".repeat(900000)),
        },
      };
      const pending = await app.call("resource-command", q);
      await new Promise((done) =>
        setTimeout(
          done,
          Math.max(0, pending.operation.expires - Date.now()) + 50,
        ),
      );
      await app.call("settings", { quota: 16 * 1024 * 1024 });
      const expired = await app.call("resource-command", {
          action: "resume",
          sequence: 1,
          operationId: q.operationId,
        }),
        again = await app.call("resource-command", q),
        absent = !(await p.ids()).includes(
          expired.operation.reference.bundleId,
        ),
        next = await app.call("resource-command", {
          ...q,
          sequence: 2,
          operationId: crypto.randomUUID(),
          content: { ...q.content, data: "Zg==" },
        });
      return {
        pending: pending.operation.phase,
        expired: expired.operation.phase,
        sameId:
          expired.operation.reference.bundleId ===
          pending.operation.reference.bundleId,
        retained:
          r.canonical(expired.operation) === r.canonical(again.operation),
        absent,
        next: next.operation.phase,
        count: (await p.ids()).length,
      };
    } finally {
      app.close();
      indexedDB.deleteDatabase(name);
    }
  });
  expect(result).toEqual({
    pending: "copy-pending",
    expired: "expired",
    sameId: true,
    retained: true,
    absent: true,
    next: "ready",
    count: 1,
  });
});
