require('ts-node/register');

const { initializeDatabase, closeDatabase } = require('../src/database/connection');
const { runMigrations } = require('../src/database/migrations');

async function main() {
  try {
    await initializeDatabase();
    await runMigrations();
    console.log('Database migrations are up to date.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Database migration failed.');
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

main();
