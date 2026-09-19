import { api, type API } from "../api";
import { SITE_LIMITS } from "../../../../packages/content/src/site";

export interface ResourceTarget {
  snapshotId: string;
  pageId: string;
  blockId: string;
}
interface Job {
  body: ResourceTarget & { action: "inspect" };
  signal?: AbortSignal;
  settled: boolean;
  abort(): void;
  resolve(value: any): void;
  reject(error: unknown): void;
}

/** Automatic checks must leave room for navigation, messaging and explicit reads.
 * A cancelled caller cannot free an active slot until its real request settles:
 * aborting a UI promise does not cancel the work already sent to the Worker. */
export class ResourceInspector {
  private active = 0;
  private waiting: Job[] = [];
  constructor(
    private perform: API,
    private parallel = 4,
    private queued = SITE_LIMITS.blocks * 4,
  ) {
    if (
      !Number.isSafeInteger(parallel) ||
      parallel < 1 ||
      parallel > 16 ||
      !Number.isSafeInteger(queued) ||
      queued < 1 ||
      queued > SITE_LIMITS.blocks * 4
    )
      throw new Error("Orçamento de leitura inválido");
  }
  inspect(target: ResourceTarget, signal?: AbortSignal): Promise<any> {
    if (signal?.aborted)
      return Promise.reject(
        new DOMException("Operação cancelada", "AbortError"),
      );
    if (this.waiting.length >= this.queued)
      return Promise.reject(new Error("Há demasiadas operações em curso"));
    return new Promise((resolve, reject) => {
      const job: Job = {
        body: {
          action: "inspect",
          snapshotId: target.snapshotId,
          pageId: target.pageId,
          blockId: target.blockId,
        },
        signal,
        settled: false,
        resolve,
        reject,
        abort: () => {
          if (job.settled) return;
          job.settled = true;
          signal?.removeEventListener("abort", job.abort);
          const index = this.waiting.indexOf(job);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new DOMException("Operação cancelada", "AbortError"));
        },
      };
      signal?.addEventListener("abort", job.abort, { once: true });
      this.waiting.push(job);
      this.drain();
    });
  }
  private drain() {
    while (this.active < this.parallel && this.waiting.length) {
      const job = this.waiting.shift()!;
      if (job.settled) continue;
      this.active++;
      void Promise.resolve()
        .then(() =>
          job.settled ? undefined : this.perform("resource-command", job.body),
        )
        .then(
          (value) => {
            if (!job.settled) {
              job.settled = true;
              job.resolve(value);
            }
          },
          (error) => {
            if (!job.settled) {
              job.settled = true;
              job.reject(error);
            }
          },
        )
        .finally(() => {
          job.signal?.removeEventListener("abort", job.abort);
          this.active--;
          this.drain();
        });
    }
  }
}

export const resourceInspector = new ResourceInspector(api);
