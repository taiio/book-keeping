import { QueryTypes } from 'sequelize';

import { sequelize } from '../../config/database';
import { MIGRATION } from '../../constants';
import type { MigrationDatabase, MigrationFile } from '../../types';

export class SequelizeMigrationDatabase implements MigrationDatabase {
  async ensureHistoryTable(): Promise<void> {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS ${MIGRATION.HISTORY_TABLE} (
        version varchar(255) PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  applyOnce(migration: MigrationFile): Promise<boolean> {
    return sequelize.transaction(async (transaction) => {
      await sequelize.query('SELECT pg_advisory_xact_lock(:key)', { replacements: { key: MIGRATION.LOCK_KEY }, transaction });

      const applied = await sequelize.query(`SELECT 1 FROM ${MIGRATION.HISTORY_TABLE} WHERE version = :version`, {
        type: QueryTypes.SELECT,
        replacements: { version: migration.version },
        transaction,
      });

      if (applied.length > 0) return false;

      await sequelize.query(migration.sql, { transaction });
      await sequelize.query(`INSERT INTO ${MIGRATION.HISTORY_TABLE} (version) VALUES (:version)`, { replacements: { version: migration.version }, transaction });

      return true;
    });
  }
}
