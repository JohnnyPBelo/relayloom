# Durable outbox review — 2026-09-12

This is an independent review of the new outbox/confirmation slice authored by root (Node) and `transport_hardening` (Go), plus reviewer-authored mixed-process regression tests. The reviewer previously authored parts of the underlying native application/core; this is not represented as an independent review of that entire older implementation.

## Contract review

The contract correctly separates local acceptance from transport ACK and recipient delivery, retains the existing read-receipt meaning, binds private confirmation events to the original reader set, and preserves historical confirmations outside content pagination. Idempotent operation IDs refer to the exact original signed bundle. An incomplete blocked intent cannot be treated as terminal for reservation or metadata eviction.

Root clarified three points before the gate:

- An incomplete `blocked` entry still consumes the 128-entry / 32 MiB pending reserve and remains automatically pinned. Only all-recipient receipt, expiry or unavailability releases that reserve.
- `receivedAt` and `readAt` record the first local observation of a verified, authorized event, not the signer's clock. Replays/reissues do not change existing timestamps or counters. Read fills received only when it was absent.
- Idempotency is limited to the at-most-256 retained operation records. Pruning terminal metadata also forgets its UUID-to-content mapping; a raw API replay after that point can create a new bundle. Root accepted this finite scope and owns explicit API/contract/UI wording plus composer protection against silently retrying a prior operation absent from fresh state. Pending records remain protected from pruning. No indefinite deduplication guarantee is claimed.

**OB-1 — P1, corrected: existing atomic helpers did not fully establish the stated durability boundary.** At review, Node `packages/core/src/index.ts:60` used write plus rename without synchronizing the file; Go `native/core/store.go:18` synchronized the file before rename but omitted directory synchronization. Root accepted the finding and authored the correction. Atomic rename and process-restart tests alone are not evidence of surviving hardware power loss.

Source follow-up: the reviewer inspected root's updated Node helper (exclusive temp creation, file synchronization, rename, POSIX directory synchronization and temp cleanup) and updated Go helper (file synchronization plus POSIX directory synchronization after rename). Both explicitly delimit the lack of portable Windows directory flushing. This is source evidence; no physical power-cut test was executed.

**OB-2 — P2, corrected: receipt admission could evict its original before confirmation journalling.** Once every recipient has delivered, the message loses its automatic pin while read confirmations may still be pending. The reviewed Go receive path called `Store.Put` before authorizing/journalling the incoming confirmation. At a tight quota, a valid read event could evict its original during admission and lose the evidence needed to record read. The author now validates the incoming bundle and original and journals the observation before receipt storage can evict the original, with a targeted regression. The same ordering risk was reported and corrected in Node. Source follow-up verified both receive paths; the tight-quota regression is Go-author-run evidence, distinct from the mixed tests below.

Additional Node consistency issues were accepted and corrected by root: `retained` was derived from pending reservation rather than actual surviving bytes, and `accepted` could stay true for an already-confirmed record after its content was evicted; receipt emission depended on successful contact-book growth/persistence; an in-memory read-receipt veto could outlive the retained receipt. Source follow-up shows Node querying verified store presence, journalling valid incoming confirmations before store admission, learning contacts best-effort, preparing internal confirmations from original signed member cards and suppressing reissue only for a surviving own event. The mixed gate below confirms live retained-byte reporting, missing-byte history, signed reissue and group behavior. Contact-book write failure and automatic read-event eviction remain complementary author/unit checks.

The Go author also identified a group-dependency case, which the reviewer agreed should be covered: a blocked group creator's definition may stay hidden while its verified signed roster still authorizes a later message by an unblocked member. The network fixture now creates the group at B, sends the actual message from A and blocks B at C; C must still read A's message/attachment while suppressing automatic confirmations to the blocked reader set. This finding originated with the Go author, not the independent reviewer.

## Mixed network gate executed

`tests/native/outbox-network.test.ts` uses both sender directions: Node → Go relay → Go reader, and Go → Node relay → Node reader. Each scenario starts three actual application processes with isolated fixture directories and authenticated local APIs. A transparent TCP observer forwards bytes unchanged and matches a relay ACK to the original content bundle. A separate adversarial peer in the test driver supplies malformed or semantically unauthorized signed events over actual sockets; it is identified as test infrastructure, not counted as a fourth application process.

Each report records the native binary and production-source SHA-256 digests, and the test fails if engine sources change while its processes/restarts run. Reports contain control outcomes rather than launch capabilities or private keys.

Executed controls cover offline acceptance, encrypted metadata, idempotency/conflict handling, automatic pin protection, sender restart with relay disabled, actual relay ACK without recipient confirmation, forged/public/widened-reader/wrong-target events with a valid same-path canary, valid delivery versus explicit read, exact replay and fresh reissue stability, fixed-group partial confirmation, blocked-group attachment/read behavior, suppressed retries with retained pin, confirmation persistence past 100 objects, actual socket partition with short TTL, expired restart/retry and locked snapshot privacy. A separate failure-injection control removes owned fixture bundles only while their process is stopped: pending bytes became unavailable, while historical read confirmations survived missing content and retained operation IDs did not create replacements.

The final metadata-retention control issues 256 additional short-lived sends while disconnected, with bounded request cadence so expiry keeps pending count below 128. Total metadata must remain capped at 256 and an older incomplete intent must remain pinned/idempotent. A raw API replay of an already-pruned operation explicitly demonstrates the finite guarantee; the composer's response to forgotten operations is a separate root-owned browser gate.

| Reviewer-executed check                                                             | Actual result                                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run native:build`                                                              | Passed; built the current native CLI in `.cache/native-app/relayloom` after both authors released their production sources.                                                            |
| `node --import tsx --test --test-concurrency=1 tests/native/outbox-network.test.ts` | **2/2 passed**, zero failures/skips, **82.890 seconds** total. Node sender → Go relay → Go reader: **40.666 seconds**. Go sender → Node relay → Node reader: **42.027 seconds**.       |
| Production version consistency                                                      | Both scenarios used the same CLI and scoped Node/Go production-source digests; the source-stability assertions passed across every restart.                                            |
| Authenticated API and process cleanup                                               | Every test request used each process's own local capability. Both reports contain `cleanupErrors: []`; fixture processes stopped cleanly. Successful fixture directories were removed. |
| `npm run typecheck` and `git diff --check`                                          | Passed on the final mixed-test source and current integration tree.                                                                                                                    |

The successful run took place on Linux with Node **22.22.3**, from **2026-09-11T23:27:14.990Z** to **2026-09-11T23:28:37.682Z** (2026-09-12 local Europe/Lisbon). The first execution stopped at a reviewer fixture error: it expected `publicKey: undefined`, while the private wire manifest correctly uses `publicKey: null`. The assertion was corrected and the complete two-direction gate reran successfully; no engine change was required for that correction.

Sanitized JSON evidence is checked in here; the originals remain under `.cache/native-mixed/`:

- [Node sender → Go relay → Go reader](evidence/outbox/mixed/outbox-node-sender.json)
- [Go sender → Node relay → Node reader](evidence/outbox/mixed/outbox-go-sender.json)
- Scoped production-source SHA-256: `66a18d61cc0a63b0bf30195462c2515912b333614d95dd69f1d503db409f830e`.
- Native CLI SHA-256: `4e18b8b15d0da0883586a4d3e51e1ecbec351afd1ce1545bcb773d8f8aca422d`.

The Go author separately reports **36/36 native application tests** passing normally (**30.164 seconds**) and with the race detector (**164.164 seconds**), including 18 new outbox tests and the saved-peer capacity regression. These results and their scope are recorded in `docs/NATIVE-OUTBOX.md`; the independent reviewer did not rerun that heavy suite. Reserve saturation, storage-write failure injection and byte-corruption recovery are covered by those complementary author/unit gates rather than claimed by the mixed network test. Physical power loss, mobile OS execution, radio hardware and the composer's UI safeguards are outside this gate.

No unresolved blocker remains from this bounded contract/new-engine review and mixed-process gate. Idempotency remains explicitly finite, and no physical power-loss guarantee is inferred from process restart or POSIX synchronization calls.
