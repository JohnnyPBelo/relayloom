import assert from "node:assert/strict";
import { connect } from "node:net";
import type { Client } from "../helpers.js";

/** One bounded real TCP probe, with refusal distinct from a slow connection. */
export async function tcpOutcome(port: number): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    let finished = false;
    const done = (outcome: string) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(outcome);
    };
    socket.setTimeout(2000, () => done("ETIMEDOUT"));
    socket.once("connect", () => done("CONNECTED"));
    socket.once("error", (error) =>
      done((error as NodeJS.ErrnoException).code ?? "UNKNOWN"),
    );
  });
}
export async function assertOffline(
  client: Pick<Client, "process" | "tcpPort">,
) {
  assert.ok(
    client.process.exitCode !== null || client.process.signalCode !== null,
    "origin process has not terminated",
  );
  assert.equal(
    await tcpOutcome(client.tcpPort),
    "ECONNREFUSED",
    "origin data socket remains available or refusal was not demonstrated",
  );
}
