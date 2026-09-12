# Native Android host

The Android application embeds the Go runtime in its own APK process through the generated `mobile.Mobile` gomobile binding. It starts a real app-local Go engine and authenticated HTTP server, then renders bundled web assets at that exact loopback origin. It does not use a Node daemon on the development host, a remote website, a PWA, or an unimplemented runtime placeholder.

Latest device-verified level: **APK `27a71947…` executes in the same API 36 emulator with the final elapsed-deadline checker, current outbox UI, real document selection/export, encrypted peer exchange, multi-hop pause/heal, seed takeover and lifecycle gates passing**. Physical Android, ARM64, Bluetooth, Wi-Fi Direct, USB/radio, background service and store-release behavior are not implied.

## Final checker and outbox integration — September 12, 2026

The final APK is **11,765,440 bytes**, SHA-256 `27a71947f73e3a2622da6efbcb402d04260e53293cb6156e27f43ea3b3f8e5a2`, using unchanged AAR `7c9f60fe036b85d08bc584f3c469ee31e3537a3f22de9d7fdfd514ef820503b5` and web assets `index-Ct0M5tYK.js`/`index-BcajBo5I.css`. The installed `base.apk` matched before and after the gates. Java/assets/AAR input hashes remained unchanged. Archive signature and 16 KiB alignment checks passed; host policies passed 21 origin + 7 fake-backend lease + 28 document/session + 6 synthetic capture assertions.

After the owner's separate one-test stability measurement completed, root performed one sequential final Android integration, without new/resumed agents:

| Command | Actual result |
| --- | --- |
| `python3 scripts/android-build.py` | Built and verified in 5.931 s, exit 0 |
| `python3 scripts/android-emulator.py start` / `install` | Same AVD, update preserved existing data; installed hash matched |
| `python3 scripts/android-instrumentation.py` | Separate test APK built and signature verified |
| `node scripts/android-documents.mjs --final` | 38 real SAF assertions, 40.302 s, exit 0 |
| `node scripts/android-documents.mjs --final --deadline` | 15 deadline/lifecycle assertions, 135.545 s, exit 0 |
| `node scripts/android-smoke.mjs --final --evidence-dir .cache/android/evidence/final-integration-20260912` | 16 real message/recovery assertions, 16.706 s, exit 0 |
| `node scripts/android-relay.mjs --final --evidence-dir .cache/android/evidence/final-integration-20260912` | 11 relay/seed assertions plus host controls, 17.097 s, exit 0 |

All **80 emulator assertions** passed once on this exact hash. The immutable 120-second handoff closed real listeners at an observed 121,264 ms including fixture overhead; normal HOME closed them in 1,254 ms. Private capability rotation, unchanged relay preference and identity recovery passed. This is a scheduled Android execution observation, not physical deep-sleep or hard real-time evidence.

The SAF fixture sent and exported the same 16,121 bytes, SHA-256 `f365daab81c352453f4c2b36725bdca8fdb19b4150f98bf57fc7d34a2cd56322`; the exported encrypted vault recovered the original identity. Relay controls proved C had no direct link/listener, received nothing during B's paused window, then received the exact 12,052-byte attachment. With publisher A stopped, Android B served a previously absent post/site to restarted C, preserving A's authorship. Root inspected the actual save, conversation and cached-site screenshots.

Sanitized reports, command outcomes, input hashes and screenshots: [`documents-27a71947/index.json`](evidence/android/documents-27a71947/index.json). The test-only provider/instrumentation package was removed, transport forwards were empty, and the owned AVD/adb were stopped; the same AVD and identity remain. Final free disk was 127.54 GiB. No physical media, notification, ARM64 or radio gate was added. The earlier reports below retain their original APK boundaries.

## Earlier document build — September 12, 2026

| Artifact | Size | SHA-256 |
| --- | ---: | --- |
| `relayloom-core.aar` | 6,012,736 bytes | `7c9f60fe036b85d08bc584f3c469ee31e3537a3f22de9d7fdfd514ef820503b5` |
| `relayloom-android-x86_64-debug.apk` | 11,765,440 bytes | `4de67c3e1540556bbbcab98e7053112bfce2625cdf994c4de67c2d15403b77bb` |

The last tested artifacts live in `.cache/android/artifacts`. That APK combines the freshly bound Go engine with its recorded `dist/web` bundle; its installed Android `base.apk` independently hashes to the same value. Signatures and native ELF/APK 16 KiB alignment pass. The new, sanitized evidence index is [`documents-4de67c3e/index.json`](evidence/android/documents-4de67c3e/index.json); earlier baseline evidence remains unchanged.

The same tested APK passed **38 real SAF assertions**, **15 actual deadline/HOME assertions**, **16 encrypted peer/resume assertions**, and **11 relay/seed assertions**, plus host topology and byte checks. The system picker selected a 16,121-byte attachment, which the existing composer sent privately to a real Node peer. Node decrypted exactly those bytes; the copy saved through `ACTION_CREATE_DOCUMENT` also matched SHA-256 `f365daab81c352453f4c2b36725bdca8fdb19b4150f98bf57fc7d34a2cd56322`. The existing recovery form exported an 812-byte encrypted vault through the real system picker, and Node's vault importer recovered the original identity. No vault or key material is included in evidence.

Picker cancellation attached nothing. Providers advertising more than 2,000,000 bytes and advertising only seven bytes while delivering 2,000,001 bytes were rejected. Unknown size was accepted only after reading the bounded actual bytes. Cancelling a recovery export showed cancellation and no completed-save claim from the web UI. The attachment-save, encrypted conversation and publisher-offline page screenshots were visually reviewed.

The deadline test left the system picker open. The 120-second deadline closed both real listeners at an observed **120,902 ms from starting the picker action**, including launch/polling overhead; returning rotated the private capability and recovered the same identity. Normal HOME without a pending document closed both listeners in **1,173 ms**. Relay preferences were unchanged by the handoff. At that APK build, the host tests separately passed **21 origin/capability**, **7 fake-backend lease**, **23 document-policy/session**, and **6 synthetic capture-race** assertions; those do not claim device media or arbitrary Activity/process-recreation coverage.

Commands executed for that exact APK:

```sh
node scripts/android-bind.mjs
python scripts/android-build.py
python scripts/android-emulator.py install
python scripts/android-instrumentation.py
node scripts/android-documents.mjs --final
node scripts/android-documents.mjs --final --deadline
node scripts/android-smoke.mjs --final --evidence-dir .cache/android/evidence/documents-final-4de67c3e
node scripts/android-relay.mjs --final --evidence-dir .cache/android/evidence/documents-final-4de67c3e
python scripts/android-emulator.py stop
```

These test fixtures now initiate TCP toward the sole forwarded Android transport port, preserving the same message/relay topology without accumulating new persisted Android peer endpoints. No authenticated HTTP control API is forwarded. The test-only provider package was removed after the run; all transport forwards, the sole AVD process and isolated adb server were stopped. The same AVD and identity are preserved. Allocation after the handoff cleanup, including Android, JDK and all project Go caches, was **11.34 GiB**, with **128.66 GiB free**, within the 25 GiB allocation and 15 GiB free-space limits.

Physical Android/ARM64, real microphone/notification permissions, arbitrary OS process death/Activity recreation, and slow or failing remote document writers remain unverified on device. Preliminary SAF runs were explicitly kept separate: an isolated web bundle from `c3f5b42` was used with the earlier AAR until the current native/web pair was ready. Those results are not substituted for the exact APK gates above. The earlier same-day `a3ca6ee9…` evidence is also preserved in its own directory.

## Preserved source-only handoff after APK 4de67c3e

The current Java source additionally revalidates the unchanged elapsed-time document deadline before foreground/resume, while retaining a handoff, and when receiving results. A main-thread check recalculates the remaining original deadline at intervals of at most one second of scheduled execution; it never creates a new deadline and uses no alarm, wake lock or OS exemption. Ownership is checked before expiration can restart a core, so an old Activity cannot replace a newer lease. Pending checks are cancelled when the operation finishes. This addresses the earlier single `Handler.postDelayed` wakeup using uptime, which excludes deep sleep. Android scheduling/suspension still prevents a hard real-time execution guarantee.

At that handoff, this later source passed **28 document-policy/session host assertions**, including an elapsed-clock jump, no deadline renewal and old-lease ownership; the unchanged 21 origin, 7 fake-backend lease and 6 synthetic capture assertions also passed. Independent review of this bounded source delta found no concrete defect. **The checker was not yet compiled/device-tested at that checkpoint; the later 27a71947 integration above closes that specific pending gate.**

With the synthetic app force-stopped, exactly 16 old `10.0.2.2` fixture endpoints were removed from its configuration. Its identity was validated against preserved evidence; the identity vault and all 100 other private core files had identical before/after hashes, and every other config field was preserved. A backup remains only inside app-private files. No private state or keys are copied into evidence. No post-cleanup application/device regression run was started during the requested sequential-verification pause.

The handoff required freezing the final shared web bundle, building the current Android source with the unchanged AAR and repeating SAF, deadline, simple and relay gates on that hash. This was subsequently performed on 27a71947 as recorded above. The original checkpoint remains [`post-apk-source-handoff.json`](evidence/android/documents-4de67c3e/post-apk-source-handoff.json), preserving the earlier evidence limits.

## Previously verified baseline artifacts

| Artifact | Size | SHA-256 |
| --- | ---: | --- |
| `relayloom-core.aar` | 5,950,466 bytes | `70fdc0ac2aee9c4710b7346f974222462ba8b2c50c0379d57b90c8e8313eaa1b` |
| `relayloom-android-x86_64-debug.apk` | 11,626,176 bytes | `e1bdb0889e0328a962a0d43cfed04ee85c4b73b6a14471c7082eabe9d6d3d2a0` |

These earlier hashes are retained in baseline evidence; the current files are the September 12 artifacts above. Baseline APK signatures and native ELF/APK 16 KiB alignment passed. The installed emulator `/data/app/.../base.apk` was independently hashed and matches the final APK exactly. Distribution notices for RelayLoom, Go, x/mobile, x/crypto, React, React DOM, Scheduler and Lucide are bundled locally.

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

Normal operation is **foreground-only**. When the Activity stops without a pending explicit document handoff, it releases its core lease, closes its generic notice, and destroys the WebView to release renderer microphone tracks. Returning starts a fresh local server/capability and requires the application to recover/unlock persistent state.

The Storage Access Framework picker necessarily opens another Activity. One explicit user-initiated `ACTION_OPEN_DOCUMENT` or `ACTION_CREATE_DOCUMENT` may therefore retain the current core/lease/WebView for **one absolute, non-renewable 120-second handoff**. Both listeners may remain active during that bounded interval. Media capture is suspended before launch; late capture resolutions are stopped, then WebView timers pause while hidden. Cancellation, completion, expiry, destruction or a replaced lease consumes the ticket. Expiry while hidden closes the core normally. Relay preferences are never changed. Normal HOME without a pending document stops immediately. This exception is not a foreground service, OS exemption or persistent background mode. The final emulator test observed both actual listeners close while backgrounded and verified identity/message recovery after resuming and unlocking. No foreground service, persistent background relay, lifecycle exemption, wake lock or OS-security workaround is implemented. Device sleep, arbitrary process death and multi-Activity recreation still need additional device tests; the replacement-lease race has host-JVM regression coverage.

## WebView and native boundaries

- The returned origin must be `http://127.0.0.1:<valid-port>` with no credentials, query or unexpected path. The capability must be a bounded URL-safe token. The token is never placed in logcat; logs record only native runtime, local port, and lifecycle state.
- Main-frame navigation and network resource requests are restricted to the exact returned origin. Same-origin Blob media is supported. Other HTTP hosts/ports, file URLs, arbitrary content URLs, JavaScript navigation, remote scripts/resources, popups and geolocation are blocked. The only content resources allowed are this current controller’s registered immutable document snapshots; main-frame content navigation remains blocked.
- File/universal URL access, cross-origin cleartext, third-party cookies and WebView remote debugging are disabled. The manifest permits cleartext only for 127.0.0.1; the renderer's exact-port policy adds the stricter runtime boundary.
- The Go server independently verifies its capability/Host/Origin boundary; the WebView allowlist is not a replacement for API authentication.
- Microphone access follows the web UI's explicit record action. Android grants only `RESOURCE_AUDIO_CAPTURE` from the current exact origin, following standard `RECORD_AUDIO` permission. Camera access is neither declared nor granted. Late permission results must still belong to the current core lease and origin.
- The native JavaScript interface exposes notification permission/request/show/close plus one bounded Blob-export operation, all requiring the current private capability. Export also requires a recent, one-use native touch/key gesture and a foreground current lease. There is no native shell, generic HTTP, filesystem path/URI reader or arbitrary method bridge.
- Native notification text is fixed in Java: title `RelayLoom`, body `Tens novas mensagens privadas. Abre o RelayLoom para as ler.` Caller-supplied names/content/options are ignored. The bundled adapter presents the normal Notification API to the already explicit, per-identity opt-in web hook. API33+ uses standard `POST_NOTIFICATIONS` permission; no automatic prompt occurs on startup.

## Document picker and Blob export

Attachments use standard `ACTION_OPEN_DOCUMENT` grants, with one to four selections and a maximum of 2,000,000 actual bytes per file. Missing provider size is supported; a small advertised size cannot bypass the streamed byte cap. The MIME allowlist includes PNG/JPEG/WebP/GIF, supported audio/video, plain text, JSON, PDF, ZIP and inert octet-stream. HTML, SVG and other unsupported formats are refused. Names are sanitized and bounded.

The app copies each selected file into a bounded private cache snapshot before returning its URI to the WebView. Its nonexported, read-only provider serves immutable bytes and metadata; the renderer never receives the original provider URI. Snapshots belong to one controller, are replaced only after a valid completed selection, and are removed on owner shutdown. Stale workers and destroyed Activities cannot remove a replacement controller’s files. The provider cleans prior-process orphan snapshots on startup. No persistable grant or broad storage permission is requested.

The bundled adapter accepts only a same-origin Blob from an `<a download>` action, including the existing detached recovery-export anchor. The adapter retains only Blob objects created by the current page until their normal revocation and reads them directly, preserving the strict server connection policy. Native code receives a bounded name, MIME and base64 payload, and opens standard `ACTION_CREATE_DOCUMENT`; the destination comes only from the system Activity result. Attachments are limited to 2,000,000 bytes; `.vault.json` plus JSON MIME uses the lower 8192-byte bound, which confers no extra authority. Export reports saved only after the actual write completes under the same lease. Cancellation/error/expiry has its own visible and accessible status; interrupted writes explicitly warn that the chosen destination may contain a partial file. The web UI reports that recovery export has started; the native status supplies the final save, cancellation or error result. Application toasts are not globally suppressed.

The separate debug-only instrumentation APK includes a synthetic `DocumentsProvider` with normal, unknown-size, over-limit, deliberately misleading-size and unsupported-MIME fixtures. It is never packaged in the main application. Host policy tests are distinct from actual system-picker tests. Physical microphone capture and native notification display remain unverified; the adapter capture race test uses synthetic streams and does not exercise device media.

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

No physical microphone/camera or native OS notification display is exercised by these gates. Aligned x86_64 archives and an emulator do not validate ARM64 16 KiB hardware, radios, continuous background relay or emergency readiness. Real notification/media permission UI tests remain future work. Current document-picker evidence is recorded separately above so previous APK results retain their original hashes.
