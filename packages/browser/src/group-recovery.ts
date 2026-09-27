/** Scheduling hints only. Hosts re-read signed bytes and current authority on
 * every attempt; no permission or writable profile capability lives here. */
export type GroupRecoveryCandidate = {
  id: string;
  action: "reconsider" | "delivery";
};
export const GROUP_RECOVERY_LIMITS = Object.freeze({
  candidates: 1152, // At most 1024 retained objects plus 128 held references.
  batch: 2,
  retryMs: 2000,
  maxRetryMs: 30000,
});
export interface GroupRecoveryHost {
  ready(): boolean;
  authorityRevision(): number | string;
  scan(): Promise<GroupRecoveryCandidate[]>;
  recover(candidate: GroupRecoveryCandidate): Promise<boolean>;
}
type Pending = GroupRecoveryCandidate & {
  attempts: number;
  due: number;
  error: string;
};
const message = (error: unknown) =>
  (error instanceof Error
    ? error.message
    : "Recuperação de grupo adiada"
  ).slice(0, 240);

/** One bounded local pump, independent of transport and its ACKs. Closing a
 * session cancels scheduled work; in-flight domain work remains host-guarded. */
export class BrowserGroupRecovery {
  private closed = false;
  private busy = false;
  private dirty = true;
  private scanAfter = 0;
  private scanError = "";
  private revision: number | string = -1;
  private pending = new Map<string, Pending>();
  private timer?: ReturnType<typeof setTimeout>;
  private scheduled = Infinity;
  constructor(private readonly host: GroupRecoveryHost) {}
  get status() {
    return {
      queued: this.pending.size,
      running: this.busy,
      scanning: this.dirty,
      error:
        this.scanError ||
        [...this.pending.values()].find((entry) => entry.error)?.error ||
        "",
    };
  }
  wake() {
    if (this.closed) return;
    this.dirty = true;
    this.scanAfter = 0;
    for (const entry of this.pending.values()) entry.due = 0;
    this.tick();
  }
  tick() {
    if (this.closed || !this.host.ready()) return;
    const revision = this.host.authorityRevision();
    if (revision !== this.revision) {
      this.revision = revision;
      // Authority/control traffic cannot create incoming content. A complete
      // empty scan remains empty until ingestion explicitly wakes us. Avoid
      // reading all protected group pages during every join/control exchange.
      if (this.dirty || this.pending.size > 0) {
        this.dirty = true;
        this.scanAfter = 0;
        for (const entry of this.pending.values()) entry.due = 0;
      }
    }
    if (this.busy) return;
    const next = this.dirty
      ? this.scanAfter
      : Math.min(...[...this.pending.values()].map((entry) => entry.due));
    if (next === Infinity) return;
    const due = Math.max(Date.now(), next);
    if (this.timer !== undefined && this.scheduled <= due) return;
    clearTimeout(this.timer);
    this.scheduled = due;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.scheduled = Infinity;
        void this.run();
      },
      Math.max(0, due - Date.now()),
    );
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending.clear();
  }
  private live() {
    return !this.closed && this.host.ready();
  }
  private retry(entry: Pending, error = "") {
    entry.attempts = Math.min(5, entry.attempts + 1);
    entry.due =
      Date.now() +
      Math.min(
        GROUP_RECOVERY_LIMITS.maxRetryMs,
        GROUP_RECOVERY_LIMITS.retryMs * 2 ** (entry.attempts - 1),
      );
    entry.error = error;
    this.pending.delete(entry.id);
    this.pending.set(entry.id, entry);
  }
  private async scan() {
    // Clear before await so a wake during this scan survives completion.
    this.dirty = false;
    const candidates = await this.host.scan();
    if (!this.live()) return;
    if (
      !Array.isArray(candidates) ||
      candidates.length > GROUP_RECOVERY_LIMITS.candidates
    )
      throw Error("Limite da recuperação de grupos excedido");
    const owned = new Map<string, GroupRecoveryCandidate>();
    for (const value of candidates) {
      if (
        !value ||
        typeof value.id !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.id) ||
        !["reconsider", "delivery"].includes(value.action) ||
        owned.has(value.id)
      )
        throw Error("Referência de recuperação inválida");
      owned.set(value.id, { id: value.id, action: value.action });
    }
    // Preserve rotation/backoff across new scans. These are hints, never grants.
    for (const [id, entry] of this.pending) {
      const next = owned.get(id);
      if (!next) this.pending.delete(id);
      else {
        entry.action = next.action;
        owned.delete(id);
      }
    }
    for (const entry of owned.values())
      this.pending.set(entry.id, { ...entry, attempts: 0, due: 0, error: "" });
    this.scanError = "";
  }
  private async run() {
    if (this.busy || !this.live()) return;
    this.busy = true;
    try {
      if (this.dirty) {
        if (this.scanAfter > Date.now()) return;
        try {
          await this.scan();
        } catch (error) {
          if (!this.live()) return;
          this.dirty = true;
          this.scanAfter = Date.now() + GROUP_RECOVERY_LIMITS.retryMs;
          this.scanError = message(error);
          return; // Never decide using an incomplete or corrupt scan.
        }
      }
      if (!this.live()) return;
      const due = [...this.pending.values()]
        .filter((entry) => entry.due <= Date.now())
        .slice(0, GROUP_RECOVERY_LIMITS.batch);
      for (const entry of due) {
        if (!this.live()) return;
        try {
          const done = await this.host.recover({
            id: entry.id,
            action: entry.action,
          });
          if (!this.live()) return;
          if (done) this.pending.delete(entry.id);
          else this.retry(entry);
        } catch (error) {
          if (!this.live()) return;
          this.retry(entry, message(error));
        }
      }
    } finally {
      this.busy = false;
      this.tick();
    }
  }
}
