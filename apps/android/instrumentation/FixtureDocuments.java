package org.relayloom.android.smoketests;

import android.database.Cursor;
import android.database.MatrixCursor;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract.Document;
import android.provider.DocumentsContract.Root;
import android.provider.DocumentsProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileNotFoundException;
import java.nio.charset.StandardCharsets;

/** Separate debug-test APK only. Synthetic provider, including misleading metadata controls. */
public final class FixtureDocuments extends DocumentsProvider {
    private static final String[] DOC = {Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE, Document.COLUMN_FLAGS, Document.COLUMN_SIZE};
    public static byte[] payload() { StringBuilder value = new StringBuilder("RelayLoom SAF exact attachment\n"); for (int i=0;i<600;i++) value.append("Synthetic fixture line ").append(i).append('\n'); return value.toString().getBytes(StandardCharsets.UTF_8); }
    @Override public boolean onCreate() { return true; }
    private File file(String id) throws FileNotFoundException {
        if (!id.matches("(good|unknown|large|lying|unsupported)")) throw new FileNotFoundException("Unknown fixture");
        File file = new File(getContext().getFilesDir(), id + ".fixture");
        if (!file.isFile()) try (FileOutputStream out = new FileOutputStream(file)) {
            if (id.equals("large") || id.equals("lying")) { byte[] bytes = new byte[2_000_001]; java.util.Arrays.fill(bytes, (byte)'x'); out.write(bytes); }
            else if (id.equals("unsupported")) out.write("<svg xmlns=\"http://www.w3.org/2000/svg\"/>".getBytes(StandardCharsets.UTF_8));
            else out.write(payload());
        } catch (Exception error) { throw new FileNotFoundException("Fixture initialization failed"); }
        return file;
    }
    private void row(MatrixCursor cursor, String id) throws FileNotFoundException {
        boolean root = id.equals("root");
        String name = root ? "RelayLoom test fixtures" : id.equals("good") ? "saf-import.txt" : "saf-" + id + (id.equals("unsupported") ? ".svg" : ".txt");
        String mime = root ? Document.MIME_TYPE_DIR : id.equals("unsupported") ? "image/svg+xml" : "text/plain";
        Object size = root || id.equals("unknown") ? null : id.equals("lying") ? 7L : file(id).length();
        MatrixCursor.RowBuilder row = cursor.newRow();
        for (String column : cursor.getColumnNames()) {
            if (column.equals(Document.COLUMN_DOCUMENT_ID)) row.add(id);
            else if (column.equals(Document.COLUMN_DISPLAY_NAME)) row.add(name);
            else if (column.equals(Document.COLUMN_MIME_TYPE)) row.add(mime);
            else if (column.equals(Document.COLUMN_FLAGS)) row.add(0);
            else if (column.equals(Document.COLUMN_SIZE)) row.add(size); else row.add(null);
        }
    }
    @Override public Cursor queryRoots(String[] projection) {
        String[] cols = projection == null ? new String[]{Root.COLUMN_ROOT_ID,Root.COLUMN_DOCUMENT_ID,Root.COLUMN_TITLE,Root.COLUMN_FLAGS,Root.COLUMN_MIME_TYPES} : projection;
        MatrixCursor cursor = new MatrixCursor(cols); MatrixCursor.RowBuilder row = cursor.newRow();
        for(String col:cols) { if(col.equals(Root.COLUMN_ROOT_ID)||col.equals(Root.COLUMN_DOCUMENT_ID))row.add("root"); else if(col.equals(Root.COLUMN_TITLE))row.add("RelayLoom test fixtures"); else if(col.equals(Root.COLUMN_FLAGS))row.add(Root.FLAG_LOCAL_ONLY | Root.FLAG_SUPPORTS_IS_CHILD); else if(col.equals(Root.COLUMN_MIME_TYPES))row.add("text/plain\nimage/svg+xml"); else row.add(null); }
        return cursor;
    }
    @Override public Cursor queryDocument(String id,String[] projection) throws FileNotFoundException { MatrixCursor c=new MatrixCursor(projection==null?DOC:projection);row(c,id);return c; }
    @Override public Cursor queryChildDocuments(String parent,String[] projection,String sort) throws FileNotFoundException { if(!parent.equals("root"))throw new FileNotFoundException();MatrixCursor c=new MatrixCursor(projection==null?DOC:projection);for(String id:new String[]{"good","unknown","large","lying","unsupported"})row(c,id);return c; }
    @Override public boolean isChildDocument(String parent,String child) { return parent.equals("root") && child.matches("(good|unknown|large|lying|unsupported)"); }
    @Override public ParcelFileDescriptor openDocument(String id,String mode,CancellationSignal signal) throws FileNotFoundException { if(!mode.equals("r"))throw new FileNotFoundException("Read-only fixture"); if(signal!=null)signal.throwIfCanceled();return ParcelFileDescriptor.open(file(id),ParcelFileDescriptor.MODE_READ_ONLY); }
}
