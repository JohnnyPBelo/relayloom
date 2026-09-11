package org.relayloom.android;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

final class AssetInstaller {
    static File install(Context context) throws Exception {
        File directory = new File(context.getFilesDir(), "web");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("Cannot prepare bundled web assets");
        JSONArray entries;
        try (InputStream input = context.getAssets().open("web-manifest.json")) { entries = new JSONArray(new String(read(input, 256000), StandardCharsets.UTF_8)); }
        if (entries.length() == 0 || entries.length() > 1024) throw new IllegalStateException("Invalid asset count");
        long total = 0;
        for (int i = 0; i < entries.length(); i++) {
            JSONObject entry = entries.getJSONObject(i); String path = entry.getString("path"), expected = entry.getString("sha256");
            File target = new File(directory, path);
            if (!target.getCanonicalPath().startsWith(directory.getCanonicalPath() + File.separator) || !expected.matches("[0-9a-f]{64}")) throw new IllegalStateException("Invalid asset manifest");
            byte[] data;
            try (InputStream input = context.getAssets().open("web/" + path)) { data = read(input, 8 * 1024 * 1024); }
            total += data.length; if (total > 16 * 1024 * 1024 || !sha256(data).equals(expected)) throw new IllegalStateException("Bundled asset integrity failure");
            boolean current = false;
            if (target.isFile() && target.length() == data.length) try (InputStream input = new FileInputStream(target)) { current = sha256(read(input, 8 * 1024 * 1024)).equals(expected); }
            if (current) continue;
            File parent = target.getParentFile(); if (!parent.isDirectory() && !parent.mkdirs()) throw new IllegalStateException("Cannot prepare asset directory");
            File temporary = new File(target.getPath() + ".tmp");
            try (FileOutputStream output = new FileOutputStream(temporary)) { output.write(data); output.getFD().sync(); }
            if (!temporary.renameTo(target)) throw new IllegalStateException("Cannot install bundled asset");
        }
        if (!new File(directory, "index.html").isFile()) throw new IllegalStateException("Bundled index is missing");
        return directory;
    }
    private static byte[] read(InputStream input, int limit) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[16384]; int n;
        while ((n = input.read(buffer)) != -1) { if (output.size() + n > limit) throw new IllegalStateException("Asset exceeds bound"); output.write(buffer, 0, n); }
        return output.toByteArray();
    }
    private static String sha256(byte[] data) throws Exception {
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(data); StringBuilder result = new StringBuilder();
        for (byte value : hash) result.append(String.format("%02x", value & 255)); return result.toString();
    }
}
