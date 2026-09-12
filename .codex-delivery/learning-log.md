# Learning log

## Prevention rules

- Treat a task spawn response as dispatch only; require actual agent outputs/files before claiming delegated work.
- Keep tests and all runtime data within project .cache/.runtime.
- Review cryptographic signatures on received and displayed content, not just initial publication.
- Serial PTY evidence does not prove radio or mobile behavior.

## 2026-09-11 — setup and delegation

Four actual agent tasks accepted but immediately failed: unsupported_input/encrypted_input. Retrying minimal prompts and fresh contexts did not produce engineering output. Preserve provider/authentication as instructed; continue root engineering and record independent-review gate as unmet.

## 2026-09-11 — real transport and UI review

- Initial crypto/socket/process gates passed. Three processes verified TCP-to-serial PTY, partition/heal and offline publisher takeover. This is real OS transport evidence, not physical radio evidence.
- First UI audit found small-text contrast failures. Light tokens were darkened; dark mode also needed the root foreground/background to use theme variables. Failed axe reports were used to fix the actual elements, then rerun.
- An ambiguous group checkbox locator matched a reply control too; tests now identify the checkbox role exactly.
- Same-document launch links after a node restart did not re-read the new capability fragment. A hashchange handler now updates local authentication; recovery test preserves the current page and navigates explicitly.
- Independent design review found cross-recipient drafts and name-only search hiding the selected conversation. Drafts are now keyed by recipient, selection is independent from filtering, and search includes message content. The editor has encrypted local draft save/recovery.
- Independent security review found unauthenticated malformed-path crashes, receipt/public-message semantic bypass, queued ACK amplification, quota/count work amplification and deletion resurrection after cache loss. Root and dedicated agents implemented regressions and fixes. Exact current gates are tracked in STATUS; no completion claim follows from review alone.

## 2026-09-11 — cross-platform CI and second feature milestone

- Public baseline commit 85793be passed the local build, 42 tests, a two-client E2E and simulation gates. CI then exposed platform differences instead of being treated as proof from configuration alone.
- Linux hosted Chromium could not initialize its sandbox. CI now uses the runner-supplied Chrome with `chromiumSandbox: true`; no OS/security setting was disabled. That Linux CI job passed.
- Windows fixture cleanup needed to recognize a signal-terminated child as already stopped. Added a SIGKILL/idempotent-stop regression. The next Windows run passed, then a later run exposed a separate timestamp-cache issue.
- Windows file timestamps can repeat during a same-size overwrite; verified metadata now keys on the actual bounded file bytes, not timestamps. Core test asserts corruption disappears from list before get(), and all 10 core tests pass locally. Native Windows CI rerun remains required for this fix.
- macOS serial fairness timed out twice. Diagnostics show complete SOS but a stalled bulk native write; changing the test to a realistic baud-derived budget did not resolve it. A dependency poller read/write-interest race was then identified by the transport agent; its patch and native rerun are pending. Do not label the latest macOS gate passed based on an earlier run.
- Media E2E found that clearing a file input mutated a live FileList between awaited reads. Snapshotting the list before awaiting fixes loss of later attachments. A conversation-generation guard prevents attaching to a newly selected recipient.
- Named collections now persist inside the authenticated encrypted local state; followed-author filtering and explicit hash retrieval never grant read access. API integration and the collection UI E2E passed. A membership checkbox now updates optimistically and rolls back on failure.
- Node mobile embedding's released runtime is EOL. A maintained Go native core is being compatibility-tested as an actual on-device alternative, rather than presenting an external-daemon WebView as mobile completion. The selected patched Go archive was downloaded from go.dev and verified against its published SHA-256; all caches remain inside the project.

## Application snapshot, lifecycle and Android execution hardening

Independent application review identified request-map growth on transport errors, full-state responses exceeding the native encoder limit, late state responses restoring a locked UI, and received tombstones lost before quota eviction. Both application runtimes now have bounded paginated summaries and authenticated attachment retrieval; tests exercise a legitimate encrypted store above24MiB, history cursors, quota-pressure deletion and failed-broadcast bounds. UI applies generation/response ordering, nonoverlapping polling and lazy attachment requests. A successful response never overrides a later lock with older private state. Summary caches remain identity-scoped, bounded16MiB/1024 and conditional on freshly verified file-byte fingerprints; local ACL/mutation decisions are still reapplied.

Tests caught duplicate placement of the history action and a scroll position that kept a restored attachment below the mobile viewport. The action has one location and returning to a conversation scrolls to recent messages. File bytes are now intentionally omitted from periodic state; tests retrieve them from /api/attachment or /api/view and compare exact originals.

The single Android API36x86_64 emulator required recovery of interrupted encryption only in its empty test userdata and explicit owned console/adb ports. Normal authentication and host security remained enabled. The preliminary APK subsequently passed UIAutomator identity creation, actual in-process Go→Node encrypted exchange, stored-ciphertext checks, background listener shutdown/resume and a Node→Android→Node multi-hop/partition/seed takeover gate. Every report records the preliminary APK hash and distinguishes emulator from physical hardware. The final APK must be rebound and rerun after current app hardening; initial success is not substituted for that final gate.

## Final host/emulator gates and reachable desktop control

The final APK was rebuilt after native cache/history changes and its installed SHA-256 was independently matched.16 simple and11 multi-hop/seed/lifecycle assertions passed. A screen capture initially lagged the DOM because a test predicate matched both the old conversation list and the new feed. The fixture now waits for the exact feed, author button, modal and native-visible state; root inspected the actual offline-site screenshot. Capture/DOM alone is not substituted for network bytes and signature controls.

Independent desktop review found that fetching a .invalid host makes a negative test pass even without app network restrictions. The new smoke reaches a harmless loopback server from the main process and a separate sandboxed control renderer; the protected renderer rejects without reaching it. Observed request counters1/1/0 passed, as did rebuilt Linux packaged execution. Never use unreachable hosts as the only evidence of a network boundary.

## Outbox integration, supervision and review — 2026-09-12

The published c3f5b42 CI completed8 jobs including actual Apple compilation and Windows/macOS desktop packaging. Later source-under-edit supervision caught a group reply failing contact lookup; this was not attributed to the earlier green commit. Native owner restored best-effort contact learning and exact signed-roster confirmation resolution, preserved ACLs, and reran the focused test plus stable full gates. Final results remain pending until the source is frozen for each gate.

Independent outbox review required durable acceptance to flush files and parent directory entries on POSIX, read back authenticated metadata after uncertain post-rename failures, journal incoming confirmations before admission can evict their target, keep historical counters after payload/receipt loss, and distinguish retained bytes from pending pin ownership. Raw idempotency is bounded by256 retained operation records; pending records are protected, and the UI requires fresh unlocked state plus an explicit new-send choice for an absent uncertain operation. A locked snapshot's empty outbox never proves pruning.

Tests found nondeterministic recipient order after canonical encrypted-state recovery; snapshots now sort recipient IDs rather than depending on map insertion order. Browser review found a transient contrast failure while a secondary button's background animated between light/dark with an already changed foreground. Secondary surfaces now switch colour coherently. Modal tests must scope controls/text to the dialog because the same message can also occur in the underlying conversation.

## Temporary sequential stability measurement — 2026-09-12

The owner distinguished an approximately 61-second Copilot upstream timeout from the local bridge timeout, with concurrency still only a hypothesis. Root did not change providers, authentication, bridge or safety settings and did not create/resume/interrupt agents. Already active Android and protocol agents finished and returned actual files/results; their pending device/design-only limitations were integrated before testing.

Exactly one selected outbox browser case ran once on Node: `node scripts/e2e.mjs tests/e2e/outbox.spec.ts --grep 'durable composer retries a lost response once' --reporter=line --output=.cache/sequential-stability/outbox`. Result: one passed in 11.7 s, exit 0, zero retries, unchanged production/input hashes. It covered lost-response idempotency, restart, own retry with relay paused, actual received/read transitions, dialog feedback and four captured accessibility states. The output/evidence is retained in `docs/evidence/sequential-stability/2026-09-12`.

No new upstream 408 was observed in this stage. One successful local test is not a causal concurrency experiment or a provider reliability guarantee. Preserve exact attempt counts, separate wait deadlines from upstream failures, and never silently restart an uncertain run. Android's later source checks must not inherit the earlier APK's 80 emulator assertions; the group fixtures remain design-only. No additional test/build/push was initiated during this measurement.

## Final Android artifact integration after the measurement

Root continued in a separate sequential phase with no new/resumed agents. The final checker/UI APK 27a71947 passed all four emulator gates once: 38 SAF, 15 deadline/lifecycle, 16 message/recovery and 11 relay/seed assertions. Installed hashes matched before/after and recorded Android/web/AAR inputs did not change. The actual listener cutoff was observed at 121264 ms including fixture overhead; do not translate that into a hard scheduling guarantee during physical sleep. The same AVD/identity was retained and owned emulator/adb/test provider were cleaned up.

Verified outbox, iOS runner and Android source were committed as separate milestones. Apple simulator execution remains pending CI; the existing build-only Apple result is not substituted. Source/code checks and physical-device results remain separate evidence classes.
