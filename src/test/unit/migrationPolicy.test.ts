import * as assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { MIGRATION } from '../../constants';
import { loadMigrationFiles } from '../../scripts/migrations/loadMigrationFiles';

const ROOT = join(__dirname, '..', '..');
const files = loadMigrationFiles(join(ROOT, 'db', 'migrations'));
const sqlOf = (prefix: string): string => files.find((file) => file.version.startsWith(prefix))!.sql;

const MODEL_TABLES = readdirSync(join(ROOT, 'models'))
  .map((name) => readFileSync(join(ROOT, 'models', name), 'utf8').match(/tableName: '(\w+)'/)?.[1])
  .filter((name): name is string => name !== undefined)
  .sort();

const PROTECTED_TABLES = [...MODEL_TABLES, MIGRATION.HISTORY_TABLE].sort();
const UPDATABLE_TABLES = ['book', 'inbox_event', 'journal_transaction', 'outbox_event'];
const IMMUTABLE_TABLES = PROTECTED_TABLES.filter((table) => !UPDATABLE_TABLES.includes(table));

const triggersOn = (sql: string, event: string): string[] =>
  [...sql.matchAll(new RegExp(`CREATE TRIGGER trg_(\\w+)_no_${event.toLowerCase()} BEFORE ${event} ON (\\w+) `, 'g'))].map((match) => {
    assert.equal(match[1], match[2]);

    return match[2];
  });

describe('migration files', () => {
  it('are numbered consecutively from 0001 with a descriptive name', () => {
    assert.ok(files.length >= 3);

    files.forEach((file, index) => assert.match(file.version, new RegExp(`^${String(index + 1).padStart(4, '0')}_[a-z_]+$`)));
  });

  it('create exactly the tables the models declare', () => {
    const created = [...sqlOf('0001').matchAll(/CREATE TABLE (\w+) \(/g)].map((match) => match[1]).sort();

    assert.deepEqual(created, MODEL_TABLES);
  });

  it('use restrictive foreign keys only', () => {
    const sql = sqlOf('0001');
    const references = sql.match(/REFERENCES [^\n]+/g) ?? [];

    assert.ok(references.length > 0);
    references.forEach((line) => assert.match(line, /ON UPDATE RESTRICT ON DELETE RESTRICT/));
    assert.doesNotMatch(sql, /CASCADE/);
  });

  it('keep the external book unique even though its state is NULL', () => {
    assert.match(sqlOf('0001'), /CREATE UNIQUE INDEX idx_unique_book ON book \([^)]*transaction_state_id\) NULLS NOT DISTINCT/);
  });
});

describe('immutability policy', () => {
  it('forbids deleting and truncating every table', () => {
    const sql = sqlOf('0002');

    assert.deepEqual(triggersOn(sql, 'DELETE').sort(), PROTECTED_TABLES);
    assert.deepEqual(triggersOn(sql, 'TRUNCATE').sort(), PROTECTED_TABLES);
  });

  it('forbids updating every table except journal transactions, books and the messaging tables', () => {
    assert.deepEqual(triggersOn(sqlOf('0003'), 'UPDATE').sort(), IMMUTABLE_TABLES);
  });

  it('leaves the tables the service has to update unprotected against updates', () => {
    const forbidden = triggersOn(sqlOf('0003'), 'UPDATE');

    UPDATABLE_TABLES.forEach((table) => assert.ok(!forbidden.includes(table), table));
  });

  it('is matched by the code: repositories of immutable tables only insert', () => {
    const repositories = ['BookPostingRepository', 'BookHistoryRepository', 'JournalTransactionHistoryRepository'];

    for (const name of repositories) {
      const source = readFileSync(join(ROOT, 'repositories', `${name}.ts`), 'utf8');

      assert.doesNotMatch(source, /\.(save|update|destroy|increment|upsert|bulkUpdate)\(/, name);
    }
  });

  it('is matched by the code: nothing in the service deletes rows', () => {
    const folders = ['repositories', 'ledger', 'handlers', 'messaging'];

    for (const folder of folders) {
      const stack = [join(ROOT, folder)];

      while (stack.length > 0) {
        const directory = stack.pop()!;

        for (const entry of readdirSync(directory)) {
          const path = join(directory, entry);

          if (entry.endsWith('.ts')) assert.doesNotMatch(readFileSync(path, 'utf8'), /\.(destroy|truncate)\(|DELETE FROM/i, path);
          else if (!entry.includes('.')) stack.push(path);
        }
      }
    }
  });
});
