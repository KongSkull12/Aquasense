import fs from 'fs';
import path from 'path';
import { QueryInterface, QueryTypes, Transaction } from 'sequelize';
import { logger } from '../utils/logger';
import { getDatabase } from './connection';

const MIGRATIONS_DIRECTORY = path.resolve(__dirname, '../../migrations');
const MIGRATION_LOCK_ID = 781204;

const migrationFiles = (): string[] => fs.readdirSync(MIGRATIONS_DIRECTORY)
  .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
  .sort();

const getMigrationSql = (file: string): string => fs.readFileSync(path.join(MIGRATIONS_DIRECTORY, file), 'utf8')
  .replace(/^\s*BEGIN\s*;\s*/i, '')
  .replace(/\s*COMMIT\s*;\s*$/i, '');

const ensureMigrationLedger = async (queryInterface: QueryInterface, transaction: Transaction): Promise<void> => {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `, { transaction });
};

/** Apply pending SQL migrations once, recording each migration atomically. */
export const runMigrations = async (): Promise<void> => {
  const queryInterface = getDatabase().getQueryInterface();

  for (const file of migrationFiles()) {
    try {
      await getDatabase().transaction(async (transaction) => {
        // Serialize startup migration checks so concurrent instances cannot apply one migration twice.
        await getDatabase().query('SELECT pg_advisory_xact_lock(:lockId)', {
          replacements: { lockId: MIGRATION_LOCK_ID },
          transaction,
        });
        await ensureMigrationLedger(queryInterface, transaction);

        const rows = await getDatabase().query<{ name: string }[]>(
          'SELECT name FROM schema_migrations WHERE name = :name',
          { type: QueryTypes.SELECT, replacements: { name: file }, transaction }
        );
        if (rows.length > 0) return;

        await getDatabase().query(getMigrationSql(file), { transaction });
        await getDatabase().query('INSERT INTO schema_migrations (name) VALUES (:name)', {
          replacements: { name: file },
          transaction,
        });
        logger.info(`Applied database migration: ${file}`);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown database error';
      logger.error(`Database migration failed: ${file}`, { message });
      throw new Error(`Database migration failed: ${file}`);
    }
  }
};
