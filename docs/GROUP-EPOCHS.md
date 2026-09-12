# Group membership epochs — proposed v1 contract

**Design for review, not an implemented or passing feature.** This contract extends the fixed groups described in `PROJECT-BRIEF.md` and `docs/REMAINING-SCOPE.md`. It does not change any current engine, UI, cryptographic primitive, provider or transport implementation. The companion `tests/fixtures/group-epochs.json` contains declarative cases, not executed tests or signed vectors.

The current Node/Go group uses its creation bundle's content ID as the conversation ID, requires the exact fixed reader set, and expires as an ordinary content object. Membership operations do not exist yet. A generic text edit does not change membership or encryption keys.

## Essential v1 decisions

| Concern | Decision |
| --- | --- |
| Stable identity | A permanent, creator-signed anchor defines a stable group ID independently of expiring content carriers. |
| Membership authority | One creator signing identity approves the complete roster for each successor epoch. Reading, seeding or ordinary membership never grants this authority. |
| Ordering | Creator-signed, numbered, hash-linked epochs. No timestamp ordering, last-write-wins, automatic fork winner or claim of distributed consensus. |
| Additions | Invitation, prospective member's signed consent, then creator commitment. Neither an invitation nor a request changes the roster. |
| Removals | A successor roster excludes the identity. Publishers that have durably adopted that successor omit the removed identity from new content envelopes. |
| Leave | Stop participating locally immediately and send a signed leave request. The authoritative roster changes only when the creator commits it. |
| Creator exit | Creator remains a member while the group is open. Creator can close the group; transfer of ownership is outside v1. |
| Delayed traffic | Additions-only ancestry permits late content for its original readers. Any intervening removal or reading-card replacement creates a cutoff: unknown old content goes to explicit quarantine, not the current conversation. |
| Historical facts | Strict, content-free confirmations and an original author's monotonic deletion may still refer to historical content. They cannot admit an unknown message or carry a new edit. |
| Recovery of superseded intent | A still-current original author can explicitly prepare a new publication with a new operation ID, content ID, current epoch and reviewed audience. Never silently mutate the old operation or its readers. |
| Storage | Protected, authenticated authority metadata with explicit bounds and fail-closed capacity states; no ordinary cache eviction of the known head, fork evidence or local-leave fence. |

“Current” throughout this document means **the latest consistent epoch durably known by this installation**, not a globally provable latest epoch. An offline participant or a newcomer cannot prove that no newer creator statement exists elsewhere. The creator's key can also equivocate or be restored from stale state. These limits must appear in product wording and tests.

## Cryptography and the stable anchor

Reuse the existing Node and Go implementations of canonical JSON, SHA-256, Ed25519 signatures, public-identity proofs, X25519/HKDF key wrapping and AES-GCM content/private-state encryption. Introduce typed signed control records, not a new cryptographic primitive or an improvised group cipher. There is no shared traffic key to distribute: the existing content creator generates a fresh random content key per bundle and wraps it separately for the approved readers.

A certificate has exactly `{body, id, signature}`. Its `id` is lowercase hex `SHA256(canonical(body))`; its signature is Ed25519 over the UTF-8 canonical body, using the existing canonical Base64 encoding. Domain/version fields below are mandatory and prevent interpreting a content, identity or different control signature as another statement. Unknown fields/versions, duplicate identities, noncanonical encodings and invalid identity proofs are rejected. Cross-runtime vectors must cover these encodings before implementation is accepted.

The permanent anchor body is:

```text
domain: "relayloom/group-anchor/1"
creator: complete validated PublicIdentity
nonce: 32 random bytes in canonical Base64
membershipAuthority: "creator-only"
```

The anchor certificate ID **is the stable group ID**. Its creator signing key and signing identity are immutable. A changed name, substituted contact card, group title, relay carrier author or decryption key cannot redefine that authority. First trust comes from the user accepting an invitation for this exact group ID and creator identity; a valid signature does not prove a familiar display name belongs to the intended human.

The anchor and epoch certificates have no content-availability expiry. They are retained as bounded authority metadata, analogous to an identity proof, and are verified with a dedicated exact-schema certificate verifier. Do not implement this by passing a forged clock to the ordinary content verifier, disabling its expiry checks, or treating an expired message as available.

## Epoch header and private snapshot

Each epoch header body is creator-signed and contains:

```text
domain: "relayloom/group-epoch/1"
groupId: anchor certificate ID
number: integer 0..1023
previous: null for epoch 0, otherwise the immediately preceding epoch ID
state: "open" | "closed"
members: sorted [{id, cardHash}], with unique IDs
snapshotHash: SHA256(canonical(snapshotState))
```

`cardHash` commits the complete approved public card, including its reading `boxKey`, rather than only its ID. The existing identity ID binds a signing key; another valid card for the same ID may have a different reading key. Publishers must use the epoch-pinned cards, not whichever card their contact cache currently prefers. Signature verification never substitutes a reader's key for the creator's signing key.

`snapshotState` is:

```text
domain: "relayloom/group-state/1"
groupId
salt: 32 random bytes in canonical Base64
title: at most 256 UTF-16 code units
members: complete validated PublicIdentity cards, sorted by ID
joins: signed consent records for identities added/rekeyed in this transition
```

Its private carrier names `groupId`, `epochId` and this exact state. The random state salt prevents the commitment from trivially revealing guessed private titles. The header's member/card commitments must equal the snapshot's cards exactly. Replacing a reading card under the same ID is a restrictive transition, requires fresh consent from that signing identity and must never happen implicitly through contact synchronization.

Epoch 0 is creator-signed, has no predecessor, contains the creator alone and has no join records. An open group always contains the creator and has at most 64 members. A closed successor preserves the preceding roster/snapshot commitment for historical verification, but authorizes no new conversation content or further membership epochs. Number 1023 is reserved for closure; do not sign another open epoch after 1022.

The readable header exposes group correlation, sequence, member IDs and card commitments. It does **not** contain the private title, message text, attachments, past content keys or any private key. Recipient IDs already exist in the current encrypted-bundle manifests, but a permanent change history increases metadata persistence; this is an explicit v1 privacy cost, not membership anonymity. Full snapshots remain encrypted to that epoch's exact member cards. Closure reuses the preceding snapshot as historical context; it does not reinterpret that snapshot's earlier join proofs as another join transition.

### Carriers, lookup and seeding

Certificates and snapshots have logical hashes distinct from the content IDs of their expiring transport carriers. Never confuse the two namespaces. A control advertisement must identify both the expected certificate/snapshot hash and the carrier content ID; only verification after retrieval establishes authority.

Use normal signed/encrypted content bundles and the existing router. A `group-control` carrier contains an anchor and a bounded page of readable signed headers; a `group-snapshot` carrier contains the committed private state and is encrypted to the exact epoch roster. The carrier's author may be a seeder. Its signature proves who sent that carrier, while **the inner creator signature** establishes membership authority. Rewrapping an unchanged certificate does not make the seeder its creator.

The application protocol needs bounded `group-heads` hints and `group-proof-request` lookups, carried by the existing transport. A head hint is `{groupId, epochId, number, carrierId}`; it is untrusted until its proof is checked. Advertise at most 16 known groups per message. A request contains at most eight `{groupId, kind: "anchor"|"epoch"|"snapshot", hash}` references. Respond with ordinary carrier bundles, at most two responses per sync, with a five-second per-reference cooldown and normal transport TTL/byte/rate limits. Never re-encrypt a snapshot for an arbitrary requester or accept a requester's card as a membership grant. Unknown-group hints cannot allocate protected membership state or trigger unlimited proof fetching.

Only a verified current participant may originate a refreshed private-snapshot carrier, using the exact committed state and epoch cards. Any node may forward unchanged ciphertext or readable signed headers under its normal relay policy. Own joined-group synchronization remains distinct from optional relaying for other people; it must still obey bandwidth and low-power bounds.

## Joining, removing and leaving

All commands specify the expected parent epoch. The creator commits one successor transaction against that parent; concurrent local commands receive a conflict and fresh head, rather than silently overwriting each other. Publication after a lost response returns the same retained operation/certificate IDs. This operation deduplication is finite and must advertise its retention policy, as the current outbox does.

| Operation | Required authority and effect |
| --- | --- |
| Invite | Creator signs `{groupId, parentEpochId, inviteeId, inviteeCardHash, invitationNonce}`. It grants no message keys or membership by itself. |
| Accept invitation | Invitee verifies the anchor/creator and signs `{groupId, parentEpochId, invitationHash, cardHash, joinNonce}` with a fresh nonce. No contact trust is silently established. |
| Commit join | Creator signs a successor snapshot containing the exact consent and new card. The new member verifies its own fresh request is committed, the complete header chain and the current private snapshot. No historical decryption key is supplied. |
| Remove member | Creator signs a successor excluding that identity. A common member cannot remove another identity. Creator cannot remove itself while leaving the group open. |
| Replace reading card | Creator commits the new self-proved card with fresh consent from the same signing identity. Treat the change as removal of the old card plus addition of the new one for cutoff/envelope purposes. |
| Leave | Member first persists a local-left fence and stops new group sends/automatic confirmations. It may then send a signed leave request bound to group, exact parent, member/card and fresh nonce. Other nodes do not rewrite the roster from that request alone. |
| Commit leave | Creator signs the successor without that member. Until then, other participants may still generate envelopes for the old roster because they have not adopted a removal. This is shown as “saída local; alteração de membros pendente”. |
| Rejoin | Requires a new invitation/consent against the then-current parent and explicit local acceptance. Replaying a former join request cannot clear a local-left fence or reverse a later removal. |
| Creator leave | Close the group with a signed terminal epoch. Create a separate group if another creator is needed; v1 does not invent an ownership-transfer vote. |

The creator may batch several consents against the same parent in one successor. A consent from a different parent is stale, even if its timestamp is recent: refresh the invitation/consent rather than silently accepting different membership circumstances. Invitation and request carrier TTLs govern availability only. Nonces, exact parent references, recorded operations and signatures govern replay behavior.

Creator-only control does not require the creator for every ordinary message. Current members can communicate while the creator is offline. Authoritative join/remove/close operations wait for the creator. Key loss can permanently prevent membership changes. Two devices using the same creator key can sign conflicting successors; local locking prevents this only within one installation, not across recovered copies.

## Message admission and delayed traffic

New ordinary group messages bind **both** `conversation: groupId` and `groupEpoch: epochId` inside their signed encrypted payload, with `groupAudience: "epoch"`. They are private, their author is a member of the referenced epoch, their complete member-card payload matches the verified snapshot, and their envelope reader IDs equal that epoch's members exactly, with no extra recipients or duplicates. A conforming publisher that knows a newer epoch must use the newer epoch for a new publication. Related events use the explicitly narrower target-audience rules below, rather than an arbitrary sender-selected subset.

Receipt of ciphertext, transport ACK, cache presence and display timestamps are not semantic acceptance. Acceptance is one serialized local transaction: verify/decrypt, validate the epoch and object semantics, store the exact bytes, and durably record the accepted object ID and authorization context **before** displaying it in the conversation or issuing a confirmation. Serialize this transaction with epoch adoption. A message merely cached while locked is not grandfathered history.

On unlock/restart, restore the protected head/fences first, process already available valid control chains before unaccepted cached content, then apply these rules:

| Object and locally known state | Admission |
| --- | --- |
| Exact ID already durably accepted | Historical access remains available to its original readers, subject to content TTL, storage, local blocks and tombstones. A replay does not create another message or confirmation count. |
| Message references the known open head | Normal membership, signature, envelope, content and quota checks; then durable acceptance. |
| Message references a future/missing epoch | Await bounded proof/snapshot retrieval. No conversation display or automatic receipt until verification completes. Missing ancestry is not evidence of a fork. |
| Message references an ancestor, and every intervening transition only adds identities while preserving every existing card | Existing original readers may accept the delayed object with its **original** reader set. Mark its epoch in history; do not supply keys or historical content to newly added members. |
| Any intervening removal, card replacement, closure or removal-then-rejoin | A previously unknown old-epoch message goes to quarantine even if its author claims an earlier creation time or is a member again now. Compare the complete path, not only the final roster. |
| Local-left, removed, proven-fork or capacity-frozen state | No new current-conversation admission or automatic sending. Historical/quarantine access remains separately governed. |
| Invalid signature, epoch proof, schema or original-reader relationship | Reject as invalid; it is not “valid old content” quarantine and cannot freeze a group by itself. |

The additions-only exception preserves partition tolerance where no old entitlement has been withdrawn. A title-only change with identical member cards is likewise nonrestrictive. Unknown late content after a restrictive transition is deliberately treated differently from content accepted before learning it.

This produces an unavoidable history difference: B may accept M before learning a removal, while C learns the removal first and quarantines M. Later connectivity does not silently turn these histories into a consensus log. A timestamp signed by an ex-member cannot distinguish a genuinely delayed pre-removal message from a newly manufactured backdated one.

### Quarantine is explicit and inspectable

Quarantine is a separate local view with a reason, original author/epoch, claimed creation time labelled as such, and local observation order. An original reader may explicitly decrypt and inspect retained valid old content there. Inspection does not admit it to the current conversation, trigger a new-message notification or generate delivery/read receipts. A newcomer without an original key cannot inspect it merely by joining the current group.

Retain exact quarantined bytes within the bounded quarantine budget and normal content TTL. Never silently present rejection as delivery. At quota/expiry limits, show the loss/rejection reason and a bounded aggregate count; finite storage cannot promise to preserve every old object indefinitely. Do not evict a durable pending user intent to admit an old-message flood.

For v1, a still-current original author recovers a superseded message through **explicit republication**, not a new authority rule that silently adopts old IDs. Show the old and current audiences and any newly added readers. Only after that choice create a new operation ID, current-epoch signed bundle and content ID. Preserve the old ID/reader set/status as historical evidence. Another reader may seed the original unchanged bytes; it cannot republish them while pretending to retain the original author's signature. A future author-signed adoption certificate is a separate optional protocol, not assumed here.

## Historical confirmations, deletion and edits

Membership authority and content authorship are different permissions. The creator can alter the roster and group title; it cannot edit or delete another member's content. Removal does not transfer or erase the original author's signing authority.

| Event | v1 rule |
| --- | --- |
| Historical `delivery`/`receipt` | A content-free statement bound to an exact locally accepted target, its group and target epoch. Signer must be a non-author original reader. A currently removed original reader can attest to old content it was entitled to read. It cannot use a receipt to admit an unknown/quarantined message. |
| Historical delete | Original author's signature may create a monotonic tombstone for its verified original, even after removal. It can suppress that exact item in local history/quarantine; it cannot erase peer copies, revoke old keys, create text or delete someone else's message. |
| Edit with new content | Requires the original author's signature **and current open-epoch membership**. It names the current authorization epoch and the original target epoch. Audience is exactly `original target readers ∩ current epoch members`, using current approved cards for those identities. Never include newcomers who were not original readers, or removed identities. |
| Reply/reaction/comment with new content | Requires current membership. For an old target, use the same original/current audience intersection and explicit epoch bindings. Do not automatically quote old plaintext or attachments into a full-current-roster message containing newcomers. |
| New old-epoch edit/reaction after a restrictive transition | Quarantine/deny as new content; possessing the original author's key does not bypass current membership. Do not apply it while processing a historical receipt or tombstone. |

Historical confirmations and deletes have an exact minimal payload: kind, group ID, target ID and target epoch ID. No text, reason, emoji, attachment, member update or arbitrary extension field is accepted in these exception paths. Verify the original independently; a target ID supplied by the event is not an authorization proof. Persist observed valid confirmations and tombstones before cache admission can evict the target.

For the new group version, encode the group ID as `conversation`, the original epoch as `targetEpoch`, and the discriminator as `groupAudience: "historical"` on those minimal events. They do not claim a current publishing epoch. Edits/reactions/comments and a message carrying `replyTo` use `groupAudience: "target"`, name both `groupEpoch` (current authorizing head) and `targetEpoch`, and derive the exact reader intersection from the verified target and current snapshot. The sender cannot choose another subset. A reply to old content is visibly limited to original readers still in the group; sharing that content with all current members is a separate explicit publication.

Preserve receipt privacy: these historical control events remain private to the exact original target reader set, using its pinned cards. This is an explicit exception permitting a new envelope containing **only an old-content attestation/tombstone** to an original reader who has since left. No new conversation text, edit body, current snapshot secret or future message key is supplied. Do not make receipts public to simplify verification. A local block/leave preference may suppress automatic issuance without preventing authorized historical inspection.

The edited/replied intersection is a distinct dynamic-group rule; do not weaken the exact-reader validation of existing fixed groups or DMs. If only the author remains in that intersection, the change is local to that original author unless a later explicitly shared publication is chosen. If the actor is no longer a member, only the narrowly defined historical confirmation/delete exception applies.

A blocked creator's valid membership certificates must still be usable as authority dependencies; hiding that person's conversation content cannot make the client ignore a removal or roll back the known head. This does not require displaying a blocked creator's new title/text. Other local block rules can suppress automatic historical confirmations as documented separately.

Historical facts retain local first-observation times and never regress after replays, eviction or restart. They do not claim that a removed reader is still a member, or that an old message arrived before a membership cutoff. Inspecting quarantine must not fabricate those facts.

## Outbox integration

The send fingerprint and durable record bind stable group ID, exact epoch ID, original recipients and original bundle bytes. Membership changes cannot mutate a retained operation ID into another bundle or broaden its audience.

- Across a nonrestrictive/additions-only path, exact old pending bundles may retry to their original readers. New members are not added to that already accepted operation.
- A restrictive successor makes incompatible uncompleted old content intents **`superseded` with reason `group-epoch-changed`**. This is a terminal local retry decision, not delivery. Stop new app attempts and release automatic pending reservation while preserving an explicit manual pin. Retain the original operation record under the existing finite metadata policy.
- Never retroactively label a completed receipt/read fact as failed. Preserve partial/historical confirmations alongside the reason retry ended. Late, valid historical control events may add historical facts without erasing the supersession/cutoff context.
- Proven fork, group closure and explicit local leave require equally explicit stopped/superseded reasons. A simple local block still follows the separately documented block policy; do not disguise it as a cryptographic epoch change.
- Already queued fragments, peer caches and prior copies cannot be recalled. Stopping app retry is not a transport cancellation guarantee.
- Repeating a retained superseded operation returns that exact ID/status; it never signs a replacement. The UI can offer the original author an explicit new-send preparation with a new UUID and reviewed current audience. Finite operation retention remains disclosed.

## Forks, stale state and recovery

Adopt only a contiguous, creator-signed extension of the durably pinned head. A numerically larger epoch with missing parents remains pending proof. A stale ancestor does not roll back the head. Neither the carrier author, arrival order, sender time nor lexicographically smaller hash selects a winning branch.

Two valid different creator-signed children of one parent, or two incompatible signed statements at an established sequence on anchored chains, prove equivocation. Persist the conflicting certificates and enter **forked/frozen** state. Stop new group admission, membership changes and sends. Preserve previously accepted history with a pre-detection qualifier; do not silently delete it or relabel one branch canonical. Invalid signatures and random orphan hashes cannot force this state.

V1 has no automatic healing vote. A subsequent creator signature alone does not erase the demonstrated conflict. Recovery is an explicitly accepted new group anchor/ID; do not automatically migrate memberships, past plaintext or trust. Owner checkpoints, multi-administrator consensus and transfer are separate designs.

Ordinary restart restores the last committed head, exact certificate chain, fork/leave fences, accepted-ID context and outbox decisions. It never infers authority by scanning whichever content survived cache eviction. Use authenticated private persistence and the existing atomic-write/error-readback boundary. If a write's result cannot be authenticated, lock/fail closed instead of overwriting uncertain authority state.

Authenticated encryption detects modified state, **not restoration of an older valid backup**. Without trusted monotonic storage or an external witness, an offline installation restored to a pre-removal snapshot cannot know its head regressed. A fresh join nonce prevents simple reuse of an old invitation response for a new consent, but does not prove the creator supplied the globally latest nonforked state. No rollback-proof or globally immediate revocation claim is made.

## Protected registry and concrete bounds

These are proposed protocol/local admission defaults to freeze before engine implementation, not claims that the current private-state schema already supports them:

| Resource | Bound / admission behavior |
| --- | --- |
| Enrolled/remembered groups | 64, including protected left/forked records; do not silently forget a fence to join another group. |
| Members | 64; one current approved card per unique signing identity. |
| Anchor, invitation or consent certificate | 2 KiB each, exact schema. |
| Epoch header | 16 KiB; at most 1024 numbered epochs, with final closure slot reserved. |
| Private snapshot | 512 KiB, including bounded consent proofs and public cards; no message bodies/private keys. |
| Control carrier page | 256 KiB of proof data; paginate longer ancestry rather than bypassing existing packet/content limits. |
| Protected authority registry | 64 MiB serialized metadata total, including a 4 MiB reserve for head/fork/capacity-frozen checkpoints. Track the byte limit independently from count limits. |
| Accepted-history records | 4096 exact IDs globally. Records needed by retained pending intents or current historical actions are protected. Retiring an unneeded record can forfeit automatic historical readmission; it can never make an unknown old ID newly admissible. |
| Pending membership requests | 64 globally, with bounded payloads; expired/stale requests do not authorize anything. |
| Quarantine / awaiting proof | 128 records and 16 MiB exact content bytes globally, subject to normal content expiry and store limits. Refusal/eviction is visible and does not overwrite pending user sends. |

Keep authority metadata separate from the expiring content cache, encrypted/authenticated with the existing private-state mechanism. Reuse that mechanism; do not invent another cipher/key store. An indexed or segmented layout may be needed to avoid rehydrating the entire registry or attachment bodies on every UI state poll. UI state returns summaries, not the whole proof history.

Any segmentation must authenticate its group/record identity and committed version and use an atomic authoritative index/checkpoint; swapping individually valid encrypted segments must not change which head the installation considers committed. Exact file layout remains an implementation decision, but partial writes cannot be resolved by choosing whichever segment has the largest untrusted number. The authenticated-backup rollback limitation below still applies.

Reserve space for a minimal per-group stop/head checkpoint when enrolling a group. If a verified restrictive successor cannot fit the normal metadata budget, persist a capacity-frozen checkpoint using that reserve and stop using the old roster; do not continue publishing as if the removal had not been observed. Uncertain physical writes use fail-closed lock/readback handling. Finite disk and physical failure do not permit an unconditional durability guarantee.

Expose authority/quarantine bytes and their reserve in storage accounting. They are not an invisible unlimited cache beside the user's configured budget. Reducing an overall quota below protected committed state must fail atomically with an explanation, rather than silently dropping a head/fence or exceeding the declared limit.

Do not prune the active group's authenticated ancestry merely to allow unlimited membership changes. V1 chooses a hard epoch bound instead of an unreviewed checkpoint-compaction rule that could hide old forks. Expired content/quarantine and unneeded history metadata may be reclaimed under visible policies; the highest-known head, concrete fork proof and local-left fence are not ordinary LRU entries. Hitting protected-state capacity is an explicit unavailable-management state, not a reset to epoch 0.

## Thirty-day content expiry and newcomers

The ordinary carrier bundle still defaults to 30 days and retains normal verification, transport TTL and cache eviction. Pinning does not make that bundle immortal. **Expiring the initial carrier does not expire the group identity or its retained authority certificates.**

A retained participant can republish the same signed anchor/headers and committed current snapshot inside fresh bounded carriers. Their new outer content IDs are lookup handles, not new group IDs or new authority. A newcomer verifies the anchor signature, creator key, complete bounded header ancestry, its own fresh consent and the current committed roster before joining. None of this requires decrypting the initial private group object, any former snapshot or historical message.

If no participant has retained the required proof/current state, the group is unavailable for new enrollment or authority reconstruction. Do not guess the creator from a name, a current relay, the numerically highest advertised head or an expired object's unsigned metadata. A proof being cryptographically valid does not establish it is the latest state in an isolated partition.

Existing fixed groups do not silently become epoch groups. V1 rollout creates a new anchored group when dynamic membership is requested, with an explicit link to the former conversation if desired and **no automatic history-key transfer**. In-place legacy-ID migration would require a separately specified signed upgrade proof anchored to the verified original creator/definition; it is optional follow-on work. Never “solve” legacy 30-day expiry by disabling content expiry globally.

## Proposed API/UI semantics for implementation review

Exact endpoint spelling may follow current conventions, but these boundaries are essential:

- Create returns stable group ID, anchor and epoch-0 state only after their protected local transaction commits.
- Invite/accept/leave return `pending` until the required creator successor exists. Creator membership mutation accepts `{operationId, groupId, expectedEpochId, change}` and returns the committed epoch ID or a conflict/current-head response. No optimistic success label means another participant has learned it.
- State distinguishes `active`, `awaiting-proof`, `locally-left`, `removed`, `closed`, `forked` and `capacity-frozen`; it shows the last-known epoch and explicitly pending membership requests. Locked state exposes no private roster/title/quarantine preview.
- Quarantine is discoverable from the group, gives the reason and original-reader limitation, and has explicit inspection/retention controls. It does not reuse the ordinary “Recebida/Lida” badge for inspection.
- Removal wording says future content from updated publishers excludes the removed identity; previously held keys/copies remain. Leave wording distinguishes local disengagement from committed roster removal.
- Any republication flow shows changed recipients and requires a new-send choice. Creator controls do not expose edit/delete actions for another author's content.

## Required gates before claiming support

Generate real cross-runtime signed/encrypted vectors from the declarative cases, then run Node and Go independently and together. No fixture alias or `signedBy` label is cryptographic proof.

1. Canonical anchor/epoch hashes and signatures; wrong creator, wrong domain/group, malformed chains, duplicate members, substituted box-key cards and altered snapshots rejected.
2. Newcomer joins after the original carrier expires, verifies owner/ancestry without old keys, decrypts new content and cannot decrypt original history. Removed member and old reading key cannot decrypt a conforming current-epoch message.
3. Actual A → relay → B/C partitions with head-first versus message-first order, additions-only late acceptance, restrictive late quarantine, forged backdating and removal/rejoin. Prove paths and observe real control/content responses.
4. Locked-cache prefill versus durably accepted history, crash at acceptance/adoption writes, uncertain journal errors, normal restart and explicitly separate valid-backup rollback limitation.
5. Signed forks freeze; invalid signatures/orphan hints do not. Creator multi-device conflicting writes, duplicate operation responses and stale consent/leave replays are exercised.
6. Historical receipts/delete after removal do not add conversation content or widen audiences; removed-author edit is denied; current original author's edit/reply excludes removed members and newcomers to the original target.
7. Superseded outbox preserves original ID/readers, ends only future app retry, retains historical facts and requires explicit new operation/audience review to republish. Additions-only retry does not add newcomers.
8. Bounds, reserve exhaustion, quarantined floods, missing proofs and epoch-cap behavior fail closed without erasing protected fences. Measure state/persistence cost with large histories.
9. Real UI invite/accept/pending leave/removal/quarantine/republish/fork states, keyboard/touch/screen-reader behavior and honest expiry/no-recall wording. A simulated transition is not a device or network execution claim.

The contract was informed by an independent adversarial read from `/root/security_review/group_epoch_adversary`, which identified cache-as-acceptance, historical-event bypass, full-card pinning, finite-chain/fork retention and valid-backup rollback counterexamples. That review changed no source and ran no builds. Root's follow-up required inspectable quarantine, additions/removals distinguished, historical receipt/delete exceptions and explicit author-controlled republication; those decisions are incorporated here.

## Optional designs not required for v1

- A creator checkpoint could admit **exact old message IDs** committed before a transition. It cannot certify unseen partition traffic and adds creator availability/storage costs. An author-signed current-epoch adoption record for an old ID likewise needs its own receipt/audience/operation semantics; neither is implicitly enabled by quarantine inspection.
- Multiple administrators, ownership transfer, fork resolution votes, threshold signatures, external witnesses and trusted anti-rollback counters need separate protocols and gates.
- Past-history sharing is an explicit disclosure operation, not an automatic side effect of joining. Forward secrecy, post-compromise security, anonymity, retroactive key revocation and deletion of remote copies are not supplied by per-object envelopes or membership epochs.
- In-place legacy migration and epoch-proof compaction may improve usability/lifetime, but must not weaken the stable creator binding, old-fork detection or audience guarantees without an explicit revised contract.
