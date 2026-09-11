package org.relayloom.android;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.json.JSONObject;
import go.Seq;
import mobile.Mobile;

/** Foreground-only native Go runtime. There is no host computer daemon or generic native JS bridge. */
public final class MainActivity extends Activity {
    private static final int MIC_REQUEST = 4101, NOTIFICATION_REQUEST = 4102, PRIVATE_NOTIFICATION = 4103;
    private static final String CHANNEL = "private-messages";
    private static final RuntimeLeaseCoordinator CORE = new RuntimeLeaseCoordinator(new RuntimeLeaseCoordinator.Backend() {
        @Override public String start(String data, String assets) throws Exception { return Mobile.start(data, assets); }
        @Override public void stop() throws Exception { Mobile.stop(); }
    });
    private FrameLayout content;
    private WebView web;
    private volatile OriginPolicy endpoint;
    private volatile boolean foreground = false, destroyed = false;
    private volatile int generation = 0;
    private volatile long coreLease = 0;
    private boolean starting = false;
    private PermissionRequest pendingMicrophone;
    private int microphoneGeneration, notificationGeneration;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state); Seq.setContext(getApplicationContext());
        content = new FrameLayout(this); content.setBackgroundColor(Color.rgb(245, 245, 239));
        content.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars()); view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(content); showStatus("A preparar o teu nó neste dispositivo…", false);
    }
    @Override public void onStart() { super.onStart(); foreground = true; startCore(); }
    @Override public void onStop() {
        foreground = false; generation++; starting = false; endpoint = null;
        if (pendingMicrophone != null) { pendingMicrophone.deny(); pendingMicrophone = null; }
        manager().cancel(PRIVATE_NOTIFICATION);
        // Destroy the renderer as well as stopping Go: onPause alone can leave capture tracks alive.
        disposeWeb();
        long prior = coreLease; coreLease = 0; CORE.stop(prior); Log.i("RelayLoomNative", "core_stop_requested foreground_only=true");
        super.onStop();
    }
    @Override public void onDestroy() {
        destroyed = true; foreground = false; generation++; endpoint = null;
        disposeWeb();
        long prior = coreLease; coreLease = 0; CORE.stop(prior); super.onDestroy();
    }
    private void startCore() {
        if (destroyed || starting || endpoint != null) return;
        starting = true; final int request = ++generation; showStatus("A iniciar a rede neste dispositivo…", false);
        coreLease = CORE.start(() -> {
                File assets = AssetInstaller.install(this), data = new File(getFilesDir(), "core");
                if (!data.isDirectory() && !data.mkdirs()) throw new IllegalStateException("Cannot prepare private core storage");
                return new String[]{data.getAbsolutePath(), assets.getAbsolutePath()};
            }, new RuntimeLeaseCoordinator.Callback() {
            @Override public void ready(long lease, String response) {
              try {
                JSONObject ready = new JSONObject(response);
                String token = ready.getString("token"); OriginPolicy policy = new OriginPolicy(ready.getString("origin"), token);
                int tcpPort = ready.getInt("tcpPort"); if (tcpPort < 1 || tcpPort > 65535) throw new IllegalStateException("Invalid native transport port");
                if (!foreground || destroyed || generation != request || !CORE.isCurrent(lease)) { CORE.stop(lease); return; }
                runOnUiThread(() -> {
                    if (!foreground || destroyed || generation != request || !CORE.isCurrent(lease)) { CORE.stop(lease); return; }
                    starting = false; endpoint = policy; openWeb(policy.origin + "/#token=" + Uri.encode(token));
                    Log.i("RelayLoomNative", "core_started runtime=gomobile-in-process origin=" + policy.origin + " tcpPort=" + tcpPort);
                });
              } catch (Exception error) { CORE.stop(lease); failed(lease, error); }
            }
            @Override public void failed(long lease, Exception error) {
                Log.e("RelayLoomNative", "Native startup failed: " + error.getClass().getSimpleName());
                runOnUiThread(() -> { if (foreground && !destroyed && generation == request) { starting = false; showStatus("Não foi possível iniciar o nó neste dispositivo. Podes tentar novamente.", true); } });
            }
        });
    }
    private void showStatus(String text, boolean retry) {
        content.removeAllViews(); LinearLayout panel = new LinearLayout(this); panel.setOrientation(LinearLayout.VERTICAL); panel.setGravity(Gravity.CENTER); panel.setPadding(32, 32, 32, 32);
        TextView label = new TextView(this); label.setText(text); label.setTextSize(18); label.setTextColor(Color.rgb(38, 59, 52)); label.setGravity(Gravity.CENTER); panel.addView(label);
        if (retry) { Button button = new Button(this); button.setText("Tentar novamente"); button.setOnClickListener(view -> startCore()); panel.addView(button); } else panel.addView(new ProgressBar(this));
        TextView limits = new TextView(this); limits.setText("Rede experimental. A retransmissão pára quando esta aplicação deixa de estar visível."); limits.setTextSize(13); limits.setPadding(0, 28, 0, 0); limits.setGravity(Gravity.CENTER); panel.addView(limits);
        content.addView(panel, new FrameLayout.LayoutParams(-1, -1));
    }
    private void disposeWeb() {
        if (web == null) return;
        content.removeView(web); web.removeJavascriptInterface("RelayLoomNative"); web.stopLoading(); web.onPause(); web.destroy(); web = null;
    }
    @SuppressWarnings("deprecation") private void openWeb(String url) {
        disposeWeb();
        web = new WebView(this); WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setAllowFileAccessFromFileURLs(false); settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW); settings.setJavaScriptCanOpenWindowsAutomatically(false); settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true); settings.setGeolocationEnabled(false); settings.setSaveFormData(false);
        CookieManager.getInstance().setAcceptCookie(false); CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.addJavascriptInterface(new NativeNotifications(), "RelayLoomNative");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                OriginPolicy policy = CORE.isCurrent(coreLease) ? endpoint : null;
                if (policy != null && policy.sameOrigin(request.getUrl().toString())) return false;
                Toast.makeText(MainActivity.this, "Esta aplicação abre apenas a sua rede local.", Toast.LENGTH_SHORT).show(); return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                OriginPolicy policy = CORE.isCurrent(coreLease) ? endpoint : null;
                if (policy != null && policy.resource(request.getUrl().toString())) return null;
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", java.util.Collections.emptyMap(), new ByteArrayInputStream("External resources are disabled".getBytes(StandardCharsets.UTF_8)));
            }
            @Override public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler, android.net.http.SslError error) { handler.cancel(); }
            @Override public void onReceivedHttpAuthRequest(WebView view, android.webkit.HttpAuthHandler handler, String host, String realm) { handler.cancel(); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { runOnUiThread(() -> microphone(request)); }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) { if (pendingMicrophone == request) pendingMicrophone = null; }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, android.os.Message result) { return false; }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback callback) { callback.invoke(origin, false, false); }
        });
        content.removeAllViews(); content.addView(web, new FrameLayout.LayoutParams(-1, -1)); web.onResume(); web.resumeTimers(); web.loadUrl(url);
    }
    private void microphone(PermissionRequest request) {
        OriginPolicy policy = CORE.isCurrent(coreLease) ? endpoint : null;
        if (!foreground || policy == null || !policy.sameOrigin(request.getOrigin().toString()) || request.getResources().length != 1 || !PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(request.getResources()[0]) || pendingMicrophone != null) { request.deny(); return; }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE}); return; }
        pendingMicrophone = request; microphoneGeneration = generation; requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MIC_REQUEST);
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == MIC_REQUEST && pendingMicrophone != null) {
            PermissionRequest request = pendingMicrophone; pendingMicrophone = null;
            OriginPolicy policy = endpoint;
            if (foreground && microphoneGeneration == generation && CORE.isCurrent(coreLease) && policy != null && policy.sameOrigin(request.getOrigin().toString()) && results.length == 1 && results[0] == PackageManager.PERMISSION_GRANTED) request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE}); else request.deny();
        }
        if (code == NOTIFICATION_REQUEST && foreground && notificationGeneration == generation && CORE.isCurrent(coreLease)) completeNotificationPermission();
    }
    private NotificationManager manager() { return (NotificationManager) getSystemService(NOTIFICATION_SERVICE); }
    private boolean owner(String token) { OriginPolicy policy = endpoint; return foreground && !destroyed && CORE.isCurrent(coreLease) && policy != null && policy.capability(token); }
    private String notificationPermissionValue() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return getPreferences(MODE_PRIVATE).getBoolean("notificationsAsked", false) ? "denied" : "default";
        return manager().areNotificationsEnabled() ? "granted" : "denied";
    }
    private void completeNotificationPermission() {
        if (web != null && endpoint != null && foreground) web.evaluateJavascript("window.__relayloomNativePermissionResult && window.__relayloomNativePermissionResult(" + JSONObject.quote(notificationPermissionValue()) + ")", null);
    }
    public final class NativeNotifications {
        @JavascriptInterface public String notificationPermission(String token) { return owner(token) ? notificationPermissionValue() : "denied"; }
        @JavascriptInterface public void requestNotificationPermission(String token) {
            if (!owner(token)) return; final int request = generation;
            runOnUiThread(() -> {
                if (!owner(token) || request != generation) return; notificationGeneration = request;
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) { getPreferences(MODE_PRIVATE).edit().putBoolean("notificationsAsked", true).apply(); requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_REQUEST); }
                else completeNotificationPermission();
            });
        }
        @JavascriptInterface public boolean showPrivateNotification(String token) {
            if (!owner(token) || !"granted".equals(notificationPermissionValue())) return false;
            final int request = generation;
            runOnUiThread(() -> {
                if (!owner(token) || request != generation) return;
                if (Build.VERSION.SDK_INT >= 26) { NotificationChannel channel = new NotificationChannel(CHANNEL, "Mensagens privadas", NotificationManager.IMPORTANCE_LOW); channel.setDescription("Avisos genéricos, sem nomes ou conteúdo de mensagens"); manager().createNotificationChannel(channel); }
                Intent open = new Intent(MainActivity.this, MainActivity.class); open.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                PendingIntent intent = PendingIntent.getActivity(MainActivity.this, PRIVATE_NOTIFICATION, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(MainActivity.this, CHANNEL) : new Notification.Builder(MainActivity.this);
                builder.setSmallIcon(R.drawable.ic_relayloom).setContentTitle("RelayLoom").setContentText("Tens novas mensagens privadas. Abre o RelayLoom para as ler.").setContentIntent(intent).setAutoCancel(true).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE);
                try { manager().notify(PRIVATE_NOTIFICATION, builder.build()); } catch (SecurityException ignored) {}
            }); return true;
        }
        @JavascriptInterface public void closePrivateNotification(String token) { if (owner(token)) manager().cancel(PRIVATE_NOTIFICATION); }
    }
}
