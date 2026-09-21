import { api, type API } from "../api";
import { SITE_LIMITS } from "../../../../packages/content/src/site";
import { canonical } from "../../../../packages/core/src/protocol";
import {
  parseSiteResourceReference,
  type SiteResourceReference,
} from "../../../../packages/content/src/site-resource";

export interface ResourceTarget {
  snapshotId: string;
  pageId: string;
  blockId: string;
}
interface Observer {
  signal?: AbortSignal;
  abort(): void;
  resolve(value: any): void;
  reject(error: unknown): void;
}
interface Job {
  body: ResourceTarget & { action: "inspect" };
  key: string;
  observers: Set<Observer>;
}
/** Concurrent status checks for the same reference in one authenticated page
 * may share an in-flight request. Results are never cached after completion and
 * explicit obtains keep their own target-specific authorisation. */
export class ResourceInspector {
  private active = 0;
  private observers = 0;
  private waiting: Job[] = [];
  private jobs = new Map<string, Job>();
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
  inspect(
    target: ResourceTarget,
    signal?: AbortSignal,
    reference?: SiteResourceReference,
  ): Promise<any> {
    if (signal?.aborted)
      return Promise.reject(
        new DOMException("Operação cancelada", "AbortError"),
      );
    let key: string;
    try {
      key = canonical(
        reference === undefined
          ? target
          : {
              snapshotId: target.snapshotId,
              pageId: target.pageId,
              reference: parseSiteResourceReference(reference),
            },
      );
    } catch (error) {
      return Promise.reject(error);
    }
    let job = this.jobs.get(key);
    if (
      this.observers >= this.queued + this.parallel ||
      (!job && this.waiting.length >= this.queued)
    )
      return Promise.reject(new Error("Há demasiadas operações em curso"));
    if (!job) {
      job = {
        key,
        body: {
          action: "inspect",
          snapshotId: target.snapshotId,
          pageId: target.pageId,
          blockId: target.blockId,
        },
        observers: new Set(),
      };
      this.jobs.set(key, job);
      this.waiting.push(job);
    }
    const current = job;
    return new Promise((resolve, reject) => {
      const observer: Observer = {
        signal,
        resolve,
        reject,
        abort: () => {
          if (!current.observers.delete(observer)) return;
          this.observers--;
          signal?.removeEventListener("abort", observer.abort);
          reject(new DOMException("Operação cancelada", "AbortError"));
          if (!current.observers.size) {
            // New views/sessions must never join an abandoned request. Its actual
            // active slot remains occupied until the runtime reply/timeout.
            if (this.jobs.get(key) === current) this.jobs.delete(key);
            const index = this.waiting.indexOf(current);
            if (index >= 0) this.waiting.splice(index, 1);
          }
        },
      };
      this.observers++;
      current.observers.add(observer);
      signal?.addEventListener("abort", observer.abort, { once: true });
      this.drain();
    });
  }
  private finish(job: Job, value: any, failed = false, error?: unknown) {
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
    for (const observer of job.observers) {
      this.observers--;
      observer.signal?.removeEventListener("abort", observer.abort);
      if (failed) observer.reject(error);
      else {
        try {
          observer.resolve(structuredClone(value));
        } catch (error) {
          observer.reject(error);
        }
      }
    }
    job.observers.clear();
  }
  private drain() {
    while (this.active < this.parallel && this.waiting.length) {
      const job = this.waiting.shift()!;
      if (!job.observers.size) continue;
      this.active++;
      void Promise.resolve()
        .then(() =>
          job.observers.size
            ? this.perform("resource-command", job.body)
            : undefined,
        )
        .then(
          (value) => this.finish(job, value),
          (error) => this.finish(job, undefined, true, error),
        )
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }
}
export const resourceInspector = new ResourceInspector(api);
