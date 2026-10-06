// No configuration or DB imports: delivery bounds can be tested without services.
export class RuntimeWriter<T> {
  private pending: { record: T; done: (stored: boolean) => void }[] = [];
  private active = 0;
  private dropped = 0;
  private failed = 0;
  constructor(
    private write: (
      record: T,
      signal: AbortSignal,
      timeoutMS: number,
    ) => Promise<void>,
    private onFailure: () => void,
    private bounds = { concurrency: 2, queued: 100, timeoutMS: 500 },
  ) {}
  stats() {
    return {
      active: this.active,
      queued: this.pending.length,
      dropped: this.dropped,
      failed: this.failed,
    };
  }
  enqueue(record: T): Promise<boolean> {
    if (this.pending.length >= this.bounds.queued) {
      this.dropped++;
      return Promise.resolve(false);
    }
    return new Promise((done) => {
      this.pending.push({ record, done });
      this.pump();
    });
  }
  private pump() {
    while (this.active < this.bounds.concurrency && this.pending.length) {
      const item = this.pending.shift()!;
      this.active++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.bounds.timeoutMS);
      timer.unref();
      void Promise.resolve()
        .then(() =>
          this.write(item.record, controller.signal, this.bounds.timeoutMS),
        )
        .then(
          () => item.done(true),
          () => {
            this.failed++;
            try {
              this.onFailure();
            } catch {
              /* Never fail the request for logging. */
            }
            item.done(false);
          },
        )
        .finally(() => {
          clearTimeout(timer);
          this.active--;
          this.pump();
        });
    }
  }
}
