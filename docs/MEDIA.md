# Local media attachments and voice capture

`apps/web/src/media.tsx` exports `VoiceRecorder`. Its styles are isolated in `apps/web/src/media.css`; the component imports that stylesheet.

```tsx
<VoiceRecorder
  key={selection}
  disabled={busy || offline || attachments.length >= 4}
  onAttachment={attachment => {
    // Append to the current conversation's draft using the parent's state model.
  }}
/>
```

The parent owns conversation drafts, the current four-attachment cap, encryption, and publication. Key the component by the conversation/contact identity so a recipient change unmounts it and cancels any recording. The callback receives `{ name, mime, data }`, where `data` is base64 local audio; append it synchronously to the correct local draft, or reject with a readable error. The component never publishes or uploads anything. The normal Send action remains necessary.

Optional `maxBytes` and `maxDurationSeconds` props can lower the default limits, never raise them above 2,000,000 bytes and 120 seconds.

## Behavior

- Microphone access is requested only after the explicit **Gravar mensagem de voz** button is activated. No camera is requested.
- The browser permission request has a Cancel action. If permission resolves after cancellation or unmount, the late stream's tracks are stopped and no attachment is created.
- Recording shows a visible duration and **Parar e anexar** / **Cancelar gravação** controls. The duration does not produce a spoken announcement every second; phase/status changes use a polite live region, while failures use an alert.
- Stop releases microphone tracks immediately, collects the recorder's final chunk, verifies the complete byte size, and creates a local attachment. Cancel discards the chunks. Unmount, device loss, recording failure, and permission failures also release tracks.
- The duration cap stops recording automatically and offers the resulting local attachment. An oversized result is discarded completely, including an oversized final chunk; cutting arbitrary encoded audio bytes could produce a corrupt recording.
- Recording requests 64 kbit/s audio and short periodic chunks. These are browser hints, not guarantees. The complete Blob is checked against the hard cap before the callback.
- Codec selection uses the browser's `MediaRecorder.isTypeSupported`. Supported outputs are Opus/WebM, Opus/Ogg, or MP4 audio. Codec parameters are removed from the attachment MIME label so the existing audio attachment renderer recognizes `audio/webm`, `audio/ogg`, or `audio/mp4`; encoded bytes are preserved.
- An insecure context, absent browser capture API, unsupported codec, denied permission, missing microphone, or busy device produces a clear explanation and keeps generic file attachment available.
- This component does not promise recording on every browser or platform. Background tab throttling can delay duration timers; the complete byte cap still applies. Native capture/device behavior requires separate platform testing.

## Synthetic test boundary

An initial run using native `getUserMedia`, Chromium's `--use-fake-device-for-media-stream`, and microphone permission limited to the temporary test origin failed with `NotSupportedError: Not supported`. That path has **not** passed in this installed browser.

`tests/e2e/media.spec.ts` therefore explicitly substitutes a controlled `getUserMedia` test function that returns a generated Web Audio MediaStream. Encoding still uses the real browser MediaRecorder. The isolated Chromium browser retains the fake-device flag as defense in depth and its sandbox remains enabled; the tests do not invoke the native microphone API, request a physical microphone/camera, or change operating-system/browser security settings. The generated oscillator is connected only to the test stream, never to speaker output.

Fixtures are generated locally: a 64×64 canvas PNG, a short PCM sine-wave WAV, a canvas-capture WebM, and voice encoded by the actual browser MediaRecorder from the controlled Web Audio stream. Two real local peer nodes exchange these four attachments through the application's normal draft/encrypt/publish path. The receiver checks decoded media metadata and attachment byte equality where fixed fixture bytes exist.

Additional controlled fixtures inject a denied permission, a missing MediaRecorder API, late permission resolution, a recorder error, and an oversized Blob event. A virtual browser clock checks the 120-second stop rule; this is explicitly **not** a two-minute hardware recording. The tests check that capture starts only after the record button, that drafts are not published automatically, and that cancellation/unmount/failure end all tracked synthetic microphone tracks. A scoped axe check and a 390-pixel screenshot cover the active recorder panel.

Run after root integration and a successful web build:

```sh
node scripts/e2e.mjs tests/e2e/media.spec.ts --reporter=line --output=.cache/media-e2e
```

The isolated output directory contains screenshots and synthetic evidence JSON. This command preserves the main end-to-end JSON report.

## Recorded verification

On 2026-09-11, the command above passed **3/3 tests in 18.6 seconds**, with no skips, against the root-integrated `index-CbDUvTYp.js` build. The root had also fixed the generic file-input handler to snapshot the live FileList before asynchronous reads; the previous implementation lost the second and third selected files when clearing the input.

The passing run exchanged PNG, WAV, WebM video, and WebM voice between two real local peer nodes. The receiver's complete attachment objects exactly matched the sender's, and the browser loaded image dimensions and audio/video metadata. The recorded voice attachment in this run was 16,781 bytes. It remained a local draft until the explicit Send action.

The active recorder's scoped axe check found zero WCAG A/AA violations, and its 390-pixel layout fit the viewport. The screenshot was also visually reviewed. Cancellation, unmount, delayed permission resolution, injected recorder failure, an injected 2,000,001-byte Blob, and a virtual 120-second duration stop all released tracked synthetic capture tracks.

Actual artifacts:

- `.cache/media-e2e/media-synthetic-image-audi-dc2aa-voice-arrive-at-a-real-peer/synthetic-voice-mobile.png`
- `.cache/media-e2e/media-synthetic-image-audi-dc2aa-voice-arrive-at-a-real-peer/synthetic-media-evidence.json`
- `.cache/media-e2e/media-late-permission-reco-1be5f-ap-release-synthetic-tracks/synthetic-limits-evidence.json`

The TypeScript check also passed during integration. Native `getUserMedia` capture, physical microphone behavior, actual two-minute capture, screen-reader operation, and macOS/iOS/Android device behavior were not validated by these passing synthetic tests. The native fake-device attempt's `NotSupportedError` remains an explicit limitation.
