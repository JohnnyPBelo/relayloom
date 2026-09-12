# Durable implementation plan

Full owner contract: PROJECT-BRIEF.md. Work continues through these phases; a phase is not product completion.

- [x] P0: Read contract, inspect clean repository/resources, preserve harness and scope.
- [x] P0: Create complementary child tasks, preserve initial failures and require real returned code/review/test results. Delegation recovered and results are recorded in docs/AGENTS.md.
- [x] P1: Crypto identity/vault, encrypted content store, real local node API and polished connected UI. Unit and smoke gates; milestone commit/push.
- [x] P2: TCP and serial PTY transports, bounded routing/retry/priority, real 3-process heterogeneous tests, partition/heal, seed takeover.
- [ ] P3: Messaging, groups/attachments, social relationships/posts/comments/reactions/collections, safe profile builder. API/e2e negative controls.
- [ ] P4: Deterministic adverse-link simulation + mutation controls, persistence/abuse/security/reliability review.
- [ ] P5: Responsive light/dark/reduced-motion UI, keyboard/touch and accessibility tests, real screenshots, independent review if harness available.
- [ ] P6: Platform builds/CI/packaging; record exact physical radio, mobile background and Apple hardware/signing blockers. No cross-compile-to-device claim.
- [ ] P7: Contract-by-contract audit, docs/STATUS and README, fixes/reruns, clean coherent pushes.

## Active integration checkpoint — 2026-09-12

Sequential recovery at bff00cc: access policy, durable ledger and authenticated group-management APIs are implemented locally in both engines. Directed mixed HTTP/restart/consent/reentry/rejection controls passed4 cases5.684s; the complete source-frozen host/interop/UI/desktop gate passed; exact results are in `docs/evidence/group-runtime/final`. No new/resumed agents. The next implementation is admission/outbox/retention, then control-carrier synchronization, dynamic-message UI and their full network/device gates. No platform or dynamic-message completion claim. See `RESUME.md` and `docs/GROUP-RUNTIME.md` for current state. The earlier private-state migration and facade gates are complete; historical counts retain their version scope.

## Previous checkpoint — 2026-09-12

- Public main and origin remain at c3f5b42; its eight CI jobs passed, including three Node platforms, Go, desktop packages and actual Apple compilation. Later source is committed as outbox10bdf48, iOS runner4913ef4, Androidf3e747a and design-only groupse1d17d0; new CI results must still be observed after push.
- Node/Go outbox: encrypted durable intents, finite idempotency, per-recipient delivery/read facts, expiry and restart retry with relay-for-others disabled are implemented. Latest broad results: 79 Node tests, 36 Go application tests normal/race, 11 core + 11 transport race, two independent mixed-process outbox cases, 14 browser cases on each backend. Later modal-feedback correction passed four outbox cases on each backend. These are prior runs, not newly launched sequential checks.
- Desktop: Linux sandboxed dev and unpacked executable passed with reachable loopback positive/negative network controls. Latest small shared-UI changes still require packaging again before claiming that package contains them.
- Android: final APK `27a71947…` includes the elapsed-deadline checker and final shared UI. All 80 assertions passed once across SAF, deadline, message and relay gates; installed hashes matched before/after. Host policy/session assertions also passed. The AVD and isolated adb were stopped and retained. No physical-device, microphone or OS-notification claim follows.
- iOS: c3f5b42 built device/simulator frameworks and an unsigned simulator app on Xcode26.6; 25 Foundation host assertions passed. A real simulator runner/XCUITest was delivered and integrated into the local workflow, with 11 host-only runner checks. Its Apple execution has not happened. Device signing/hardware remain blocked on external capabilities.
- Dynamic groups: `docs/GROUP-EPOCHS.md` and declarative fixtures are a proposed contract, not implementation or executed cryptographic/network tests.

## Immediate execution sequence

1. Temporary sequential check completed: all active agents returned, no new/resumed tasks, exactly one selected browser case passed in 11.7 s without retries. See `SEQUENTIAL-CHECK.md` and its retained result/output/screenshots. No further gates or push/CI belong to this measurement. The result does not establish the cause of upstream 408s.
2. After the completed measurement, coherent outbox/mobile/runner commits and final Android package/gates are complete. Push normally and observe actual Apple simulator execution; rebuild desktop for the final UI. Preserve each earlier version's evidence boundaries.
3. Implement authenticated group membership epochs with explicit future-only semantics, signed cross-runtime vectors and adversarial real network/UI gates; no promise to revoke delivered keys or erase peer copies.
4. Complete remaining mobile document/export and actual generic notifications; reuse the same Android AVD. Add ARM64 builds without downloading another image. Attempt iOS compilation/execution only through genuine Apple runners/tooling.
5. Extend profile/social templates and moderation controls, review key recovery/rotation, and continue full contract audit. Keep unsupported physical radios, Apple signing and hardware tests explicit.

`docs/REMAINING-SCOPE.md` maps concrete gaps from source. This sequence advances the complete contract; it does not redefine completion as the current baseline. Each agent keeps explicit ownership and must return actual results.


A facade transaccional Node/Go foi implementada e verificada:81 Node/36.565s,36 Go de topo com race/169.094s (quatro helpers executados pelos drivers),9 interoperabilidade/45.760s; build8.157s e CLI0.901s. Fontes registadas inalteradas durante o gate. Evidência em `docs/evidence/group-transaction`. A aplicação ainda não usa esta facade para grupos dinâmicos.
