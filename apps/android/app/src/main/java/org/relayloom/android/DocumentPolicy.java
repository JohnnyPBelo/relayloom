package org.relayloom.android;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** Bounds for explicit document import/export; never accepts a filesystem path or renderer URI. */
final class DocumentPolicy {
    static final int MAX_FILE_BYTES = 2_000_000, MAX_FILES = 4, MAX_VAULT_BYTES = 8192;
    static final Set<String> TYPES = new HashSet<>(Arrays.asList(
        "image/png", "image/jpeg", "image/webp", "image/gif",
        "audio/ogg", "audio/mpeg", "audio/webm", "audio/wav", "audio/mp4", "audio/x-wav",
        "video/mp4", "video/webm", "video/ogg",
        "text/plain", "application/json", "application/pdf", "application/zip", "application/octet-stream"));
    static String mime(String value) {
        String mime = value == null || value.trim().isEmpty() ? "application/octet-stream" : value.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        if (!TYPES.contains(mime)) throw new IllegalArgumentException("Este tipo de ficheiro não é suportado. Usa imagem, áudio, vídeo, texto, JSON, PDF ou ZIP.");
        return mime;
    }
    static String name(String value) {
        if (value == null) value = "documento";
        String result = value.replaceAll("[\\p{Cntrl}\\\\/:*?\"<>|]", "_").trim();
        if (result.length() > 120) result = result.substring(0, 120);
        if (result.isEmpty() || result.equals(".") || result.equals("..")) result = "documento";
        return result;
    }
    static int exportLimit(String name, String mime) {
        // A lower vault bound does not confer any extra authority or validation of its contents.
        return name.toLowerCase(Locale.ROOT).endsWith(".vault.json") && mime.equals("application/json") ? MAX_VAULT_BYTES : MAX_FILE_BYTES;
    }
    static byte[] readBounded(InputStream input, int limit) throws Exception {
        if (limit < 1 || limit > MAX_FILE_BYTES) throw new IllegalArgumentException("Invalid byte limit");
        ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[16384]; int count;
        while ((count = input.read(buffer, 0, Math.min(buffer.length, limit - output.size() + 1))) != -1) {
            if (output.size() + count > limit) throw new IllegalArgumentException("Cada anexo pode ter até 2 MB.");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }
    static void selectionCount(int count) {
        if (count < 1 || count > MAX_FILES) throw new IllegalArgumentException("Escolhe entre um e quatro ficheiros.");
    }
}
