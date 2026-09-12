# Protected group storage foundation

`packages/groups/src/storage.ts` is a real SQLite-backed, encrypted transactional store. It is **not yet imported by the running Node/Go applications**, and does not itself decide group membership, fork detection, acceptance or outbox policy. Those layers remain required by `GROUP-EPOCHS.md`. Root implemented/reviewed this phase sequentially; no independent review of this new code has yet occurred.

## Format and boundaries

- SQLite application ID `0x524c4731`, format1, two fixed tables, no extensions or extra schema. Explicit exclusive creation uses a private0600 file; ordinary open refuses missing, empty, corrupt or unknown state. The caller owns the parent directory.
- A random32-byte store ID is pinned for the lifetime of a handle. The application must persist that identifier separately and supply `expectedStoreId` on subsequent opens; otherwise a first open establishes trust in the authenticated file it receives. This is not anti-rollback hardware.
- Rows have opaque random256-bit slots. The encrypted index contains logical keys, storage classes, revisions, ciphertext SHA256 digests and lengths. A row is authenticated before use and bound by AEAD to `[domain, owner ID, store ID, logical key, revision]`. A signed index commits all references atomically. Unindexed/missing row counts fail closed; a damaged referenced row fails when accessed. Open does not decrypt every payload in the registry.
- Reuse maintained Ed25519, HKDF-SHA256 and AES256-GCM APIs. Domain is `relayloom/local-group-registry/1`; salt32, nonce12, GCM tag16. HKDF input is the existing X25519 private-key DER, with the separate domain as info. The binary envelope is version byte1, salt, nonce, tag, ciphertext. The checkpoint plaintext has exactly `body` and an Ed25519 `signature` over canonical body. Reading material alone can decrypt this local state but cannot forge the owner's checkpoint signature.
- SQLite `BEGIN IMMEDIATE` serializes writers; index and records share one commit. Read transactions see one snapshot. Callbacks must be synchronous and must not display or publish effects until the transaction returns. Integrity errors cannot be swallowed to commit another mutation. An ambiguous commit poisons the handle; reopen must authenticate persisted state before the application decides whether to retry. The store does not supply operation deduplication on its own.
- Journal modeDELETE and synchronousFULL retain SQLite's transaction durability behavior. Real process termination before commit was tested; physical power loss, hardware failures and all OS filesystems were not. Complete authenticated backup rollback remains possible and has an explicit test. A trusted monotonic witness/counter is absent.

## Bounds and accounting

64MiB total serialized encrypted metadata,4MiB withheld from ordinary data for checkpoints,512KiB per plaintext record and4MiB maximum encrypted index. Ordinary accounting also charges its index references, conservatively. Each insertion is checked before SQL mutation; a refused normal-data insertion can be caught to save a small capacity-frozen checkpoint in the same transaction. A final capacity check precedes commit. Neither the generic `checkpoint` class nor `delete` is an authorization decision; the higher registry layer must prevent API callers from relabelling/deleting protected head/leave/fork state.

SQLite pages have a separate cap of1.5× the configured serialized quota, rounded to4096-byte pages (minimum64KiB); at default quota that is96MiB. The rollback journal may temporarily add up to approximately another database-sized allocation. Expose actual page allocation as well as serialized metadata when integrating storage policy. This library is not yet included in the app's overall user quota accounting, and cannot be presented as such.

Node22.13+ provides the built-in SQLite import without an experimental command-line flag; Node22 still labels the API experimental. The repository's declared minimum now reflects that dependency. Existing app assets are unchanged (`index-CFZzmFWN.js`, `index-DwCp7KCv.css`). No harness/provider/bridge configuration changed.

## Executed verification

- `npm run build`: passed,6.187s.
- `npm test`:103 passed,0 skipped,0 failures,58.653s command duration. Includes10 new storage cases: encrypted reopen/rollback, missing/corrupt/schema states, genuine unauthorized-signature forgery beneath valid encryption, checkpoint bounds, acknowledged full-backup rollback limitation, row/index replay, AEAD domain mismatch, quota/reserve, actual writer-process death and actual concurrent writer processes preserving24 increments/revision25.
- The initial8-case run passed before additional quota/integrity controls and formatting; its hashes are historical, not the final source. Retained final build/test evidence is under `docs/evidence/group-storage/node`.

The Go feasibility probe uses modernc.org/sqlite v1.58.0 / libc v1.75.6 in a separate project cache module. BSD3 license inspected. An actual Linux in-memory transaction passed (15.792s including first compilation); library cross-compilation passed for Android arm64/CGO0(19.075s) and iOS arm64/CGO0(16.752s). It is not a persistence, binding, simulator or device test. Probe source/commands/lockfile are retained under `docs/evidence/group-storage/probe`. Driver adoption and the equivalent Go storage implementation remain pending; no native app binary contains it yet.

Next: Go implementation and cross-runtime database/locking/tamper controls, then the authority registry and proof sync, serialized message/outbox admission, UI and complete integration gates. Group certificates and these storage tests do not complete dynamic-group acceptance.
