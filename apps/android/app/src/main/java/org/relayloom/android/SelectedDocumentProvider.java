package org.relayloom.android;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.util.HashMap;
import java.util.UUID;

/** Read-only immutable snapshots of explicitly selected files. Provider is not exported. */
public final class SelectedDocumentProvider extends ContentProvider {
    static final String AUTHORITY = "org.relayloom.android.selected-documents";
    private static final HashMap<String, Entry> ENTRIES = new HashMap<>();
    private static final class Entry {
        final Object owner; final File file; final String name, mime;
        Entry(Object owner, File file, String name, String mime) { this.owner = owner; this.file = file; this.name = name; this.mime = mime; }
    }
    static synchronized Uri add(Object owner, File file, String name, String mime) {
        if (ENTRIES.size() >= DocumentPolicy.MAX_FILES) throw new IllegalStateException("Limite de ficheiros temporários atingido.");
        String id = UUID.randomUUID().toString(); ENTRIES.put(id, new Entry(owner, file, name, mime));
        return new Uri.Builder().scheme("content").authority(AUTHORITY).appendPath(id).appendPath(name).build();
    }
    static synchronized void clear(Object owner) {
        java.util.Iterator<Entry> entries = ENTRIES.values().iterator();
        while (entries.hasNext()) { Entry entry = entries.next(); if (entry.owner == owner) { entry.file.delete(); entries.remove(); } }
    }
    static synchronized void replaceCurrent() { for (Entry entry : ENTRIES.values()) entry.file.delete(); ENTRIES.clear(); }
    static synchronized boolean contains(Object owner, Uri uri) { Entry entry = entry(uri); return entry != null && entry.owner == owner; }
    private static synchronized Entry entry(Uri uri) {
        if (uri == null || !"content".equals(uri.getScheme()) || !AUTHORITY.equals(uri.getAuthority()) || uri.getPathSegments().size() != 2 || uri.getQuery() != null || uri.getFragment() != null) return null;
        Entry result = ENTRIES.get(uri.getPathSegments().get(0));
        return result != null && result.name.equals(uri.getPathSegments().get(1)) ? result : null;
    }
    @Override public boolean onCreate() {
        // No persisted grants: clean snapshots left by a prior process death.
        File directory = new File(getContext().getCacheDir(), "selected-documents");
        File[] stale = directory.listFiles((dir, name) -> name.startsWith("selected-") && name.endsWith(".bin"));
        if (stale != null) for (File file : stale) if (file.isFile()) file.delete();
        return true;
    }
    @Override public synchronized Cursor query(Uri uri, String[] projection, String selection, String[] args, String sortOrder) {
        Entry entry = entry(uri); if (entry == null) return null;
        String[] columns = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
        MatrixCursor cursor = new MatrixCursor(columns); Object[] values = new Object[columns.length];
        for (int i = 0; i < columns.length; i++) { if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) values[i] = entry.name; else if (OpenableColumns.SIZE.equals(columns[i])) values[i] = entry.file.length(); }
        cursor.addRow(values); return cursor;
    }
    @Override public synchronized String getType(Uri uri) { Entry entry = entry(uri); return entry == null ? null : entry.mime; }
    @Override public synchronized ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        Entry entry = entry(uri);
        if (entry == null || !"r".equals(mode) || !entry.file.isFile()) throw new FileNotFoundException("Selected document unavailable");
        return ParcelFileDescriptor.open(entry.file, ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read-only selected documents"); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException("Read-only selected documents"); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException("Read-only selected documents"); }
}
