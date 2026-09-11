import type { SerialPort } from "serialport";

interface PollerInterests {
  poll(flags?: number): void;
  listenerCount(event: string): number;
}
const protectedPollers = new WeakSet<PollerInterests>();

/** Preserve concurrent interests in serialport 13's POSIX native poller.
 * Its poll() stores an OR-ed interest mask but passes only the latest argument
 * to uv_poll_start. Re-arming reads can otherwise erase a pending write watch.
 * This wraps an owned port instance, leaving installed/global bindings untouched.
 */
export function preservePollerInterests(poller: PollerInterests): void {
  if (protectedPollers.has(poller)) return;
  protectedPollers.add(poller);
  const poll = poller.poll.bind(poller);
  poller.poll = (flags = 0) => {
    const pending =
      (poller.listenerCount("readable") ? 1 : 0) |
      (poller.listenerCount("writable") ? 2 : 0) |
      (poller.listenerCount("disconnect") ? 4 : 0);
    poll(flags | pending);
  };
}

export function preserveSerialPollInterests(port: SerialPort): void {
  if (port.port && "poller" in port.port)
    preservePollerInterests(port.port.poller);
}

/** One bounded frame, four times its 8N1 wire duration plus scheduling headroom. */
export function serialWriteDeadline(bytes: number, baudRate: number): number {
  return Math.min(
    120_000,
    Math.max(5000, Math.ceil(((bytes * 10) / baudRate) * 4000 + 1000)),
  );
}
