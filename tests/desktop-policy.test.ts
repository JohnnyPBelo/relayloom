import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowMicrophone,
  allowNavigation,
  allowRequest,
  childEnvironment,
  downloadFilename,
  parseDaemonReady,
  rejectUnsafeRuntime,
} from "../apps/desktop/policy.js";

const origin = "http://127.0.0.1:41000",
  data = "/project/.runtime/desktop/data",
  token = "a".repeat(64);
test("desktop accepts only the owned daemon loopback bootstrap capability", () => {
  const ready = {
    ready: true,
    url: origin + "/#token=" + token,
    tcpPort: 42000,
    data,
  };
  assert.equal(parseDaemonReady(JSON.stringify(ready), data).origin, origin);
  for (const url of [
    "https://127.0.0.1:41000/#token=" + token,
    "http://127.0.0.1.evil:41000/#token=" + token,
    "http://user@127.0.0.1:41000/#token=" + token,
    origin + "/api/state#token=" + token,
    origin + "/#token=short",
    origin + "/#token=" + token + "&extra=true",
  ])
    assert.throws(() =>
      parseDaemonReady(JSON.stringify({ ...ready, url }), data),
    );
  assert.throws(() =>
    parseDaemonReady(JSON.stringify({ ...ready, data: "/other" }), data),
  );
});
test("desktop request policy blocks other hosts, ports, schemes, subframes and WebSockets", () => {
  assert.equal(allowRequest(origin + "/api/state", origin, "xhr"), true);
  assert.equal(allowRequest(origin + "/assets/app.js", origin, "script"), true);
  assert.equal(
    allowRequest("blob:" + origin + "/object", origin, "media"),
    true,
  );
  assert.equal(
    allowRequest("data:image/png;base64,AAAA", origin, "image"),
    true,
  );
  for (const url of [
    "https://example.com/script.js",
    "http://127.0.0.1:41001/api/state",
    "http://127.0.0.1.evil:41000/script.js",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "ws://127.0.0.1:41000",
    "data:text/javascript,alert(1)",
    "blob:https://example.com/object",
  ])
    assert.equal(allowRequest(url, origin, "script"), false, url);
  assert.equal(allowRequest(origin + "/", origin, "subFrame"), false);
  assert.equal(allowRequest(origin + "/", origin, "webSocket"), false);
});
test("desktop navigation stays on its exact local app and rejects insecure runtime overrides", () => {
  assert.equal(allowNavigation(origin + "/", origin), true);
  assert.equal(allowNavigation(origin + "/#home", origin), true);
  for (const url of [
    origin + "/api/export",
    origin + "/?redirect=evil",
    "https://example.com",
    "http://127.0.0.1:41001",
    "file:///tmp/view.html",
  ])
    assert.equal(allowNavigation(url, origin), false);
  for (const flag of [
    "--no-sandbox",
    "--disable-web-security",
    "--remote-debugging-port=9222",
    "--remote-debugging-pipe",
    "--inspect=0.0.0.0:9229",
    "--inspect-brk",
    "--inspect-port=9229",
  ])
    assert.throws(() => rejectUnsafeRuntime(["electron", flag], {}));
  assert.throws(() =>
    rejectUnsafeRuntime([], { ELECTRON_DISABLE_SANDBOX: "1" }),
  );
  rejectUnsafeRuntime([], {});
  assert.deepEqual(
    childEnvironment({
      NODE_OPTIONS: "--require injected.js",
      NODE_PATH: "/foreign",
      ELECTRON_RUN_AS_NODE: "1",
      LANG: "pt_PT.UTF-8",
    }),
    { LANG: "pt_PT.UTF-8" },
  );
});
test("desktop microphone eligibility excludes cameras, remote documents and subframes", () => {
  assert.equal(
    allowMicrophone("media", origin + "/", origin, true, ["audio"]),
    true,
  );
  for (const types of [[], ["video"], ["audio", "video"], ["unknown"]])
    assert.equal(allowMicrophone("media", origin, origin, true, types), false);
  assert.equal(
    allowMicrophone("media", origin, origin, false, ["audio"]),
    false,
  );
  assert.equal(
    allowMicrophone("media", "https://example.com", origin, true, ["audio"]),
    false,
  );
  assert.equal(
    allowMicrophone("display-capture", origin, origin, true, ["audio"]),
    false,
  );
});
test("desktop download defaults cannot contain paths, device names or control bytes", () => {
  assert.equal(downloadFilename("../../vault.json"), "vault.json");
  assert.equal(downloadFilename("..\\..\\vault.json"), "vault.json");
  assert.equal(downloadFilename("clip\0name.webm"), "clip_name.webm");
  for (const name of ["", "..", "CON", "aux.txt", "COM1"])
    assert.equal(downloadFilename(name), "relayloom-export");
});
