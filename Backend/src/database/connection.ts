import { Sequelize } from 'sequelize';
import { logger } from '../utils/logger';
import { config } from '../config/config';

/**
 * Sequelize database instance
 */
let sequelize: Sequelize;

/**
 * Initialize database connection
 */
export const initializeDatabase = async (): Promise<Sequelize> => {
  try {
    const dbHost = config.database.host;
    const dbPort = config.database.port;
    const dbName = config.database.name;
    const dbUser = config.database.user;
    const dbPassword = config.database.password;
    const dbDialect = config.database.dialect;

    sequelize = new Sequelize(dbName, dbUser, dbPassword, {
      host: dbHost,
      port: dbPort,
      dialect: dbDialect,
      logging: (msg) => logger.debug(msg),
      pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000,
      },
      define: {
        timestamps: true,
        underscored: true,
      },
    });

    // Test connection
    await sequelize.authenticate();
    logger.info(`✓ Database connected: ${dbName} on ${dbHost}:${dbPort}`);

    // Don't sync yet - models need to be initialized first
    return sequelize;
  } catch (error) {
    logger.error(`✗ Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
};

/**
 * Get database instance
 */
export const getDatabase = (): Sequelize => {
  if (!sequelize) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return sequelize;
};

/**
 * Sync database models (create tables if they don't exist)
 */
export const syncDatabase = async (): Promise<void> => {
  if (!sequelize) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  await sequelize.sync({ alter: false });
  logger.info('✓ Database models synchronized');
};

/**
 * Close database connection
 */
export const closeDatabase = async (): Promise<void> => {
  if (sequelize) {
    await sequelize.close();
    logger.info('✓ Database connection closed');
  }
};
