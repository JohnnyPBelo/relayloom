package org.relayloom.android;

import java.io.ByteArrayInputStream;
import java.util.Arrays;

public final class DocumentPolicyTest {
    private static int assertions;
    private static void require(boolean value, String text) { assertions++; if (!value) throw new AssertionError(text); }
    private static void rejected(Runnable call, String text) { boolean rejected = false; try { call.run(); } catch (IllegalArgumentException expected) { rejected = true; } require(rejected, text); }
    public static void main(String[] args) throws Exception {
        require(DocumentPolicy.mime("Audio/WebM;codecs=opus").equals("audio/webm"), "MIME normalization");
        require(DocumentPolicy.mime(null).equals("application/octet-stream"), "Unknown provider type is inert download data");
        rejected(() -> DocumentPolicy.mime("text/html"), "HTML type refused"); rejected(() -> DocumentPolicy.mime("image/svg+xml"), "Scriptable image type refused");
        require(DocumentPolicy.name("../../bad\nname.pdf").equals(".._.._bad_name.pdf"), "Unsafe suggested name loses path/control separators");
        require(DocumentPolicy.name("x".repeat(200)).length() == 120, "Bounded filename");
        require(DocumentPolicy.exportLimit("backup.vault.json", "application/json") == 8192, "Vault lower bound");
        require(DocumentPolicy.exportLimit("photo.png", "image/png") == 2_000_000, "Attachment bound");
        rejected(() -> DocumentPolicy.selectionCount(5), "Too many selected files"); rejected(() -> DocumentPolicy.selectionCount(0), "Empty selection is cancellation");
        byte[] bytes = new byte[2_000_000]; Arrays.fill(bytes, (byte) 42); require(Arrays.equals(DocumentPolicy.readBounded(new ByteArrayInputStream(bytes), bytes.length), bytes), "Boundary file exact bytes");
        boolean oversized = false; try { DocumentPolicy.readBounded(new ByteArrayInputStream(new byte[2_000_001]), 2_000_000); } catch (IllegalArgumentException expected) { oversized = true; } require(oversized, "Misreported provider size cannot exceed streaming bound");
        DocumentSession sessions = new DocumentSession(); DocumentSession.Ticket first = sessions.begin(10, 1, DocumentSession.Kind.PICK, 1000);
        require(first != null && !sessions.retain(10, 1, 1001), "Unlaunched operation does not authorize background grace");
        first.launched = true; require(sessions.retain(10, 1, 1001), "Explicit launched picker retains same session");
        require(sessions.begin(10, 1, DocumentSession.Kind.EXPORT, 2000) == null, "Repeated request cannot extend deadline");
        require(first.deadline == 121000, "Absolute deadline unchanged");
        require(sessions.nextCheckDelay(first, 10, 1, 2000) == 1000, "Checker waits at most one second of scheduled execution");
        require(sessions.nextCheckDelay(first, 10, 1, 120900) == 100, "Final checker uses remaining original deadline");
        require(sessions.nextCheckDelay(first, 10, 1, 3_600_000) == 0, "Elapsed-time jump after sleep requires immediate expiry");
        require(first.deadline == 121000, "Repeated checks and simulated sleep never renew the deadline");
        require(!sessions.owns(first, 11, 1), "Old Activity cannot restart a replacement lease when its deadline expires");
        require(!sessions.retain(10, 1, 121000), "Deadline ends grace exactly");
        require(!sessions.valid(first, 11, 1, 2000), "Replaced core lease invalidates result");
        require(!sessions.valid(first, 10, 2, 2000), "Recreated Activity generation invalidates result");
        require(sessions.finish(first) && !sessions.finish(first), "Cancellation/result consumes callback once");
        DocumentSession.Ticket second = sessions.begin(12, 3, DocumentSession.Kind.EXPORT, 5000); require(second != null, "Fresh explicit user action can begin next operation");
        require(!sessions.finish(first) && sessions.current() == second, "Late previous callback cannot consume new operation");
        sessions.finish(second); require(!sessions.retain(12, 3, 5001), "Normal HOME without document session has no grace");
        System.out.println("DocumentPolicy/Session: " + assertions + " boundary/lifecycle assertions passed (host JVM; no SAF device result implied)");
    }
}
