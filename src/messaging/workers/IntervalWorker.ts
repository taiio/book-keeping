export class IntervalWorker {
  private readonly name: string;
  private readonly task: () => Promise<unknown>;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = true;

  constructor(name: string, task: () => Promise<unknown>, intervalMs: number) {
    this.name = name;
    this.task = task;
    this.intervalMs = intervalMs;
  }

  start(): void {
    this.stopped = false;
    this.schedule();
  }

  async stop(): Promise<void> {
    this.stopped = true;

    if (this.timer !== null) clearTimeout(this.timer);

    this.timer = null;

    await this.running;
  }

  private schedule(): void {
    if (this.stopped) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      this.running = this.tick();
    }, this.intervalMs);
  }

  private async tick(): Promise<void> {
    try {
      await this.task();
    } catch (error) {
      console.error(`[worker:${this.name}] run failed`, error);
    }

    this.running = null;
    this.schedule();
  }
}
