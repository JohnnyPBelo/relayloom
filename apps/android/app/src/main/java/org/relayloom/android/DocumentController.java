package org.relayloom.android;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.Toast;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;

/** Exact user-selected SAF grants, immutable bounded imports and one bounded Blob export. */
final class DocumentController {
    interface Host {
        long lease(); int generation(); boolean current(); boolean foreground(); boolean capability(String value);
        WebView web(); void handoffEndedWhileBackground(); void handoffExpired();
    }
    private static final AtomicInteger NEXT_REQUEST = new AtomicInteger(4200);
    private final Activity activity;
    private final Host host;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final DocumentSession sessions = new DocumentSession();
    private volatile Work work;
    private Toast activeToast;
    private volatile long lastGesture = Long.MIN_VALUE, consumedGesture = Long.MIN_VALUE;
    private static final class Work {
        final DocumentSession.Ticket ticket;
        final int requestCode;
        final CancellationSignal cancellation = new CancellationSignal();
        ValueCallback<Uri[]> callback;
        byte[] bytes;
        volatile boolean writing;
        String name, mime;
        volatile InputStream input;
        volatile ParcelFileDescriptor output;
        Future<?> job;
        Runnable deadlineCheck;
        Work(DocumentSession.Ticket ticket) { this.ticket = ticket; this.requestCode = NEXT_REQUEST.incrementAndGet(); }
    }
    DocumentController(Activity activity, Host host) { this.activity = activity; this.host = host; }
    void gesture() { lastGesture = SystemClock.elapsedRealtime(); }
    boolean retaining() { revalidate(); return host.current() && sessions.retain(host.lease(), host.generation(), SystemClock.elapsedRealtime()); }
    void revalidate() {
        Work item = work; if (item == null) return;
        // Check ownership before expiry: an old Activity must never restart a replacement lease.
        if (!host.current() || !sessions.owns(item.ticket, host.lease(), host.generation())) finish(item, null, "cancelled", "Escolha cancelada porque a sessão mudou.");
        else if (SystemClock.elapsedRealtime() >= item.ticket.deadline) finish(item, null, "expired", "A escolha de documento expirou após dois minutos. Tenta novamente.");
    }
    private boolean valid(Work item) { return item != null && work == item && host.current() && sessions.valid(item.ticket, host.lease(), host.generation(), SystemClock.elapsedRealtime()); }
    private Work begin(DocumentSession.Kind kind) {
        if (!host.foreground() || !host.current()) return null;
        DocumentSession.Ticket ticket = sessions.begin(host.lease(), host.generation(), kind, SystemClock.elapsedRealtime());
        if (ticket == null) return null;
        Work item = new Work(ticket); work = item;
        if (item.requestCode > 65530) { sessions.finish(ticket); work = null; return null; }
        item.deadlineCheck = new Runnable() { @Override public void run() {
            if (work != item) return;
            revalidate();
            if (work == item) main.postDelayed(this, sessions.nextCheckDelay(item.ticket, host.lease(), host.generation(), SystemClock.elapsedRealtime()));
        }};
        // Handler waits use uptime; frequent checks compare the unchanged elapsed-time deadline
        // after OS execution resumes. No wake lock/alarm and no deadline renewal.
        main.postDelayed(item.deadlineCheck, sessions.nextCheckDelay(item.ticket, host.lease(), host.generation(), SystemClock.elapsedRealtime()));
        return item;
    }
    private boolean recentGesture() {
        long now = SystemClock.elapsedRealtime(), gesture = lastGesture;
        return gesture != consumedGesture && now - gesture >= 0 && now - gesture <= 15_000;
    }
    private void launch(Work item, Intent intent) {
        WebView view = host.web();
        if (!valid(item) || !host.foreground() || view == null) { finish(item, null, "cancelled", "Escolha cancelada porque a sessão mudou."); return; }
        // Stop capture synchronously in the renderer before launching the system Activity.
        view.evaluateJavascript("(()=>{if(typeof window.__relayloomSuspendForDocument!=='function')return false;window.__relayloomSuspendForDocument();return true})()", suspended -> {
            if (!"true".equals(suspended)) { finish(item, null, "error", "Não foi possível suspender a captura antes de abrir o documento."); return; }
            if (!valid(item) || !host.foreground()) { finish(item, null, "cancelled", "Escolha cancelada porque a sessão mudou."); return; }
            try { item.ticket.launched = true; activity.startActivityForResult(intent, item.requestCode); }
            catch (Exception error) { finish(item, null, "error", "Não foi possível abrir o selector de documentos deste dispositivo."); }
        });
    }
    boolean choose(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (!recentGesture()) { callback.onReceiveValue(null); message("Activa a escolha a partir do botão de anexar ficheiro."); return true; }
        if (params.isCaptureEnabled() || params.getMode() != WebChromeClient.FileChooserParams.MODE_OPEN && params.getMode() != WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
            callback.onReceiveValue(null); message("A captura directa não está disponível aqui. Escolhe um ficheiro já guardado."); return true;
        }
        Work item = begin(DocumentSession.Kind.PICK);
        if (item == null) { callback.onReceiveValue(null); message("Conclui ou cancela a escolha de documento em curso."); return true; }
        consumedGesture = lastGesture; item.callback = callback;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, DocumentPolicy.TYPES.toArray(new String[0]));
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        launch(item, intent);
        return true;
    }
    String exportBlob(String capability, String requestedName, String requestedMime, String encoded) {
        try {
            long gesture = lastGesture;
            if (!host.capability(capability) || !recentGesture()) return response(false, null, "Activa a transferência a partir do respectivo botão na aplicação.");
            String name = DocumentPolicy.name(requestedName), mime = DocumentPolicy.mime(requestedMime);
            int limit = DocumentPolicy.exportLimit(name, mime);
            if (encoded == null || encoded.length() > ((limit + 2) / 3) * 4 || !encoded.matches("[A-Za-z0-9+/]*={0,2}")) return response(false, null, "O ficheiro excede o limite permitido ou tem codificação inválida.");
            byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
            if (bytes.length > limit || !Base64.encodeToString(bytes, Base64.NO_WRAP).equals(encoded)) { Arrays.fill(bytes, (byte) 0); return response(false, null, "O ficheiro excede o limite permitido ou tem codificação inválida."); }
            consumedGesture = gesture;
            Work item = begin(DocumentSession.Kind.EXPORT);
            if (item == null) { Arrays.fill(bytes, (byte) 0); return response(false, null, "Conclui ou cancela a escolha de documento em curso."); }
            item.bytes = bytes; item.name = name; item.mime = mime;
            main.post(() -> {
                if (!valid(item) || !host.foreground()) { finish(item, null, "cancelled", "Transferência cancelada porque a sessão mudou."); return; }
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE, name);
                intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                launch(item, intent);
            });
            return response(true, String.valueOf(item.ticket.id), null);
        } catch (IllegalArgumentException error) { return response(false, null, error.getMessage()); }
        catch (Exception error) { return response(false, null, "Não foi possível preparar o documento para guardar."); }
    }
    boolean result(int request, int result, Intent data) {
        if (request <= 4200 || request > 65530) return false;
        Work item = work;
        if (item == null || item.requestCode != request) { message("A escolha já terminou ou expirou. Tenta novamente."); return true; }
        revalidate(); if (work != item) return true;
        if (!valid(item)) { finish(item, null, "cancelled", "Escolha cancelada porque a sessão mudou."); return true; }
        if (result != Activity.RESULT_OK || data == null) { finish(item, null, "cancelled", "Escolha de documento cancelada. Nada foi guardado ou anexado."); return true; }
        if (item.ticket.kind == DocumentSession.Kind.EXPORT) {
            Uri uri = data.getData();
            if (!contentUri(uri)) { finish(item, null, "error", "O destino não concedeu um documento válido."); return true; }
            item.job = io.submit(() -> writeExport(item, uri)); return true;
        }
        LinkedHashSet<Uri> selected = new LinkedHashSet<>(); ClipData clip = data.getClipData();
        if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) selected.add(clip.getItemAt(i).getUri()); else selected.add(data.getData());
        try { DocumentPolicy.selectionCount(selected.size()); for (Uri uri : selected) if (!contentUri(uri)) throw new IllegalArgumentException("O selector não concedeu um documento válido."); }
        catch (IllegalArgumentException error) { finish(item, null, "error", error.getMessage()); return true; }
        item.job = io.submit(() -> importFiles(item, new ArrayList<>(selected))); return true;
    }
    private boolean contentUri(Uri uri) { return uri != null && "content".equals(uri.getScheme()) && uri.getAuthority() != null && !uri.getAuthority().isEmpty(); }
    private void importFiles(Work item, ArrayList<Uri> selected) {
        ArrayList<File> created = new ArrayList<>(); ArrayList<String> names = new ArrayList<>(), types = new ArrayList<>();
        try {
            File directory = new File(activity.getCacheDir(), "selected-documents"); if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("cache");
            for (Uri source : selected) {
                if (!valid(item)) throw new IllegalStateException("expired");
                String name = "documento", mime = DocumentPolicy.mime(activity.getContentResolver().getType(source));
                try (Cursor cursor = activity.getContentResolver().query(source, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null, item.cancellation)) {
                    if (cursor != null && cursor.moveToFirst()) {
                        int at = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME); if (at >= 0 && !cursor.isNull(at)) name = cursor.getString(at);
                        at = cursor.getColumnIndex(OpenableColumns.SIZE); if (at >= 0 && !cursor.isNull(at) && cursor.getLong(at) > DocumentPolicy.MAX_FILE_BYTES) throw new IllegalArgumentException("Cada anexo pode ter até 2 MB.");
                    }
                }
                name = DocumentPolicy.name(name); byte[] bytes;
                try (AssetFileDescriptor descriptor = activity.getContentResolver().openAssetFileDescriptor(source, "r", item.cancellation)) {
                    if (descriptor == null) throw new IllegalStateException("grant");
                    try (InputStream input = descriptor.createInputStream()) { item.input = input; bytes = DocumentPolicy.readBounded(input, DocumentPolicy.MAX_FILE_BYTES); }
                    finally { item.input = null; }
                }
                if (!valid(item)) { Arrays.fill(bytes, (byte) 0); throw new IllegalStateException("expired"); }
                File snapshot = File.createTempFile("selected-", ".bin", directory); created.add(snapshot);
                try (FileOutputStream output = new FileOutputStream(snapshot)) { output.write(bytes); }
                finally { Arrays.fill(bytes, (byte) 0); }
                names.add(name); types.add(mime);
            }
            main.post(() -> {
                revalidate();
                if (!valid(item)) { for (File file : created) file.delete(); finish(item, null, "cancelled", "Escolha cancelada porque a sessão mudou."); return; }
                // Register on the Activity thread only after rechecking its lease. A stale worker
                // cannot register files after destruction or clear another operation's snapshots.
                SelectedDocumentProvider.replaceCurrent(); ArrayList<Uri> results = new ArrayList<>();
                for (int i = 0; i < created.size(); i++) results.add(SelectedDocumentProvider.add(this, created.get(i), names.get(i), types.get(i)));
                finish(item, results.toArray(new Uri[0]), "selected", "Ficheiros seleccionados. Conclui a mensagem na aplicação.");
            });
        } catch (Exception error) {
            for (File file : created) file.delete();
            main.post(() -> finish(item, null, "error", error instanceof IllegalArgumentException ? error.getMessage() : "Não foi possível ler o documento autorizado. Nenhum ficheiro foi anexado."));
        }
    }
    private void writeExport(Work item, Uri target) {
        byte[] payload;
        // Transfer ownership to this worker. Cancellation closes its descriptor immediately,
        // but only this worker wipes the buffer once the write has actually stopped.
        synchronized (item) { payload = item.bytes; item.bytes = null; }
        try {
            if (!valid(item)) throw new IllegalStateException("expired");
            try (ParcelFileDescriptor descriptor = activity.getContentResolver().openFileDescriptor(target, "wt", item.cancellation)) {
                if (descriptor == null) throw new IllegalStateException("grant"); item.output = descriptor;
                try (OutputStream output = new ParcelFileDescriptor.AutoCloseOutputStream(descriptor)) {
                    if (!valid(item) || payload == null) throw new IllegalStateException("expired"); item.writing = true;
                    for (int at = 0; at < payload.length; at += 16384) {
                        if (!valid(item)) throw new IllegalStateException("expired");
                        output.write(payload, at, Math.min(16384, payload.length - at));
                    }
                    output.flush();
                } finally { item.output = null; }
            }
            main.post(() -> {
                revalidate();
                if (valid(item)) finish(item, null, "saved", "Ficheiro guardado no destino que escolheste.");
                else finish(item, null, "cancelled", "A sessão mudou durante a gravação. O destino pode conter um ficheiro incompleto.");
            });
        } catch (Exception error) { main.post(() -> finish(item, null, "error", "Não foi possível guardar o documento. O destino pode conter um ficheiro incompleto.")); }
        finally { if (payload != null) Arrays.fill(payload, (byte) 0); }
    }
    private void finish(Work item, Uri[] values, String status, String text) {
        if (item == null || !sessions.finish(item.ticket)) return;
        work = null; if (item.deadlineCheck != null) main.removeCallbacks(item.deadlineCheck); item.cancellation.cancel();
        try { if (item.input != null) item.input.close(); } catch (Exception ignored) {}
        try { if (item.output != null) item.output.close(); } catch (Exception ignored) {}
        if (item.job != null && !item.job.isDone()) item.job.cancel(true);
        synchronized (item) { if (item.bytes != null) { Arrays.fill(item.bytes, (byte) 0); item.bytes = null; } }
        if (item.writing && !"saved".equals(status)) text = "A gravação foi interrompida. O destino pode conter um ficheiro incompleto.";
        ValueCallback<Uri[]> callback = item.callback; item.callback = null;
        if (callback != null) callback.onReceiveValue(values);
        final String messageText = text;
        WebView view = host.web();
        if (view != null && host.current()) view.evaluateJavascript("window.__relayloomDocumentResult && window.__relayloomDocumentResult(" + JSONObject.quote(String.valueOf(item.ticket.id)) + "," + JSONObject.quote(status) + "," + JSONObject.quote(messageText) + ")", null);
        if (view != null && host.current() && host.foreground()) view.evaluateJavascript("window.__relayloomResumeFromDocument && window.__relayloomResumeFromDocument()", null);
        message(text); if ("expired".equals(status)) host.handoffExpired(); else if (!host.foreground()) host.handoffEndedWhileBackground();
    }
    boolean selected(Uri uri) { return host.current() && SelectedDocumentProvider.contains(this, uri); }
    void clearSnapshots() { SelectedDocumentProvider.clear(this); }
    void cancel(String reason) { Work item = work; if (item != null) finish(item, null, "cancelled", reason); }
    void destroy() { cancel("Escolha cancelada porque a aplicação fechou."); io.shutdownNow(); clearSnapshots(); }
    private void message(String text) { main.post(() -> { if (activeToast != null) activeToast.cancel(); activeToast = Toast.makeText(activity, text, Toast.LENGTH_LONG); activeToast.show(); }); }
    private String response(boolean ok, String id, String error) { try { return new JSONObject().put("ok", ok).put("id", id == null ? JSONObject.NULL : id).put("error", error == null ? JSONObject.NULL : error).toString(); } catch (Exception impossible) { return "{\"ok\":false}"; } }
}
