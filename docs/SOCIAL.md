# Local social domain

Current integration update: these helpers are now wired to encrypted local persistence, authenticated Node and Go APIs, and real UI controls. The8 helper tests, `tests/social-integration.test.ts`, and `tests/e2e/social.spec.ts` pass. The browser flow was also executed against the Go application. Create/rename/delete/add/remove collections, followed-feed selection, reference retrieval without added read authority and restart persistence are implemented. The detailed handoff below preserves the original module boundary; its “pending at handoff” statements are historical, not the current application status. Shared/collaborative collections, public follower relationships and global discovery remain unsupported. See `STATUS.md` for the current capability matrix.

This document records the pure social helper handoff on 2026-09-11. It separates tested domain logic from application integration. Existing signed content and live peer transport remain the responsibility of `LoomNode`; this module adds no central database, network connection, or disk write.

## Domain API

Source: [`apps/node/src/social.ts`](../apps/node/src/social.ts). Regression tests: [`tests/social.test.ts`](../tests/social.test.ts).

`Collection` contains a local UUIDv4 `id`, the authenticated identity's `ownerId`, a `title`, an ordered `objectIds` array, and integer `createdAt`/`updatedAt` timestamps. It references content addresses without copying content or changing its author, readers, expiry, or pin state.

| Export | Contract |
| --- | --- |
| `applyCollectionCommand(collections, ownerId, command, now)` | Returns fresh metadata for create, rename, delete, add, and remove. Caller supplies the authenticated owner, UUID, and clock. It performs no I/O and does not mutate its input. |
| `validateCollections(value, ownerId)` | Validates recovered metadata and returns detached arrays/records belonging entirely to the active identity. |
| `validateFollowing(value)` | Validates a bounded, unique list of identity addresses. This is a local selection preference, not a remote subscription or consent grant. |
| `followedFeed(objects, following)` | Selects posts and alerts authored by followed identities, preserving input order. Input must already have passed `LoomNode` decryption and semantic authorization. Deleted-item and general feed presentation rules remain with the caller. |
| `requireContentId(value)` | Accepts exactly 64 lowercase hexadecimal characters. A valid reference does not establish availability, authenticity, ownership, or permission to decrypt. |
| `SOCIAL_LIMITS` | Maximum 32 collections, 256 references per collection, 2,048 total collection memberships, 64 UTF-16 code units per normalized title, and 256 followed authors. |

Commands are exact records:

```ts
{ action: "create", id, title }
{ action: "rename", id, title }
{ action: "delete", id }
{ action: "add", id, objectId }
{ action: "remove", id, objectId }
```

Titles are normalized to NFC and trimmed. Blank titles, control characters, and duplicate names ignoring case are rejected. Collection IDs are canonical lowercase UUIDv4 values; content and identity addresses are canonical lowercase SHA-256-sized hexadecimal values. Paths, URLs, inherited properties, accessors, unknown fields, sparse arrays, and additional array properties are rejected. Metadata belonging to another identity cannot be modified or mixed into the current identity's collection list.

Adding an existing reference or removing an absent reference is idempotent. Each membership counts toward the total bound, including the same object saved in two different collections. Renaming or deleting an unknown collection fails. Existing timestamps remain monotonic if the supplied wall clock moves backward. A rejected command leaves the caller's metadata intact.

## Integration and privacy contract

The application must take `ownerId` from its unlocked identity, not from request JSON. Commands cannot override ownership or timestamps. It must write the prospective collection list through the authenticated, encrypted `PrivateState` mechanism before replacing in-memory state or returning success. This helper alone provides neither authentication nor encryption. Collection names and memberships must not be added to plaintext `config.json`.

Following filters must operate on the already authorized object list. They must not make unknown, blocked, undecryptable, or invalidly signed objects visible. A follow preference does not cause unrestricted retrieval or authorize another identity to read private content.

Sharing a content address shares a reference. Explicit retrieval must use the existing peer request path, respect relay and storage policies, verify the received bundle, and decrypt only through the original reader envelopes. A hash cannot guarantee that a seeder is online. A collection may retain the address of unavailable content without claiming the content is locally cached or readable. Deleting a local collection removes its private references only; it does not remove the original object, publish a tombstone, or recall peer copies.

## Capability matrix at helper handoff

“Existing application source” means the behavior was already present when this helper was written; this subtask did not rerun its end-to-end checks. “Domain tested” means the pure module tests below executed. Application/API/UI integration of the new helpers requires its own validation and a matrix update.

| Capability | Current evidence | Integration status / limit |
| --- | --- | --- |
| Create, rename, delete named collections | Domain tested: `applyCollectionCommand`, lifecycle and validation tests | Ready for encrypted `PrivateState`, API, and UI integration; no collection screen or storage claim comes from this helper. |
| Add/remove collection items and quotas | Domain tested: per-collection, total-membership, object-address, idempotency, and immutable-rejection tests | References only; root integration must expose real actions and honest unavailable-content states. |
| Collection ownership and encrypted local metadata | Domain ownership rules tested, including cross-identity rejection | Encryption/persistence is provided by `apps/node/src/local-state.ts`; collection-field integration and restart tests are pending at this handoff. |
| Followed-author feed selection | Domain tested: `followedFeed` and following limits | Root must wire the selector to feed controls and already-authorized objects. It selects cached content; it is not a global feed or remote follow notification. |
| Signed posts and alerts | Existing application source: `LoomNode.publish`, `objects`, and `authorized` | Existing local/peer content flow; alert signatures establish authorship, not factual accuracy. |
| Comments and reactions | Existing application source: related-event authorization and original reader-set equality | Existing event flow; the helper adds no public activity counter or central service. |
| Author edits/deletion and local blocking | Existing application source: owner checks, authenticated mutation journal, blocked-author filtering | Collection membership grants no edit authority. A local collection deletion is separate from deleting authored content. |
| Copy/share a content address | Existing UI source copies publication IDs; strict validator is domain tested | This helper neither sends messages nor fetches content. Explicit retrieval by hash is root-owned integration work. |
| Private/public content boundaries | Domain regression uses a real private bundle: a reference holder still cannot decrypt it, while an authorized reader can | Reading remains governed by core envelope decryption and `LoomNode` semantic checks; collection/follow actions do not widen recipients. |
| Identity cards and published profile sites | Existing application source: verified contact cards and signed declarative site manifests | This helper does not create a profile directory, remote search service, or new site format. |
| Shared/collaborative collections and cross-device collection synchronization | No implementation in this module | Pending/unsupported; collections here are private local metadata, not signed shared collection manifests. |
| Global discovery, universal availability, central moderation or global reputation | No implementation in this module | Unsupported; connected peers and local caches determine what can be obtained. |

## Executed verification

On 2026-09-11:

- `node --import tsx --test tests/social.test.ts` passed **8/8**, with no skips.
- `npm run typecheck` passed after finalizing the command discriminated union.

The tests exercise all five collection commands, immutable transitions, metadata validation, prototype/accessor rejection, path/hash validation, ownership, three quota dimensions, duplicate/no-op behavior, followed-author selection, and preservation of a real bundle's reader/signing boundary. No new service, browser, socket, hardware, or native-client test was executed by this subtask. Root integration results belong in the final verification report.
