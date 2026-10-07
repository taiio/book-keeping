import type { Logger } from 'winston';

import { createLogger, errorMeta } from '../../common/logger';

/** A task result such as { processed: 3, applied: 3 } or { claimed: 0 }: "busy" when any counter is above zero. */
function hasActivity(result: unknown): boolean {
  if (result === null || typeof result !== 'object') return false;

  return Object.values(result).some((value) => typeof value === 'number' && value > 0);
}

export class IntervalWorker {
  readonly name: string;
  private readonly task: () => Promise<unknown>;
  private readonly intervalMs: number;
  private readonly log: Logger;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = true;

  constructor(name: string, task: () => Promise<unknown>, intervalMs: number) {
    this.name = name;
    this.task = task;
    this.intervalMs = intervalMs;
    this.log = createLogger(`worker:${name}`);
  }

  start(): void {
    this.stopped = false;
    this.log.info('worker started', { intervalMs: this.intervalMs });
    this.schedule();
  }

  async stop(): Promise<void> {
    this.stopped = true;

    if (this.timer !== null) clearTimeout(this.timer);

    this.timer = null;

    await this.running;

    this.log.info('worker stopped');
  }

  private schedule(): void {
    if (this.stopped) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      this.running = this.tick();
    }, this.intervalMs);
  }

  private async tick(): Promise<void> {
    const startedAt = Date.now();

    try {
      const result = await this.task();
      const durationMs = Date.now() - startedAt;

      // Idle ticks run every few hundred ms; keep them out of the normal output.
      if (hasActivity(result)) this.log.info('run finished', { durationMs, result });
      else this.log.silly('idle run', { durationMs });
    } catch (error) {
      this.log.error('run failed', { durationMs: Date.now() - startedAt, ...errorMeta(error) });
    }

    this.running = null;
    this.schedule();
  }
}
