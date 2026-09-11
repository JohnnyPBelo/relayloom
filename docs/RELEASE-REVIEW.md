# Pre-commit release review — 2026-09-11

This is a bounded review of the current candidate source tree against `PROJECT-BRIEF.md`. Desktop and CI were reviewed independently of their implementation. The reviewer authored the initial iOS shell, so the iOS portion is explicitly **self-review**, not an independent Apple security gate.

## Finding

**R-1 — P2: desktop external-request smoke can pass because its target does not resolve.** At the reviewed revision, `apps/desktop/main.ts:382–386` fetches `https://relayloom.invalid/desktop-control` and treats any rejection as evidence that the application blocks external requests. The reserved `.invalid` domain fails independently of CSP/request filtering, so removing those restrictions can leave this smoke green. The implementation's actual exact-origin filters remain present; the defect is a false-positive verification control.

Required correction: create a separate, harmless loopback fixture with an ephemeral challenge, demonstrate successful access from the main process and an isolated control renderer without the app's CSP/filter, then require the actual protected renderer to reject it without reaching the fixture. Keep sandbox, context isolation and web security enabled in both renderers. Record request counters without publishing the challenge/token. Root accepted this finding and assigned the reviewer a subsequent correction in desktop smoke source; execution/result will be appended after that work.

No further concrete compilation blocker or capability/lifecycle escape was found in this static pass. That is not a claim that new Windows/macOS/iOS jobs have executed successfully.

## Checked source and runner boundaries

- Read `apps/desktop/main.ts`, `policy.ts`, `daemon.ts`, `electron-builder.cjs`, all four desktop build/run/package/smoke scripts, `apps/ios/**`, both iOS scripts, and `.github/workflows/ci.yml`.
- Workflow npm command names resolve to `package.json`; four jobs have bounded timeouts and the workflow token has `contents: read`. The native Go/UI job precedes desktop/iOS jobs. Electron is explicitly installed after the otherwise disabled npm lifecycle scripts in the packaging job.
- iOS binding uses the pinned x/mobile revision and Go 1.26.8, generates actual native device/simulator slices, includes bundled web assets and invokes unsigned `xcodebuild`. Apple tools are required on macOS. The job currently builds an app; it does not execute a simulator or prove signing/device behavior.
- Desktop uses its owned utility process for the capability, an ephemeral browser session, exact loopback-origin filtering, sandbox/context isolation, no renderer Node/preload interface, narrow permission handlers and packaged security fuses. Windows/macOS jobs only package; the new workflow executes desktop smoke on Linux.
- iOS uses a process-scoped runtime lease, current-origin/current-lease microphone checks and exactly-once permission completion. Data and bundled assets remain separate, protected/private data stays inside the app container, background cleanup is bounded and there is no claim of continuous iOS background relaying.
- Shell download/media/clipboard/native-dialog support is not established by policy-unit tests. iOS export/download and notification workflows remain explicitly incomplete. The shell must not be described as satisfying the entire mobile acceptance contract.

## Executed checks during this review

| Check | Actual result |
| --- | --- |
| `node --check` on `ios-build.mjs`, `desktop-build.mjs`, `desktop-package.mjs`, `desktop-run.mjs`, `desktop-packaged-smoke.mjs` | All passed JavaScript syntax checks. |
| `python3 scripts/ios-static-check.py` | Passed; 43 Xcode project object references plus file/plist/source consistency. Output explicitly says Swift/iOS/simulator/device execution is false. |
| `node --import tsx --test tests/desktop-policy.test.ts` | **5/5 passed**, no skips. Pure policy tests; Electron was not launched by this check. |
| Workflow parsed using the installed `js-yaml`; checked job timeouts/npm script references | Passed for `native-node`, `native-go`, `desktop-package`, `ios-simulator-build`. This is syntax/reference validation, not GitHub job execution. |
| `git diff --check` | Passed for the tracked diff. |
| Candidate-file publication scan | Enumerated **182** tracked/untracked nonignored candidate files. No files larger than 5 MiB, private-runtime filenames, signing/provisioning/key-store files, packaged binaries, PEM private-key blocks, provider-token patterns, concrete private signing/decryption JSON values, or concrete 64-hex launch-token JSON values were found. |

The scan operated only on repository candidates and returned locations/categories, never secret values. It also confirmed `.cache`, `.runtime`, `dist` and `node_modules` had no tracked entries. This is a targeted publication check, not an exhaustive secret detector or proof about future staging changes; rerun a staged-file check before the actual commit if the candidate set changes.

No Xcode/Swift compilation, new Electron build/runtime, heavyweight Go build, Android work, credential discovery, signing operation or bridge/provider/security-setting change was performed during this audit phase. Android retained the build slot. The accepted desktop smoke correction is a separate subsequent phase with its own evidence below.

## R-1 correction and executed desktop evidence

R-1 is corrected in `apps/desktop/main.ts` and the new `apps/desktop/smoke-controls.ts`. The reviewer authored this correction after independently finding the original defect; the correction itself is not an independent implementation review.

The smoke starts a separate ephemeral `127.0.0.1` HTTP fixture with an unpredictable response challenge and phase-specific counters. The main process must retrieve the challenge, then a fresh hidden control renderer without the app CSP/request filter must retrieve it. The real protected renderer must reject the same fixture's probe without producing a server request. The fixture permits cross-origin reads and disables caching. Timeouts, unexpected responses and any protected probe reaching the server fail the test. The challenge stays in memory and is omitted from the report. The helper destroys its control window and closes the fixture/connections in `finally`; both renderers retain sandbox, context isolation and web security.

The reviewer then executed these checks sequentially where a build was involved:

| Check | Actual result |
| --- | --- |
| `npm run typecheck` | Passed TypeScript compilation checks across the current tree. |
| Prettier check of `apps/desktop/main.ts` and `apps/desktop/smoke-controls.ts` | Passed. |
| `npm run desktop:build` | Passed; staged the desktop app and existing local daemon. |
| `npm run desktop:smoke` | **Passed**, actual Linux x64 Electron 44.3.0 / Chromium 152.0.7977.78 execution, `2026-09-11T22:41:38.010Z`. Main-process and control-renderer probes each reached the fixture **once**; protected-renderer probe was rejected with **zero** server requests. |
| Smoke API/process checks | Unauthorized API **401**, authorized API **200**, renderer Node access absent, separate daemon process and clean daemon shutdown confirmed. |
| `git diff --check` after the source correction | Passed. |

Local run artifacts are `.cache/desktop/smoke.json` and `.cache/desktop/smoke.png`; the JSON contains booleans and request counts, not the ephemeral challenge or launch token. Sandbox was requested and no bypass was used; Electron's runtime `sandboxed` metric was **unavailable** on this host, so this run does not claim a reported sandbox attestation. The run emitted non-fatal EGL refresh-rate diagnostics. No Windows/macOS/iOS execution or physical radio/media capability is implied by this Linux smoke.
