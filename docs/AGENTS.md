# Actual delegation evidence

2026-09-11, this Codex graphical task, with the existing model selection inherited and no override.

| Actual agent/task | Exclusive assignment | Observed result |
| --- | --- | --- |
| `/root/crypto_store` | `packages/core/**`, core tests | Spawn accepted, execution failed `unsupported_input`; follow-up failed `encrypted_input` |
| `/root/transport` | `packages/transport/**`, transport tests/docs, PTY fixture | Spawn accepted, execution failed `unsupported_input`; follow-up failed `encrypted_input` |
| `/root/core_engineering` | Fresh context (`fork_turns=none`), cryptography/store | Spawn accepted, execution failed `encrypted_input` |
| `/root/transport_engineering` | Fresh context, TCP/serial routing | Spawn accepted, execution failed `encrypted_input` |

No agent authored files or produced engineering/review results in these attempts. These are real failed task attempts, not successful multi-agent evidence. Independent review remains blocked on working delegation or another reviewer; root self-review cannot fulfil that gate. Provider/authentication/bridge/safety settings were not changed.

## Delegation recovered during implementation

A subsequent fresh-context task `/root/security_review` started successfully and delivered actual code review findings: malformed HTTP URL crash, missing inbound ACL/receipt semantics, unbounded ACK output. It is a read-only review; root owns server/domain fixes. Earlier failures remain recorded and are not rewritten as successes.

Two complementary fresh-context tasks were then dispatched: `/root/transport_hardening` owns only `packages/transport/**` and transport tests (bounded ACKs, fragmentation fairness, adversarial tests); `/root/design_review` is read-only review of rendered screenshots and UI/accessibility. Results remain pending until received. No model/provider override or setting change occurred.

## Results integrated

- `/root/security_review`: reviewed cryptography/ACL/storage/HTTP, then owned `packages/core/**` and core tests. Added object count cap, verified metadata cache, safe quota planning and optional LRU touch. Reported 10/10 core tests and typecheck passed. Root regression tests cover its server/semantic/journal findings.
- `/root/transport_hardening`: owned only transport package and transport tests. Implemented bounded ACK writer, fragment priority/fairness, capped retry/assembly/flood state and consent pause queue cancellation. Reported 16/16 transport tests and typecheck passed. Root adopted its fourth `relayOnly` broadcast argument.
- `/root/design_review`: inspected real onboarding/messenger screenshots plus source, identified recipient-draft leakage, search/selection, missing announcements/delivery text/semantic states and unsaved editor drafts. Root fixed these and added e2e checks. The same agent then received a separate simulation task, exclusively `packages/simulation/**`, simulation test/script/docs.
- Root integrated the branches by explicit file ownership in the shared repository, reviewed changed interfaces and ran the combined suite: 41 tests and one broad two-client browser e2e passed. No child changed providers, authentication, bridge or safety settings, installed dependencies, or committed.

The independent design review was not a physical device or screen-reader test; simulation remains a distinct evidence class.

Simulation task completed: `/root/design_review` produced the bounded virtual-time engine, scenario/test suite and explicit evidence boundaries. Its 9/9 tests and all 16 baseline/control assessments passed. `/root/security_review` independently read the simulation and found its broken controls meaningful, while noting that model bundle acceptance is not application decryption/display; SIMULATION.md now states that scope directly.

Subsequent work dispatched to `/root/transport_hardening`: secure desktop shell, exclusive ownership of `apps/desktop/**`, desktop scripts/docs. It is not part of the baseline verified code until integrated and tested; no native desktop result is yet claimed.

## Later complementary tasks

- `design_review` implemented VoiceRecorder/media tests and browser notification hook/tests in separate owned files. Media uses real browser encoders and real TCP peer nodes, with explicitly synthetic capture input; physical microphone capture remains unverified. Root fixed FileList and recipient-change integration bugs found by those tests.
- `security_review` implemented strict immutable collection/following helper logic and 8 tests; root integrated encrypted persistence, APIs, retrieval and UI with independent process/browser tests.
- `transport_hardening` built/executed the sandboxed Linux Electron shell and Linux unpacked package; `security_review` independently reviewed origin isolation, subprocess bootstrap, download names, clipboard/microphone policy and packaged fuses. Root must still rerun integrated desktop artifacts after later UI changes.
- Mobile feasibility found maintained Go1.26/x-mobile viable. `security_review` now owns `native/core/**` and native vector tests; `transport_hardening` owns `native/transport/**` and interoperability tests, while temporarily prioritizing a demonstrated Node/macOS serial defect. Root owns toolchain/SDK prerequisites and native API/shell integration. Native/mobile code is not covered by earlier Node gate evidence.

## Owner integration note and resumed work

The owner reported the bridge correction and instructed resuming actual agent tasks without modifying configuration. Root revalidated the collaboration tree: security/core and transport tasks had real completed code/test results; the Android task had stopped with `408 copilot_upstream_rejected` after earlier verified tool installation work. Root resumed that Android task from existing files, then dispatched independent native transport/Android security review and mixed Go/Node application-process integration tests with disjoint file ownership. Each resumed agent returned an actual acknowledgement/status; completion still requires source and test output, not dispatch. No bridge/provider/authentication/safety settings were changed by these tasks.

## Final returned results before native/platform milestone commits

- `/root/transport_hardening` implemented native API snapshot/cache/request/mutation fixes and returned17 normal +17 race tests, rebuilt CLI hash and2 real mixed-process successes. A subsequent read-only task delivered `REMAINING-SCOPE.md` with eight concrete implementation slices and verified local links.
- `/root/design_review` built and installed the final Go-embedded Android APK (`e1bdb088…d2a0`), returned16 simple +11 multi-hop/seed/lifecycle assertions in the single API36x86_64 emulator, and corrected a test's ambiguous UI wait before capturing the actual offline page. The final image was inspected by root. Sanitized reports/images live in `docs/evidence/android`; no physical-device/microphone/OS-notification result was inferred. The agent stopped only its owned AVD and isolated adb server.
- `/root/security_review` delivered an explicit self-review of its iOS shell plus independent desktop/CI pre-commit review. It identified a false-positive desktop network control, replaced it with a reachable loopback fixture and independent sandboxed renderer, then returned actual Linux smoke counters main1/control1/protected0 and clean shutdown. Root read the helper and repeated packaging/execution of the unpacked Linux executable successfully.
- Root reran66 Node tests, all10 Node browser cases, the later browser drag/drop input fixture, all10 Go browser cases, and3 mixed/vector tests. These are concrete returned/executed results; task dispatch was never used as completion evidence.

All tasks used the existing harness without model/provider/authentication/bridge/security-setting changes. Source ownership remained disjoint; Android and heavy native builds shared one build slot.

## Returned outbox/mobile work and temporary sequential check — 2026-09-12

These are actual returned files/reports, not task-creation evidence. The owner temporarily prohibited new/resumed agents and requested one bounded sequential test. Root waited for the already running agents to finish without interrupting them; no new task or resumption was dispatched in this check.

- `/root/transport_hardening` had already completed the native outbox/application work and reported 36 normal/race application tests. It subsequently returned the real iOS simulator runner, XCUITest target and eleven passing host-only runner tests. Root reviewed and integrated the runner into the local CI workflow. It has not yet been executed on Apple; `docs/IOS-SIMULATOR.md` defines that outstanding gate.
- `/root/design_review` returned the actual SAF Android implementation, exact APK `4de67c3e1540556bbbcab98e7053112bfce2625cdf994c4de67c2d15403b77bb`, and 38 SAF + 15 deadline/lifecycle + 16 message/recovery + 11 relay/seed assertions from the single emulator. Its later deadline checker has 28 local policy/session assertions and an independent source review, but no new APK/device gate. The agent's final response confirms its emulator/isolated adb stopped, the same AVD/identity retained, and the pending exact-artifact work recorded in `docs/evidence/android/documents-4de67c3e/post-apk-source-handoff.json`.
- `/root/security_review` returned `docs/GROUP-EPOCHS.md` and 33 declarative cases in `tests/fixtures/group-epochs.json`. They specify creator authority, immutable epochs, original-reader quarantine, historical facts and finite storage. They explicitly say `DESIGN_ONLY_NOT_EXECUTED`: no production code or group-epoch tests were executed by this delivery.
- `/root/security_review/group_epoch_adversary` was already complete before root's single test. Its final source-only Android deadline review found no remaining concrete defect and ran no Android/device tests. Earlier protocol/design findings are attributed in the relevant reports, separately from root's test execution.

Root updated README, STATUS, the durable plan and acceptance traceability to reflect these version boundaries. `.codex-delivery/SEQUENTIAL-CHECK.md` records the one subsequent test and its exact outcome. No bridge/provider/authentication/safety settings were changed.


## Site studio — 2026-09-16

The owner continues to require sequential recovery without new/resumed agents. Root implemented and reviewed the multipage studio and ran actual tests; no collaboration task was dispatched for this increment. Prior agent evidence above is unchanged. Root's rendered-image review, parser conformance controls and Axe results are not independent review. That requirement remains open for the site increment. Provider, model, bridge and authentication settings were not changed. Detailed execution records: `.codex-delivery/SITE-STUDIO.md`.
