import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  createIdentity,
  createBundleAt,
  ContentStore,
  type Bundle,
} from "../packages/core/src/index";
import { nodeCertificateCrypto } from "../packages/core/src/certificate-crypto";
import { createSiteContentProtocol } from "../packages/sites/src/content";
import { createContributionContextResolver } from "../packages/sites/src/contribution-context";
import { createSiteContributionProtocol } from "../packages/sites/src/contribution-protocol";
import { NodeContributionCatalog } from "../packages/sites/src/contribution-catalog";
import { NodeContributionInbox } from "../packages/sites/src/contribution-inbox-catalog";
import { ProtectedGroupStore } from "../packages/groups/src/storage";
import { ContributionRuntime } from "../apps/node/src/contribution-runtime";
import { formPayload } from "./fixtures/site-form";
import { projectTemp } from "./project-temp";

for (const constrained of [false, true])
  test(`Node receipt batch ${constrained ? "charges failed copies" : "rotates fairly"} and retains every pending original envelope`, () => {
    const dir = projectTemp("receipt-budget-"),
      owner = createIdentity("Owner"),
      visitor = createIdentity("Visitor"),
      db = new ProtectedGroupStore(join(dir, "profile.sqlite"), owner, {
        create: true,
      }),
      store = new ContentStore(join(dir, "store")),
      sent: Bundle[] = [],
      incoming = new NodeContributionInbox(db, owner),
      runtime = new ContributionRuntime({
        identity: owner,
        catalog: new NodeContributionCatalog(db, owner),
        incoming,
        store,
        ensure: () => {},
        blocked: () => [],
        withdrawn: () => false,
        publish: (b) => {
          sent.push(b);
        },
        cancel: () => {},
        publishSource: () => "unused",
        cancelPackets: () => {},
        requestSource: () => false,
      });
    try {
      const now = Date.now(),
        content = createSiteContentProtocol(nodeCertificateCrypto).create(
          owner,
          "profile",
          1,
          [],
          formPayload([visitor.public.id]),
        ),
        source = createBundleAt(owner, "site", content, "public", 3600000, now),
        context = createContributionContextResolver(
          nodeCertificateCrypto,
        ).resolve(
          {
            action: "form",
            snapshotId: source.manifest.id,
            pageId: "entry",
            formId: "form",
          },
          source,
          content,
          visitor.public.id,
          now,
        ).context,
        protocol = createSiteContributionProtocol(nodeCertificateCrypto);
      store.put(source, true);
      for (let i = 0; i < 9; i++) {
        const p = protocol.create(visitor, {
            target: context.target,
            schemaHash: protocol.schemaHash(context.form, context.table),
            operationId: randomUUID(),
            created: now,
            expires: now + 180000,
            values: { name: "batch-" + i, count: 0, open: false },
            publicationScope: "public",
          }),
          bundle = createBundleAt(
            visitor,
            "site-contribution",
            { type: "site-contribution", proposal: p },
            [owner.public],
            180000,
            now,
          );
        incoming.admit(bundle, () => {});
        incoming.attachSource(p.id, source, () => {});
      }
      if (constrained) store.quota = 1;
      runtime.tick();
      const first = incoming.state();
      assert.equal(
        first.entries.filter((e) => e.receipt?.phase === "queued").length,
        8,
      );
      assert.equal(
        first.entries.filter((e) => e.receipt?.phase === "prepared").length,
        1,
      );
      assert.equal(sent.length, constrained ? 0 : 8);
      const ids = first.entries.map(
        (e) => e.receipt?.transport?.bundleId ?? null,
      );
      store.quota = 128 * 1024 * 1024;
      (runtime as any).nextRetry = 0;
      runtime.tick();
      const second = incoming.state();
      assert.equal(
        second.entries.filter((e) => e.receipt?.phase === "queued").length,
        9,
      );
      assert.equal(
        second.entries.filter((e) => e.receipt?.transport?.copied).length,
        constrained ? 8 : 9,
      );
      for (let i = 0; i < 8; i++)
        assert.equal(second.entries[i].receipt?.transport?.bundleId, ids[i]);
      (runtime as any).nextRetry = 0;
      runtime.tick();
      assert.equal(
        incoming.state().entries.filter((e) => e.receipt?.transport?.copied)
          .length,
        9,
      );
      assert.equal(new Set(sent.map((b) => b.manifest.id)).size, 9);
      assert.equal(sent.length, 9);
    } finally {
      runtime.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

test("Go receipt runtime applies the same rotating copy budget, including real quota failures", (t) => {
  const dir = projectTemp("go-receipt-budget-"),
    path = join(dir, "form.json");
  try {
    writeFileSync(path, JSON.stringify(formPayload()), { mode: 0o600 });
    // Compilation and execution have separate bounds. The cold race build is
    // not evidence that the worker ran, and cannot consume its 60-second budget.
    const executable = join(
        dir,
        process.platform === "win32" ? "app.test.exe" : "app.test",
      ),
      compileStarted = performance.now(),
      built = spawnSync(
        process.execPath,
        [
          "scripts/go.mjs",
          "test",
          "-c",
          "-race",
          "-p=1",
          "-o",
          executable,
          "./app",
        ],
        {
          encoding: "utf8",
          timeout: 120000,
        },
      );
    t.diagnostic(
      JSON.stringify({
        phase: "compile-only",
        durationMs: Math.round(performance.now() - compileStarted),
        exitCode: built.status,
        signal: built.signal,
        error: built.error?.message ?? null,
      }),
    );
    assert.equal(
      built.status,
      0,
      "Go worker compilation failed: " +
        (built.error?.message ?? "") +
        built.stdout +
        built.stderr,
    );
    const executeStarted = performance.now(),
      run = spawnSync(
        executable,
        [
          "-test.run=^TestReceiptRuntimeBudgetWorker$",
          "-test.count=1",
          "-test.v",
          "-test.timeout=55s",
        ],
        {
          encoding: "utf8",
          timeout: 60000,
          env: { ...process.env, RELAYLOOM_RECEIPT_BUDGET_FORM: path },
        },
      );
    t.diagnostic(
      JSON.stringify({
        phase: "execute",
        durationMs: Math.round(performance.now() - executeStarted),
        exitCode: run.status,
        signal: run.signal,
        error: run.error?.message ?? null,
      }),
    );
    assert.equal(
      run.status,
      0,
      "Go worker execution failed: " +
        (run.error?.message ?? "") +
        run.stdout +
        run.stderr,
    );
    const result = JSON.parse(readFileSync(path + ".result.json", "utf8"));
    assert.deepEqual(result, {
      normal: true,
      copyQuota: true,
      preservedEnvelopeIDs: true,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
