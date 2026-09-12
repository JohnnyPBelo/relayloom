# Native durable outbox and recipient confirmations

Implementation evidence for the native application slice following `c3f5b42`.
The wire/API contract is [OUTBOX-PROTOCOL.md](OUTBOX-PROTOCOL.md). This document
records native implementation and local tests; independent mixed-process and
browser evidence belongs to the corresponding review reports.

## Implementation

- `native/app/outbox.go` adds UUIDv4 request idempotency, canonical request
  fingerprinting, encrypted `preparing`/`ready`/`unavailable` records, exact-bundle
  recovery, pending reservations, derived status, explicit retry and manual pin
  ownership. A repeated retained operation never creates another signed bundle.
- Publication preparation is separated from storage and broadcasting. Durable
  send writes the encrypted preparation first, stores the bundle pinned, then
  writes `ready`. Storage failure preserves an unavailable operation; interruption
  after storage can recover the original bytes. Transport errors after acceptance
  leave the saved message pending with a bounded explanation.
- If a private-state write reports an error after a potentially committed rename,
  the app rereads and authenticates the actual disk state before another write.
  An unreadable outcome locks the identity and clears in-memory private state,
  preserving the original error and preventing an uncertain operation from being
  overwritten. The tests inject errors after the real writer has completed.
- Pending reservations are limited to 128 entries and 32 MiB of serialized
  bundles. Metadata is limited to 256 entries; admission removes the oldest
  terminal metadata only. Blocked incomplete messages remain pending for these
  bounds and keep their automatic reserve.
- Native sync retries at most two due own messages, including with `relay=false`,
  in SOS/normal/bulk order followed by creation/ID. Attempts are journalled before
  transport; backoff starts at 2.2 seconds and caps at 60 seconds. Every attempt
  verifies the original bundle. Lock wipes the in-memory journal and exposes an
  empty outbox snapshot; existing router queues retain their normal policy.
- A manual retry may shorten the automatic backoff after a 2.2-second cooldown;
  its due time is persisted before transport. `state.outboxPolicy` advertises the
  fixed bounds and `idempotency: "retained-records"` even while locked. Idempotency
  is guaranteed while the operation metadata is retained; terminal metadata can
  be forgotten at the 256-record limit. Pending operations are never pruned.
- Each snapshot shares one freshly verified store-manifest map across object
  summaries, ready-record reconciliation and outbox display. It does not parse
  or decrypt pending attachment bodies again. Preparing/restart recovery and
  transport attempts still verify exact canonical bundle bytes. The store's
  existing full-byte fingerprint checks are preserved.
- `native/app/confirmations.go` implements private signed `delivery` events and
  preserves legacy `receipt` as read. Only original non-author readers with the
  exact reader set may advance status. Confirmation timestamps are the first
  local authorized observation and are not rewritten by replays/reissues. Read
  implies delivery; aggregate receipt/read requires every original recipient.
- Incoming confirmations are authorized and journalled before store admission
  can evict an already-unpinned original. Stored confirmations are also aggregated
  over the full authorized object set before the 100-object history pagination.
  Historical confirmations survive event eviction, restart and content expiry.
- Automatic delivery issuance is limited to two candidates per sync. A surviving
  verified own delivery/read suppresses duplicate delivery. Eviction permits a
  later bounded reissue. An unreadable intermediary cannot issue confirmation.
- A blocked member suppresses new automatic receipt issuance for the complete
  roster. Authorized group view/attachment access succeeds. Automatic receipt or
  contact-learning failure cannot turn an authorized view into an API error.
- An already retained group created by a blocked member remains an internal
  signature/roster dependency for messages from other, unblocked authors. The
  blocked creator's group is hidden from returned history and direct view stays
  denied. Incoming new content from blocked authors remains filtered.
- Explicit pins are tracked independently from pending automatic pins. Pending
  unpin is rejected with an explanation. All-received, expired or unavailable
  entries release automatic pins while preserving explicit manual pins.

## Native regression coverage

`native/app/outbox_test.go` adds 18 focused tests covering:

1. Offline acceptance, encrypted journal, restart, locked snapshot, stable ID and
   exact bytes, later real TCP connectivity with relay disabled at both native
   nodes, distinct received/read transitions and reserve release.
2. Equivalent recipients/default TTL idempotency, changed-operation rejection,
   invalid API input and the 160 UTF-16-unit preview bound.
3. Preparing recovery with bytes, missing preparation bytes, corrupt bytes and
   expiry, including repeat send/retry without regeneration.
4. Over-quota storage failure and preparation-journal write failure; no premature
   accepted content or transport publication.
5. Per-member confirmations, forged/public/wrong-reader/self-author/wrong-target
   events, replay/reissue, more than 100 newer history objects, and restart after
   receipt eviction.
6. A fixed group whose creator is blocked: another author's view/attachment
   access, hidden blocked group definition, suppressed automatic confirmations,
   receipt transport failure, pending unpin rejection and manual pin retention.
7. Journalled transport failure after acceptance and exponential bounded retry.
8. Two-per-sync delivery issuance, duplicate suppression, eviction/reissue and
   an intermediary without a decryption key.
9. Strict restored schema, ownership, IDs/enums/time/preview/error/receipt bounds;
   128 actual reserved bundles and rejection of the 129th without eviction.
10. Oldest-terminal metadata eviction at the 256-record boundary.
11. A read event whose store admission evicts its original after delivery; the
    observed authorized read remains durable.
12. Eight real large private messages reserving approximately 32 MiB and rejection
    of the next message without losing any existing pending reservation.
13. A real connected path with two-per-flush SOS ordering and locked suppression.
14. Historical read confirmation after short content TTL and restart.
15. Errors after real preparation/ready writes; authenticated readback preserves
    the operation and restart never signs replacement content.
16. An unreadable uncertain write locks all further sends until the actual
    encrypted journal is recovered.
17. A warmed large-attachment snapshot allocates only metadata beyond a single
    verified store-list baseline, while subsequent disk corruption is rejected.
18. Manual retry cooldown and an offline due checkpoint surviving lock/unlock.

`native/app/app_test.go` also adds a saved-peer capacity regression: reconnecting
an already configured endpoint remains an idempotent no-op at the 16-peer limit,
while a new seventeenth endpoint is rejected before opening any socket.

The preparing recovery tests recreate the persisted interruption boundaries;
they do not simulate a physical power cut. The network tests here use two native
nodes with real TCP sockets in one Go test process. Separate process and Node/Go
interoperability tests are run independently.

## Gate results

The first stable full runs passed all 31 then-current native application tests:
normal `41.386s`; race detector `448.567s`. After the persistence-readback and
snapshot-cost improvements, the focused regression run passed (`3.214s`), all
35 then-current tests passed normally (`29.634s`) and with the race detector
(`164.316s`). The blocked-group-creator regression and related ACL/attachment
tests then passed (`1.254s`).

The final complete 36-test suite passes both gates on unchanged Go sources:

- `node scripts/go.mjs test -count=1 -p=2 ./app` — PASS, `30.164s`.
- `node scripts/go.mjs test -race -count=1 -p=2 -v ./app` — PASS, `164.164s`;
  no reported races.
- `git diff --check -- native/app docs/NATIVE-OUTBOX.md` — PASS.

The final race run includes the fixed blocked-group-creator test, the saved-peer
capacity regression, and all persistence, quota, retry, encryption and history
tests above. The large existing history fixture retained 37,595,070 encrypted
bytes and returned a 68,491-byte state snapshot; its warm verified-summary query
took approximately 249 ms under the race detector. These are test-fixture
measurements, not mobile-device or physical power-loss certification.

Native Go sources were released to the independent reviewer for an updated CLI
build and mixed Node/Go process tests after these gates. This subtask did not
build a CLI, AAR or APK and did not commit or push changes.

The prior contact-learning regression in
`TestApplicationMessagesGroupsReceiptsAndPrivacy` was reproduced and fixed
without relaxing ACLs or removing coverage. Its focused rerun together with the
receipt-admission eviction regression passed (`0.651s`). Early new-suite failures
were fixture issues (the corrupt-object path and the eviction LRU ordering); the
fixtures were corrected to force the intended real boundaries.

The core atomic-write helper was updated separately by the root implementation
to synchronize files and parent directories on POSIX. Native app validation uses
that current helper. There is no physical power-loss certification, no Windows
directory-sync guarantee, and no new cancellation/recall promise. The final
Android artifacts must be rebound after the engine changes.
