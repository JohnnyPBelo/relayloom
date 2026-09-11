import { test } from "node:test";
import assert from "node:assert/strict";
import { TRANSPORT_LIMITS } from "../packages/transport/src/index.js";
import { Simulation, assess } from "../packages/simulation/src/index.js";
import {
  ACCEPTANCE_SEED,
  fixtures,
  partitionScenario,
  controlScenario,
  controlExpectations,
  congestionScenario,
  storageScenario,
  ttlScenario,
  asymmetricScenario,
  fairnessScenario,
  runAcceptanceSuite,
} from "../packages/simulation/src/scenarios.js";

test("seeded virtual time is reproducible with independently generated secure fixtures", () => {
  const first = partitionScenario(fixtures()),
    second = partitionScenario(fixtures());
  assert.deepEqual(first, second);
  assert.equal(first.kind, "SIMULATION");
  assert.equal(first.bounds, TRANSPORT_LIMITS);
  const different = partitionScenario(fixtures(), ACCEPTANCE_SEED + 1);
  assert.notDeepEqual(
    first.links.map((l) => l.lostSegments),
    different.links.map((l) => l.lostSegments),
  );
});
test("loss, MTU fragmentation, partition/heal, low-power transition and SOS-before-bulk", () => {
  const report = partitionScenario(fixtures());
  const at = (label: string) =>
    report.deliveries.find((d) => d.label === label && d.node === "C")?.at;
  assert.ok(at("sos")! >= 2500);
  assert.ok(at("bulk")! >= 10_000);
  assert.ok(at("sos")! < at("bulk")!);
  assert.equal(at("short-ttl"), undefined);
  assert.ok(report.links.some((l) => l.lostSegments > 0 && l.retransmits > 0));
  assert.ok(report.trace.some((e) => e.event === "link-healed"));
  assert.ok(
    !report.trace.some(
      (e) =>
        e.event === "frame-sent" &&
        e.link === "BC" &&
        e.label === "bulk" &&
        e.at < 10_000,
    ),
  );
  assert.equal(
    assess(report, {
      required: [
        { node: "C", label: "sos" },
        { node: "C", label: "bulk" },
      ],
    }).pass,
    true,
  );
  for (const link of report.links) {
    assert.ok(link.maxWireSegment <= link.mtu);
    assert.ok(link.maxFrameBytes <= TRANSPORT_LIMITS.maxFrameBytes);
  }
});
test("directed bandwidth, latency and MTU produce measurable asymmetric arrival times", () => {
  const r = asymmetricScenario(fixtures());
  const fast = r.deliveries.find((d) => d.label === "fast-direction")!,
    slow = r.deliveries.find((d) => d.label === "slow-direction")!;
  assert.ok(fast.at >= 25);
  assert.ok(slow.at >= 250);
  assert.ok(slow.at > fast.at * 2);
  assert.ok(
    r.links.find((l) => l.id === "BA")!.segments >
      r.links.find((l) => l.id === "AB")!.segments,
  );
});
test("congested bounded queues preserve SOS while bulk is deferred", () => {
  const r = congestionScenario(fixtures()),
    link = r.links.find((l) => l.id === "AB")!;
  assert.ok(link.droppedQueue > 0);
  assert.ok(link.maxQueueBytes <= 6500);
  assert.ok(link.maxQueueObjects <= 4);
  const sos = r.deliveries.find((d) => d.label === "sos" && d.node === "B")!;
  assert.ok(sos.at < 3000);
  assert.ok(
    r.deliveries
      .filter((d) => d.label.startsWith("bulk-") && d.node === "B")
      .every((d) => d.at >= 3000),
  );
});
test("bounded cache distinguishes pinned exhaustion from unpinned eviction", () => {
  const f = fixtures(),
    pinned = storageScenario(f, true),
    evicted = storageScenario(f, false);
  assert.ok(pinned.nodes.find((n) => n.id === "B")!.rejectedStorage > 0);
  assert.equal(
    pinned.deliveries.some((d) => d.node === "B" && d.label === "replacement"),
    false,
  );
  assert.ok(evicted.nodes.find((n) => n.id === "B")!.evicted > 0);
  assert.ok(
    evicted.deliveries.some((d) => d.node === "B" && d.label === "replacement"),
  );
  for (const report of [pinned, evicted])
    assert.equal(assess(report, {}).pass, true);
});
test("TTL rejects in-flight expiration and retained replay respects the hop limit", () => {
  const r = ttlScenario(fixtures());
  assert.ok(r.nodes.find((n) => n.id === "B")!.rejectedEnvelope > 0);
  assert.ok(r.deliveries.some((d) => d.node === "B" && d.label === "one-hop"));
  assert.equal(
    r.deliveries.some(
      (d) =>
        d.label === "expired-in-flight" ||
        (d.node === "C" && d.label === "one-hop"),
    ),
    false,
  );
  assert.ok(r.links.some((l) => l.expired > 0));
});
test("every-fourth-fragment fairness lets bulk advance during SOS pressure", () => {
  const r = fairnessScenario(fixtures());
  const frames = r.trace.filter(
    (e) => e.event === "frame-sent" && e.link === "AB",
  );
  assert.ok(frames[0].label!.startsWith("urgent-"));
  assert.equal(frames[3].label, "bulk");
  const lastSos = Math.max(
    ...r.deliveries
      .filter((d) => d.label.startsWith("urgent-"))
      .map((d) => d.at),
  );
  assert.ok(frames.some((e) => e.label === "bulk" && e.at < lastSos));
  assert.ok(r.deliveries.some((d) => d.node === "B" && d.label === "bulk"));
});
test("real signature/chunk checks pass honest control and detect deliberately broken controls", () => {
  const f = fixtures(),
    good = controlScenario(f),
    noRouting = controlScenario(f, { routingDisabled: true }),
    noVerification = controlScenario(f, { verificationBypassed: true });
  assert.equal(assess(good, controlExpectations).pass, true);
  assert.ok(good.nodes.find((n) => n.id === "B")!.rejectedCrypto >= 2);
  const routing = assess(noRouting, controlExpectations),
    verification = assess(noVerification, controlExpectations);
  assert.equal(routing.pass, false);
  assert.ok(routing.failures.includes("Missing required delivery valid at C"));
  assert.equal(verification.pass, false);
  assert.ok(
    verification.failures.includes(
      "Forbidden delivery bad-signature accepted at C",
    ),
  );
  assert.ok(
    verification.failures.includes(
      "Forbidden delivery bad-chunk accepted at C",
    ),
  );
  assert.ok(noVerification.deliveries.some((d) => !d.verified));
});
test("simulation rejects invalid transport bounds and complete report gates pass", () => {
  const sim = new Simulation(1).addNode({ id: "A", storageBytes: 100_000 }),
    f = fixtures();
  assert.throws(() =>
    sim.inject("A", "invalid-ttl", f.good, {
      ttlMs: TRANSPORT_LIMITS.maxTtlMs + 1,
    }),
  );
  assert.throws(() =>
    sim.inject("A", "invalid-hops", f.good, {
      maxHops: TRANSPORT_LIMITS.maxHops + 1,
    }),
  );
  const report = runAcceptanceSuite();
  assert.equal(
    report.pass,
    true,
    JSON.stringify(report.checks.filter((c) => !c.pass)),
  );
  assert.equal(report.negativeControls.routingDisabled.pass, false);
  assert.equal(report.negativeControls.verificationBypassed.pass, false);
});
