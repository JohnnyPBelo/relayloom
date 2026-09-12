import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { password } from "./helpers.js";
import { LoomNode } from "../apps/node/src/node.js";
import { serve } from "../apps/node/src/server.js";
import { groupMembershipJourney } from "./fixtures/group-runtime.js";

test(
  "authenticated Node group management persists membership and restrictive proofs",
  { timeout: 45000 },
  () => groupMembershipJourney("node", "node"),
);

test("group API recovers a committed command whose response was lost without creating a second group", async () => {
  mkdirSync(".cache", { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), ".cache/group-api-lost-")),
    node = new LoomNode(directory),
    server = await serve(node);
  const call = async (body: unknown) => {
    const response = await fetch(server.url + "/api/group-command", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + server.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() };
  };
  try {
    node.setup("Owner", password);
    const database = (node as any).privateDatabase,
      transaction = database.transaction.bind(database);
    let committed = false;
    database.transaction = (callback: any) => {
      const result = transaction(callback);
      committed = true;
      throw new Error("synthetic response loss after commit");
    };
    const request = {
      action: "create",
      operationId: randomUUID(),
      title: "Created exactly once",
    };
    const lost = await call(request);
    assert.equal(lost.status, 400);
    assert.equal(committed, true);
    const recovered = await call(request);
    assert.equal(recovered.status, 200);
    const list = await call({ action: "list" });
    assert.equal(list.value.groups.length, 1);
    assert.equal(list.value.groups[0].id, recovered.value.operation.groupId);
    assert.equal(
      (
        await call({
          action: "operation",
          operationId: request.operationId,
        })
      ).value.operation.groupId,
      recovered.value.operation.groupId,
    );
  } finally {
    await server.close();
    await node.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
