import * as assert from 'node:assert/strict';

import { MigrationRunner } from '../../scripts/migrations/MigrationRunner';
import type { MigrationDatabase, MigrationFile } from '../../types';

const file = (version: string): MigrationFile => ({ version, sql: `-- ${version}` });

function fakeDatabase(alreadyApplied: readonly string[] = [], failOn?: string) {
  const calls: string[] = [];
  const applied = new Set(alreadyApplied);

  const database: MigrationDatabase = {
    ensureHistoryTable: async () => void calls.push('history'),
    applyOnce: async (migration) => {
      calls.push(migration.version);

      if (migration.version === failOn) throw new Error(`broken ${migration.version}`);

      if (applied.has(migration.version)) return false;

      applied.add(migration.version);

      return true;
    },
  };

  return { database, calls };
}

describe('MigrationRunner', () => {
  it('prepares the history table first, then applies every migration in the order given', async () => {
    const { database, calls } = fakeDatabase();

    const report = await new MigrationRunner(database).run([file('0001_a'), file('0002_b'), file('0003_c')]);

    assert.deepEqual(calls, ['history', '0001_a', '0002_b', '0003_c']);
    assert.deepEqual(report, { applied: ['0001_a', '0002_b', '0003_c'], skipped: [] });
  });

  it('reports what was already applied and applies only what is new', async () => {
    const { database } = fakeDatabase(['0001_a', '0002_b']);

    const report = await new MigrationRunner(database).run([file('0001_a'), file('0002_b'), file('0003_c')]);

    assert.deepEqual(report, { applied: ['0003_c'], skipped: ['0001_a', '0002_b'] });
  });

  it('is repeatable: running again applies nothing', async () => {
    const { database } = fakeDatabase();
    const runner = new MigrationRunner(database);
    const files = [file('0001_a'), file('0002_b')];

    await runner.run(files);

    assert.deepEqual(await runner.run(files), { applied: [], skipped: ['0001_a', '0002_b'] });
  });

  it('stops at the first failing migration and never runs the ones after it', async () => {
    const { database, calls } = fakeDatabase([], '0002_b');

    await assert.rejects(() => new MigrationRunner(database).run([file('0001_a'), file('0002_b'), file('0003_c')]), /broken 0002_b/);

    assert.deepEqual(calls, ['history', '0001_a', '0002_b']);
  });
});
