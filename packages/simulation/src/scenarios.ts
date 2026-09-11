import {
  createBundle,
  createIdentity,
  canonical,
  type Bundle,
} from "../../core/src/index.js";
import {
  Simulation,
  assess,
  type SimFaults,
  type SimulationReport,
} from "./index.js";

export const ACCEPTANCE_SEED = 0x51a7_2026;
export function fixtures() {
  const author = createIdentity("Simulation author");
  const make = (name: string, size = 40) =>
    createBundle(
      author,
      "message",
      { name, text: "x".repeat(size) },
      "public",
      3600_000,
    );
  const good = make("valid"),
    badSignature = structuredClone(good),
    badChunk = structuredClone(good);
  badSignature.manifest.signature =
    (good.manifest.signature[0] === "A" ? "B" : "A") +
    good.manifest.signature.slice(1);
  const first = badChunk.manifest.chunks[0].hash,
    bytes = Buffer.from(badChunk.chunks[first], "base64");
  bytes[0] ^= 1;
  badChunk.chunks[first] = bytes.toString("base64");
  return {
    good,
    badSignature,
    badChunk,
    sos: make("sos"),
    bulk: make("bulk", 24_000),
    short: make("short-ttl"),
    oneHop: make("one-hop"),
    queued: Array.from({ length: 9 }, (_, i) => make("queued-" + i, 200)),
    pinned: make("pinned", 200),
    replacement: make("replacement", 200),
  };
}
export type Fixtures = ReturnType<typeof fixtures>;
const node = (id: string) => ({ id, storageBytes: 2 * 1024 ** 2 });
function pair(
  sim: Simulation,
  from: string,
  to: string,
  speed = 32_000,
  latency = 15,
  loss = 0,
  mtu = 512,
) {
  sim.addLink({
    id: from + to,
    from,
    to,
    bytesPerSecond: speed,
    latencyMs: latency,
    loss,
    mtu,
  });
  sim.addLink({
    id: to + from,
    from: to,
    to: from,
    bytesPerSecond: Math.max(1000, Math.floor(speed / 3)),
    latencyMs: latency * 2,
    loss,
    mtu: Math.max(128, Math.floor(mtu / 2)),
  });
}
export function partitionScenario(f: Fixtures, seed = ACCEPTANCE_SEED) {
  const sim = new Simulation(seed)
    .addNode(node("A"))
    .addNode({ ...node("B"), lowPower: true })
    .addNode(node("C"));
  pair(sim, "A", "B", 32_000, 20, 0.04);
  pair(sim, "B", "C", 8000, 80, 0.04, 256);
  sim.setLinkUp("BC", false);
  sim.setLinkUp("CB", false);
  sim.inject("A", "bulk", f.bulk, { priority: "bulk" });
  sim.at(100, () => sim.inject("A", "short-ttl", f.short, { ttlMs: 1500 }));
  sim.at(300, () => sim.inject("A", "sos", f.sos, { priority: "sos" }));
  sim.at(2500, () => {
    sim.setLinkUp("BC", true);
    sim.setLinkUp("CB", true);
  });
  sim.at(10_000, () => sim.setLowPower("B", false));
  return sim.run(60_000);
}
export function controlScenario(
  f: Fixtures,
  faults: SimFaults = {},
  seed = ACCEPTANCE_SEED,
) {
  const sim = new Simulation(seed, faults)
    .addNode(node("A"))
    .addNode(node("B"))
    .addNode(node("C"));
  pair(sim, "A", "B");
  pair(sim, "B", "C");
  sim.inject("A", "valid", f.good);
  sim.at(20, () => sim.inject("A", "bad-signature", f.badSignature));
  sim.at(40, () => sim.inject("A", "bad-chunk", f.badChunk));
  return sim.run(5000);
}
export const controlExpectations = {
  required: [{ node: "C", label: "valid" }],
  forbidden: [
    { node: "C", label: "bad-signature" },
    { node: "C", label: "bad-chunk" },
  ],
};
export function congestionScenario(f: Fixtures, seed = ACCEPTANCE_SEED) {
  const sim = new Simulation(seed)
    .addNode({ ...node("A"), lowPower: true })
    .addNode(node("B"));
  sim.addLink({
    id: "AB",
    from: "A",
    to: "B",
    bytesPerSecond: 4000,
    latencyMs: 20,
    loss: 0,
    mtu: 256,
    queueBytes: 6500,
    queueSlots: 4,
  });
  sim.addLink({
    id: "BA",
    from: "B",
    to: "A",
    bytesPerSecond: 2000,
    latencyMs: 40,
    loss: 0,
    mtu: 128,
  });
  f.queued.forEach((bundle, i) =>
    sim.inject("A", "bulk-" + i, bundle, { priority: "bulk" }),
  );
  sim.at(50, () => sim.inject("A", "sos", f.sos, { priority: "sos" }));
  sim.at(3000, () => sim.setLowPower("A", false));
  return sim.run(10_000);
}
export function storageScenario(
  f: Fixtures,
  pinned: boolean,
  seed = ACCEPTANCE_SEED,
) {
  const storageBytes =
    Math.max(
      Buffer.byteLength(canonical(f.pinned)),
      Buffer.byteLength(canonical(f.replacement)),
    ) + 64;
  const sim = new Simulation(seed)
    .addNode(node("A"))
    .addNode({ id: "B", storageBytes, maxObjects: 1, relay: false });
  pair(sim, "A", "B");
  sim.inject("B", "existing", f.pinned, { pinned });
  sim.at(100, () => sim.inject("A", "replacement", f.replacement));
  return sim.run(4000);
}
export function ttlScenario(f: Fixtures, seed = ACCEPTANCE_SEED) {
  const sim = new Simulation(seed)
    .addNode(node("A"))
    .addNode(node("B"))
    .addNode(node("C"));
  pair(sim, "A", "B", 100_000, 600);
  pair(sim, "B", "C", 100_000, 10);
  sim.inject("A", "expired-in-flight", f.short, { ttlMs: 300 });
  sim.inject("A", "one-hop", f.oneHop, { maxHops: 1 });
  // Healing must not circumvent the hop limit when replaying retained objects.
  sim.at(2500, () => {
    sim.setLinkUp("BC", false);
    sim.setLinkUp("BC", true);
  });
  return sim.run(5000);
}
export function asymmetricScenario(f: Fixtures, seed = ACCEPTANCE_SEED) {
  const sim = new Simulation(seed).addNode(node("A")).addNode(node("B"));
  sim.addLink({
    id: "AB",
    from: "A",
    to: "B",
    bytesPerSecond: 24_000,
    latencyMs: 25,
    loss: 0,
    mtu: 512,
  });
  sim.addLink({
    id: "BA",
    from: "B",
    to: "A",
    bytesPerSecond: 2000,
    latencyMs: 250,
    loss: 0,
    mtu: 128,
    retryMs: 3000,
  });
  sim.inject("A", "fast-direction", f.good);
  sim.inject("B", "slow-direction", f.sos);
  return sim.run(8000);
}
export function fairnessScenario(f: Fixtures, seed = ACCEPTANCE_SEED) {
  const sim = new Simulation(seed).addNode(node("A")).addNode(node("B"));
  pair(sim, "A", "B", 100_000, 10, 0, 512);
  sim.inject("A", "bulk", f.bulk, { priority: "bulk" });
  f.queued.forEach((bundle, i) =>
    sim.inject("A", "urgent-" + i, bundle, { priority: "sos" }),
  );
  return sim.run(10_000);
}

export function runAcceptanceSuite(seed = ACCEPTANCE_SEED) {
  const f = fixtures();
  const reports = {
    partitionPowerLoss: partitionScenario(f, seed),
    congestion: congestionScenario(f, seed),
    storagePinned: storageScenario(f, true, seed),
    storageEviction: storageScenario(f, false, seed),
    ttlAndHopLimit: ttlScenario(f, seed),
    asymmetric: asymmetricScenario(f, seed),
    fairness: fairnessScenario(f, seed),
    authenticControl: controlScenario(f, {}, seed),
    brokenRouting: controlScenario(f, { routingDisabled: true }, seed),
    brokenVerification: controlScenario(
      f,
      { verificationBypassed: true },
      seed,
    ),
  };
  const checks: Array<{ name: string; pass: boolean; failures: string[] }> = [];
  const add = (
    name: string,
    report: SimulationReport,
    expected: Parameters<typeof assess>[1],
  ) => checks.push({ name, ...assess(report, expected) });
  add("partition-heal deliveries and expiration", reports.partitionPowerLoss, {
    required: [
      { node: "C", label: "sos" },
      { node: "C", label: "bulk" },
    ],
    forbidden: [{ node: "C", label: "short-ttl" }],
  });
  add("congestion preserves SOS", reports.congestion, {
    required: [{ node: "B", label: "sos" }],
  });
  add("pinned storage rejects replacement", reports.storagePinned, {
    forbidden: [{ node: "B", label: "replacement" }],
  });
  add("unpinned storage evicts for replacement", reports.storageEviction, {
    required: [{ node: "B", label: "replacement" }],
  });
  add("TTL and hop limit", reports.ttlAndHopLimit, {
    required: [{ node: "B", label: "one-hop" }],
    forbidden: [
      { node: "B", label: "expired-in-flight" },
      { node: "C", label: "one-hop" },
    ],
  });
  add("asymmetric directions deliver", reports.asymmetric, {
    required: [
      { node: "B", label: "fast-direction" },
      { node: "A", label: "slow-direction" },
    ],
  });
  add("fairness makes bulk progress", reports.fairness, {
    required: [
      { node: "B", label: "bulk" },
      { node: "B", label: "urgent-8" },
    ],
  });
  add(
    "real signatures and chunks verified",
    reports.authenticControl,
    controlExpectations,
  );
  const routingControl = assess(reports.brokenRouting, controlExpectations),
    verificationControl = assess(
      reports.brokenVerification,
      controlExpectations,
    );
  const conditions = [
    [
      "loss and retransmission exercised",
      reports.partitionPowerLoss.links.some(
        (l) => l.lostSegments > 0 && l.retransmits > 0,
      ),
    ],
    [
      "bulk resumes after low power",
      reports.partitionPowerLoss.deliveries.some(
        (d) => d.node === "C" && d.label === "bulk" && d.at >= 10_000,
      ),
    ],
    [
      "SOS precedes bulk",
      (reports.partitionPowerLoss.deliveries.find(
        (d) => d.node === "C" && d.label === "sos",
      )?.at ?? Infinity) <
        (reports.partitionPowerLoss.deliveries.find(
          (d) => d.node === "C" && d.label === "bulk",
        )?.at ?? -Infinity),
    ],
    [
      "queue exhaustion exercised",
      reports.congestion.links.some((l) => l.droppedQueue > 0),
    ],
    [
      "storage exhaustion exercised",
      reports.storagePinned.nodes.some((n) => n.rejectedStorage > 0),
    ],
    [
      "storage eviction exercised",
      reports.storageEviction.nodes.some((n) => n.evicted > 0),
    ],
    [
      "disabled routing detected",
      !routingControl.pass &&
        routingControl.failures.includes(
          "Missing required delivery valid at C",
        ),
    ],
    [
      "bypassed verification detected",
      !verificationControl.pass &&
        verificationControl.failures.some((x) =>
          x.startsWith("Forbidden delivery"),
        ),
    ],
  ] as const;
  for (const [name, pass] of conditions)
    checks.push({ name, pass, failures: pass ? [] : [name] });
  return {
    kind: "SIMULATION" as const,
    seed,
    pass: checks.every((x) => x.pass),
    checks,
    negativeControls: {
      routingDisabled: routingControl,
      verificationBypassed: verificationControl,
    },
    reports,
  };
}
