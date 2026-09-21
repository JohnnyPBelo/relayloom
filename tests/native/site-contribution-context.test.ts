import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { launch, password, until, type Client } from "../helpers";
import { assertOffline } from "../fixtures/offline-process";
import { formPayload, formRowSentinel } from "../fixtures/site-form";

for (const backend of ["node", "native"] as const)
  test(
    `${backend} form lookup derives permissions from real snapshots across process transfer, private access and restarted seeder takeover`,
    { timeout: 80000 },
    async () => {
      const peers: Client[] = [];
      try {
        const author = await launch(undefined, 0, 0, backend);
        peers.push(author);
        const other = backend === "node" ? "native" : "node";
        let reader = await launch(undefined, 0, 0, other);
        peers.push(reader);
        let newcomer = await launch(undefined, 0, 0, backend);
        peers.push(newcomer);
        const a = await author.call("setup", {
            name: "Dona de formulário",
            password,
          }),
          b = await reader.call("setup", {
            name: "Visitante autorizado",
            password,
          }),
          c = await newcomer.call("setup", {
            name: "Outro visitante",
            password,
          });
        await author.call("contact", { contact: b });
        await reader.call("contact", { contact: a });
        for (const peer of peers) await peer.call("settings", { relay: true });
        await reader.call("connect", {
          host: "127.0.0.1",
          port: author.tcpPort,
        });
        const address = "relayloom:site:" + a.id + "/profile";
        const publish = async (
          contributors: "readers" | string[],
          recipients: "public" | string[],
        ) => {
          const state = await author.call("site-command", {
            action: "state",
            address,
          });
          return (
            await author.call("site-command", {
              action: "publish",
              name: "profile",
              sequence: state.nextSequence,
              operationId: randomUUID(),
              expectedBase: state.base,
              payload: formPayload(contributors),
              recipients,
              ttlMs: 3600000,
            })
          ).operation;
        };
        const restricted = await publish([b.id], "public");
        const query = (id: string) => ({
          action: "form",
          snapshotId: id,
          pageId: "entry",
          formId: "form",
        });
        await until(
          () => reader.call("state"),
          (s) => s.objects.some((o: any) => o.id === restricted.bundleId),
        );
        const description = await reader.call(
          "contribution-command",
          query(restricted.bundleId),
        );
        assert.equal(description.owner.id, a.id);
        assert.equal(description.target.site, address);
        assert.equal(description.fields.length, 3);
        assert.equal(
          JSON.stringify(description).includes(formRowSentinel),
          false,
        );
        for (const bad of [
          { ...query(restricted.bundleId), context: {} },
          { ...query(restricted.bundleId), contributors: "readers" },
          { ...query(restricted.bundleId), pageId: "directory" },
        ])
          await assert.rejects(reader.call("contribution-command", bad));
        await newcomer.call("connect", {
          host: "127.0.0.1",
          port: reader.tcpPort,
        });
        await until(
          () => newcomer.call("state"),
          (s) => s.objects.some((o: any) => o.id === restricted.bundleId),
        );
        await assert.rejects(
          newcomer.call("contribution-command", query(restricted.bundleId)),
        );
        await reader.call("action", {
          action: "block",
          target: a.id,
          value: true,
        });
        assert.ok((await reader.call("state")).blocked.includes(a.id));
        await assert.rejects(
          reader.call("contribution-command", query(restricted.bundleId)),
        );
        await reader.call("action", {
          action: "block",
          target: a.id,
          value: false,
        });
        assert.ok(!(await reader.call("state")).blocked.includes(a.id));
        const privateSite = await publish("readers", [a.id, b.id].sort());
        await until(
          () => reader.call("state"),
          (s) => s.objects.some((o: any) => o.id === privateSite.bundleId),
        );
        const privateDescription = await reader.call(
          "contribution-command",
          query(privateSite.bundleId),
        );
        assert.deepEqual(privateDescription.siteScope, [a.id, b.id].sort());
        await until(
          async () =>
            existsSync(
              join(
                newcomer.dir,
                "store/objects",
                privateSite.bundleId + ".json",
              ),
            ),
          (v) => v,
        );
        await assert.rejects(
          newcomer.call("contribution-command", query(privateSite.bundleId)),
        );
        assert.equal(
          (
            await reader.call(
              "contribution-command",
              query(restricted.bundleId),
            )
          ).target.revisionId,
          description.target.revisionId,
        );
        await author.call("publish", {
          content: { type: "delete", target: restricted.bundleId },
          recipients: "public",
        });
        await until(
          async () => {
            try {
              await reader.call(
                "contribution-command",
                query(restricted.bundleId),
              );
              return false;
            } catch (e) {
              return /retir/i.test(String(e));
            }
          },
          (v) => v,
        );
        const newcomerDir = newcomer.dir;
        await newcomer.stop();
        const publicSite = await publish("readers", "public");
        await until(
          () => reader.call("state"),
          (s) => s.objects.some((o: any) => o.id === publicSite.bundleId),
        );
        await author.stop();
        await assertOffline(author);
        const dir = reader.dir;
        await reader.stop();
        reader = await launch(dir, 0, 0, other);
        peers.push(reader);
        await reader.call("unlock", { password });
        newcomer = await launch(newcomerDir, 0, 0, backend);
        peers.push(newcomer);
        await newcomer.call("unlock", { password });
        assert.equal(
          existsSync(
            join(newcomer.dir, "store/objects", publicSite.bundleId + ".json"),
          ),
          false,
        );
        await assert.rejects(
          newcomer.call("contribution-command", query(publicSite.bundleId)),
        );
        await newcomer.call("connect", {
          host: "127.0.0.1",
          port: reader.tcpPort,
        });
        await until(
          () => newcomer.call("state"),
          (s) => s.objects.some((o: any) => o.id === publicSite.bundleId),
        );
        const reopened = await reader.call(
            "contribution-command",
            query(publicSite.bundleId),
          ),
          seeded = await newcomer.call(
            "contribution-command",
            query(publicSite.bundleId),
          );
        assert.deepEqual(seeded, reopened);
        assert.equal(seeded.owner.id, a.id);
        assert.equal(
          (
            await reader.call("site-command", {
              action: "state",
              address: "relayloom:site:" + b.id + "/profile",
            })
          ).nextSequence,
          1,
        );
        assert.equal(
          (
            await newcomer.call("site-command", {
              action: "state",
              address: "relayloom:site:" + c.id + "/profile",
            })
          ).nextSequence,
          1,
        );
        mkdirSync(".cache/contribution-context-processes", { recursive: true });
        writeFileSync(
          ".cache/contribution-context-processes/" + backend + ".json",
          JSON.stringify(
            {
              status: "PASS",
              authorBackend: backend,
              readerBackend: other,
              realTCP: true,
              privateReaderBoundary: true,
              restrictedContributorDenied: true,
              blockedDenied: true,
              withdrawnDenied: true,
              callerAuthorityDenied: true,
              originalRevisionRetained: true,
              authorOffline: true,
              restartedSeeder: true,
              requestedSnapshotAbsentBeforeHeal: true,
              opaquePrivateBytesPresentForNegativeControl: true,
              originalOwnerPreserved: true,
              queryCreatedNoSiteRevision: true,
              scope:
                "Read-only form context through real processes; no proposal submission or approval yet.",
            },
            null,
            2,
          ) + "\n",
        );
      } finally {
        for (const p of peers) await p.stop().catch(() => {});
        for (const dir of new Set(peers.map((p) => p.dir)))
          rmSync(dir, { recursive: true, force: true });
      }
    },
  );
