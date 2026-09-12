# Android SQLite compatibility correction

The first APK containing protected profile ownership/state (`10878a5c…`) built, aligned and installed but crashed at startup in the existing API36x86_64 emulator. The crash buffer reported SIGSYS/SYS_SECCOMP on syscall6. The pure Go SQLite backend's `modernc.org/libc v1.75.6` directly issues Linux SYS_LSTAT in `libc_linux_amd64.go`; Android rejects this old call. Go's standard Lstat instead uses fstatat. The Android protection was preserved.

The native app now selects maintained `mattn/go-sqlite3 v1.14.52` in Android, using the NDK/Bionic platform interface. Existing other targets retain modernc; the optional `relayloom_sqlite_cgo` tag exercises the C backend on the host. SQLite schema, signed encrypted records, store binding, ownership and private-state format remain shared. Cryptographic operations remain in the existing Go implementation.

The C build must omit external extension loading. Every connection verifies the compiled option; the negative control without `sqlite_omit_load_extension` is refused. The gomobile invocation carries this tag explicitly. Profile ownership supplies the zero-wait DSN option for both drivers and classifies typed busy/locked errors during connection opening as well as BEGIN. The first C test caught the earlier-open boundary; it was corrected without accepting a second owner.

The module version/checksums are pinned and its MIT notice is included in the Android package. The mobile dependency graph was checked: the C driver is present and modernc modules are absent for Android. No vendor-cache patch, security-setting change, root access or service change was used.

## Verified host scope

`docs/evidence/android-sqlite/host` records exact commands, sources, environment overrides and outputs. Build passed5.191s; the complete C-backend selection passed78 Go tests of top-level scope with race in328.663s, plus five unit-skipped helpers executed by process drivers. CLI build36.814s,16 real interoperability cases172.630s and15 real UI cases106.961s passed with unchanged recorded inputs. The negative omitted-build-option control failed as required. This is Linux execution of the C backend, not an Android-device result.

## Actual emulator scope

Corrected AAR9e2fb77f9938721c9df7ef82df19e357ab02ff0c417ec40061a82e0f27004585 and APK136a5103c82c4c87f6865aa2b68daa5eb60796ac4d420aa8f09d5fea5fd4e2a5 built/aligned and were installed in the same AVD. The installed hash matched. Original vault/legacy ciphertext hashes are preserved and the baseline began without a profile binding. APK136a5103c82c4c87f6865aa2b68daa5eb60796ac4d420aa8f09d5fea5fd4e2a5, com AAR9e2fb77f9938721c9df7ef82df19e357ab02ff0c417ec40061a82e0f27004585:82 asserções no mesmo emulador API36x86_64 (38 SAF36.693s,15 prazo134.729s,16 mensagens15.355s,13 relay18.913s) e inspecção cifrada0.768s passaram. Hash instalado e inputs inalterados; cofre/JSON legado preservados; SQLite Android e binding autenticados pelo Node. Root reviu a captura nativa final. Instrumentação removida, forwards vazios, AVD/adb próprios parados, identidade preservada. Evidência em `docs/evidence/android-sqlite/apk-136a5103`.

The first capture review found an unpainted native frame despite a successful DOM assertion. The strengthened relay fixture requires viewport geometry/hit-testing and native screenshot dialog/backdrop pixels. The earlier image fails the pixel control and the final image passes; no app UI change was needed. The final82-assertion run uses the strengthened fixture, and the mismatch remains in visual-review evidence.

The original failed APK/output is retained in project cache; its failure is not rewritten as a pass. Physical Android/ARM64, power-loss, radios, native notification presentation and release signing remain separate unavailable/unverified gates. The C backend does not complete group-authority admission/outbox/API/UI integration. The complete valid earlier-backup replay limitation remains.
