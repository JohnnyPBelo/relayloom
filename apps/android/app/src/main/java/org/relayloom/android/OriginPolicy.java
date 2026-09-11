package org.relayloom.android;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Deliberately independent of WebView so the URL/capability boundary can be tested on the host. */
public final class OriginPolicy {
    public final String origin;
    private final int port;
    private final byte[] capability;

    public OriginPolicy(String origin, String token) {
        try {
            URI uri = new URI(origin);
            if (!"http".equals(uri.getScheme()) || !"127.0.0.1".equals(uri.getHost()) || uri.getPort() < 1 || uri.getPort() > 65535 || uri.getUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null || !(uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath()))) throw new IllegalArgumentException("Invalid local origin");
            if (token == null || !token.matches("[A-Za-z0-9_-]{32,256}")) throw new IllegalArgumentException("Invalid local capability");
            this.port = uri.getPort(); this.origin = "http://127.0.0.1:" + port; this.capability = token.getBytes(StandardCharsets.UTF_8);
        } catch (Exception e) { throw new IllegalArgumentException("Invalid native core endpoint"); }
    }
    public boolean sameOrigin(String value) {
        try {
            URI uri = new URI(value);
            return "http".equals(uri.getScheme()) && "127.0.0.1".equals(uri.getHost()) && uri.getPort() == port && uri.getUserInfo() == null;
        } catch (Exception e) { return false; }
    }
    public boolean resource(String value) {
        if (sameOrigin(value)) return true;
        return value != null && value.startsWith("blob:") && sameOrigin(value.substring(5));
    }
    public boolean capability(String value) {
        return value != null && value.length() <= 256 && MessageDigest.isEqual(capability, value.getBytes(StandardCharsets.UTF_8));
    }
}
