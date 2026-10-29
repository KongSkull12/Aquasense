ALTER TABLE IF EXISTS sensor_readings ADD COLUMN IF NOT EXISTS boot_id VARCHAR(64) NULL;
ALTER TABLE IF EXISTS sensor_readings ADD COLUMN IF NOT EXISTS sequence_id BIGINT NULL;
DO $$
BEGIN
  IF to_regclass('sensor_readings') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS sensor_readings_device_frame_identity_uq
      ON sensor_readings (device_id, boot_id, sequence_id)
      WHERE boot_id IS NOT NULL AND sequence_id IS NOT NULL;
  END IF;
END$$;
