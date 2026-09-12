# Runtime integration boundary — next implementation phase

Owner contract remains complete and active. Sequential root execution, no new/resumed agents. This is a concrete integration design, not delivered runtime behavior. Current Node/Go authority libraries do not yet import into apps.

## Observed runtime constraints

`LoomNode` synchronously owns its in-memory private state but has no cross-process profile ownership. `native/app.Node` protects in-process work with `mu` and waits for router/sync workers on Close, but also has no cross-process profile ownership. The new Node/Go profile lease is now imported and targeted real-application recovery gates passed; the broader gate is in progress. Both engines still persist the existing private state as a separate encrypted JSON file, bounded16MiB. SQLite group commits cannot atomically alter that file. Existing outbox error/readback, expiry and confirmed history semantics must remain intact.

## Chosen implementation direction

1. Add a project/profile-local process ownership primitive in both engines, interoperable through a dedicated SQLite lock file with an exclusive transaction held for the running node. Acquire before reading mutable configuration/private state; release only after workers and transports stop. OS release on process death is required; never reclaim by stale wall-clock timestamp or kill a PID from a lock file. A second compliant process fails with an actionable already-running state. No external service, heartbeat daemon, elevated permission or settings change. Explicitly test startup races, clean close and abrupt death in real Node/Go processes before importing into the apps.
2. Pin the protected store ID in separately signed installation metadata bound to the local identity. A missing or mismatching binding after initialization fails closed. A complete older valid installation backup remains an explicit undetectable rollback limitation. Migration must distinguish never-initialized, staged and committed states; do not silently initialize an existing damaged database.
3. Move the authenticated private application state into bounded records inside the same protected transaction as group authority/admission. Preserve the existing16MiB bound; split at most32 chunks of512KiB with an exact length/hash manifest. Validate complete canonical bytes through the existing semantic private-state parser. This uses the existing64MiB ordinary metadata allocation; it does not create an invisible second quota. Keep a versioned, explicitly recoverable import from the legacy encrypted file; no destructive reset or silent fallback to an older legacy copy after committing migration.
4. Expose an explicit transaction-scoped authority facade to the runtime coordinator. Existing standalone registry methods remain atomic for their library callers. Application group commands, received proofs, accepted-ID/fence updates and outbox decisions share one synchronous SQLite transaction. Exact content bytes are stored/verified first; display, receipts and first network transmission happen only after successful metadata commit. A rejected trailing proof can still have committed its verified prefix; reconcile current authority before subsequent sends.
5. Add bounded proof/carrier sync, strict audience admission, quarantine and immutable superseded outbox intents; preserve fixed-group compatibility and existing deletion/expiry/receipt privacy. Then expose API/UI state, dynamic group commands and actual process transport/UI tests. No public runtime button or claimed dynamic-group support until those paths exist.

## Required controls

- Positive second-profile startup; negative same-profile startup in both cross-runtime directions. Restart after graceful close and real process death, with no unrelated process termination.
- Migration crashes before/after each durable boundary; wrong identity/store ID, missing chunk, truncated/tampered bytes, reordering, old manifest/new chunk and complete valid backup limitation. Preserve old data on failed migration.
- Group removal/closure/fork/leave/capacity and outbox acceptance in one commit, pre/post-commit process exits, partition/heal, exact original readers, no silent historical key sharing, ambiguous write/readback lock.
- Retention and quota remain bounded, including SQLite/journal overhead. Test all operations before claims. New runtime imports must extend source digests used by mixed-process/native artifacts; rebuild and rerun affected binaries/UI.

No implementation of this runtime boundary is claimed by the authority-library or certificate/storage interop results.

## First runtime integration verified locally

Profile ownership now guards both `LoomNode` and `native/app.Node`. Stale closed instances cannot reopen or mutate a profile held by a successor. Constructor failures release ownership without altering the rejected configuration; concurrent close callers wait for completion. The targeted runtime/outbox Node18 and Go profile2 cases passed, plus two real CLI/API cross-runtime cases preserving the exact pending message/operation ID. Full source-frozen Node133 passed; the complete Go/interop/UI/desktop sequence is still running in session82452. Store-ID binding/private-state migration and authority/admission/outbox unification remain unimplemented.
