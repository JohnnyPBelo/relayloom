package org.relayloom.android;

/** One absolute, non-renewable Activity-result grace period; no OS background exemption. */
final class DocumentSession {
    static final long MAX_HANDOFF_MS = 120_000, CHECK_INTERVAL_MS = 1000;
    enum Kind { PICK, EXPORT }
    static final class Ticket {
        final long id, lease, deadline;
        final int generation;
        final Kind kind;
        boolean launched;
        Ticket(long id, long lease, int generation, Kind kind, long now) { this.id = id; this.lease = lease; this.generation = generation; this.kind = kind; this.deadline = now + MAX_HANDOFF_MS; }
    }
    private long next;
    private Ticket active;
    synchronized Ticket begin(long lease, int generation, Kind kind, long now) {
        if (active != null || lease == 0 || now < 0) return null;
        return active = new Ticket(++next, lease, generation, kind, now);
    }
    synchronized boolean owns(Ticket ticket, long lease, int generation) {
        return ticket != null && active == ticket && ticket.lease == lease && ticket.generation == generation;
    }
    synchronized boolean valid(Ticket ticket, long lease, int generation, long now) { return owns(ticket, lease, generation) && now < ticket.deadline; }
    synchronized long nextCheckDelay(Ticket ticket, long lease, int generation, long now) {
        return valid(ticket, lease, generation, now) ? Math.min(CHECK_INTERVAL_MS, ticket.deadline - now) : 0;
    }
    synchronized boolean retain(long lease, int generation, long now) { return active != null && active.launched && valid(active, lease, generation, now); }
    synchronized Ticket current() { return active; }
    synchronized boolean finish(Ticket ticket) { if (active != ticket) return false; active = null; return true; }
}
