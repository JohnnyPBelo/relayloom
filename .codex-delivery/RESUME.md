# Authoritative RelayLoom checkpoint — 2026-09-12

Project only `/home/absint0o/projects/relayloom`; full `PROJECT-BRIEF.md` remains active and incomplete. PT-PT. Preserve Astra/Copilot Ultra, providers/authentication/bridge/permissions/safety settings. No new/resumed agents in this sequential recovery phase; previous real returns are in `docs/AGENTS.md`. No unrelated workspaces/files/services, root changes or purchases. Project caches, one heavy build at a time, at least15GiB free. Most recent disk reading122GiB free. Normal coherent commits/pushes authorized; never force-push, merge PRs or publish secrets.

## Git and active processes

Local milestones `aec662d` (iOS failure evidence) and `13fbf49` (Node storage) follow remote `b09f7f5`. They have not been pushed, to avoid another unchanged iOS addmedia attempt. The Go/corrective storage milestone is ready for final documentation/commit. Recheck actual Git state before acting; no reset/clean.

All root test sessions are terminal, including7162 (integrated gates) and69460 (corrective gates). Do not restart them on an unavailable handle. Raw working outputs remain under `.cache/group-storage-evidence`; retained artifacts are already copied to docs. The tests also refreshed `docs/evidence/heterogeneous.json` and group-certificate interop evidence; these are real new results from the command window. No active app/emulator/build is known from this phase.

## Group foundations: implemented, not yet part of the applications

- `packages/groups/src/certificates.ts` and `native/groups`: signed anchors, epochs, invitations/consent/leave, snapshots and transitions.11 Node and8 Go cryptographic cases plus actual cross-runtime vectors.33 original JSON fixture labels remain design cases, not executed signatures by themselves.
- `packages/groups/src/storage.ts` and `native/groupstore`: actual encrypted SQLite records, locally signed encrypted index, identity/store/key/revision binding, atomic index+rows, bounds/reserve, poison on uncertain/integrity state, exclusive explicit creation and separately supplied expectedStoreId. Shared SQLite format works between Node and Go. Driver `modernc.org/sqlite1.58.0`, exact `libc1.75.6`; root licences retained in `docs/licenses/native-sqlite`. Node minimum22.13 reflects built-in SQLite import; no harness setting changed.
- Storage does not itself enforce group authority or protect a head against an authorized higher-layer delete. Callbacks must not display/confirm side effects before commit returns. Integration must persist/pin expectedStoreId separately, keep missing/corrupt metadata fail closed, account SQLite pages/journal as well as serialized bytes, and serialize authority/admission/outbox decisions. Complete valid backup rollback is explicitly undetectable; tests demonstrate this limitation.

Storage gates are deliberately versioned in `docs/GROUP-STORAGE.md`:

1. Initial Node milestone: build6.187s and103 Node tests58.653s passed.
2. Integrated Node/Go gate before the last schema correction: build7.826s,104 Node54.758s,76 top-level Go tests with race188.971s (11core/11transport/37app/8groups/9groupstore), all7 interop cases106.941s passed. The2 Go fixture helpers are intentionally skipped in unit mode and executed by the separate Node drivers. Evidence: `docs/evidence/group-storage/integrated`.
3. Local review found SQLite `LIKE 'sqlite_%'` used `_` as a wildcard. Both actual regressions failed on an extra `sqliteXconcealed` table before changing both engines to literal `substr` comparison. Corrective build5.807s,12 Node storage cases1.418s,10 Go storage cases with race2.245s and real storage interop2.795s passed. Final source/output hashes were checked against retained records. Evidence: `docs/evidence/group-storage/schema-correction`. Do not relabel the earlier all-suite counts as a full run of the corrected files.
4. Actual storage interop shares encrypted bytes, runs one Node/one Go writer with24 increments/revision27, recovers each engine's deliberate pre-commit process exit from a hot rollback journal, and rejects a corrupted committed row in both engines. Synthetic private keys exist only in temporary0600 project cache inputs, removed after children exit. No mobile execution or group application integration is claimed.

Also corrected in both stores: a replacement callback exception/panic must not erase an already observed integrity failure. Typecheck initially found an untyped import in the new test; `scripts/ios-simulator.d.mts` declares the existing unchanged process supervisor used by the fixture. No independent review of the new storage code has occurred. Near-capacity throughput and eventual group-history UI costs remain unmeasured.

## Latest remote CI and Apple blocker

CI34671406360 for `b09f7f5f968f98292e4ccd73f8e11fdbff9adbff` completed. Node on three OS, full Go job and all desktop packages passed; Linux executed native/packaged smoke under Xvfb. This confirms the presented-frame capture fix after earlier UnknownVizError.

iOS built the unsigned framework/app/UI test, booted its one installed iOS26.5/Xcode26.6 simulator in191998ms and installed the app. `simctl addmedia` then timed out in60976ms importing the synthetic photo. **XCUITest never began; no app execution is claimed.** Cleanup deleted exactly the owned simulator. Evidence `docs/evidence/ios/b09f7f5`; provenance distinguishes original and whitespace-normalized published logs. One subsequent bounded Linux-host runner command passed11 cases/1.187s; it does not clear the Apple gate.

Do not rerun the same unchanged Apple setup or inflate timeouts in a loop. A next Apple attempt needs a concrete diagnostic/corrective change while preserving photo coverage, single-device/no-download/global20min/15GiB constraints and exact cleanup. No bridge/provider408 was observed in this recovered checkpoint; do not attribute previous408s to concurrency or this separate Apple command without evidence.

## Existing native artifacts and UI

UI assets remain `index-CFZzmFWN.js` and `index-DwCp7KCv.css`. Earlier15 UI cases per backend, keyboard/Axe/8 widths, native Linux desktop/package and CI execution are versioned in STATUS. New storage libraries do not change these runtime assets.

Android AAR51dedfe084c9fea8da616a3f35c3d6aece57c0a77cf4441ced5bc7ecc44e8a0f and APKfa1481d360e3bf28dc114352f3014369f55d2b1da36569bfb2bba0db035e18d1 include the earlier expiry/layout fixes. Exact-artifact SAF38/deadline15/messages16/relay11 passed80 assertions; hashes/inputs unchanged. Same API36x86_64 AVD and identity retained, test instrumentation removed, own emulator/adb stopped. Evidence `docs/evidence/android/documents-fa1481d3`. The SQLite probe cross-built Android/ios arm64 packages only; those are not mobile persistence tests and the APK does not contain this storage code.

No physical Apple/Android/radios, distribution signing, real microphone/screen-reader or disaster readiness claim. BLE/Wi-Fi Direct/LoRa remain unimplemented; Reticulum interoperability is not claimed.

## Next implementation work

1. Finish/commit the verified Go storage milestone and status/notices without losing current changes. Decide the next concrete Apple diagnostic before a push triggers its unchanged CI stage; never remove coverage to obtain green CI.
2. Implement actual group authority registry on the storage foundation:64 enrolled groups, retained anchors/ancestry, exact heads, durable fork/left/capacity fences, nonce-bound pending requests and closed state. Group certificates outlive content TTL. Reserve4MiB of64MiB protected metadata for stops/checkpoints; no head/fence LRU eviction.
3. Add bounded proof sync/carriers and private snapshots, then serialized admission/accepted-ID records, quarantine after restrictive epochs, target-reader events and immutable/superseded outbox intents in both engines. Preserve fixed groups and never silently distribute history keys/new audiences. Once libraries are imported by runtime, extend mixed-test production digests to include `packages/groups/src`, `native/groups`, `native/groupstore`.
4. Real UI create/invite/accept/remove/leave/fork/quarantine/republication flows and adversarial process/partition/restart/expiry/quota controls. Independent review is still required and has not occurred during the no-agent phase.
5. Continue native key storage/rotation/recovery, full-history search, profile/social/media/templates, real notifications and remaining acceptance gates. The complete contract is not reduced to group foundations.

Earlier detailed checkpoints are preserved in `.codex-delivery/history/RESUME-before-group-storage-complete.md` and `RESUME-before-fa1481d3.md`. Authority design: `docs/GROUP-EPOCHS.md`; task sequence: `.codex-delivery/GROUP-IMPLEMENTATION.md` and `GROUP-REGISTRY.md`; complete traceability/learning remains under `.codex-delivery`.
