package org.relayloom.android;

public final class OriginPolicyTest {
    private static int assertions = 0;
    private static void require(boolean result, String label) { assertions++; if (!result) throw new AssertionError(label); }
    public static void main(String[] args) {
        String token = "a".repeat(64); OriginPolicy policy = new OriginPolicy("http://127.0.0.1:8123", token);
        require(policy.sameOrigin("http://127.0.0.1:8123/api/state"), "Own API origin");
        require(policy.resource("blob:http://127.0.0.1:8123/temporary-media"), "Own media blob");
        for (String url : new String[]{"https://example.org/", "http://127.0.0.1:8124/", "http://localhost:8123/", "http://10.0.2.2:8123/", "http://user@127.0.0.1:8123/", "http://127.0.0.1:8123.example.org/", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,test", "blob:http://127.0.0.1:8124/media"}) require(!policy.sameOrigin(url), "Reject navigation " + url);
        require(!policy.resource("blob:https://example.org/media"), "Reject remote media blob");
        require(policy.capability(token), "Correct capability"); require(!policy.capability(token + "x"), "Reject changed capability"); require(!policy.capability(null), "Reject absent capability");
        for (String origin : new String[]{"http://0.0.0.0:8123", "https://127.0.0.1:8123", "http://127.0.0.1:0", "http://127.0.0.1:8123/path", "http://127.0.0.1:8123/?token=x"}) {
            boolean rejected = false; try { new OriginPolicy(origin, token); } catch (IllegalArgumentException expected) { rejected = true; } require(rejected, "Reject unsafe startup origin");
        }
        System.out.println("OriginPolicy: " + assertions + " boundary assertions passed (host JVM; not WebView/device testing)");
    }
}
