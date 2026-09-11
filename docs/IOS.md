# iOS application shell

The iOS source is a UIKit application containing the actual `native/mobile` Go core and bundled RelayLoom web assets. `MobileStart` starts crypto, storage, peer TCP transport and authenticated HTTP inside the application process. WKWebView renders that local interface. It does not connect to a daemon running on the build machine or depend on a PWA installation.

At the initial handoff, source/project checks passed on Linux, but **Swift, the XCFramework and the iOS application had not been compiled or executed**. No Xcode/Apple SDK exists on this host. Subsequent macOS CI results must be recorded separately; a successful simulator build is not simulator execution, physical-device testing, signing or distribution readiness.

## Build on a real macOS runner

Prerequisites:

- macOS with a selected Xcode installation and its iPhoneOS/iPhoneSimulator SDKs. The application minimum is iOS 15, because its WebKit media-permission/lifecycle APIs require that version.
- Node satisfying the repository engine requirement and the existing locked npm dependencies.
- **Go 1.26.8** on PATH for the host architecture; the script rejects other versions rather than silently changing the toolchain.
- At least 17 GiB free before each major build phase, preserving the project's 15 GiB minimum reserve. Only one iOS native build should run at a time. Go package compilation is capped with `-p=2`; Xcode uses `-jobs 2`.

From the repository root:

```sh
npm ci
npm run build
node scripts/ios-build.mjs --policy-test
node scripts/ios-build.mjs --simulator
```

The final command installs pinned `gomobile`/`gobind` into `.cache/ios/go/bin` if those exact tools are absent, then builds the existing Go module with:

```text
gomobile bind -target=ios/arm64,iossimulator/<host Go architecture> -iosversion=15.0 -o .cache/ios/artifacts/Mobile.xcframework ./mobile
```

`<host Go architecture>` is `arm64` on Apple Silicon or `amd64` on Intel. Both the device and host-matching simulator slices are native builds; no other simulator architecture is downloaded or inferred. The pinned x/mobile revision is `v0.0.0-20260908204917-8b95e45f8d3e`, matching the native module/tooling phase.

The script copies the actual `dist/web` into a project-owned staging folder and runs the shared Xcode scheme:

```text
xcodebuild -project apps/ios/RelayLoom.xcodeproj -scheme RelayLoom -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath .cache/ios/DerivedData -jobs 2 CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= ARCHS=<host simulator architecture> build
```

This produces `.cache/ios/artifacts/RelayLoom-simulator.app`. It does not boot a simulator, install the app, grant permissions or exercise the UI. The build script records exact Xcode/Go versions, target slices, binary hashes and scope in `.cache/ios/binding-report.json` and `.cache/ios/simulator-build-report.json`.

Useful narrower invocations:

```sh
# Host Swift/Foundation policy tests only; no Go/iOS app build.
node scripts/ios-build.mjs --policy-test

# Build the real device + simulator XCFramework only.
node scripts/ios-build.mjs --bind-only

# Reuse an already generated XCFramework, then build the simulator app.
node scripts/ios-build.mjs --simulator --skip-bind

# Unsigned iPhoneOS compilation, not an installable/signed device release.
node scripts/ios-build.mjs --device-unsigned --skip-bind
```

No script signs an application, selects a developer team, installs a provisioning profile, opens an account or uses `-allowProvisioningUpdates`. Real-device installation and distribution require suitable owner-provided signing and Apple tooling; those are separate gates. The project contains no automatic updater or App Store submission flow.

## Binding and lifecycle

The framework is named `Mobile.xcframework`, with the generated umbrella header `<Mobile/Mobile.h>`. The pinned gomobile generator maps the Go package's exports to `MobileStart`, `MobileStop` and `MobileVersion`. `NativeBridge.m` wraps their C/NSError signatures into a small Objective-C interface consumed through the Swift bridging header. The build verifies those symbols exist in generated headers. It does not assume Electron APIs or embed a Node runtime.

`RuntimeCoordinator` is process-scoped and serial. Every start obtains a lease; late callbacks and old stops cannot replace or stop another lease's runtime. The app starts when it becomes active. Entering the background invalidates the capability, denies pending microphone permission, removes the WebView and stops the core. A standard bounded `beginBackgroundTask` interval is used only to finish cleanup; there are no `UIBackgroundModes` declarations and no claim of continuous iOS background relaying.

Persistent data lives in the application's Application Support directory under `RelayLoom/core`, with complete file protection and backup exclusion. Web assets remain separately bundled and read-only. The existing core encrypts its identity vault and private metadata; this shell does not yet integrate an iOS Keychain-backed key-unlock flow.

## Renderer and permission boundary

- Each foreground launch uses a nonpersistent WKWebView data store and the capability token supplied only by its own in-process core. Tokens remain in the app URL fragment/session and are not printed to logs.
- Bootstrap requires exact `http://127.0.0.1:<port>`, a canonical 64-hex-character token, and a valid peer TCP port. No `localhost`, host-machine alias, remote origin, userinfo or arbitrary bootstrap path is accepted.
- Top-level navigation and navigation responses must remain on the exact local root app page. Subframes, downloads, popups, external links and HTTP authentication challenges are cancelled. There is no generic JavaScript-to-native message bridge.
- WebKit content rules block other resource origins and allow local HTTP resources plus local blob/data image/media. The Go HTTP server's CSP and token/Host/Origin checks apply as a second layer. Failure to compile content rules prevents the UI from opening.
- ATS declares local networking and an exact `127.0.0.1` cleartext exception for current iOS IP-address rules. It does not enable arbitrary loads. See [Apple's local networking key documentation](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking).
- Microphone permission requires the current main frame, current runtime lease, exact security origin, audio-only capture, active user gesture and a native confirmation. The camera is denied. iOS's microphone authorization still applies; there is no camera usage declaration or permission bypass.
- Web inspection is disabled on supported iOS versions. The app uses UIKit accessibility/dynamic type for startup/error UI; full VoiceOver/real-device testing remains pending.

## Capability and verification status

| Area | Source implementation | Evidence at initial handoff |
| --- | --- | --- |
| On-device Go runtime | Actual Start/Stop/Version binding and local server | Go facade already compiles/tests on the Linux host; Apple binding still requires macOS CI. |
| Native application | UIKit entry point, hand-authored Xcode project/shared scheme, real bundled assets | Project/plist/source consistency check passed locally; no local Xcode compilation. |
| Origin/capability/lifecycle | Foundation policies and serial owner leases | Swift policy tests are provided for the macOS runner; local Linux static checks do not execute Swift. |
| Simulator app | Reproducible unsigned build command and artifact report | Not built/run by this Linux subtask; CI output must establish build status. |
| Physical iPhone/iPad | Code and permission descriptions prepared | Not installed or tested; signing, hardware radios and actual background behavior remain unverified. |
| Voice capture | Narrow WKWebView microphone permission flow | No physical microphone or OS permission dialog tested here. |
| Attachments/export | Core API supports attachment bytes; WebKit renderer can display media | Native file-picker/export/download workflows are not completed or validated; downloads are deliberately denied by this shell. |
| Notifications | Existing renderer may report browser notification API unavailable | No iOS notification/APNs integration or background delivery implementation is claimed. |
| BLE/Wi-Fi Direct/USB/LoRa | No new iOS adapter in this task | Unsupported/unverified. TCP and the protocol core do not imply radio support. |

Executed by this subtask on Linux:

```text
node --check scripts/ios-build.mjs
python3 scripts/ios-static-check.py
```

Both passed. The latter checked 43 Xcode project object references, file membership, plist ATS/background declarations and explicit source boundaries. Its output states `swiftCompiled:false`, `iosBuilt:false`, `simulatorExecuted:false`, `deviceExecuted:false`. It is a packaging consistency check, not a substitute for compilation or device gates.

The host Swift policy executable exercises exact-origin/bootstrap validation and stale runtime ownership with a fake backend. Even when that executable passes on macOS, it must remain labelled **host Swift/Foundation**, not WKWebView/iOS execution. Run the actual app on a simulator and then suitable hardware before claiming those platforms are working.

## Independent source review

`/root/transport_hardening` independently read the iOS origin policy, runtime lease coordinator, WebView permissions, C bridge and Xcode paths. It identified a stale microphone callback consuming a replacement request's completion. The implementation now binds each completion to a UUID and a locked `OnceCompletion` object; old callbacks cannot consume a new request or complete an old one twice. The reviewer reread and confirmed that correction in source. Corresponding host Swift test source was added, but was not executed on this Linux host.

The reviewer found no further concrete defect in that bounded static pass and explicitly left Apple compilation, WebKit rule enforcement and native export/download interaction unverified. This review does not turn those pending runtime gates into passed evidence. Unsupported download actions show a native explanation when WebKit reports a download request; no file is silently saved.
