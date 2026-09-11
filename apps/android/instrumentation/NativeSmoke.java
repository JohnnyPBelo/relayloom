package org.relayloom.android.smoketests;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import java.io.File;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Separate debug-only APK. Runs with the actual target app's Go library and real WebView. */
public final class NativeSmoke extends Instrumentation {
    private Bundle arguments;
    private Activity activity;
    private WebView web;
    private int assertions = 0;
    @Override public void onCreate(Bundle args) { arguments = args; start(); }
    private static WebView find(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) { WebView result = find(((ViewGroup) view).getChildAt(i)); if (result != null) return result; }
        return null;
    }
    private void require(boolean value, String label) { assertions++; if (!value) throw new AssertionError(label); }
    private Object js(String expression) throws Exception {
        final String[] answer = {null}; CountDownLatch latch = new CountDownLatch(1);
        runOnMainSync(() -> web.evaluateJavascript(expression, value -> { answer[0] = value; latch.countDown(); }));
        if (!latch.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("WebView evaluation timed out");
        return new JSONTokener(answer[0]).nextValue();
    }
    private Object async(String expression) throws Exception {
        js("window.__nativeSmokeResult = null; (async()=>{try {window.__nativeSmokeResult={ok:true,value:await (" + expression + ")}} catch(error){window.__nativeSmokeResult={ok:false,error:String(error)}}})()");
        for (int i = 0; i < 100; i++) {
            Object value = js("window.__nativeSmokeResult");
            if (value instanceof JSONObject) { JSONObject result = (JSONObject) value; if (!result.getBoolean("ok")) throw new IllegalStateException(result.getString("error")); return result.get("value"); }
            Thread.sleep(100);
        }
        throw new IllegalStateException("Authenticated local API timed out");
    }
    private Object api(String path, JSONObject body) throws Exception {
        return async("fetch('/api/" + path + "',{method:'" + (body == null ? "GET" : "POST") + "',headers:{Authorization:'Bearer '+sessionStorage.getItem('relayloom-token'),'Content-Type':'application/json'}" + (body == null ? "" : ",body:" + JSONObject.quote(body.toString())) + "}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||r.status);return d})");
    }
    private void awaitText(String text) throws Exception {
        for (int i = 0; i < 150; i++) { if (Boolean.TRUE.equals(js("document.body.innerText.includes(" + JSONObject.quote(text) + ")"))) return; Thread.sleep(100); }
        throw new IllegalStateException("Rendered text missing: " + text);
    }
    private void awaitCondition(String expression, String label) throws Exception {
        for (int i = 0; i < 150; i++) { if (Boolean.TRUE.equals(js(expression))) return; Thread.sleep(100); }
        throw new IllegalStateException("Live UI condition missing: " + label);
    }
    private void openActivity() throws Exception {
        web = null; Intent intent = new Intent(); intent.setClassName("org.relayloom.android", "org.relayloom.android.MainActivity"); intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity = startActivitySync(intent);
        for (int i = 0; i < 200 && web == null; i++) { runOnMainSync(() -> web = find(activity.getWindow().getDecorView())); if (web == null) Thread.sleep(100); }
        require(web != null, "Real target WebView exists");
    }
    private void resumeActivity() throws Exception {
        web = null;
        runOnMainSync(() -> {
            Intent intent = new Intent(); intent.setClassName("org.relayloom.android", "org.relayloom.android.MainActivity");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            getTargetContext().startActivity(intent);
        });
        for (int i = 0; i < 200 && web == null; i++) { runOnMainSync(() -> web = find(activity.getWindow().getDecorView())); if (web == null) Thread.sleep(100); }
        require(web != null, "Existing Activity resumes with a fresh native WebView");
    }
    private void unlock(String password) throws Exception {
        awaitText("Frase-passe");
        js("(()=>{const input=document.querySelector('input[name=password]');input.value=" + JSONObject.quote(password) + ";input.dispatchEvent(new Event('input',{bubbles:true}));input.form.requestSubmit();return true})()");
        for (int i = 0; i < 150; i++) {
            if (Boolean.TRUE.equals(js("Array.from(document.querySelectorAll('main h1')).some(h=>h.textContent.trim()==='As tuas conversas.')"))) return;
            Thread.sleep(100);
        }
        throw new IllegalStateException("Messenger heading did not appear after UI unlock");
    }
    private boolean portOpen(int port) {
        try (Socket socket = new Socket()) { socket.connect(new InetSocketAddress("127.0.0.1", port), 500); return true; } catch (Exception expected) { return false; }
    }
    private void phase(String name, JSONObject details) throws Exception {
        Bundle event = new Bundle(); event.putString("event", new JSONObject().put("phase", name).put("details", details).toString()); sendStatus(1, event);
    }
    private android.graphics.Bitmap renderedScreenshot() throws Exception {
        waitForIdleSync(); CountDownLatch painted = new CountDownLatch(1);
        runOnMainSync(() -> web.postVisualStateCallback(1, new WebView.VisualStateCallback() { @Override public void onComplete(long request) { painted.countDown(); } }));
        if (!painted.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("WebView visual state was not ready for screenshot");
        Thread.sleep(500); return getUiAutomation().takeScreenshot();
    }
    private void captureWebView(String name) throws Exception {
        final Exception[] failed = {null};
        runOnMainSync(() -> {
            try {
                android.graphics.Bitmap bitmap = android.graphics.Bitmap.createBitmap(web.getWidth(), web.getHeight(), android.graphics.Bitmap.Config.ARGB_8888);
                web.draw(new android.graphics.Canvas(bitmap));
                try (FileOutputStream output = new FileOutputStream(new File(getTargetContext().getFilesDir(), name))) { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output); }
            } catch (Exception error) { failed[0] = error; }
        });
        if (failed[0] != null) throw failed[0];
    }
    private JSONObject awaitObject(String text) throws Exception {
        for (int i = 0; i < 200; i++) {
            JSONArray objects = ((JSONObject) api("state", null)).getJSONArray("objects");
            for (int at = 0; at < objects.length(); at++) { JSONObject object = objects.getJSONObject(at); if (text.equals(object.getJSONObject("content").optString("text"))) return object; }
            Thread.sleep(200);
        }
        throw new IllegalStateException("On-device object missing: " + text);
    }
    private void relayFlow(JSONObject identity, JSONObject host, JSONObject reader) throws Exception {
        String nonce = arguments.getString("nonce");
        api("contact", new JSONObject().put("contact", host)); api("contact", new JSONObject().put("contact", reader));
        api("settings", new JSONObject().put("relay", false));
        api("connect", new JSONObject().put("host", "10.0.2.2").put("port", Integer.parseInt(arguments.getString("hostTcpPort"))));
        JSONObject state = (JSONObject) api("state", null);
        phase("relay-paused", new JSONObject().put("identity", identity).put("tcpPort", state.getInt("tcpPort")));
        JSONObject negative = awaitObject("paused-relay-control " + nonce); require(!negative.getBoolean("public"), "Negative-control packet privately reaches Android B");
        phase("negative-received-at-B", new JSONObject().put("id", negative.getString("id")));
        Thread.sleep(6000);
        api("settings", new JSONObject().put("relay", true)); phase("relay-healed", new JSONObject());
        JSONObject positive = awaitObject("relay-attachment-positive " + nonce);
        JSONObject viewed = (JSONObject) api("view", new JSONObject().put("id", positive.getString("id")));
        require(!positive.getBoolean("public"), "Relayed attachment is a private object");
        // API/view verifies/decrypts the real on-device bundle; renderer then fetches full attachment data if needed.
        require(viewed.getJSONObject("content").getJSONArray("attachments").length() == 1, "Android can read received attachment bundle");
        phase("positive-received-at-B", new JSONObject().put("id", positive.getString("id")));
        JSONObject seed = awaitObject("publisher-offline-seed " + nonce);
        api("view", new JSONObject().put("id", seed.getString("id"))); api("action", new JSONObject().put("action", "pin").put("target", seed.getString("id")).put("value", true));
        JSONObject site = null;
        for (int i = 0; i < 150 && site == null; i++) {
            JSONArray objects = ((JSONObject) api("state", null)).getJSONArray("objects");
            for (int at = 0; at < objects.length(); at++) { JSONObject object = objects.getJSONObject(at); if ("site".equals(object.getString("kind")) && host.getString("id").equals(object.getJSONObject("author").getString("id"))) { site = object; break; } }
            if (site == null) Thread.sleep(200);
        }
        require(site != null, "Published site received at Android before author stops");
        api("view", new JSONObject().put("id", site.getString("id"))); api("action", new JSONObject().put("action", "pin").put("target", site.getString("id")).put("value", true));
        phase("seed-cached-at-B", new JSONObject().put("postId", seed.getString("id")).put("siteId", site.getString("id")));
        JSONObject offline = awaitObject("publisher-stopped-reader-seeded " + nonce);
        require(reader.getString("id").equals(offline.getJSONObject("author").getString("id")), "Reader C confirms seed receipt after publisher stop");
        js("document.querySelector('button[aria-label=\"Abrir navegação\"]').click()");
        awaitCondition("Array.from(document.querySelectorAll('nav button')).some(b=>b.textContent.trim()==='A praça'&&b.getClientRects().length>0)", "visible feed navigation");
        js("Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.trim()==='A praça').click()");
        awaitCondition("Boolean(document.querySelector('.social-layout'))", "feed page committed");
        String siteButton = "document.querySelector('button[aria-label=" + JSONObject.quote("Ver página de " + host.getString("name")) + "]')";
        awaitCondition("Boolean(" + siteButton + ")", "cached author profile action");
        js(siteButton + ".scrollIntoView({block:'center'})"); Thread.sleep(200); js(siteButton + ".click()");
        awaitCondition("Boolean(document.querySelector('dialog[open]')?.innerText.includes(" + JSONObject.quote("Native offline page " + nonce) + "))", "published cached site dialog title");
        require(Boolean.TRUE.equals(js("Boolean(document.querySelector('dialog[open]'))")), "Cached site has an open dialog in the live DOM");
        final JSONObject visibility = new JSONObject();
        runOnMainSync(() -> { try { visibility.put("windowFocus", activity.hasWindowFocus()).put("webViewShown", web.isShown()).put("windowVisibility", web.getWindowVisibility()).put("taskId", activity.getTaskId()); web.invalidate(); activity.getWindow().getDecorView().invalidate(); } catch (Exception ignored) {} });
        JSONObject report = new JSONObject().put("kind", "ANDROID_EMULATOR_RELAY_INSTRUMENTATION").put("runtime", "Go inside actual APK process").put("identity", identity).put("negativeControlReceivedAtB", true).put("relayPauseThenHealExecuted", true).put("privateAttachmentReadAtB", true).put("cachedPostId", seed.getString("id")).put("cachedSiteId", site.getString("id")).put("cachedAuthorOfflineSiteRendered", true).put("nativeVisibility", visibility).put("renderedDialogText", js("document.querySelector('dialog[open]').innerText")).put("assertions", assertions).put("physicalDeviceTested", false).put("microphoneCameraAccessed", false);
        try (FileOutputStream output = new FileOutputStream(new File(getTargetContext().getFilesDir(), "android-relay-report.json"))) { output.write(report.toString(2).getBytes(StandardCharsets.UTF_8)); }
        android.graphics.Bitmap image = renderedScreenshot(); if (image != null) try (FileOutputStream output = new FileOutputStream(new File(getTargetContext().getFilesDir(), "android-offline-site.png"))) { image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output); }
        captureWebView("android-offline-site-webview.png");
        phase("author-offline-site-rendered", new JSONObject());
    }
    @Override public void onStart() {
        new Thread(() -> {
            JSONObject report = new JSONObject(); Bundle result = new Bundle();
            try {
                openActivity();
                awaitText("Frase-passe");
                JSONObject before = (JSONObject) api("state", null);
                require("Go".equals(before.optString("nativeRuntime")), "The on-device state is served by Go");
                require(before.getBoolean("initialized"), "UIAutomator previously created persistent Android identity");
                String password = arguments.getString("password", "relayloom android test passphrase");
                // Actual UI form interaction and React event path, not an API unlock substitute.
                unlock(password);
                JSONObject state = (JSONObject) api("state", null), identity = state.getJSONObject("identity");
                require("Go".equals(state.getString("nativeRuntime")) && !state.getBoolean("locked"), "Persistent vault unlocked through real web UI");
                int rejected = ((Number) async("fetch('/api/state').then(r=>r.status)")).intValue(); require(rejected == 401, "Local API denies missing capability");
                JSONObject host = new JSONObject(new String(android.util.Base64.decode(arguments.getString("hostCard"), android.util.Base64.DEFAULT), StandardCharsets.UTF_8));
                if ("relay".equals(arguments.getString("mode"))) {
                    JSONObject reader = new JSONObject(new String(android.util.Base64.decode(arguments.getString("readerCard"), android.util.Base64.DEFAULT), StandardCharsets.UTF_8));
                    relayFlow(identity, host, reader); result.putString("stream", "Android relay instrumentation passed " + assertions + " assertions\n"); finish(Activity.RESULT_OK, result); return;
                }
                api("contact", new JSONObject().put("contact", host));
                api("connect", new JSONObject().put("host", "10.0.2.2").put("port", Integer.parseInt(arguments.getString("hostTcpPort"))));
                // Navigate and send using React's real conversation/composer UI.
                js("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Nova conversa').click()"); awaitText(host.getString("name"));
                js("Array.from(document.querySelectorAll('button.contact-choice')).find(b=>b.textContent.includes(" + JSONObject.quote(host.getString("name")) + ")).click()");
                String outgoing = "Android native encrypted packet " + arguments.getString("nonce");
                js("(()=>{const input=document.querySelector('textarea[aria-label=\"Escrever mensagem\"]');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(input," + JSONObject.quote(outgoing) + ");input.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
                Thread.sleep(100); js("document.querySelector('button[aria-label=\"Enviar mensagem\"]').click()"); awaitText(outgoing);
                String incoming = "Host reply to actual Android core " + arguments.getString("nonce");
                awaitText(incoming);
                state = (JSONObject) api("state", null); JSONArray objects = state.getJSONArray("objects");
                boolean found = false; String receivedId = null;
                for (int i = 0; i < objects.length(); i++) { JSONObject object = objects.getJSONObject(i); if (incoming.equals(object.getJSONObject("content").optString("text"))) { require(!object.getBoolean("public"), "Incoming peer message remains private"); require(object.getJSONObject("author").getString("id").equals(host.getString("id")), "Incoming author matches real host peer"); receivedId = object.getString("id"); found = true; } }
                require(found, "Incoming authenticated peer object present in on-device store");
                File core = new File(getTargetContext().getFilesDir(), "core"); require(core.isDirectory() && core.list().length > 0, "On-device persistent core files exist");
                File stored = new File(core, "store/objects/" + receivedId + ".json"); require(stored.isFile() && stored.length() < 6 * 1024 * 1024, "Encrypted received bundle persisted on device");
                ByteArrayOutputStream storedBytes = new ByteArrayOutputStream();
                try (FileInputStream input = new FileInputStream(stored)) { byte[] buffer = new byte[16384]; int count; while ((count = input.read(buffer)) != -1) storedBytes.write(buffer, 0, count); }
                String storedJson = new String(storedBytes.toByteArray(), StandardCharsets.UTF_8); JSONObject storedBundle = new JSONObject(storedJson);
                require(!storedJson.contains(incoming) && !storedJson.contains(outgoing), "Message plaintext is absent from stored bundle");
                require(storedBundle.getJSONObject("manifest").isNull("publicKey") && storedBundle.getJSONObject("chunks").length() > 0, "Stored private bundle retains encrypted chunks and private read envelopes");
                int oldHttp = new java.net.URI((String) js("location.origin")).getPort(), oldTcp = state.getInt("tcpPort");
                runOnMainSync(() -> activity.moveTaskToBack(true));
                for (int i = 0; i < 50 && (portOpen(oldHttp) || portOpen(oldTcp)); i++) Thread.sleep(100);
                require(!portOpen(oldHttp) && !portOpen(oldTcp), "Background Activity closes actual local API and peer listeners");
                resumeActivity(); unlock(password); state = (JSONObject) api("state", null);
                require(state.getJSONObject("identity").getString("id").equals(identity.getString("id")), "Identity survives actual Activity background/resume");
                objects = state.getJSONArray("objects"); found = false;
                for (int i = 0; i < objects.length(); i++) if (incoming.equals(objects.getJSONObject(i).getJSONObject("content").optString("text"))) found = true;
                require(found, "Private message survives native core stop/restart");
                js("Array.from(document.querySelectorAll('button.conversation')).find(b=>b.textContent.includes(" + JSONObject.quote(host.getString("name")) + ")).click()"); awaitText(incoming);
                report.put("kind", "ANDROID_EMULATOR_INSTRUMENTATION").put("runtime", "Go inside actual APK process").put("nativeRuntime", state.getString("nativeRuntime")).put("identity", identity).put("tcpPort", state.getInt("tcpPort")).put("uiUnlockAndComposerExecuted", true).put("missingCapabilityStatus", rejected).put("privatePeerExchange", true).put("encryptedDeviceBundleChecked", true).put("actualBackgroundListenersClosed", true).put("actualResumeIdentityAndMessageRecovered", true).put("assertions", assertions).put("physicalDeviceTested", false).put("microphoneCameraAccessed", false).put("notificationDisplayTested", false);
                File evidence = new File(getTargetContext().getFilesDir(), "android-instrumentation-report.json");
                try (FileOutputStream stream = new FileOutputStream(evidence)) { stream.write(report.toString(2).getBytes(StandardCharsets.UTF_8)); }
                android.graphics.Bitmap screenshot = renderedScreenshot();
                if (screenshot != null) try (FileOutputStream stream = new FileOutputStream(new File(getTargetContext().getFilesDir(), "android-instrumentation-messenger.png"))) { screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, stream); }
                result.putString("stream", "Android native instrumentation passed " + assertions + " assertions\n"); finish(Activity.RESULT_OK, result);
            } catch (Throwable error) {
                result.putString("stream", "Android native instrumentation failed: " + error.toString() + "\n"); finish(Activity.RESULT_CANCELED, result);
            }
        }, "relayloom-native-instrumentation").start();
    }
}
