BEGIN;

ALTER TABLE IF EXISTS sensor_readings
  ADD COLUMN IF NOT EXISTS device_id VARCHAR(120) NOT NULL DEFAULT 'unknown-device';

CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY,
  device_id VARCHAR(120) NOT NULL,
  category VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  current_value DOUBLE PRECISION NOT NULL,
  threshold_value DOUBLE PRECISION NOT NULL,
  unit VARCHAR(16) NOT NULL,
  action VARCHAR(64) NOT NULL,
  message VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  sms_sent_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS alerts_device_category_created_at_idx
  ON alerts (device_id, category, created_at);

CREATE INDEX IF NOT EXISTS alerts_status_idx
  ON alerts (status);

CREATE TABLE IF NOT EXISTS sms_logs (
  id UUID PRIMARY KEY,
  alert_id UUID NULL,
  device_id VARCHAR(120) NOT NULL,
  category VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  recipient VARCHAR(32) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  provider_response TEXT NOT NULL,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  retry_count INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sms_logs_device_category_sent_at_idx
  ON sms_logs (device_id, category, sent_at);

CREATE INDEX IF NOT EXISTS sms_logs_alert_id_idx
  ON sms_logs (alert_id);

COMMIT;
