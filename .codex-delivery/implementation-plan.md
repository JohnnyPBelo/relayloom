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

## Current checkpoint — 2026-09-11

- Node application: media/voice, collections, notifications opt-in, paginated verified summaries, lazy attachments and stale-response privacy guard are implemented. Latest full gate:66 tests,10 browser cases and deterministic simulation pass. A later drag/drop regression and all10 browser cases against the Go runtime also passed.
- Native Go:11 core +11 transport +17 application tests passed with race detection;3 vector/mixed-process tests passed after rebuilding the CLI. The real TCP and serial segments remain explicitly distinguished.
- Desktop: Linux Electron and unpacked executable run with sandbox. A weak external-request smoke control is being replaced with a reachable loopback positive/negative fixture, then rebuilt/retested before committing.
- Android: final native APK `e1bdb088…d2a0` passed16 simple and11 multi-hop/seed/lifecycle assertions in the single API36 x86_64 emulator. No physical-device, microphone or OS-notification claim follows.
- iOS: shell/project and build scripts implemented; local syntax/project checks only. New macOS workflow has not run yet. Device signing/hardware remain blocked on external capabilities.

## Immediate execution sequence

1. Commit coherent verified Node/desktop, Go core/transport, Go application and mobile-host milestones; push normally and observe actual new CI jobs.
2. Add durable per-publication/per-recipient outbox and delivery/expiry UI, including broadcast failure, pinned retention, restart, short TTL, forged receipt and multi-member controls.
3. Add authenticated group membership epochs with explicit future-only semantics; no promise to revoke already delivered keys or erase peer copies.
4. Complete mobile document picker/export and actual generic notifications; reuse the same Android AVD. Add ARM64 builds without downloading another image. Attempt iOS compilation/execution only through genuine Apple runners/tooling.
5. Extend profile/social templates and moderation controls, review key recovery/rotation, and continue full contract audit. Keep unsupported physical radios, Apple signing and hardware tests explicit.

`docs/REMAINING-SCOPE.md` maps concrete gaps from source. This sequence advances the complete contract; it does not redefine completion as the current baseline. Each agent keeps explicit ownership and must return actual results.
