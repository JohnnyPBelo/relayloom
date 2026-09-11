# Native Android host

The Android application embeds the Go runtime in its own APK process through the generated `mobile.Mobile` gomobile binding. It starts a real app-local Go engine and authenticated HTTP server, then renders bundled web assets at that exact loopback origin. It does not use a Node daemon on the development host, a remote website, a PWA, or an unimplemented runtime placeholder.

Current verified level: **the final x86_64 native APK executes in the single API 36 emulator; UI identity, encrypted peer exchange, multi-hop pause/heal, seed takeover and foreground stop/resume gates passed**. The final APK contains the reviewed native API pagination, attachment, journal and resource fixes. Physical Android, ARM64, Bluetooth, Wi-Fi Direct, USB/radio, background service and store-release behavior are not implied.

## Final verified artifacts

| Artifact | Size | SHA-256 |
| --- | ---: | --- |
| `relayloom-core.aar` | 5,950,466 bytes | `70fdc0ac2aee9c4710b7346f974222462ba8b2c50c0379d57b90c8e8313eaa1b` |
| `relayloom-android-x86_64-debug.apk` | 11,626,176 bytes | `e1bdb0889e0328a962a0d43cfed04ee85c4b73b6a14471c7082eabe9d6d3d2a0` |

Both artifacts are in `.cache/android/artifacts`. APK signatures and native ELF/APK 16 KiB alignment passed. The installed emulator `/data/app/.../base.apk` was independently hashed and matches the final APK exactly. Distribution notices for RelayLoom, Go, x/mobile, x/crypto, React, React DOM, Scheduler and Lucide are bundled locally.

The final commands `node scripts/android-smoke.mjs --final` and `node scripts/android-relay.mjs --final` passed **16 and 11 on-device instrumentation assertions**, respectively, plus host topology, process-stop, missing-object and exact attachment-byte checks. Both reports carry the final APK hash and `preliminaryBuild: false`. The actual final full-screen screenshot of the author-offline cached site was visually reviewed and shows the correct open page dialog; it also records focused/visible native WebView state.

Sanitized, publishable JSON/PNG evidence is in [`docs/evidence/android`](evidence/android/index.json). It contains no capabilities, passwords, key material, identity proofs, vaults, app-private state, adb key or debug keystore. Synthetic test identity IDs/names remain to connect provenance across results. The original UIAutomator identity-creation evidence explicitly retains its earlier preliminary APK hash; final upgrade/unlock and stop/resume tests prove that identity remains usable with the final APK.

## Runtime contract and lifecycle

```text
mobile.Start(dataDir, assetsPath) -> JSON { origin, token, tcpPort }
mobile.Stop() -> error
mobile.Version() -> string
```

Java calls `go.Seq.setContext(applicationContext)` before `mobile.Mobile.start`. The core's private persistent data uses `files/core`; separately bundled web assets are verified by SHA-256 and copied into `files/web`. The APK contains an asset manifest and a complete local web bundle; the app never downloads executable UI updates.

One process-scoped `RuntimeLeaseCoordinator` serializes all native starts/stops off the Android UI thread. Each Activity startup holds an ownership lease. A late stop from an older Activity cannot shut down a replacement core, and cancelled startup cannot publish its endpoint. Navigation, native notification calls, and asynchronous microphone permission completion also require the current lease. This fixes the independently reviewed per-Activity-executor/global-core race.

The first implementation is **foreground-only**. When the Activity stops, it releases its core lease, closes its generic notice, and destroys the WebView to release renderer microphone tracks. Returning starts a fresh local server/capability and requires the application to recover/unlock persistent state. The final emulator test observed both actual listeners close while backgrounded and verified identity/message recovery after resuming and unlocking. No foreground service, persistent background relay, lifecycle exemption, wake lock or OS-security workaround is implemented. Device sleep, arbitrary process death and multi-Activity recreation still need additional device tests; the replacement-lease race has host-JVM regression coverage.

## WebView and native boundaries

- The returned origin must be `http://127.0.0.1:<valid-port>` with no credentials, query or unexpected path. The capability must be a bounded URL-safe token. The token is never placed in logcat; logs record only native runtime, local port, and lifecycle state.
- Main-frame navigation and network resource requests are restricted to the exact returned origin. Same-origin Blob media is supported. Other HTTP hosts/ports, file URLs, content URLs, JavaScript navigation, remote scripts/resources, popups and geolocation are blocked.
- File/universal URL access, cross-origin cleartext, third-party cookies and WebView remote debugging are disabled. The manifest permits cleartext only for 127.0.0.1; the renderer's exact-port policy adds the stricter runtime boundary.
- The Go server independently verifies its capability/Host/Origin boundary; the WebView allowlist is not a replacement for API authentication.
- Microphone access follows the web UI's explicit record action. Android grants only `RESOURCE_AUDIO_CAPTURE` from the current exact origin, following standard `RECORD_AUDIO` permission. Camera access is neither declared nor granted. Late permission results must still belong to the current core lease and origin.
- The native JavaScript interface exposes only notification permission/request/show/close calls, each requiring the current private capability. There is no native shell, generic HTTP, filesystem or arbitrary method bridge.
- Native notification text is fixed in Java: title `RelayLoom`, body `Tens novas mensagens privadas. Abre o RelayLoom para as ler.` Caller-supplied names/content/options are ignored. The bundled adapter presents the normal Notification API to the already explicit, per-identity opt-in web hook. API33+ uses standard `POST_NOTIFICATIONS` permission; no automatic prompt occurs on startup.

The wrapper currently has no generic Android document picker/export bridge. Existing text/voice/attachment rendering can be evaluated, but Android file selection/download semantics must be implemented and tested before claiming all web file flows work. Microphone and native notification display also remain unverified until executed; earlier web tests used synthetic media and Notification stubs.

## Project-local verified prerequisites

Everything below lives in `.cache/android` or `.cache/toolchains/jdk17`. The host default Java, global SDK, security settings and system services were not intentionally reconfigured. No Android Studio or Gradle installation is needed for this minimal wrapper.

| Item | Version | Official source and checksum |
| --- | --- | --- |
| Eclipse Temurin JDK | 17.0.20.1+1, Linux x64 | Adoptium's official GitHub release asset `OpenJDK17U-jdk_x64_linux_hotspot_17.0.20.1_1.tar.gz`; 193252603 bytes; SHA-256 `3808d1d15e3ec6bd5b84057fb5d84c33d8a1536a258146bcea2e603fc726e08e` verified against official release metadata |
| SDK command-line tools | 23.0, build16111833 | `dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip`; official SHA-1 `e025545c62a8e64c7559119566a569fb1dec5f60`; computed SHA-256 `0877a1d048fe4a24efe2eff536ca4223f7adeb58648bb81909d33c446918cfa8` |
| Official Android CLI | 1.0.16261425 | Command-line tools23's maintained replacement for sdkmanager; installed through the official bundled launcher |
| Android platform | API36 revision2 | Official SDK index SHA-1 `2c1a80dd4d9f7d0e6dd336ec603d9b5c55a6f576` |
| SDK build tools | 36.0.0 | Official SDK index SHA-1 `b0b6376977657e8ad9b969bacf4093601da2c6fb` |
| Platform tools | 37.0.1 | Official SDK index SHA-1 `477254aa5f903c15cf51001717bdf347fb6b53e0` |
| NDK | r28c,28.2.13676358 | Official SDK index SHA-1 `a7b54a5de87fecd125a17d54f73c446199e72a64`; Clang19.0.1 |
| Go toolchain | 1.26.8 | Root-provisioned patched Go in `.cache/toolchains/go1.26.8` |
| gomobile/gobind | `v0.0.0-20260908204917-8b95e45f8d3e` | Root-provisioned official x/mobile module; bind script checks `go version -m` for this exact revision |

SDK package checksums above are the published official index values used by the official installer; the wrapper does not claim independent re-download hashing of SDK archives removed by that installer. Bootstrap JDK and command-line archives were independently size/hash checked by `android-toolchain.py` before extraction. Metadata, computed hashes, installed `source.properties`, tool versions and package sources are recorded in `.cache/android/toolchain-bootstrap.json` and `.cache/android/toolchain-installed.json`.

The current official [SDK agreement](https://developer.android.com/studio/terms) dated April28,2026 was read and accepted by using the SDK for the already-authorized native Android build; its clause2.2 explicitly includes use. The official repository's older embedded licence was also retained. Acceptance is recorded in `.cache/android/sdk-acceptance.json` with the terms text hash and package scope. No store account, paid subscription or purchase was involved.

The initial sdkmanager shim unexpectedly displayed the new Android CLI's default metrics behavior. That task-owned install was interrupted and resumed with the documented `--no-metrics` option; all subsequent CLI calls explicitly use it, plus project-local Android/XDG/Java preference paths. The initial launcher created standard optional CLI analytics metadata under the project Android user directory; it is not claimed that no initial tool-usage metric could have been sent. No project source/secrets were arguments to that installer.

Temurin includes GPLv2 with Classpath Exception and its complete per-module notices under `legal/`; Android SDK/NDK components retain their standard SDK and third-party notices. The application sources use the repository MIT licence. Go/x-mobile/x-crypto carry their respective BSD-style notices and must accompany native distribution. Debug output is not a signed public mobile release.

## Reproducible bounded build

```sh
python scripts/android-toolchain.py bootstrap
python scripts/android-toolchain.py sdk
python scripts/android-build.py --policy-test
node scripts/android-bind.mjs
python scripts/android-build.py
```

Root installs the pinned gomobile/gobind tools and prepares a passing `dist/web` build before binding. The scripts use only project input/output paths, Go1.26.8 first on PATH, `GOFLAGS=-p=2`, project Go caches, JDK17, API36, NDK28.2, and API24 minimum binding. The initial ABI is only `android/amd64`/x86_64.

The APK pipeline is SDK `aapt2` → JDK `javac --release8` → SDK `d8` → `zipalign` → `apksigner`. D8 handles Java8 lambda desugaring. It checks that the AAR contains actual `mobile.Mobile`, `go.Seq` and x86_64 `libgojni.so`, packages the JNI runtime and local assets, validates every native ELF LOAD alignment is at least16KiB, and verifies final APK signatures and `zipalign -c -P16`. A standard project-private debug key is generated for local development only.

Recorded first successful cross-build on September11,2026:

- AAR: `.cache/android/artifacts/relayloom-core.aar`, 5932164 bytes, SHA-256 `800b748113c2f5137bc23bbc05a3e0ca04d79c9404990d44b135e1fcaa7b5b45`.
- APK: `.cache/android/artifacts/relayloom-android-x86_64-debug.apk`, 11572199 bytes, SHA-256 `9bb8cbc2ceed4d40cf9d0ec21325b48a41f7f42a8b586aaa71e1dd8182f37678`.
- AAR/ELF/APK content, native16KiB alignment and debug signature checks passed. Reports: `.cache/android/aar-build-report.json`, `.cache/android/build-report.json`, `.cache/android/zipalign-report.txt`.
- `python scripts/android-build.py --policy-test` passed **21 origin/capability assertions and7 lifecycle coordinator assertions** on the host JVM. The coordinator uses a fake backend for the test; this is not Activity/WebView/emulator execution.
- An independent source review confirmed the stale Activity stop fix, then requested the additional current-lease/origin condition in microphone permission completion; that guard was applied before the successful APK build.

After the native retained-accounting and file-fingerprint fixes, a second preliminary build produced AAR SHA-256 `426821e6e5316c11d8fec32179c0847cf3eb1d4aa2c2f95d9c385089de92dda9` (5923050 bytes) and APK SHA-256 `860e19be36b4f3b03840cf47f80a2f7e5f49fed9721bc730099d6a8631718eea` (11551719 bytes). All initial emulator results below use that explicitly recorded APK. Further native pagination/attachment/request-limit changes are under integration, so these hashes are preliminary, not final distribution artifacts.

## Single emulator plan and resource controls

Only after the APK passed were stable emulator37.1.11 and one image `system-images;android-36;google_apis;x86_64` revision7 downloaded. Their published SHA-1 checksums are `1b1f78891abf8ec268264356e1365c25519e8379` and `c6bf44bdcd885bb902b4ba752d111a073ad7a817`. `scripts/android-emulator.py` manages only a project-owned `relayloom-api36` AVD, two virtual CPUs and an isolated adb server at port5047; emulator serial is `emulator-5580`. This image automatically raised the requested RAM to2560MiB and requires a6GiB userdata disk; the persisted AVD config now records6GiB rather than claiming the original2GiB request was honored.

The emulator is explicitly headless with audio input/output disabled, both camera inputs `none`, no snapshots, no host microphone/camera passthrough and no metrics. Normal emulator authentication remains enabled with a project-owned adb key; console/adb use the explicit documented `-ports 5580,5581` pair. It does not use or stop the default adb server. KVM is checked normally without changing device permissions or host services.

`android-toolchain.py status` enforces the25GiB Android/JDK allocation ceiling and15GiB host free-space reserve; all staging/download/build/AVD data is project-scoped. At minimum-toolchain completion Android/JDK used about3.51GiB, with about136GiB host space free. No second image or additional ABI is authorized by the current scripts.

The first pristine boot was interrupted while userdata encryption was initializing; the guest later reported interrupted encryption and read-only `/data`. Before any app installation or identity creation, only that newly created test AVD was reset with the official `-wipe-data` option. Kernel boot subsequently completed in66553ms. The diagnostic logs/recovery record remain in `.cache/android/evidence`. There was no second image/AVD and no user data was removed.

## Actual emulator gates

```sh
python scripts/android-emulator.py provision
python scripts/android-emulator.py start
python scripts/android-emulator.py status
python scripts/android-emulator.py install
python scripts/android-ui.py create-identity
python scripts/android-instrumentation.py
node scripts/android-smoke.mjs --final
node scripts/android-relay.mjs --final
python scripts/android-emulator.py stop
```

The separate instrumentation APK is signed with the same local debug key and is never packaged inside the main application. It runs in the actual target Android app process, observes the real WebView, and uses the app's own authenticated API without enabling WebView debugging or adding unauthenticated endpoints. Test capabilities remain inside the test processes; evidence contains public identity cards, ports, fixture hashes and outcomes only.

The UIAutomator run created `AndroidEmulator` through real Android text input and the rendered setup form, then captured the messenger. Logcat reported `runtime=gomobile-in-process`, and the authenticated on-device state reported `nativeRuntime=Go`. This is actual emulator/native-core evidence, not the earlier browser API stubs or a view of a host daemon.

`android-smoke.mjs --final` passed 16 instrumentation assertions on the final APK: real web UI unlock and composer send, missing-capability 401, private Android → Node TCP message with exact decrypted payload, Node → Android reply with matching author, encrypted private bundle file on device with no plaintext message, actual Activity background closing both HTTP/TCP listeners, and resume/unlock recovering the same identity and message. Host fixtures use unique public display names per run so prior app-persistent contacts cannot misdirect the test.

`android-relay.mjs --final` passed 11 on-device instrumentation assertions plus host topology/byte controls: A (Node) and C (Node with `--tcp-port=-1`) each have exactly one link to Android B; only B's peer transport is exposed through an isolated adb forward. A and C have no direct link. B receives a private negative-control object while relay is paused, while C receives none over the 4-second negative window. After B resumes, C receives the private 12,052-byte attachment exactly. The final fixture SHA-256 is `3379343b792d133bc8605c457697e5530b369040a5edad70d25386866107e87f`. The source author and private ACL remain intact.

For seed takeover, C is stopped before A publishes a public post and site. Android B reads and pins both. A is then stopped. While C is still stopped, its on-disk object paths are checked to show both fixtures are absent; C then restarts and receives them from Android B, preserving A's signed authorship. C's persisted peer reconnect can happen immediately, so this absence check deliberately precedes startup rather than incorrectly treating immediate seeded receipt as preexisting content. Android B also opens A's cached site through the real profile viewer after A has stopped.

Actual full test artifacts under `.cache/android/evidence`:

- `uiautomator-identity.json`, `android-onboarding-before.png`, `android-identity-messenger.png`
- `android-native-peer-exchange.json`, `android-peer-messenger.png`
- `android-multihop-seed.json`, `android-offline-site.png`, `relay-instrumentation-output.txt`

The initial offline-site UI test had an ambiguous text wait: a publisher name could match the conversation list before the feed committed. The corrected test opens visible navigation, waits for the feed and exact profile action, opens the cached page dialog, and waits for the WebView visual-state callback before capture. The final screenshot is visually confirmed; stale earlier frames are not published as page evidence. A direct Canvas diagnostic was blank and is also excluded from public evidence.

After verification, the sole project AVD and isolated adb server at port 5047 were stopped; no transport forwards or fixture peer processes remain. The same AVD is retained for future tests. Final measured allocation including Android, JDK and all project Go toolchain/build/module caches was **11.07 GiB**, below the 25 GiB budget, with **129.05 GiB free**, above the 15 GiB reserve. The exact byte counts are in the public resource audit.

No physical microphone/camera or native OS notification display is exercised by these gates. Aligned x86_64 archives and an emulator do not validate ARM64 16 KiB hardware, radios, continuous background relay or emergency readiness. Native document picker/export and real notification/media permission UI tests remain future work.
