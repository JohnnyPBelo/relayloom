# Durable send and recipient confirmations — implementation contract

This records the Node/Go outbox implementation after `c3f5b42`. Existing `publish` remains the general signed-content API; the messenger UI uses the durable `send` path. Exact executed unit, mixed-process and browser results are in `OUTBOX-REVIEW.md`, `NATIVE-OUTBOX.md`, `OUTBOX-DESIGN-REVIEW.md` and `STATUS.md`. Their evidence does not imply all-platform or physical-device validation. No custom crypto primitives, server or new provider are introduced.

Durability boundary: this slice exercises process stop/restart and injected write failures. Atomic persistence flushes the file and, on POSIX, its parent directory after rename. The available Node/Go APIs do not provide a portable Windows directory flush. Real power interruption, filesystem/controller write-cache behavior and physical media failure are not validated by these tests; do not claim power-loss certification.

## API and acceptance point

- `POST /api/send {operationId, content, recipients, ttlMs?}` accepts private `message` content only. `operationId` is a canonical UUIDv4 supplied by the client; at least one recipient other than the author is required. The usual roster, ACL, content and TTL validation still applies.
- The server fingerprints the original request's content, sorted unique recipients and effective TTL using canonical JSON/SHA-256. A repeated operation ID with the same fingerprint returns the same content ID/status; a different fingerprint fails. While the operation record is retained, it does not silently create a second signed bundle after a lost response. Idempotency is finite: up to256 retained records, with pending entries protected from metadata eviction. After a terminal record is pruned, the raw API cannot recognize an old UUID and may create a new bundle. The UI checks fresh unlocked state before retrying an uncertain operation and requires an explicit new-send choice if its record is absent.
- Prepare and validate the bundle without broadcasting. Persist an encrypted `privateState.outbox[operationId]` entry with phase `preparing`; store its exact bundle pinned; then persist phase `ready`. Only then report local acceptance or attempt transport. If the process stops between writes, recovery verifies the original bundle/reference and either makes the same entry ready or marks it unavailable. A preparation without surviving bytes is an explicit failure, not delivery. A failed transport attempt after local acceptance does not turn the API response into a failed publication.
- `send` returns `{accepted:boolean, id, outbox: OutboxItem}`. `accepted` means the original content was stored and journalled, never delivery. An unavailable/expired record remains idempotent with `accepted:false` if its bytes are gone. Explicit retry of a terminal missing-content record must not generate a different bundle.
- `POST /api/outbox-retry {operationId}` requests another attempt of the exact surviving bundle, subject to normal retry, block, expiry and storage checks. It does not resign content or widen readers.
- `state.outbox` contains all retained entries only while unlocked; a locked snapshot returns `[]`. `state.outboxPolicy` reports `{maxRecords:256,maxPending:128,maxPendingBytes:33554432,idempotency:"retained-records"}` in both states. Absence while locked does not mean an operation was forgotten. This collection has a separate metadata bound from paginated `state.objects`, so expiry and receipt state do not disappear when content/events leave the current page.

## Persistent record and bounds

Records are encrypted/authenticated by the existing private-state mechanism. Property names shared by Node and Go:

```text
operationId, fingerprint, id, author, conversation, preview,
created, expires, priority, bytes, phase, attempts,
lastAttemptAt, nextAttemptAt, lastError, manualPin, confirmations
```

`phase` is `preparing|ready|unavailable`; `preview` is at most160 UTF-16 code units; timestamps are integer milliseconds; `lastError` is a bounded user-safe explanation. `confirmations` maps each original reader ID other than the author to `{receivedAt?:number, readAt?:number}`. Do not store private keys or raw attachment bodies in this metadata.

Bounds: at most128 pending entries,32 MiB of pending serialized bundle bytes and256 total entries. Store quota/count limits remain independent and may reject earlier. Remove oldest terminal metadata first when admitting a new record; never silently evict a pending intent to admit another. Validate restored metadata, identity ownership, IDs, enums, times, quotas and recipient uniqueness. Reject corrupt/incompatible journal data without guessing delivery.

Pending content is pinned in the existing store. A user cannot unpin away the pending reserve; return an explanation. An explicit user pin sets `manualPin`. Once all recipients confirm receipt, content expires or becomes unavailable, release the automatic pin while retaining an explicit user pin. Quota decreases still obey store atomic-admission rules. Pinning is retention, not delivery or recall.

## Sending and status

Own pending messages are retried after unlock/restart when a connected path appears, independently of the user's relay-for-others setting. While locked the app cannot read this journal; it does not claim new durable retries based on unavailable plaintext metadata. Existing encrypted router queues retain their normal policy/TTL.

Flush at most two due entries per sync, ordering SOS before normal before bulk and then creation/ID. Retry delay starts at2.2s and grows exponentially to60s. Record a bounded attempt before broadcasting and catch capacity/transport errors; the sync timer must not crash the process. Verify exact bundle bytes on every attempt. No receipt means pending even if a relay ACKed a packet. Low-power and bounded transport scheduling remain effective.

Derived `OutboxItem` fields: stored record fields except fingerprint/phase/confirmations, plus `status` (`pending|received|read|expired|unavailable|blocked`), `accepted`, `contentExpired`, `receivedCount`, `readCount`, `recipientCount`, `retained` (currently verified, unexpired bytes present, separate from the automatic pending pin) and `recipients:[{id,receivedAt?,readAt?}]`. Read implies received. `read` requires all recipients; `received` requires all recipients. Incomplete entries with an elapsed content deadline show `expired`. Confirmations already observed remain historical facts after content expiry. Missing/corrupt pending bytes show `unavailable`. A blocked recipient suppresses new app retry attempts and reports `blocked`; this is not recall of fragments/peer copies.

Blocked incomplete entries still count against pending/reservation limits and remain pinned. Confirmation timestamps are the first local observation of an authorized event, not the remote signer's clock. Read fills `receivedAt` only if absent; replay/reissue never changes existing timestamps or increments an already counted recipient.

This slice does not add a cancel/recall promise. General cache inventory and already queued packets are not presented as a cancellable transaction. A later explicit cancellation design must address router retention and seeding separately.

## Signed receipt protocol

- Keep legacy `receipt` meaning **read**. Introduce a distinct content kind `delivery` with `{type:"delivery", target:<messageId>}` for recipient acceptance. An old client that ignores unknown display types cannot mistake a new delivery event for a read receipt.
- `delivery` is private, signed by a non-author original recipient, targets only a semantically authorized private message, and has exactly the original reader set. Apply the same original/related-event ACL checks as read receipts, including public/wrong-author/wrong-reader rejection.
- An unlocked node issues a delivery event only after storing, verifying and authorizing the original message. Bound automatic issuance to two per sync. A retained own delivery/read event suppresses duplicates; if that event was evicted, a later signed reissue is allowed within bounds. Seeing content as an intermediary without read authority never issues a recipient confirmation.
- A read receipt implies delivery, including for older compatible peers. Aggregate only freshly verified/authorized events against the original message, before pagination, and persist the result into the sender's encrypted outbox. Replays, other targets and foreign authors cannot advance it. Read/received counters never regress when receipt objects are evicted or restart occurs.
- In a fixed group containing a locally blocked reader, viewing an otherwise authorized message must still work; suppress new automatic delivery/read receipts to that reader set. Do not turn a failed automatic receipt into a failed attachment read. Blocking does not revoke old keys or erase old confirmations.

## Required gates and ownership

During implementation root owned Node application/API/UI and Node/browser tests; `transport_hardening` owned `native/app/**` and native outbox tests. Independent review and mixed-process tests were subsequently delivered and integrated; actual returned task evidence is in `AGENTS.md`. Android/Apple bindings must be rebuilt after engine changes, and final packages must identify their exact native and web assets.

Test both engines: offline accept + restart + relay disabled + later path; exact idempotent retry and changed-operation rejection; full reserve and atomic failure boundary; transport failure after accepted storage; short TTL during partition with durable expired UI; missing/corrupt reserved bytes; signed per-member delivered/read state; forged/public/wrong-reader/replayed receipts; confirmations beyond the latest100 objects; lock privacy and encrypted journal; blocked group attachment/read behavior; bounded retries and queues. Use real multi-process controls for final delivery and browser UI; unit clock/failure injection alone is not network evidence.
