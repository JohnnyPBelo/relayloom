# Protected group persistence iteration

Status: Node storage foundation implemented and tested; no group application capability claimed. Root owns all files in this sequential phase. No new/resumed agents, provider or harness configuration changes.

Use an embedded SQLite transaction boundary rather than ad-hoc file locks. Node has built-in SQLite in the tested Node/Electron processes. Evaluate the BSD3 modernc driver in a project-local probe before adding it to Go/mobile. No server, shared service or remote database is involved.

The storage layer will hold opaque encrypted records and one encrypted, locally signed index. The index commits record slots, ciphertext digests, sizes, storage class and revision. A row from another key, revision, identity or registry must not be accepted. AES256-GCM/HKDF and Ed25519 reuse the maintained primitives already used by the project with a separate domain; box/decryption material alone cannot forge a head/fence checkpoint. SQLite serializes writers from actual processes. The index and all changed records commit together. Missing/damaged state fails closed; opening must never initialize an existing damaged database. Restoring a complete older valid backup remains undetectable without a trusted monotonic witness.

Bounds:64MiB serialized protected metadata total,4MiB reserved from ordinary data for checkpoints; per-record and index bounds and visible accounting. SQLite page/journal overhead must have a separate finite allowance and be documented. Ordinary data cannot consume the checkpoint reserve. API consumers must explicitly preserve protected head/fork/leave records; the generic storage layer itself does not decide group authority.

Verification sequence: real encrypted file/reopen, wrong identity, tamper, record swap, authenticated-index rollback mismatch, read-key-only forgery, callback rollback, abrupt process exit before commit, simultaneous process writers, quota/reserve controls. Then equivalent Go implementation and cross-runtime files, followed by actual group registry/head/fork/leave semantics, application admission/outbox synchronization and real UI. Library storage tests do not count as completed dynamic-group acceptance.

Latest external gate remains blocked at iOS photo seeding after successful boot, as recorded in STATUS. Do not loop on that same unchanged command or downgrade the photo/UI requirement.

Completed Node implementation: `packages/groups/src/storage.ts`,10 storage tests plus an owned process fixture. Build6.187s and all103 Node tests58.653s passed. Failed quota is now checked before SQL mutation, permitting a checkpoint fallback in the same transaction; swallowed integrity errors still abort. Full-valid-backup rollback is exercised as a known limitation. The new store remains unimported by the runtime. Details: `docs/GROUP-STORAGE.md`.

modernc.org/sqlite v1.58.0 was evaluated in `.cache/sqlite-probe/go`: BSD3, real Linux query/transaction passed, Android and iOS arm64 pure-Go package builds passed. That does not establish mobile runtime/locking correctness. Next: adopt exact driver/libc versions only alongside real Go storage tests and interoperability. Do not count the probe's in-memory transaction as persistence evidence.
