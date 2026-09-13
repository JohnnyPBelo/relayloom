# Real iOS simulator execution gate

This gate extends the unsigned iOS build evidence from `c3f5b42` with executable
XCUITest source. **It has not been compiled or executed by Xcode on this Linux
host.** The next Apple CI run must produce the actual result before simulator
support is claimed. The older successful `ios-simulator-build` job remains
build-only evidence; its 25 Foundation assertions used a fake lifecycle backend.

## What the gate runs

`RelayLoomSimulator` is a separate shared Xcode scheme with the new
`RelayLoomUITests` UI-test target. The original `RelayLoom` build scheme remains
unchanged. The test launches the production application, production WKWebView
and embedded Go XCFramework. It uses accessibility gestures and text entry only:

1. Start WKWebView and create a synthetic identity through the onboarding form.
2. Publish a post through the real web interface and observe it in the feed.
3. Add the public card of an isolated, real Node peer; enter its loopback TCP
   port through the iOS connection form.
4. Send a private message. By default, also select a generated synthetic photo
   through the system photo picker and send it as an attachment.
5. The Node peer verifies and decrypts the actual received message/attachment,
   sends a private reply, and observes the iOS reader's signed read receipt.
   The iOS test requires that reply to be visible in the conversation.
6. Move the app to the background, resume it, require unlock and recover the
   conversation. Terminate and relaunch the process, unlock again, and recover
   both conversation and post.
7. After the UI test, stop the app and read only its private container in the
   simulator created by this run. Authenticate the encrypted vault and private
   journal, verify signed bundles, decrypt the synthetic messages, check exact
   reader sets and compare attachment bytes with those observed by the Node peer.

The peer is the production Node application engine in a separate owned child
process. Its control capability travels over the parent's private IPC channel
and is used only in supervisor memory. It is never written to `runtime.json`,
passed to XCTest, or exposed to the iOS application. Test resources contain only
a public recipient card, transport port, synthetic content and a public test
passphrase. There are no owner contacts, owner accounts or owner recovery data.

No app API hook or JavaScript injection is added. The production iOS host is
unchanged, its WebView stays non-inspectable, the existing capability checks stay
active, and no additional unauthenticated control port is introduced. The host
does not change privacy permissions, developer/security settings, signing
accounts or provisioning profiles. App-process locale arguments stabilize Apple
picker labels without changing simulator-wide preferences.

## Exact Apple runner commands

Use the existing patched Go/Xcode prerequisites and install project dependencies
as in the current Apple CI job. Build the current Go framework after every native
engine change; do not reuse a stale binding with `--skip-bind`.

```sh
npm ci --ignore-scripts
npm run build
node scripts/ios-build.mjs --policy-test
node scripts/ios-build.mjs --simulator
node scripts/ios-simulator.mjs
```

The final command requires macOS and uses `xcrun simctl list runtimes --json` plus
`list devicetypes --json` to select a compatible **already-installed** iOS runtime
and iPhone type. It does not download an OS, install Xcode components or require
an Apple account. It creates one uniquely named simulator, records the returned
UDID, boots that simulator, builds for testing with two jobs and runs exactly
`RelayLoomUITests/NativeSimulatorTests/testNativeCoreUIAndRecovery` with simulator
parallelism disabled. Both app and test build use `CODE_SIGNING_ALLOWED=NO`,
`CODE_SIGNING_REQUIRED=NO` and an empty signing identity.

The exact build/test invocations are assembled as structured argument arrays in
`scripts/ios-simulator.mjs`; the test command is:

```sh
xcodebuild -project apps/ios/RelayLoom.xcodeproj -scheme RelayLoomSimulator \
  -configuration Debug -sdk iphonesimulator -destination id=<created-UDID> \
  -destination-timeout 90 -derivedDataPath .cache/ios/DerivedData -jobs 2 \
  -disableAutomaticPackageResolution CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= ARCHS=<host-simulator-arch> \
  -resultBundlePath <owned-raw-result> -parallel-testing-enabled NO \
  -maximum-concurrent-test-simulator-destinations 1 \
  -maximum-parallel-testing-workers 1 -test-timeouts-enabled YES \
  -default-test-execution-time-allowance 360 \
  -maximum-test-execution-time-allowance 420 \
  -only-testing:RelayLoomUITests/NativeSimulatorTests/testNativeCoreUIAndRecovery \
  test-without-building
```

The photo flow is enabled by default. `--without-photo` is an explicit narrower
gate for diagnosing a system-picker incompatibility. It still requires real
Node/iOS message exchange, lifecycle recovery and encrypted-container checks;
its report marks the photo path as **not requested**, never as passed.

## CI fragment for root integration

The root task integrated the following fragment locally in `.github/workflows/ci.yml`,
after the current-framework/unsigned-app build, within the same Apple job. This
workflow change has not yet been pushed or executed; it is not simulator evidence:

```yaml
- name: Execute native iOS UI and real Node peer on one installed simulator
  run: node scripts/ios-simulator.mjs
- name: Clean only the simulator recorded by this gate
  if: always()
  run: node scripts/ios-simulator.mjs --cleanup-owned
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: ios-simulator-execution-evidence
    path: .cache/ios/simulator/evidence
    if-no-files-found: warn
    retention-days: 7
```

Allow sufficient job time for the existing Go binding build plus this gate. The
supervisor itself has a 20-minute deadline, build/testing command deadlines and
the 420-second maximum UI-test allowance. It requires 17 GiB free at entry and
checks the 15 GiB reserve while owned commands run. A reserve or timeout failure
terminates the owned command group and enters cleanup.

The first execution on f93e741 reached the initial OS data migration but did not
finish boot within180seconds; no application test ran. The same-device cold-boot
allowance is now600seconds, inside the existing global deadline and disk guard.
The original logs, exact cleanup and pending CI recovery are documented in
`CI-F93E741-FOLLOWUP.md`; no OS services or permissions were changed.

Cleanup shuts down/deletes only the recorded UDID after confirming the exact
unique name. It never runs `shutdown all`, deletes an installed runtime, changes
another device or kills a shared simulator service. The `--cleanup-owned` CI
fallback handles an interrupted parent after it has exited, and refuses to act
while the recorded supervisor PID is still running. A stale/ambiguous ownership
record fails closed instead of adopting another simulator.

Cleanup attempts use a separate exclusive cleanup lock and their own evidence
namespace. Startup checks that lock before and after acquiring its runner lock;
cleanup also refuses an active runner lock, including before a UDID has been
recorded. Cleanup never removes a replacement run's metadata. An unresolved
cleanup lock fails closed rather than being silently stolen.

## Evidence and boundaries

Each run produces `.cache/ios/simulator/evidence/<run-UUID>/` with:

- Sanitized bounded tool logs, the selected installed runtime, command outcomes,
  exact app/web/source/binding-report hashes and the actual XCTest result counts.
- A whitelist-only UI checkpoint report exported from the real test result and
  at least four screenshots from the fresh synthetic simulator.
- Vault/journal ciphertext hashes, signed bundle hashes, authenticated recovery
  checks, real-peer receipt evidence and exact iOS/Node attachment-byte agreement.
- `artifact-hashes.json` covering the retained evidence files, plus owned-device
  cleanup outcomes and remaining disk space.

Control tokens and authorization headers are removed from retained tool logs;
standalone 64-character hex strings in logs are also redacted. Reports separately
generate hashes from known artifacts. Logs are capped at 2 MiB per command and
8 MiB per run; screenshot export is capped at 12 images/24 MiB. Raw `.xcresult`
diagnostics, synthetic peer state and generated test resources are not uploaded
and are removed after extraction. Only the sanitized evidence directory belongs
in CI artifacts.

`simulatorBooted` and `testCommandStarted` are distinct from execution evidence.
`simulatorExecuted` becomes true only after observing the UI identity-created
checkpoint or the validated one-test passing XCTest result. A zero-test or skipped
test result cannot pass. A successful test lacking its required exported
screenshots/checkpoint report also fails the evidence gate.

This does not establish physical iPhone/iPad behavior, radio interoperability,
continuous background relay, microphone/camera permissions, file export,
distribution signing or power-loss durability. The system photo picker may
transcode the fixture image; the gate compares the actual selected bytes stored
by iOS against the bytes received by Node, rather than assuming the imported PNG
must retain its original encoding.

## Local validation

The following checks ran on Linux and passed:

```sh
node --check scripts/ios-simulator.mjs
node --check apps/ios/Tests/SimulatorPeer.mjs
node scripts/ios-simulator.mjs --check
python3 scripts/ios-static-check.py
node --test apps/ios/Tests/SimulatorRunnerTests.mjs
```

The source checks validate all 58 Xcode project references and preserve the
existing host isolation declarations. The eleven host-only runner/fixture tests
check installed-runtime selection, log redaction, owned-container restrictions,
strict XCTest result admission, active-owner preservation, process-group
escalation after leader exit and rejection of corrupted/mismatched synthetic
crypto evidence. They do not compile Swift or execute a simulator. Apple
compilation/execution remains pending the next CI push.

An independent source review by `/root/security_review` found and confirmed
corrections for cleanup sharing an active run's artifact namespace and cancelled
TERM-to-KILL escalation after a command leader exited. The runner now keeps a
separate cleanup namespace/lock and awaits the owned process group's termination.
It also accepts the modern XCTest summary `result` field and the `status` variant
only when they do not conflict; zero/skipped/failed test results remain failures.
The reviewer independently repeated syntax/source checks, with no Apple execution
claim. Later exclusive cleanup-lock and pipe-drain refinements passed the same
host-only checks; Apple SDK compatibility and UI selectors await the real CI run.


## Bounded installed-runtime compatibility probe after90cb649

The actual90cb649 inventory contained available iOS26.4.1 and26.5.26.5 repeatedly blocked at synthetic-photo import before XCTest. The next CI explicitly requests `node scripts/ios-simulator.mjs --runtime=26.4.1` once as a compatibility probe. This preserves photo selection, the full XCTest, original tool/global deadlines and created-device cleanup. Missing requested runtime fails; there is no fallback, runtime download, service restart or permission change. The default local invocation still selects the newest compatible installed runtime.

17 host runner tests passed in2.158s, including exact selection, missing/unavailable-version refusal and ambiguous/malformed arguments. Static references passed. These checks do not execute Apple code or establish the cause of the26.5 timeout. Evidence: `evidence/ios/runtime-26-4-1-host`; actual CI execution remains to be observed by commit.26.5 stays explicitly blocked even if another version later passes.


## Observed e72af64 result and prerequisite diagnostics

Run34693678391 used installed26.4.1 and booted in326.346s. The required host Node peer then missed its20s startup deadline; the photo importer and XCTest were not reached. This does not evaluate photo import on26.4.1. The runner had collected stderr in memory but discarded it on failure.

The corrective runner now starts/verifies its required real Node peer before creating/booting a simulator, preserves bounded redacted stderr and explicit secret-free startup phases, and retains the20s deadline.19 host cases passed2.449s, including an actual peer process/private IPC and unauthenticated401/authenticated200 controls, plus diagnostic redaction/error preservation. Static checks passed. These changes are still awaiting a new Apple CI run; no simulator app or physical device execution follows from the host tests. Evidence in `evidence/ios/e72af64`.


## Pré-condição de arranque separada — após fde529e

O CI34728934069 compilou/arrancou/instalou, mas addmedia voltou a exceder o prazo em60.836s antes do XCUITest. O run274004e, preservado separadamente, importou a fotografia e chegou à falha WKWebView. A causa da importação intermitente ainda não está demonstrada.

O runner passa a executar `NativeSimulatorTests/testStartupBeforeMedia` antes da fotografia: exige a WebView e o formulário de identidade pela acessibilidade real e guarda uma captura nativa antes do teardown em caso de falha. O resultado de arranque e até2 PNG são separados do resultado funcional. A fotografia e `testNativeCoreUIAndRecovery` continuam obrigatórios na CI; os4 screenshots e o relatório de checkpoints exigidos por esse percurso não são substituídos pelas capturas de arranque.

Os prazos de45s da WebView,360/420s por teste e o deadline global mantêm-se. Não altera permissões, bridge, isolamento, debugging ou serviços.22 testes host e verificação estática passaram; esta alteração ainda não foi compilada/executada em Apple. Evidência em `evidence/ios/startup-before-photo-host`; falha anterior em `evidence/ios/fde529e`.
