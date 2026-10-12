export interface MigrationFile {
  version: string;
  sql: string;
}

export interface MigrationDatabase {
  ensureHistoryTable(): Promise<void>;
  applyOnce(migration: MigrationFile): Promise<boolean>;
}

export interface MigrationReport {
  applied: string[];
  skipped: string[];
}
