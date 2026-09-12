# Authoritative resumption checkpoint — 2026-09-12

Only project: `/home/absint0o/projects/relayloom`. Full acceptance contract: `PROJECT-BRIEF.md`. The RelayLoom goal remains active and incomplete. Respond in PT-PT. Preserve Astra/Copilot Ultra, providers/authentication/bridge/safety; no unrelated files, services or projects. Maintain at least 15 GiB free, project caches and one heavy build at a time; no purchases/root, force-push or PR merge. Ordinary coherent verified commits/pushes are authorized.

## Newer integrated milestone checkpoint

The continuation after the completed measurement performed the final Android integration sequentially without new/resumed agents. APK `27a71947f73e3a2622da6efbcb402d04260e53293cb6156e27f43ea3b3f8e5a2` contains the final checker and UI and passed 38 SAF + 15 deadline + 16 message + 11 relay/seed assertions once. Installed hashes matched before/after; inputs stayed unchanged. The AVD/isolated adb were stopped and test instrumentation removed; identity retained, 127.54 GiB free. See `ANDROID-FINAL-INTEGRATION.md` and `docs/evidence/android/documents-27a71947`. The old handoff below is historical and its pending checker gate is now closed.

Feature commits: outbox `10bdf48`, iOS runner `4913ef4`, Android `f3e747a`, design-only groups `e1d17d0`. Next action: normal push and observe the new CI/Apple simulator execution, then continue full-contract implementation. No new agent is needed or authorized by the temporary restriction. The exact future CI run must be inspected; do not reuse the old green result.

## Latest owner instruction and completed measurement

The owner temporarily prohibited creating/resuming agents, required active agents to finish undisturbed, and requested exactly one bounded sequential test. That step is now **complete**. Do not repeat the test or launch more tests/builds/agents as part of the same measurement. No settings were changed and no push/CI was started. No new upstream Copilot 408 was observed; this does not prove why earlier timeouts occurred.

Exact command:

```sh
node scripts/e2e.mjs tests/e2e/outbox.spec.ts --grep 'durable composer retries a lost response once' --reporter=line --output=.cache/sequential-stability/outbox
```

Result: **1 passed (11.7s)**, one test, one worker, one attempt, zero retries, exit 0; 12.108 s supervised wall time. Sources/assets unchanged. Four Axe captures reported zero violations. See `SEQUENTIAL-CHECK.md` and `docs/evidence/sequential-stability/2026-09-12/{result.json,output.txt}`. Local `.cache/sequential-stability/attempt.json` is completed; never relaunch an uncertain run blindly. Last free space: 128.63 GiB.

## Repository and implemented local work

At the start of the completed measurement, HEAD/origin main were `c3f5b42ff80923981befecec1f82e3ff017bd6a3`. Its GitHub run 34655608855 passed all eight jobs: Node Linux/Windows/macOS, Go, three desktop packages and iOS build. See `docs/evidence/ci-c3f5b42.json`. The later feature work is now committed as listed above; normal publication/CI observation follows this integration checkpoint. Do not reset/clean ongoing work.

Node/Go outbox has encrypted preparing/ready recovery, finite operation idempotency, pending quota/pins, automatic own retry separate from relay-for-others, delivery versus read per recipient, historical authenticated confirmations and safe state after uncertain writes. Bounds: 128 pending/32 MiB reserve/256 total retained records. UI requires fresh unlocked state and explicit new-send choice if an uncertain operation disappeared. POSIX file/directory synchronization is not physical power-loss testing or a Windows directory-flush guarantee.

Main files: `apps/node/src/outbox.ts`, `node.ts`, `local-state.ts`, `server.ts`; `native/app/outbox.go`, `confirmations.go`, other application files; `packages/core/src/index.ts`, `native/core/store.go`; `apps/web/src/outbox.tsx`, `outbox.css`, `main.tsx`, `style.css`. Group creator blocking retains only the verified ACL dependency; signed-roster receipt resolution and contact learning fixed the supervised Go failure without weakening authorization. Retry feedback is now inside the dialog; legacy group read counts use unique original recipients; focus ring is inset.

Prior gates, not new runs in the sequential stage: 79 Node tests; 36 Go application normal and race; 11 core + 11 transport race; two independent three-process mixed outbox scenarios; 14 browser cases Node and 14 Go; later modal change passed four outbox browser cases per backend. Production source hash: `66a18d61cc0a63b0bf30195462c2515912b333614d95dd69f1d503db409f830e`. CLI hash: `4e18b8b15d0da0883586a4d3e51e1ecbec351afd1ce1545bcb773d8f8aca422d`. Latest web assets: `index-Ct0M5tYK.js` and `index-BcajBo5I.css`.

## Actual agent handoffs — all returned

- `design_review`: SAF picker/export implemented. APK `4de67c3e1540556bbbcab98e7053112bfce2625cdf994c4de67c2d15403b77bb` passed 38 SAF + 15 deadline/lifecycle + 16 message/recovery + 11 relay/seed assertions in the one API36 x86_64 emulator. AAR `7c9f60fe036b85d08bc584f3c469ee31e3537a3f22de9d7fdfd514ef820503b5`. Later immutable elapsed-deadline checker has 28 local policy/session assertions and independent source review, but **no new APK or device gates**. It needs packaging with final web assets and exact-hash reruns. Agent stopped its AVD/isolated adb and preserved identity/data; exactly 16 synthetic fixture endpoints were removed with audit. See `docs/ANDROID.md` and `docs/evidence/android/documents-4de67c3e/post-apk-source-handoff.json`. Retain the same `relayloom-api36` AVD, adb5047/emulator5580/5581; no second image.
- `security_review`: completed `docs/GROUP-EPOCHS.md` and `tests/fixtures/group-epochs.json`, 33 symbolic cases explicitly `DESIGN_ONLY_NOT_EXECUTED`. Creator-owned permanent anchor, chain/card binding, join consent, restrictive-transition quarantine, historical minimal events, explicit original-author republication, bounded registry and rollback/fork limits. **No production dynamic groups or executed epoch tests.** Its existing child also finished without new device tests.
- `transport_hardening`: previously returned native outbox plus `scripts/ios-simulator.mjs`, XCUITest target/scheme, `apps/ios/Tests/SimulatorPeer.mjs`, runner tests/fixtures and `docs/IOS-SIMULATOR.md`. Root integrated simulator execution/owned cleanup/sanitized upload into the local workflow. Eleven host-only runner tests passed before this measurement. c3f5b42 built device/simulator arm64 frameworks and unsigned app on Xcode26.6, plus 25 Foundation host assertions. **The iOS app has not yet been executed in a simulator.**

Actual tasks/results are recorded in `docs/AGENTS.md`. No active root test process remains; sequential session 96822 exited 0. Do not create/resume agents under the latest temporary restriction.

## Outstanding full-contract work after this checkpoint

1. Android final artifact gates and coherent feature commits are complete as recorded above. Rebuild desktop after latest UI before claiming that package contains it.
2. Push normal coherent milestones when continuing beyond the completed measurement and observe the new Apple simulator job; a workflow declaration is not execution evidence.
3. Implement/review/test dynamic group epochs in Node/Go/UI with actual signed vectors and positive/negative partition controls; the design alone closes no feature gate.
4. Native key storage/recovery/rotation, full-history search/context, richer profile templates/media/social controls, real native notifications and remaining accessibility/device gates.
5. Physical Android/Apple/radios, Apple signing and unsupported BLE/Wi-Fi Direct/LoRa remain blocked/unverified as appropriate. Never infer disaster readiness or all-OS execution from builds.

`implementation-plan.md`, `requirements-normalized.json`, `traceability.md`, README and STATUS have been refreshed with current evidence. Earlier checkpoint text is preserved in `history/RESUME-before-sequential-check-2026-09-12.md` as history, not current instructions.
