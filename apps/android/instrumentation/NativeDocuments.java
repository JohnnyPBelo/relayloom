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
public final class NativeDocuments extends Instrumentation {
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
        for (int i = 0; i < 150; i++) { if (Boolean.TRUE.equals(js("document.body?.innerText.includes(" + JSONObject.quote(text) + ")"))) return; Thread.sleep(100); }
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
    private android.view.accessibility.AccessibilityNodeInfo nativeNode(android.view.accessibility.AccessibilityNodeInfo node, String label) {
        if(node==null)return null;
        if(node.isVisibleToUser() && (label.contentEquals(node.getText()==null?"":node.getText()) || label.contentEquals(node.getContentDescription()==null?"":node.getContentDescription()) || label.equals(node.getViewIdResourceName())))return node;
        for(int i=0;i<node.getChildCount();i++){android.view.accessibility.AccessibilityNodeInfo found=nativeNode(node.getChild(i),label);if(found!=null)return found;}
        return null;
    }
    private android.view.accessibility.AccessibilityNodeInfo nativeAwait(String label) throws Exception {
        for(int i=0;i<100;i++){android.view.accessibility.AccessibilityNodeInfo node=nativeNode(getUiAutomation().getRootInActiveWindow(),label);if(node!=null)return node;Thread.sleep(150);}
        throw new IllegalStateException("System document UI missing: "+label);
    }
    private void tapAt(float x,float y) throws Exception {
        long now=android.os.SystemClock.uptimeMillis();
        android.view.MotionEvent down=android.view.MotionEvent.obtain(now,now,android.view.MotionEvent.ACTION_DOWN,x,y,0),up=android.view.MotionEvent.obtain(now,now+80,android.view.MotionEvent.ACTION_UP,x,y,0);
        down.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);up.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);
        getUiAutomation().injectInputEvent(down,true);getUiAutomation().injectInputEvent(up,true);down.recycle();up.recycle();
    }
    private void nativeTap(String label) throws Exception { nativeTapNode(nativeAwait(label),label); }
    private void nativeRoot(String label) throws Exception {
        android.view.accessibility.AccessibilityNodeInfo drawer=nativeAwait("com.google.android.documentsui:id/roots_list");
        android.view.accessibility.AccessibilityNodeInfo node=nativeNode(drawer,label);
        if(node==null)throw new IllegalStateException("System drawer root missing: "+label);
        nativeTapNode(node,label);
    }
    private void nativeTapNode(android.view.accessibility.AccessibilityNodeInfo node,String label) throws Exception {
        android.view.accessibility.AccessibilityNodeInfo clickable=node;
        while(clickable!=null&&!clickable.isClickable())clickable=clickable.getParent();
        if(clickable!=null)require(clickable.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK),"System document control activated: "+label);
        else {android.graphics.Rect bounds=new android.graphics.Rect();node.getBoundsInScreen(bounds);tapAt(bounds.exactCenterX(),bounds.exactCenterY());}
        Thread.sleep(500);
    }
    private void webTap(String selector) throws Exception {
        js("("+selector+").scrollIntoView({block:'center'})");Thread.sleep(250);
        JSONObject rect=(JSONObject)js("(()=>{const r=("+selector+").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,scale:devicePixelRatio}})()");
        int[] location=new int[2];runOnMainSync(()->web.getLocationOnScreen(location));
        tapAt(location[0]+(float)(rect.getDouble("x")*rect.getDouble("scale")),location[1]+(float)(rect.getDouble("y")*rect.getDouble("scale")));Thread.sleep(300);
    }
    private void appWindow() throws Exception {
        for(int i=0;i<100;i++){android.view.accessibility.AccessibilityNodeInfo root=getUiAutomation().getRootInActiveWindow();if(root!=null&&"org.relayloom.android".contentEquals(root.getPackageName()))return;Thread.sleep(150);}
        throw new IllegalStateException("Application did not return from system picker");
    }
    private void backToApp() throws Exception {
        for(int i=0;i<4;i++) {
            try(android.os.ParcelFileDescriptor command=getUiAutomation().executeShellCommand("input keyevent KEYCODE_BACK")){try(FileInputStream output=new FileInputStream(command.getFileDescriptor())){while(output.read()!=-1){}}}
            Thread.sleep(750);android.view.accessibility.AccessibilityNodeInfo root=getUiAutomation().getRootInActiveWindow();
            if(root!=null&&"org.relayloom.android".contentEquals(root.getPackageName()))return;
        }
        appWindow();
    }
    private void picker(String name) throws Exception {
        webTap("document.querySelector('label.file-picker')");nativeAwait("Show roots");
        nativeTap("Show roots");nativeRoot("RelayLoom test fixtures");phase("fixture-root-chosen",new JSONObject());nativeAwait("saf-import.txt");
        if(nativeNode(getUiAutomation().getRootInActiveWindow(),"List view")!=null)nativeTap("List view");
        if(name!=null) { nativeTap(name); appWindow(); }
    }
    private void removeAttachments() throws Exception {js("Array.from(document.querySelectorAll('.attachment-preview button')).find(b=>b.textContent.trim()==='Remover')?.click()");}
    private void saveDownloads(String name) throws Exception {
        nativeAwait("SAVE");
        nativeTap("Show roots");nativeRoot("Downloads");
        // DocumentsUI uses a standard editable filename; target the EditText by traversal.
        android.view.accessibility.AccessibilityNodeInfo editable=findEditable(getUiAutomation().getRootInActiveWindow());
        if(editable==null)throw new IllegalStateException("Save filename input missing");
        Bundle args=new Bundle();args.putCharSequence(android.view.accessibility.AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,name);
        require(editable.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_SET_TEXT,args),"System filename input accepts requested export name");
        nativeTap("SAVE");appWindow();awaitText("Ficheiro guardado no destino que escolheste.");
    }
    private android.view.accessibility.AccessibilityNodeInfo findEditable(android.view.accessibility.AccessibilityNodeInfo node){if(node==null)return null;if(node.isEditable()&&node.isVisibleToUser())return node;for(int i=0;i<node.getChildCount();i++){android.view.accessibility.AccessibilityNodeInfo found=findEditable(node.getChild(i));if(found!=null)return found;}return null;}
    private void deadlineFlow(JSONObject identity, int http, int tcp, boolean relay) throws Exception {
        String priorCapability=String.valueOf(js("sessionStorage.getItem('relayloom-token')"));
        long began=android.os.SystemClock.elapsedRealtime();picker(null);
        require(portOpen(http)&&portOpen(tcp),"SAF deadline starts with both real listeners live");
        phase("bounded-handoff-waiting",new JSONObject().put("maximumMs",120000));
        while(android.os.SystemClock.elapsedRealtime()-began<126000&&(portOpen(http)||portOpen(tcp)))Thread.sleep(250);
        long elapsed=android.os.SystemClock.elapsedRealtime()-began;
        require(!portOpen(http)&&!portOpen(tcp),"Actual SAF timeout closes HTTP and TCP listeners while picker remains open");
        require(elapsed>=118000&&elapsed<=126000,"Actual handoff closes around its absolute 120-second deadline");
        phase("bounded-handoff-expired",new JSONObject().put("observedMs",elapsed));
        backToApp();web=null;
        for(int i=0;i<150&&web==null;i++){runOnMainSync(()->web=find(activity.getWindow().getDecorView()));if(web==null)Thread.sleep(100);}
        require(web!=null,"Expired picker returns to fresh WebView");unlock(arguments.getString("password"));
        JSONObject resumed=(JSONObject)api("state",null);
        require(identity.getString("id").equals(resumed.getJSONObject("identity").getString("id")),"Identity survives picker timeout and real unlock");
        require(!priorCapability.equals(String.valueOf(js("sessionStorage.getItem('relayloom-token')"))),"Picker timeout rotates the native capability and lease");
        require(resumed.getJSONObject("settings").getBoolean("relay")==relay,"Deadline does not change relay preference");
        int nextHttp=((Number)js("Number(location.port)")).intValue(),nextTcp=resumed.getInt("tcpPort");long home=android.os.SystemClock.elapsedRealtime();
        try(android.os.ParcelFileDescriptor command=getUiAutomation().executeShellCommand("input keyevent KEYCODE_HOME")){try(FileInputStream output=new FileInputStream(command.getFileDescriptor())){while(output.read()!=-1){}}}
        while(android.os.SystemClock.elapsedRealtime()-home<5000&&(portOpen(nextHttp)||portOpen(nextTcp)))Thread.sleep(100);
        long homeElapsed=android.os.SystemClock.elapsedRealtime()-home;
        require(!portOpen(nextHttp)&&!portOpen(nextTcp),"Normal HOME with no pending document closes both listeners immediately");
        resumeActivity();unlock(arguments.getString("password"));
        JSONObject report=new JSONObject().put("kind","ANDROID_REAL_SAF_DEADLINE_INSTRUMENTATION").put("assertions",assertions).put("identityId",identity.getString("id")).put("nonce",arguments.getString("nonce")).put("actualSystemPickerTimeout",true).put("observedHandoffMs",elapsed).put("normalHomeCloseMs",homeElapsed).put("capabilityRotated",true).put("relayPreferenceUnchanged",true).put("physicalDeviceTested",false).put("microphoneCameraAccessed",false);
        try(FileOutputStream out=new FileOutputStream(new File(getTargetContext().getFilesDir(),"android-documents-report.json"))){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}
    }
    @Override public void onStart() {
        new Thread(()->{
            Bundle result=new Bundle();
            try {
                openActivity();unlock(arguments.getString("password"));phase("unlocked",new JSONObject());
                JSONObject state=(JSONObject)api("state",null), identity=state.getJSONObject("identity");
                require("Go".equals(state.getString("nativeRuntime")),"SAF runs against actual Go in APK");
                JSONObject denied=(JSONObject)js("JSON.parse(RelayLoomNative.exportDocument(sessionStorage.getItem('relayloom-token'),'test.txt','text/plain','eA=='))");
                require(!denied.getBoolean("ok"),"Blob export requires a recent native gesture");
                denied=(JSONObject)js("JSON.parse(RelayLoomNative.exportDocument('invalid-capability','test.txt','text/plain','eA=='))");
                require(!denied.getBoolean("ok"),"Blob export rejects missing/incorrect capability");
                JSONObject host=new JSONObject(new String(android.util.Base64.decode(arguments.getString("hostCard"),android.util.Base64.DEFAULT),StandardCharsets.UTF_8));
                api("contact",new JSONObject().put("contact",host));phase("native-port-ready",new JSONObject().put("tcpPort",state.getInt("tcpPort")));
                js("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Nova conversa').click()");awaitText(host.getString("name"));
                js("Array.from(document.querySelectorAll('button.contact-choice')).find(b=>b.textContent.includes("+JSONObject.quote(host.getString("name"))+")).click()");
                awaitCondition("Boolean(document.querySelector('label.file-picker'))","composer file control");
                boolean relay=state.getJSONObject("settings").getBoolean("relay");int tcp=state.getInt("tcpPort");int http=((Number)js("Number(location.port)")).intValue();
                if("deadline".equals(arguments.getString("mode"))) { deadlineFlow(identity,http,tcp,relay);result.putString("stream","Android SAF instrumentation passed "+assertions+" assertions\n");finish(Activity.RESULT_OK,result);return; }
                picker(null);require(portOpen(http)&&portOpen(tcp),"Real listeners remain during explicit SAF handoff");
                backToApp();awaitText("Escolha de documento cancelada");
                require(Boolean.TRUE.equals(js("!document.querySelector('.attachment-preview')")),"Picker cancellation attaches nothing");
                require(((JSONObject)api("state",null)).getJSONObject("settings").getBoolean("relay")==relay,"SAF does not mutate relay preference");
                picker("saf-large.txt");awaitText("Cada anexo pode ter até 2 MB.");require(Boolean.TRUE.equals(js("!document.querySelector('.attachment-preview')")),"Metadata over-limit file rejected on device");
                picker("saf-lying.txt");awaitText("Cada anexo pode ter até 2 MB.");require(Boolean.TRUE.equals(js("!document.querySelector('.attachment-preview')")),"Misleading provider size cannot bypass actual byte limit");
                picker("saf-unknown.txt");awaitCondition("Boolean(document.querySelector('.attachment-preview')?.innerText.includes('saf-unknown.txt'))","unknown-size attachment snapshot read by WebView");
                require(true,"Unknown provider size reads actual bounded bytes into WebView");removeAttachments();
                picker("saf-import.txt");awaitCondition("Boolean(document.querySelector('.attachment-preview')?.innerText.includes('saf-import.txt'))","selected immutable content provider read by WebView");
                require(true,"Real OPEN_DOCUMENT reaches existing composer through snapshot provider");
                String text="Android SAF attachment "+arguments.getString("nonce");
                js("(()=>{const i=document.querySelector('textarea[aria-label=\"Escrever mensagem\"]');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(i,"+JSONObject.quote(text)+");i.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
                Thread.sleep(150);js("document.querySelector('button[aria-label=\"Enviar mensagem\"]').click()");awaitText(text);
                JSONObject object=awaitObject(text);require(!object.getBoolean("public"),"Picked attachment published privately by Android");
                phase("attachment-published",new JSONObject().put("objectId",object.getString("id")).put("authorId",identity.getString("id")));
                awaitCondition("Boolean(document.querySelector('a[download=\"saf-import.txt\"]'))","attachment Blob download action");
                webTap("document.querySelector('a[download=\"saf-import.txt\"]')");saveDownloads("saf-saved-"+arguments.getString("nonce")+".txt");
                require(true,"Attachment Blob saved through real CREATE_DOCUMENT and truthful status");
                android.graphics.Bitmap image=renderedScreenshot();if(image!=null)try(FileOutputStream out=new FileOutputStream(new File(getTargetContext().getFilesDir(),"android-documents.png"))){image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}
                js("document.querySelector('button[aria-label=\"Abrir navegação\"]').click()");
                js("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Definições').click()");awaitText("Exportar cofre de recuperação");
                js("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Exportar cofre de recuperação').click()");awaitText("Frase-passe para esta cópia");
                js("(()=>{const i=document.querySelector('dialog input[name=password]');i.value="+JSONObject.quote(arguments.getString("password"))+";i.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
                webTap("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Descarregar cofre cifrado')");
                nativeAwait("SAVE");backToApp();awaitText("Escolha de documento cancelada");
                require(Boolean.TRUE.equals(js("document.querySelector('#android-document-status')?.textContent.includes('cancelada')")),"Cancelled recovery export shows authoritative cancellation");
                require(Boolean.TRUE.equals(js("Array.from(document.querySelectorAll('.toast')).every(t=>!['Cofre cifrado exportado','Cofre guardado'].some(message=>t.textContent.includes(message)))")),"Cancelled SAF export never displays a completed-save web claim");
                js("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Exportar cofre de recuperação').click()");awaitText("Frase-passe para esta cópia");
                js("(()=>{const i=document.querySelector('dialog input[name=password]');i.value="+JSONObject.quote(arguments.getString("password"))+";i.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
                webTap("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Descarregar cofre cifrado')");
                saveDownloads("saf-recovery-"+arguments.getString("nonce")+".vault.json");require(true,"Existing detached-anchor vault export reaches real CREATE_DOCUMENT");
                JSONObject report=new JSONObject().put("kind","ANDROID_REAL_SAF_INSTRUMENTATION").put("assertions",assertions).put("identityId",identity.getString("id")).put("nonce",arguments.getString("nonce")).put("attachmentId",object.getString("id")).put("actualSystemOpenDocument",true).put("actualSystemCreateDocument",true).put("cancelledVaultDoesNotReportSuccess",true).put("unknownProviderSize",true).put("misleadingProviderSizeRejected",true).put("physicalDeviceTested",false).put("microphoneCameraAccessed",false);
                try(FileOutputStream out=new FileOutputStream(new File(getTargetContext().getFilesDir(),"android-documents-report.json"))){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}
                result.putString("stream","Android SAF instrumentation passed "+assertions+" assertions\n");finish(Activity.RESULT_OK,result);
            } catch(Throwable error) {result.putString("stream","Android SAF instrumentation failed: "+error.getClass().getSimpleName()+": "+error.getMessage()+"\n");finish(Activity.RESULT_CANCELED,result);}
        },"real-saf-test").start();
    }
}
