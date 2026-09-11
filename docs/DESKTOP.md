# Desktop shell

RelayLoom now has an Electron shell around the existing application. This is experimental software, not validated emergency infrastructure. The shell is a real native process: it starts the existing node daemon in a separate Electron utility process and renders the existing web interface through that daemon's authenticated loopback API.

## Run and package

The root project supplies `electron@44.3.0`, `electron-builder@26.15.3`, and `esbuild@0.28.2` as development dependencies. No globally installed Node runtime is required by the packaged application. Packaging includes the daemon and the installed serialport dependency tree, including its native N-API prebuilds and license files.

```sh
npm run build
node scripts/desktop-build.mjs
node scripts/desktop-run.mjs
```

On the current Linux Wayland session, Electron's default display startup stalled before loading the application. The supported X11 backend worked with the sandbox enabled:

```sh
node scripts/desktop-run.mjs --x11
node scripts/desktop-run.mjs --smoke --x11
```

`--smoke` uses a fresh test profile and exits after verification. It has a 45-second outer timeout. It writes `.cache/desktop/smoke.json` and `.cache/desktop/smoke.png`; neither contains the API token. Ordinary runs preserve the identity and cache in `.runtime/desktop/profile`.

```sh
# Host-native unpacked package; verified on Linux x64.
node scripts/desktop-package.mjs --linux --x64 --dir
node scripts/desktop-packaged-smoke.mjs

# Configured installer targets; run on appropriate native CI/build hosts.
node scripts/desktop-package.mjs --linux --x64
node scripts/desktop-package.mjs --win --x64
node scripts/desktop-package.mjs --mac --arm64
```

Staged files are in `dist/desktop`; packages are in `dist/desktop-installers`. A packaging target is not evidence that an installer or device works. Windows NSIS and macOS DMG targets have not been executed here. Apple signing/notarization, microphone entitlement validation, Windows signing and physical-device testing remain required before distributing trusted releases. No automatic updater or publication service is configured.

## Security and lifecycle

- Renderer sandbox and context isolation are enabled; renderer Node integration, webviews and developer tools are disabled. There is no preload or privileged renderer IPC interface.
- The renderer receives a fresh capability token from its own child process through a bounded startup channel. The existing API still requires that token and checks its loopback Host/Origin. The HTTP and TCP listeners bind to `127.0.0.1`; the shell does not expose a control endpoint on other interfaces.
- A fresh in-memory browser session allows only the exact daemon origin. Remote requests, WebSockets, subframe requests, external navigation and popups are denied. The daemon's existing content security policy also applies.
- Identity-vault export and attachment download use a native save dialog only for a blob created by the trusted main origin. Remote download URLs are denied. The default export location is inside the profile; saving elsewhere requires the person's explicit file selection.
- Microphone requests require the trusted main frame, audio-only scope, an active user gesture and native permission confirmation. The grant lasts for the current browser session. Camera, display capture and other device permissions remain denied. Physical microphone capture and platform-specific OS permission dialogs have not been tested here.
- Copying text permits only the trusted main frame's clipboard-write request with an active user gesture. Clipboard reading remains denied; the smoke does not overwrite the user's clipboard.
- Closing the final window requests graceful daemon shutdown. After five seconds, the shell also asks Electron to terminate its owned utility process; this is a graceful signal on POSIX. Normal shutdown is verified. An unresponsive child's termination is not verified, and the smoke report fails if the child remains after the bounded wait. Startup failure follows the same cleanup path. No background-relay mode is configured.
- Launchers reject sandbox-disabling overrides. The shell rejects Node and Chromium inspector flags. Packaged executable fuses disable RunAsNode, NodeOptions and Node inspector arguments, restrict application loading to ASAR, and remove extra file-protocol privileges. These are changes to this application's own packaged executable, not OS security settings. Node preload/injection environment variables are removed from the child environment.

During development, application profile/session data, temporary files, logs, crash paths, packaging caches and exports default to this repository's `.runtime` and `.cache` directories. A packaged application uses the normal per-user application profile directory. Chromium still consults platform display/font/certificate services; its ordinary system certificate access is separate from RelayLoom's application storage. The Linux smoke emitted a non-fatal NSS initialization warning and an EGL timing warning; the authenticated local application still passed. No certificate or OS configuration changes were made.

## Evidence from this host

On Linux x64, Electron 44.3.0 / Chromium 152.0.7977.78 / Node 24.20.0 completed the real native smoke run with the X11 display backend and sandbox enabled. The test verified the rendered identity-creation interface, no renderer `require`/`process`, a separate daemon process, real loopback TCP listener, HTTP 401 without the token, HTTP 200 with the token, a blocked external fetch, a screenshot, and clean daemon shutdown. Electron's `ProcessMetric.sandboxed` field is unavailable on Linux, so the report distinguishes requested sandbox settings from an unavailable OS-level metric.

`npm exec tsx -- --test tests/desktop-policy.test.ts` passes five tests for bootstrap validation, exact-origin URL restrictions, unsafe runtime flags, narrow microphone eligibility and safe export filenames without importing Electron. `node scripts/desktop-build.mjs` bundled the real daemon and UI. `node scripts/desktop-package.mjs --linux --x64 --dir` produced the Linux x64 unpacked package. `node scripts/desktop-packaged-smoke.mjs` executed that packaged binary with sandbox enabled, verified the actual bundled daemon and authenticated API, read back the hardened executable fuse bits, and verified graceful parent/daemon shutdown. Its report is `.cache/desktop/packaged-smoke.json`; the verifier uses the `@electron/fuses` library installed with electron-builder. Installer flows, save dialog interaction, clipboard interaction, microphone hardware and Windows/macOS execution remain unverified. The serial adapter is included; this does not establish physical radio compatibility.
