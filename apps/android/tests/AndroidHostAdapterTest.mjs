import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Synthetic host-JS race test: no microphone, Android permission, or physical capture.
let completeCapture, stopped = 0, paused = 0, ended = 0;
class Anchor { click() {} }
const context = vm.createContext({ URL: class LocalURL extends URL {}, Blob, URLSearchParams, EventTarget, Event, DOMException, HTMLAnchorElement: Anchor,
  location: { hash: '#token=synthetic-test-capability', protocol: 'http:', hostname: '127.0.0.1', origin: 'http://127.0.0.1:5000' },
  RelayLoomNative: {}, sessionStorage: { getItem: () => null },
  navigator: { mediaDevices: { getUserMedia: () => new Promise(resolve => { completeCapture = resolve; }) } },
  document: { head: { appendChild() {} }, createElement: () => ({}), addEventListener() {}, querySelectorAll: () => [{ pause() { paused++; } }] },
});
context.window = context;
vm.runInContext(readFileSync(new URL('../app/src/main/assets/android-host.js', import.meta.url), 'utf8'), context);
function stream() { const track = new EventTarget(); track.stop = () => stopped++; track.addEventListener('ended', () => ended++); return { getTracks: () => [track] }; }
const late = context.navigator.mediaDevices.getUserMedia({ audio: true });
context.__relayloomSuspendForDocument(); completeCapture(stream());
await assert.rejects(late, { name: 'AbortError' });
assert.equal(stopped, 1);
await assert.rejects(context.navigator.mediaDevices.getUserMedia({ audio: true }), { name: 'AbortError' });
context.__relayloomResumeFromDocument();
const live = context.navigator.mediaDevices.getUserMedia({ audio: true }); completeCapture(stream()); await live;
context.__relayloomSuspendForDocument();
assert.equal(stopped, 2); assert.equal(ended, 1); assert.equal(paused, 2);
console.log('AndroidHostAdapterTest: 6 synthetic capture/suspension assertions passed (no device media exercised)');
