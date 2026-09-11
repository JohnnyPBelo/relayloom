package org.relayloom.android;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class RuntimeLeaseCoordinatorTest {
    private static int assertions = 0;
    private static void require(boolean value, String label) { assertions++; if (!value) throw new AssertionError(label); }
    private static final class Backend implements RuntimeLeaseCoordinator.Backend {
        volatile String active = null;
        final List<String> events = new ArrayList<>();
        CountDownLatch block, entered;
        @Override public String start(String data, String assets) throws Exception {
            events.add("start:" + data); active = data;
            if (block != null) { entered.countDown(); if (!block.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("Test startup timed out"); }
            return data;
        }
        @Override public void stop() { events.add("stop:" + active); active = null; }
    }
    public static void main(String[] args) throws Exception {
        Backend backend = new Backend(); RuntimeLeaseCoordinator coordinator = new RuntimeLeaseCoordinator(backend);
        List<String> ready = new ArrayList<>();
        RuntimeLeaseCoordinator.Callback callback = new RuntimeLeaseCoordinator.Callback() {
            @Override public void ready(long lease, String value) { ready.add(value); }
            @Override public void failed(long lease, Exception error) { throw new AssertionError(error); }
        };
        try {
            long old = coordinator.start(() -> new String[]{"Activity-A", "assets"}, callback); coordinator.drainForTest();
            long replacement = coordinator.start(() -> new String[]{"Activity-B", "assets"}, callback); coordinator.drainForTest();
            coordinator.stop(old); coordinator.drainForTest();
            require("Activity-B".equals(backend.active), "Old Activity onDestroy must not stop replacement");
            require(coordinator.isCurrent(replacement) && !coordinator.isCurrent(old), "Only replacement owns native capability");
            coordinator.stop(replacement); coordinator.drainForTest(); require(backend.active == null, "Owner stop closes core");
            backend.block = new CountDownLatch(1); backend.entered = new CountDownLatch(1);
            long cancelled = coordinator.start(() -> new String[]{"cancelled", "assets"}, callback);
            require(backend.entered.await(5, TimeUnit.SECONDS), "Delayed start entered backend");
            coordinator.stop(cancelled); backend.block.countDown(); coordinator.drainForTest(); backend.block = null;
            require(backend.active == null && !ready.contains("cancelled"), "Cancelled startup stops late core and never publishes endpoint");
            long first = coordinator.start(() -> new String[]{"first", "assets"}, callback);
            coordinator.stop(first);
            long last = coordinator.start(() -> new String[]{"last", "assets"}, callback); coordinator.drainForTest();
            coordinator.stop(first); coordinator.drainForTest();
            require("last".equals(backend.active), "Rapid replacement survives stale stop");
            coordinator.stop(last); coordinator.drainForTest(); require(backend.active == null, "Final owner cleanup");
        } finally { coordinator.shutdownForTest(); }
        System.out.println("RuntimeLeaseCoordinator: " + assertions + " lifecycle assertions passed (host JVM fake backend; not Activity/device testing)");
    }
}
