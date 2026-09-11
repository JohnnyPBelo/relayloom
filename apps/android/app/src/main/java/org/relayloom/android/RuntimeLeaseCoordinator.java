package org.relayloom.android;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Process-scoped serial ownership for a singleton native core; independent of Android for testing. */
final class RuntimeLeaseCoordinator {
    interface Backend { String start(String data, String assets) throws Exception; void stop() throws Exception; }
    interface Callback { void ready(long lease, String endpoint); void failed(long lease, Exception error); }
    interface Preparation { String[] prepare() throws Exception; }
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Backend backend;
    private long sequence = 0;
    private volatile long desired = 0;
    // Accessed only by the process-scoped serial executor.
    private long running = 0;
    RuntimeLeaseCoordinator(Backend backend) { this.backend = backend; }

    synchronized long start(Preparation preparation, Callback callback) {
        final long lease = ++sequence; desired = lease;
        executor.execute(() -> {
            if (!isCurrent(lease)) return;
            try {
                if (running != 0) { backend.stop(); running = 0; }
                if (!isCurrent(lease)) return;
                String[] paths = preparation.prepare();
                if (!isCurrent(lease)) return;
                String endpoint = backend.start(paths[0], paths[1]); running = lease;
                if (!isCurrent(lease)) { backend.stop(); running = 0; return; }
                callback.ready(lease, endpoint);
            } catch (Exception error) {
                // This task owns the executor until cleanup finishes; no replacement starts here.
                try { backend.stop(); } catch (Exception ignored) {} running = 0;
                if (isCurrent(lease)) callback.failed(lease, error);
            }
        });
        return lease;
    }
    synchronized void stop(long lease) {
        if (lease == 0) return;
        if (desired == lease) desired = 0;
        executor.execute(() -> {
            if (running != lease) return;
            try { backend.stop(); } catch (Exception ignored) {} finally { running = 0; }
        });
    }
    boolean isCurrent(long lease) { return lease != 0 && desired == lease; }
    void drainForTest() throws Exception { executor.submit(() -> {}).get(); }
    void shutdownForTest() { executor.shutdown(); }
}
