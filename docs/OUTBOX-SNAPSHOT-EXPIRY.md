# Outbox expiry across snapshot persistence

CI run `34663513261` for published commit `3d6641a` passed Node on Windows, Linux and macOS. Go unit/race checks and four interoperability cases passed, but the Go-sender mixed outbox case failed at `tests/native/outbox-network.test.ts:708`: the response already said expired while the automatic on-disk pin was still true. Desktop and iOS jobs were skipped by dependency; no new Apple execution is implied.

## Reproduction and cause

Root added actual-journal boundary regressions in both runtimes. They preserve an existing signed bundle and a `preparing` record, then delay its real preparation-to-ready journal write until the content deadline passes. Both original implementations failed once with the same invariant violation:

- `node scripts/go.mjs test -count=1 -p=2 ./app -run '^TestOutboxSnapshotExpiryDuringJournalWriteKeepsReservationConsistent$'`: exit1, 3.207s, “snapshot advertises expiry before releasing the automatic reservation”.
- `node --import tsx --test --test-name-pattern='snapshot crossing expiry' tests/outbox.test.ts`: exit1, 2.020s overall, “snapshot must release automatic reservation before advertising expiry”.

Reconciliation took time T1 and retained a still-pending reservation. Journal I/O or subsequent projection crossed the expiry. The response then derived its status at a different time T2, advertising expiry before the next reconciliation released the pin. This is a snapshot consistency defect, not the earlier group/contact lookup failure and not a Copilot timeout.

## Correction verified locally

Each object snapshot now carries the exact observation time used for outbox reconciliation. The response uses that same time for outbox states and its `now` field. Send/retry result construction also reconciles its reservation and uses the same observation time for its returned status. A deadline crossed during persistence is reflected by a following snapshot, where the automatic reservation is released before expiry is displayed. No checks, TTLs, ACLs, quotas or mixed-process controls were relaxed.

The focused positive controls now cover state, repeated send and explicit retry. All three Node cases passed (5.411s overall), and the Go boundary test's three subcases passed with the race detector (12.244s). The regressions check the same original ID, no fabricated recipient delivery and eventual expiry with the automatic pin gone.

The frozen-source corrective gate completed successfully: build7.593s; Node93 tests53.895s (82 existing/application tests plus11 separate local group-certificate tests); Go11 core/11 transport/37 top-level application tests with race, application167.343s and command173.600s; rebuilt CLI0.668s; all5 interoperability cases95.978s; Node14 browser cases109.340s and Go14 cases103.092s. Every command exited0 and input hashes stayed unchanged during the sequence. The original mixed expiry/pin assertion was retained.

Evidence is in `docs/evidence/outbox/snapshot-expiry`. Actual mixed reports came from `.cache/native-mixed`, with their start/finish times verified inside the recorded interop command window. Source SHA-256 `19f8ea312219c6d8396cdc2f9357e9edd9614d2e648363c4e21e2acddedb62cd`; rebuilt CLI `d820088629fafdfd5c7e937580d6e8e24f2a9fe148858ea5ee45967c0768a0b7`. Previously published mixed reports under `docs/evidence/outbox/mixed` retain the older66a18d/4e18b8 evidence and are not the source of this new result.

Native bindings/APKs built before this fix retain their earlier evidence and need rebuilding for the correction. New group certificate work is separate, unintegrated local work; it did not participate in the failed CI run. A subsequent onboarding layout correction has its own UI/build evidence; the old web asset names in this frozen input manifest must not be relabelled as that later layout.
