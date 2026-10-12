import type { MigrationDatabase, MigrationFile, MigrationReport } from '../../types';

export class MigrationRunner {
  private readonly database: MigrationDatabase;

  constructor(database: MigrationDatabase) {
    this.database = database;
  }

  async run(files: readonly MigrationFile[]): Promise<MigrationReport> {
    const report: MigrationReport = { applied: [], skipped: [] };

    await this.database.ensureHistoryTable();

    for (const file of files) {
      const applied = await this.database.applyOnce(file);

      (applied ? report.applied : report.skipped).push(file.version);
    }

    return report;
  }
}
