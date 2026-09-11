# Maintained native/mobile core — verified host interoperability

The Node/React application and Electron Linux package remain the tested baseline. A mobile WebView that points to an external daemon would not satisfy PROJECT-BRIEF.md. Nodejs-mobile's observed released Node18 runtime is past upstream EOL; it is not an acceptable shortcut to an encrypted communications product's maintained native runtime.

Go1.26.8 is installed in the project cache. The implemented native core under `native/core` uses maintained standard-library cryptography/networking and `golang.org/x/crypto/scrypt`. `golang.org/x/mobile` exposes the core as an Android AAR; Apple framework generation needs actual Apple tooling. Signing, reader envelopes, chunks, identity vaults and disk storage match the Node reference in bidirectional tests. The canonical codec explicitly covers JavaScript escaping, UTF-16 key order/lone surrogates and number formatting; Go's default JSON encoder alone would not match this contract.

The Android APK process owns its identity, encrypted storage, listeners and relay policy and serves the bundled declarative React renderer. Actual execution is verified in the project's single API36 x86_64 emulator, not a physical device. The current host stops its core when it leaves the foreground. A future Android background-relay mode would need explicit foreground-service consent and normal OS permission/battery behavior. The implemented iOS shell also stops in the background; Apple builds/signing/device tests require actual Apple tools/hardware.

Project-only tooling wrapper: `node scripts/go.mjs <go arguments>` fixes module, build and GOPATH caches under `.cache` and disables automatic toolchain substitution. No provider/authentication/bridge or system-security setting is changed. Native evidence is kept separate from earlier Node/desktop gate results.

## Executed host gates

`node scripts/go.mjs test -race -p=2 ./core` passed11 tests. `node --import tsx --test --test-concurrency=1 tests/native/native-interop.test.ts` passed the Node↔Go generated-vector gate, including1,500 randomized finite-number encodings, Unicode/lone-surrogate cases, identity proofs, vault recovery, private/public bundles, unauthorized-reader and signing-forgery controls, chunk verification and persistent seeding in both directions.

The broader command `node --import tsx --test --test-concurrency=1 tests/native/*.test.ts` passed3/3 on Linux after the final application rebuild: the vector gate plus two real mixed-process transport/application scenarios. Reports are under `docs/evidence/native`; `NATIVE-INTEGRATION.md` describes topology and exact limits. `APPLICATION-REVIEW.md` records the native app's17 normal/race tests after bounded snapshots/cache and mutation-journal corrections. None of these host tests establishes physical radio support, Apple execution, or disaster readiness.
