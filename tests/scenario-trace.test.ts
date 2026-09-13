import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { ScenarioTrace } from "./fixtures/scenario-trace.js";
import type { Client } from "./helpers.js";

test("scenario timeout trace preserves the active operation without recording request secrets", async () => {
  mkdirSync(".cache/fixture-http-failures", { recursive: true });
  const dir = mkdtempSync(resolve(".cache/fixture-http-failures/trace-test-"));
  const controller = new AbortController();
  const trace = new ScenarioTrace("privacy-control", controller.signal, dir);
  let finish!: () => void;
  const original = () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  const client = {
    call: original,
    process: { exitCode: null, signalCode: null },
  } as unknown as Client;
  try {
    trace.wrap(client, "author");
    trace.phase("before-invitation");
    const pending = client.call("group-command", {
      action: "invite",
      password: "DO-NOT-RECORD-password",
      token: "DO-NOT-RECORD-capability",
      payload: "DO-NOT-RECORD-body",
    });
    controller.abort();
    const aborted = JSON.parse(
      readFileSync(trace.path + ".abort.json", "utf8"),
    );
    assert.equal(aborted.status, "test-aborted");
    assert.equal(aborted.active[0].api, "group-command");
    assert.equal(aborted.active[0].action, "invite");
    assert.equal(aborted.phases.at(-1).phase, "before-invitation");
    finish();
    await pending;
    trace.finish(true);
    const final = readFileSync(trace.path, "utf8");
    assert.equal(final.includes("DO-NOT-RECORD"), false);
    assert.equal(
      readFileSync(trace.path + ".abort.json", "utf8").includes(
        "DO-NOT-RECORD",
      ),
      false,
    );
    assert.equal(
      JSON.parse(final).status,
      "test-aborted",
      "later completion erased the timeout",
    );
    assert.equal(client.call, original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
