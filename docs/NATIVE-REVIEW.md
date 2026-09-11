# Native review record — 2026-09-11

This records the actual review scope and evidence from the `/root/security_review` task. It is not a blanket security certification or a claim that mobile acceptance is complete.

## Attribution and method

| Scope | Review classification | What was done |
| --- | --- | --- |
| `native/transport/router.go`, `link.go`, transport tests | **Independent code review**: implementation belongs to `/root/transport_hardening` | Read framing, reassembly, bounds, retry/retention, consent, shutdown and regression source. Reported retained-byte accounting flaw; reread its correction. |
| Android `MainActivity`, `OriginPolicy`, `AssetInstaller`, `RuntimeLeaseCoordinator`, manifest/network config and bundled adapter | **Independent code review**: implementation belongs to `/root/design_review` | Read capability/origin, native bridge, microphone/notification and lifecycle controls. Reported cross-Activity singleton shutdown race and an asynchronous permission-completion guard gap; reread corrections. |
| `native/core/**` against `packages/core/src/index.ts` | **Self-review**: this reviewer implemented the initial Go core | Compared crypto/wire/serialization/storage invariants and parser behavior. Root subsequently added password-surrogate byte conversion and a structural parser budget. This portion does **not** satisfy an independent core audit gate. |
| `native/app/**`, mobile facade | Outside the independent-review scope | The reviewer authored these too. Their earlier implementation tests are factual test evidence, not an independent security review. |

This follow-up changed only this document. No bridge/provider settings, permissions, root-owned files, SDK installs or unrelated workloads were changed.

## Independent findings and follow-up

| ID | Finding and impact | Current reviewed status | Evidence / required regression |
| --- | --- | --- | --- |
| I-1 | `native/transport/router.go`, `retainLocked`: an ID could remain in priority retention after the bounded `seen` map forgot it. Replaying the ID replaced its entry but added its size again. Later deletion/expiry left phantom bytes, reducing or exhausting capacity until restart. | **Correction inspected in source; author reports normal and race suites passed.** Existing retained IDs now return their immutable snapshot before capacity admission; byte accounting and local `relayOnly` provenance are preserved. | `native/transport/retention_test.go` exercises the actual receive method with a protected SOS, 4,096 normal packets, then a replay. It also repeats a retained ID 8,192 times, preserves consent/snapshot/order, checks removal/expiry reaches zero, and refills capacity. The author executed the expanded 11-test suite; the reviewer did not rerun Go tests. |
| I-2 | Android's original per-Activity executor called process-global `Mobile.stop()` unconditionally from both `onStop` and `onDestroy`. An old Activity's delayed stop could shut down a replacement Activity's new core. | **Correction inspected in source and coordinator regression executed.** One process-scoped serial coordinator owns a unique runtime lease. Stale stops only act when their lease owns the running backend. Endpoint publication and bridge ownership require the current lease. | `RuntimeLeaseCoordinatorTest` covers old Activity stop after replacement, cancelled delayed start, rapid replacement and final-owner cleanup. Reviewer executed the already compiled class: **7 assertions passed**. This uses a fake backend on the host JVM, not actual Activity/JNI execution. |
| I-3 | The first lease fix checked microphone ownership when requesting permission, but the asynchronous Android permission result still checked only per-Activity generation/foreground state. A replaced Activity could complete a stale permission request. | **Correction inspected in source.** Completion now requires the current runtime lease, an extant endpoint and matching permission-request origin; notification completion also checks the lease. | Source reread only for the permission callback. No physical microphone, OS permission-dialog or Android lifecycle interaction was executed by this reviewer. |

The framing review found bounded frame bytes, canonical base64 checks, count/aggregate assembly limits, bounded local delivery queues, coalesced/rate-limited ACKs and one writer per link. Disabling relaying removes pending/retained `relayOnly` traffic. The review did not find another concrete framing or consent bypass in the inspected revision; this statement is limited to source inspection, not an adversarial exhaustion benchmark.

Android checks the exact loopback origin/port, verifies bounded bundled assets, keeps assets separate from persistent core data, denies file/content access and external navigation, cancels SSL/auth challenges, and never logs the capability token. Its native notification interface takes a capability and emits fixed generic text; it does not expose shell/file/general HTTP operations. These observations do not establish complete WebView containment against arbitrary compromised renderer code or a completed platform security audit.

## Core self-review findings and compatibility profile

| ID | Observation | Status and appropriate next check |
| --- | --- | --- |
| S-1 | `native/core/store.go` still derives cached-manifest fingerprints from file metadata (size, timestamps and platform stat fields). The Node store was strengthened to hash actual bounded file bytes after repeated timestamps were observed in Windows CI. Repeated metadata can let native `List()` reuse stale verified metadata after a same-size corruption. `Get()` still rereads and verifies, so this does not bypass verification before display/serving. | **Reported to root; not modified in this review.** Match the bounded-byte fingerprint policy. Regression: warm the cache, rewrite same-size bytes and restore/repeat timestamps, confirm `List()` excludes corrupt data and `Get()` rejects; restore valid bytes and confirm recovery. |
| S-2 | Go's typed JSON decoder rejects extra or missing fields, and `VerifyManifest` checks every reader envelope. The Node reference currently accepts extra signed fields and does not validate every envelope before attempting the reader's selected envelope. Consequently, successful generated vectors do not imply identical acceptance of every Node-accepted input. | **Reported to root; strict validation is preferable to accepting malformed envelopes.** Root intends to align the Node profile. Until harmonized, scope interoperability to the tested generated corpus and explicit wire schema. Regressions should sign malformed/extra-field fixtures and assert consistent rejection across both runtimes. |
| S-3 | File writes use temporary-file replacement; Go syncs the temporary file before rename. Neither the Go store's object/index operation nor quota eviction is a general rollback transaction for arbitrary I/O failure. A successful capacity plan can delete files before a later index-save failure. Directory rename durability/power-loss behavior is not established by the normal restart tests. | **Known verification limit, not a claimed peer exploit.** Add project-scoped fault injection at object rename, eviction and index persistence boundaries before describing all crash/disk failures as transactionally handled. Current tests establish impossible quota requests preserve objects and ordinary restart reconciles stored objects. |

The strict Go field sets inspected are:

- Bundle: `manifest`, `chunks`.
- Manifest: `version`, `author`, `kind`, `created`, `expires`, `nonce`, `tag`, `chunks`, `keys`, `publicKey`, `salt`, `id`, `signature`.
- Public identity: `id`, `name`, `signKey`, `boxKey`, `proof`.
- Chunk reference: `hash`, `size`.
- Reader envelope: `reader`, `ephemeral`, `nonce`, `data`, `tag`.
- Private identity: `public`, `signSecret`, `boxSecret`.
- Vault: `version`, `salt`, `sealed`; sealed object: `nonce`, `data`, `tag`.

Reader IDs are lowercase 64-character hexadecimal strings. Ephemeral keys must decode from canonical base64 into X25519 SPKI DER; envelope nonce/tag/wrapped-key lengths are 12/16/32 bytes. Manifest chunks are bounded to 171 references, each 1–24,576 bytes and at most 4 MiB total. Reader arrays are bounded to 64, with at least one for private content. Manifest nonce/tag/salt lengths are 12/16/16 bytes; an exposed public content key is 32 bytes. Cryptographic ownership remains tied to the author's Ed25519 signature, not reading or seeding access.

The generated Node↔Go tests exercised UTF-16 key ordering, string escaping/lone surrogates, 1,500 randomly generated finite floating-point vectors, DER identity formats, vault recovery, private/public bundles, tamper/unauthorized-reader/reader-forgery rejection and persistent seeding in both directions. These are meaningful compatibility controls, not proof over every floating-point value or every input accepted by either parser. The cryptographic primitives themselves come from maintained Go/Node libraries; the application protocol still requires an external cryptographic design audit.

## Executed evidence

**Executed by this reviewer during this follow-up, without recompiling:**

```text
.cache/toolchains/jdk17/bin/java -cp .cache/android/policy-test org.relayloom.android.OriginPolicyTest
OriginPolicy: 21 boundary assertions passed (host JVM; not WebView/device testing)

.cache/toolchains/jdk17/bin/java -cp .cache/android/policy-test org.relayloom.android.RuntimeLeaseCoordinatorTest
RuntimeLeaseCoordinator: 7 lifecycle assertions passed (host JVM fake backend; not Activity/device testing)
```

**Earlier execution by this same reviewer during implementation (self-test evidence):**

- `node scripts/go.mjs test -p=2 ./core`: initial eight Go core tests passed.
- `node --import tsx --test tests/native/native-interop.test.ts`: one broad generated-vector test passed using real Node and Go processes.
- `node scripts/go.mjs test -race -p=2 ./app`: seven application tests passed; this was implementation validation, not an independent app review.

Root later reported the expanded core suite (10 tests) and generated interoperability gate passing after its surrogate-password/parser-budget changes. After the retention correction, `/root/transport_hardening` reported `node scripts/go.mjs test -p=2 ./transport` passing in 6.557 seconds and `node scripts/go.mjs test -race -p=2 ./transport` passing in 9.554 seconds: 11 tests including the two new retained-replay regressions. These results are attributed to their executors; they are not new reviewer executions. The author did not rebuild the Go CLI or AAR as part of that correction task.

No Android device/emulator, physical microphone, native permission dialog, BLE/Wi-Fi Direct/USB/radio, Apple build/device or background execution was tested by this reviewer. Android was still undergoing its build/runtime gates while this record was written.

## Relationship to the product brief

The reviewed work advances the brief's bounded parsing/routing, read-versus-write authority, encrypted recovery, cache quotas and native on-device architecture. It does not close the full acceptance contract. Native keychain integration, complete rotation/revocation/ratchet design, independent cryptographic audit, arbitrary disk-failure recovery, hardware transport behavior, mobile lifecycle/device testing and complete platform packaging remain separate requirements. The foreground-only Android policy is an explicit capability limit, not proof of continuous mobile background relaying. Simulation, host JVM tests, native host processes, emulator runs and real-device evidence must stay separately labelled.

## Root integration follow-ups after this review

Root changed native disk fingerprints to SHA-256 of bounded actual bytes and added a same-size overwrite/restored-timestamp regression. Root tightened Node identity/vault/manifest/chunk/key-envelope schemas and validates every reader envelope before acceptance, aligning generated strict wire contracts instead of weakening Go validation. Root reran11 core tests,11 transport tests and7 app tests with race detection, then all3 mixed-process/vector tests. These are root execution results, distinct from the review author's independent/static work. `docs/evidence/native/host-gates.json` and mixed reports record the current host scope; Android/iOS execution is not implied.
