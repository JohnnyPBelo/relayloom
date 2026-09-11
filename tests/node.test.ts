import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { launch, until, password } from "./helpers.js";

test(
  "real processes: private conversation, receipt, unauthorized edit, social and restart recovery",
  { timeout: 40000 },
  async () => {
    const a = await launch(),
      b = await launch();
    let recovered;
    try {
      const alice = await a.call("setup", { name: "Alice", password }),
        bob = await b.call("setup", { name: "Bob", password });
      await a.call("contact", { contact: bob });
      await b.call("contact", { contact: alice });
      const unauthorized = await fetch(a.url + "/api/state");
      assert.equal(unauthorized.status, 401);
      const csrf = await fetch(a.url + "/api/state", {
        headers: {
          Authorization: "Bearer " + a.token,
          Origin: "https://untrusted.example",
        },
      });
      assert.equal(csrf.status, 403);
      await a.call("connect", { host: "127.0.0.1", port: b.tcpPort });
      await until(
        () => a.call("state"),
        (s) => s.peers.length === 1,
      );
      const msg = await a.call("publish", {
        content: { type: "message", text: "Private live transport" },
        recipients: [bob.id],
      });
      const received = await until(
        () => b.call("state"),
        (s) => s.objects.some((o: any) => o.id === msg.id),
      );
      assert.equal(
        received.objects.find((o: any) => o.id === msg.id).author.id,
        alice.id,
      );
      await b.call("view", { id: msg.id });
      await until(
        () => a.call("state"),
        (s) =>
          s.objects.some(
            (o: any) => o.kind === "receipt" && o.content.target === msg.id,
          ),
      );
      await assert.rejects(
        () =>
          b.call("publish", {
            content: { type: "edit", target: msg.id, text: "Forgery" },
            recipients: [alice.id],
          }),
        /autor/,
      );
      const post = await a.call("publish", {
        content: { type: "post", text: "Hello community" },
        recipients: "public",
      });
      await until(
        () => b.call("state"),
        (s) => s.objects.some((o: any) => o.id === post.id),
      );
      await b.call("publish", {
        content: { type: "comment", target: post.id, text: "Hi Alice" },
        recipients: "public",
      });
      await b.call("publish", {
        content: {
          type: "reaction",
          target: post.id,
          emoji: "heart",
          value: true,
        },
        recipients: "public",
      });
      await b.call("action", { action: "save", target: post.id, value: true });
      await assert.rejects(
        () =>
          a.call("publish", {
            content: {
              type: "site",
              theme: "sand",
              blocks: [
                {
                  id: "evil",
                  type: "text",
                  title: "test",
                  body: "",
                  url: "javascript:alert(1)",
                },
              ],
            },
            recipients: "public",
          }),
        /Bloco/,
      );
      await b.stop();
      recovered = await launch(b.dir);
      assert.equal((await recovered.call("state")).locked, true);
      await assert.rejects(() =>
        recovered!.call("unlock", { password: "wrong" }),
      );
      await recovered.call("unlock", { password });
      const restored = await recovered.call("state");
      assert.ok(restored.objects.some((o: any) => o.id === msg.id));
      assert.ok(restored.saved.includes(post.id));
      const vault = await a.call("export", { password });
      assert.ok(vault.vault.includes("sealed"));
      assert.ok(!vault.vault.includes("signSecret"));
    } finally {
      await a.stop();
      await b.stop();
      if (recovered) await recovered.stop();
      rmSync(a.dir, { recursive: true, force: true });
      rmSync(b.dir, { recursive: true, force: true });
    }
  },
);
