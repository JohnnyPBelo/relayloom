# Mobile runtime feasibility — 2026-09-11

This is a source and tool-availability review, not an Android/iOS build or device result. No SDK, emulator image, native runtime, or dependency was installed by this review; no adb server or device session was started. Public upstream documentation, release metadata, and SDK repository indexes were read. The proposed mobile runtime runs inside the mobile application; its UI must not depend on a daemon running on the developer's computer.

## Recommendation

Proceed with a maintained Go core embedded through `golang.org/x/mobile/gomobile`, first as an Android AAR and later an Apple XCFramework. Preserve the current signed/encrypted wire format and API through bidirectional compatibility tests. A native Android host can render the existing bundled web UI against an authenticated HTTP server running **inside that same app process**. This is a native application with an on-device relay, not a PWA or a WebView displaying a remote desktop daemon.

Embedding the existing Node implementation is technically possible through nodejs-mobile, but its released runtime is outdated. That limits the Node embedding option; it does not make mobile implementation impossible. The Go route requires a real port of core/protocol/API behavior and does not automatically inherit the Node implementation's test results or complete feature coverage.

## Observed local tools

Commands were located through the current process PATH. Only ordinary version queries were run; personal directories were not searched for additional SDKs.

| Item | Observed result |
| --- | --- |
| Host | Linux 7.0.0-27, x86_64, 32 logical CPUs |
| Free workspace filesystem | 140.32 GiB at the initial check; recheck before downloads/builds and retain at least 15 GiB free |
| Virtualization | `/dev/kvm` exists and is readable/writable by this process; actual emulator acceleration remains untested |
| Go | `/usr/bin/go`: `go1.26.0 linux/amd64` |
| Java | `/usr/bin/java`: OpenJDK runtime 25.0.4; `javac` was absent from PATH |
| Android platform tool | `/usr/bin/adb`: 1.0.41, package version 34.0.5-debian; version query only |
| Build utilities | CMake 4.2.3, Ninja 1.13.2 |
| Missing from PATH | Gradle, sdkmanager, avdmanager, emulator, ndk-build, clang/clang++, kotlinc, Flutter, xcodebuild, xcrun |
| SDK configuration | ANDROID_HOME, ANDROID_SDK_ROOT, ANDROID_NDK_HOME, JAVA_HOME unset in this task environment |
| Existing JS toolchain | Node 22.22.3, npm 10.9.8 |

These facts establish missing prerequisites in the current environment, not their impossibility to install within the project. Existing system adb must not be used to disrupt unrelated device sessions; a later test should use a project-owned AVD and an isolated adb server port.

## Runtime options and licences

| Option | Current upstream evidence | Fit and limits |
| --- | --- | --- |
| nodejs-mobile core | Latest published release observed: [18.20.4, 2024-10-07](https://github.com/nodejs-mobile/nodejs-mobile/releases/tag/v18.20.4). Android assets cover armeabi-v7a, arm64-v8a, x86_64; iOS covers arm64 device and arm64/x86_64 simulators. | Real libnode embedding, but below this repository's Node >=22.12 requirement. Release assets observed are library/header ZIPs, not an official ready-made AAR. A JNI host must be built or a framework plugin used. |
| Unscoped RN plugin | [npm nodejs-mobile-react-native 18.20.4](https://registry.npmjs.org/nodejs-mobile-react-native/latest), MIT; about 357.7 MiB unpacked. [Source](https://github.com/nodejs-mobile/nodejs-mobile-react-native) last pushed 2024-10-07 in the reviewed metadata. | Bundled Node singleton in a native thread, JS bridge, app data directory, pause/resume callbacks. Broad RN >=0.60 peer range is not proof of current RN architecture compatibility. Native-module build task explicitly checks host Node major 18. |
| CoMapeo RN fork | [@comapeo/nodejs-mobile-react-native 18.20.4-2](https://registry.npmjs.org/@comapeo%2fnodejs-mobile-react-native/latest), MIT; published 2025-11-21, about 359.3 MiB unpacked. [Android build source](https://github.com/digidem/nodejs-mobile-react-native/blob/main/android/build.gradle) uses AGP 8.13.0 and flexible 16 KiB page-size flags. | More recent Android build work; still Node 18, not a current supported Node runtime. Binary compatibility must be measured rather than inferred from flags. |
| Node upgrade branches | [Node 24.5.0 PR #151](https://github.com/nodejs-mobile/nodejs-mobile/pull/151) remains open; upstream full-suite work is unchecked. [Node 22 PR #134](https://github.com/nodejs-mobile/nodejs-mobile/pull/134) is also unreleased. | Possible future engineering work, not a maintained released runtime that can be claimed ready now. |
| Go + gomobile | Latest module observed: [`v0.0.0-20260908204917-8b95e45f8d3e`](https://proxy.golang.org/golang.org/x/mobile/@latest). [Current go.mod](https://github.com/golang/mobile/blob/8b95e45f8d3e224183cc3d760609cef9896e498c/go.mod) requires Go 1.26.0. [BSD-style three-clause licence](https://github.com/golang/mobile/blob/8b95e45f8d3e224183cc3d760609cef9896e498c/LICENSE). | Maintained native runtime/toolchain with standard crypto/net/http and an AAR/XCFramework binding route. Requires compatibility-tested porting of the Node domain and protocol, plus native lifecycle/adapters. Recommended path. |

The [official Node release schedule](https://github.com/nodejs/Release/blob/main/schedule.json) lists Node 18 EOL as **2025-04-30**. The [nodejs-mobile aggregate LICENSE](https://github.com/nodejs-mobile/nodejs-mobile/blob/main/LICENSE) begins with the Node MIT-style grant and includes dependency notices; GitHub's aggregate `NOASSERTION` classification must not be mistaken for a single MIT-only dependency licence. Preserve the full applicable notices when distributing binaries.

Do not substitute the unrelated npm package named simply `nodejs-mobile`: its [1.0.0 metadata](https://registry.npmjs.org/nodejs-mobile/latest) describes a Java stdin/stdout communication library and supplies no upstream nodejs-mobile repository link.

Android 16 KiB compatibility is an additional Node embedding concern. Upstream [issue #148](https://github.com/nodejs-mobile/nodejs-mobile/issues/148) reported incompatible release libraries; [PR #154](https://github.com/nodejs-mobile/nodejs-mobile/pull/154) adds alignment work, while a new release proposal [#155](https://github.com/nodejs-mobile/nodejs-mobile/pull/155) remains open. No binary was downloaded or inspected here, so no particular artifact is certified as aligned.

## Go build constraints

The installed Go 1.26.0 satisfies x/mobile's declared minimum. The [official Go download metadata](https://go.dev/dl/?mode=json) currently lists the maintained 1.26 patch as **Go 1.26.8**; prefer that project-scoped patch for the mobile cryptographic runtime. Its Linux/amd64 archive is 66,897,291 bytes. A newer 1.27.1 also exists; changing major/minor toolchain is unnecessary for this bounded phase.

Pin x/mobile's exact pseudo-version and [`golang.org/x/crypto v0.57.0`](https://proxy.golang.org/golang.org/x/crypto/@v/v0.57.0.mod), whose module also requires Go 1.26.0. The latter supplies scrypt. Go/x/mobile/x/crypto use maintained implementations; the port should implement serialization and protocol rules, not new cryptographic primitives.

The [gomobile binding source](https://github.com/golang/mobile/blob/8b95e45f8d3e224183cc3d760609cef9896e498c/cmd/gomobile/bind_androidapp.go) packages generated Java classes and `jni/<abi>/libgojni.so` into an AAR, invokes `javac -source 1.8 -target 1.8`, and uses the installed Android SDK/NDK. Generic generated help still mentions Go 1.16/API 16; **the current go.mod and installed NDK compatibility checks are authoritative**. The [NDK selection code](https://github.com/golang/mobile/blob/8b95e45f8d3e224183cc3d760609cef9896e498c/cmd/gomobile/env.go) validates API/ABI metadata and chooses a compatible NDK; it does not certify arbitrary NDK versions merely because they are installed.

For the first build, use explicit `-target=android/amd64 -androidapi=24`. Add `android/arm64` as a separate build after the emulator slice passes; do not build every ABI by default. Android API 24 aligns with the existing nodejs-mobile minimum and avoids obsolete API-16 defaults with current NDKs. The app's compile/target SDK can be 36 independently of its minimum SDK.

Use a complete project-local JDK, not the current JRE-only PATH. [AGP 8.13](https://developer.android.com/build/releases/past-releases/agp-8-13-0-release-notes) supports API 36.1, Gradle 8.13, and JDK 17 minimum. [Adoptium's JDK 17 metadata](https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=linux&vendor=eclipse) currently offers 17.0.20.1+1 (193,252,603 bytes). JDK/Gradle selection must be checked during setup; use explicit per-command JAVA_HOME/PATH and project caches, never change the host default Java or system settings.

For current Android native alignment, prefer NDK r28c (`28.2.13676358`). [Android's page-size guide](https://developer.android.com/guide/practices/page-sizes) says r28+ compiles 16 KiB alignment by default. Still verify every produced `.so` with the NDK ELF tools and the APK with build-tools `zipalign -c -P 16`; an aligned binary and an x86_64 emulator do not prove physical ARM64 16 KiB behavior.

Apple binding produces an XCFramework and explicitly invokes Xcode tooling. [gomobile documentation/source](https://github.com/golang/mobile/blob/8b95e45f8d3e224183cc3d760609cef9896e498c/cmd/gomobile/doc.go) requires macOS with Xcode for Apple targets; default minimum iOS is 13.0. Local Linux has neither Xcode nor Apple SDKs. Existing authorized macOS CI could build device/simulator slices in a later phase; that would be a native build result, not proof of signing, installation, physical radios, or background behavior.

## Exact compatibility gates before mobile UI claims

1. **Canonical bytes and identities:** match JavaScript UTF-16 key ordering, string escaping, U+2028/U+2029, number formatting and negative zero. Go's ordinary JSON serialization is not automatically this repository's `canonical()`. Compare Node-produced and Go-produced vectors, including non-ASCII names and malformed/deep inputs.
2. **Key formats and signatures:** use standard Ed25519/X25519 APIs plus PKIX/SPKI and PKCS8 DER. Identity addresses hash the entire SPKI DER bytes. [Go crypto/x509](https://pkg.go.dev/crypto/x509) supports Ed25519 and X25519 public/private formats. Never hash only the raw 32-byte public key if the Node protocol hashes DER.
3. **Encryption and recovery:** match AES-256-GCM 12-byte nonces/16-byte tags, HKDF-SHA256, exact AAD/context strings, reader envelopes, and canonical base64. HKDF salt for a reader is the UTF-8 hexadecimal identity string, not its decoded hash. Match vault scrypt `N=32768,r=8,p=1,keyLen=32` with [x/crypto/scrypt](https://pkg.go.dev/golang.org/x/crypto/scrypt). Test both directions, wrong readers/passwords, tampering, and reader-versus-author authority.
4. **Real transport:** preserve 2,048-byte fragments, frame/packet bounds, ACK/retry rules, expiry/hops, duplicate/resource caps, priority fairness, and relay consent. Prove actual Node ↔ Go sockets before JNI; a second implementation passing only its own tests is insufficient.
5. **Persistence and API:** verify disk bytes again before serving/display, preserve quotas/ownership/expiry and authenticated local mutation records, and map unsupported API operations explicitly. Encrypt vault/private metadata in the app's sandbox. Bundle the web assets locally; no external backend, font, CDN or remote runtime dependency.
6. **Native binding surface:** expose a small bounded API using binding-compatible strings/bytes and errors, such as start/state/request/stop. Keep internal Go maps, goroutines and filesystem paths out of renderer-controlled generic JNI calls. Run network/crypto work off the UI thread and close listeners on lifecycle shutdown.

The existing Node CLI is not directly suitable as an embedded entry point: it calls `process.exit`, installs process signals, and enforces the development host's 15 GiB free-disk rule. Mobile must retain sensible app-specific storage limits while the **host build environment** retains the required 15 GiB reserve. The [nodejs-mobile FAQ](https://github.com/nodejs-mobile/nodejs-mobile/blob/main/doc_mobile/FAQ.md) independently documents single-runtime/thread behavior, restricted child processes, iOS exit restrictions, and app-specific writable paths.

The current serialport native binding cannot simply be copied from Linux into Android/iOS. The first mobile adapter should be real TCP. USB serial, BLE, Wi-Fi Direct and external radios need native platform adapters, explicit permissions and actual hardware tests. An embedded Go core avoids a Linux `.node` addon dependency but does not implement those adapters automatically.

## Bounded Android build and one-emulator plan

The following are **available upstream packages, not installed tools**. Sizes are compressed archive sizes read from the [official SDK index](https://dl.google.com/android/repository/repository2-3.xml) and [Google APIs image index](https://dl.google.com/android/repository/sys-img/google_apis/sys-img2-3.xml).

| Package | Version/revision selected | Compressed bytes |
| --- | --- | ---: |
| Command-line tools | 23.0, stable; `commandlinetools-linux-16111833_latest.zip` | 181,052,239 |
| Platform tools | 37.0.1 | 9,054,187 |
| Android SDK platform | API 36, revision 2 | 65,878,410 |
| SDK build tools | 36.0.0 | 63,737,259 |
| NDK | r28c, 28.2.13676358 | 722,261,334 |
| SDK CMake, only if the wrapper requires it | 3.22.1 | 22,308,647 |
| Android emulator | **37.1.11 stable**; 37.2.8 in the index is a preview channel | 334,378,080 |
| **One** system image | `system-images;android-36;google_apis;x86_64`, revision 7 | 1,895,447,397 |

JDK, patched Go, Gradle and module downloads add to those figures. Budget **25 GiB maximum additional workspace usage** for compressed archives, extracted tools, build caches and a single bounded AVD; this is a planning allowance, not measured installation size. Recheck actual space at each stage, stop before the host reserve falls below 15 GiB, and keep Go/native compilation at `-p2` with one native build at a time. A 2 GiB RAM/2-vCPU emulator is an initial test configuration, subject to the emulator's actual requirements.

Suggested sequence:

1. Run cross-language core/transport tests on Linux before spending space on the image. Use the maintained pinned Go patch and module versions, with GOCACHE/GOMODCACHE/GOBIN under project-owned paths.
2. Install the JDK and minimum SDK/NDK/build tools under `.tools`/`.cache`, accept/review their standard SDK terms through the normal installer, and record package revisions/checksums. Do not install Android Studio or multiple NDK/image versions for this phase.
3. Produce one x86_64 AAR with `gomobile bind`, then a small Android host APK containing that AAR and bundled UI assets. Verify AAR/ELF/APK contents, permissions and alignment before attempting an emulator.
4. Download only the selected API-36 image, create only a project-owned `relayloom-api36` AVD, set ANDROID_AVD_HOME/ANDROID_USER_HOME/GRADLE_USER_HOME to project locations, and check acceleration normally. Do not change `/dev/kvm` permissions, kernel settings or system services.
5. Launch that one AVD with its own data image and isolated adb server port. Install the debug APK. Verify the native core's version, identity creation, private encrypted storage, local API authentication, real peer sockets, restart recovery, and UI/media permissions. Host peers must exchange with the **app's** core; a WebView hitting the host daemon does not count.
6. Prove A → mobile B → C forwarding and B-stopped negative control with a fixture where A/C have no direct listening path; add seed takeover with the publisher offline. Record socket topology/probes, received signed bytes and negative controls. Emulator results remain distinct from physical Wi-Fi/BLE/USB/radio behavior.
7. Build an ARM64 slice only after the x86_64 route passes. Physical Android testing and any 16 KiB ARM64 claim remain pending until a suitable device is exercised. Do not download a second emulator image to imply that hardware gate passed.

Debug APK/emulator work needs no paid cloud or store account. SDK/Google APIs image terms still apply; Go/x/mobile licences and the JDK's applicable notices must accompany distribution. Store registration, Apple membership/signing, hardware purchase and paid runners are separate decisions, not costs authorized or incurred by this review.

## Background and iOS limits

An on-device runtime does not override mobile lifecycle policy. Start by proving foreground relaying and honest suspend/resume recovery. On Android, any continuing foreground service must have a legitimately applicable service type, user-visible notification, required permissions, and stop/timeout handling. [Android 15+ dataSync/mediaProcessing limits](https://developer.android.com/develop/background-work/services/fgs/timeout) include six hours per 24-hour period while backgrounded; do not promise an unlimited relay or mislabel the service to evade those limits.

On iOS, [Apple's background strategies](https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app) grant limited completion time and discretionary scheduling. Go embedding does not make continuous arbitrary background relaying available. Bundle executable code rather than downloading scripts to change the application, use app-private storage and native key protection, and validate local-network permissions/entitlements on an actual device. Simulator/build results do not satisfy those gates.

The immediate blockers are concrete and bounded: missing local Android compiler/SDK/NDK/emulator prerequisites, an unimplemented and unverified Go compatibility port, and local absence of macOS/Xcode for Apple builds. They can be advanced independently. This review does not mark all mobile work blocked by the original Node stack and does not mark mobile implemented merely because an AAR or framework can be generated.
