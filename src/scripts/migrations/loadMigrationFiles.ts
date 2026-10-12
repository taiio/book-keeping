import { readdirSync, readFileSync } from 'fs';
import { basename, join } from 'path';

import { MIGRATION } from '../../constants';
import type { MigrationFile } from '../../types';

export function loadMigrationFiles(directory: string): MigrationFile[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(MIGRATION.FILE_EXTENSION))
    .sort()
    .map((name) => ({ version: basename(name, MIGRATION.FILE_EXTENSION), sql: readFileSync(join(directory, name), 'utf8') }));
}
