# Independent application review

Reviewer: `/root/transport_hardening`, 2026-09-11. This assignment inspected application code written by other agents/root: `native/app/**`, `native/mobile/**`, and the collection, voice-recording and notification components. `apps/web/src/main.tsx` and the canonical response limit were read where needed to trace those components' integration. The reviewer did not present its own transport implementation as independently certified.

The initial assignment was a **static review**. During that assignment no source, configuration, dependency, SDK, native binary or AAR was changed, and no tests/builds were executed. Every finding was sent to root immediately. The findings below preserve that initial assessment; the later implementation assignment and executed verification are recorded separately at the end. The reviewer subsequently became the author of A-1/A-2/A-4 fixes, so those implementation results are not labelled as an independent review of its own code.

## Findings requiring correction or a documented bounded behavior

### A-1 — P1: request tracking can grow without limit when transmission fails

Sources: `native/app/node.go:257`, `:263`, `:295`; manual retrieval at `:921`.

The inventory handler inserts up to eight previously unseen IDs into `n.requests`, then calls `Router.Broadcast`. If that returns an error, the method exits before reaching the `len(n.requests) > 2048` cleanup. Manual retrieval similarly records `user:<id>` before an error-returning broadcast and reaches its cleanup only on success. The serving branch also has early returns after recording entries.

A concrete remote precondition is a routing retention table occupied by SOS-priority packets. Newly received SOS inventory packets can keep that table occupied while the application's normal-priority requests fail capacity admission. Each inventory containing new valid addresses then adds entries without executing the intended cap. This is an application bookkeeping failure even though transport queues remain bounded.

Recommended correction: impose the request-map bound at insertion or guarantee cleanup on every return path. Preserve per-ID throttling without allowing an error to bypass the cap. A regression should keep high-priority retention full, send more than 2,048 distinct missing references, make outgoing requests fail, and assert the application map remains bounded throughout. **Not executed by this reviewer.**

### A-2 — P1: legitimate cached content can make every state response fail

Sources: `native/app/node.go:432` and `:531`; `native/app/server.go:235`; referenced response codec bound `native/core/canonical.go:22` and `:42`.

`stateLocked` includes every authorized object, including complete base64 attachment bodies. The ordinary store quota is 128 MiB, but the canonical response encoder rejects aggregate JSON above 24 MiB. A legitimate set of individually valid cached objects can exceed the response limit well before exhausting the store quota. `respond` then returns HTTP 500 (`resposta inválida`) for the state snapshot. The web client depends on that complete snapshot, so normal UI recovery requires objects to expire/be removed or a different API strategy.

The same path rereads, verifies and decrypts the complete store while holding the node mutex on each state request. The web integration polls every two seconds. That makes large accepted stores a CPU, allocation and lock-latency risk even below the response cutoff; it can also delay locking and shutdown.

Recommended correction: define a bounded, usable snapshot contract with paging/metadata and on-demand content bodies, or another explicit budget that leaves content discoverable and retrievable. Raising the JSON cap alone would not address repeated complete-store processing. A regression should exceed 24 MiB of authorized aggregate payload within the normal quota and prove state remains usable, with exact on-demand bytes still available. **Not executed by this reviewer.**

### A-3 — P1: an older state response can restore private UI after locking

Integration sources: `apps/web/src/main.tsx:274`, `:283`, `:298`, `:315`, `:567`, and the lock action at approximately `:783`.

Every concurrent refresh applies `setState(await api("state"))` without ordering, cancellation or an identity/lock generation. The periodic refresh overlaps action-triggered refreshes. A state response computed before locking can be delayed and applied after the lock action's newer locked snapshot. That temporarily restores the old identity and private objects in the rendered UI until a later refresh corrects it. Because media and notification lifecycle decisions derive from that state, the stale snapshot can also remount recording controls or restore the notification identity context.

The isolated components correctly clean up when given a lock/identity transition; they cannot establish that the parent state is current. Backend authorization remains locked in this scenario, so the immediate impact is stale sensitive rendering and incorrect local lifecycle state, not a demonstrated server-side signing bypass.

Recommended correction: reject out-of-order state responses and invalidate all pre-lock/pre-identity-change requests before applying sensitive transitions. A browser regression should hold an old unlocked response, finish locking, then release the stale response and prove private content remains hidden and local sensitive components remain inactive. **Not executed by this reviewer.**

### A-4 — P2: incoming deletion semantics can be lost before materialization

Sources: `native/app/node.go:226`, `:432`, `:461`; existing local-publication persistence test `native/app/app_test.go:181`.

Incoming bundle handling verifies and stores the bundle but does not persist an authorized edit/delete in the local mutation journal. Materialization occurs later in `objectsLocked`, and it requires the original and related event to remain simultaneously available and decryptable. If storing a remote deletion evicts its original under quota pressure, or the deletion itself is evicted before the next object materialization, no tombstone is recorded. Retrieving the original later can expose it without the received deletion flag.

The existing regression covers local publication, whose `mutationTarget` is captured before insertion; it does not cover this receiving-side interval. This finding concerns persistence of a local deletion interpretation, not a promise that a distributed deletion can erase remote copies.

Recommended correction: when the receiver is unlocked and the original is available, validate and journal received authoritative mutations before an insertion can evict the needed evidence, or implement another bounded tombstone strategy. Test a valid remote deletion against a small receiver quota, remove the event, replay the original, and verify the deletion survives restart. Locked/missing-original cases need an explicit, honest limitation. **Not executed by this reviewer.**

## Inspected controls that are present

These observations describe code paths; they do not expand the execution evidence:

- Native inbound display authorization checks unique private reader IDs, requires the author among private readers, rejects public messages/groups/receipts, matches private group rosters to envelopes, validates DM addresses, restricts edit/delete authorship to the original author, matches related-event privacy and restricts receipts to another participant's private message. `view` uses the authorized object set rather than a bare decryption shortcut.
- Lock clears the native identity reference and private journal/drafts/collections. Locked state emits no identity, contact list or display objects. This does not establish deterministic memory zeroization; already returned renderer snapshots require the A-3 fix.
- The native HTTP listener binds to loopback, compares exact Host and supplied Origin, requires the capability token for API paths, limits request body/header/connection budgets, and serves bundled assets through `os.Root` with a content security policy. No concrete origin or asset-root bypass was found in this source read.
- `native/mobile` serializes Start/Stop with a mutex, rejects a second live service, closes a partially started service on bootstrap failure and makes Stop idempotent. Platform host lease/Activity behavior is reviewed separately; no Android runtime behavior was inferred from the binding source.
- Native collections verify the current owner's identity, bounded UUID/title/member metadata and authorized content before insertion. Mutations use a cloned encrypted private state. The web collection component does not obtain additional decryption or authorship authority from an object reference.
- Voice recording requests only audio from an explicit button; bounds duration and retained chunks; handles permission/error/empty/unsupported paths; stops tracks on cancellation, error and unmount; ignores late capture/read completion after cancellation; and produces a local draft attachment. Recipient changes key/unmount the recorder. Physical recording duration, hardware capture and OS background behavior remain unverified.
- Notification notices contain generic text rather than message/sender details. Opt-in is identity-scoped; lock/unmount/identity changes clear pending timers and close existing notices; async permission completion uses generation checks; duplicate history and notification attempts are bounded. The parent must supply verified, current display objects, as A-3 emphasizes.

## Review snapshot

The following hashes identify the principal sources read. Line references above apply to this inspected snapshot and may move after owner fixes.

| Source                           | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `native/app/node.go`             | `0c3e21be20513c9a72cb05268e9b438b89146a352c0784fb9659390848ef1e9f` |
| `native/app/server.go`           | `924778e0ad6ef78535c33a44a933b5834bea4483938a5638fe4ab85a2cc5d678` |
| `native/mobile/mobile.go`        | `499b7b63395951099f2ab8fa71bb8d53122c9785db1c32af09a58aad91ab1f4e` |
| `apps/web/src/collections.tsx`   | `9570e3aede296db417829fd0956abe715a878961c578f2a6595a6afe0b993e15` |
| `apps/web/src/media.tsx`         | `c08a0409c312703db433ade5eee34731d387d0be892758a7449f55d34d95e453` |
| `apps/web/src/notifications.tsx` | `a13ac36d4231d59c90a9d4bb5ae20264fc01a1f2711dcc5c4a2fa738af5ac19f` |

No issue is marked resolved here solely because earlier functional tests passed. Any fixes affecting native code or web assets must be included in the final CLI/AAR/APK rebuild and tested at the relevant application boundary.

## Implementation follow-up and executed verification

Root subsequently assigned this agent exclusive ownership of the native application fixes and mixed-process test updates. Root separately owned the matching Node reference and web UI changes. No native core/transport, Android/iOS host, dependency or provider configuration was modified by this follow-up.

| Finding              | Implemented behavior                                                                                                                                                                                                                                                                                                                                       | Verification performed by the fix author                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-1                  | `rememberRequestLocked` caps the map before each insertion, including inventory, serving and manual retrieval paths. Failed broadcasts cannot bypass the 2,048-entry budget.                                                                                                                                                                               | `TestRequestTrackingBoundSurvivesCapacityErrors` fills high-priority routing retention, forces normal request failures for 2,560 inventory addresses and 2,200 manual IDs, and checks the bound after every operation.                                                                                                                                                                                     |
| A-2                  | `objectsLocked` discards attachment bodies immediately after decryption and projects only supported display fields, including nested blocks and verified identity cards. State/history return at most 100 objects and 4 MiB of object JSON plus bounded metadata. Full attachment bodies use an authenticated endpoint.                                    | Load test uses 37,595,070 bytes of encrypted store data and 27,963,260 bytes of authorized aggregate payload. State is 68,368 bytes, with 100 latest summaries and 126 navigable IDs. A 2 MiB attachment is returned exactly; a related event's older target is authorized and journalled despite being outside the visible page.                                                                          |
| A-2 repeated polling | Verified summaries are cached within 16 MiB/1,024 entries for the unlocked identity. Every reuse requires the ID in the current verified `Store.List` result; missing/corrupt/blocked IDs are removed. Lock/unlock/close clear plaintext summary metadata, and snapshots deep-copy cache values. ACL/journal evaluation remains independent of pagination. | Tests cover both cache budgets, eviction/accounting, disk corruption followed by valid restoration, lock/unlock invalidation, and mutation of returned snapshots without altering cached values. Under the race detector, the load fixture's initial state took 22.54 s and the repeated verified-cache state took 254 ms. These are host measurements with instrumentation, not a device latency promise. |
| A-4                  | Valid incoming edit/delete events are decrypted and checked against the verified original's author/reader scope, then journalled before `Store.Put` can evict the original. On-demand reads materialize relevant retained mutations without decrypting unrelated attachments.                                                                              | Tests receive a remote deletion under a quota that immediately evicts its original, remove the wire event, restore the original and restart: the deletion remains. Forged-author/privacy-widening events do not enter the journal. Attachment reads deny deleted, unauthorized, invalid-conversation and corrupted objects.                                                                                |
| A-3                  | Root owns the UI request-order/privacy-generation correction and its browser tests.                                                                                                                                                                                                                                                                        | This agent did not implement or execute that browser regression in the follow-up. Its result belongs to root's separate UI evidence.                                                                                                                                                                                                                                                                       |

The cache budget counts canonical summary bytes; map/runtime overhead means it is not a claim that total process RSS is 16 MiB. First observation of uncached content still performs verification and decryption. Repeated state calls continue to check the store's verified byte identity rather than bypassing disk corruption checks.

The API shared with Node is:

- `state.objects`: latest chronological page of summaries, with attachments `{name, mime, data: "", size}`.
- `state.history`: `{hasMore, nextBefore, total, availableIds}`. `availableIds` contains all currently authorized cached IDs, including earlier pages.
- `POST /api/history {before}`: an older chronological page, using the oldest previously returned ID as an exclusive cursor. New arrivals do not shift the cursor. Missing/expired cursors return a clear error so the client can refresh its history.
- `POST /api/attachment {id, index}`: freshly verified, authorized attachment bytes; deleted objects are rejected. API capability authentication still applies.
- `POST /api/view {id}`: the complete authorized object, with deletion/effective-edit metadata and existing receipt semantics. This does not promise to erase copies already held by an authorized reader.

Locked receivers cannot authenticate private edit/delete semantics without their decryption identity. They retain encrypted events within ordinary cache/TTL limits and materialize them after unlock if both event and original remain available. If required evidence is evicted while locked or missing, eventual deletion interpretation is not guaranteed; the implementation does not claim validation without keys.

Executed from the repository root on Linux x64:

```sh
node scripts/go.mjs test -p=2 -v ./app
node scripts/go.mjs test -race -p=2 -v ./app
node scripts/go.mjs build -p=2 -o ../.cache/native-app/relayloom ./cmd/relayloom
npm exec tsx -- --test --test-concurrency=1 tests/native/mixed-network.test.ts
npm run typecheck
```

The normal application suite passed **17/17 in 7.94 s**. The final race-detector suite passed **17/17 in 74.63 s**. Typecheck passed. After rebuilding the actual native CLI, both real mixed-application scenarios passed **2/2 in 11.74 s**, with no skips or cleanup errors. They now assert attachment-free summaries and request exact bytes through the new endpoint. Their report files are `.cache/native-mixed/mixed-tcp.json` and `.cache/native-mixed/mixed-serial.json`.

The tested rebuilt CLI SHA-256 is `a3dc0344e357d91d9a9a92da9ad65af0fee254e39ddb00678b133075283b03e8`, checked before and after the mixed-process run. It contains the new native application behavior; earlier CLI/AAR/APK artifacts do not acquire these changes automatically. Final Android/iOS or other platform packaging and device validation remain separate gates. Independent reread of these authored fixes was requested from `security_review`; author-run tests above remain attributed to this agent.
