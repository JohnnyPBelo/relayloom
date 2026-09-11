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
