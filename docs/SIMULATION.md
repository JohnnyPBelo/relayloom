# Deterministic network simulation

**SIMULATION — not real transport, radio, mobile background execution, or emergency infrastructure validation.**

The package in `packages/simulation` runs a bounded virtual-time event model. It does not start the production Router, sockets, a PTY, serial hardware, or a radio. The real multi-process/heterogeneous tests remain separate evidence.

Run from the repository root using the existing dependencies:

```sh
node_modules/.bin/tsx --test --test-concurrency=1 tests/simulation.test.ts
node_modules/.bin/tsx scripts/simulate.ts
node_modules/.bin/tsx scripts/simulate.ts 1369907238
```

The script prints a JSON report and exits nonzero if a baseline gate fails or a deliberately broken control escapes detection. It does not write files itself. A report can be saved by the caller under `docs/evidence` without giving the script access to any external service.

## What is real and what is modeled

| Component | Implementation and evidence boundary |
| --- | --- |
| Cryptography | Real `createIdentity`, `createBundle`, `verifyManifest`, and `verifyBundle` from the core public API. Ed25519 signatures and encrypted chunk hashes are checked after simulated fragment reassembly. Damaged signatures and ciphertext fixtures are rejected. Delivery means verified encrypted bundle acceptance in this model, not recipient decryption or LoomNode semantic/UI acceptance; public message fixtures exercise the bundle layer and would be rejected by the live private-message domain rule. This simulation does not add new cryptographic primitives. |
| Bounds | Imports `TRANSPORT_LIMITS` from the transport package: 6 MiB packets, 16 MiB per-link pending bytes, 2048-byte application fragments, 4096-byte JSON frame limit, 64 transfers, 8 assemblies, 12 hops, and one-hour maximum envelope TTL. The core maximum stored-object count is also enforced. |
| Application framing | Canonical transport envelopes and the current `{t:'part', id, index, count, data}` JSON frame shape are serialized and reassembled as bytes. This uses the frame shape and bounds; it does not exercise the production streaming parser. |
| Directed links | Independent bytes/second, propagation latency, loss probability, MTU, pending-byte/object limits, retry interval, and up/down state in each direction. ACKs need a separately configured reverse link and consume that link's capacity. Parameters are illustrative test inputs, not measurements of hardware. |
| MTU and loss | Each application frame is split into modeled medium segments with a 24-byte accounting header. Independent seeded loss applies per segment. A frame arrives only if all its segments survive. This is a model of an unreliable medium adapter; TCP/serial streams do not natively expose these modeled datagrams. |
| Scheduling | Non-preemptive transmission of the current application frame; SOS has next-frame priority. Every fourth eligible data-frame selection uses least-recently-served fairness. Admission reserves reassembly capacity between priority classes. Configured low power defers bulk until disabled. This models the production policy rather than executing the live scheduler. |
| Retry and partition | A packet without a returned ACK is retried after the configured virtual interval. Surviving application fragments remain in bounded reassembly storage. A partition loses in-flight frames; healing resumes retained eligible traffic, subject to envelope TTL and hop limits. |
| Storage | In-memory byte/object quotas, pinned objects, and oldest-stored unpinned eviction; these scenarios have no independent reader-access events. Admission computes a complete eviction plan before mutation. This is a quota/cache model, not a test of ContentStore's disk persistence, crash recovery, or independent router retention memory. |
| Guardrails | Up to 200,000 processed events per run, a one-virtual-hour horizon, 20,000 trace entries with an explicit omitted count, bounded transfer/assembly buffers, and a 4096-entry duplicate map. Reports expose peak observed storage, queues, assemblies, frame bytes, and medium segment sizes. |

The seed controls event ordering and loss only. Keys, signatures, nonces, and ciphertext continue to use production secure randomness. The report uses stable fixture labels, virtual times, and byte counts rather than random identity/content IDs or real timestamps. A test constructs fresh secure fixtures twice and compares the entire seeded report for equality.

Manifest verification checks expiry against the bundle's signed creation time plus virtual elapsed time. `verifyBundle` additionally performs its normal real-time validity checks. Test bundles last one real hour and scenarios finish in milliseconds of host time; these tests do not replace clock-skew/long-duration cryptographic tests.

## Acceptance scenarios

| Scenario | Concrete assertions |
| --- | --- |
| Partition, loss and low power | A → B → C, no direct A → C link. Forward/reverse links have different speeds and latencies. B → C starts partitioned and heals at 2500 ms. B defers bulk until 10000 ms. 4% seeded segment loss exercises retransmission. SOS arrives at C before bulk; the short-TTL item cannot survive the partition. |
| Asymmetric links | Opposite directions use 24,000 versus 2,000 bytes/second, 25 versus 250 ms latency, and 512 versus 128-byte MTU. Both deliver; the slower direction arrives later and uses more segments. |
| Congestion | A 6500-byte/four-object link queue receives nine bulk items during low power, followed by SOS. Drops occur, queue peaks stay bounded, SOS arrives before bulk resumes. |
| Storage exhaustion | A peer with a one-object quota cannot replace a pinned object. With that object unpinned, it evicts and accepts the replacement. Both peak-byte/object limits remain satisfied. |
| TTL and hop limit | Expiration during propagation rejects the packet before acceptance. A one-hop item reaches B but never C, including when B's outgoing link is healed later. |
| Fair scheduling | SOS is selected first, while the fourth data-frame turn advances bulk before all urgent items finish. Both priority classes eventually deliver. |
| Real verification | An authentic bundle reaches C. A separately damaged Ed25519 signature and encrypted chunk are rejected at B and cannot be displayed/relayed by the model. |
| Broken routing control | The same required-delivery assessment fails with `Missing required delivery valid at C` when modeled forwarding is deliberately disabled. The test succeeds only because it detects that failure. |
| Broken verification control | The same assessment fails for both forbidden damaged fixtures when the model's core-verification callback is deliberately bypassed. The test succeeds only because it detects those failures. |

The broken controls affect only the simulation's explicit fault switches. They do not modify production code, disable real application verification, or claim that live-network fault injection was performed.

## Recorded verification

On 2026-09-11, `node_modules/.bin/tsx --test --test-concurrency=1 tests/simulation.test.ts` passed 9/9 tests with no skips. The default report seed is `1369907238` (`0x51a72026`), and the report passed all 16 baseline/detection gates. Both negative-control assessments intentionally returned `pass: false` with the expected failures.

For this seed, SOS reached C at virtual 2826 ms and bulk at 37877 ms. A → B and B → C each retried three times; their maximum medium segments were 512 and 256 bytes. The short-TTL message reached B at 267 ms and did not reach C. These numbers are outputs from the defined model and fixture sizes, not network benchmarks.

The repository TypeScript check (`node_modules/.bin/tsc --noEmit --pretty false`) also completed successfully after integration of the simulation module. Hardware radio behavior, OS scheduling, transport interoperability, real-device battery use, persistent-disk failure, and a production-router simulation harness remain unverified by this package.
