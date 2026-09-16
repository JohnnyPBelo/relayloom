package org.relayloom.android.smoketests;

import android.app.Activity;
import android.system.Os;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;

/** Exercises the shipped reader on Android; all malformed files are private test fixtures. */
final class NativeLanguageChecks {
    static byte[] vaultDigest(Activity activity) throws Exception {
        File file = new File(activity.getFilesDir(), "core/identity.vault");
        if (!file.isFile() || file.length() > 8192) throw new AssertionError("Expected bounded existing test vault");
        java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
        try (FileInputStream in = new FileInputStream(file)) {
            byte[] bytes = new byte[8193]; int count = in.read(bytes);
            if (count < 1 || count > 8192 || in.read() != -1) throw new AssertionError("Unexpected vault size");
            digest.update(bytes, 0, count);
        }
        return digest.digest();
    }
    private static void write(File file, byte[] bytes) throws Exception {
        try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); }
    }
    static int run(Activity activity) throws Exception {
        Class<?> type = activity.getClassLoader().loadClass("org.relayloom.android.NativeText");
        Method read = type.getDeclaredMethod("language", File.class, List.class); read.setAccessible(true);
        Method fallback = type.getDeclaredMethod("fallback", List.class); fallback.setAccessible(true);
        File directory = new File(activity.getCacheDir(), "language-check-" + System.nanoTime());
        if (!directory.mkdir()) throw new AssertionError("Cannot create private language fixture");
        File file = new File(directory, "ui-preferences.json"), target = new File(directory, "target.json"), link = new File(directory, "core-link");
        int checks = 0;
        try {
            String[][] choices = {{"fr-FR", "es-MX", "es-ES"}, {"pt_BR", "en-US", "pt-PT"}, {"en-US", "es-ES", "en-GB"}, {"fr-FR", "de-DE", "pt-PT"}};
            for (String[] choice : choices) {
                if (!choice[2].equals(fallback.invoke(null, Arrays.asList(choice[0], choice[1])))) throw new AssertionError("Locale fallback order");
                checks++;
            }
            if (!"en-GB".equals(read.invoke(null, directory, Arrays.asList("en-US")))) throw new AssertionError("Missing preference fallback");
            checks++;
            String prefix = "{\"version\":1,\"values\":{\"language\":\"";
            for (String language : Arrays.asList("pt-PT", "en-GB", "es-ES")) {
                write(file, (prefix + language + "\",\"glass\":true,\"largeText\":false,\"highContrast\":true,\"theme\":\"dark\"}}").getBytes(StandardCharsets.UTF_8));
                if (!language.equals(read.invoke(null, directory, Arrays.asList("fr-FR")))) throw new AssertionError("Saved language overrides OS");
                checks++;
            }
            String[] invalid = {"", "{", "[]", "{}", "{\"version\":2,\"values\":{\"language\":\"es-ES\"}}", "{\"version\":true,\"values\":{\"language\":\"es-ES\"}}", "{\"version\":\"1\",\"values\":{\"language\":\"es-ES\"}}", "{\"values\":{\"language\":\"es-ES\"}}", "{\"version\":1,\"version\":1,\"values\":{\"language\":\"es-ES\"}}", "{\"version\":1,\"values\":{\"language\":\"es-ES\",\"language\":\"pt-PT\"}}", "{\"version\":1,\"values\":{\"language\":\"es-ES\"},\"unknown\":true}", "{\"version\":1,\"values\":{\"language\":\"es-ES\",\"unknown\":true}}", "{\"version\":1,\"values\":{\"language\":\"es-ES\",\"glass\":\"true\"}}", "{\"version\":1,\"values\":{\"language\":\"es-ES\",\"theme\":\"auto\"}}", "{\"version\":1,\"values\":{\"language\":\"fr-FR\"}}", "{\"version\":1,\"values\":{\"language\":false}}", "{\"version\":1,\"values\":null}", "{\"version\":1,\"values\":{\"language\":\"es-ES\"}} {}"};
            for (int i = 0; i < invalid.length; i++) {
                write(file, invalid[i].getBytes(StandardCharsets.UTF_8));
                if (!"en-GB".equals(read.invoke(null, directory, Arrays.asList("en-US")))) throw new AssertionError("Invalid preference control " + i);
                checks++;
            }
            byte[] valid = (prefix + "es-ES\"}}").getBytes(StandardCharsets.UTF_8), exact = new byte[4096]; Arrays.fill(exact, (byte) ' '); System.arraycopy(valid, 0, exact, 0, valid.length);
            write(file, exact);
            if (!"es-ES".equals(read.invoke(null, directory, Arrays.asList("en-US")))) throw new AssertionError("Exact 4096 byte file accepted"); checks++;
            byte[] over = Arrays.copyOf(exact, 4097); over[4096] = ' '; write(file, over);
            if (!"en-GB".equals(read.invoke(null, directory, Arrays.asList("en-US")))) throw new AssertionError("Oversized preference refused"); checks++;
            write(file, new byte[]{(byte) 0xc3, 0x28});
            if (!"en-GB".equals(read.invoke(null, directory, Arrays.asList("en-US")))) throw new AssertionError("Invalid UTF-8 refused"); checks++;
            if (!file.delete()) throw new AssertionError("Fixture cleanup"); write(target, valid); Os.symlink(target.getPath(), file.getPath());
            if (!"en-GB".equals(read.invoke(null, directory, Arrays.asList("en-US")))) throw new AssertionError("Preference symlink refused"); checks++;
            if (!file.delete() || !file.mkdir()) throw new AssertionError("Fixture directory");
            if (!"en-GB".equals(read.invoke(null, directory, Arrays.asList("en-US")))) throw new AssertionError("Non-file preference refused"); checks++;
            if (!file.delete()) throw new AssertionError("Fixture cleanup"); write(file, valid); Os.symlink(directory.getPath(), link.getPath());
            if (!"en-GB".equals(read.invoke(null, link, Arrays.asList("en-US")))) throw new AssertionError("Profile symlink refused"); checks++;
            return checks;
        } finally { link.delete(); file.delete(); target.delete(); directory.delete(); }
    }
    static String text(Activity activity, String source) throws Exception {
        Class<?> type = activity.getClassLoader().loadClass("org.relayloom.android.NativeText");
        Method method = type.getDeclaredMethod("text", android.content.Context.class, String.class); method.setAccessible(true);
        return (String) method.invoke(null, activity, source);
    }
}
