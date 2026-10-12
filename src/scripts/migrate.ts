import { join } from 'path';

import { sequelize } from '../config/database';
import type { MigrationReport } from '../types';
import { loadMigrationFiles } from './migrations/loadMigrationFiles';
import { MigrationRunner } from './migrations/MigrationRunner';
import { SequelizeMigrationDatabase } from './migrations/SequelizeMigrationDatabase';

export function runMigrations(): Promise<MigrationReport> {
  const files = loadMigrationFiles(join(__dirname, '..', 'db', 'migrations'));

  return new MigrationRunner(new SequelizeMigrationDatabase()).run(files);
}

async function main(): Promise<void> {
  try {
    await sequelize.authenticate();

    const report = await runMigrations();

    console.log(`[migrate] applied: ${report.applied.join(', ') || 'none'}`);
    console.log(`[migrate] already applied: ${report.skipped.join(', ') || 'none'}`);
  } catch (error) {
    console.error('[migrate] failed', error);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) void main();
