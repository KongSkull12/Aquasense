import { initializeUserModel } from './User';
import { initializeSensorReadingModel } from './SensorReading';
import { initializeAlertModel } from './Alert';
import { initializeSmsLogModel } from './SmsLog';
import { initializeFeedingScheduleModel } from './FeedingSchedule';
import { initializeFeedingCommandModel } from './FeedingCommand';
import { initializePredictionLogModel } from './PredictionLog';
import { initializeDeviceModel } from './Device';
import { initializeAuditLogModel } from './AuditLog';
import { initializeHardwareControlModels } from './HardwareControl';
import { initializeWaterQualitySettingModel } from './WaterQualitySetting';
import { initializeTanMeasurementModel, TanMeasurement } from './TanMeasurement';
import { User } from './User';
import { SensorReading } from './SensorReading';
import { Alert } from './Alert';
import { SmsLog } from './SmsLog';
import { FeedingSchedule } from './FeedingSchedule';
import { FeedingCommand } from './FeedingCommand';
import { PredictionLog } from './PredictionLog';
import { Device } from './Device';
import { AuditLog } from './AuditLog';

/**
 * Initialize all database models
 */
export const initializeAllModels = async (): Promise<void> => {
  initializeUserModel();
  initializeSensorReadingModel();
  initializeAlertModel();
  initializeSmsLogModel();
  initializeFeedingScheduleModel();
  initializeFeedingCommandModel();
  initializePredictionLogModel();
  initializeDeviceModel();
  initializeAuditLogModel();
  initializeHardwareControlModels();
  initializeWaterQualitySettingModel();
  initializeTanMeasurementModel();
  await ensureSensorReadingSchemaCompat();
  await ensureUserSchemaCompat();
  await ensureFeedingSchemaCompat();
};

const ensureSensorReadingSchemaCompat = async (): Promise<void> => {
  const sequelize = getDatabase();
  await sequelize.query('ALTER TABLE IF EXISTS sensor_readings ADD COLUMN IF NOT EXISTS "orp" DOUBLE PRECISION NULL;');
  await sequelize.query('ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS "ammonia" DOUBLE PRECISION NOT NULL DEFAULT 0;');
  await sequelize.query('ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS sensor_health JSONB NULL, ADD COLUMN IF NOT EXISTS speciation JSONB NULL, ADD COLUMN IF NOT EXISTS turbidity_unit VARCHAR(16) NULL;');
  for (const column of ['temperature','ph','do','turbidity','ammonia']) {
    await sequelize.query('ALTER TABLE sensor_readings ALTER COLUMN "' + column + '" DROP NOT NULL, ALTER COLUMN "' + column + '" DROP DEFAULT;');
  }
  // Historical rows have no evidence that DO was measured rather than defaulted.
  await sequelize.query('ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS "do_measured" BOOLEAN NOT NULL DEFAULT false;');
};

const ensureUserSchemaCompat = async (): Promise<void> => {
  const sequelize = getDatabase();
  await sequelize.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_users_role') THEN
        CREATE TYPE enum_users_role AS ENUM ('admin', 'farmer', 'guest');
      END IF;
    END$$;
  `);
  await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS "role" enum_users_role NOT NULL DEFAULT \'farmer\';');
};

const ensureFeedingSchemaCompat = async (): Promise<void> => {
  const sequelize = getDatabase();

  // Existing deployments may have feeding_schedules without `date`.
  await sequelize.query('ALTER TABLE feeding_schedules ADD COLUMN IF NOT EXISTS "date" VARCHAR(10);');
  await sequelize.query('ALTER TABLE feeding_schedules ADD COLUMN IF NOT EXISTS "user_id" UUID;');
  await sequelize.query('ALTER TABLE feeding_commands ADD COLUMN IF NOT EXISTS "user_id" UUID;');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS devices (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL,
      device_id VARCHAR(120) UNIQUE NOT NULL,
      name VARCHAR(120) NOT NULL DEFAULT 'My Device',
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS prediction_logs (
      id UUID PRIMARY KEY,
      risk_score DOUBLE PRECISION NOT NULL,
      risk_level VARCHAR(16) NOT NULL,
      predicted_issue VARCHAR(255) NOT NULL,
      eta_minutes INTEGER NULL,
      triggered_alert_id UUID NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);
  await sequelize.query('ALTER TABLE prediction_logs ADD COLUMN IF NOT EXISTS "triggered_alert_id" UUID;');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY,
      user_id UUID NULL,
      device_id VARCHAR(120) NULL,
      action VARCHAR(120) NOT NULL,
      status VARCHAR(16) NOT NULL,
      ip_address VARCHAR(80) NULL,
      metadata JSONB NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);
};

// Export models
export { User, initializeUserModel };
export { SensorReading, initializeSensorReadingModel };
export { Alert, initializeAlertModel };
export { SmsLog, initializeSmsLogModel };
export { FeedingSchedule, initializeFeedingScheduleModel };
export { FeedingCommand, initializeFeedingCommandModel };
export { PredictionLog, initializePredictionLogModel };
export { Device, initializeDeviceModel };
export { AuditLog, initializeAuditLogModel };
export { TanMeasurement, initializeTanMeasurementModel };
export { WaterQualitySetting, initializeWaterQualitySettingModel } from './WaterQualitySetting';
import { getDatabase } from '../connection';
