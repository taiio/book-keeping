import * as assert from 'node:assert/strict';

import { IntervalWorker } from '../../messaging/workers/IntervalWorker';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('IntervalWorker', () => {
  it('runs the task again and again but never two runs at once', async () => {
    let active = 0;
    let maxActive = 0;
    let runs = 0;

    const worker = new IntervalWorker(
      'test',
      async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        runs += 1;
        await sleep(15);
        active -= 1;
      },
      5,
    );

    worker.start();
    await sleep(150);
    await worker.stop();

    const runsAtStop = runs;

    assert.ok(runsAtStop >= 3);
    assert.equal(maxActive, 1);

    await sleep(50);
    assert.equal(runs, runsAtStop);
  });

  it('keeps going after a run that failed', async () => {
    const original = console.error;
    let runs = 0;

    console.error = () => {};

    const worker = new IntervalWorker(
      'test',
      async () => {
        runs += 1;

        if (runs === 1) throw new Error('boom');
      },
      5,
    );

    worker.start();
    await sleep(80);
    await worker.stop();

    console.error = original;

    assert.ok(runs >= 2);
  });

  it('waits for the run in flight when stopping', async () => {
    let finished = false;
    const worker = new IntervalWorker(
      'test',
      async () => {
        await sleep(40);
        finished = true;
      },
      1,
    );

    worker.start();
    await sleep(15);
    await worker.stop();

    assert.equal(finished, true);
  });
});
